import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, MessageSquare, CheckCheck, AlertTriangle,
  Info, AlertCircle, ChevronDown, ChevronUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Topbar } from "@/components/layout/Topbar";
import { useCampaignAlerts, CampaignAlert } from "@/hooks/useCampaignAlerts";

type SeverityFilter = "all" | "critical" | "warning" | "info";
type Severity       = "critical" | "warning" | "info";

const SEVERITY_CONFIG = {
  critical: { label: "Crítico",     color: "#f87171", bg: "rgba(239,68,68,0.1)",  border: "rgba(239,68,68,0.25)",  icon: AlertCircle   },
  warning:  { label: "Aviso",       color: "#fbbf24", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)", icon: AlertTriangle },
  info:     { label: "Informativo", color: "#60a5fa", bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.25)", icon: Info          },
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 2, warning: 1, info: 0 };

const CATEGORY_LABELS: Record<string, string> = {
  fraude:               "Fraude",
  valor_incorreto:      "Valor incorreto",
  nao_reconhece:        "Não reconhece",
  ameaca:               "Ameaça",
  duvida:               "Dúvida",
  reclamacao:           "Reclamação",
  elogio:               "Elogio",
  pagamento_confirmado: "Pagamento confirmado",
  outros:               "Outros",
};

// ── Grouping logic ───────────────────────────────────────────────

interface ContactGroup {
  phone:           string;
  name:            string | null;
  alerts:          CampaignAlert[]; // sorted newest-first
  latest:          CampaignAlert;
  topSeverity:     Severity;
  unreadCount:     number;
}

function groupAlerts(alerts: CampaignAlert[]): ContactGroup[] {
  const map = new Map<string, CampaignAlert[]>();
  for (const a of alerts) {
    const list = map.get(a.recipient_phone) ?? [];
    list.push(a);
    map.set(a.recipient_phone, list);
  }

  const groups: ContactGroup[] = [];
  for (const [phone, list] of map) {
    const sorted = [...list].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const topSeverity = list.reduce<Severity>(
      (best, a) => (SEVERITY_RANK[a.severity] > SEVERITY_RANK[best] ? a.severity : best),
      "info",
    );
    groups.push({
      phone,
      name:        sorted[0].recipient_name,
      alerts:      sorted,
      latest:      sorted[0],
      topSeverity,
      unreadCount: list.filter((a) => !a.read_at).length,
    });
  }

  // Unread first, then by latest alert date
  return groups.sort((a, b) => {
    if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
    if (b.unreadCount > 0 && a.unreadCount === 0) return 1;
    return new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime();
  });
}

// ── History item (compact row inside expanded group) ─────────────

function HistoryRow({ alert }: { alert: CampaignAlert }) {
  const cfg = SEVERITY_CONFIG[alert.severity];
  return (
    <div
      className="flex items-start gap-3 py-3"
      style={{ borderTop: "1px solid rgba(63,176,108,0.06)" }}
    >
      <span
        className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5"
        style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
      >
        {cfg.label}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-agro-muted leading-relaxed">{alert.summary}</p>
        <p
          className="text-[11px] text-agro-muted-2 mt-1 italic rounded px-2 py-1 truncate"
          style={{ background: "rgba(63,176,108,0.03)", border: "1px solid rgba(63,176,108,0.05)" }}
        >
          "{alert.reply_text.length > 120 ? alert.reply_text.slice(0, 120) + "…" : alert.reply_text}"
        </p>
      </div>
      <span className="text-[10px] text-agro-muted-2 shrink-0 mt-0.5">
        {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: ptBR })}
      </span>
    </div>
  );
}

// ── Contact group card ───────────────────────────────────────────

