import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, MessageSquare, CheckCheck, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Topbar } from "@/components/layout/Topbar";
import { useCampaignAlerts, CampaignAlert } from "@/hooks/useCampaignAlerts";

type SeverityFilter = "all" | "critical" | "warning" | "info";

const SEVERITY_CONFIG = {
  critical: { label: "Crítico",     color: "#f87171", bg: "rgba(239,68,68,0.1)",  border: "rgba(239,68,68,0.25)",  icon: AlertCircle   },
  warning:  { label: "Aviso",       color: "#fbbf24", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)", icon: AlertTriangle },
  info:     { label: "Informativo", color: "#60a5fa", bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.25)", icon: Info          },
};

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

function AlertCard({
  alert,
  onMarkRead,
  onViewConversation,
}: {
  alert:              CampaignAlert;
  onMarkRead:         (id: string) => void;
  onViewConversation: (conversationId: string | null) => void;
}) {
  const cfg  = SEVERITY_CONFIG[alert.severity];
  const Icon = cfg.icon;
  const isNew = !alert.read_at;

  return (
    <div
      className="p-5 rounded-2xl transition-all duration-200"
      style={{
        background:     isNew ? "rgba(13,26,17,0.9)" : "rgba(13,26,17,0.5)",
        border:         isNew ? `1px solid ${cfg.border}` : "1px solid rgba(63,176,108,0.08)",
        backdropFilter: "blur(16px)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
        >
          <Icon className="w-4 h-4" style={{ color: cfg.color }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-sm font-semibold text-agro-text">
                {alert.recipient_name ?? alert.recipient_phone}
              </span>
              {alert.recipient_name && (
                <span className="text-xs text-agro-muted-2">{alert.recipient_phone}</span>
              )}
            </div>
            <span className="text-[10px] text-agro-muted-2 shrink-0 mt-0.5">
              {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: ptBR })}
            </span>
          </div>

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
              {CATEGORY_LABELS[alert.category] ?? alert.category}
            </span>
            {isNew && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                Novo
              </span>
            )}
          </div>

          <p className="text-sm text-agro-muted mt-2 leading-relaxed">{alert.summary}</p>

          <p
            className="text-xs text-agro-muted-2 mt-2 rounded-lg p-2 italic line-clamp-2"
            style={{ background: "rgba(63,176,108,0.04)", border: "1px solid rgba(63,176,108,0.06)" }}
          >
            "{alert.reply_text.length > 200
              ? alert.reply_text.slice(0, 200) + "…"
              : alert.reply_text}"
          </p>
        </div>
      </div>

      <div
        className="flex items-center gap-2 mt-4 pt-3"
        style={{ borderTop: "1px solid rgba(63,176,108,0.06)" }}
      >
        {alert.conversation_id && (
          <button
            onClick={() => onViewConversation(alert.conversation_id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-agro-green hover:opacity-80 transition-opacity"
            style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.15)" }}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Ver conversa
          </button>
        )}
        {isNew && (
          <button
            onClick={() => onMarkRead(alert.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-agro-muted hover:text-agro-text transition-colors"
            style={{ border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Marcar lido
          </button>
        )}
      </div>
    </div>
  );
}

export function Alerts() {
  const navigate = useNavigate();
  const { alerts, loading, unreadCount, markAsRead, markAllRead } = useCampaignAlerts();
  const [filter, setFilter] = useState<SeverityFilter>("all");

  const filtered = filter === "all" ? alerts : alerts.filter((a) => a.severity === filter);

  const filterOptions: { key: SeverityFilter; label: string; count: number }[] = [
    { key: "all",      label: "Todos",        count: alerts.length },
    { key: "critical", label: "Críticos",     count: alerts.filter((a) => a.severity === "critical").length },
    { key: "warning",  label: "Avisos",       count: alerts.filter((a) => a.severity === "warning").length },
    { key: "info",     label: "Informativos", count: alerts.filter((a) => a.severity === "info").length },
  ];

  function handleViewConversation(conversationId: string | null) {
    if (!conversationId) return;
    navigate(`/inbox?conversation=${conversationId}`);
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
              <p className="text-sm text-agro-muted mt-0.5">Monitoramento inteligente das respostas aos seus disparos</p>
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
            <p className="text-xs text-agro-muted-2 mt-1">As respostas aos seus disparos aparecerão aqui automaticamente</p>
          </div>
        ) : (
          <div className="space-y-3 animate-fade-up-delay-1">
            {filtered.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onMarkRead={markAsRead}
                onViewConversation={handleViewConversation}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
