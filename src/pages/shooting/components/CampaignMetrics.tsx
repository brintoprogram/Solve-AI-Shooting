import { Send, CheckCheck, Eye, MessageCircle, XCircle } from "lucide-react";
import { calcPercent } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
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
      color: "text-blue-600",
      bg: "bg-blue-50",
      bar: "bg-blue-500",
    },
    {
      icon: CheckCheck,
      label: "Entregues",
      value: delivered_count,
      pct: calcPercent(delivered_count, total_recipients),
      color: "text-green-600",
      bg: "bg-green-50",
      bar: "bg-green-500",
    },
    {
      icon: Eye,
      label: "Lidas",
      value: read_count,
      pct: calcPercent(read_count, total_recipients),
      color: "text-green-700",
      bg: "bg-green-50",
      bar: "bg-green-600",
    },
    {
      icon: MessageCircle,
      label: "Respostas",
      value: replied_count,
      pct: calcPercent(replied_count, total_recipients),
      color: "text-purple-600",
      bg: "bg-purple-50",
      bar: "bg-purple-500",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className={`w-9 h-9 rounded-lg ${m.bg} flex items-center justify-center mb-3`}>
              <m.icon className={`w-4.5 h-4.5 ${m.color}`} />
            </div>
            <p className="text-2xl font-bold text-gray-900">{m.value.toLocaleString("pt-BR")}</p>
            <p className="text-sm text-gray-500 mt-0.5">{m.label}</p>
            <div className="mt-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">{m.pct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${m.bar}`}
                  style={{ width: `${m.pct}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Failures */}
      {failed_count > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-4 h-4 text-red-600" />
            <p className="text-sm font-semibold text-red-700">
              {failed_count} falhas ({calcPercent(failed_count, total_recipients)}%)
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs text-red-600">
            <div>
              <span className="font-medium">
                {(campaign.error_summary as Record<string, number>)?.invalid_number ?? 0}
              </span>{" "}
              número inválido
            </div>
            <div>
              <span className="font-medium">
                {(campaign.error_summary as Record<string, number>)?.rate_limited ?? 0}
              </span>{" "}
              rate limit
            </div>
            <div>
              <span className="font-medium">
                {(campaign.error_summary as Record<string, number>)?.other ?? 0}
              </span>{" "}
              outros erros
            </div>
          </div>
        </div>
      )}

      {/* Progress bar when sending */}
      {campaign.status === "sending" && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-blue-700">
              {sent_count.toLocaleString("pt-BR")} de {total_recipients.toLocaleString("pt-BR")} enviadas
            </span>
            <span className="text-blue-600 font-semibold">
              {calcPercent(sent_count, total_recipients)}%
            </span>
          </div>
          <Progress value={calcPercent(sent_count, total_recipients)} />
        </div>
      )}
    </div>
  );
}
