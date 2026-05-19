import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Pencil, Pause, Play, Trash2, Users, Clock, Zap,
  CheckCircle2, XCircle, Loader2, CalendarDays, GitBranch,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Topbar } from "@/components/layout/Topbar";
import type { AutomationRule, AutomationTrigger, AutomationRecipient, AutomationLog } from "@/types/automations";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  draft:     { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "rgba(107,114,128,0.2)",  label: "Rascunho"  },
  active:    { bg: "rgba(63,176,108,0.1)",   color: "#3fb06c", border: "rgba(63,176,108,0.2)",   label: "Ativo"     },
  paused:    { bg: "rgba(245,158,11,0.1)",   color: "#fbbf24", border: "rgba(245,158,11,0.2)",   label: "Pausado"   },
  completed: { bg: "rgba(63,176,108,0.06)",  color: "#6b8a75", border: "rgba(63,176,108,0.1)",   label: "Concluido" },
};

function padH(h: number) { return `${String(h).padStart(2, "0")}:00`; }

function fmtBRL(v: number | null) {
  if (!v) return "-";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function trigLabel(offset: number, label: string | null): string {
  if (label) return label;
  if (offset < 0) return `${Math.abs(offset)} dias antes`;
  if (offset === 0) return "No dia do vencimento";
  return `${offset} dias depois`;
}

const db = supabase as any;

// ── Main ──────────────────────────────────────────────────────────────────────

export function AutomationDetail() {
  const { id }          = useParams<{ id: string }>();
  const navigate        = useNavigate();
  const { toast }       = useToast();
  const { workspaceId } = useAuth();
  const wsId            = workspaceId ?? "";

  const [rule,       setRule]       = useState<AutomationRule | null>(null);
  const [triggers,   setTriggers]   = useState<AutomationTrigger[]>([]);
  const [recipients, setRecipients] = useState<AutomationRecipient[]>([]);
  const [logs,       setLogs]       = useState<AutomationLog[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [logsLoading,setLogsLoading]= useState(false);
  const [acting,     setActing]     = useState(false);
  const [activeTab,  setActiveTab]  = useState<"overview"|"logs">("overview");
  const [logFilter,  setLogFilter]  = useState<"all"|"sent"|"failed">("all");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [ruleRes, trigRes, recRes] = await Promise.all([
      db.from("automation_rules").select("*").eq("id", id).single(),
      db.from("automation_triggers").select("*").eq("rule_id", id).order("day_offset"),
      db.from("automation_recipients").select("*").eq("rule_id", id).eq("removed", false).order("vencimento"),
    ]);
    if (ruleRes.error || !ruleRes.data) { navigate("/automations"); return; }
    setRule(ruleRes.data as AutomationRule);
    setTriggers((trigRes.data ?? []) as AutomationTrigger[]);
    setRecipients((recRes.data ?? []) as AutomationRecipient[]);
    setLoading(false);
  }, [id, navigate]);

  const fetchLogs = useCallback(async () => {
    if (!id) return;
    setLogsLoading(true);
    const q = db.from("automation_logs").select("*").eq("rule_id", id).order("sent_at", { ascending: false }).limit(200);
    const { data } = await q;
    setLogs((data ?? []) as AutomationLog[]);
    setLogsLoading(false);
  }, [id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { if (activeTab === "logs") fetchLogs(); }, [activeTab, fetchLogs]);

  async function handleToggleStatus() {
    if (!rule) return;
    const next = rule.status === "active" ? "paused" : "active";
    setActing(true);
    const { error } = await db.from("automation_rules")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", rule.id);
    if (error) {
      toast({ title: "Erro ao atualizar status", description: error.message, variant: "destructive" });
    } else {
      setRule((r) => r ? { ...r, status: next } : r);
      toast({ title: next === "active" ? "Regua ativada!" : "Regua pausada", variant: "success" });
    }
    setActing(false);
  }

  async function handleDelete() {
    if (!rule) return;
    setActing(true);
    const { error } = await db.from("automation_rules").delete().eq("id", rule.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      setActing(false);
    } else {
      toast({ title: "Regua excluida" });
      navigate("/automations");
    }
  }

  async function handleRemoveRecipient(recId: string) {
    setRemovingId(recId);
    await db.from("automation_recipients").update({ removed: true }).eq("id", recId);
    setRecipients((prev) => prev.filter((r) => r.id !== recId));
    setRemovingId(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a110e" }}>
        <Loader2 className="w-6 h-6 animate-spin text-agro-green" />
      </div>
    );
  }

  if (!rule) return null;

  const ss      = STATUS_STYLE[rule.status] ?? STATUS_STYLE.draft;
  const progress = rule.total_recipients > 0 ? Math.round((rule.sent_count / rule.total_recipients) * 100) : 0;
  const canToggle = rule.status === "active" || rule.status === "paused";
  const filteredLogs = logFilter === "all" ? logs : logs.filter((l) => l.status === logFilter);

  const OFFSET_C = (o: number) => o < 0 ? "#60a5fa" : o === 0 ? "#3fb06c" : "#f87171";

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[
        { label: "Automacoes", href: "/automations" },
        { label: rule.name },
      ]} />

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── Header card ── */}
        <div className="rounded-2xl p-6" style={{ background: "rgba(13,26,17,0.85)", border: "1px solid rgba(63,176,108,0.15)" }}>
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => navigate("/automations")} className="p-2 rounded-xl text-agro-muted hover:text-white transition-colors shrink-0" style={{ border: "1px solid rgba(63,176,108,0.12)" }}>
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-agro-text truncate">{rule.name}</h1>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                    style={{ background: ss.bg, color: ss.color, border: `1px solid ${ss.border}` }}>
                    {rule.status === "active" && <span className="inline-block w-1.5 h-1.5 rounded-full bg-agro-green mr-1 animate-pulse" />}
                    {ss.label}
                  </span>
                  <span className="text-xs text-agro-muted">{rule.channel === "z_api" ? "Z-API" : "Meta"}</span>
                  <span className="text-xs text-agro-muted flex items-center gap-1"><Clock className="w-3 h-3" />{padH(rule.send_hour)}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => navigate(`/automations/${rule.id}/edit`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:bg-white/5"
                style={{ color: "#7fc49a", border: "1px solid rgba(63,176,108,0.2)" }}>
                <Pencil className="w-3.5 h-3.5" /> Editar
              </button>
              {canToggle && (
                <button onClick={handleToggleStatus} disabled={acting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
                  style={{ color: rule.status === "active" ? "#fbbf24" : "#3fb06c", border: "1px solid rgba(63,176,108,0.2)" }}>
                  {rule.status === "active" ? <><Pause className="w-3.5 h-3.5" />Pausar</> : <><Play className="w-3.5 h-3.5" />Ativar</>}
                </button>
              )}
              <button onClick={() => setConfirmDel(true)} disabled={acting}
                className="p-2 rounded-xl text-agro-muted hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                style={{ border: "1px solid rgba(63,176,108,0.12)" }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: "Destinatarios", value: rule.total_recipients, icon: Users,  color: "#7fc49a" },
              { label: "Enviados",      value: rule.sent_count,       icon: Zap,    color: "#3fb06c" },
              { label: "Gatilhos",      value: triggers.length,       icon: GitBranch, color: "#60a5fa" },
              { label: "Progresso",     value: `${progress}%`,        icon: CheckCircle2, color: "#3fb06c" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="p-3 rounded-xl text-center" style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(63,176,108,0.08)" }}>
                <Icon className="w-4 h-4 mx-auto mb-1" style={{ color }} />
                <p className="text-lg font-bold" style={{ color }}>{value}</p>
                <p className="text-[10px] text-agro-muted">{label}</p>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          {rule.total_recipients > 0 && (
            <div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(63,176,108,0.1)" }}>
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progress}%`, background: "linear-gradient(90deg, #3fb06c, #16A34A)" }} />
              </div>
              <p className="text-[10px] text-agro-muted mt-1">{progress}% dos disparos concluidos</p>
            </div>
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1" style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
          {(["overview", "logs"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-4 py-2.5 text-xs font-semibold transition-colors -mb-px"
              style={activeTab === tab
                ? { color: "#3fb06c", borderBottom: "2px solid #3fb06c" }
                : { color: "#5a7a66" }}>
              {tab === "overview" ? "Visao Geral" : "Historico de Disparos"}
            </button>
          ))}
        </div>

        {/* ── Overview tab ── */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Triggers */}
            <div>
              <p className="text-[10px] font-bold text-agro-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                <CalendarDays className="w-3.5 h-3.5" /> Cadencia de Disparos
              </p>
              <div className="space-y-2">
                {triggers.length === 0 && <p className="text-xs text-agro-muted">Nenhum gatilho configurado.</p>}
                {triggers.map((t) => {
                  const c = OFFSET_C(t.day_offset);
                  return (
                    <div key={t.id} className="rounded-xl px-4 py-3 space-y-1"
                      style={{ background: "rgba(13,26,17,0.7)", border: `1px solid ${c}22`, opacity: t.enabled ? 1 : 0.45 }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                          style={{ background: `${c}18`, color: c, border: `1px solid ${c}40` }}>
                          {trigLabel(t.day_offset, t.label)}
                        </span>
                        {!t.enabled && <span className="text-[9px] text-agro-muted">(desativado)</span>}
                      </div>
                      {t.message_body && (
                        <p className="text-[11px] text-agro-muted leading-relaxed line-clamp-2">{t.message_body}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recipients */}
            <div>
              <p className="text-[10px] font-bold text-agro-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                <Users className="w-3.5 h-3.5" /> Destinatarios ({recipients.length})
              </p>
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
                <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
                  {recipients.length === 0 ? (
                    <div className="flex items-center justify-center h-24">
                      <p className="text-xs text-agro-muted">Nenhum destinatario ativo.</p>
                    </div>
                  ) : recipients.map((r, i) => {
                    const isVenc = r.vencimento < new Date().toISOString().slice(0, 10);
                    return (
                      <div key={r.id}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] group/row transition-colors"
                        style={{ borderBottom: i < recipients.length - 1 ? "1px solid rgba(63,176,108,0.05)" : "none" }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-agro-text truncate">{r.contact_name}</p>
                          <p className="text-[10px] text-agro-muted-2">{r.contact_phone}</p>
                        </div>
                        <div className="text-right shrink-0 hidden sm:block">
                          <p className="text-[11px] font-semibold text-agro-text">{fmtBRL(r.valor)}</p>
                          <p className="text-[10px]" style={{ color: isVenc ? "#f87171" : "#7fc49a" }}>
                            venc. {r.vencimento.slice(8,10)}/{r.vencimento.slice(5,7)}
                          </p>
                        </div>
                        <button
                          disabled={removingId === r.id}
                          onClick={() => handleRemoveRecipient(r.id)}
                          className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-all hover:bg-red-500/20 disabled:opacity-30"
                          style={{ border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
                          {removingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Logs tab ── */}
        {activeTab === "logs" && (
          <div className="space-y-4">
            {/* Filter */}
            <div className="flex items-center gap-2">
              {(["all", "sent", "failed"] as const).map((f) => (
                <button key={f} onClick={() => setLogFilter(f)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={logFilter === f
                    ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.35)" }
                    : { background: "rgba(0,0,0,0.2)", color: "#5a7a66", border: "1px solid rgba(63,176,108,0.1)" }}>
                  {f === "all" ? "Todos" : f === "sent" ? "Enviados" : "Falhas"}
                </button>
              ))}
              <span className="text-xs text-agro-muted ml-auto">{filteredLogs.length} registros</span>
            </div>

            {logsLoading ? (
              <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-agro-green" /></div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
                {/* Header */}
                <div className="grid px-4 py-2.5 text-[10px] font-bold text-agro-muted uppercase tracking-widest"
                  style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.1)",
                    gridTemplateColumns: "1fr 120px 100px 80px 80px" }}>
                  <span>Contato</span>
                  <span>Gatilho</span>
                  <span>Data</span>
                  <span className="text-center">Canal</span>
                  <span className="text-center">Status</span>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
                  {filteredLogs.length === 0 ? (
                    <div className="flex items-center justify-center h-24">
                      <p className="text-xs text-agro-muted">Nenhum registro encontrado.</p>
                    </div>
                  ) : filteredLogs.map((l, i) => {
                    const t = triggers.find((tr) => tr.id === l.trigger_id);
                    const isFail = l.status === "failed";
                    return (
                      <div key={l.id}
                        className="grid items-center px-4 py-2.5"
                        style={{ gridTemplateColumns: "1fr 120px 100px 80px 80px",
                          borderBottom: i < filteredLogs.length - 1 ? "1px solid rgba(63,176,108,0.05)" : "none",
                          background: isFail ? "rgba(239,68,68,0.02)" : undefined }}>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-agro-text truncate">{l.contact_name ?? "-"}</p>
                          <p className="text-[10px] text-agro-muted-2 truncate">{l.contact_phone ?? "-"}</p>
                          {isFail && l.error_message && (
                            <p className="text-[10px] text-red-400 truncate mt-0.5">{l.error_message}</p>
                          )}
                        </div>
                        <div>
                          {t ? (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                              style={{ background: `${OFFSET_C(t.day_offset)}18`, color: OFFSET_C(t.day_offset), border: `1px solid ${OFFSET_C(t.day_offset)}35` }}>
                              {trigLabel(t.day_offset, t.label)}
                            </span>
                          ) : <span className="text-[10px] text-agro-muted-2">-</span>}
                        </div>
                        <p className="text-[10px] text-agro-muted-2">{fmtDate(l.sent_at)}</p>
                        <p className="text-[10px] text-agro-muted text-center uppercase">{l.channel ?? "-"}</p>
                        <div className="flex justify-center">
                          {isFail
                            ? <XCircle className="w-4 h-4" style={{ color: "#f87171" }} />
                            : <CheckCircle2 className="w-4 h-4" style={{ color: "#3fb06c" }} />
                          }
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={() => setConfirmDel(false)}>
          <div className="rounded-2xl p-6 max-w-sm w-full space-y-4"
            style={{ background: "rgba(13,26,17,0.95)", border: "1px solid rgba(239,68,68,0.3)" }}
            onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-agro-text">Excluir regua?</p>
            <p className="text-sm text-agro-muted">Esta acao nao pode ser desfeita. Todos os gatilhos, destinatarios e logs serao removidos.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDel(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-agro-muted-2 hover:text-agro-text transition-colors"
                style={{ border: "1px solid rgba(63,176,108,0.2)" }}>
                Cancelar
              </button>
              <button onClick={handleDelete} disabled={acting}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500/80 hover:bg-red-500 transition-colors disabled:opacity-50">
                {acting ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
