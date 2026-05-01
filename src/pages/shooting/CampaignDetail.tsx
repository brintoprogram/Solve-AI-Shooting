import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Pause, Play, StopCircle, RefreshCw, FileText, Loader2, Pencil, Check, X, Wifi, Smartphone, Mail } from "lucide-react";
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
  const [exportingPdf, setExportingPdf] = useState(false);
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [editingName, setEditingName] = useState<string | null>(null);
  const [savingName,  setSavingName]  = useState(false);

  async function handleRenameSave() {
    if (!campaign || !editingName) return;
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === campaign.name) { setEditingName(null); return; }
    setSavingName(true);
    const { error } = await db.from("shooting_campaigns").update({ name: trimmed }).eq("id", campaign.id);
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
      // A4 landscape
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const W  = 297;
      const MX = 14;

      // ── Logo ──────────────────────────────────────
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

      // ── Fetch all messages ─────────────────────────
      const { data: rawMsgs } = await db
        .from("shooting_messages")
        .select("*")
        .eq("campaign_id", campaign.id)
        .order("sent_at", { ascending: true, nullsFirst: false });
      const messages: ShootingMessage[] = rawMsgs ?? [];

      // Compute total value from recipient_data (pt-BR currency parsing)
      function parseBRL(raw: unknown): number {
        if (typeof raw === "number") return raw;
        const s = String(raw).replace(/[^\d,]/g, ""); // strip everything except digits + comma
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

      // ── HEADER ────────────────────────────────────
      const LOGO_SIZE = 30;
      let y = MX;

      if (logo) doc.addImage(logo, "PNG", MX, y, LOGO_SIZE, LOGO_SIZE);
      const tX = logo ? MX + LOGO_SIZE + 6 : MX;

      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(25, 25, 25);
      doc.text("Relatório de Disparo", tX, y + 11);

      doc.setFontSize(11);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(120, 120, 120);
      doc.text("Inteligência que cultiva resultados", tX, y + 19);

      const now = new Date();
      const dateStr = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
        + " às " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(150, 150, 150);
      doc.text(`Gerado em ${dateStr}`, tX, y + 26);

      y += LOGO_SIZE + 6;

      // Thick separator
      doc.setDrawColor(25, 25, 25);
      doc.setLineWidth(1.2);
      doc.line(MX, y, W - MX, y);
      y += 10;

      // ── Helper: section bar ────────────────────────
      const sectionBar = (label: string, sy: number): number => {
        doc.setFillColor(30, 30, 30);
        doc.rect(MX, sy, W - MX * 2, 9, "F");
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(255, 255, 255);
        doc.text(label, MX + 4, sy + 6.3);
        return sy + 13;
      };

      // ── Helper: inline bold + normal text ─────────
      const infoLine = (label: string, value: string, x: number, iy: number): number => {
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(25, 25, 25);
        doc.text(`${label}: `, x, iy);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        doc.text(value, x + doc.getTextWidth(`${label}: `), iy);
        return iy + 7;
      };

      // ── INFORMAÇÕES DO DISPARO ─────────────────────
      y = sectionBar("INFORMAÇÕES DO DISPARO", y);
      const c2 = MX + (W - MX * 2) / 2 + 4;
      const SOURCE_PT: Record<string, string> = {
        contacts: "Contatos da base", xlsx_upload: "Planilha importada",
      };
      const isPdfEmail = campaign.dispatch_channel === "n8n_email";
      let yL = y, yR = y;
      yL = infoLine("Nome do Disparo", campaign.name, MX, yL);
      yL = infoLine(
        isPdfEmail ? "Canal" : "Template",
        isPdfEmail ? "Email via N8N" : (campaign.meta_templates?.template_name ?? "—"),
        MX, yL,
      );
      yR = infoLine("Tipo", SOURCE_PT[campaign.data_source] ?? campaign.data_source, c2, yR);
      yR = infoLine("Limpeza de Base", "Não", c2, yR);
      if (campaign.started_at)   yR = infoLine("Iniciada em",  format(new Date(campaign.started_at),   "dd/MM/yyyy HH:mm"), c2, yR);
      if (campaign.completed_at) yR = infoLine("Concluída em", format(new Date(campaign.completed_at), "dd/MM/yyyy HH:mm"), c2, yR);
      y = Math.max(yL, yR) + 8;

      // ── RESUMO DE RESULTADOS ───────────────────────
      y = sectionBar("RESUMO DE RESULTADOS", y);

      const successRate = campaign.sent_count > 0
        ? ((campaign.sent_count - campaign.failed_count) / campaign.sent_count * 100).toFixed(1) + "%"
        : "—";

      const CARDS = [
        { label: "Total de Contatos",    value: campaign.total_recipients.toLocaleString("pt-BR"), color: [25, 25, 25]     as [number,number,number] },
        { label: "Enviados com Sucesso", value: (campaign.sent_count - campaign.failed_count).toLocaleString("pt-BR"), color: [22, 163, 74] as [number,number,number] },
        { label: "Falhas",               value: campaign.failed_count.toLocaleString("pt-BR"),     color: [220, 38, 38]    as [number,number,number] },
        { label: "Taxa de Sucesso",      value: successRate,                                       color: [22, 163, 74]    as [number,number,number] },
      ];

      const cardW = (W - MX * 2 - 3 * 5) / 4;
      const cardH = 28;

      CARDS.forEach((card, i) => {
        const cx = MX + i * (cardW + 5);
        doc.setFillColor(250, 250, 250);
        doc.setDrawColor(210, 210, 210);
        doc.setLineWidth(0.3);
        doc.roundedRect(cx, y, cardW, cardH, 2, 2, "FD");
        // Label
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(130, 130, 130);
        doc.text(card.label, cx + cardW / 2, y + 9, { align: "center" });
        // Value
        doc.setFontSize(20);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...card.color);
        doc.text(card.value, cx + cardW / 2, y + 22, { align: "center" });
      });

      y += cardH + 6;

      // Total value line
      if (totalValue > 0) {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(25, 25, 25);
        doc.text(
          `Valor Total Disparado: ${totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
          MX, y,
        );
        y += 10;
      } else {
        y += 4;
      }

      // ── LISTA DE DESTINATÁRIOS ─────────────────────
      y = sectionBar("LISTA DE DESTINATÁRIOS", y);

      // Detect whether any message has financial data from the new dispatch system
      const hasFinancialRd = messages.some((m) => {
        const rd = m.recipient_data as Record<string, unknown> | null;
        return rd && rd._financial_campaign === true;
      });

      // Non-financial campaigns skip all financial columns
      const valorKey: string | null = null;
      const nfKey:    string | null = null;
      const vencKey:  string | null = null;

      const STATUS_PT: Record<string, string> = {
        pending: "Na fila", sent: "Enviado", delivered: "Entregue",
        read: "Lido", replied: "Respondido", failed: "Falhou", undeliverable: "Não entregável",
      };

      const isEmailCampaign = campaign.dispatch_channel === "n8n_email";
      const head: string[] = ["#", "Nome", isEmailCampaign ? "Email" : "Telefone"];
      if (hasFinancialRd) {
        head.push("Nº NF(s)", "Qtd", "Valor", "Vencimento");
      } else {
        if (nfKey)    head.push("Nº NF");
        if (valorKey) head.push("Valor");
        if (vencKey)  head.push("Vencimento");
      }
      head.push("Status", "Enviado em");

      const statusColIdx = head.indexOf("Status");

      const body = messages.map((m, idx) => {
        const rd = m.recipient_data as Record<string, unknown> | null ?? {};
        const contactCol = isEmailCampaign ? ((rd.email as string) ?? "—") : m.recipient_phone;
        const row: string[] = [`${idx + 1}`, m.recipient_name ?? "—", contactCol];

        if (hasFinancialRd) {
          // New system: extract NF numbers from contact_invoices filtered by _invoice_ids
          const invIds = rd._invoice_ids as string[] | null;
          const allInvs = rd.contact_invoices as Array<{ id: string; numero_nf: string | null }> | null;
          const nfs = invIds && allInvs
            ? allInvs.filter((inv) => invIds.includes(inv.id)).map((inv) => inv.numero_nf || "—").join(", ")
            : (rd.boleto_nf as string | null) ?? "—";
          row.push(nfs || "—");
          row.push(String(rd._invoice_count ?? (invIds?.length ?? "—")));
          row.push(typeof rd.valor_total_pendente === "string" ? rd.valor_total_pendente : "—");
          row.push(typeof rd.proximo_vencimento   === "string" ? rd.proximo_vencimento   : "—");
        } else {
          if (nfKey) row.push(String(rd[nfKey!] ?? "—"));
          if (valorKey) {
            const n = parseBRL(rd[valorKey!] ?? "");
            const raw2 = rd[valorKey!];
            const formatted = typeof raw2 === "string" && raw2.includes("R$")
              ? raw2
              : isNaN(n) ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            row.push(formatted);
          }
          if (vencKey) {
            const v = String(rd[vencKey!] ?? "");
            const d = v ? new Date(v) : null;
            row.push(d && !isNaN(d.getTime()) ? format(d, "dd/MM/yyyy") : (v || "—"));
          }
        }

        row.push(STATUS_PT[m.status] ?? m.status);
        row.push(m.sent_at ? format(new Date(m.sent_at), "dd/MM/yyyy, HH:mm") : "—");
        return row;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      autoTable(doc, {
        head:  [head],
        body,
        startY: y,
        margin: { left: MX, right: MX },
        styles:     { fontSize: 8, cellPadding: 3, textColor: [25, 25, 25], lineColor: [215, 215, 215], lineWidth: 0.2 },
        headStyles: { fillColor: [75, 75, 75], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 248] },
        columnStyles: { 0: { cellWidth: 8, halign: "center" } },
        didParseCell: (data: { column: { index: number }; section: string; cell: { raw: unknown; styles: { textColor: number[] } } }) => {
          if (data.section !== "body" || data.column.index !== statusColIdx) return;
          const v = data.cell.raw as string;
          if (["Enviado", "Entregue", "Lido", "Respondido"].includes(v)) {
            data.cell.styles.textColor = [22, 163, 74];
          } else if (["Falhou", "Não entregável"].includes(v)) {
            data.cell.styles.textColor = [220, 38, 38];
          }
        },
      } as never);

      // ── Footer ────────────────────────────────────
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.2);
        doc.line(MX, 203, W - MX, 203);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(150, 150, 150);
        doc.text("Solve AI — solveai.consulting", MX, 207);
        doc.text(`Página ${i} / ${pages}`, W - MX, 207, { align: "right" });
      }

      doc.save(`relatorio_${campaign.name.replace(/\s+/g, "_")}.pdf`);
    } finally {
      setExportingPdf(false);
    }
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
                    <h1 className="font-display text-2xl font-bold text-agro-text">{campaign.name}</h1>
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
              <div className="flex items-center gap-2 mt-1 text-xs text-agro-muted flex-wrap">
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
            {campaign.status === "draft" && campaign.dispatch_channel !== "n8n_email" && (
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
        {campaign.status !== "draft" && campaign.dispatch_channel !== "n8n_email" && (
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
            <MessagesTable campaignId={campaign.id} dispatchChannel={campaign.dispatch_channel} />
          </DarkCard>
        </div>
      </div>
    </div>
  );
}
