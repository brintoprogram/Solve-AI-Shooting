import { useCallback, useEffect, useState, Fragment } from "react";
import {
  BarChart2, Download, RefreshCw, Shield, Send,
  CheckCircle2, Eye, Loader2, ChevronDown, ChevronUp,
  MessageSquare, FileText, X, Headphones, Users, Clock, TrendingUp,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, subDays, startOfDay } from "date-fns";
import { Topbar } from "@/components/layout/Topbar";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type MainTab    = "campaigns" | "inbox" | "audit";
type DateRange  = "7d" | "30d" | "90d" | "all";
type CampStatus = "all" | "completed" | "sending" | "paused" | "failed" | "cancelled" | "draft" | "scheduled";

interface Campaign {
  id: string;
  name: string;
  status: string;
  dispatch_channel: string | null;
  total_recipients: number | null;
  sent_count: number | null;
  delivered_count: number | null;
  read_count: number | null;
  replied_count: number | null;
  failed_count: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  meta_templates: { template_name: string } | null;
}

function isEmailCamp(c: Campaign) { return c.dispatch_channel === "n8n_email"; }

// For email: sent = delivered (no delivery receipt from N8N). For WhatsApp: use delivered_count.
function effectiveDelivered(c: Campaign) {
  return isEmailCamp(c) ? (c.sent_count ?? 0) : (c.delivered_count ?? 0);
}

// Rate denominator: email → total_recipients, WhatsApp → sent_count
function effectiveRate(c: Campaign): number | null {
  if (isEmailCamp(c)) {
    const total = c.total_recipients ?? 0;
    return total > 0 ? Math.round(((c.sent_count ?? 0) / total) * 100) : null;
  }
  const sent = c.sent_count ?? 0;
  return sent > 0 ? Math.round(((c.delivered_count ?? 0) / sent) * 100) : null;
}

