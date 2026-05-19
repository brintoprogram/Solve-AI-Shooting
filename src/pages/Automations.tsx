import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Zap, Clock, Users, ChevronRight, Pause, Play, Trash2, RefreshCw,
  ChevronDown, ChevronUp, CalendarDays, X, Loader2, Sparkles,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { useAutomationRules } from "@/hooks/useAutomationRules";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import type { AutomationRule, AutomationTrigger, AutomationRecipient } from "@/types/automations";

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  draft:     { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "rgba(107,114,128,0.2)",  label: "Rascunho"  },
  active:    { bg: "rgba(63,176,108,0.1)",   color: "#3fb06c", border: "rgba(63,176,108,0.2)",   label: "Ativo"     },
  paused:    { bg: "rgba(245,158,11,0.1)",   color: "#fbbf24", border: "rgba(245,158,11,0.2)",   label: "Pausado"   },
  completed: { bg: "rgba(63,176,108,0.06)",  color: "#6b8a75", border: "rgba(63,176,108,0.1)",   label: "Concluído" },
};

function padHour(h: number) { return `${String(h).padStart(2, "0")}:00`; }

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatFireDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  return `${String(d).padStart(2, "0")} de ${months[m - 1]}. ${y}`;
}

function formatBRL(v: number | null): string {
  if (!v) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function resolveTriggerLabel(t: AutomationTrigger): string {
  if (t.label) return t.label;
  if (t.day_offset < 0) return `${Math.abs(t.day_offset)}d antes`;
  if (t.day_offset === 0) return "No dia";
  return `+${t.day_offset}d depois`;
}

/** Returns "em Xh Ym" or "em menos de 1 min" until the next HH:00 UTC that matches send_hour. */
function nextFireCountdown(sendHour: number): string {
  const now   = new Date();
  const nowH  = now.getUTCHours();
  const nowM  = now.getUTCMinutes();
  const nowS  = now.getUTCSeconds();
  let hoursUntil = sendHour - nowH;
  if (hoursUntil < 0) hoursUntil += 24;
  if (hoursUntil === 0 && (nowM > 0 || nowS > 0)) hoursUntil = 24;
  const totalMins = hoursUntil * 60 - nowM;
  if (totalMins < 1) return "menos de 1 min";
  if (totalMins < 60) return `${totalMins} min`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ── Live countdown hook ──────────────────────────────────────────────────────
function useCountdown(sendHour: number, active: boolean) {
  const [label, setLabel] = useState(() => nextFireCountdown(sendHour));
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setLabel(nextFireCountdown(sendHour)), 30_000);
    return () => clearInterval(id);
  }, [sendHour, active]);
  return label;
}

// ── Schedule types ───────────────────────────────────────────────────────────
interface UpcomingEntry {
  trigger:      AutomationTrigger;
  recipient:    AutomationRecipient;
  fireDate:     string;
  triggerLabel: string;
}

interface FireGroup {
  date:    string;
  entries: UpcomingEntry[];
}

interface ScheduleData {
  groups:     FireGroup[];
  totalCount: number;
}

// ── Schedule loader ──────────────────────────────────────────────────────────
async function loadRuleSchedule(ruleId: string): Promise<ScheduleData> {
  const today = todayISO();

  const [{ data: triggers }, { data: recipients }, { data: logs }] = await Promise.all([
    supabase
      .from("automation_triggers")
      .select("*")
      .eq("rule_id", ruleId)
      .eq("enabled", true),
    supabase
      .from("automation_recipients")
      .select("*")
      .eq("rule_id", ruleId)
      .eq("removed", false),
    supabase
      .from("automation_logs")
      .select("trigger_id, recipient_id")
      .eq("rule_id", ruleId)
      .eq("status", "sent"),
  ]);

  const sentSet = new Set<string>(
    (logs ?? []).map((l: { trigger_id: string | null; recipient_id: string | null }) =>
      `${l.trigger_id}:${l.recipient_id}`
    )
  );

  const entries: UpcomingEntry[] = [];

  for (const t of (triggers ?? []) as AutomationTrigger[]) {
    for (const r of (recipients ?? []) as AutomationRecipient[]) {
      const fireDate = addDays(r.vencimento, t.day_offset);
      if (fireDate < today) continue;
      if (sentSet.has(`${t.id}:${r.id}`)) continue;
      entries.push({ trigger: t, recipient: r, fireDate, triggerLabel: resolveTriggerLabel(t) });
    }
  }

  entries.sort((a, b) => a.fireDate.localeCompare(b.fireDate) || a.recipient.contact_name.localeCompare(b.recipient.contact_name));

  const grouped = new Map<string, UpcomingEntry[]>();
  for (const e of entries) {
    const arr = grouped.get(e.fireDate) ?? [];
    arr.push(e);
    grouped.set(e.fireDate, arr);
  }

  const groups: FireGroup[] = Array.from(grouped.entries()).map(([date, ents]) => ({ date, entries: ents }));
  return { groups, totalCount: entries.length };
}

