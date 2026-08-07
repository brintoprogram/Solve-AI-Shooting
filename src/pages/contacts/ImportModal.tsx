import { useCallback, useRef, useState } from "react";
import {
  X, Upload, FileSpreadsheet, ChevronDown, Loader2,
  CheckCircle2, AlertCircle, ArrowRight, RotateCcw,
} from "lucide-react";
import {
  MAPPABLE_FIELDS, FieldKey, Mapping, ParsedFile,
  parseFile, autoDetect, applyMapping, runImport, ImportStats,
} from "@/lib/importUtils";
import { useAuth } from "@/context/AuthContext";

// ── Types ─────────────────────────────────────────────────────────

type Step = "idle" | "mapping" | "importing" | "done";

interface Progress { phase: string; done: number; total: number }

// ── Helpers ───────────────────────────────────────────────────────

const CONTACT_FIELDS = MAPPABLE_FIELDS.filter((f) => f.category === "contact");
const INVOICE_FIELDS  = MAPPABLE_FIELDS.filter((f) => f.category === "invoice");

function fieldLabel(key: FieldKey | ""): string {
  if (!key) return "— Ignorar —";
  return MAPPABLE_FIELDS.find((f) => f.key === key)?.label ?? key;
}

function pct(done: number, total: number) {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

// ── Sub-components ────────────────────────────────────────────────

function DropZone({ onFile, loading }: { onFile: (f: File) => void; loading: boolean }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback((f: File) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(f.name);
    if (ok) onFile(f);
  }, [onFile]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handle(f);
  };

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed transition-colors cursor-pointer p-12
        ${over ? "border-[#3fb06c] bg-[#3fb06c]/10" : "border-[#2a3d30] bg-[#111a14] hover:border-[#3fb06c]/50"}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); }}
      />
      {loading ? (
        <Loader2 className="w-10 h-10 text-[#3fb06c] animate-spin" />
      ) : (
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${over ? "bg-[#3fb06c]/20" : "bg-[#1e2e22]"}`}>
          <Upload className="w-8 h-8 text-[#3fb06c]" />
        </div>
      )}
      <div className="text-center">
        <p className="text-sm font-medium text-white">
          {loading ? "Lendo arquivo…" : "Arraste e solte seu arquivo aqui"}
        </p>
        <p className="text-xs text-[#6b7f6e] mt-1">
          ou clique para selecionar · CSV, XLSX, XLS
        </p>
      </div>
    </div>
  );
}

function MappingTable({
  parsed,
  mapping,
  setMapping,
}: {
  parsed:     ParsedFile;
  mapping:    Mapping;
  setMapping: (m: Mapping) => void;
}) {
  const preview = parsed.rows.slice(0, 3);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[#6b7f6e]">
        {parsed.headers.length} colunas detectadas · {parsed.rows.length} linhas · Ajuste o mapeamento abaixo
      </p>

      <div className="rounded-xl border border-[#2a3d30] overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#2a3d30] bg-[#111a14]">
              <th className="px-3 py-2 text-left text-[#6b7f6e] font-medium w-[200px]">Coluna da planilha</th>
              <th className="px-3 py-2 text-center text-[#6b7f6e] font-medium w-8"></th>
              <th className="px-3 py-2 text-left text-[#6b7f6e] font-medium w-[200px]">Campo Solve AI</th>
              <th className="px-3 py-2 text-left text-[#6b7f6e] font-medium">Prévia (3 linhas)</th>
            </tr>
          </thead>
          <tbody>
            {parsed.headers.map((header) => (
              <tr key={header} className="border-b border-[#1e2e22] last:border-0 hover:bg-[#111a14]/50">
                <td className="px-3 py-2 font-mono text-white/80">{header}</td>
                <td className="px-3 py-2 text-center">
                  <ArrowRight className="w-3 h-3 text-[#3fb06c] mx-auto" />
                </td>
                <td className="px-3 py-2">
                  <FieldSelect
                    value={mapping[header] ?? ""}
                    onChange={(v) => setMapping({ ...mapping, [header]: v })}
                    usedKeys={Object.values(mapping).filter((k) => k && k !== mapping[header]) as FieldKey[]}
                  />
                </td>
                <td className="px-3 py-2 text-[#6b7f6e] font-mono">
                  {preview.map((row, i) => {
                    const idx = parsed.headers.indexOf(header);
                    const val = row[idx];
                    return val !== null && val !== undefined && val !== ""
                      ? <span key={i} className="mr-2 text-white/50">{String(val).slice(0, 24)}</span>
                      : null;
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FieldSelect({
  value,
  onChange,
  usedKeys,
}: {
  value:    FieldKey | "";
  onChange: (v: FieldKey | "") => void;
  usedKeys: FieldKey[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as FieldKey | "")}
        className="w-full appearance-none bg-[#0d1710] border border-[#2a3d30] rounded-lg px-2 py-1.5 pr-6 text-xs text-white focus:outline-none focus:border-[#3fb06c] cursor-pointer"
      >
        <option value="">— Ignorar —</option>
        <optgroup label="Contato">
          {CONTACT_FIELDS.map((f) => (
            <option key={f.key} value={f.key} disabled={usedKeys.includes(f.key as FieldKey)}>
              {f.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Boleto / NF">
          {INVOICE_FIELDS.map((f) => (
            <option key={f.key} value={f.key} disabled={usedKeys.includes(f.key as FieldKey)}>
              {f.label}
            </option>
          ))}
        </optgroup>
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#6b7f6e] pointer-events-none" />
    </div>
  );
}

function ProgressView({ progress }: { progress: Progress }) {
  const p = pct(progress.done, progress.total);
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="w-16 h-16 rounded-2xl bg-[#1e2e22] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#3fb06c] animate-spin" />
      </div>
      <div className="w-full max-w-sm text-center">
        <p className="text-sm text-white mb-3">{progress.phase}</p>
        <div className="w-full bg-[#1e2e22] rounded-full h-2">
          <div
            className="bg-[#3fb06c] h-2 rounded-full transition-all duration-300"
            style={{ width: `${p}%` }}
          />
        </div>
        <p className="text-xs text-[#6b7f6e] mt-2">
          {progress.done} / {progress.total}
        </p>
      </div>
    </div>
  );
}

function SummaryView({ stats, onClose, onReset }: { stats: ImportStats; onClose: () => void; onReset: () => void }) {
  const hasErrors = stats.errors.length > 0;
  return (
    <div className="flex flex-col items-center gap-6 py-6">
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${hasErrors ? "bg-amber-500/10" : "bg-[#3fb06c]/10"}`}>
        {hasErrors
          ? <AlertCircle className="w-8 h-8 text-amber-400" />
          : <CheckCircle2 className="w-8 h-8 text-[#3fb06c]" />
        }
      </div>

      <div className="text-center">
        <p className="text-lg font-semibold text-white">
          {hasErrors ? "Importação concluída com avisos" : "Importação concluída!"}
        </p>
        <p className="text-xs text-[#6b7f6e] mt-1">Resumo do processamento</p>
      </div>

      <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
        <StatCard label="Contatos inseridos"  value={stats.contactsInserted} color="green" />
        <StatCard label="Contatos atualizados" value={stats.contactsUpdated}  color="blue" />
        <StatCard label="Boletos criados"      value={stats.invoicesCreated}  color="purple" />
        <StatCard label="Linhas ignoradas"     value={stats.skipped}          color="gray" />
      </div>

      {/* Sem isto o usuário reimporta a planilha, vê "0 boletos criados" e
          conclui que a importação falhou — quando na verdade ela protegeu a
          base de duplicar a dívida. */}
      {stats.invoicesSkipped > 0 && (
        <div className="w-full max-w-sm rounded-xl border border-amber-900/40 bg-amber-950/20 p-3">
          <p className="text-xs text-amber-300/90">
            <span className="font-semibold">{stats.invoicesSkipped}</span>
            {stats.invoicesSkipped === 1 ? " boleto já existia" : " boletos já existiam"} e
            {stats.invoicesSkipped === 1 ? " foi ignorado" : " foram ignorados"}.
          </p>
          <p className="text-[11px] text-amber-300/60 mt-1">
            A identificação usa o código de barras ou o número da NF. Isso evita
            que reimportar a mesma planilha dobre a dívida dos contatos.
          </p>
        </div>
      )}

      {hasErrors && (
        <div className="w-full max-w-sm rounded-xl border border-red-900/40 bg-red-950/20 p-3">
          <p className="text-xs font-medium text-red-400 mb-2">Erros ({stats.errors.length})</p>
          <ul className="text-xs text-red-300/70 space-y-1 max-h-32 overflow-auto">
            {stats.errors.map((e, i) => <li key={i}>• {e}</li>)}
          </ul>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button onClick={onReset} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#2a3d30] text-[#6b7f6e] text-sm hover:border-[#3fb06c]/50 hover:text-white transition-colors">
          <RotateCcw className="w-4 h-4" />
          Nova importação
        </button>
        <button onClick={onClose} className="btn-agro px-6 py-2 text-sm">
          Fechar
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    green:  "text-[#3fb06c] bg-[#3fb06c]/10",
    blue:   "text-blue-400 bg-blue-400/10",
    purple: "text-purple-400 bg-purple-400/10",
    gray:   "text-[#6b7f6e] bg-[#1e2e22]",
  };
  return (
    <div className={`rounded-xl p-3 flex flex-col items-center gap-1 ${colors[color]}`}>
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs text-center opacity-80">{label}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

export function ImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess?: () => void }) {
  const { workspaceId: workspaceIdAuth } = useAuth();
  const [step,     setStep]     = useState<Step>("idle");
  const [parsing,  setParsing]  = useState(false);
  const [parsed,   setParsed]   = useState<ParsedFile | null>(null);
  const [mapping,  setMapping]  = useState<Mapping>({});
  const [progress, setProgress] = useState<Progress>({ phase: "", done: 0, total: 0 });
  const [stats,    setStats]    = useState<ImportStats | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  async function handleFile(file: File) {
    setParsing(true);
    setError(null);
    try {
      const result = await parseFile(file);
      if (result.headers.length === 0) throw new Error("Arquivo sem colunas detectáveis.");
      const detected = autoDetect(result.headers);
      setParsed(result);
      setMapping(detected);
      setStep("mapping");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao ler arquivo.");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!parsed) return;
    const mappedRows = applyMapping(parsed.headers, parsed.rows, mapping);
    const workspaceId = workspaceIdAuth ?? "";

    setStep("importing");
    setProgress({ phase: "Preparando…", done: 0, total: mappedRows.length });

    try {
      const result = await runImport(mappedRows, workspaceId, (phase, done, total) => {
        setProgress({ phase, done, total });
      });
      setStats(result);
      setStep("done");
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro durante importação.");
      setStep("mapping");
    }
  }

  function handleReset() {
    setStep("idle");
    setParsed(null);
    setMapping({});
    setStats(null);
    setError(null);
    setProgress({ phase: "", done: 0, total: 0 });
  }

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl border border-[#2a3d30] bg-[#0d1710] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2e22] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#3fb06c]/10 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-[#3fb06c]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Importar Contatos e Boletos</p>
              <p className="text-xs text-[#6b7f6e]">
                {step === "idle"     && "Selecione um arquivo CSV ou XLSX"}
                {step === "mapping"  && `${parsed?.rows.length ?? 0} linhas · mapeie as colunas`}
                {step === "importing" && "Processando…"}
                {step === "done"     && "Concluído"}
              </p>
            </div>
          </div>
          {step !== "importing" && (
            <button onClick={onClose} className="text-[#6b7f6e] hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Steps indicator */}
        {(step === "idle" || step === "mapping") && (
          <div className="flex items-center gap-0 px-6 pt-4 pb-2 shrink-0">
            {[
              { id: "idle",    label: "Arquivo" },
              { id: "mapping", label: "Mapeamento" },
              { id: "done",    label: "Resultado" },
            ].map((s, i) => {
              const active = step === s.id || (step === "mapping" && s.id === "idle");
              return (
                <div key={s.id} className="flex items-center">
                  <div className={`flex items-center gap-1.5 text-xs ${active ? "text-[#3fb06c]" : "text-[#6b7f6e]"}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${active ? "bg-[#3fb06c] text-white" : "bg-[#1e2e22]"}`}>{i + 1}</span>
                    {s.label}
                  </div>
                  {i < 2 && <div className="w-8 h-px bg-[#2a3d30] mx-2" />}
                </div>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {step === "idle" && <DropZone onFile={handleFile} loading={parsing} />}
          {step === "mapping" && parsed && (
            <MappingTable parsed={parsed} mapping={mapping} setMapping={setMapping} />
          )}
          {step === "importing" && <ProgressView progress={progress} />}
          {step === "done" && stats && (
            <SummaryView stats={stats} onClose={onClose} onReset={handleReset} />
          )}
        </div>

        {/* Footer */}
        {step === "mapping" && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-[#1e2e22] shrink-0">
            <div className="text-xs text-[#6b7f6e]">
              <span className="text-white font-medium">{mappedCount}</span> colunas mapeadas
              {mappedCount === 0 && <span className="text-amber-400 ml-2">· Mapeie ao menos 1 coluna para continuar</span>}
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="px-4 py-2 rounded-lg border border-[#2a3d30] text-[#6b7f6e] text-sm hover:border-[#3fb06c]/50 hover:text-white transition-colors"
              >
                Trocar arquivo
              </button>
              <button
                onClick={handleImport}
                disabled={mappedCount === 0}
                className="btn-agro px-6 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Importar {parsed?.rows.length ?? 0} linhas
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
