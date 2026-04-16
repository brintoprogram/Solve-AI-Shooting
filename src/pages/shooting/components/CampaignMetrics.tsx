import { Send, CheckCheck, Eye, MessageCircle, XCircle } from "lucide-react";
import { calcPercent } from "@/lib/utils";
import type { ShootingCampaign } from "@/types/shooting";

interface CampaignMetricsProps {
  campaign: ShootingCampaign;
}

export function CampaignMetrics({ campaign }: CampaignMetricsProps) {
  const { sent_count, delivered_count, read_count, replied_count, failed_count, total_recipients } = campaign;

  const metrics = [
    {
      icon: Send,
      label: "Enviadas",
      value: sent_count,
      pct: calcPercent(sent_count, total_recipients),
      color: "#60a5fa",
      glowColor: "rgba(59,130,246,0.3)",
      barColor: "rgba(59,130,246,0.8)",
    },
    {
      icon: CheckCheck,
      label: "Entregues",
      value: delivered_count,
      pct: calcPercent(delivered_count, total_recipients),
      color: "#3fb06c",
      glowColor: "rgba(63,176,108,0.3)",
      barColor: "#3fb06c",
    },
    {
      icon: Eye,
      label: "Lidas",
      value: read_count,
      pct: calcPercent(read_count, total_recipients),
      color: "#34d399",
      glowColor: "rgba(52,211,153,0.3)",
      barColor: "#34d399",
    },
    {
      icon: MessageCircle,
      label: "Respostas",
      value: replied_count,
      pct: calcPercent(replied_count, total_recipients),
      color: "#a78bfa",
      glowColor: "rgba(167,139,250,0.3)",
      barColor: "#a78bfa",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="p-4 rounded-xl"
            style={{
              background: "rgba(13,26,17,0.6)",
              border: "1px solid rgba(63,176,108,0.1)",
            }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
              style={{ background: `${m.glowColor}20`, border: `1px solid ${m.glowColor}` }}
            >
              <m.icon className="w-4 h-4" style={{ color: m.color }} />
            </div>
            <p className="text-2xl font-bold text-agro-text">{m.value.toLocaleString("pt-BR")}</p>
            <p className="text-xs text-agro-muted mt-0.5">{m.label}</p>

            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold" style={{ color: m.color }}>{m.pct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.05)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${m.pct}%`, background: m.barColor, boxShadow: `0 0 6px ${m.glowColor}` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Failures */}
      {failed_count > 0 && (
        <div className="p-4 rounded-xl"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-4 h-4 text-red-400" />
            <p className="text-sm font-semibold text-red-400">
              {failed_count} falhas ({calcPercent(failed_count, total_recipients)}%)
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs text-agro-muted">
            <div>
              <span className="font-semibold text-agro-text">
                {(campaign.error_summary as Record<string, number>)?.invalid_number ?? 0}
              </span>{" "}
              número inválido
            </div>
            <div>
              <span className="font-semibold text-agro-text">
                {(campaign.error_summary as Record<string, number>)?.rate_limited ?? 0}
              </span>{" "}
              rate limit
            </div>
            <div>
              <span className="font-semibold text-agro-text">
                {(campaign.error_summary as Record<string, number>)?.other ?? 0}
              </span>{" "}
              outros erros
            </div>
          </div>
        </div>
      )}

      {/* Progress when sending */}
      {campaign.status === "sending" && (
        <div className="p-4 rounded-xl space-y-3"
          style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)" }}
        >
          <div className="flex justify-between text-sm">
            <span className="font-medium text-agro-text">
              {sent_count.toLocaleString("pt-BR")} de {total_recipients.toLocaleString("pt-BR")} enviadas
            </span>
            <span className="font-bold text-blue-400">
              {calcPercent(sent_count, total_recipients)}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden"
            style={{ background: "rgba(59,130,246,0.12)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${calcPercent(sent_count, total_recipients)}%`,
                background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
                boxShadow: "0 0 8px rgba(59,130,246,0.5)",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
