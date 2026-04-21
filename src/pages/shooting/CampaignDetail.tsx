import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Pause, Play, StopCircle, RefreshCw, FileText } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Topbar } from "@/components/layout/Topbar";
import { CampaignMetrics } from "./components/CampaignMetrics";
import { MessagesTable } from "./components/MessagesTable";
import { useCampaignDetail } from "@/hooks/useCampaign";
import { startCampaign, pauseCampaign, resumeCampaign, cancelCampaign } from "@/services/campaignEngine";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { CampaignStatus } from "@/types/shooting";
import { STATUS_LABELS } from "@/types/shooting";

const STATUS_STYLE: Record<CampaignStatus, { bg: string; color: string; border: string }> = {
  draft:     { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "rgba(107,114,128,0.2)"  },
  scheduled: { bg: "rgba(59,130,246,0.1)",   color: "#60a5fa", border: "rgba(59,130,246,0.2)"   },
  sending:   { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa", border: "rgba(59,130,246,0.3)"   },
  paused:    { bg: "rgba(245,158,11,0.1)",   color: "#fbbf24", border: "rgba(245,158,11,0.2)"   },
  completed: { bg: "rgba(63,176,108,0.1)",   color: "#3fb06c", border: "rgba(63,176,108,0.2)"   },
  cancelled: { bg: "rgba(107,114,128,0.08)", color: "#6b7280", border: "rgba(107,114,128,0.15)" },
  failed:    { bg: "rgba(239,68,68,0.1)",    color: "#f87171", border: "rgba(239,68,68,0.2)"    },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface TimelineBucket {
  time: string;
  enviadas: number;
  entregues: number;
  lidas: number;
}

interface MsgTimestamps {
  sent_at:      string | null;
  delivered_at: string | null;
  read_at:      string | null;
}

const BUCKET_MS = 30 * 60 * 1000; // 30-minute buckets

function buildTimeline(msgs: MsgTimestamps[]): TimelineBucket[] {
  const sent      = msgs.map((m) => m.sent_at      ? new Date(m.sent_at).getTime()      : null).filter(Boolean) as number[];
  const delivered = msgs.map((m) => m.delivered_at ? new Date(m.delivered_at).getTime() : null).filter(Boolean) as number[];
  const read      = msgs.map((m) => m.read_at      ? new Date(m.read_at).getTime()      : null).filter(Boolean) as number[];

  const allTimes = [...sent, ...delivered, ...read];
  if (allTimes.length === 0) return [];

  const minT = Math.floor(Math.min(...allTimes) / BUCKET_MS) * BUCKET_MS;
  const maxT = Math.ceil(Math.max(...allTimes)  / BUCKET_MS) * BUCKET_MS;

  const buckets: TimelineBucket[] = [];
  for (let t = minT; t <= maxT; t += BUCKET_MS) {
    buckets.push({
      time:      format(new Date(t), "HH:mm"),
      enviadas:  sent.filter((ts)      => ts <= t).length,
      entregues: delivered.filter((ts) => ts <= t).length,
      lidas:     read.filter((ts)      => ts <= t).length,
    });
  }
  return buckets;
}

function useTimelineData(campaignId: string, isLive: boolean) {
  const [chartData,    setChartData]    = useState<TimelineBucket[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchTimeline() {
    const { data } = await db
      .from("shooting_messages")
      .select("sent_at, delivered_at, read_at")
      .eq("campaign_id", campaignId)
      .not("sent_at", "is", null);

    setChartData(buildTimeline((data as MsgTimestamps[]) ?? []));
    setChartLoading(false);
  }

  useEffect(() => {
    if (!campaignId) return;
    fetchTimeline();
    if (isLive) {
      intervalRef.current = setInterval(fetchTimeline, 30_000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, isLive]);

  return { chartData, chartLoading, refetchTimeline: fetchTimeline };
}

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
  const isLive = campaign?.status === "sending";
  const { chartData, chartLoading, refetchTimeline } = useTimelineData(id ?? "", isLive);

  async function exportPdf() {
    if (!campaign) return;

    const doc  = new jsPDF({ unit: "mm", format: "a4" });
    const W    = 210;
    const DARK = [10, 26, 16]    as [number,number,number];
    const GRN  = [63, 176, 108]  as [number,number,number];
    const HEAD = [22, 56, 36]    as [number,number,number];
    const ALT  = [242, 250, 244] as [number,number,number];
    const TXT  = [20, 40, 26]    as [number,number,number];
    const MUT  = [107, 135, 115] as [number,number,number];

    // ── Logo ──────────────────────────────────────────
    let logo: string | null = null;
    try {
      const res  = await fetch("/logo.png");
      const blob = await res.blob();
      logo = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.readAsDataURL(blob);
      });
    } catch { /* sem logo */ }

    // ── Header bar ────────────────────────────────────
    doc.setFillColor(...DARK);
    doc.rect(0, 0, W, 36, "F");

    if (logo) doc.addImage(logo, "PNG", 14, 7, 30, 12);
    const textX = logo ? 50 : 14;

    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GRN);
    doc.text("SOLVE AI SHOOTING", textX, 12);

    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text(campaign.name, textX, 22);

    doc.setFontSize(8);
    doc.setTextColor(...GRN);
    doc.setFont("helvetica", "normal");
    doc.text(STATUS_LABELS[campaign.status], textX, 30);

    const dateStr = new Date().toLocaleDateString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    doc.setTextColor(160, 210, 180);
    doc.text(`Gerado em ${dateStr}`, W - 14, 30, { align: "right" });

    doc.setDrawColor(...GRN);
    doc.setLineWidth(0.6);
    doc.line(0, 36, W, 36);

    // ── Informações (2 colunas) ───────────────────────
    let y = 46;
    const MX = 14;
    const C2 = W / 2 + 4;

    const sectionLabel = (label: string, sy: number) => {
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...MUT);
      doc.text(label, MX, sy);
      doc.setDrawColor(200, 225, 210);
      doc.setLineWidth(0.25);
      doc.line(MX, sy + 1.8, W - MX, sy + 1.8);
      return sy + 7;
    };

    const kv = (label: string, value: string, x: number, ky: number) => {
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...MUT);
      doc.text(label, x, ky);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...TXT);
      doc.text(value, x + 38, ky);
      return ky + 7;
    };

    y = sectionLabel("INFORMAÇÕES DA CAMPANHA", y);

    const leftRows: [string, string][] = [
      ["Template",      campaign.meta_templates?.template_name ?? "—"],
      ["Status",        STATUS_LABELS[campaign.status]],
      ["Destinatários", campaign.total_recipients.toLocaleString("pt-BR")],
    ];
    const rightRows: [string, string][] = [
      ["Criada em", format(new Date(campaign.created_at), "dd/MM/yyyy")],
    ];
    if (campaign.started_at)   rightRows.push(["Iniciada em",  format(new Date(campaign.started_at),   "dd/MM/yyyy HH:mm")]);
    if (campaign.completed_at) rightRows.push(["Concluída em", format(new Date(campaign.completed_at), "dd/MM/yyyy HH:mm")]);

    let yL = y, yR = y;
    for (const [k, v] of leftRows)  yL = kv(k, v, MX, yL);
    for (const [k, v] of rightRows) yR = kv(k, v, C2, yR);
    y = Math.max(yL, yR) + 6;

    // ── Métricas ──────────────────────────────────────
    y = sectionLabel("MÉTRICAS DE ENVIO", y);

    const base = campaign.sent_count || 1;
    const pct  = (n: number) => `${Math.round((n / base) * 100)}%`;

    autoTable(doc, {
      head: [["Métrica", "Quantidade", "% de enviadas"]],
      body: [
        ["Enviadas",    campaign.sent_count.toLocaleString("pt-BR"),      "100%"],
        ["Entregues",   campaign.delivered_count.toLocaleString("pt-BR"), pct(campaign.delivered_count)],
        ["Lidas",       campaign.read_count.toLocaleString("pt-BR"),      pct(campaign.read_count)],
        ["Respondidas", campaign.replied_count.toLocaleString("pt-BR"),   pct(campaign.replied_count)],
        ["Falhas",      campaign.failed_count.toLocaleString("pt-BR"),    campaign.failed_count > 0 ? pct(campaign.failed_count) : "—"],
      ],
      startY: y,
      margin: { left: MX, right: MX },
      styles:     { fontSize: 9, cellPadding: 4, textColor: TXT, lineColor: [220, 235, 220], lineWidth: 0.2 },
      headStyles: { fillColor: HEAD, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9 },
      alternateRowStyles: { fillColor: ALT },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 60 },
        1: { halign: "right", cellWidth: 40 },
        2: { halign: "right", textColor: GRN, fontStyle: "bold" },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 10;

    // ── Timeline ──────────────────────────────────────
    if (chartData.length > 0) {
      y = sectionLabel("TIMELINE DE ENVIOS (30 MIN)", y);

      autoTable(doc, {
        head: [["Horário", "Enviadas (acum.)", "Entregues (acum.)", "Lidas (acum.)"]],
        body: chartData.map((b) => [b.time, b.enviadas, b.entregues, b.lidas]),
        startY: y,
        margin: { left: MX, right: MX },
        styles:     { fontSize: 8.5, cellPadding: 3.5, textColor: TXT, lineColor: [220, 235, 220], lineWidth: 0.2 },
        headStyles: { fillColor: HEAD, textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: ALT },
        columnStyles: {
          0: { fontStyle: "bold", cellWidth: 28 },
          1: { halign: "right" },
          2: { halign: "right" },
          3: { halign: "right", textColor: GRN },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }

    // ── Footer ────────────────────────────────────────
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5);
      doc.setTextColor(...MUT);
      doc.setFont("helvetica", "normal");
      doc.text("Solve AI — solveai.consulting", MX, 288);
      doc.text(`Página ${i} / ${pages}`, W - MX, 288, { align: "right" });
      doc.setDrawColor(220, 235, 220);
      doc.setLineWidth(0.2);
      doc.line(MX, 284, W - MX, 284);
    }

    doc.save(`relatorio_${campaign.name.replace(/\s+/g, "_")}.pdf`);
  }

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
              onClick={exportPdf}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors hover:bg-white/5"
              style={{ border: "1px solid rgba(63,176,108,0.12)" }}
              title="Exportar relatório PDF"
            >
              <FileText className="w-4 h-4" />
              PDF
            </button>
            <button
              onClick={refetchTimeline}
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
              {chartLoading ? (
                <div className="flex items-center justify-center h-60 text-sm text-agro-muted-2">
                  Carregando timeline…
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex items-center justify-center h-60 text-sm text-agro-muted-2">
                  Nenhum envio registrado ainda.
                </div>
              ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData}>
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
              )}
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
