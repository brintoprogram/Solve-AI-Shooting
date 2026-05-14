import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, Zap, Clock, Users, CheckCircle, XCircle,
  Pause, Play, RefreshCw, TrendingUp, Send, AlertCircle,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AutomationRule, AutomationTrigger, AutomationRecipient, AutomationLog } from "@/types/automations";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  draft:     { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "rgba(107,114,128,0.2)",  label: "Rascunho"  },
  active:    { bg: "rgba(63,176,108,0.1)",   color: "#3fb06c", border: "rgba(63,176,108,0.2)",   label: "Ativo"     },
  paused:    { bg: "rgba(245,158,11,0.1)",   color: "#fbbf24", border: "rgba(245,158,11,0.2)",   label: "Pausado"   },
  completed: { bg: "rgba(63,176,108,0.08)",  color: "#6b8a75", border: "rgba(63,176,108,0.12)",  label: "Concluído" },
};

function padHour(h: number) { return `${String(h).padStart(2, "0")}:00`; }
function formatDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("T")[0].split("-");
  return `${d}/${m}/${y}`;
}
function formatDatetime(iso: string): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  return dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatBRL(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ── Trigger funnel stats ────────────────────────────────────────────────────────
interface TriggerStats {
  trigger:  AutomationTrigger;
  sent:     number;
  failed:   number;
  paid:     number;
}

// ── Per-trigger funnel card ────────────────────────────────────────────────────
function FunnelCard({ stats }: { stats: TriggerStats }) {
  const total = stats.sent + stats.failed;
  const sentPct  = total > 0 ? (stats.sent  / total) * 100 : 0;
  const paidPct  = stats.sent > 0 ? (stats.paid / stats.sent) * 100 : 0;

  const { trigger: t } = stats;
  const isEnabled = t.enabled;

  return (
    <div className="rounded-2xl overflow-hidden transition-all duration-200"
      style={{
        background: "rgba(13,26,17,0.8)",
        border: `1px solid ${isEnabled ? "rgba(63,176,108,0.15)" : "rgba(63,176,108,0.06)"}`,
        opacity: isEnabled ? 1 : 0.55,
      }}>
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(63,176,108,0.07)", background: "rgba(63,176,108,0.03)" }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: isEnabled ? "#3fb06c" : "#6b8a75" }} />
          <span className="text-sm font-semibold text-agro-text">{t.label}</span>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded"
          style={{ background: isEnabled ? "rgba(63,176,108,0.1)" : "rgba(255,255,255,0.04)", color: isEnabled ? "#3fb06c" : "#6b8a75" }}>
          {isEnabled ? "ativo" : "inativo"}
        </span>
      </div>

      {/* Funnel metrics */}
      <div className="p-5 space-y-3">
        {/* Enviado bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-agro-muted-2 flex items-center gap-1 uppercase tracking-wider">
              <Send className="w-3 h-3" /> Enviados
            </span>
            <span className="text-xs font-bold text-agro-text">{stats.sent}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(63,176,108,0.1)" }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${sentPct}%`, background: "linear-gradient(90deg, #3fb06c, #16A34A)" }} />
          </div>
        </div>

        {/* Falhas */}
        {stats.failed > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-red-400/70 flex items-center gap-1 uppercase tracking-wider">
                <AlertCircle className="w-3 h-3" /> Falhas
              </span>
              <span className="text-xs font-bold text-red-400">{stats.failed}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(239,68,68,0.1)" }}>
              <div className="h-full rounded-full"
                style={{ width: `${total > 0 ? (stats.failed / total) * 100 : 0}%`, background: "linear-gradient(90deg, #f87171, #ef4444)" }} />
            </div>
          </div>
        )}

        {/* Pagamentos (conversão) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold flex items-center gap-1 uppercase tracking-wider"
              style={{ color: paidPct > 0 ? "#fbbf24" : "#4a6859" }}>
              <TrendingUp className="w-3 h-3" /> Pagaram depois
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold" style={{ color: paidPct > 0 ? "#fbbf24" : "#4a6859" }}>{stats.paid}</span>
              {stats.sent > 0 && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: paidPct > 0 ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.04)", color: paidPct > 0 ? "#fbbf24" : "#4a6859" }}>
                  {paidPct.toFixed(0)}%
                </span>
              )}
            </div>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(251,191,36,0.1)" }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${paidPct}%`, background: "linear-gradient(90deg, #fbbf24, #f59e0b)" }} />
          </div>
        </div>

        {total === 0 && (
          <p className="text-[11px] text-agro-muted text-center py-2">Nenhum disparo ainda</p>
        )}
      </div>
    </div>
  );
}

// ── Timeline in detail view ─────────────────────────────────────────────────────
function TriggerTimeline({ triggers }: { triggers: AutomationTrigger[] }) {
  if (triggers.length === 0) return null;

  const offsets    = triggers.map((t) => t.day_offset);
  const allOffsets = [...new Set([...offsets, 0])].sort((a, b) => a - b);
  const minOff     = allOffsets[0];
  const maxOff     = allOffsets[allOffsets.length - 1];
  const range      = maxOff - minOff || 1;

  function toPercent(off: number) {
    return 10 + ((off - minOff) / range) * 80;
  }

  const vencimentoPct = toPercent(0);

  return (
    <div className="rounded-2xl py-10 px-6 relative overflow-visible"
      style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}>
      <div className="relative h-0.5 mx-2"
        style={{ background: "linear-gradient(90deg, rgba(63,176,108,0.06), rgba(63,176,108,0.22), rgba(63,176,108,0.06))" }}>
        <span className="absolute -top-5 left-0 text-[9px] text-agro-muted tracking-widest uppercase">Antes</span>
        <span className="absolute -top-5 right-0 text-[9px] text-agro-muted tracking-widest uppercase">Depois</span>

        {/* Vencimento anchor */}
        <div className="absolute flex flex-col items-center" style={{ left: `${vencimentoPct}%`, transform: "translateX(-50%)", top: -28 }}>
          <div className="px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase mb-1"
            style={{ background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }}>
            Vencimento
          </div>
          <div className="w-px h-8" style={{ background: "linear-gradient(180deg, rgba(63,176,108,0.5), transparent)" }} />
        </div>

        {/* Trigger dots */}
        {triggers.map((t) => {
          const pct = toPercent(t.day_offset);
          return (
            <div key={t.id} className="absolute flex flex-col items-center"
              style={{ left: `${pct}%`, transform: "translateX(-50%)", top: -8 }}>
              <div className="w-4 h-4 rounded-full border-2 transition-all"
                style={{
                  background: t.enabled ? "rgba(63,176,108,0.2)" : "rgba(107,114,128,0.2)",
                  borderColor: t.enabled ? "#3fb06c" : "#6b7280",
                  boxShadow: t.enabled ? "0 0 8px rgba(63,176,108,0.4)" : "none",
                }} />
              <div className="mt-2 text-[9px] font-semibold whitespace-nowrap text-center max-w-[60px] leading-tight"
                style={{ color: t.enabled ? "#7fc49a" : "#4a6859" }}>
                {t.day_offset === 0 ? "Vence" : t.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────
export function AutomationDetail() {
  const { id }          = useParams<{ id: string }>();
  const navigate        = useNavigate();
  const { toast }       = useToast();
  const { workspaceId } = useAuth();

  const [rule,       setRule]       = useState<AutomationRule | null>(null);
  const [triggers,   setTriggers]   = useState<AutomationTrigger[]>([]);
  const [recipients, setRecipients] = useState<AutomationRecipient[]>([]);
  const [logs,       setLogs]       = useState<AutomationLog[]>([]);
  const [paidIds,    setPaidIds]    = useState<Set<string>>(new Set());
  const [loading,    setLoading]    = useState(true);
  const [logFilter,  setLogFilter]  = useState<"" | "sent" | "failed">("");
  const [toggling,   setToggling]   = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const [ruleRes, trigRes, recRes, logRes] = await Promise.all([
      db.from("automation_rules").select("*").eq("id", id).single(),
      db.from("automation_triggers").select("*").eq("rule_id", id).order("day_offset"),
      db.from("automation_recipients").select("*").eq("rule_id", id).eq("removed", false).order("vencimento"),
      db.from("automation_logs").select("*").eq("rule_id", id).order("sent_at", { ascending: false }).limit(500),
    ]);

    setRule(ruleRes.data ?? null);
    setTriggers(trigRes.data ?? []);
    setRecipients(recRes.data ?? []);
    setLogs(logRes.data ?? []);

    // Fetch paid invoice IDs — invoices that were in this rule and are now paid
    const recData: AutomationRecipient[] = recRes.data ?? [];
    const invoiceIds = recData.map((r) => r.invoice_id).filter(Boolean) as string[];
    if (invoiceIds.length > 0) {
      const PAID_STATUSES = ["pago", "paid", "liquidado", "cancelado"];
      const { data: paidInvoices } = await db
        .from("contact_invoices")
        .select("id")
        .in("id", invoiceIds)
        .in("status", PAID_STATUSES);
      setPaidIds(new Set((paidInvoices ?? []).map((inv: { id: string }) => inv.id)));
    } else {
      setPaidIds(new Set());
    }

    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function toggleStatus() {
    if (!rule) return;
    const next = rule.status === "active" ? "paused" : "active";
    setToggling(true);
    const { error } = await db
      .from("automation_rules")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", rule.id);
    if (error) {
      toast({ title: "Erro ao atualizar status", variant: "destructive" });
    } else {
      setRule({ ...rule, status: next });
      toast({ title: next === "active" ? "Régua ativada!" : "Régua pausada", variant: "success" });
    }
    setToggling(false);
  }

  async function removeRecipient(recipientId: string) {
    const { data, error } = await db
      .from("automation_recipients")
      .update({ removed: true })
      .eq("id", recipientId)
      .select("id");
    if (error || !data?.length) {
      toast({ title: "Erro ao remover destinatário", description: error?.message ?? "Nenhuma linha afetada.", variant: "destructive" });
    } else {
      setRecipients((prev) => prev.filter((r) => r.id !== recipientId));
      toast({ title: "Destinatário removido", variant: "success" });
    }
  }

  // ── Compute funnel per trigger ──
  const triggerStats: TriggerStats[] = triggers.map((trig) => {
    const trigLogs = logs.filter((l) => l.trigger_id === trig.id);
    const sent     = trigLogs.filter((l) => l.status === "sent").length;
    const failed   = trigLogs.filter((l) => l.status === "failed").length;
    // Paid: recipients whose invoice is now paid AND had a "sent" log for this trigger
    const sentRecipientIds = new Set(trigLogs.filter((l) => l.status === "sent").map((l) => l.recipient_id));
    const paid = recipients.filter((r) =>
      r.invoice_id && paidIds.has(r.invoice_id) && sentRecipientIds.has(r.id)
    ).length;
    return { trigger: trig, sent, failed, paid };
  });

  const totalSent   = triggerStats.reduce((s, t) => s + t.sent,   0);
  const totalFailed = triggerStats.reduce((s, t) => s + t.failed, 0);
  const totalPaid   = triggerStats.reduce((s, t) => s + t.paid,   0);
  const convRate    = totalSent > 0 ? ((totalPaid / totalSent) * 100).toFixed(0) : "0";

  const filteredLogs = logFilter ? logs.filter((l) => l.status === logFilter) : logs;

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: "#0a110e" }}>
        <Topbar breadcrumbs={[{ label: "Automações", href: "/automations" }, { label: "…" }]} />
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-agro-green/30 border-t-agro-green rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!rule) {
    return (
      <div className="min-h-screen" style={{ background: "#0a110e" }}>
        <Topbar breadcrumbs={[{ label: "Automações", href: "/automations" }, { label: "Não encontrado" }]} />
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-agro-muted">Régua não encontrada.</p>
          <button onClick={() => navigate("/automations")} className="btn-agro px-4 py-2 rounded-xl text-sm">Voltar</button>
        </div>
      </div>
    );
  }

  const statusStyle = STATUS_STYLE[rule.status] ?? STATUS_STYLE.draft;
  const canToggle   = rule.status === "active" || rule.status === "paused";
  const progress    = rule.total_recipients > 0 ? Math.round((rule.sent_count / rule.total_recipients) * 100) : 0;

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Automações", href: "/automations" }, { label: rule.name }]} />

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── Header card ── */}
        <div className="rounded-2xl px-6 py-5"
          style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.12)" }}>
          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={() => navigate("/automations")}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors shrink-0"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-display text-xl font-semibold text-agro-text truncate">{rule.name}</h1>
                <span className="shrink-0 px-2.5 py-0.5 rounded-full text-xs font-semibold"
                  style={{ background: statusStyle.bg, color: statusStyle.color, border: `1px solid ${statusStyle.border}` }}>
                  {statusStyle.label}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-1 flex-wrap">
                <span className="text-xs text-agro-muted flex items-center gap-1"><Zap className="w-3 h-3" /> {rule.channel === "z_api" ? "Z-API" : "Meta"}</span>
                <span className="text-xs text-agro-muted flex items-center gap-1"><Clock className="w-3 h-3" /> {padHour(rule.send_hour)}</span>
                <span className="text-xs text-agro-muted flex items-center gap-1"><Users className="w-3 h-3" /> {recipients.length} destinatários</span>
                <span className="text-xs text-agro-muted">{rule.sent_count} / {rule.total_recipients} disparos</span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button onClick={load} className="w-9 h-9 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors"
                style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
                <RefreshCw className="w-4 h-4" />
              </button>
              {canToggle && (
                <button onClick={toggleStatus} disabled={toggling}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                  style={rule.status === "active"
                    ? { background: "rgba(245,158,11,0.1)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.3)" }
                    : { background: "rgba(63,176,108,0.1)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }}>
                  {rule.status === "active" ? <><Pause className="w-4 h-4" /> Pausar</> : <><Play className="w-4 h-4" /> Ativar</>}
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {rule.total_recipients > 0 && (
            <div className="mt-4">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(63,176,108,0.1)" }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${progress}%`, background: "linear-gradient(90deg, #3fb06c, #16A34A)" }} />
              </div>
              <p className="text-[10px] text-agro-muted mt-1">{progress}% concluído</p>
            </div>
          )}
        </div>

        {/* ── Conversion summary strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Enviados",    value: totalSent,   color: "#3fb06c",  sub: "disparos"  },
            { label: "Falhas",      value: totalFailed, color: "#f87171",  sub: "erros"     },
            { label: "Pagamentos",  value: totalPaid,   color: "#fbbf24",  sub: "convertidos" },
            { label: "Taxa conv.",  value: `${convRate}%`, color: Number(convRate) > 0 ? "#fbbf24" : "#4a6859", sub: "dos enviados" },
          ].map(({ label, value, color, sub }) => (
            <div key={label} className="rounded-xl p-4 text-center"
              style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}>
              <p className="text-xl font-bold" style={{ color }}>{value}</p>
              <p className="text-[10px] font-semibold text-agro-muted-2 mt-0.5">{label}</p>
              <p className="text-[9px] text-agro-muted mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        {/* ── Timeline visual ── */}
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.12)" }}>
          <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
            <p className="text-sm font-semibold text-agro-text">Cadência de disparos</p>
          </div>
          <div className="px-4 py-2">
            <TriggerTimeline triggers={triggers} />
          </div>
        </div>

        {/* ── Funnel per trigger ── */}
        {triggerStats.length > 0 && (
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.12)" }}>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              <p className="text-sm font-semibold text-agro-text">Funil por gatilho</p>
              <p className="text-[11px] text-agro-muted mt-0.5">Acompanhe o desempenho de cada ponto da régua</p>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {triggerStats.map((s) => <FunnelCard key={s.trigger.id} stats={s} />)}
            </div>
          </div>
        )}

        {/* ── Recipients + Logs in two-col ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recipients */}
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.12)" }}>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              <p className="text-sm font-semibold text-agro-text">Destinatários ({recipients.length})</p>
            </div>
            <div className="overflow-auto max-h-64">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
                    <th className="px-4 py-2 text-left text-agro-muted-2 font-semibold uppercase tracking-wider">Nome</th>
                    <th className="px-4 py-2 text-left text-agro-muted-2 font-semibold uppercase tracking-wider">Vencimento</th>
                    <th className="px-4 py-2 text-left text-agro-muted-2 font-semibold uppercase tracking-wider">Valor</th>
                    <th className="px-4 py-2 text-right text-agro-muted-2 font-semibold uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-agro-muted">Sem destinatários</td></tr>
                  )}
                  {recipients.map((r, i) => {
                    const isPaid = r.invoice_id ? paidIds.has(r.invoice_id) : false;
                    return (
                      <tr key={r.id} style={{ borderBottom: i < recipients.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none" }}>
                        <td className="px-4 py-2 text-agro-text font-medium">
                          <div className="flex items-center gap-1.5">
                            {isPaid && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Boleto pago" />}
                            {r.contact_name}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-agro-muted">{formatDate(r.vencimento)}</td>
                        <td className="px-4 py-2 text-agro-muted">{formatBRL(r.valor)}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => removeRecipient(r.id)}
                            className="text-agro-muted hover:text-red-400 transition-colors text-[10px] font-semibold px-2 py-0.5 rounded"
                            style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                            remover
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick log summary */}
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.12)" }}>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              <p className="text-sm font-semibold text-agro-text">Últimos disparos</p>
            </div>
            <div className="divide-y" style={{ borderColor: "rgba(63,176,108,0.06)" }}>
              {logs.slice(0, 8).length === 0 && (
                <p className="px-5 py-8 text-xs text-agro-muted text-center">Nenhum disparo registrado</p>
              )}
              {logs.slice(0, 8).map((l) => (
                <div key={l.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-agro-text truncate">{l.contact_name}</p>
                    <p className="text-[10px] text-agro-muted mt-0.5">{l.day_offset != null ? (l.day_offset === 0 ? "No dia" : l.day_offset < 0 ? `${Math.abs(l.day_offset)}d antes` : `${l.day_offset}d depois`) : "—"}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-agro-muted">{formatDatetime(l.sent_at ?? l.created_at)}</span>
                    {l.status === "sent"
                      ? <CheckCircle className="w-3.5 h-3.5 text-agro-green" />
                      : <XCircle    className="w-3.5 h-3.5 text-red-400" />
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Full logs table ── */}
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.12)" }}>
          <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
            <p className="text-sm font-semibold text-agro-text">Histórico completo ({filteredLogs.length})</p>
            <div className="flex items-center gap-2">
              {(["", "sent", "failed"] as const).map((f) => (
                <button key={f} onClick={() => setLogFilter(f)}
                  className={cn("px-3 py-1 rounded-lg text-xs font-semibold transition-colors",
                    logFilter === f ? "text-agro-green" : "text-agro-muted-2 hover:text-agro-text")}
                  style={{ border: `1px solid ${logFilter === f ? "rgba(63,176,108,0.4)" : "rgba(63,176,108,0.1)"}`, background: logFilter === f ? "rgba(63,176,108,0.08)" : "transparent" }}>
                  {f === "" ? "Todos" : f === "sent" ? "Enviados" : "Falhas"}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
                  <th className="px-4 py-3 text-left text-agro-muted-2 font-semibold uppercase tracking-wider">Data/Hora</th>
                  <th className="px-4 py-3 text-left text-agro-muted-2 font-semibold uppercase tracking-wider">Contato</th>
                  <th className="px-4 py-3 text-left text-agro-muted-2 font-semibold uppercase tracking-wider">Gatilho</th>
                  <th className="px-4 py-3 text-left text-agro-muted-2 font-semibold uppercase tracking-wider">Canal</th>
                  <th className="px-4 py-3 text-left text-agro-muted-2 font-semibold uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-agro-muted-2 font-semibold uppercase tracking-wider">Erro</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-agro-muted">
                    {logs.length === 0 ? "Nenhum disparo registrado ainda." : "Sem registros para o filtro."}
                  </td></tr>
                )}
                {filteredLogs.map((l, i) => (
                  <tr key={l.id} style={{ borderBottom: i < filteredLogs.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none" }}>
                    <td className="px-4 py-2.5 text-agro-muted whitespace-nowrap">{formatDatetime(l.sent_at ?? l.created_at)}</td>
                    <td className="px-4 py-2.5 text-agro-text font-medium">{l.contact_name}</td>
                    <td className="px-4 py-2.5 text-agro-muted">
                      {l.day_offset != null
                        ? l.day_offset === 0 ? "No dia" : l.day_offset < 0 ? `${Math.abs(l.day_offset)}d antes` : `${l.day_offset}d depois`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-agro-muted uppercase">{l.channel ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {l.status === "sent"
                        ? <span className="flex items-center gap-1 text-agro-green font-semibold"><CheckCircle className="w-3 h-3" /> enviado</span>
                        : <span className="flex items-center gap-1 text-red-400 font-semibold"><XCircle className="w-3 h-3" /> falha</span>}
                    </td>
                    <td className="px-4 py-2.5 text-red-400 max-w-[200px] truncate">{l.error_message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