interface AuditLog {
  id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  status: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ── Styles ───────────────────────────────────────────────────────

const CAMP_STATUS: Record<string, { label: string; bg: string; color: string; border: string }> = {
  draft:     { label: "Rascunho",  bg: "rgba(107,114,128,0.12)", color: "#9ca3af", border: "rgba(107,114,128,0.25)" },
  scheduled: { label: "Agendado",  bg: "rgba(59,130,246,0.12)",  color: "#60a5fa", border: "rgba(59,130,246,0.25)"  },
  sending:   { label: "Enviando",  bg: "rgba(63,176,108,0.15)",  color: "#3fb06c", border: "rgba(63,176,108,0.35)"  },
  paused:    { label: "Pausado",   bg: "rgba(245,158,11,0.12)",  color: "#fbbf24", border: "rgba(245,158,11,0.25)"  },
  completed: { label: "Concluído", bg: "rgba(63,176,108,0.12)",  color: "#3fb06c", border: "rgba(63,176,108,0.25)"  },
  cancelled: { label: "Cancelado", bg: "rgba(107,114,128,0.12)", color: "#9ca3af", border: "rgba(107,114,128,0.25)" },
  failed:    { label: "Falhou",    bg: "rgba(239,68,68,0.12)",   color: "#f87171", border: "rgba(239,68,68,0.25)"   },
};

const AUDIT_STATUS: Record<string, { label: string; bg: string; color: string; border: string }> = {
  ok:      { label: "OK",    bg: "rgba(63,176,108,0.12)",  color: "#3fb06c", border: "rgba(63,176,108,0.25)"  },
  error:   { label: "Erro",  bg: "rgba(239,68,68,0.12)",   color: "#f87171", border: "rgba(239,68,68,0.25)"   },
  info:    { label: "Info",  bg: "rgba(59,130,246,0.12)",  color: "#60a5fa", border: "rgba(59,130,246,0.25)"  },
  warning: { label: "Aviso", bg: "rgba(245,158,11,0.12)",  color: "#fbbf24", border: "rgba(245,158,11,0.25)"  },
};

function auditStyle(s: string | null) {
  return AUDIT_STATUS[s ?? "info"] ?? AUDIT_STATUS["info"];
}

const EVENT_LABELS: Record<string, string> = {
  gdpr_export:        "LGPD — Exportação",
  gdpr_forget:        "LGPD — Esquecimento",
  campaign_started:   "Campanha iniciada",
  campaign_paused:    "Campanha pausada",
  campaign_resumed:   "Campanha retomada",
  campaign_completed: "Campanha concluída",
  campaign_cancelled: "Campanha cancelada",
  campaign_failed:    "Campanha falhou",
  webhook_received:   "Webhook recebido",
  email_sent:         "E-mail enviado",
  message_sent:       "Mensagem enviada",
};

function eventLabel(t: string) {
  return EVENT_LABELS[t] ?? t.replace(/_/g, " ");
}

// ── Stat card ────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, color, bg, border }: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string; bg: string; border: string;
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <p className="text-[10px] uppercase tracking-widest font-semibold text-[#6b7f6e]">{label}</p>
      </div>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-[#6b7f6e] mt-1">{sub}</p>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// CAMPAIGN REPORT
// ════════════════════════════════════════════════════════════════

function CampaignReport({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast();
  const [campaigns,    setCampaigns]    = useState<Campaign[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [exporting,      setExporting]      = useState(false);
  const [exportingPdf,   setExportingPdf]   = useState(false);
  const [exportingProof, setExportingProof] = useState(false);
  const [onlyDelivered,  setOnlyDelivered]  = useState(false);
  const [dateRange,    setDateRange]    = useState<DateRange>("all");
  const [status,       setStatus]       = useState<CampStatus>("all");
  const [selected,     setSelected]     = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    let q = db
      .from("shooting_campaigns")
      .select("id,name,status,dispatch_channel,total_recipients,sent_count,delivered_count,read_count,replied_count,failed_count,created_at,started_at,completed_at,meta_templates(template_name)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (dateRange !== "all") {
      const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
      q = q.gte("created_at", startOfDay(subDays(new Date(), days)).toISOString());
    }
    if (status !== "all") q = q.eq("status", status);

    const { data } = await q;
    setCampaigns(data ?? []);
    setLoading(false);
  }, [workspaceId, dateRange, status]);

  useEffect(() => { load(); }, [load]);

  // Clear selection when filters change
  useEffect(() => { setSelected(new Set()); }, [dateRange, status]);

  const totalSent      = campaigns.reduce((a, c) => a + (c.sent_count ?? 0), 0);
  const totalDelivered = campaigns.reduce((a, c) => a + effectiveDelivered(c), 0);
  const totalRead      = campaigns.reduce((a, c) => a + (c.read_count ?? 0), 0);
  const totalRecip     = campaigns.reduce((a, c) => a + (c.total_recipients ?? 0), 0);
  const deliveryRate   = totalRecip > 0 ? Math.round((totalDelivered / totalRecip) * 100) : 0;

  const allIds      = campaigns.map((c) => c.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Shared paginated fetch ────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAll(baseQuery: any): Promise<any[]> {
    const PAGE = 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    let offset = 0;
    while (true) {
      const { data } = await baseQuery.range(offset, offset + PAGE - 1);
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    return all;
  }

  // ── XLSX export (all or selected) ────────────────────────────
  async function exportXlsx(ids?: string[]) {
    setExporting(true);
    try {
      const target      = ids ? campaigns.filter((c) => ids.includes(c.id)) : campaigns;
      const campNameMap = Object.fromEntries(target.map((c) => [c.id, c.name]));
      const suffix      = ids ? `_${ids.length}campanhas` : "";

      // ── Aba 1: Resumo campanhas ────────────────────────────────
      const summaryRows = target.map((c) => ({
        "Nome":             c.name,
        "Canal":            isEmailCamp(c) ? "Email Automático" : "WhatsApp",
        "Template":         c.meta_templates?.template_name ?? "",
        "Status":           CAMP_STATUS[c.status]?.label ?? c.status,
        "Destinatários":    c.total_recipients ?? 0,
        "Enviadas":         c.sent_count ?? 0,
        "Entregues":        effectiveDelivered(c),
        "Falhas":           c.failed_count ?? 0,
        "Lidas":            isEmailCamp(c) ? "" : (c.read_count ?? 0),
        "Respondidas":      isEmailCamp(c) ? "" : (c.replied_count ?? 0),
        "Taxa entrega (%)": effectiveRate(c) ?? 0,
        "Criada em":        format(new Date(c.created_at), "dd/MM/yyyy HH:mm"),
        "Iniciada em":      c.started_at   ? format(new Date(c.started_at),   "dd/MM/yyyy HH:mm") : "",
        "Concluída em":     c.completed_at ? format(new Date(c.completed_at), "dd/MM/yyyy HH:mm") : "",
      }));

      // ── Aba 2: WhatsApp — mensagens individuais ────────────────
      const waCampIds = target.filter((c) => !isEmailCamp(c)).map((c) => c.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let waRows: Record<string, any>[] = [];
      if (waCampIds.length > 0) {
        const msgs = await fetchAll(
          db.from("shooting_messages")
            .select("campaign_id,recipient_name,recipient_phone,recipient_data,status,error_message,created_at,sent_at,delivered_at,read_at")
            .in("campaign_id", waCampIds)
            .order("campaign_id,created_at", { ascending: true }),
        );
        waRows = msgs.map((m) => ({
          "Campanha":         campNameMap[m.campaign_id] ?? m.campaign_id,
          "Nome":             m.recipient_name ?? "",
          "Telefone":         m.recipient_phone ?? "",
          "Email":            m.recipient_data?.email ?? "",
          "Valor Pendente":   m.recipient_data?.valor_total_pendente ?? "",
          "Próx. Vencimento": m.recipient_data?.proximo_vencimento ?? "",
          "Status":           m.status ?? "",
          "Erro":             m.error_message ?? "",
          "Criada em":        m.created_at   ? format(new Date(m.created_at),   "dd/MM/yyyy HH:mm") : "",
          "Enviada em":       m.sent_at      ? format(new Date(m.sent_at),      "dd/MM/yyyy HH:mm") : "",
          "Entregue em":      m.delivered_at ? format(new Date(m.delivered_at), "dd/MM/yyyy HH:mm") : "",
          "Lida em":          m.read_at      ? format(new Date(m.read_at),      "dd/MM/yyyy HH:mm") : "",
        }));
      }

      // ── Aba 3: Email ───────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let emailRows: Record<string, any>[] = [];

      const n8nCampIds = target.filter((c) => isEmailCamp(c)).map((c) => c.id);
      if (n8nCampIds.length > 0) {
        const msgs = await fetchAll(
          db.from("shooting_messages")
            .select("campaign_id,recipient_name,recipient_phone,recipient_data,status,error_message,created_at")
            .in("campaign_id", n8nCampIds)
            .order("campaign_id,created_at", { ascending: true }),
        );
        emailRows.push(...msgs.map((m) => ({
          "Campanha":            campNameMap[m.campaign_id] ?? m.campaign_id,
          "Canal":               "Automático",
          "Nome":                m.recipient_name ?? "",
          "Email":               m.recipient_data?.email ?? m.recipient_phone ?? "",
          "Email Representante": m.recipient_data?.email_representante ?? "",
          "Email Gerente 1":     m.recipient_data?.gerente1_email ?? "",
          "Email Gerente 2":     m.recipient_data?.gerente2_email ?? "",
          "Valor Pendente":      m.recipient_data?.valor_total_pendente ?? "",
          "Próx. Vencimento":    m.recipient_data?.proximo_vencimento ?? "",
          "Status":              m.status ?? "",
          "Erro":                m.error_message ?? "",
          "Enviada em":          m.created_at ? format(new Date(m.created_at), "dd/MM/yyyy HH:mm") : "",
        })));
      }

      const { data: smtpCamps } = await supabase
        .from("email_campaigns")
        .select("id,name")
        .eq("workspace_id", workspaceId);
      const smtpNameMap = Object.fromEntries((smtpCamps ?? []).map((c) => [c.id, c.name]));
      const smtpCampIds = (smtpCamps ?? []).map((c) => c.id);
      if (smtpCampIds.length > 0) {
        const msgs = await fetchAll(
          supabase.from("email_messages")
            .select("campaign_id,recipient_name,recipient_email,status,error_message,created_at,sent_at")
            .in("campaign_id", smtpCampIds)
            .order("campaign_id,created_at", { ascending: true }),
        );
        emailRows.push(...msgs.map((m) => ({
          "Campanha":            smtpNameMap[m.campaign_id] ?? m.campaign_id,
          "Canal":               "SMTP",
          "Nome":                m.recipient_name ?? "",
          "Email":               m.recipient_email ?? "",
          "Email Representante": "",
          "Email Gerente 1":     "",
          "Email Gerente 2":     "",
          "Valor Pendente":      "",
          "Próx. Vencimento":    "",
          "Status":              m.status ?? "",
          "Erro":                m.error_message ?? "",
          "Enviada em":          m.sent_at    ? format(new Date(m.sent_at),    "dd/MM/yyyy HH:mm")
                               : m.created_at ? format(new Date(m.created_at), "dd/MM/yyyy HH:mm") : "",
        })));
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows.length ? summaryRows : [{}]), "Campanhas");
      if (waRows.length > 0)    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(waRows),    "WhatsApp");
      if (emailRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(emailRows), "Email");

      XLSX.writeFile(wb, `relatorio${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast({
        title:       "Relatório exportado!",
        description: `${waRows.length} msgs WhatsApp · ${emailRows.length} msgs Email`,
        variant:     "success",
      });
    } catch (err) {
      toast({ title: "Erro ao exportar", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  // ── PDF export (selected only) — replica o layout do relatório individual ─
  async function exportPdf() {
    if (selected.size === 0) return;
    setExportingPdf(true);
    try {
      const ids    = Array.from(selected);
      const target = campaigns.filter((c) => ids.includes(c.id));

      // ── Paleta idêntica ao CampaignDetail ─────────────────────
      const GREEN  = [22, 163, 74]   as [number, number, number];
      const TEAL   = [16, 132, 163]  as [number, number, number];
      const BLUE   = [37, 99, 235]   as [number, number, number];
      const RED    = [220, 38, 38]   as [number, number, number];
      const DARK   = [25, 25, 25]    as [number, number, number];
      const MUTED  = [130, 130, 130] as [number, number, number];
      const AMBER  = [180, 120, 0]   as [number, number, number];
      const W = 297, MX = 14, FOOTER_Y = 203;

      // ── Logo ───────────────────────────────────────────────────
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

      // ── Mensagens de todas as campanhas (batch único) ──────────
      interface Msg {
        campaign_id:    string;
        recipient_name: string | null;
        recipient_phone:string;
        recipient_data: Record<string, unknown> | null;
        status:         string;
        error_message:  string | null;
        sent_at:        string | null;
      }
      let msgQuery = db.from("shooting_messages")
        .select("campaign_id,recipient_name,recipient_phone,recipient_data,status,error_message,sent_at")
        .in("campaign_id", ids)
        .order("sent_at", { ascending: true, nullsFirst: false });
      if (onlyDelivered) {
        msgQuery = msgQuery.in("status", ["sent", "delivered", "read", "replied"]);
      }
      const allMsgs: Msg[] = await fetchAll(msgQuery);
      const msgsByCamp = new Map<string, Msg[]>();
      for (const m of allMsgs) {
        if (!msgsByCamp.has(m.campaign_id)) msgsByCamp.set(m.campaign_id, []);
        msgsByCamp.get(m.campaign_id)!.push(m);
      }

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      // ── Helpers ────────────────────────────────────────────────
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

      const drawCards = (
        cards: { label: string; value: string; sub: string | null; color: [number,number,number] }[],
        startY: number,
        areaW: number,
        startX: number,
      ): number => {
        const COLS  = 3;
        const cardW = (areaW - (COLS - 1) * 3) / COLS;
        const cardH = 22;
        cards.forEach((card, i) => {
          const col = i % COLS;
          const row = Math.floor(i / COLS);
          const cx  = startX + col * (cardW + 3);
          const cy  = startY + row * (cardH + 3);
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
        return startY + 2 * (cardH + 3) - 3; // bottom of cards
      };

      const drawFunnel = (
        rows: { label: string; value: number; base: number; color: [number,number,number]; textColor: [number,number,number] }[],
        startY: number,
        fx: number,
        fareaW: number,
      ): number => {
        const labelW  = 28;
        const barMaxW = fareaW - labelW - 28;
        const barH    = 10;
        const gap     = 4;
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...MUTED);
        doc.text("FUNIL DE ENTREGA", fx, startY - 2);
        doc.setDrawColor(...MUTED);
        doc.setLineWidth(0.2);
        doc.line(fx, startY, fx + fareaW, startY);
        let fy = startY + 5;
        for (const item of rows) {
          const pct  = item.base > 0 ? item.value / item.base : 0;
          const barW = Math.max(barMaxW * pct, item.value > 0 ? 2 : 0);
          doc.setFontSize(7);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(...MUTED);
          doc.text(item.label, fx + labelW - 2, fy + barH / 2 + 2.5, { align: "right" });
          doc.setFillColor(232, 238, 234);
          doc.roundedRect(fx + labelW, fy, barMaxW, barH, 1.5, 1.5, "F");
          if (barW > 0) {
            doc.setFillColor(...item.color);
            doc.roundedRect(fx + labelW, fy, barW, barH, 1.5, 1.5, "F");
          }
          const pctStr = pct > 0 && item.label !== "Total" ? ` (${(pct * 100).toFixed(1)}%)` : "";
          doc.setFontSize(7);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(...item.textColor);
          doc.text(`${item.value.toLocaleString("pt-BR")}${pctStr}`, fx + labelW + barMaxW + 3, fy + barH / 2 + 2.5);
          fy += barH + gap;
        }
        return fy + 4;
      };

      // ── Layout constants ───────────────────────────────────────
      const LOGO_SIZE  = 26;
      const splitX     = MX + (W - MX * 2) * 0.52;
      const cardsAreaW = splitX - MX - 4;
      const funnelX    = splitX + 4;
      const funnelAreaW= W - MX - funnelX;

      const STATUS_PT: Record<string, string> = {
        pending: "Na fila", sent: "Enviado", delivered: "Entregue",
        read: "Lido", replied: "Respondido", failed: "Falhou", undeliverable: "Nao entregavel",
      };

      // ══════════════════════════════════════════════════════════
      // PÁGINA DE CAPA — consolidado
      // ══════════════════════════════════════════════════════════
      let y = MX;
      if (logo) doc.addImage(logo, "PNG", MX, y, LOGO_SIZE, LOGO_SIZE);
      const tX = logo ? MX + LOGO_SIZE + 6 : MX;

      doc.setFontSize(21);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...DARK);
      doc.text("Relatorio Consolidado de Campanhas", tX, y + 9);

      doc.setFontSize(10);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(...MUTED);
      doc.text("Inteligencia que cultiva resultados", tX, y + 17);

      const now     = new Date();
      const dateStr = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
        + " as " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.text(`Gerado em ${dateStr}  ·  ${target.length} campanha${target.length !== 1 ? "s" : ""} selecionada${target.length !== 1 ? "s" : ""}`, tX, y + 23);

      y += LOGO_SIZE + 4;
      doc.setDrawColor(...DARK);
      doc.setLineWidth(1);
      doc.line(MX, y, W - MX, y);
      y += 7;

      // Métricas agregadas
      const aggTotal      = target.reduce((a, c) => a + (c.total_recipients ?? 0), 0);
      const aggAttempted  = target.reduce((a, c) => a + (c.sent_count ?? 0), 0);
      const aggFailed     = target.reduce((a, c) => a + (c.failed_count ?? 0), 0);
      const aggSent       = aggAttempted - aggFailed;
      const aggDelivered  = target.reduce((a, c) => a + effectiveDelivered(c), 0);
      const aggRead       = target.reduce((a, c) => a + (c.read_count ?? 0), 0);
      const aggSuccessPct = aggAttempted > 0 ? aggSent       / aggAttempted * 100 : 0;
      const aggDelivPct   = aggSent      > 0 ? aggDelivered  / aggSent      * 100 : 0;
      const aggReadPct    = aggSent      > 0 ? aggRead       / aggSent      * 100 : 0;
      const aggFailPct    = aggAttempted > 0 ? aggFailed     / aggAttempted * 100 : 0;
      const aggSentPct    = aggTotal     > 0 ? aggSent       / aggTotal     * 100 : 0;

      y = sectionBar("VISAO GERAL — RESULTADO CONSOLIDADO", y);

      const aggCards = [
        { label: "Campanhas",       value: target.length.toLocaleString("pt-BR"),  sub: null,                                                           color: DARK  },
        { label: "Enviados",        value: aggSent.toLocaleString("pt-BR"),         sub: `${aggSentPct.toFixed(1)}% do total`,                           color: GREEN },
        { label: "Taxa de Sucesso", value: `${aggSuccessPct.toFixed(1)}%`,          sub: "dos tentados",                                                 color: GREEN },
        { label: "Entregues",       value: aggDelivered.toLocaleString("pt-BR"),    sub: `${aggDelivPct.toFixed(1)}% dos enviados`,                      color: TEAL  },
        { label: "Lidos",           value: aggRead.toLocaleString("pt-BR"),         sub: `${aggReadPct.toFixed(1)}% dos enviados`,                       color: BLUE  },
        { label: "Falhas",          value: aggFailed.toLocaleString("pt-BR"),       sub: aggFailed > 0 ? `${aggFailPct.toFixed(1)}% dos tentados` : "Nenhuma falha", color: aggFailed > 0 ? RED : GREEN },
      ];
      const cardsBottom = drawCards(aggCards, y, cardsAreaW, MX);
      const funnelBottom = drawFunnel([
        { label: "Total",     value: aggTotal,    base: aggTotal, color: [200,210,205], textColor: MUTED },
        { label: "Enviados",  value: aggSent,     base: aggTotal, color: GREEN,        textColor: GREEN },
        { label: "Entregues", value: aggDelivered,base: aggTotal, color: TEAL,         textColor: TEAL  },
        { label: "Lidos",     value: aggRead,     base: aggTotal, color: BLUE,         textColor: BLUE  },
        { label: "Falhas",    value: aggFailed,   base: aggTotal, color: RED,          textColor: RED   },
      ], y, funnelX, funnelAreaW);
      y = Math.max(cardsBottom + 5, funnelBottom);

      // Tabela resumo de campanhas
      y = sectionBar("CAMPANHAS SELECIONADAS", y);
      autoTable(doc, {
        startY:  y,
        margin:  { left: MX, right: MX },
        head: [["#", "Nome", "Canal", "Status", "Destinatários", "Enviados", "Entregues", "Falhas", "Lidas", "Taxa %", "Criada em"]],
        body: target.map((c, idx) => [
          String(idx + 1),
          c.name,
          isEmailCamp(c) ? "Email" : "WhatsApp",
          CAMP_STATUS[c.status]?.label ?? c.status,
          (c.total_recipients ?? 0).toLocaleString("pt-BR"),
          (c.sent_count ?? 0).toLocaleString("pt-BR"),
          effectiveDelivered(c).toLocaleString("pt-BR"),
          (c.failed_count ?? 0).toLocaleString("pt-BR"),
          isEmailCamp(c) ? "—" : (c.read_count ?? 0).toLocaleString("pt-BR"),
          effectiveRate(c) !== null ? `${effectiveRate(c)}%` : "—",
          format(new Date(c.created_at), "dd/MM/yyyy"),
        ]),
        styles:             { fontSize: 8, cellPadding: 2.5, textColor: [25,25,25], lineColor: [215,215,215], lineWidth: 0.2 },
        headStyles:         { fillColor: [75,75,75], textColor: [255,255,255], fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: [248,250,248] },
        columnStyles:       { 0: { cellWidth: 8, halign: "center" }, 1: { cellWidth: 55 } },
      } as never);

      // ══════════════════════════════════════════════════════════
      // VALOR TOTAL CONSOLIDADO (calculado de allMsgs)
      // ══════════════════════════════════════════════════════════
      const aggTotalValue = allMsgs.reduce((sum, m) => {
        const rd = m.recipient_data;
        if (!rd) return sum;
        const raw = rd._financial_campaign === true
          ? rd.valor_total_pendente
          : (() => {
              const k = Object.keys(rd).find((kk) =>
                ["valor", "value", "total", "amount"].some((t) => kk.toLowerCase().includes(t))
                && !kk.toLowerCase().includes("barras"),
              );
              return k ? rd[k] : null;
            })();
        if (raw == null) return sum;
        const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d,]/g, "").replace(",", "."));
        return isNaN(n) || n <= 0 ? sum : sum + n;
      }, 0);

      // ══════════════════════════════════════════════════════════
      // INSIGHT CONSOLIDADO
      // ══════════════════════════════════════════════════════════
      // Pegar Y após a tabela de campanhas (autoTable gerencia paginação)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 10;

      if (aggTotalValue > 0) {
        if (y > FOOTER_Y - 16) { doc.addPage(); y = MX + 6; }
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...DARK);
        doc.text(
          `Valor total consolidado: ${aggTotalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
          MX, y,
        );
        y += 10;
      }

      if (aggAttempted > 0) {
        let insightText: string;
        let iColor: [number,number,number], iBg: [number,number,number], iBorder: [number,number,number];
        if (aggSuccessPct >= 95) {
          insightText = `Taxa de sucesso consolidada de ${aggSuccessPct.toFixed(1)}% -- excelente desempenho de entrega`;
          iColor = GREEN; iBg = [240,253,244]; iBorder = [187,247,208];
        } else if (aggSuccessPct >= 85) {
          insightText = `Taxa de sucesso consolidada de ${aggSuccessPct.toFixed(1)}% -- dentro da media esperada`;
          iColor = AMBER; iBg = [255,251,235]; iBorder = [253,230,138];
        } else {
          insightText = `Atencao: taxa de sucesso consolidada de ${aggSuccessPct.toFixed(1)}% -- verifique a qualidade das bases`;
          iColor = RED; iBg = [254,242,242]; iBorder = [252,165,165];
        }
        if (y > FOOTER_Y - 16) { doc.addPage(); y = MX + 6; }
        doc.setFillColor(...iBg);
        doc.setDrawColor(...iBorder);
        doc.setLineWidth(0.4);
        doc.roundedRect(MX, y, W - MX * 2, 10, 2, 2, "FD");
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...iColor);
        doc.text(insightText, MX + 5, y + 6.8);
        y += 16;
      }

      // ══════════════════════════════════════════════════════════
      // LISTA CONSOLIDADA DE TODOS OS DESTINATÁRIOS
      // ══════════════════════════════════════════════════════════
      if (y > FOOTER_Y - 30) { doc.addPage(); y = MX; }
      y = sectionBar("LISTA CONSOLIDADA DE DESTINATARIOS", y);

      const hasAnyFinancial = allMsgs.some((m) => m.recipient_data?._financial_campaign === true);
      const hasEmailCamps   = target.some((c) => isEmailCamp(c));
      const hasWaCamps      = target.some((c) => !isEmailCamp(c));
      const mixedChannels   = hasEmailCamps && hasWaCamps;
      const contactColLabel = mixedChannels ? "Contato" : hasEmailCamps ? "Email" : "Telefone";

      const unifiedHead: string[] = ["#", "Campanha", "Nome", contactColLabel];
      if (hasAnyFinancial) unifiedHead.push("Valor", "Vencimento");
      unifiedHead.push("Status", "Enviado em");
      const unifiedStatusIdx = unifiedHead.indexOf("Status");

      const campNameMap2 = Object.fromEntries(target.map((c) => [c.id, c.name]));
      const campIsEmail  = Object.fromEntries(target.map((c) => [c.id, isEmailCamp(c)]));
      const campOrder    = Object.fromEntries(target.map((c, i) => [c.id, i]));

      // Ordenar: por ordem da campanha → falhas primeiro dentro de cada → por sent_at
      const sortedAll = [...allMsgs].sort((a, b) => {
        const oc = (campOrder[a.campaign_id] ?? 999) - (campOrder[b.campaign_id] ?? 999);
        if (oc !== 0) return oc;
        if (a.status === "failed" && b.status !== "failed") return -1;
        if (a.status !== "failed" && b.status === "failed") return 1;
        return (a.sent_at ?? "").localeCompare(b.sent_at ?? "");
      });

      const unifiedBody = sortedAll.map((m, idx) => {
        const rd         = m.recipient_data ?? {};
        const isEmail    = campIsEmail[m.campaign_id] ?? false;
        const contact    = isEmail ? ((rd.email as string) ?? m.recipient_phone ?? "--") : (m.recipient_phone ?? "--");
        const campRaw    = campNameMap2[m.campaign_id] ?? "--";
        const campShort  = campRaw.length > 30 ? campRaw.slice(0, 27) + "..." : campRaw;
        const row: string[] = [`${idx + 1}`, campShort, m.recipient_name ?? "--", contact];
        if (hasAnyFinancial) {
          row.push(typeof rd.valor_total_pendente === "string" ? rd.valor_total_pendente : "--");
          row.push(typeof rd.proximo_vencimento   === "string" ? rd.proximo_vencimento   : "--");
        }
        row.push(STATUS_PT[m.status] ?? m.status);
        row.push(m.sent_at ? format(new Date(m.sent_at), "dd/MM/yyyy, HH:mm") : "--");
        return row;
      });

      autoTable(doc, {
        head:   [unifiedHead],
        body:   unifiedBody,
        startY: y,
        margin: { left: MX, right: MX },
        styles:             { fontSize: 8, cellPadding: 2.5, textColor: [25,25,25], lineColor: [215,215,215], lineWidth: 0.2 },
        headStyles:         { fillColor: [75,75,75], textColor: [255,255,255], fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: [248,250,248] },
        columnStyles:       { 0: { cellWidth: 10, halign: "center" }, 1: { cellWidth: 42 } },
        // Group rows by campaign with a subtle background change
        didParseCell: (data: { row: { index: number }; column: { index: number }; section: string; cell: { raw: unknown; styles: { textColor: number[]; fontStyle: string; fillColor: number[] } } }) => {
          if (data.section !== "body") return;
          // Status column colours
          if (data.column.index === unifiedStatusIdx) {
            const v = data.cell.raw as string;
            if (["Enviado", "Entregue", "Lido", "Respondido"].includes(v)) {
              data.cell.styles.textColor = [22, 163, 74];
            } else if (["Falhou", "Nao entregavel"].includes(v)) {
              data.cell.styles.textColor = [220, 38, 38];
              data.cell.styles.fontStyle = "bold";
            } else if (v === "Na fila") {
              data.cell.styles.textColor = [130, 130, 130];
            }
          }
          // Alternating campaign group tint (odd campaign index gets slightly different bg)
          const msg = sortedAll[data.row.index];
          if (msg && (campOrder[msg.campaign_id] ?? 0) % 2 === 1) {
            data.cell.styles.fillColor = [245, 248, 252]; // subtle blue tint for odd campaigns
          }
        },
      } as never);

      // ── Rodapé em todas as páginas ─────────────────────────────
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

      doc.save(`relatorio_consolidado_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast({
        title:       "PDF gerado!",
        description: `${target.length} campanha${target.length !== 1 ? "s" : ""}  ·  ${allMsgs.length} destinatários`,
        variant:     "success",
      });
    } catch (err) {
      toast({ title: "Erro ao gerar PDF", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setExportingPdf(false);
    }
  }

  // ── Comprovante de Entrega (PDF consolidado — apenas WhatsApp entregues) ─────
  async function exportDeliveryProofPdf() {
    if (selected.size === 0) return;
    setExportingProof(true);
    try {
      const ids    = Array.from(selected);
      const target = campaigns.filter((c) => ids.includes(c.id) && !isEmailCamp(c));
      if (target.length === 0) {
        toast({ title: "Selecione campanhas WhatsApp", description: "O comprovante está disponível apenas para campanhas WhatsApp.", variant: "destructive" });
        setExportingProof(false);
        return;
      }

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

      interface DeliveredMsg {
        campaign_id:     string;
        recipient_name:  string | null;
        recipient_phone: string;
        status:          string;
        delivered_at:    string | null;
      }
      const allDelivered: DeliveredMsg[] = await fetchAll(
        db.from("shooting_messages")
          .select("campaign_id,recipient_name,recipient_phone,status,delivered_at")
          .in("campaign_id", ids)
          .in("status", ["delivered", "read", "replied"])
          .order("delivered_at", { ascending: true }),
      );

      const msgMap: Record<string, DeliveredMsg[]> = {};
      for (const m of allDelivered) {
        if (!msgMap[m.campaign_id]) msgMap[m.campaign_id] = [];
        msgMap[m.campaign_id].push(m);
      }

      const totalDelivered = allDelivered.length;
      const totalRead      = allDelivered.filter((m) => m.status === "read" || m.status === "replied").length;
      const totalRecip     = target.reduce((a, c) => a + (c.total_recipients ?? 0), 0);
      const avgRate        = totalRecip > 0 ? Math.round((totalDelivered / totalRecip) * 100) : 0;

      const DARK_BG  = [10,  20,  14]  as [number, number, number];
      const GREEN    = [63,  176, 108] as [number, number, number];
      const GREEN_DK = [22,  56,  36]  as [number, number, number];
      const WHITE    = [255, 255, 255] as [number, number, number];
      const LIGHT_GN = [242, 250, 244] as [number, number, number];
      const MUTED    = [107, 135, 115] as [number, number, number];
      const TEXT     = [20,  40,  26]  as [number, number, number];
      const AMBER    = [245, 158, 11]  as [number, number, number];
      const W = 210, H = 297, MX = 16;

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      // ── CAPA ───────────────────────────────────────────────────
      doc.setFillColor(...DARK_BG);
      doc.rect(0, 0, W, 155, "F");
      doc.setFillColor(...GREEN);
      doc.rect(0, 155, W, 3, "F");
      doc.setFillColor(...GREEN);
      doc.rect(0, 0, 4, 155, "F");

      if (logo) {
        doc.addImage(logo, "PNG", MX + 4, 16, 38, 13, undefined, "FAST");
      } else {
        doc.setFontSize(16); doc.setFont("helvetica", "bold");
        doc.setTextColor(...GREEN); doc.text("Solve AI", MX + 4, 26);
      }

      doc.setFontSize(34); doc.setFont("helvetica", "bold"); doc.setTextColor(...WHITE);
      doc.text("COMPROVANTE", MX + 4, 72);
      doc.text("DE ENTREGA",  MX + 4, 89);

      doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(...GREEN);
      doc.text("WhatsApp Business API  ·  Meta Oficial", MX + 4, 101);

      doc.setFontSize(8); doc.setTextColor(150, 190, 165);
      doc.text(
        `Emitido em ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}`,
        MX + 4, 112,
      );

      // círculo ✓ decorativo
      doc.setFillColor(22, 80, 46);  doc.circle(174, 64, 34, "F");
      doc.setFillColor(30, 110, 65); doc.circle(174, 64, 28, "F");
      doc.setFillColor(...GREEN);    doc.circle(174, 64, 22, "F");
      doc.setFontSize(26); doc.setFont("helvetica", "bold");
      doc.setTextColor(...WHITE); doc.text("✓", 174, 71, { align: "center" });

      // 4 cards de métricas consolidadas
      const metY = 168;
      const mw   = (W - MX * 2 - 12) / 4;
      [
        { label: "Campanhas",      value: target.length.toLocaleString("pt-BR"),  color: GREEN },
        { label: "Entregues",      value: totalDelivered.toLocaleString("pt-BR"), color: GREEN },
        { label: "Lidas",          value: totalRead.toLocaleString("pt-BR"),      color: AMBER },
        { label: "Taxa de Entrega",value: `${avgRate}%`, color: avgRate >= 80 ? GREEN : AMBER },
      ].forEach((m, i) => {
        const x = MX + i * (mw + 4);
        doc.setFillColor(...LIGHT_GN); doc.roundedRect(x, metY, mw, 36, 3, 3, "F");
        doc.setDrawColor(...GREEN); doc.setLineWidth(0.4); doc.roundedRect(x, metY, mw, 36, 3, 3, "S");
        doc.setFontSize(16); doc.setFont("helvetica", "bold");
        doc.setTextColor(...m.color); doc.text(m.value, x + mw / 2, metY + 17, { align: "center" });
        doc.setFontSize(6.5); doc.setFont("helvetica", "normal");
        doc.setTextColor(...MUTED); doc.text(m.label.toUpperCase(), x + mw / 2, metY + 27, { align: "center" });
      });

      // barra de progresso consolidada
      const barY = metY + 42;
      const rate = avgRate;
      doc.setFillColor(220, 235, 225); doc.roundedRect(MX, barY, W - MX * 2, 5, 2, 2, "F");
      const fillW = Math.max(0, Math.min((W - MX * 2) * rate / 100, W - MX * 2));
      if (fillW > 0) {
        doc.setFillColor(...(rate >= 80 ? GREEN : AMBER));
        doc.roundedRect(MX, barY, fillW, 5, 2, 2, "F");
      }
      doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(...MUTED);
      doc.text(`${rate}% de taxa de entrega consolidada`, W / 2, barY + 10, { align: "center" });

      doc.setFontSize(7); doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal");
      doc.text("Documento gerado automaticamente por Solve AI  ·  solveai.consulting", W / 2, H - 10, { align: "center" });

      // ── PÁG 2: RESUMO DAS CAMPANHAS ───────────────────────────
      doc.addPage();
      doc.setFillColor(...DARK_BG); doc.rect(0, 0, W, 24, "F");
      doc.setFillColor(...GREEN);   doc.rect(0, 0, 4, 24, "F");
      doc.setFillColor(...GREEN);   doc.rect(0, 24, W, 1.5, "F");
      if (logo) doc.addImage(logo, "PNG", MX + 4, 6, 22, 8, undefined, "FAST");
      doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...WHITE);
      doc.text("Resumo das Campanhas", logo ? MX + 30 : MX + 4, 15);
      doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(150, 190, 165);
      doc.text("Desempenho individual de cada campanha selecionada", logo ? MX + 30 : MX + 4, 21);

      const summaryRows = target.map((c) => {
        const del  = msgMap[c.id]?.length ?? 0;
        const read = msgMap[c.id]?.filter((m) => m.status === "read" || m.status === "replied").length ?? 0;
        const r    = c.total_recipients ? Math.round((del / c.total_recipients) * 100) : 0;
        return [
          c.name.length > 40 ? c.name.slice(0, 37) + "…" : c.name,
          format(new Date(c.completed_at ?? c.created_at), "dd/MM/yyyy"),
          (c.total_recipients ?? 0).toLocaleString("pt-BR"),
          del.toLocaleString("pt-BR"),
          read.toLocaleString("pt-BR"),
          `${r}%`,
        ];
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      autoTable(doc, {
        head: [["Campanha", "Data", "Destinatários", "Entregues", "Lidas", "Taxa"]],
        body: summaryRows,
        startY: 30,
        margin: { left: MX, right: MX },
        styles: { fontSize: 8, cellPadding: 3, textColor: TEXT, lineColor: [220, 235, 225], lineWidth: 0.2 },
        headStyles: { fillColor: GREEN_DK, textColor: WHITE, fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: LIGHT_GN },
        columnStyles: {
          2: { halign: "center" },
          3: { halign: "center", textColor: GREEN },
          4: { halign: "center" },
          5: { halign: "center", fontStyle: "bold" },
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // ── PÁG 3+: TODOS OS ENTREGUES CONSOLIDADOS ───────────────
      doc.addPage();
      doc.setFillColor(...DARK_BG); doc.rect(0, 0, W, 24, "F");
      doc.setFillColor(...GREEN);   doc.rect(0, 0, 4, 24, "F");
      doc.setFillColor(...GREEN);   doc.rect(0, 24, W, 1.5, "F");
      if (logo) doc.addImage(logo, "PNG", MX + 4, 6, 22, 8, undefined, "FAST");
      doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...WHITE);
      doc.text("Destinatários Alcançados", logo ? MX + 30 : MX + 4, 15);
      doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(150, 190, 165);
      doc.text(`${totalDelivered.toLocaleString("pt-BR")} mensagens entregues com sucesso`, logo ? MX + 30 : MX + 4, 21);

      const campNameMap = Object.fromEntries(target.map((c) => [c.id, c.name]));
      const contactRows = allDelivered.map((m) => [
        (campNameMap[m.campaign_id] ?? "").length > 28
          ? (campNameMap[m.campaign_id] ?? "").slice(0, 25) + "…"
          : (campNameMap[m.campaign_id] ?? ""),
        m.recipient_name ?? "—",
        m.recipient_phone ?? "—",
        m.status === "replied" ? "Respondeu" : m.status === "read" ? "Lida" : "Entregue",
        m.delivered_at ? format(new Date(m.delivered_at), "dd/MM HH:mm") : "—",
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      autoTable(doc, {
        head: [["Campanha", "Nome", "Telefone", "Status", "Entregue em"]],
        body: contactRows,
        startY: 30,
        margin: { left: MX, right: MX },
        styles: { fontSize: 7.5, cellPadding: 2.5, textColor: TEXT, lineColor: [220, 235, 225], lineWidth: 0.2 },
        headStyles: { fillColor: GREEN_DK, textColor: WHITE, fontStyle: "bold", fontSize: 7.5 },
        alternateRowStyles: { fillColor: LIGHT_GN },
        columnStyles: { 3: { halign: "center" }, 4: { halign: "center" } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // rodapé em todas as páginas
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(7); doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal");
        doc.text("Solve AI  ·  solveai.consulting", MX, H - 5);
        doc.text(`Página ${i} / ${pages}`, W - MX, H - 5, { align: "right" });
      }

      doc.save(`comprovante_entrega_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast({
        title:       "Comprovante gerado!",
        description: `${totalDelivered.toLocaleString("pt-BR")} msgs entregues · ${target.length} campanha${target.length !== 1 ? "s" : ""}`,
        variant:     "success",
      });
    } catch (err) {
      toast({ title: "Erro ao gerar comprovante", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setExportingProof(false);
    }
  }

  const DATE_OPTS: { id: DateRange; label: string }[] = [
    { id: "7d",  label: "7 dias"  },
    { id: "30d", label: "30 dias" },
    { id: "90d", label: "90 dias" },
    { id: "all", label: "Todos"   },
  ];
  const STATUS_OPTS: { id: CampStatus; label: string }[] = [
    { id: "all",       label: "Todos os status" },
    { id: "completed", label: "Concluído"        },
    { id: "sending",   label: "Enviando"         },
    { id: "paused",    label: "Pausado"          },
    { id: "failed",    label: "Falhou"           },
    { id: "cancelled", label: "Cancelado"        },
    { id: "draft",     label: "Rascunho"         },
    { id: "scheduled", label: "Agendado"         },
  ];

  const busy = exporting || exportingPdf || exportingProof;

  return (
    <div className="space-y-6">

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total campanhas"    value={campaigns.length}                       icon={Send}          color="#3fb06c" bg="rgba(63,176,108,0.08)"  border="rgba(63,176,108,0.15)"  />
        <StatCard label="Mensagens enviadas" value={totalSent.toLocaleString("pt-BR")}      icon={MessageSquare} color="#60a5fa" bg="rgba(59,130,246,0.08)"  border="rgba(59,130,246,0.15)"  />
        <StatCard label="Entregues"          value={totalDelivered.toLocaleString("pt-BR")} icon={CheckCircle2}  color="#3fb06c" bg="rgba(63,176,108,0.08)"  border="rgba(63,176,108,0.15)"  />
        <StatCard label="Taxa de entrega"    value={`${deliveryRate}%`} sub={`${totalRead.toLocaleString("pt-BR")} lidas`} icon={Eye} color="#fbbf24" bg="rgba(245,158,11,0.08)" border="rgba(245,158,11,0.15)" />
      </div>

      {/* Filters + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}>
          {DATE_OPTS.map((o) => (
            <button key={o.id} onClick={() => setDateRange(o.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={dateRange === o.id ? { background: "rgba(63,176,108,0.18)", color: "#3fb06c" } : { color: "#6b7f6e" }}
            >{o.label}</button>
          ))}
        </div>

        <select value={status} onChange={(e) => setStatus(e.target.value as CampStatus)}
          className="px-3 py-1.5 rounded-xl text-xs font-medium text-[#6b7f6e] focus:outline-none focus:border-[#3fb06c] transition-colors"
          style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
          {STATUS_OPTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>

        <div className="flex-1" />

        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#6b7f6e] hover:text-white disabled:opacity-50 transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>

        <button onClick={() => exportXlsx()} disabled={!campaigns.length || loading || busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#3fb06c] hover:bg-[#1e2e22] disabled:opacity-40 transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.25)" }}
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {exporting ? "Exportando…" : "Exportar XLSX"}
        </button>
      </div>

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl transition-all"
          style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.3)" }}>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#3fb06c] animate-pulse" />
            <span className="text-sm font-semibold text-[#3fb06c]">
              {selected.size} campanha{selected.size !== 1 ? "s" : ""} selecionada{selected.size !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex-1" />

          <button
            onClick={() => exportXlsx(Array.from(selected))}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
            style={{ background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }}
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Exportar XLSX
          </button>

          <button
            onClick={() => setOnlyDelivered((v) => !v)}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
            style={onlyDelivered
              ? { background: "rgba(63,176,108,0.18)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.5)" }
              : { background: "transparent",           color: "#6b7f6e",  border: "1px solid rgba(107,135,115,0.3)" }}
          >
            <div className="w-3 h-3 rounded-sm border flex items-center justify-center"
              style={{ borderColor: onlyDelivered ? "#3fb06c" : "#6b7f6e", background: onlyDelivered ? "#3fb06c" : "transparent" }}>
              {onlyDelivered && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
            </div>
            Só entregues no PDF
          </button>

          <button
            onClick={exportPdf}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
            style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}
          >
            {exportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {exportingPdf ? "Gerando PDF…" : "Exportar PDF"}
          </button>

          <button
            onClick={exportDeliveryProofPdf}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
            style={{ background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.4)" }}
          >
            {exportingProof ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
            {exportingProof ? "Gerando…" : "Comprovante de Entrega"}
          </button>

          <button
            onClick={() => setSelected(new Set())}
            disabled={busy}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-[#6b7f6e] hover:text-white transition-colors disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5" />
            Limpar
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              {/* Select-all checkbox */}
              <th className="px-4 py-3 w-10">
                <button
                  onClick={toggleAll}
                  className="w-4 h-4 rounded flex items-center justify-center transition-colors"
                  style={allSelected || someSelected
                    ? { background: "rgba(63,176,108,0.25)", border: "1px solid #3fb06c" }
                    : { background: "transparent", border: "1px solid rgba(63,176,108,0.25)" }}
                >
                  {allSelected && <CheckCircle2 className="w-3 h-3 text-[#3fb06c]" />}
                  {someSelected && <div className="w-2 h-0.5 bg-[#3fb06c] rounded" />}
                </button>
              </th>
              {["Campanha", "Status", "Destinatários", "Enviadas", "Entregues", "Falhas", "Lidas", "Entrega %", "Data"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.05)" }}>
                  {Array.from({ length: 10 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.06)", width: j === 1 ? "70%" : "50%" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : campaigns.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-14 text-center text-[#6b7f6e]">Nenhuma campanha encontrada para os filtros selecionados</td>
              </tr>
            ) : campaigns.map((c, i) => {
              const sent     = c.sent_count ?? 0;
              const del      = effectiveDelivered(c);
              const failed   = c.failed_count ?? 0;
              const rate     = effectiveRate(c);
              const st       = CAMP_STATUS[c.status] ?? CAMP_STATUS["draft"];
              const isChecked = selected.has(c.id);
              return (
                <tr key={c.id}
                  className="transition-colors cursor-pointer"
                  style={{
                    borderBottom: i < campaigns.length - 1 ? "1px solid rgba(63,176,108,0.05)" : "none",
                    background: isChecked ? "rgba(63,176,108,0.06)" : undefined,
                  }}
                  onClick={() => toggleOne(c.id)}
                >
                  {/* Row checkbox */}
                  <td className="px-4 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleOne(c.id)}
                      className="w-4 h-4 rounded flex items-center justify-center transition-colors"
                      style={isChecked
                        ? { background: "rgba(63,176,108,0.25)", border: "1px solid #3fb06c" }
                        : { background: "transparent", border: "1px solid rgba(63,176,108,0.2)" }}
                    >
                      {isChecked && <CheckCircle2 className="w-3 h-3 text-[#3fb06c]" />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-white truncate max-w-[200px]">{c.name}</p>
                    {c.meta_templates?.template_name && (
                      <p className="text-[10px] text-[#6b7f6e] truncate max-w-[200px]">{c.meta_templates.template_name}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#8faf9a]">{(c.total_recipients ?? 0).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3 text-[#8faf9a]">{sent.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3 text-[#3fb06c]">{del.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3">
                    {failed > 0
                      ? <span className="font-semibold" style={{ color: "#f87171" }}>{failed.toLocaleString("pt-BR")}</span>
                      : <span className="text-[#6b7f6e]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[#fbbf24]">{isEmailCamp(c) ? <span className="text-[#6b7f6e]">—</span> : (c.read_count ?? 0).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3">
                    {rate !== null ? (
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(63,176,108,0.1)" }}>
                          <div className="h-full rounded-full transition-all" style={{
                            width: `${rate}%`,
                            background: rate >= 80 ? "#3fb06c" : rate >= 50 ? "#fbbf24" : "#f87171",
                          }} />
                        </div>
                        <span className="text-xs text-[#8faf9a]">{rate}%</span>
                      </div>
                    ) : <span className="text-[#6b7f6e]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[#6b7f6e] text-xs whitespace-nowrap">
                    {format(new Date(c.created_at), "dd/MM/yyyy")}
                    {c.completed_at && (
                      <p className="text-[10px] text-[#4a6b50]">
                        concl. {format(new Date(c.completed_at), "dd/MM/yyyy")}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// AUDIT LOG VIEWER
// ════════════════════════════════════════════════════════════════

const PAGE_SIZE = 50;

function AuditLogViewer({ workspaceId }: { workspaceId: string }) {
  const [logs,        setLogs]        = useState<AuditLog[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [page,        setPage]        = useState(0);
  const [hasMore,     setHasMore]     = useState(true);
  const [eventFilter, setEventFilter] = useState("all");
  const [expandedId,  setExpandedId]  = useState<string | null>(null);

  const eventTypes = Array.from(new Set(logs.map((l) => l.event_type))).sort();

  const load = useCallback(async (pg: number, append: boolean) => {
    setLoading(true);
    let q = db
      .from("audit_logs")
      .select("id,event_type,entity_type,entity_id,status,error,metadata,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE - 1);
    if (eventFilter !== "all") q = q.eq("event_type", eventFilter);
    const { data } = await q;
    const rows: AuditLog[] = data ?? [];
    setLogs((prev) => append ? [...prev, ...rows] : rows);
    setHasMore(rows.length === PAGE_SIZE);
    setLoading(false);
  }, [workspaceId, eventFilter]);

  useEffect(() => { setPage(0); load(0, false); }, [load]);

  function loadMore() {
    const next = page + 1;
    setPage(next);
    load(next, true);
  }

  return (
    <div className="space-y-4">

      {/* Admin notice */}
      <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs text-[#fbbf24]"
        style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
        <Shield className="w-4 h-4 shrink-0" />
        Área restrita — visível apenas para administradores. Todos os eventos sensíveis do sistema são registrados aqui.
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}
          className="px-3 py-1.5 rounded-xl text-xs font-medium text-[#6b7f6e] focus:outline-none focus:border-[#3fb06c] transition-colors"
          style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <option value="all">Todos os eventos</option>
          {eventTypes.map((et) => <option key={et} value={et}>{eventLabel(et)}</option>)}
        </select>

        <span className="text-xs text-[#6b7f6e]">{logs.length}{hasMore ? "+" : ""} registros</span>

        <div className="flex-1" />

        <button onClick={() => { setPage(0); load(0, false); }} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#6b7f6e] hover:text-white disabled:opacity-50 transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              {["Data/hora", "Evento", "Entidade", "Status", "Detalhe"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && logs.length === 0 ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.05)" }}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.06)", width: "75%" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-14 text-center text-[#6b7f6e]">Nenhum registro de auditoria encontrado</td>
              </tr>
            ) : logs.map((log) => {
              const st         = auditStyle(log.status);
              const isExpanded = expandedId === log.id;
              const hasMeta    = !!(log.metadata && Object.keys(log.metadata).length > 0);
              const clickable  = hasMeta || !!log.error;

              return (
                <Fragment key={log.id}>
                  <tr
                    className={`transition-colors ${clickable ? "cursor-pointer hover:bg-white/[0.02]" : ""}`}
                    style={{ borderBottom: "1px solid rgba(63,176,108,0.05)" }}
                    onClick={() => clickable && setExpandedId(isExpanded ? null : log.id)}
                  >
                    <td className="px-4 py-3 text-xs text-[#6b7f6e] whitespace-nowrap font-mono">
                      {format(new Date(log.created_at), "dd/MM/yy HH:mm:ss")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-white font-medium">{eventLabel(log.event_type)}</span>
                      <p className="text-[10px] text-[#4a6b50] font-mono">{log.event_type}</p>
                    </td>
                    <td className="px-4 py-3">
                      {log.entity_type ? (
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-[#6b7f6e]">{log.entity_type}</span>
                          {log.entity_id && (
                            <p className="text-xs text-[#8faf9a] font-mono truncate max-w-[160px]" title={log.entity_id}>
                              {log.entity_id}
                            </p>
                          )}
                        </div>
                      ) : <span className="text-[#6b7f6e]">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
                        style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {log.error && (
                          <span className="text-xs text-[#f87171] truncate max-w-[200px]" title={log.error}>{log.error}</span>
                        )}
                        {clickable && (
                          <button className="text-[#6b7f6e] hover:text-white transition-colors ml-auto shrink-0">
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr style={{ background: "rgba(0,0,0,0.25)", borderBottom: "1px solid rgba(63,176,108,0.05)" }}>
                      <td colSpan={5} className="px-6 py-4">
                        {log.error && (
                          <div className="mb-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#f87171] mb-1">Erro</p>
                            <p className="text-xs text-[#fca5a5] font-mono break-words">{log.error}</p>
                          </div>
                        )}
                        {hasMeta && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6b7f6e] mb-1">Metadata</p>
                            <pre className="text-[11px] text-[#8faf9a] font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-52 overflow-y-auto rounded-lg p-3"
                              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(63,176,108,0.08)" }}>
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <button onClick={loadMore} disabled={loading}
            className="flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-medium text-[#3fb06c] disabled:opacity-50 hover:bg-[#1e2e22] transition-colors"
            style={{ border: "1px solid rgba(63,176,108,0.2)" }}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Carregar mais 50 registros
          </button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// INBOX / ATENDIMENTO REPORT
// ════════════════════════════════════════════════════════════════

interface ConvRow {
  id: string;
  status: "open" | "pending" | "resolved";
  department_id: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  departments: { name: string; color: string } | null;
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function InboxStatCard({ label, value, sub, icon: Icon, color, bg, border }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; bg: string; border: string;
}) {
  return (
    <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: bg, border: `1px solid ${border}` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: color + "aa" }}>{label}</p>
        <p className="text-2xl font-bold" style={{ color }}>{value}</p>
        {sub && <p className="text-[10px] mt-0.5" style={{ color: color + "88" }}>{sub}</p>}
      </div>
    </div>
  );
}

function InboxReport({ workspaceId }: { workspaceId: string }) {
  const [convs,    setConvs]    = useState<ConvRow[]>([]);
  const [agents,   setAgents]   = useState<{ id: string; full_name: string | null }[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [range,    setRange]    = useState<DateRange>("30d");
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const since = range === "all" ? null
      : startOfDay(subDays(new Date(), parseInt(range))).toISOString();

    let q = db
      .from("inbox_conversations")
      .select("id, status, department_id, assigned_to, created_at, updated_at, departments(name, color)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (since) q = q.gte("created_at", since);

    const { data } = await q;
    const rows: ConvRow[] = data ?? [];
    setConvs(rows);

    const ids = [...new Set(rows.filter(c => c.assigned_to).map(c => c.assigned_to as string))];
    if (ids.length) {
      const { data: p } = await db.from("user_profiles").select("id, full_name").in("id", ids);
      setAgents(p ?? []);
    } else {
      setAgents([]);
    }
    setLoading(false);
  }, [workspaceId, range]);

  useEffect(() => { load(); }, [load]);

  // ── Computed metrics ─────────────────────────────────────────────
  const total    = convs.length;
  const resolved = convs.filter(c => c.status === "resolved");
  const open     = convs.filter(c => c.status === "open");
  const pending  = convs.filter(c => c.status === "pending");
  const unassigned = convs.filter(c => !c.assigned_to && c.status !== "resolved").length;

  const tmaMs = resolved.length > 0
    ? resolved.reduce((s, c) =>
        s + (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()), 0
      ) / resolved.length
    : 0;

  // ── By department ────────────────────────────────────────────────
  type DeptStats = { name: string; color: string; open: number; pending: number; resolved: number; tmaMsSum: number; tmaCount: number };
  const deptMap = new Map<string, DeptStats>();
  for (const c of convs) {
    const key  = c.department_id ?? "__none__";
    const name = c.departments?.name  ?? "Sem setor";
    const col  = c.departments?.color ?? "#6b7f6e";
    if (!deptMap.has(key)) deptMap.set(key, { name, color: col, open: 0, pending: 0, resolved: 0, tmaMsSum: 0, tmaCount: 0 });
    const d = deptMap.get(key)!;
    if (c.status === "open")     d.open++;
    if (c.status === "pending")  d.pending++;
    if (c.status === "resolved") {
      d.resolved++;
      d.tmaMsSum += new Date(c.updated_at).getTime() - new Date(c.created_at).getTime();
      d.tmaCount++;
    }
  }
  const deptRows = [...deptMap.values()].sort((a, b) => (b.open + b.pending + b.resolved) - (a.open + a.pending + a.resolved));

  // ── By agent ─────────────────────────────────────────────────────
  type AgentStats = { name: string; open: number; pending: number; resolved: number; tmaMsSum: number; tmaCount: number };
  const agentNameMap = new Map(agents.map(a => [a.id, a.full_name ?? "—"]));
  const agentStatsMap = new Map<string, AgentStats>();
  for (const c of convs) {
    if (!c.assigned_to) continue;
    const key  = c.assigned_to;
    const name = agentNameMap.get(key) ?? key.slice(0, 8) + "…";
    if (!agentStatsMap.has(key)) agentStatsMap.set(key, { name, open: 0, pending: 0, resolved: 0, tmaMsSum: 0, tmaCount: 0 });
    const a = agentStatsMap.get(key)!;
    if (c.status === "open")     a.open++;
    if (c.status === "pending")  a.pending++;
    if (c.status === "resolved") {
      a.resolved++;
      a.tmaMsSum += new Date(c.updated_at).getTime() - new Date(c.created_at).getTime();
      a.tmaCount++;
    }
  }
  const agentRows = [...agentStatsMap.values()].sort((a, b) => (b.open + b.resolved) - (a.open + a.resolved));

  // ── Export XLSX ───────────────────────────────────────────────────
  function exportXlsx() {
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();

      // Resumo
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ["Relatório de Atendimento — Solve AI"],
        ["Período", range === "all" ? "Todos" : `Últimos ${parseInt(range)} dias`],
        ["Gerado em", format(new Date(), "dd/MM/yyyy HH:mm")],
        [],
        ["Total de conversas", total],
        ["Abertas",   open.length],
        ["Pendentes", pending.length],
        ["Resolvidas", resolved.length],
        ["TMA (resolvidas)", fmtDuration(tmaMs)],
        ["Sem atribuição (abertas/pendentes)", unassigned],
      ]), "Resumo");

      // Por setor
      const deptSheet: (string | number)[][] = [
        ["Setor", "Abertas", "Pendentes", "Resolvidas", "Total", "TMA"],
        ...deptRows.map(d => [
          d.name, d.open, d.pending, d.resolved,
          d.open + d.pending + d.resolved,
          d.tmaCount > 0 ? fmtDuration(d.tmaMsSum / d.tmaCount) : "—",
        ]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(deptSheet), "Por Setor");

      // Por agente
      const agentSheet: (string | number)[][] = [
        ["Agente", "Abertas", "Pendentes", "Resolvidas", "Total", "TMA"],
        ...agentRows.map(a => [
          a.name, a.open, a.pending, a.resolved,
          a.open + a.pending + a.resolved,
          a.tmaCount > 0 ? fmtDuration(a.tmaMsSum / a.tmaCount) : "—",
        ]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(agentSheet), "Por Agente");

      XLSX.writeFile(wb, `atendimento_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast({ title: "XLSX exportado", variant: "success" });
    } finally {
      setExporting(false);
    }
  }

  const RANGE_OPTS: { id: DateRange; label: string }[] = [
    { id: "7d",  label: "7 dias"  },
    { id: "30d", label: "30 dias" },
    { id: "90d", label: "90 dias" },
    { id: "all", label: "Todos"   },
  ];

  const TH = "px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] whitespace-nowrap";
  const TD = "px-4 py-3 text-xs text-[#c8dccf]";

  function Bar({ pct, color }: { pct: number; color: string }) {
    return (
      <div className="flex items-center gap-2 min-w-[80px]">
        <div className="flex-1 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
        <span className="text-[10px] font-mono" style={{ color }}>{pct}%</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(8,14,10,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}>
          {RANGE_OPTS.map(o => (
            <button key={o.id} onClick={() => setRange(o.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={range === o.id ? { background: "rgba(63,176,108,0.18)", color: "#3fb06c" } : { color: "#6b7f6e" }}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#6b7f6e] hover:text-white disabled:opacity-50 transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button onClick={exportXlsx} disabled={loading || exporting || total === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#3fb06c] hover:bg-[#1e2e22] disabled:opacity-40 transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.25)" }}>
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Exportar XLSX
        </button>
      </div>

      {/* Summary cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0,1,2,3].map(i => <div key={i} className="h-24 rounded-xl animate-pulse" style={{ background: "rgba(63,176,108,0.05)" }} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <InboxStatCard label="Total de conversas" value={total}           icon={MessageSquare} color="#3fb06c" bg="rgba(63,176,108,0.07)"  border="rgba(63,176,108,0.15)" />
          <InboxStatCard label="Abertas / Pendentes" value={open.length + pending.length} sub={`${unassigned} sem atribuição`} icon={TrendingUp} color="#fbbf24" bg="rgba(245,158,11,0.07)" border="rgba(245,158,11,0.15)" />
          <InboxStatCard label="Resolvidas"          value={resolved.length} sub={total > 0 ? `${Math.round(resolved.length/total*100)}% do total` : undefined} icon={CheckCircle2} color="#60a5fa" bg="rgba(59,130,246,0.07)" border="rgba(59,130,246,0.15)" />
          <InboxStatCard label="TMA (resolvidas)"    value={fmtDuration(tmaMs)} sub="tempo médio de atendimento" icon={Clock} color="#a78bfa" bg="rgba(167,139,250,0.07)" border="rgba(167,139,250,0.15)" />
        </div>
      )}

      {/* By department */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
        <div className="px-4 py-3 flex items-center gap-2" style={{ background: "rgba(8,14,10,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
          <Users className="w-3.5 h-3.5" style={{ color: "#3fb06c" }} />
          <span className="text-xs font-semibold text-[#c8dccf] uppercase tracking-wider">Por setor</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.06)" }}>
              {["Setor", "Abertas", "Pendentes", "Resolvidas", "Total", "% Resolução", "TMA"].map(h => (
                <th key={h} className={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.04)" }}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3.5 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.06)", width: j === 0 ? "60%" : "40%" }} /></td>
                  ))}
                </tr>
              ))
            ) : deptRows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[#6b7f6e] text-xs">Nenhuma conversa no período selecionado</td></tr>
            ) : deptRows.map((d, i) => {
              const tot = d.open + d.pending + d.resolved;
              const resPct = tot > 0 ? Math.round(d.resolved / tot * 100) : 0;
              return (
                <tr key={i} style={{ borderBottom: i < deptRows.length - 1 ? "1px solid rgba(63,176,108,0.04)" : "none" }}>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="font-medium text-white">{d.name}</span>
                    </div>
                  </td>
                  <td className={TD}><span style={{ color: "#fbbf24" }}>{d.open}</span></td>
                  <td className={TD}><span style={{ color: "#fb923c" }}>{d.pending}</span></td>
                  <td className={TD}><span style={{ color: "#60a5fa" }}>{d.resolved}</span></td>
                  <td className={TD + " font-semibold text-white"}>{tot}</td>
                  <td className={TD}><Bar pct={resPct} color="#60a5fa" /></td>
                  <td className={TD}>{d.tmaCount > 0 ? fmtDuration(d.tmaMsSum / d.tmaCount) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* By agent */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
        <div className="px-4 py-3 flex items-center gap-2" style={{ background: "rgba(8,14,10,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
          <Headphones className="w-3.5 h-3.5" style={{ color: "#3fb06c" }} />
          <span className="text-xs font-semibold text-[#c8dccf] uppercase tracking-wider">Por agente</span>
          {unassigned > 0 && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.1)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.2)" }}>
              {unassigned} sem atribuição
            </span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.06)" }}>
              {["Agente", "Abertas", "Pendentes", "Resolvidas", "Total", "% Resolução", "TMA"].map(h => (
                <th key={h} className={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.04)" }}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3.5 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.06)", width: j === 0 ? "60%" : "40%" }} /></td>
                  ))}
                </tr>
              ))
            ) : agentRows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[#6b7f6e] text-xs">Nenhuma conversa atribuída no período</td></tr>
            ) : agentRows.map((a, i) => {
              const tot = a.open + a.pending + a.resolved;
              const resPct = tot > 0 ? Math.round(a.resolved / tot * 100) : 0;
              return (
                <tr key={i} style={{ borderBottom: i < agentRows.length - 1 ? "1px solid rgba(63,176,108,0.04)" : "none" }}>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ background: "linear-gradient(135deg,#3fb06c,#16A34A)" }}>
                        {(a.name[0] ?? "?").toUpperCase()}
                      </div>
                      <span className="font-medium text-white truncate max-w-[140px]">{a.name}</span>
                    </div>
                  </td>
                  <td className={TD}><span style={{ color: "#fbbf24" }}>{a.open}</span></td>
                  <td className={TD}><span style={{ color: "#fb923c" }}>{a.pending}</span></td>
                  <td className={TD}><span style={{ color: "#60a5fa" }}>{a.resolved}</span></td>
                  <td className={TD + " font-semibold text-white"}>{tot}</td>
                  <td className={TD}><Bar pct={resPct} color="#60a5fa" /></td>
                  <td className={TD}>{a.tmaCount > 0 ? fmtDuration(a.tmaMsSum / a.tmaCount) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════

export function Reports() {
  const { profile, workspaceId } = useAuth();
  const isAdmin = profile?.role === "admin";
  const wid     = workspaceId ?? "";

  const [tab, setTab] = useState<MainTab>("campaigns");

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Relatórios" }]} />

      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-start gap-4 mb-6 animate-fade-up">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}>
            <BarChart2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white leading-none mb-1">Relatórios</h1>
            <p className="text-sm text-[#6b7f6e]">Campanhas, atendimento por setor/agente e auditoria do sistema</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl w-fit mb-6"
          style={{ background: "rgba(8,14,10,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}>
          {([
            { id: "campaigns", label: "Campanhas",   icon: Send       },
            { id: "inbox",     label: "Atendimento", icon: Headphones },
          ] as { id: MainTab; label: string; icon: React.ElementType }[]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={tab === t.id
                ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }
                : { color: "#6b7f6e", border: "1px solid transparent" }}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
          {isAdmin && (
            <button onClick={() => setTab("audit")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={tab === "audit"
                ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }
                : { color: "#6b7f6e", border: "1px solid transparent" }}>
              <Shield className="w-4 h-4" /> Auditoria
            </button>
          )}
        </div>

        {tab === "campaigns" && <CampaignReport workspaceId={wid} />}
        {tab === "inbox"     && <InboxReport    workspaceId={wid} />}
        {tab === "audit" && isAdmin && <AuditLogViewer workspaceId={wid} />}
      </div>
    </div>
  );
}
