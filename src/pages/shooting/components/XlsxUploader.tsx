import { useRef, useState } from "react";
import { CloudUpload, FileSpreadsheet, AlertCircle, ChevronDown, ChevronUp, X } from "lucide-react";
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
    if (!["xlsx", "csv", "xls"].includes(ext ?? "")) return;
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
      <div className="space-y-5">
        {/* Summary */}
        <div className="flex items-start justify-between p-4 rounded-xl"
          style={{
            background: "rgba(63,176,108,0.08)",
            border: "1px solid rgba(63,176,108,0.25)",
          }}
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center glow-green-sm shrink-0"
              style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
            >
              <FileSpreadsheet className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-agro-text">Planilha carregada com sucesso</p>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-xs text-agro-green font-medium">
                  {result.validRows.length} linhas válidas
                </span>
                {result.invalidRows.length > 0 && (
                  <span className="text-xs text-amber-400 font-medium">
                    {result.invalidRows.length} inválidas
                  </span>
                )}
                {result.phoneColumn && (
                  <span className="text-xs text-agro-muted">
                    Coluna tel: <span className="font-medium text-agro-text">{result.phoneColumn}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClear}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview table */}
        {result.previewData.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest mb-2">
              Primeiras {Math.min(5, result.previewData.length)} linhas
            </p>
            <div className="overflow-x-auto rounded-xl"
              style={{ border: "1px solid rgba(63,176,108,0.12)" }}
            >
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: "rgba(13,26,17,0.8)", borderBottom: "1px solid rgba(63,176,108,0.12)" }}>
                    {result.headers.map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold text-agro-muted-2 uppercase tracking-wider truncate max-w-[120px]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.previewData.map((row, i) => (
                    <tr key={i}
                      style={{ borderBottom: "1px solid rgba(63,176,108,0.06)" }}
                      className="hover:bg-white/5 transition-colors"
                    >
                      {result.headers.map((h) => (
                        <td key={h} className="px-3 py-2 text-agro-text truncate max-w-[120px]">
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
              className="flex items-center gap-2 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              {result.invalidRows.length} linhas com problema
              {showErrors ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showErrors && (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
                {result.invalidRows.map((err) => (
                  <div key={err.rowIndex} className="flex items-center gap-2 text-xs text-agro-muted">
                    <span className="px-2 py-0.5 rounded-md text-amber-400 font-mono font-medium"
                      style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}
                    >
                      Linha {err.rowIndex}
                    </span>
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
        className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed cursor-pointer py-14 px-6 transition-all duration-300"
        style={dragging ? {
          background: "rgba(63,176,108,0.08)",
          borderColor: "#3fb06c",
          boxShadow: "0 0 30px rgba(63,176,108,0.15)",
        } : {
          background: "rgba(13,26,17,0.4)",
          borderColor: "rgba(63,176,108,0.2)",
        }}
      >
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300"
          style={dragging ? {
            background: "linear-gradient(135deg, #3fb06c, #16A34A)",
            boxShadow: "0 0 20px rgba(63,176,108,0.4)",
          } : {
            background: "rgba(63,176,108,0.08)",
            border: "1px solid rgba(63,176,108,0.15)",
          }}
        >
          <CloudUpload className={`w-7 h-7 transition-colors ${dragging ? "text-white" : "text-agro-muted-2"}`} />
        </div>

        <div className="text-center">
          <p className="text-sm font-semibold text-agro-text">
            {parsing ? "Processando planilha..." : "Arraste sua planilha ou clique para selecionar"}
          </p>
          <p className="text-xs text-agro-muted mt-1">
            .xlsx, .xls, .csv · Máx. 50MB · 50.000 linhas
          </p>
        </div>

        {parsing && (
          <div className="w-40 h-1 rounded-full overflow-hidden"
            style={{ background: "rgba(63,176,108,0.12)" }}
          >
            <div className="h-full rounded-full animate-pulse"
              style={{ width: "75%", background: "linear-gradient(90deg, #3fb06c, #16A34A)" }}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-red-400">
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
