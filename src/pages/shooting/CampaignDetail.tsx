import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Pause, Play, StopCircle, RefreshCw, FileText, Loader2, Pencil, Check, X, Wifi, Smartphone, Mail, Sun, Moon } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ShootingMessage } from "@/types/shooting";
import { Topbar } from "@/components/layout/Topbar";
import { CampaignMetrics } from "./components/CampaignMetrics";
import { MessagesTable } from "./components/MessagesTable";
import { useCampaignDetail } from "@/hooks/useCampaign";
import { startCampaign, pauseCampaign, resumeCampaign, cancelCampaign } from "@/services/campaignEngine";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { CampaignStatus } from "@/types/shooting";
import { STATUS_LABELS } from "@/types/shooting";
import { formatBRL } from "@/lib/format";

const STATUS_STYLE: Record<CampaignStatus, { bg: string; color: string; border: string }> = {
  draft:     { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "rgba(107,114,128,0.2)"  },
  scheduled: { bg: "rgba(59,130,246,0.1)",   color: "#60a5fa", border: "rgba(59,130,246,0.2)"   },
  sending:   { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa", border: "rgba(59,130,246,0.3)"   },
  paused:    { bg: "rgba(245,158,11,0.1)",   color: "#fbbf24", border: "rgba(245,158,11,0.2)"   },
  completed: { bg: "rgba(63,176,108,0.1)",   color: "#3fb06c", border: "rgba(63,176,108,0.2)"   },
  cancelled: { bg: "rgba(107,114,128,0.08)", color: "#6b7280", border: "rgba(107,114,128,0.15)" },
  failed:    { bg: "rgba(239,68,68,0.1)",    color: "#f87171", border: "rgba(239,68,68,0.2)"    },
};


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

// ── Theme ─────────────────────────────────────────────────────────
type Theme = typeof DARK_THEME;
const DARK_THEME = {
  pageBg:        "#0a110e",
  cardBg:        "rgba(13,26,17,0.7)",
  cardBorder:    "rgba(63,176,108,0.1)",
  cardShadow:    "none",
  text:          undefined as string | undefined,
  muted:         undefined as string | undefined,
  muted2:        undefined as string | undefined,
  gridStroke:    "rgba(63,176,108,0.08)",
  axisStroke:    "rgba(63,176,108,0.12)",
  tickFill:      "#6b8a75",
  tooltipBg:     "rgba(13,26,17,0.97)",
  tooltipBorder: "rgba(63,176,108,0.2)",
  tooltipColor:  "#c8dac0",
  btnBorder:     "rgba(63,176,108,0.12)",
  btnHover:      "hover:bg-white/10",
};
const LIGHT_THEME: Theme = {
  pageBg:        "#f0f2f1",
  cardBg:        "#ffffff",
  cardBorder:    "rgba(0,0,0,0.07)",
  cardShadow:    "0 2px 12px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04)",
  text:          "#0a1f10",
  muted:         "#4a7055",
  muted2:        "#7a9b85",
  gridStroke:    "rgba(63,176,108,0.14)",
  axisStroke:    "rgba(63,176,108,0.2)",
  tickFill:      "#4a7055",
  tooltipBg:     "rgba(255,255,255,0.98)",
  tooltipBorder: "rgba(63,176,108,0.25)",
  tooltipColor:  "#0a1f10",
  btnBorder:     "rgba(0,0,0,0.1)",
  btnHover:      "hover:bg-black/5",
};

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
    const { data } = await supabase
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

function DarkCard({ title, children, T }: { title: string; children: React.ReactNode; T: Theme }) {
  return (
    <div className="rounded-2xl p-6 transition-all duration-300"
      style={{
        background: T.cardBg,
        backdropFilter: "blur(20px)",
        border: `1px solid ${T.cardBorder}`,
        boxShadow: T.cardShadow,
      }}
    >
      <h2 className="text-sm font-semibold text-agro-text mb-5" style={{ color: T.text }}>{title}</h2>
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
  const [exportingPdf,  setExportingPdf]  = useState(false);
  const [actionLoading, setActionLoading] = useState<"pause" | "resume" | "cancel" | "start" | null>(null);
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [editingName, setEditingName] = useState<string | null>(null);
  const [savingName,  setSavingName]  = useState(false);
  const [lightMode,   setLightMode]   = useState(false);

  const T = lightMode ? LIGHT_THEME : DARK_THEME;

  async function handleRenameSave() {
    if (!campaign || !editingName) return;
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === campaign.name) { setEditingName(null); return; }
    setSavingName(true);
    const { error } = await supabase.from("shooting_campaigns").update({ name: trimmed }).eq("id", campaign.id);
    setSavingName(false);
    if (error) {
      toast({ title: "Erro ao renomear campanha", variant: "destructive" });
    } else {
      toast({ title: "Campanha renomeada", variant: "success" });
      setEditingName(null);
    }
  }

  async function exportPdf() {
    if (!campaign) return;
    setExportingPdf(true);

    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const W  = 297;
      const MX = 14;
      const FOOTER_Y = 203;

      // Brand palette
      const GREEN  = [22, 163, 74]   as [number,number,number];
      const TEAL   = [16, 132, 163]  as [number,number,number];
      const BLUE   = [37, 99, 235]   as [number,number,number];
      const RED    = [220, 38, 38]   as [number,number,number];
      const DARK   = [25, 25, 25]    as [number,number,number];
      const MUTED  = [130, 130, 130] as [number,number,number];
      const AMBER  = [180, 120, 0]   as [number,number,number];

      // Logo
      let logo: string | null = null;
      try {
        const res  = await fetch("/logo.png");
        const blob = await res.blob();
        logo = await new Promise<string>((res2) => {
          const r = new FileReader();
          r.onload = () => res2(r.result as string);
          r.readAsDataURL(blob);
        });
      } catch { /* sem logo */ }

      // Fetch all messages
      const { data: rawMsgs } = await supabase
        .from("shooting_messages")
        .select("*")
        .eq("campaign_id", campaign.id)
        .order("sent_at", { ascending: true, nullsFirst: false });
      const messages: ShootingMessage[] = rawMsgs ?? [];

      function parseBRL(raw: unknown): number {
        if (typeof raw === "number") return raw;
        const s = String(raw).replace(/[^\d,]/g, "");
        return parseFloat(s.replace(",", "."));
      }
      let totalValue = 0;
      for (const m of messages) {
        const rd = m.recipient_data as Record<string, unknown> | null;
        if (!rd) continue;
        let raw: unknown;
        if (rd._financial_campaign === true) {
          raw = rd.valor_total_pendente;
        } else {
          const key = Object.keys(rd).find((k) => {
            const lk = k.toLowerCase();
            return ["valor", "value", "total", "amount"].some((t) => lk.includes(t)) && !lk.includes("barras");
          });
          raw = key ? rd[key] : null;
        }
        if (raw == null) continue;
        const n = parseBRL(raw);
        if (!isNaN(n) && n > 0) totalValue += n;
      }

      // Computed metrics
      const total      = campaign.total_recipients;
      const sent       = campaign.sent_count - campaign.failed_count;
      const delivered  = campaign.delivered_count;
      const read       = campaign.read_count;
      const failed     = campaign.failed_count;
      const attempted  = campaign.sent_count;
      const pending    = Math.max(0, total - attempted);
      const sentPct    = total     > 0 ? (sent      / total     * 100) : 0;
      const delivPct   = sent      > 0 ? (delivered / sent      * 100) : 0;
      const readPct    = sent      > 0 ? (read      / sent      * 100) : 0;
      const failPct    = attempted > 0 ? (failed    / attempted * 100) : 0;
      const successPct = attempted > 0 ? (sent      / attempted * 100) : 0;
      const isComplete = ["completed", "cancelled"].includes(campaign.status) || pending === 0;

      // HEADER
      const LOGO_SIZE = 26;
      let y = MX;

      if (logo) doc.addImage(logo, "PNG", MX, y, LOGO_SIZE, LOGO_SIZE);
      const tX = logo ? MX + LOGO_SIZE + 6 : MX;

      doc.setFontSize(21);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...DARK);
      doc.text("Relatorio de Disparo", tX, y + 9);

      doc.setFontSize(10);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(...MUTED);
      doc.text("Inteligencia que cultiva resultados", tX, y + 17);

      const now = new Date();
      const dateStr = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
        + " as " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.text(`Gerado em ${dateStr}`, tX, y + 23);

      y += LOGO_SIZE + 4;
      doc.setDrawColor(...DARK);
      doc.setLineWidth(1);
      doc.line(MX, y, W - MX, y);
      y += 7;

      const sectionBar = (label: string, sy: number): number => {
        doc.setFillColor(30, 30, 30);
        doc.rect(MX, sy, W - MX * 2, 8, "F");
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(255, 255, 255);
        doc.text(label, MX + 4, sy + 5.5);
        return sy + 12;
      };

      const infoLine = (label: string, value: string, x: number, iy: number): number => {
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...DARK);
        doc.text(`${label}: `, x, iy);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        doc.text(value, x + doc.getTextWidth(`${label}: `), iy);
        return iy + 7;
      };

      // INFORMACOES DO DISPARO
      y = sectionBar("INFORMACOES DO DISPARO", y);
      const c2 = MX + (W - MX * 2) / 2 + 4;
      const SOURCE_PT: Record<string, string> = {
        contacts: "Contatos da base", xlsx_upload: "Planilha importada",
      };
      const isPdfEmail = campaign.dispatch_channel === "n8n_email";
      let yL = y, yR = y;
      yL = infoLine("Nome do Disparo", campaign.name, MX, yL);
      yL = infoLine(
        isPdfEmail ? "Canal" : "Template",
        isPdfEmail ? "Email via N8N" : (campaign.meta_templates?.template_name ?? "--"),
        MX, yL,
      );
      yR = infoLine("Tipo", SOURCE_PT[campaign.data_source] ?? campaign.data_source, c2, yR);
      const statusLabel = isComplete
        ? (campaign.status === "cancelled" ? "Cancelada" : "Concluida")
        : `Em andamento (${pending} mensagem${pending !== 1 ? "s" : ""} na fila)`;
      yR = infoLine("Status", statusLabel, c2, yR);
      if (campaign.started_at)   yR = infoLine("Iniciada em",  format(new Date(campaign.started_at),   "dd/MM/yyyy HH:mm"), c2, yR);
      if (campaign.completed_at) yR = infoLine("Concluida em", format(new Date(campaign.completed_at), "dd/MM/yyyy HH:mm"), c2, yR);
      y = Math.max(yL, yR) + 6;

      // RESUMO DE RESULTADOS
      y = sectionBar("RESUMO DE RESULTADOS", y);

      // 2-column layout: cards left (52%) | funnel right (48%)
      const splitX     = MX + (W - MX * 2) * 0.52;
      const cardsAreaW = splitX - MX - 4;
      const funnelX    = splitX + 4;
      const funnelAreaW = W - MX - funnelX;

      // Left: 6 metric cards
      const CARDS = [
        { label: "Total de Contatos", value: total.toLocaleString("pt-BR"),     sub: null,                                                       color: DARK  },
        { label: "Enviados",          value: sent.toLocaleString("pt-BR"),      sub: `${sentPct.toFixed(1)}% do total`,                          color: GREEN },
        { label: "Taxa de Sucesso",   value: `${successPct.toFixed(1)}%`,        sub: "dos tentados",                                             color: GREEN },
        { label: "Entregues",         value: delivered.toLocaleString("pt-BR"), sub: `${delivPct.toFixed(1)}% dos enviados`,                     color: TEAL  },
        { label: "Lidos",             value: read.toLocaleString("pt-BR"),      sub: `${readPct.toFixed(1)}% dos enviados`,                      color: BLUE  },
        { label: "Falhas",            value: failed.toLocaleString("pt-BR"),    sub: failed > 0 ? `${failPct.toFixed(1)}% dos tentados` : "Nenhuma falha", color: failed > 0 ? RED : GREEN },
      ];

      const cols  = 3;
      const cardW = (cardsAreaW - (cols - 1) * 3) / cols;
      const cardH = 22;

      CARDS.forEach((card, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = MX + col * (cardW + 3);
        const cy = y + row * (cardH + 3);

        doc.setFillColor(250, 252, 250);
        doc.setDrawColor(210, 225, 215);
        doc.setLineWidth(0.3);
        doc.roundedRect(cx, cy, cardW, cardH, 2, 2, "FD");

        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...MUTED);
        doc.text(card.label, cx + cardW / 2, cy + 6, { align: "center" });

        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...card.color);
        doc.text(card.value, cx + cardW / 2, cy + 15, { align: "center" });

        if (card.sub) {
          doc.setFontSize(6);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(...MUTED);
          doc.text(card.sub, cx + cardW / 2, cy + 20.5, { align: "center" });
        }
      });

      const cardsBottom = y + 2 * (cardH + 3) - 3;

      if (totalValue > 0) {
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...DARK);
        doc.text(
          `Valor total disparado: ${formatBRL(totalValue)}`,
          MX, cardsBottom + 6,
        );
      }

      // Right: funnel visualization
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...MUTED);
      doc.text("FUNIL DE ENTREGA", funnelX, y - 2);
      doc.setDrawColor(...MUTED);
      doc.setLineWidth(0.2);
      doc.line(funnelX, y, funnelX + funnelAreaW, y);

      const funnelLabelW  = 28;
      const funnelBarMaxW = funnelAreaW - funnelLabelW - 28;
      const funnelBarH    = 10;
      const funnelGap     = 4;

      const FUNNEL_ROWS = [
        { label: "Total",     value: total,     base: total, color: [200, 210, 205] as [number,number,number], textColor: MUTED  },
        { label: "Enviados",  value: sent,      base: total, color: GREEN,                                     textColor: GREEN  },
        { label: "Entregues", value: delivered, base: total, color: TEAL,                                      textColor: TEAL   },
        { label: "Lidos",     value: read,      base: total, color: BLUE,                                      textColor: BLUE   },
        { label: "Falhas",    value: failed,    base: total, color: RED,                                       textColor: RED    },
      ];

      let fy = y + 5;
      for (const item of FUNNEL_ROWS) {
        const pct  = item.base > 0 ? item.value / item.base : 0;
        const barW = Math.max(funnelBarMaxW * pct, item.value > 0 ? 2 : 0);

        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...MUTED);
        doc.text(item.label, funnelX + funnelLabelW - 2, fy + funnelBarH / 2 + 2.5, { align: "right" });

        doc.setFillColor(232, 238, 234);
        doc.roundedRect(funnelX + funnelLabelW, fy, funnelBarMaxW, funnelBarH, 1.5, 1.5, "F");

        if (barW > 0) {
          doc.setFillColor(...item.color);
          doc.roundedRect(funnelX + funnelLabelW, fy, barW, funnelBarH, 1.5, 1.5, "F");
        }

        const pctStr = pct > 0 && item.label !== "Total" ? ` (${(pct * 100).toFixed(1)}%)` : "";
        doc.setFontSize(7);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...item.textColor);
        doc.text(
          `${item.value.toLocaleString("pt-BR")}${pctStr}`,
          funnelX + funnelLabelW + funnelBarMaxW + 3,
          fy + funnelBarH / 2 + 2.5,
        );

        fy += funnelBarH + funnelGap;
      }

      y = Math.max(cardsBottom + (totalValue > 0 ? 14 : 5), fy + 4);

      // Insight callout
      if (attempted > 0) {
        let insightText: string;
        let iColor: [number,number,number];
        let iBg:    [number,number,number];
        let iBorder:[number,number,number];

        if (successPct >= 95) {
          insightText = `Taxa de sucesso de ${successPct.toFixed(1)}% -- excelente desempenho de entrega`;
          iColor  = GREEN;
          iBg     = [240, 253, 244];
          iBorder = [187, 247, 208];
        } else if (successPct >= 85) {
          insightText = `Taxa de sucesso de ${successPct.toFixed(1)}% -- dentro da media esperada`;
          iColor  = AMBER;
          iBg     = [255, 251, 235];
          iBorder = [253, 230, 138];
        } else {
          insightText = `Atencao: taxa de sucesso de ${successPct.toFixed(1)}% -- verifique a qualidade da base`;
          iColor  = RED;
          iBg     = [254, 242, 242];
          iBorder = [252, 165, 165];
        }

        const boxH = 10;
        doc.setFillColor(...iBg);
        doc.setDrawColor(...iBorder);
        doc.setLineWidth(0.4);
        doc.roundedRect(MX, y, W - MX * 2, boxH, 2, 2, "FD");
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...iColor);
        doc.text(insightText, MX + 5, y + 6.8);

        if (!isComplete && pending > 0) {
          doc.setFontSize(7.5);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(...MUTED);
          doc.text(
            `Campanha em andamento -- ${pending} na fila`,
            W - MX - 5, y + 6.8, { align: "right" },
          );
        }
        y += boxH + 6;
      }

      // LISTA DE DESTINATARIOS
      y = sectionBar("LISTA DE DESTINATARIOS", y);

      const hasFinancialRd = messages.some((m) => {
        const rd = m.recipient_data as Record<string, unknown> | null;
        return rd && rd._financial_campaign === true;
      });

      const STATUS_PT: Record<string, string> = {
        pending: "Na fila", sent: "Enviado", delivered: "Entregue",
        read: "Lido", replied: "Respondido", failed: "Falhou", undeliverable: "Nao entregavel",
      };

      const isEmailCampaign = campaign.dispatch_channel === "n8n_email";
      const head: string[] = ["#", "Nome", isEmailCampaign ? "Email" : "Telefone"];
      if (hasFinancialRd) head.push("No NF(s)", "Qtd", "Valor", "Vencimento");
      head.push("Status", "Enviado em");

      const statusColIdx = head.indexOf("Status");

      // Failures first, then chronological
      const sortedMsgs = [...messages].sort((a, b) => {
        if (a.status === "failed" && b.status !== "failed") return -1;
        if (a.status !== "failed" && b.status === "failed") return 1;
        return (a.sent_at ?? "").localeCompare(b.sent_at ?? "");
      });

      const body = sortedMsgs.map((m, idx) => {
        const rd = m.recipient_data as Record<string, unknown> | null ?? {};
        const contactCol = isEmailCampaign ? ((rd.email as string) ?? "--") : m.recipient_phone;
        const row: string[] = [`${idx + 1}`, m.recipient_name ?? "--", contactCol];

        if (hasFinancialRd) {
          const invIds = rd._invoice_ids as string[] | null;
          const allInvs = rd.contact_invoices as Array<{ id: string; numero_nf: string | null }> | null;
          const nfs = invIds && allInvs
            ? allInvs.filter((inv) => invIds.includes(inv.id)).map((inv) => inv.numero_nf || "--").join(", ")
            : (rd.boleto_nf as string | null) ?? "--";
          row.push(nfs || "--");
          row.push(String(rd._invoice_count ?? (invIds?.length ?? "--")));
          row.push(typeof rd.valor_total_pendente === "string" ? rd.valor_total_pendente : "--");
          row.push(typeof rd.proximo_vencimento   === "string" ? rd.proximo_vencimento   : "--");
        }

        row.push(STATUS_PT[m.status] ?? m.status);
        row.push(m.sent_at ? format(new Date(m.sent_at), "dd/MM/yyyy, HH:mm") : "--");
        return row;
      });

      autoTable(doc, {
        head:  [head],
        body,
        startY: y,
        margin: { left: MX, right: MX },
        styles:     { fontSize: 8, cellPadding: 2.5, textColor: [25, 25, 25], lineColor: [215, 215, 215], lineWidth: 0.2 },
        headStyles: { fillColor: [75, 75, 75], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 248] },
        columnStyles: { 0: { cellWidth: 12, halign: "center" } },
        didParseCell: (data: { column: { index: number }; section: string; cell: { raw: unknown; styles: { textColor: number[]; fontStyle: string } } }) => {
          if (data.section !== "body" || data.column.index !== statusColIdx) return;
          const v = data.cell.raw as string;
          if (["Enviado", "Entregue", "Lido", "Respondido"].includes(v)) {
            data.cell.styles.textColor = [22, 163, 74];
          } else if (["Falhou", "Nao entregavel"].includes(v)) {
            data.cell.styles.textColor = [220, 38, 38];
            data.cell.styles.fontStyle = "bold";
          } else if (v === "Na fila") {
            data.cell.styles.textColor = [130, 130, 130];
          }
        },
      } as never);

      // Footer
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.2);
        doc.line(MX, FOOTER_Y, W - MX, FOOTER_Y);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(150, 150, 150);
        doc.text("Solve AI -- solveai.consulting", MX, FOOTER_Y + 4);
        doc.text(`Pagina ${i} / ${pages}`, W - MX, FOOTER_Y + 4, { align: "right" });
      }

      doc.save(`relatorio_${campaign.name.replace(/\s+/g, "_")}.pdf`);
    } finally {
      setExportingPdf(false);
    }
  }


  async function handleAction(action: "pause" | "resume" | "cancel") {
    if (!id || actionLoading) return;
    setActionLoading(action);
    try {
      if (action === "pause")  await pauseCampaign(id);
      if (action === "resume") await resumeCampaign(id);
      if (action === "cancel") await cancelCampaign(id);
      toast({ title: "Ação realizada com sucesso", variant: "success" });
    } catch {
      toast({ title: "Erro ao executar ação", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }

  if (loading || !campaign) {
    return (
      <div className="min-h-screen" style={{ background: T.pageBg }}>
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
    <div className="min-h-screen transition-colors duration-300" style={{ background: T.pageBg }}>
      <Topbar breadcrumbs={[{ label: "Shooting", href: "/shooting" }, { label: campaign.name }]} />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* ── Header ──────────────────────────── */}
        <div className="flex items-start justify-between animate-fade-up">
          <div className="flex items-start gap-4">
            <button
              onClick={() => navigate("/shooting")}
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-agro-muted transition-colors mt-0.5 ${T.btnHover}`}
              style={{ border: `1px solid ${T.btnBorder}`, color: T.muted }}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                {isAdmin && editingName !== null ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")  handleRenameSave();
                        if (e.key === "Escape") setEditingName(null);
                      }}
                      className="font-display text-2xl font-bold bg-transparent border-b-2 border-[#3fb06c] text-agro-text outline-none w-72"
                    />
                    <button onClick={handleRenameSave} disabled={savingName} className="text-[#3fb06c] hover:text-green-300 transition-colors">
                      {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </button>
                    <button onClick={() => setEditingName(null)} className="text-agro-muted hover:text-agro-text transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 group">
                    <h1 className="font-display text-2xl font-bold text-agro-text" style={{ color: T.text }}>{campaign.name}</h1>
                    {isAdmin && (
                      <button
                        onClick={() => setEditingName(campaign.name)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-agro-muted hover:text-agro-text"
                        title="Renomear campanha"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                  style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}
                >
                  {campaign.status === "sending" && (
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  )}
                  {STATUS_LABELS[campaign.status]}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-agro-muted flex-wrap" style={{ color: T.muted }}>
                {campaign.dispatch_channel === "z_api" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold"
                    style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.25)" }}
                  >
                    <Smartphone className="w-2.5 h-2.5" />
                    Z-API · Texto livre
                  </span>
                ) : campaign.dispatch_channel === "n8n_email" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold"
                    style={{ background: "rgba(14,165,233,0.1)", color: "#38bdf8", border: "1px solid rgba(14,165,233,0.25)" }}
                  >
                    <Mail className="w-2.5 h-2.5" />
                    Email via N8N
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Wifi className="w-3 h-3 text-blue-400" />
                    <span className="text-blue-400 font-medium">Meta API</span>
                    {campaign.meta_templates?.template_name && (
                      <><span className="text-agro-muted-2">·</span><span className="font-medium text-agro-text">{campaign.meta_templates.template_name}</span></>
                    )}
                  </span>
                )}
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
                  disabled={actionLoading !== null}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ border: "1px solid rgba(63,176,108,0.15)" }}
                >
                  {actionLoading === "pause" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                  Pausar
                </button>
                <button
                  onClick={() => handleAction("cancel")}
                  disabled={actionLoading !== null}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-red-400 hover:text-red-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ border: "1px solid rgba(239,68,68,0.2)" }}
                >
                  {actionLoading === "cancel" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StopCircle className="w-3.5 h-3.5" />}
                  Cancelar
                </button>
              </>
            )}
            {campaign.status === "paused" && (
              <button
                onClick={() => handleAction("resume")}
                disabled={actionLoading !== null}
                className="btn-agro flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {actionLoading === "resume" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Retomar
              </button>
            )}
            {(campaign.status === "draft" || campaign.status === "scheduled") && campaign.dispatch_channel !== "n8n_email" && (
              <button
                disabled={actionLoading !== null}
                onClick={async () => {
                  if (actionLoading) return;
                  setActionLoading("start");
                  try {
                    await startCampaign(id!);
                    toast({ title: "Disparo iniciado!", variant: "success" });
                  } catch {
                    toast({ title: "Erro ao iniciar campanha", variant: "destructive" });
                  } finally {
                    setActionLoading(null);
                  }
                }}
                className="btn-agro flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {actionLoading === "start" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Iniciar
              </button>
            )}
            <button
              onClick={exportPdf}
              disabled={exportingPdf}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${T.btnHover}`}
              style={{ border: `1px solid ${T.btnBorder}`, color: T.muted }}
              title="Exportar relatório PDF"
            >
              {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {exportingPdf ? "Gerando…" : "PDF"}
            </button>
            <button
              onClick={refetchTimeline}
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-agro-muted transition-colors ${T.btnHover}`}
              style={{ border: `1px solid ${T.btnBorder}`, color: T.muted }}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {/* Light/dark toggle */}
            <button
              onClick={() => setLightMode((v) => !v)}
              title={lightMode ? "Modo escuro" : "Modo claro"}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-105"
              style={{
                background: lightMode ? "rgba(255,255,255,0.9)" : "rgba(13,26,17,0.8)",
                border: `1px solid ${T.cardBorder}`,
                boxShadow: T.cardShadow,
                color: lightMode ? "#a06b0a" : "#6b8a75",
              }}
            >
              {lightMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* ── Metrics ─────────────────────────── */}
        <div className="animate-fade-up-delay-1">
          <DarkCard title="Métricas em tempo real" T={T}>
            <CampaignMetrics campaign={campaign} light={lightMode} />
          </DarkCard>
        </div>

        {/* ── Chart ───────────────────────────── */}
        {campaign.status !== "draft" && campaign.dispatch_channel !== "n8n_email" && (
          <div className="animate-fade-up-delay-1">
            <DarkCard title="Timeline de envios" T={T}>
              {chartLoading ? (
                <div className="flex items-center justify-center h-60 text-sm" style={{ color: T.muted2 }}>
                  Carregando timeline…
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex items-center justify-center h-60 text-sm" style={{ color: T.muted2 }}>
                  Nenhum envio registrado ainda.
                </div>
              ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.gridStroke} />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 11, fill: T.tickFill }}
                    axisLine={{ stroke: T.axisStroke }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: T.tickFill }}
                    axisLine={{ stroke: T.axisStroke }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: T.tooltipBg,
                      border: `1px solid ${T.tooltipBorder}`,
                      borderRadius: "12px",
                      fontSize: "12px",
                      color: T.tooltipColor,
                    }}
                    cursor={{ stroke: "rgba(63,176,108,0.2)", strokeWidth: 1 }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "12px", color: T.tickFill }} />
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
          <DarkCard title="Mensagens individuais" T={T}>
            <MessagesTable campaignId={campaign.id} dispatchChannel={campaign.dispatch_channel} light={lightMode} />
          </DarkCard>
        </div>
      </div>
    </div>
  );
}
