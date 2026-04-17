import { Send, Users, MessageSquare, Zap, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Topbar } from "@/components/layout/Topbar";
import { useDashboardMetrics, fmtCount } from "@/hooks/useDashboardMetrics";

function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  color,
  glowColor,
  loading,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
  trend: string | null;
  color: string;
  glowColor: string;
  loading: boolean;
}) {
  return (
    <div
      className="p-5 rounded-2xl transition-all duration-300 hover:scale-[1.02]"
      style={{
        background: "rgba(13,26,17,0.7)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(63,176,108,0.1)",
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
        style={{ background: `${glowColor}20`, border: `1px solid ${glowColor}` }}
      >
        <Icon className="w-4.5 h-4.5" style={{ color }} />
      </div>

      {loading ? (
        <>
          <div className="h-7 w-20 rounded-lg animate-pulse mb-1"
            style={{ background: "rgba(63,176,108,0.08)" }} />
          <div className="h-3 w-28 rounded animate-pulse mt-1"
            style={{ background: "rgba(63,176,108,0.05)" }} />
        </>
      ) : (
        <>
          <p className="font-display text-2xl font-bold text-agro-text">{value}</p>
          <p className="text-xs text-agro-muted mt-0.5">{label}</p>
          {trend && (
            <p className="text-xs font-semibold mt-2" style={{ color }}>{trend}</p>
          )}
        </>
      )}
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const metrics  = useDashboardMetrics();

  const stats = [
    {
      icon:      Send,
      label:     "Campanhas totais",
      value:     fmtCount(metrics.activeCampaigns),
      trend:     metrics.campaignsThisMonth > 0
        ? `+${metrics.campaignsThisMonth} este mês`
        : null,
      color:     "#60a5fa",
      glowColor: "rgba(59,130,246,0.25)",
    },
    {
      icon:      MessageSquare,
      label:     "Mensagens enviadas",
      value:     fmtCount(metrics.messagesSent),
      trend:     metrics.messagesThisMonth > 0
        ? `+${fmtCount(metrics.messagesThisMonth)} este mês`
        : null,
      color:     "#3fb06c",
      glowColor: "rgba(63,176,108,0.25)",
    },
    {
      icon:      Users,
      label:     "Contatos no Inbox",
      value:     fmtCount(metrics.activeContacts),
      trend:     metrics.contactsThisMonth > 0
        ? `+${metrics.contactsThisMonth} este mês`
        : null,
      color:     "#a78bfa",
      glowColor: "rgba(167,139,250,0.25)",
    },
    {
      icon:      Zap,
      label:     "Taxa de entrega",
      value:     metrics.messagesSent > 0 ? `${metrics.deliveryRate}%` : "—",
      trend:     null,
      color:     "#34d399",
      glowColor: "rgba(52,211,153,0.25)",
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Dashboard" }]} />

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* ── Welcome ──────────────────────────── */}
        <div className="mb-8 animate-fade-up">
          <h1 className="font-display text-2xl font-bold text-agro-text">
            Bem-vindo, <span className="text-agro-green">Bruno</span>
          </h1>
          <p className="text-agro-muted mt-1 text-sm">A inteligência que cultiva resultados</p>
        </div>

        {/* ── Stats ────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-up-delay-1">
          {stats.map((s) => (
            <StatCard key={s.label} {...s} loading={metrics.loading} />
          ))}
        </div>

        {/* ── CTA Card ─────────────────────────── */}
        <div
          className="rounded-2xl p-10 text-center relative overflow-hidden animate-fade-up-delay-1"
          style={{
            background: "rgba(13,26,17,0.7)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(63,176,108,0.12)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4), inset 0 0 60px rgba(63,176,108,0.02)",
          }}
        >
          {/* Top accent */}
          <div
            className="absolute top-0 left-1/4 right-1/4 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(63,176,108,0.5), transparent)" }}
          />

          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 glow-green"
            style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
          >
            <Send className="w-8 h-8 text-white" />
          </div>

          <h2 className="font-display text-xl font-bold text-agro-text">
            Shooting — Disparos WhatsApp
          </h2>
          <p className="text-agro-muted text-sm mt-2 max-w-md mx-auto leading-relaxed">
            Envie mensagens em massa via API oficial do WhatsApp Business com rastreamento em tempo real.
          </p>

          <button
            onClick={() => navigate("/shooting")}
            className="btn-agro mt-6 inline-flex items-center gap-2 px-7 py-3 rounded-xl text-sm font-bold text-white"
          >
            Acessar Shooting
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
