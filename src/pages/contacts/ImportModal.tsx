import { useCallback, useRef, useState } from "react";
import { LeituraDaPlanilha } from "./LeituraDaPlanilha";
import {
  listarPerfis, melhorPerfil, aplicarPerfil, salvarPerfil, registrarUso,
  type PerfilDeImportacao,
} from "@/lib/perfisDeImportacao";
import {
  X, Upload, FileSpreadsheet, Loader2,
  CheckCircle2, AlertCircle, RotateCcw, Bookmark, BookmarkCheck,
} from "lucide-react";
import {
  Mapping, ParsedFile, OrdemData,
  parseFile, autoDetect, applyMapping, runImport, ImportStats,
} from "@/lib/importUtils";
import { useAuth } from "@/context/AuthContext";

// ── Types ─────────────────────────────────────────────────────────

type Step = "idle" | "mapping" | "importing" | "done";

interface Progress { phase: string; done: number; total: number }

// ── Helpers ───────────────────────────────────────────────────────

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
  const { workspaceId: workspaceIdAuth, profile } = useAuth();
  const [step,     setStep]     = useState<Step>("idle");
  const [parsing,  setParsing]  = useState(false);
  const [parsed,   setParsed]   = useState<ParsedFile | null>(null);
  const [mapping,  setMapping]  = useState<Mapping>({});
  /* Vive aqui e nao dentro da tela de leitura porque precisa sobreviver ate
     a importacao: e a mesma ordem que a previa mostrou. */
  const [ordemData, setOrdemData] = useState<OrdemData>("dmy");
  const [progress, setProgress] = useState<Progress>({ phase: "", done: 0, total: 0 });
  const [stats,    setStats]    = useState<ImportStats | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  /* Perfil reconhecido para ESTE arquivo, e o quanto ele se parece. Nulo
     quando nenhum passou do limiar — que e o caso normal na primeira vez. */
  const [perfil,   setPerfil]   = useState<{ perfil: PerfilDeImportacao; score: number } | null>(null);
  /* Guardado para o botao "usar deteccao automatica": sem isto, dispensar o
     perfil deixaria a pessoa com o mapeamento dele mesmo assim. */
  const [autoBase, setAutoBase] = useState<Mapping>({});
  const [nomeNovo, setNomeNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [salvo,    setSalvo]    = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  async function handleFile(file: File) {
    setParsing(true);
    setError(null);
    try {
      const result = await parseFile(file);
      if (result.headers.length === 0) throw new Error("Arquivo sem colunas detectáveis.");
      const detected = autoDetect(result.headers);
      setParsed(result);
      setAutoBase(detected);

      /* O perfil e conveniencia; a importacao e o trabalho.
         O try/catch PROPRIO e o que garante isso. listarPerfis ja nao lanca,
         mas melhorPerfil e aplicarPerfil leem jsonb vindo do banco: um perfil
         com mapeamento corrompido faria Object.entries estourar, o erro cairia
         no catch do parse la embaixo, e a pessoa veria "Erro ao ler arquivo"
         com um arquivo perfeitamente valido na mao. Um perfil defeituoso nao
         pode derrubar a importacao — ele so pode deixar de sugerir. */
      let achado: { perfil: PerfilDeImportacao; score: number } | null = null;
      try {
        if (workspaceIdAuth) {
          achado = melhorPerfil(await listarPerfis(workspaceIdAuth), result.headers);
        }
      } catch {
        achado = null;
      }

      let inicial = detected;
      if (achado) {
        try {
          inicial = aplicarPerfil(achado.perfil, result.headers, detected);
          setOrdemData(achado.perfil.ordem_data === "mdy" ? "mdy" : "dmy");
        } catch {
          achado = null;
          inicial = detected;
        }
      }
      setPerfil(achado);
      setMapping(inicial);
      setStep("mapping");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao ler arquivo.");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!parsed) return;
    const mappedRows = applyMapping(parsed.headers, parsed.rows, mapping, ordemData);
    const workspaceId = workspaceIdAuth ?? "";

    setStep("importing");
    setProgress({ phase: "Preparando…", done: 0, total: mappedRows.length });

    try {
      const result = await runImport(mappedRows, workspaceId, (phase, done, total) => {
        setProgress({ phase, done, total });
      });
      setStats(result);
      setStep("done");
      /* Depois do sucesso: o mapeamento acabou de ser conferido por uma pessoa
         de verdade, entao e agora que ele vale a pena ser guardado. */
      if (perfil) void registrarUso(perfil.perfil, mapping, ordemData);
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
    setPerfil(null);
    setAutoBase({});
    setNomeNovo("");
    setSalvo(false);
    setErroSalvar(null);
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
          {step === "mapping" && parsed && perfil && (
            <div
              className="mb-3 rounded-xl px-4 py-3 flex items-start gap-2.5"
              style={{ background: "rgba(63,176,108,0.07)", border: "1px solid rgba(63,176,108,0.22)" }}
            >
              <BookmarkCheck className="w-4 h-4 shrink-0 mt-0.5 text-[#3fb06c]" />
              <div className="min-w-0 flex-1 text-xs leading-relaxed">
                <p className="text-white/90">
                  Reconheci o formato <strong>{perfil.perfil.nome}</strong>
                  {perfil.perfil.usos > 0 && <> · usado {perfil.perfil.usos}{perfil.perfil.usos === 1 ? " vez" : " vezes"}</>}
                  {perfil.score < 1 && <span className="text-[#6b7f6e]"> · algumas colunas mudaram desde a última vez</span>}
                </p>
                <p className="text-[#6b7f6e] mt-0.5">
                  O mapeamento e a ordem das datas já vieram preenchidos. Confira abaixo antes de importar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setPerfil(null); setMapping(autoBase); }}
                className="shrink-0 text-[11px] text-[#6b7f6e] hover:text-white underline underline-offset-2"
              >
                Não usar
              </button>
            </div>
          )}
          {step === "mapping" && parsed && (
            <LeituraDaPlanilha
                parsed={parsed}
                mapping={mapping}
                setMapping={setMapping}
                ordem={ordemData}
                setOrdem={setOrdemData}
              />
          )}
          {step === "importing" && <ProgressView progress={progress} />}
          {step === "done" && stats && (
            <>
              <SummaryView stats={stats} onClose={onClose} onReset={handleReset} />

              {/* Depois do sucesso, e nao antes: o mapeamento so vale a pena ser
                  guardado depois de alguem ter conferido que ele produz o
                  resultado certo. Oferecer antes seria pedir para salvar um
                  palpite. */}
              {!perfil && !salvo && parsed && (
                <div
                  className="mt-4 rounded-xl px-4 py-3.5"
                  style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.16)" }}
                >
                  <p className="text-xs text-white/85 flex items-center gap-2">
                    <Bookmark className="w-3.5 h-3.5 text-[#3fb06c] shrink-0" />
                    Esse cliente manda a mesma planilha todo mês?
                  </p>
                  <p className="text-[11px] text-[#6b7f6e] mt-1 leading-relaxed">
                    Guarde este formato e a próxima importação já vem conferida — inclusive a ordem das datas.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    <input
                      value={nomeNovo}
                      onChange={(e) => { setNomeNovo(e.target.value); setErroSalvar(null); }}
                      placeholder="Ex.: Cobrança mensal"
                      maxLength={60}
                      className="flex-1 min-w-[180px] bg-[#0d1710] border border-[#2a3d30] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-[#3a4d3e] focus:outline-none focus:border-[#3fb06c]"
                    />
                    <button
                      type="button"
                      disabled={!nomeNovo.trim() || salvando}
                      onClick={async () => {
                        setSalvando(true);
                        setErroSalvar(null);
                        const r = await salvarPerfil({
                          workspaceId: workspaceIdAuth ?? "",
                          nome: nomeNovo,
                          cabecalhos: parsed.headers,
                          mapeamento: mapping,
                          ordemData,
                          criadoPor: profile?.id ?? null,
                        });
                        setSalvando(false);
                        if (r.ok) setSalvo(true); else setErroSalvar(r.erro ?? null);
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#3fb06c] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {salvando ? "Guardando…" : "Guardar formato"}
                    </button>
                  </div>
                  {erroSalvar && <p className="text-[11px] text-amber-400 mt-1.5">{erroSalvar}</p>}
                </div>
              )}

              {salvo && (
                <p className="mt-4 text-xs text-[#3fb06c] flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Formato guardado. Na próxima importação eu reconheço sozinho.
                </p>
              )}
            </>
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
