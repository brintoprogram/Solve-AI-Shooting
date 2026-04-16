import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { isValidPhone, normalizePhone } from "@/lib/utils";
import type { XlsxValidationResult, XlsxRow } from "@/types/shooting";

const PHONE_COLUMN_HINTS = ["telefone", "phone", "celular", "whatsapp", "fone", "tel", "numero", "número"];

function detectPhoneColumn(headers: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const hint of PHONE_COLUMN_HINTS) {
    const idx = lower.findIndex((h) => h.includes(hint));
    if (idx >= 0) return headers[idx];
  }
  // Try to detect by values in first rows
  return null;
}

export function useXlsxParser() {
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<XlsxValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parseFile = useCallback(async (file: File): Promise<XlsxValidationResult> => {
    setParsing(true);
    setError(null);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<XlsxRow>(sheet, {
            defval: null,
            raw: false,
          });

          if (rows.length === 0) {
            const err = "A planilha está vazia ou não possui dados legíveis.";
            setError(err);
            reject(new Error(err));
            return;
          }

          const headers = Object.keys(rows[0]);
          const phoneColumn = detectPhoneColumn(headers);

          const validRows: XlsxRow[] = [];
          const invalidRows: XlsxValidationResult["invalidRows"] = [];

          rows.forEach((row, idx) => {
            if (phoneColumn) {
              const phone = String(row[phoneColumn] ?? "").trim();
              if (!phone || !isValidPhone(phone)) {
                invalidRows.push({
                  rowIndex: idx + 2, // +2 because row 1 is header
                  data: row,
                  error: phone ? `Telefone inválido: "${phone}"` : "Coluna de telefone vazia",
                });
                return;
              }
              row[phoneColumn] = normalizePhone(phone);
            }
            validRows.push(row);
          });

          const res: XlsxValidationResult = {
            headers,
            validRows,
            invalidRows,
            phoneColumn,
            previewData: rows.slice(0, 5),
          };

          setResult(res);
          setParsing(false);
          resolve(res);
        } catch (err) {
          const msg = "Erro ao processar planilha. Verifique se o arquivo é um .xlsx ou .csv válido.";
          setError(msg);
          setParsing(false);
          reject(new Error(msg));
        }
      };
      reader.onerror = () => {
        setError("Erro ao ler o arquivo.");
        setParsing(false);
        reject(new Error("Erro ao ler o arquivo."));
      };
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { parsing, result, error, parseFile, reset };
}
