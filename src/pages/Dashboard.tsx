import { useState } from "react";
import {
  Send, Users, MessageSquare, Zap, Clock, DollarSign,
  Download, FileText, Loader2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, subDays } from "date-fns";
import { Topbar } from "@/components/layout/Topbar";
import {
  useDashboardMetrics, fmtCount, fmtTime, fmtBRL,
  periodRangeLabel,
  type DashboardDateRange,
} from "@/hooks/useDashboardMetrics";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Period options ────────────────────────────────────────────────
const DATE_OPTS: { id: DashboardDateRange; label: string }[] = [
  { id: "7d",  label: "7 dias"  },
  { id: "30d", label: "30 dias" },
  { id: "90d", label: "90 dias" },
  { id: "all", label: "Todos"   },
];

// ── Fetch campaign list for exports ──────────────────────────────
async function fetchCampaignsForExport(workspaceId: string, periodStart: string | null) {
  let q = db
    .from("shooting_campaigns")
    .select(
      "name, status, dispatch_channel, total_recipients, sent_count, delivered_count, " +
      "read_count, failed_count, started_at, completed_at, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (periodStart) q = q.gte("created_at", periodStart);
  const { data } = await q;
  return (data ?? []) as Array<{
    name: string; status: string; dispatch_channel: string | null;
    total_recipients: number | null; sent_count: number | null;
    delivered_count: number | null; read_count: number | null;
    failed_count: number | null; started_at: string | null;
    completed_at: string | null; created_at: string;
  }>;
}

function campStatus(s: string) {
  const MAP: Record<string, string> = {
    draft: "Rascunho", scheduled: "Agendado", sending: "Enviando",
    paused: "Pausado", completed: "Concluído", cancelled: "Cancelado", failed: "Falhou",
  };
  return MAP[s] ?? s;
}

function campRate(c: { sent_count: number | null; delivered_count: number | null; dispatch_channel: string | null; total_recipients: number | null }) {
  const sent = c.sent_count ?? 0;
  if (c.dispatch_channel === "n8n_email") {
    const tot = c.total_recipients ?? 0;
    return tot > 0 ? Math.round((sent / tot) * 100) : 0;
  }
  return sent > 0 ? Math.round(((c.delivered_count ?? 0) / sent) * 100) : 0;
}

// ── StatCard ──────────────────────────────────────────────────────
function StatCard({
  icon: Icon, label, value, trend, color, glowColor, loading,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string; value: string; trend: string | null;
  color: string; glowColor: string; loading: boolean;
}) {
  return (
    <div className="p-5 rounded-2xl transition-all duration-300 hover:scale-[1.02]"
      style={{ background: "rgba(13,26,17,0.7)", backdropFilter: "blur(16px)", border: "1px solid rgba(63,176,108,0.1)" }}
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
        style={{ background: `${glowColor}20`, border: `1px solid ${glowColor}` }}
      >
        <Icon className="w-4.5 h-4.5" style={{ color }} />
      </div>
      {loading ? (
        <>
          <div className="h-7 w-20 rounded-lg animate-pulse mb-1" style={{ background: "rgba(63,176,108,0.08)" }} />
          <div className="h-3 w-28 rounded animate-pulse mt-1"   style={{ background: "rgba(63,176,108,0.05)" }} />
        </>
      ) : (
        <>
          <p className="font-display text-2xl font-bold text-agro-text">{value}</p>
          <p className="text-xs text-agro-muted mt-0.5">{label}</p>
          {trend && <p className="text-xs font-semibold mt-2" style={{ color }}>{trend}</p>}
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
export function Dashboard() {
  const navigate = useNavigate();
  const { workspaceId } = useAuth();

  const [dateRange,     setDateRange]     = useState<DashboardDateRange>("all");
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingPdf,  setExportingPdf]  = useState(false);

  const metrics = useDashboardMetrics(dateRange);

  // Compute periodStart for exports (mirrors hook logic)
  const periodStart: string | null = dateRange === "all"
    ? null
    : subDays(new Date(), dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90).toISOString();

  const rangeLabel = periodRangeLabel(dateRange);

  // ── Stats array ──────────────────────────────────────────────
  const stats = [
    {
      icon:      Send,
      label:     "Campanhas",
      value:     fmtCount(metrics.activeCampaigns),
      trend:     metrics.campaignsThisMonth > 0 ? `+${metrics.campaignsThisMonth} ${metrics.periodLabel}` : null,
      color:     "#60a5fa",
      glowColor: "rgba(59,130,246,0.25)",
    },
    {
      icon:      MessageSquare,
      label:     "Mensagens enviadas",
      value:     fmtCount(metrics.messagesSent),
      trend:     metrics.messagesThisMonth > 0 ? `+${fmtCount(metrics.messagesThisMonth)} ${metrics.periodLabel}` : null,
      color:     "#3fb06c",
      glowColor: "rgba(63,176,108,0.25)",
    },
    {
      icon:      Users,
      label:     "Contatos no Inbox",
      value:     fmtCount(metrics.activeContacts),
      trend:     metrics.contactsThisMonth > 0 ? `+${metrics.contactsThisMonth} ${metrics.periodLabel}` : null,
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

  // ── XLSX Export ───────────────────────────────────────────────
  async function exportXlsx() {
    if (!workspaceId) return;
    setExportingXlsx(true);
    try {
      const campaigns = await fetchCampaignsForExport(workspaceId, periodStart);
      const now = new Date();
      const wb  = XLSX.utils.book_new();

      // Sheet 1 — Resumo
      const resumo = [
        { "Informação": "Período",              "Valor": rangeLabel },
        { "Informação": "Gerado em",            "Valor": format(now, "dd/MM/yyyy HH:mm") },
        { "Informação": "",                     "Valor": "" },
        { "Informação": "Campanhas",            "Valor": metrics.activeCampaigns },
        { "Informação": `  ${metrics.periodLabel}`, "Valor": metrics.campaignsThisMonth },
        { "Informação": "Mensagens enviadas",   "Valor": metrics.messagesSent },
        { "Informação": `  ${metrics.periodLabel}`, "Valor": metrics.messagesThisMonth },
        { "Informação": "Contatos no Inbox",    "Valor": metrics.activeContacts },
        { "Informação": `  ${metrics.periodLabel}`, "Valor": metrics.contactsThisMonth },
        { "Informação": "Taxa de entrega (%)",  "Valor": metrics.deliveryRate },
        { "Informação": "Economia de tempo",    "Valor": fmtTime(metrics.timeSavedMinutes) },
        { "Informação": "Valor disparado (R$)", "Valor": metrics.valueDispatched },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Resumo");

      // Sheet 2 — Atividade diária
      const daily = metrics.dailyMessages.map((d) => ({
        "Data":     d.date,
        "Enviadas": d.enviadas,
        "Lidas":    d.lidas,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(daily), `Atividade (${metrics.chartDays}d)`);

      // Sheet 3 — Campanhas
      const campRows = campaigns.map((c) => ({
        "Nome":             c.name,
        "Canal":            c.dispatch_channel === "n8n_email" ? "Email via N8N" : "WhatsApp",
        "Status":           campStatus(c.status),
        "Destinatários":    c.total_recipients ?? 0,
        "Enviadas":         c.sent_count ?? 0,
        "Entregues":        c.dispatch_channel === "n8n_email" ? (c.sent_count ?? 0) : (c.delivered_count ?? 0),
        "Lidas":            c.dispatch_channel === "n8n_email" ? "" : (c.read_count ?? 0),
        "Falhas":           c.failed_count ?? 0,
        "Taxa entrega (%)": campRate(c),
        "Criada em":        format(new Date(c.created_at), "dd/MM/yyyy HH:mm"),
        "Iniciada em":      c.started_at   ? format(new Date(c.started_at),   "dd/MM/yyyy HH:mm") : "",
        "Concluída em":     c.completed_at ? format(new Date(c.completed_at), "dd/MM/yyyy HH:mm") : "",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(campRows), "Campanhas");

      XLSX.writeFile(wb, `dashboard_${dateRange}_${now.toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExportingXlsx(false);
    }
  }

  // ── PDF Export ────────────────────────────────────────────────
  async function exportPdf() {
    if (!workspaceId) return;
    setExportingPdf(true);
    try {
      const campaigns = await fetchCampaignsForExport(workspaceId, periodStart);
      const now = new Date();
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const W = 297, MX = 14;

      // ── Logo ─────────────────────────────────────────────────
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

      const LOGO_SIZE = 28;
      let y = MX;
      if (logo) doc.addImage(logo, "PNG", MX, y, LOGO_SIZE, LOGO_SIZE);
      const tX = logo ? MX + LOGO_SIZE + 6 : MX;

      doc.setFontSize(20); doc.setFont("helvetica", "bold"); doc.setTextColor(25, 25, 25);
      doc.text("Relatório do Dashboard", tX, y + 9);

      doc.setFontSize(10); doc.setFont("helvetica", "italic"); doc.setTextColor(120, 120, 120);
      doc.text("Inteligência que cultiva resultados", tX, y + 16);

      doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(100, 100, 100);
      doc.text(`Período: ${rangeLabel}`, tX, y + 23);
      doc.text(
        `Gerado em ${now.toLocaleDateString("pt-BR")} às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
        tX, y + 29,
      );

      y += LOGO_SIZE + 6;
      doc.setDrawColor(25, 25, 25); doc.setLineWidth(1.0);
      doc.line(MX, y, W - MX, y);
      y += 8;

      // ── Helpers ──────────────────────────────────────────────
      const sectionBar = (label: string, sy: number): number => {
        doc.setFillColor(30, 30, 30);
        doc.rect(MX, sy, W - MX * 2, 8, "F");
        doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255);
        doc.text(label, MX + 3, sy + 5.5);
        return sy + 12;
      };

      const metricBox = (label: string, value: string, color: [number, number, number], bx: number, by: number, bw: number, bh: number) => {
        doc.setFillColor(248, 250, 248); doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3);
        doc.roundedRect(bx, by, bw, bh, 2, 2, "FD");
        doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(130, 130, 130);
        doc.text(label, bx + bw / 2, by + 8, { align: "center" });
        doc.setFontSize(16); doc.setFont("helvetica", "bold"); doc.setTextColor(...color);
        doc.text(value, bx + bw / 2, by + 19, { align: "center" });
      };

      // ── MÉTRICAS PRINCIPAIS ──────────────────────────────────
      y = sectionBar("MÉTRICAS PRINCIPAIS", y);
      const totalW = W - MX * 2;
      const cw4 = (totalW - 3 * 4) / 4;
      const bh  = 26;

      const mainCards = [
        { label: "Campanhas",         value: metrics.activeCampaigns.toLocaleString("pt-BR"),  color: [59, 130, 246]   as [number,number,number] },
        { label: "Mensagens enviadas", value: metrics.messagesSent.toLocaleString("pt-BR"),      color: [63, 176, 108]   as [number,number,number] },
        { label: "Contatos no Inbox",  value: metrics.activeContacts.toLocaleString("pt-BR"),   color: [167, 139, 250]  as [number,number,number] },
        { label: "Taxa de entrega",    value: metrics.messagesSent > 0 ? `${metrics.deliveryRate}%` : "—", color: [52, 211, 153] as [number,number,number] },
      ];
      mainCards.forEach((card, i) => {
        metricBox(card.label, card.value, card.color, MX + i * (cw4 + 4), y, cw4, bh);
      });
      y += bh + 4;

      const cw2 = (totalW - 4) / 2;
      const extraCards = [
        { label: "Economia de tempo",    value: fmtTime(metrics.timeSavedMinutes),                     color: [245, 158, 11]  as [number,number,number] },
        { label: "Valor disparado (R$)", value: metrics.valueDispatched > 0 ? fmtBRL(metrics.valueDispatched) : "—", color: [52, 211, 153] as [number,number,number] },
      ];
      extraCards.forEach((card, i) => {
        metricBox(card.label, card.value, card.color, MX + i * (cw2 + 4), y, cw2, bh);
      });
      y += bh + 6;

      // ── DELTAS DO PERÍODO ─────────────────────────────────────
      y = sectionBar(`DELTAS — ${metrics.periodLabel.toUpperCase()}`, y);
      autoTable(doc, {
        head: [["Métrica", "Total geral", metrics.periodLabel.charAt(0).toUpperCase() + metrics.periodLabel.slice(1)]],
        body: [
          ["Campanhas",         metrics.activeCampaigns.toLocaleString("pt-BR"),  metrics.campaignsThisMonth.toLocaleString("pt-BR")],
          ["Mensagens enviadas", metrics.messagesSent.toLocaleString("pt-BR"),    metrics.messagesThisMonth.toLocaleString("pt-BR")],
          ["Contatos",          metrics.activeContacts.toLocaleString("pt-BR"),   metrics.contactsThisMonth.toLocaleString("pt-BR")],
        ],
        startY: y,
        margin: { left: MX, right: MX },
        styles:     { fontSize: 8, cellPadding: 3, textColor: [25, 25, 25] },
        headStyles: { fillColor: [75, 75, 75], textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 248] },
      } as never);
      y = (doc as never as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

      // ── ATIVIDADE DIÁRIA ──────────────────────────────────────
      y = sectionBar(`ATIVIDADE DIÁRIA (últimos ${metrics.chartDays} dias)`, y);
      autoTable(doc, {
        head: [["Data", "Enviadas", "Lidas"]],
        body: metrics.dailyMessages
          .filter((d) => d.enviadas > 0 || d.lidas > 0)
          .map((d) => [d.date, d.enviadas.toLocaleString("pt-BR"), d.lidas.toLocaleString("pt-BR")]),
        startY: y,
        margin: { left: MX, right: MX },
        styles:     { fontSize: 7.5, cellPadding: 2.5, textColor: [25, 25, 25] },
        headStyles: { fillColor: [75, 75, 75], textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 248] },
        columnStyles: { 0: { cellWidth: 20 } },
      } as never);
      y = (doc as never as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

      // ── CAMPANHAS DO PERÍODO ──────────────────────────────────
      // May need a new page
      if (y > 165) { doc.addPage(); y = MX; }
      y = sectionBar("CAMPANHAS DO PERÍODO", y);
      const STATUS_PT: Record<string, string> = {
        draft: "Rascunho", scheduled: "Agendado", sending: "Enviando",
        paused: "Pausado", completed: "Concluído", cancelled: "Cancelado", failed: "Falhou",
      };
      const statusColIdx = 2;
      autoTable(doc, {
        head: [["#", "Nome", "Status", "Canal", "Destinatários", "Enviadas", "Entregues", "Lidas", "Falhas", "Taxa %", "Criada em"]],
        body: campaigns.map((c, idx) => [
          String(idx + 1),
          c.name,
          STATUS_PT[c.status] ?? c.status,
          c.dispatch_channel === "n8n_email" ? "Email N8N" : "WhatsApp",
          (c.total_recipients ?? 0).toLocaleString("pt-BR"),
          (c.sent_count ?? 0).toLocaleString("pt-BR"),
          (c.dispatch_channel === "n8n_email" ? (c.sent_count ?? 0) : (c.delivered_count ?? 0)).toLocaleString("pt-BR"),
          c.dispatch_channel === "n8n_email" ? "—" : (c.read_count ?? 0).toLocaleString("pt-BR"),
          (c.failed_count ?? 0).toLocaleString("pt-BR"),
          `${campRate(c)}%`,
          format(new Date(c.created_at), "dd/MM/yy"),
        ]),
        startY: y,
        margin: { left: MX, right: MX },
        styles:     { fontSize: 7, cellPadding: 2, textColor: [25, 25, 25], overflow: "ellipsize" },
        headStyles: { fillColor: [75, 75, 75], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 248] },
        columnStyles: {
          0: { cellWidth: 6,  halign: "center" },
          1: { cellWidth: 50 },
          9: { halign: "center" },
          10: { cellWidth: 18 },
        },
        didParseCell: (data: { column: { index: number }; section: string; cell: { raw: unknown; styles: { textColor: number[] } } }) => {
          if (data.section !== "body" || data.column.index !== statusColIdx) return;
          const v = data.cell.raw as string;
          if (["Concluído", "Enviando"].includes(v)) data.cell.styles.textColor = [22, 163, 74];
          else if (["Falhou", "Cancelado"].includes(v)) data.cell.styles.textColor = [220, 38, 38];
          else if (v === "Pausado") data.cell.styles.textColor = [180, 120, 0];
        },
      } as never);

      // ── Footer ────────────────────────────────────────────────
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
        doc.line(MX, 203, W - MX, 203);
        doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(150, 150, 150);
        doc.text("Solve AI — solveai.consulting", MX, 207);
        doc.text(`${rangeLabel}  ·  Página ${i} / ${pages}`, W - MX, 207, { align: "right" });
      }

      doc.save(`dashboard_${dateRange}_${now.toISOString().slice(0, 10)}.pdf`);
    } finally {
      setExportingPdf(false);
    }
  }

  // ── Chart title ───────────────────────────────────────────────
  const chartTitle = dateRange === "all"
    ? `Mensagens nos últimos ${metrics.chartDays} dias`
    : `Mensagens — ${periodRangeLabel(dateRange).toLowerCase()}`;

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Dashboard" }]} />

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* ── Welcome + period filter ───────────────── */}
        <div className="flex items-start justify-between mb-6 animate-fade-up flex-wrap gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-agro-text">
              Bem-vindo, <span className="text-agro-green">Bruno</span>
            </h1>
            <p className="text-agro-muted mt-1 text-sm">A inteligência que cultiva resultados</p>
          </div>

          {/* Period filter */}
          <div className="flex gap-1 p-1 rounded-xl"
            style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            {DATE_OPTS.map((o) => (
              <button
                key={o.id}
                onClick={() => setDateRange(o.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={dateRange === o.id
                  ? { background: "rgba(63,176,108,0.18)", color: "#3fb06c" }
                  : { color: "#6b7f6e" }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Stats ────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4 animate-fade-up-delay-1">
          {stats.map((s) => (
            <StatCard key={s.label} {...s} loading={metrics.loading} />
          ))}
        </div>

        {/* ── Economia de Tempo + Valor Disparado ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8 animate-fade-up-delay-1">
          {/* Economia de Tempo */}
          <div className="p-6 rounded-2xl transition-all duration-300 hover:scale-[1.01]"
            style={{ background: "rgba(13,26,17,0.7)", backdropFilter: "blur(16px)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)" }}
              >
                <Clock className="w-4.5 h-4.5" style={{ color: "#fbbf24" }} />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded-full"
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
                <p className="font-display text-3xl font-bold text-agro-text">{fmtTime(metrics.timeSavedMinutes)}</p>
                <p className="text-sm text-agro-muted mt-1">Economia de tempo</p>
                <p className="text-xs text-agro-muted-2 mt-2 leading-relaxed">
                  Enviar {fmtCount(metrics.messagesSent)} mensagens manualmente levaria ~{fmtTime(metrics.messagesSent * 5)} (5 min/msg).
                  A automação executa cada envio em ~30 segundos.
                </p>
              </>
            )}
          </div>

          {/* Valor Disparado */}
          <div className="p-6 rounded-2xl transition-all duration-300 hover:scale-[1.01]"
            style={{ background: "rgba(13,26,17,0.7)", backdropFilter: "blur(16px)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.3)" }}
              >
                <DollarSign className="w-4.5 h-4.5" style={{ color: "#34d399" }} />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded-full"
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

        {/* ── Area Chart ──────────────────────────── */}
        <div className="rounded-2xl p-6 animate-fade-up-delay-1"
          style={{ background: "rgba(13,26,17,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <div>
              <h2 className="text-sm font-semibold text-agro-text">{chartTitle}</h2>
              <p className="text-xs text-agro-muted-2 mt-0.5">Enviadas e lidas por dia</p>
            </div>
            <div className="flex items-center gap-2">
              {/* XLSX export */}
              <button
                onClick={exportXlsx}
                disabled={metrics.loading || exportingXlsx}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-agro-muted transition-colors hover:text-agro-text hover:bg-white/5 disabled:opacity-40"
                style={{ border: "1px solid rgba(63,176,108,0.15)" }}
              >
                {exportingXlsx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                XLSX
              </button>
              {/* PDF export */}
              <button
                onClick={exportPdf}
                disabled={metrics.loading || exportingPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-agro-muted transition-colors hover:text-agro-text hover:bg-white/5 disabled:opacity-40"
                style={{ border: "1px solid rgba(63,176,108,0.15)" }}
              >
                {exportingPdf ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                PDF
              </button>
              {/* Ver disparos */}
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
              Nenhum envio no período selecionado.
            </div>
          ) : (
            <>
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
                    interval={Math.max(0, Math.floor(metrics.chartDays / 10) - 1)}
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
                  <Area type="monotone" dataKey="enviadas" stroke="#60a5fa" strokeWidth={2}
                    fill="url(#gradEnviadas)" dot={false} activeDot={{ r: 4, fill: "#60a5fa" }} />
                  <Area type="monotone" dataKey="lidas"    stroke="#34d399" strokeWidth={2}
                    fill="url(#gradLidas)"    dot={false} activeDot={{ r: 4, fill: "#34d399" }} />
                </AreaChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
