import { useParams, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Pause, Play, StopCircle, RefreshCw } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { CampaignMetrics } from "./components/CampaignMetrics";
import { MessagesTable } from "./components/MessagesTable";
import { useCampaignDetail } from "@/hooks/useCampaign";
import { startCampaign, pauseCampaign, resumeCampaign, cancelCampaign } from "@/services/campaignEngine";
import { useToast } from "@/hooks/use-toast";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { CampaignStatus } from "@/types/shooting";
import { STATUS_LABELS } from "@/types/shooting";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<CampaignStatus, { bg: string; color: string; border: string }> = {
  draft:     { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "rgba(107,114,128,0.2)"  },
  scheduled: { bg: "rgba(59,130,246,0.1)",   color: "#60a5fa", border: "rgba(59,130,246,0.2)"   },
  sending:   { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa", border: "rgba(59,130,246,0.3)"   },
  paused:    { bg: "rgba(245,158,11,0.1)",   color: "#fbbf24", border: "rgba(245,158,11,0.2)"   },
  completed: { bg: "rgba(63,176,108,0.1)",   color: "#3fb06c", border: "rgba(63,176,108,0.2)"   },
  cancelled: { bg: "rgba(107,114,128,0.08)", color: "#6b7280", border: "rgba(107,114,128,0.15)" },
  failed:    { bg: "rgba(239,68,68,0.1)",    color: "#f87171", border: "rgba(239,68,68,0.2)"    },
};

const mockChartData = Array.from({ length: 10 }, (_, i) => ({
  time: `${14 + Math.floor(i / 2)}:${(i % 2) * 30 === 0 ? "00" : "30"}`,
  enviadas:  Math.floor(Math.random() * 200 + 100 * i),
  entregues: Math.floor(Math.random() * 180 + 90 * i),
  lidas:     Math.floor(Math.random() * 150 + 70 * i),
}));

function DarkCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-6"
      style={{
        background: "rgba(13,26,17,0.7)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(63,176,108,0.1)",
      }}
    >
      <h2 className="text-sm font-semibold text-agro-text mb-5">{title}</h2>
      {children}
    </div>
  );
}

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { campaign, loading } = useCampaignDetail(id ?? "");

  async function handleAction(action: "pause" | "resume" | "cancel") {
    if (!id) return;
    try {
      if (action === "pause")  await pauseCampaign(id);
      if (action === "resume") await resumeCampaign(id);
      if (action === "cancel") await cancelCampaign(id);
      toast({ title: "Ação realizada com sucesso", variant: "success" });
    } catch {
      toast({ title: "Erro ao executar ação", variant: "destructive" });
    }
  }

  if (loading || !campaign) {
    return (
      <div className="min-h-screen" style={{ background: "#0a110e" }}>
        <Topbar breadcrumbs={[{ label: "Shooting" }, { label: "..." }]} />
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 rounded-2xl animate-pulse"
              style={{ background: "rgba(63,176,108,0.04)" }}
            />
          ))}
        </div>
      </div>
    );
  }

  const st = STATUS_STYLE[campaign.status];

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Shooting", href: "/shooting" }, { label: campaign.name }]} />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* ── Header ──────────────────────────── */}
        <div className="flex items-start justify-between animate-fade-up">
          <div className="flex items-start gap-4">
            <button
              onClick={() => navigate("/shooting")}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors hover:bg-white/10 mt-0.5"
              style={{ border: "1px solid rgba(63,176,108,0.12)" }}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-display text-2xl font-bold text-agro-text">{campaign.name}</h1>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                  style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}
                >
                  {campaign.status === "sending" && (
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  )}
                  {STATUS_LABELS[campaign.status]}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-agro-muted flex-wrap">
                <span>Template: <span className="font-medium text-agro-text">{campaign.meta_templates?.template_name ?? "—"}</span></span>
                <span className="text-agro-muted-2">·</span>
                <span>{campaign.total_recipients.toLocaleString("pt-BR")} destinatários</span>
                <span className="text-agro-muted-2">·</span>
                <span>Criado {format(new Date(campaign.created_at), "dd/MM/yyyy", { locale: ptBR })}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {campaign.status === "sending" && (
              <>
                <button
                  onClick={() => handleAction("pause")}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
                  style={{ border: "1px solid rgba(63,176,108,0.15)" }}
                >
                  <Pause className="w-3.5 h-3.5" />
                  Pausar
                </button>
                <button
                  onClick={() => handleAction("cancel")}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
                  style={{ border: "1px solid rgba(239,68,68,0.2)" }}
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  Cancelar
                </button>
              </>
            )}
            {campaign.status === "paused" && (
              <button
                onClick={() => handleAction("resume")}
                className="btn-agro flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
              >
                <Play className="w-3.5 h-3.5" />
                Retomar
              </button>
            )}
            {campaign.status === "draft" && (
              <button
                onClick={() => startCampaign(id!)}
                className="btn-agro flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
              >
                <Play className="w-3.5 h-3.5" />
                Iniciar
              </button>
            )}
            <button
              className="w-9 h-9 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors hover:bg-white/10"
              style={{ border: "1px solid rgba(63,176,108,0.12)" }}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Metrics ─────────────────────────── */}
        <div className="animate-fade-up-delay-1">
          <DarkCard title="Métricas em tempo real">
            <CampaignMetrics campaign={campaign} />
          </DarkCard>
        </div>

        {/* ── Chart ───────────────────────────── */}
        {campaign.status !== "draft" && (
          <div className="animate-fade-up-delay-1">
            <DarkCard title="Timeline de envios">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={mockChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,176,108,0.08)" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 11, fill: "#6b8a75" }}
                    axisLine={{ stroke: "rgba(63,176,108,0.12)" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#6b8a75" }}
                    axisLine={{ stroke: "rgba(63,176,108,0.12)" }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(13,26,17,0.97)",
                      border: "1px solid rgba(63,176,108,0.2)",
                      borderRadius: "12px",
                      fontSize: "12px",
                      color: "#c8dac0",
                    }}
                    cursor={{ stroke: "rgba(63,176,108,0.2)", strokeWidth: 1 }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "12px", color: "#6b8a75" }} />
                  <Line type="monotone" dataKey="enviadas"  stroke="#60a5fa" name="Enviadas"  strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="entregues" stroke="#3fb06c" name="Entregues" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="lidas"     stroke="#34d399" name="Lidas"     strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </DarkCard>
          </div>
        )}

        {/* ── Messages table ───────────────────── */}
        <div className="animate-fade-up-delay-1">
          <DarkCard title="Mensagens individuais">
            <MessagesTable campaignId={campaign.id} />
          </DarkCard>
        </div>
      </div>
    </div>
  );
}
