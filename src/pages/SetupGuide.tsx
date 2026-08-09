import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Circle, ChevronRight, X, Loader2,
  Smartphone, Webhook, Users, GitBranch, FileText, Zap, Handshake, UserPlus, Mail,
  PlayCircle,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/context/AuthContext";
import { useSetupChecklist } from "@/hooks/useSetupChecklist";
import { supabase } from "@/lib/supabase";
import { edgeErrorMessage } from "@/lib/db";
import { ArticleBody } from "@/components/docs/ArticleBody";
import { STATUS_STYLE, StatusIcon } from "@/components/docs/status";
import { SETUP_STEPS, STEP_WEIGHT_LABEL, type StepStatus } from "@/types/setup";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Smartphone, Webhook, Users, GitBranch, FileText, Zap, Handshake, UserPlus, Mail,
};

/** Botão "Testar agora" — só existe nos passos onde há verificação real. */
function LiveCheck({ stepId, workspaceId, onDone }: { stepId: string; workspaceId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; detail?: string } | null>(null);

  const check = stepId === "ai" ? "ai" : stepId === "channel" ? "meta" : null;
  const isRefreshOnly = stepId === "webhook" || stepId === "templates";
  if (!check && !isRefreshOnly) return null;

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      if (isRefreshOnly) {
        // Estes passos são provados por dado no banco: basta reconsultar.
        onDone();
        setResult({ ok: true, message: "Estado atualizado. Veja o item acima." });
      } else {
        const { data, error } = await supabase.functions.invoke("validate-config", {
          body: { workspace_id: workspaceId, check },
        });
        if (error) throw new Error(await edgeErrorMessage(error, "Não foi possível testar agora."));
        setResult(data as { ok: boolean; message: string; detail?: string });
        onDone();
      }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Falha ao testar." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={run}
        disabled={busy}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-agro-text disabled:opacity-50"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(63,176,108,0.25)" }}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
        {busy ? "Testando…" : "Testar agora"}
      </button>
      {result && (
        <div
          className="text-sm px-3 py-2.5 rounded-xl"
          style={{
            background: result.ok ? "rgba(74,222,128,0.08)" : "rgba(239,68,68,0.08)",
            border: `1px solid ${result.ok ? "rgba(74,222,128,0.25)" : "rgba(239,68,68,0.25)"}`,
            color: result.ok ? "#4ade80" : "#f87171",
          }}
        >
          <p className="font-medium">{result.ok ? "✓ " : "✕ "}{result.message}</p>
          {result.detail && <p className="text-xs mt-1 opacity-80">{result.detail}</p>}
        </div>
      )}
    </div>
  );
}

