import { Send, Users, MessageSquare, Zap, Clock, DollarSign, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { Topbar } from "@/components/layout/Topbar";
import { useDashboardMetrics, fmtCount, fmtTime, fmtBRL } from "@/hooks/useDashboardMetrics";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

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

function exportDashboardXlsx(metrics: ReturnType<typeof useDashboardMetrics>) {
  const wb = XLSX.utils.book_new();

  const resumo = [
    { "Métrica": "Campanhas totais",        "Valor": metrics.activeCampaigns,    "Unidade": "campanhas" },
    { "Métrica": "Campanhas este mês",      "Valor": metrics.campaignsThisMonth, "Unidade": "campanhas" },
    { "Métrica": "Mensagens enviadas",      "Valor": metrics.messagesSent,       "Unidade": "mensagens" },
    { "Métrica": "Mensagens este mês",      "Valor": metrics.messagesThisMonth,  "Unidade": "mensagens" },
    { "Métrica": "Contatos no Inbox",       "Valor": metrics.activeContacts,     "Unidade": "contatos"  },
    { "Métrica": "Contatos este mês",       "Valor": metrics.contactsThisMonth,  "Unidade": "contatos"  },
    { "Métrica": "Taxa de entrega",         "Valor": metrics.deliveryRate,       "Unidade": "%"         },
    { "Métrica": "Economia de tempo",       "Valor": fmtTime(metrics.timeSavedMinutes), "Unidade": ""  },
    { "Métrica": "Valor disparado (R$)",    "Valor": metrics.valueDispatched,    "Unidade": "BRL"       },
  ];

  const daily = metrics.dailyMessages.map((d) => ({
    "Data":     d.date,
    "Enviadas": d.enviadas,
    "Lidas":    d.lidas,
  }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Resumo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(daily),  "Atividade 30 dias");
  XLSX.writeFile(wb, `dashboard_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4 animate-fade-up-delay-1">
          {stats.map((s) => (
            <StatCard key={s.label} {...s} loading={metrics.loading} />
          ))}
        </div>

        {/* ── Economia de Tempo + Valor Disparado ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8 animate-fade-up-delay-1">
          {/* Economia de Tempo */}
          <div
            className="p-6 rounded-2xl transition-all duration-300 hover:scale-[1.01]"
            style={{
              background: "rgba(13,26,17,0.7)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(63,176,108,0.1)",
            }}
          >
            <div className="flex items-start justify-between mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)" }}
              >
                <Clock className="w-4.5 h-4.5" style={{ color: "#fbbf24" }} />
              </div>
              <span
                className="text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded-full"
                style={{ background: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)" }}
              >
                vs envio manual
              </span>
            </div>

            {metrics.loading ? (
              <>
                <div className="h-8 w-28 rounded-lg animate-pulse mb-2" style={{ background: "rgba(63,176,108,0.08)" }} />
                <div className="h-3 w-44 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.05)" }} />
              </>
            ) : (
              <>
                <p className="font-display text-3xl font-bold text-agro-text">
                  {fmtTime(metrics.timeSavedMinutes)}
                </p>
                <p className="text-sm text-agro-muted mt-1">Economia de tempo</p>
                <p className="text-xs text-agro-muted-2 mt-2 leading-relaxed">
                  Um humano levaria ~{fmtTime(metrics.messagesSent * 2)} para enviar{" "}
                  {fmtCount(metrics.messagesSent)} mensagens manualmente (2 min/msg).
                  A automação fez em muito menos tempo.
                </p>
              </>
            )}
          </div>

          {/* Valor Disparado */}
          <div
            className="p-6 rounded-2xl transition-all duration-300 hover:scale-[1.01]"
            style={{
              background: "rgba(13,26,17,0.7)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(63,176,108,0.1)",
            }}
          >
            <div className="flex items-start justify-between mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.3)" }}
              >
                <DollarSign className="w-4.5 h-4.5" style={{ color: "#34d399" }} />
              </div>
              <span
                className="text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded-full"
                style={{ background: "rgba(52,211,153,0.1)", color: "#34d399", border: "1px solid rgba(52,211,153,0.2)" }}
              >
                somatória total
              </span>
            </div>

            {metrics.loading ? (
              <>
                <div className="h-8 w-36 rounded-lg animate-pulse mb-2" style={{ background: "rgba(63,176,108,0.08)" }} />
                <div className="h-3 w-44 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.05)" }} />
              </>
            ) : (
              <>
                <p className="font-display text-3xl font-bold text-agro-text">
                  {metrics.valueDispatched > 0 ? fmtBRL(metrics.valueDispatched) : "—"}
                </p>
                <p className="text-sm text-agro-muted mt-1">Valor disparado</p>
                <p className="text-xs text-agro-muted-2 mt-2 leading-relaxed">
                  {metrics.valueDispatched > 0
                    ? `Soma do campo "Valor total" em todos os disparos enviados com sucesso.`
                    : `Mapeie o placeholder "Valor total" num template para rastrear o valor cobrado por disparo.`}
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── 30-day Area Chart ─────────────────── */}
        <div
          className="rounded-2xl p-6 animate-fade-up-delay-1"
          style={{
            background: "rgba(13,26,17,0.7)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(63,176,108,0.1)",
          }}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-semibold text-agro-text">Mensagens nos últimos 30 dias</h2>
              <p className="text-xs text-agro-muted-2 mt-0.5">Enviadas e lidas por dia</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportDashboardXlsx(metrics)}
                disabled={metrics.loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-agro-muted transition-colors hover:text-agro-text hover:bg-white/5 disabled:opacity-40"
                style={{ border: "1px solid rgba(63,176,108,0.15)" }}
              >
                <Download className="w-3 h-3" />
                Exportar XLSX
              </button>
              <button
                onClick={() => navigate("/shooting")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-agro-green transition-colors hover:opacity-80"
                style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}
              >
                <Send className="w-3 h-3" />
                Ver disparos
              </button>
            </div>
          </div>

          {metrics.loading ? (
            <div className="h-52 rounded-xl animate-pulse" style={{ background: "rgba(63,176,108,0.04)" }} />
          ) : metrics.dailyMessages.every((d) => d.enviadas === 0) ? (
            <div className="h-52 flex items-center justify-center text-sm text-agro-muted-2">
              Nenhum envio nos últimos 30 dias.
            </div>
          ) : (
            <>
              {/* Gradient defs */}
              <svg width="0" height="0" style={{ position: "absolute" }}>
                <defs>
                  <linearGradient id="gradEnviadas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#60a5fa" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0}    />
                  </linearGradient>
                  <linearGradient id="gradLidas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#34d399" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0}   />
                  </linearGradient>
                </defs>
              </svg>

              <ResponsiveContainer width="100%" height={210}>
                <AreaChart data={metrics.dailyMessages} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,176,108,0.06)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "#6b8a75" }}
                    axisLine={false}
                    tickLine={false}
                    interval={4}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#6b8a75" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(13,26,17,0.97)",
                      border: "1px solid rgba(63,176,108,0.2)",
                      borderRadius: "10px",
                      fontSize: "12px",
                      color: "#c8dac0",
                    }}
                    cursor={{ stroke: "rgba(63,176,108,0.15)", strokeWidth: 1 }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: "11px", paddingTop: "10px", color: "#6b8a75" }}
                    formatter={(value) => value === "enviadas" ? "Enviadas" : "Lidas"}
                  />
                  <Area
                    type="monotone"
                    dataKey="enviadas"
                    stroke="#60a5fa"
                    strokeWidth={2}
                    fill="url(#gradEnviadas)"
                    dot={false}
                    activeDot={{ r: 4, fill: "#60a5fa" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="lidas"
                    stroke="#34d399"
                    strokeWidth={2}
                    fill="url(#gradLidas)"
                    dot={false}
                    activeDot={{ r: 4, fill: "#34d399" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