function ContactGroupCard({
  group,
  onMarkAllRead,
  onViewConversation,
}: {
  group:              ContactGroup;
  onMarkAllRead:      (ids: string[]) => void;
  onViewConversation: (conversationId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg  = SEVERITY_CONFIG[group.topSeverity];
  const Icon = cfg.icon;
  const hasMany   = group.alerts.length > 1;
  const hasUnread = group.unreadCount > 0;
  const { latest } = group;

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-200"
      style={{
        background:     hasUnread ? "rgba(13,26,17,0.9)" : "rgba(13,26,17,0.5)",
        border:         hasUnread ? `1px solid ${cfg.border}` : "1px solid rgba(63,176,108,0.08)",
        backdropFilter: "blur(16px)",
      }}
    >
      {/* ── Main row ── */}
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
          >
            <Icon className="w-4 h-4" style={{ color: cfg.color }} />
          </div>

          <div className="min-w-0 flex-1">
            {/* Name + time */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="text-sm font-semibold text-agro-text">
                  {group.name ?? group.phone}
                </span>
                {group.name && (
                  <span className="text-xs text-agro-muted-2">{group.phone}</span>
                )}
              </div>
              <span className="text-[10px] text-agro-muted-2 shrink-0 mt-0.5">
                {formatDistanceToNow(new Date(latest.created_at), { addSuffix: true, locale: ptBR })}
              </span>
            </div>

            {/* Badges */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span
                className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
              >
                {cfg.label}
              </span>
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: "rgba(63,176,108,0.08)", color: "#6b8a75", border: "1px solid rgba(63,176,108,0.12)" }}
              >
                {CATEGORY_LABELS[latest.category] ?? latest.category}
              </span>
              {hasUnread && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
                >
                  {group.unreadCount === 1 ? "Novo" : `${group.unreadCount} novos`}
                </span>
              )}
            </div>

            {/* Latest summary */}
            <p className="text-sm text-agro-muted mt-2 leading-relaxed">{latest.summary}</p>

            {/* Latest reply text */}
            <p
              className="text-xs text-agro-muted-2 mt-2 rounded-lg p-2 italic line-clamp-2"
              style={{ background: "rgba(63,176,108,0.04)", border: "1px solid rgba(63,176,108,0.06)" }}
            >
              "{latest.reply_text.length > 200
                ? latest.reply_text.slice(0, 200) + "…"
                : latest.reply_text}"
            </p>
          </div>
        </div>

        {/* Action bar */}
        <div
          className="flex items-center justify-between gap-2 mt-4 pt-3"
          style={{ borderTop: "1px solid rgba(63,176,108,0.06)" }}
        >
          <div className="flex items-center gap-2">
            {latest.conversation_id && (
              <button
                onClick={() => onViewConversation(latest.conversation_id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-agro-green hover:opacity-80 transition-opacity"
                style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.15)" }}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Ver conversa
              </button>
            )}
            {hasUnread && (
              <button
                onClick={() => onMarkAllRead(group.alerts.filter((a) => !a.read_at).map((a) => a.id))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-agro-muted hover:text-agro-text transition-colors"
                style={{ border: "1px solid rgba(63,176,108,0.1)" }}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Marcar lido{group.unreadCount > 1 ? "s" : ""}
              </button>
            )}
          </div>

          {/* Expand / collapse history */}
          {hasMany && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors"
              style={{
                background: expanded ? "rgba(63,176,108,0.1)" : "rgba(255,255,255,0.03)",
                border:     expanded ? "1px solid rgba(63,176,108,0.25)" : "1px solid rgba(255,255,255,0.06)",
                color:      expanded ? "#3fb06c" : "#6b8a75",
              }}
            >
              {expanded
                ? <><ChevronUp   className="w-3.5 h-3.5" /> Fechar histórico</>
                : <><ChevronDown className="w-3.5 h-3.5" /> Histórico ({group.alerts.length})</>
              }
            </button>
          )}
        </div>
      </div>

      {/* ── Expanded history ── */}
      {expanded && hasMany && (
        <div
          className="px-5 pb-4"
          style={{ borderTop: "1px solid rgba(63,176,108,0.08)", background: "rgba(0,0,0,0.15)" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2 pt-3 pb-1">
            Histórico de interações
          </p>
          {group.alerts.map((a) => (
            <HistoryRow key={a.id} alert={a} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────

export function Alerts() {
  const navigate = useNavigate();
  const { alerts, loading, unreadCount, markAsRead, markAllRead } = useCampaignAlerts();
  const [filter, setFilter] = useState<SeverityFilter>("all");

  // Group all alerts by contact phone
  const allGroups = groupAlerts(alerts);

  // Filter groups: keep group if it has at least one alert matching the filter
  const filtered = filter === "all"
    ? allGroups
    : allGroups.filter((g) => g.alerts.some((a) => a.severity === filter));

  // Count helpers for tabs (by contact group)
  const countBySeverity = (sev: Severity) =>
    allGroups.filter((g) => g.alerts.some((a) => a.severity === sev)).length;

  const filterOptions: { key: SeverityFilter; label: string; count: number }[] = [
    { key: "all",      label: "Todos",        count: allGroups.length },
    { key: "critical", label: "Críticos",     count: countBySeverity("critical") },
    { key: "warning",  label: "Avisos",       count: countBySeverity("warning")  },
    { key: "info",     label: "Informativos", count: countBySeverity("info")     },
  ];

  function handleViewConversation(conversationId: string | null) {
    if (!conversationId) return;
    navigate(`/inbox?conversation=${conversationId}`);
  }

  async function handleMarkAllRead(ids: string[]) {
    await Promise.all(ids.map((id) => markAsRead(id)));
  }

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Alertas" }]} />

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 animate-fade-up">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <Bell className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold text-agro-text">Alertas de Resposta</h1>
              <p className="text-sm text-agro-muted mt-0.5">
                Monitoramento inteligente das respostas aos seus disparos
              </p>
            </div>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}
            >
              <CheckCheck className="w-4 h-4" />
              Marcar todos como lidos
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 mb-6 flex-wrap animate-fade-up-delay-1">
          {filterOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200"
              style={filter === opt.key ? {
                background: "rgba(63,176,108,0.15)",
                border:     "1px solid rgba(63,176,108,0.3)",
                color:      "#3fb06c",
              } : {
                background: "rgba(13,26,17,0.5)",
                border:     "1px solid rgba(63,176,108,0.08)",
                color:      "#6b8a75",
              }}
            >
              {opt.label}
              {opt.count > 0 && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                  style={filter === opt.key
                    ? { background: "rgba(63,176,108,0.2)", color: "#3fb06c" }
                    : { background: "rgba(63,176,108,0.06)", color: "#6b8a75" }
                  }
                >
                  {opt.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-44 rounded-2xl animate-pulse"
                style={{ background: "rgba(63,176,108,0.04)" }}
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-20 rounded-2xl"
            style={{ background: "rgba(13,26,17,0.5)", border: "1px solid rgba(63,176,108,0.08)" }}
          >
            <Bell className="w-10 h-10 text-agro-muted-2 mb-3" />
            <p className="text-sm font-medium text-agro-muted">Nenhum alerta ainda</p>
            <p className="text-xs text-agro-muted-2 mt-1">
              As respostas aos seus disparos aparecerão aqui automaticamente
            </p>
          </div>
        ) : (
          <div className="space-y-3 animate-fade-up-delay-1">
            {filtered.map((group) => (
              <ContactGroupCard
                key={group.phone}
                group={group}
                onMarkAllRead={handleMarkAllRead}
                onViewConversation={handleViewConversation}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