export function SetupGuide({ embedded = false }: { embedded?: boolean }) {
  const { workspaceId } = useAuth();
  const navigate = useNavigate();
  const { states, loading, blockersLeft, doneCount, totalCount, refresh } = useSetupChecklist(workspaceId ?? undefined);
  const [open, setOpen] = useState<string | null>(null);

  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  const body = (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-agro-text">Configuração do workspace</h1>
        <p className="text-sm text-agro-muted mt-1.5 leading-relaxed">
          Antes de operar, algumas peças precisam estar no lugar. Cada item abaixo explica o que é,
          por que importa e como fazer — e o sistema verifica sozinho quando você conclui.
        </p>
      </div>

      {/* Progresso */}
      <div className="rounded-2xl p-5" style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.12)" }}>
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-3xl font-bold text-agro-text">{doneCount}<span className="text-lg text-agro-muted-2"> / {totalCount}</span></p>
            <p className="text-xs text-agro-muted mt-0.5">
              {blockersLeft === 0
                ? "Tudo que é essencial está pronto — o workspace já opera."
                : `Falta${blockersLeft > 1 ? "m" : ""} ${blockersLeft} item${blockersLeft > 1 ? "s" : ""} essencia${blockersLeft > 1 ? "is" : "l"} para começar a operar.`}
            </p>
          </div>
          <span className="text-sm font-semibold" style={{ color: blockersLeft === 0 ? "#4ade80" : "#7a9e83" }}>{pct}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: "linear-gradient(90deg, #3fb06c, #16A34A)" }}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-agro-muted" /></div>
      ) : (
        <div className="space-y-2">
          {SETUP_STEPS.map((step) => {
            const st  = states[step.id] ?? { status: "pending" as StepStatus };
            const cfg = STATUS_STYLE[st.status];
            const Icon = ICONS[step.icon] ?? Circle;
            const isOpen = open === step.id;

            return (
              <div key={step.id} className="rounded-2xl overflow-hidden" style={{ background: "rgba(13,26,17,0.6)", border: `1px solid ${isOpen ? "rgba(63,176,108,0.3)" : "rgba(63,176,108,0.1)"}` }}>
                <button
                  onClick={() => setOpen(isOpen ? null : step.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
                >
                  <span
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
                  >
                    {st.status === "pending" ? <Icon className="w-4 h-4" /> : <StatusIcon status={st.status} />}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-agro-text">{step.title}</span>
                      {step.weight === "blocker" && st.status !== "done" && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                          style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                          {STEP_WEIGHT_LABEL.blocker}
                        </span>
                      )}
                      {step.weight === "optional" && (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide text-agro-muted-2"
                          style={{ background: "rgba(255,255,255,0.04)" }}>
                          {STEP_WEIGHT_LABEL.optional}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-agro-muted-2 mt-0.5">
                      {st.detail ?? step.summary}
                    </span>
                  </span>

                  <span className="text-[10px] font-semibold px-2 py-1 rounded shrink-0"
                    style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                    {cfg.label}
                  </span>
                  <ChevronRight className={`w-4 h-4 text-agro-muted-2 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </button>

                {isOpen && (
                  <div className="px-5 pb-5" style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
                    <ArticleBody
                      artigo={step}
                      acoesExtras={
                        <LiveCheck stepId={step.id} workspaceId={workspaceId ?? ""} onDone={refresh} />
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!embedded && (
        <div className="flex justify-center pt-2">
          <button onClick={() => navigate("/")} className="text-sm text-agro-muted-2 hover:text-agro-text transition-colors">
            Explorar o sistema por conta própria →
          </button>
        </div>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Primeiros passos" }]} />
      {body}
    </div>
  );
}

/** Card compacto para o Dashboard — some quando tudo essencial está pronto. */
export function SetupProgressCard() {
  const { workspaceId } = useAuth();
  const navigate = useNavigate();
  const { blockersLeft, doneCount, totalCount, loading } = useSetupChecklist(workspaceId ?? undefined);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("setup_card_dismissed") === "true"; } catch { return false; }
  });

  if (loading || dismissed || doneCount === totalCount) return null;

  const pct = Math.round((doneCount / totalCount) * 100);

  return (
    <div className="rounded-2xl p-5 mb-6" style={{ background: "linear-gradient(135deg, rgba(63,176,108,0.1), rgba(22,163,74,0.04))", border: "1px solid rgba(63,176,108,0.25)" }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-bold text-agro-text">
            {blockersLeft === 0 ? "Workspace operando — dá para melhorar" : "Termine a configuração do workspace"}
          </p>
          <p className="text-xs text-agro-muted mt-1">
            {blockersLeft === 0
              ? `${totalCount - doneCount} item${totalCount - doneCount > 1 ? "s" : ""} opcional/recomendado ainda aberto.`
              : `Falta${blockersLeft > 1 ? "m" : ""} ${blockersLeft} item${blockersLeft > 1 ? "s" : ""} essencia${blockersLeft > 1 ? "is" : "l"} para começar a operar.`}
          </p>
          <div className="h-1.5 rounded-full overflow-hidden mt-3 max-w-xs" style={{ background: "rgba(0,0,0,0.3)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #3fb06c, #16A34A)" }} />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => navigate("/primeiros-passos")} className="btn-agro px-4 py-2 rounded-xl text-xs font-semibold text-white">
            Continuar
          </button>
          <button
            onClick={() => { setDismissed(true); try { localStorage.setItem("setup_card_dismissed", "true"); } catch { /* noop */ } }}
            title="Ocultar (continua acessível pela sidebar)"
            className="p-1.5 rounded-lg text-agro-muted-2 hover:text-agro-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
