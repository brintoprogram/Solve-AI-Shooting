import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Zap, Clock, Users, CheckCircle, XCircle, Pause, Play, RefreshCw } from "lucide-react";
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
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AutomationDetail() {
  const { id }         = useParams<{ id: string }>();
  const navigate       = useNavigate();
  const { toast }      = useToast();
  const { workspaceId } = useAuth();

  const [rule,      setRule]      = useState<AutomationRule | null>(null);
  const [triggers,  setTriggers]  = useState<AutomationTrigger[]>([]);
  const [recipients, setRecipients] = useState<AutomationRecipient[]>([]);
  const [logs,      setLogs]      = useState<AutomationLog[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [logFilter, setLogFilter] = useState<"" | "sent" | "failed">("");
  const [toggling,  setToggling]  = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [ruleRes, trigRes, recRes, logRes] = await Promise.all([
      db.from("automation_rules").select("*").eq("id", id).single(),
      db.from("automation_triggers").select("*").eq("rule_id", id).order("day_offset"),
      db.from("automation_recipients").select("*").eq("rule_id", id).eq("removed", false).order("vencimento"),
      db.from("automation_logs").select("*").eq("rule_id", id).order("sent_at", { ascending: false }).limit(200),
    ]);
    setRule(ruleRes.data ?? null);
    setTriggers(trigRes.data ?? []);
    setRecipients(recRes.data ?? []);
    setLogs(logRes.data ?? []);
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
    const { error } = await db
      .from("automation_recipients")
      .update({ removed: true })
      .eq("id", recipientId);
    if (!error) setRecipients((prev) => prev.filter((r) => r.id !== recipientId));
    else toast({ title: "Erro ao remover destinatário", variant: "destructive" });
  }

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
          <button onClick={() => navigate("/automations")} className="btn-agro px-4 py-2 rounded-xl text-sm">
            Voltar
          </button>
        </div>
      </div>
    );
  }

  const statusStyle = STATUS_STYLE[rule.status] ?? STATUS_STYLE.draft;
  const canToggle   = rule.status === "active" || rule.status === "paused";

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Automações", href: "/automations" }, { label: rule.name }]} />

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Header card */}
        <div className="rounded-2xl px-6 py-5 flex items-center gap-4"
          style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.12)" }}>
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
              <span className="text-xs text-agro-muted flex items-center gap-1">
                <Zap className="w-3 h-3" /> {rule.channel === "z_api" ? "Z-API" : "Meta"}
              </span>
              <span className="text-xs text-agro-muted flex items-center gap-1">
                <Clock className="w-3 h-3" /> {padHour(rule.send_hour)}
              </span>
              <span className="text-xs text-agro-muted flex items-center gap-1">
                <Users className="w-3 h-3" /> {recipients.length} destinatários
              </span>
              <span className="text-xs text-agro-muted">
                {rule.sent_count} / {rule.total_recipients} enviados
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button onClick={load} className="w-9 h-9 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
            {canToggle && (
              <button
                onClick={toggleStatus}
                disabled={toggling}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                style={rule.status === "active"
                  ? { background: "rgba(245,158,11,0.1)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.3)" }
                  : { background: "rgba(63,176,108,0.1)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }}>
                {rule.status === "active"
                  ? <><Pause className="w-4 h-4" /> Pausar</>
                  : <><Play  className="w-4 h-4" /> Ativar</>}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Triggers */}
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.12)" }}>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              <p className="text-sm font-semibold text-agro-text">Gatilhos ({triggers.filter((t) => t.enabled).length} ativos)</p>
            </div>
            <div className="p-4 space-y-2">
              {triggers.length === 0 && <p className="text-xs text-agro-muted text-center py-4">Sem gatilhos</p>}
              {triggers.map((t) => (
                <div key={t.id}
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                  style={{ background: "rgba(13,26,17,0.6)", border: `1px solid ${t.enabled ? "rgba(63,176,108,0.15)" : "rgba(63,176,108,0.05)"}`, opacity: t.enabled ? 1 : 0.5 }}>
                  <span className="text-sm text-agro-text font-medium">{t.label}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded font-medium"
                    style={{ background: t.enabled ? "rgba(63,176,108,0.1)" : "rgba(255,255,255,0.05)", color: t.enabled ? "#3fb06c" : "#6b8a75" }}>
                    {t.enabled ? "ativo" : "inativo"}
                  </span>
                </div>
              ))}
            </div>
          </div>

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
                    <th className="px-4 py-2 text-right text-agro-muted-2 font-semibold uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-agro-muted">Sem destinatários</td></tr>
                  )}
                  {recipients.map((r, i) => (
                    <tr key={r.id} style={{ borderBottom: i < recipients.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none" }}>
                      <td className="px-4 py-2 text-agro-text font-medium">{r.contact_name}</td>
                      <td className="px-4 py-2 text-agro-muted">{formatDate(r.vencimento)}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => removeRecipient(r.id)}
                          className="text-agro-muted hover:text-red-400 transition-colors text-[10px] font-semibold px-2 py-0.5 rounded"
                          style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                          remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Logs */}
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.12)" }}>
          <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
            <p className="text-sm font-semibold text-agro-text">Histórico de disparos ({filteredLogs.length})</p>
            <div className="flex items-center gap-2">
              {(["", "sent", "failed"] as const).map((f) => (
                <button key={f}
                  onClick={() => setLogFilter(f)}
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
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-agro-muted">
                      {logs.length === 0 ? "Nenhum disparo registrado ainda." : "Sem registros para o filtro selecionado."}
                    </td>
                  </tr>
                )}
                {filteredLogs.map((l, i) => (
                  <tr key={l.id}
                    style={{ borderBottom: i < filteredLogs.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none" }}>
                    <td className="px-4 py-2.5 text-agro-muted whitespace-nowrap">{formatDatetime(l.sent_at ?? l.created_at)}</td>
                    <td className="px-4 py-2.5 text-agro-text font-medium">{l.contact_name}</td>
                    <td className="px-4 py-2.5 text-agro-muted">{l.day_offset != null ? (l.day_offset === 0 ? "No dia" : l.day_offset < 0 ? `${Math.abs(l.day_offset)}d antes` : `${l.day_offset}d depois`) : "—"}</td>
                    <td className="px-4 py-2.5 text-agro-muted uppercase">{l.channel ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {l.status === "sent" ? (
                        <span className="flex items-center gap-1 text-agro-green font-semibold">
                          <CheckCircle className="w-3 h-3" /> enviado
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 font-semibold">
                          <XCircle className="w-3 h-3" /> falha
                        </span>
                      )}
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
