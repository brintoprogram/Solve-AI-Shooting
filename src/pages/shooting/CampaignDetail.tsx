import { useParams, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  Pause,
  Play,
  StopCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Topbar } from "@/components/layout/Topbar";
import { CampaignMetrics } from "./components/CampaignMetrics";
import { MessagesTable } from "./components/MessagesTable";
import { useCampaignDetail } from "@/hooks/useCampaign";
import { startCampaign, pauseCampaign, resumeCampaign, cancelCampaign } from "@/services/campaignEngine";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { CampaignStatus } from "@/types/shooting";
import { STATUS_LABELS } from "@/types/shooting";

const STATUS_CLASS: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  scheduled: "bg-blue-100 text-blue-700",
  sending: "bg-blue-200 text-blue-800",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-200 text-gray-500",
  failed: "bg-red-100 text-red-700",
};

// Mock timeline data for the chart
const mockChartData = Array.from({ length: 10 }, (_, i) => ({
  time: `${14 + Math.floor(i / 2)}:${(i % 2) * 30 === 0 ? "00" : "30"}`,
  enviadas: Math.floor(Math.random() * 200 + 100 * i),
  entregues: Math.floor(Math.random() * 180 + 90 * i),
  lidas: Math.floor(Math.random() * 150 + 70 * i),
}));

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { campaign, loading } = useCampaignDetail(id ?? "");

  async function handleAction(action: "pause" | "resume" | "cancel") {
    if (!id) return;
    try {
      if (action === "pause") await pauseCampaign(id);
      if (action === "resume") await resumeCampaign(id);
      if (action === "cancel") await cancelCampaign(id);
      toast({ title: "Ação realizada com sucesso", variant: "success" });
    } catch {
      toast({ title: "Erro ao executar ação", variant: "destructive" });
    }
  }

  if (loading || !campaign) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Topbar breadcrumbs={[{ label: "Shooting" }, { label: "..." }]} />
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar
        breadcrumbs={[
          { label: "Shooting", href: "/shooting" },
          { label: campaign.name },
        ]}
      />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/shooting")}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-gray-900">{campaign.name}</h1>
                <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLASS[campaign.status]}`}>
                  {campaign.status === "sending" && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse mr-1.5" />
                  )}
                  {STATUS_LABELS[campaign.status]}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                <span>Template: <span className="font-medium text-gray-700">{campaign.meta_templates?.template_name ?? "—"}</span></span>
                <span>·</span>
                <span>{campaign.total_recipients.toLocaleString("pt-BR")} destinatários</span>
                <span>·</span>
                <span>
                  Criado em {format(new Date(campaign.created_at), "dd/MM/yyyy", { locale: ptBR })}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {campaign.status === "sending" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAction("pause")}
                >
                  <Pause className="w-3.5 h-3.5 mr-1.5" />
                  Pausar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => handleAction("cancel")}
                >
                  <StopCircle className="w-3.5 h-3.5 mr-1.5" />
                  Cancelar
                </Button>
              </>
            )}
            {campaign.status === "paused" && (
              <Button size="sm" onClick={() => handleAction("resume")}>
                <Play className="w-3.5 h-3.5 mr-1.5" />
                Retomar
              </Button>
            )}
            {campaign.status === "draft" && (
              <Button size="sm" onClick={() => startCampaign(id!)}>
                <Play className="w-3.5 h-3.5 mr-1.5" />
                Iniciar
              </Button>
            )}
            <Button variant="ghost" size="icon">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Metrics */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Métricas em tempo real</h2>
          <CampaignMetrics campaign={campaign} />
        </div>

        {/* Timeline chart */}
        {campaign.status !== "draft" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Timeline de envios</h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={mockChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="time" tick={{ fontSize: 12, fill: "#6b7280" }} />
                <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} />
                <Tooltip
                  contentStyle={{ borderRadius: "12px", border: "1px solid #e5e7eb", fontSize: "12px" }}
                />
                <Legend
                  wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }}
                />
                <Line type="monotone" dataKey="enviadas" stroke="#3b82f6" name="Enviadas" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="entregues" stroke="#22c55e" name="Entregues" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="lidas" stroke="#16a34a" name="Lidas" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Messages table */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            Mensagens individuais
          </h2>
          <MessagesTable campaignId={campaign.id} />
        </div>
      </div>
    </div>
  );
}