// ── Rule card ────────────────────────────────────────────────────────────────
interface RuleCardProps {
  rule:     AutomationRule;
  acting:   string | null;
  onToggle: (rule: AutomationRule) => void;
  onDelete: (id: string) => void;
  onNav:    (id: string) => void;
}

function RuleCard({ rule, acting, onToggle, onDelete, onNav }: RuleCardProps) {
  const statusStyle = STATUS_STYLE[rule.status] ?? STATUS_STYLE.draft;
  const canToggle   = rule.status === "active" || rule.status === "paused";
  const isActing    = acting === rule.id;
  const isActive    = rule.status === "active";

  const countdown = useCountdown(rule.send_hour, isActive);

  // sent_count = total message dispatches (triggers × recipients), so never divide for %
  const progressBar = rule.total_recipients > 0 && rule.sent_count > 0
    ? Math.min(100, Math.round((rule.sent_count / rule.total_recipients) * 100))
    : 0;

  // ── Schedule panel state ─────────────────────────────────────────────────
  const [expanded,    setExpanded]    = useState(false);
  const [schedule,    setSchedule]    = useState<ScheduleData | null>(null);
  const [schedLoading, setSchedLoading] = useState(false);
  const [removingId,  setRemovingId]  = useState<string | null>(null);

  async function handleToggleSchedule(e: React.MouseEvent) {
    e.stopPropagation();
    if (!expanded) {
      setExpanded(true);
      if (!schedule) {
        setSchedLoading(true);
        const data = await loadRuleSchedule(rule.id);
        setSchedule(data);
        setSchedLoading(false);
      }
    } else {
      setExpanded(false);
    }
  }

  async function handleRemove(e: React.MouseEvent, recipientId: string) {
    e.stopPropagation();
    setRemovingId(recipientId);
    await supabase
      .from("automation_recipients")
      .update({ removed: true })
      .eq("id", recipientId);
    setSchedule((prev) => {
      if (!prev) return prev;
      const groups = prev.groups
        .map((g) => ({ ...g, entries: g.entries.filter((en) => en.recipient.id !== recipientId) }))
        .filter((g) => g.entries.length > 0);
      return { groups, totalCount: prev.totalCount - 1 };
    });
    setRemovingId(null);
  }

  const pendingCount = schedule?.totalCount ?? null;

  return (
    <div
      className="rounded-2xl hover:border-agro-green/30 transition-all cursor-pointer group relative overflow-hidden"
      style={{
        background: "rgba(13,26,17,0.85)",
        border: `1px solid ${isActive ? "rgba(63,176,108,0.18)" : "rgba(63,176,108,0.1)"}`,
        boxShadow: isActive ? "0 0 32px rgba(63,176,108,0.04) inset" : "none",
      }}
      onClick={() => onNav(rule.id)}
    >
      {/* Active glow top edge */}
      {isActive && (
        <div className="absolute top-0 left-8 right-8 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(63,176,108,0.4), transparent)" }} />
      )}

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Icon + pulse for active */}
            <div className="relative shrink-0">
              {isActive && (
                <span className="absolute inset-0 rounded-xl animate-ping opacity-20"
                  style={{ background: "#3fb06c" }} />
              )}
              <div className="relative w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: isActive ? "rgba(63,176,108,0.15)" : "rgba(63,176,108,0.07)", border: `1px solid ${isActive ? "rgba(63,176,108,0.25)" : "rgba(63,176,108,0.12)"}` }}>
                <Zap className="w-4 h-4 text-agro-green" />
              </div>
            </div>

            <div className="min-w-0">
              <p className="font-semibold text-agro-text text-sm truncate group-hover:text-agro-green transition-colors">
                {rule.name}
              </p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: statusStyle.bg, color: statusStyle.color, border: `1px solid ${statusStyle.border}` }}>
                  {isActive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-agro-green mr-1 animate-pulse" />}
                  {statusStyle.label}
                </span>
                <span className="text-[10px] text-agro-muted-2">{rule.channel === "z_api" ? "Z-API" : "Meta"}</span>
                <span className="text-[10px] text-agro-muted flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" /> {padHour(rule.send_hour)}
                </span>
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-agro-muted-2 group-hover:text-agro-green transition-colors shrink-0 mt-1" />
        </div>

        {/* Recipient count */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[10px] text-agro-muted flex items-center gap-1">
            <Users className="w-3 h-3" /> {rule.total_recipients} destinatários
          </span>
          <span className="text-[10px] text-agro-muted">{rule.sent_count} enviados</span>
        </div>

        {/* Progress */}
        {rule.total_recipients > 0 && (
          <div className="mb-3">
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(63,176,108,0.1)" }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${progressBar}%`, background: "linear-gradient(90deg, #3fb06c, #16A34A)" }} />
            </div>
            <p className="text-[10px] text-agro-muted mt-1">
              {rule.sent_count} disparo{rule.sent_count !== 1 ? "s" : ""} enviados · {rule.total_recipients} destinatário{rule.total_recipients !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        {/* Next fire countdown (only for active) */}
        {isActive && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.12)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-agro-green animate-pulse shrink-0" />
            <span className="text-[11px] text-agro-muted">Próximo disparo em</span>
            <span className="text-[11px] font-bold text-agro-green ml-auto">{countdown}</span>
          </div>
        )}

        {/* Paused badge */}
        {rule.status === "paused" && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
            <span className="text-[11px] text-amber-400/80">Pausada — disparos suspensos</span>
          </div>
        )}
      </div>

      {/* ── Schedule toggle ──────────────────────────────────────────────────── */}
      <button
        onClick={handleToggleSchedule}
        className="w-full flex items-center gap-2 px-5 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
        style={{ borderTop: "1px solid rgba(63,176,108,0.08)", borderBottom: expanded ? "1px solid rgba(63,176,108,0.08)" : "none" }}
      >
        <CalendarDays className="w-3.5 h-3.5 shrink-0" style={{ color: expanded ? "#3fb06c" : "#5a7a66" }} />
        <span className="text-[11px] font-medium flex-1" style={{ color: expanded ? "#3fb06c" : "#5a7a66" }}>
          {schedLoading
            ? "Carregando agenda..."
            : pendingCount === null
              ? "Ver agenda de disparos"
              : pendingCount === 0
                ? "Nenhum disparo pendente"
                : `${pendingCount} disparo${pendingCount !== 1 ? "s" : ""} pendente${pendingCount !== 1 ? "s" : ""}`}
        </span>
        {schedLoading
          ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: "#5a7a66" }} />
          : expanded
            ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "#3fb06c" }} />
            : <ChevronDown className="w-3.5 h-3.5" style={{ color: "#5a7a66" }} />}
      </button>

      {/* ── Schedule panel ───────────────────────────────────────────────────── */}
      {expanded && (
        <div
          className="overflow-y-auto"
          style={{ maxHeight: "320px" }}
          onClick={(e) => e.stopPropagation()}
        >
          {schedLoading ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-5 h-5 animate-spin text-agro-green" />
            </div>
          ) : !schedule || schedule.totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <CalendarDays className="w-6 h-6 text-agro-muted-2" />
              <p className="text-[11px] text-agro-muted text-center px-4">
                Nenhum disparo pendente.<br />Todos foram enviados ou os boletos estão fora do período.
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {schedule.groups.map((group) => (
                <div key={group.date}>
                  {/* Date header */}
                  <div className="flex items-center gap-2 px-5 py-2 sticky top-0"
                    style={{ background: "rgba(10,20,14,0.95)", borderBottom: "1px solid rgba(63,176,108,0.07)" }}>
                    <div className="w-1.5 h-1.5 rounded-full bg-agro-green/60 shrink-0" />
                    <span className="text-[10px] font-bold text-agro-muted-2 uppercase tracking-wider">
                      {formatFireDate(group.date)}
                    </span>
                    <span className="text-[10px] text-agro-muted ml-1">às {padHour(rule.send_hour)}</span>
                    <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ background: "rgba(63,176,108,0.1)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.15)" }}>
                      {group.entries.length}
                    </span>
                  </div>

                  {/* Entries */}
                  {group.entries.map((entry) => (
                    <div
                      key={`${entry.trigger.id}:${entry.recipient.id}`}
                      className="flex items-center gap-2 px-5 py-2.5 hover:bg-white/[0.025] transition-colors group/row"
                      style={{ borderBottom: "1px solid rgba(63,176,108,0.04)" }}
                    >
                      {/* Trigger label pill */}
                      <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-md font-bold whitespace-nowrap"
                        style={{
                          background: entry.trigger.day_offset < 0
                            ? "rgba(59,130,246,0.1)"
                            : entry.trigger.day_offset === 0
                              ? "rgba(63,176,108,0.12)"
                              : "rgba(239,68,68,0.1)",
                          color: entry.trigger.day_offset < 0
                            ? "#60a5fa"
                            : entry.trigger.day_offset === 0
                              ? "#3fb06c"
                              : "#f87171",
                          border: `1px solid ${entry.trigger.day_offset < 0 ? "rgba(59,130,246,0.2)" : entry.trigger.day_offset === 0 ? "rgba(63,176,108,0.2)" : "rgba(239,68,68,0.2)"}`,
                        }}>
                        {entry.triggerLabel}
                      </span>

                      {/* Contact info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-agro-text truncate">{entry.recipient.contact_name}</p>
                        <p className="text-[10px] text-agro-muted-2 truncate">{entry.recipient.contact_phone}</p>
                      </div>

                      {/* Valor + vencimento */}
                      <div className="text-right shrink-0 hidden sm:block">
                        <p className="text-[11px] font-semibold text-agro-text">{formatBRL(entry.recipient.valor)}</p>
                        <p className="text-[9px] text-agro-muted-2">venc. {entry.recipient.vencimento.slice(5).replace("-", "/")}</p>
                      </div>

                      {/* Remove button */}
                      <button
                        disabled={removingId === entry.recipient.id}
                        onClick={(e) => handleRemove(e, entry.recipient.id)}
                        title="Remover dos disparos"
                        className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-all hover:bg-red-500/20 disabled:opacity-30"
                        style={{ border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}
                      >
                        {removingId === entry.recipient.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <X className="w-3 h-3" />}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-5 py-3"
        style={{ borderTop: "1px solid rgba(63,176,108,0.07)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {canToggle && (
          <button
            disabled={isActing}
            onClick={() => onToggle(rule)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 hover:bg-white/5"
            style={{ color: rule.status === "active" ? "#fbbf24" : "#3fb06c", border: "1px solid rgba(63,176,108,0.15)" }}>
            {rule.status === "active" ? <><Pause className="w-3 h-3" /> Pausar</> : <><Play className="w-3 h-3" /> Ativar</>}
          </button>
        )}
        <button
          disabled={isActing}
          onClick={() => onDelete(rule.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-agro-muted-2 hover:text-red-400 transition-colors disabled:opacity-50"
          style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
          <Trash2 className="w-3 h-3" /> Excluir
        </button>
      </div>
    </div>
  );
}

interface SectionProps {
  title:    string;
  items:    AutomationRule[];
  acting:   string | null;
  onToggle: (rule: AutomationRule) => void;
  onDelete: (id: string) => void;
  onNav:    (id: string) => void;
}

function Section({ title, items, acting, onToggle, onDelete, onNav }: SectionProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-bold text-agro-muted-2 uppercase tracking-widest mb-3">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((r) => (
          <RuleCard key={r.id} rule={r} acting={acting} onToggle={onToggle} onDelete={onDelete} onNav={onNav} />
        ))}
      </div>
    </div>
  );
}

export function Automations() {
  const navigate        = useNavigate();
  const { toast }       = useToast();
  const { workspaceId } = useAuth();
  const wsId            = workspaceId ?? "";

  const { rules, loading, refetch, updateStatus, deleteRule } = useAutomationRules(wsId);
  const [acting,       setActing]       = useState<string | null>(null);
  const [confirm,      setConfirm]      = useState<string | null>(null);
  const [creatingDemo, setCreatingDemo] = useState(false);

  async function handleToggle(rule: AutomationRule) {
    const next = rule.status === "active" ? "paused" : "active";
    setActing(rule.id);
    try {
      const err = await updateStatus(rule.id, next);
      if (err) toast({ title: "Erro ao atualizar status", description: err, variant: "destructive" });
      else toast({ title: next === "active" ? "Régua ativada!" : "Régua pausada", variant: "success" });
    } finally {
      setActing(null);
    }
  }

  async function handleDelete(id: string) {
    setActing(id);
    try {
      const err = await deleteRule(id);
      if (err) toast({ title: "Erro ao excluir", description: err, variant: "destructive" });
      else toast({ title: "Régua excluída", variant: "success" });
    } finally {
      setActing(null);
      setConfirm(null);
    }
  }

  async function createDemoRule() {
    if (!wsId) return;
    setCreatingDemo(true);
    try {
      const t0 = new Date();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;

      function dateOffset(days: number): string {
        const d = new Date(t0);
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
      }

      const { data: rule, error: ruleErr } = await db
        .from("automation_rules")
        .insert({
          workspace_id:     wsId,
          name:             `Demo — Régua de Cobrança ${t0.toLocaleDateString("pt-BR")}`,
          status:           "active",
          send_hour:        9,
          channel:          "z_api",
          template_mode:    "per_trigger",
          total_recipients: 6,
          sent_count:       0,
        })
        .select("id")
        .single();

      if (ruleErr || !rule) throw ruleErr ?? new Error("Falha ao criar demo");
      const ruleId = (rule as { id: string }).id;

      const { data: triggers, error: trigErr } = await db
        .from("automation_triggers")
        .insert([
          { rule_id: ruleId, workspace_id: wsId, day_offset: -7, label: "7 dias antes",  message_body: "Olá {nome}! Seu boleto de {valor} vence em {dias} dias ({vencimento}). Pague em dia e evite juros.",                         enabled: true },
          { rule_id: ruleId, workspace_id: wsId, day_offset:  0, label: "No dia",        message_body: "Bom dia, {nome}! Hoje é o vencimento do seu boleto de {valor}. Pague agora para evitar multas.",                               enabled: true },
          { rule_id: ruleId, workspace_id: wsId, day_offset: +3, label: "3 dias depois", message_body: "Olá {nome}, identificamos que seu boleto de {valor} está em aberto há {dias} dias. Regularize para evitar negativação.",        enabled: true },
        ])
        .select("id, day_offset");

      if (trigErr || !triggers) throw trigErr ?? new Error("Falha ao criar gatilhos");

      const trigMap: Record<number, string> = {};
      for (const t of (triggers as Array<{ id: string; day_offset: number }>)) {
        trigMap[t.day_offset] = t.id;
      }

      const contacts = [
        { name: "Maria Aparecida Santos", phone: "5511998752341", venc: dateOffset(+10), valor: 1250.00 },
        { name: "João Carlos Oliveira",   phone: "5511987321560", venc: dateOffset(+3),  valor: 870.00  },
        { name: "Ana Paula Rodrigues",    phone: "5519976543210", venc: dateOffset(-2),  valor: 2100.00 },
        { name: "Carlos Eduardo Lima",    phone: "5521991234567", venc: dateOffset(-5),  valor: 560.00  },
        { name: "Fernanda Costa Silva",   phone: "5511987654321", venc: dateOffset(+7),  valor: 3400.00 },
        { name: "Roberto Alves Souza",    phone: "5551987654001", venc: dateOffset(-12), valor: 980.00  },
      ];

      const { data: recipients, error: recErr } = await db
        .from("automation_recipients")
        .insert(contacts.map((c) => ({
          rule_id:       ruleId,
          workspace_id:  wsId,
          contact_id:    crypto.randomUUID(),
          contact_name:  c.name,
          contact_phone: c.phone,
          vencimento:    c.venc,
          valor:         c.valor,
          removed:       false,
        })))
        .select("id, vencimento, contact_name, contact_phone");

      if (recErr || !recipients) throw recErr ?? new Error("Falha ao criar destinatários");

      const todayISO = t0.toISOString().slice(0, 10);
      const logs: Record<string, unknown>[] = [];

      for (const rec of (recipients as Array<{ id: string; vencimento: string; contact_name: string; contact_phone: string }>)) {
        for (const [offsetStr, triggerId] of Object.entries(trigMap)) {
          const dayOffset  = Number(offsetStr);
          const fireDate   = new Date(rec.vencimento + "T12:00:00Z");
          fireDate.setDate(fireDate.getDate() + dayOffset);

          if (fireDate.toISOString().slice(0, 10) <= todayISO) {
            const failed = Math.random() < 0.12;
            logs.push({
              rule_id:       ruleId,
              trigger_id:    triggerId,
              recipient_id:  rec.id,
              workspace_id:  wsId,
              contact_name:  rec.contact_name,
              contact_phone: rec.contact_phone,
              day_offset:    dayOffset,
              channel:       "z_api",
              status:        failed ? "failed" : "sent",
              error_message: failed ? "Número inválido ou sem WhatsApp" : null,
              scheduled_for: fireDate.toISOString(),
              sent_at:       fireDate.toISOString(),
            });
          }
        }
      }

      if (logs.length > 0) {
        await db.from("automation_logs").insert(logs);
      }

      const sentCount = logs.filter((l) => l.status === "sent").length;
      await db.from("automation_rules").update({ sent_count: sentCount }).eq("id", ruleId);

      toast({
        title:       "Demo criada!",
        description: `Régua com ${contacts.length} contatos fictícios e ${logs.length} disparos gerados.`,
        variant:     "success",
      });
      navigate(`/automations/${ruleId}`);
    } catch (err) {
      toast({
        title:       "Erro ao criar demo",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant:     "destructive",
      });
    } finally {
      setCreatingDemo(false);
    }
  }

  const active    = rules.filter((r) => r.status === "active");
  const drafts    = rules.filter((r) => r.status === "draft");
  const paused    = rules.filter((r) => r.status === "paused");
  const completed = rules.filter((r) => r.status === "completed");

  const sharedProps = {
    acting,
    onToggle: handleToggle,
    onDelete: (id: string) => setConfirm(id),
    onNav:    (id: string) => navigate(`/automations/${id}`),
  };

  const totalRecipients = rules.reduce((s, r) => s + r.total_recipients, 0);
  const totalSent       = rules.reduce((s, r) => s + r.sent_count, 0);

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Automações" }]} />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-agro-text">Réguas de Cobrança</h1>
            <p className="text-sm text-agro-muted mt-1">Disparos automáticos baseados no vencimento de boletos</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refetch}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={createDemoRule}
              disabled={creatingDemo}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 hover:bg-white/5"
              style={{ color: "#7fc49a", border: "1px solid rgba(63,176,108,0.25)" }}>
              <Sparkles className="w-4 h-4" />
              {creatingDemo ? "Criando..." : "Criar demo"}
            </button>
            <button
              onClick={() => navigate("/automations/new")}
              className="btn-agro flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white">
              <Plus className="w-4 h-4" /> Nova régua
            </button>
          </div>
        </div>

        {/* Summary strip */}
        {rules.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Ativas",        value: active.length,   color: "#3fb06c", sub: "réguas"   },
              { label: "Destinatários", value: totalRecipients, color: "#7fc49a", sub: "total"    },
              { label: "Enviados",      value: totalSent,       color: "#7fc49a", sub: "disparos" },
              { label: "Pausadas",      value: paused.length,   color: "#fbbf24", sub: "réguas"   },
            ].map(({ label, value, color, sub }) => (
              <div key={label} className="p-4 rounded-xl text-center"
                style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}>
                <p className="text-2xl font-bold" style={{ color }}>{value}</p>
                <p className="text-[11px] text-agro-muted-2 mt-0.5">{label}</p>
                <p className="text-[9px] text-agro-muted mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-agro-green/30 border-t-agro-green rounded-full animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && rules.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-5">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.15)" }}>
              <Zap className="w-7 h-7 text-agro-green" />
            </div>
            <div className="text-center">
              <p className="text-agro-text font-semibold">Nenhuma régua criada</p>
              <p className="text-sm text-agro-muted mt-1 max-w-sm">
                Crie sua primeira régua de cobrança para automatizar o envio de mensagens nos dias certos.
              </p>
            </div>
            <button onClick={() => navigate("/automations/new")}
              className="btn-agro flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white">
              <Plus className="w-4 h-4" /> Criar primeira régua
            </button>
          </div>
        )}

        {/* Rule sections */}
        {!loading && (
          <div className="space-y-8">
            <Section title="Ativas"     items={active}    {...sharedProps} />
            <Section title="Pausadas"   items={paused}    {...sharedProps} />
            <Section title="Rascunhos"  items={drafts}    {...sharedProps} />
            <Section title="Concluídas" items={completed} {...sharedProps} />
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={() => setConfirm(null)}>
          <div className="rounded-2xl p-6 max-w-sm w-full space-y-4"
            style={{ background: "rgba(13,26,17,0.95)", border: "1px solid rgba(239,68,68,0.3)" }}
            onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-agro-text">Excluir régua?</p>
            <p className="text-sm text-agro-muted">Esta ação não pode ser desfeita. Todos os gatilhos, destinatários e logs serão removidos.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirm(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-agro-muted-2 hover:text-agro-text transition-colors"
                style={{ border: "1px solid rgba(63,176,108,0.2)" }}>
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirm)}
                disabled={acting === confirm}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500/80 hover:bg-red-500 transition-colors disabled:opacity-50">
                {acting === confirm ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
