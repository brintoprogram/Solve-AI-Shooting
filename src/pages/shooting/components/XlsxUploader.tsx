import { useRef, useState } from "react";
import { CloudUpload, FileSpreadsheet, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useXlsxParser } from "@/hooks/useXlsxParser";
import type { XlsxValidationResult } from "@/types/shooting";

interface XlsxUploaderProps {
  onResult: (result: XlsxValidationResult, file: File) => void;
  onClear: () => void;
  result: XlsxValidationResult | null;
}

export function XlsxUploader({ onResult, onClear, result }: XlsxUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const { parsing, error, parseFile } = useXlsxParser();

  async function handleFile(file: File) {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "csv", "xls"].includes(ext ?? "")) {
      return;
    }
    const res = await parseFile(file);
    onResult(res, file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  if (result) {
    return (
      <div className="space-y-4">
        {/* Summary */}
        <div className="flex items-start justify-between p-4 rounded-xl border border-green-200 bg-green-50">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-green-900">Planilha carregada com sucesso</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-green-700">
                  <span className="font-medium">{result.validRows.length}</span> linhas válidas
                </span>
                {result.invalidRows.length > 0 && (
                  <span className="text-xs text-amber-600">
                    <span className="font-medium">{result.invalidRows.length}</span> inválidas
                  </span>
                )}
                {result.phoneColumn && (
                  <span className="text-xs text-gray-500">
                    Coluna de telefone: <span className="font-medium">{result.phoneColumn}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClear} className="h-7 w-7">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Preview table */}
        {result.previewData.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
              Primeiras {Math.min(5, result.previewData.length)} linhas
            </p>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {result.headers.map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 truncate max-w-[120px]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.previewData.map((row, i) => (
                    <tr key={i}>
                      {result.headers.map((h) => (
                        <td key={h} className="px-3 py-2 text-gray-700 truncate max-w-[120px]">
                          {String(row[h] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Errors */}
        {result.invalidRows.length > 0 && (
          <div>
            <button
              onClick={() => setShowErrors(!showErrors)}
              className="flex items-center gap-2 text-xs font-medium text-amber-600 hover:text-amber-700"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              {result.invalidRows.length} linhas com problema
              {showErrors ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showErrors && (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
                {result.invalidRows.map((err) => (
                  <div key={err.rowIndex} className="flex items-center gap-2 text-xs text-gray-600">
                    <Badge variant="amber">Linha {err.rowIndex}</Badge>
                    <span>{err.error}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors py-12 px-6 ${
          dragging
            ? "border-green-400 bg-green-50"
            : "border-gray-300 hover:border-green-400 hover:bg-gray-50"
        }`}
      >
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${dragging ? "bg-green-100" : "bg-gray-100"}`}>
          <CloudUpload className={`w-6 h-6 ${dragging ? "text-green-600" : "text-gray-400"}`} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">
            {parsing ? "Processando..." : "Arraste sua planilha ou clique para selecionar"}
          </p>
          <p className="text-xs text-gray-400 mt-1">.xlsx, .xls, .csv · Máx. 50MB · 50.000 linhas</p>
        </div>
        {parsing && (
          <div className="w-32 h-1 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full animate-pulse w-3/4" />
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
