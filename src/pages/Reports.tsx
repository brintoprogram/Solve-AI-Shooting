import { useCallback, useEffect, useState, Fragment } from "react";
import {
  BarChart2, Download, RefreshCw, Shield, Send,
  CheckCircle2, Eye, Loader2, ChevronDown, ChevronUp,
  MessageSquare,
} from "lucide-react";
import * as XLSX from "xlsx";
import { format, subDays, startOfDay } from "date-fns";
import { Topbar } from "@/components/layout/Topbar";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type MainTab    = "campaigns" | "audit";
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
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [status,    setStatus]    = useState<CampStatus>("all");

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

  const totalSent      = campaigns.reduce((a, c) => a + (c.sent_count ?? 0), 0);
  const totalDelivered = campaigns.reduce((a, c) => a + effectiveDelivered(c), 0);
  const totalRead      = campaigns.reduce((a, c) => a + (c.read_count ?? 0), 0);
  const totalRecip     = campaigns.reduce((a, c) => a + (c.total_recipients ?? 0), 0);
  const deliveryRate   = totalRecip > 0 ? Math.round((totalDelivered / totalRecip) * 100) : 0;

  async function exportXlsx() {
    setExporting(true);
    try {
      // Fetch all rows paginated (Supabase caps at 1000/request)
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

      const campNameMap = Object.fromEntries(campaigns.map((c) => [c.id, c.name]));

      // ── Aba 1: Resumo campanhas ──────────────────────────────────
      const summaryRows = campaigns.map((c) => ({
        "Nome":             c.name,
        "Canal":            isEmailCamp(c) ? "Email Automático" : "WhatsApp",
        "Template":         c.meta_templates?.template_name ?? "",
        "Status":           CAMP_STATUS[c.status]?.label ?? c.status,
        "Destinatários":    c.total_recipients ?? 0,
        "Enviadas":         c.sent_count ?? 0,
        "Entregues":        effectiveDelivered(c),
        "Lidas":            isEmailCamp(c) ? "" : (c.read_count ?? 0),
        "Respondidas":      isEmailCamp(c) ? "" : (c.replied_count ?? 0),
        "Falhas":           c.failed_count ?? 0,
        "Taxa entrega (%)": effectiveRate(c) ?? 0,
        "Criada em":        format(new Date(c.created_at), "dd/MM/yyyy HH:mm"),
        "Iniciada em":      c.started_at   ? format(new Date(c.started_at),   "dd/MM/yyyy HH:mm") : "",
        "Concluída em":     c.completed_at ? format(new Date(c.completed_at), "dd/MM/yyyy HH:mm") : "",
      }));

      // ── Aba 2: WhatsApp — mensagens individuais ──────────────────
      const waCampIds = campaigns.filter((c) => !isEmailCamp(c)).map((c) => c.id);
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
          "Campanha":           campNameMap[m.campaign_id] ?? m.campaign_id,
          "Nome":               m.recipient_name ?? "",
          "Telefone":           m.recipient_phone ?? "",
          "Email":              m.recipient_data?.email ?? "",
          "Empresa":            m.recipient_data?.empresa ?? "",
          "Valor Pendente":     m.recipient_data?.valor_total_pendente ?? "",
          "Próx. Vencimento":   m.recipient_data?.proximo_vencimento ?? "",
          "Status":             m.status ?? "",
          "Erro":               m.error_message ?? "",
          "Criada em":          m.created_at  ? format(new Date(m.created_at),  "dd/MM/yyyy HH:mm") : "",
          "Enviada em":         m.sent_at     ? format(new Date(m.sent_at),     "dd/MM/yyyy HH:mm") : "",
          "Entregue em":        m.delivered_at ? format(new Date(m.delivered_at),"dd/MM/yyyy HH:mm") : "",
          "Lida em":            m.read_at     ? format(new Date(m.read_at),     "dd/MM/yyyy HH:mm") : "",
        }));
      }

      // ── Aba 3: Email — automático (shooting_messages) + SMTP (email_messages) ──
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let emailRows: Record<string, any>[] = [];

      const n8nCampIds = campaigns.filter((c) => isEmailCamp(c)).map((c) => c.id);
      if (n8nCampIds.length > 0) {
        const msgs = await fetchAll(
          db.from("shooting_messages")
            .select("campaign_id,recipient_name,recipient_phone,recipient_data,status,error_message,created_at")
            .in("campaign_id", n8nCampIds)
            .order("campaign_id,created_at", { ascending: true }),
        );
        emailRows.push(...msgs.map((m) => ({
          "Campanha":         campNameMap[m.campaign_id] ?? m.campaign_id,
          "Canal":            "Automático",
          "Nome":             m.recipient_name ?? "",
          "Email":            m.recipient_data?.email ?? m.recipient_phone ?? "",
          "Empresa":          m.recipient_data?.empresa ?? "",
          "Valor Pendente":   m.recipient_data?.valor_total_pendente ?? "",
          "Próx. Vencimento": m.recipient_data?.proximo_vencimento ?? "",
          "Status":           m.status ?? "",
          "Erro":             m.error_message ?? "",
          "Enviada em":       m.created_at ? format(new Date(m.created_at), "dd/MM/yyyy HH:mm") : "",
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
          "Campanha":         smtpNameMap[m.campaign_id] ?? m.campaign_id,
          "Canal":            "SMTP",
          "Nome":             m.recipient_name ?? "",
          "Email":            m.recipient_email ?? "",
          "Empresa":          "",
          "Valor Pendente":   "",
          "Próx. Vencimento": "",
          "Status":           m.status ?? "",
          "Erro":             m.error_message ?? "",
          "Enviada em":       m.sent_at     ? format(new Date(m.sent_at),     "dd/MM/yyyy HH:mm")
                            : m.created_at  ? format(new Date(m.created_at),  "dd/MM/yyyy HH:mm") : "",
        })));
      }

      // ── Montar workbook ──────────────────────────────────────────
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows.length ? summaryRows : [{}]), "Campanhas");
      if (waRows.length > 0)    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(waRows),    "WhatsApp");
      if (emailRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(emailRows), "Email");

      XLSX.writeFile(wb, `relatorio_${new Date().toISOString().slice(0, 10)}.xlsx`);
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

        <button onClick={exportXlsx} disabled={!campaigns.length || loading || exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#3fb06c] hover:bg-[#1e2e22] disabled:opacity-40 transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.25)" }}
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {exporting ? "Exportando…" : "Exportar XLSX"}
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              {["Campanha", "Status", "Destinatários", "Enviadas", "Entregues", "Lidas", "Entrega %", "Data"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.05)" }}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.06)", width: j === 0 ? "70%" : "50%" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : campaigns.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-14 text-center text-[#6b7f6e]">Nenhuma campanha encontrada para os filtros selecionados</td>
              </tr>
            ) : campaigns.map((c, i) => {
              const sent = c.sent_count ?? 0;
              const del  = effectiveDelivered(c);
              const rate = effectiveRate(c);
              const st   = CAMP_STATUS[c.status] ?? CAMP_STATUS["draft"];
              return (
                <tr key={c.id} className="hover:bg-white/[0.02] transition-colors"
                  style={{ borderBottom: i < campaigns.length - 1 ? "1px solid rgba(63,176,108,0.05)" : "none" }}
                >
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
            <p className="text-sm text-[#6b7f6e]">Análise de campanhas e auditoria de eventos do sistema</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl w-fit mb-6"
          style={{ background: "rgba(8,14,10,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}>
          <button onClick={() => setTab("campaigns")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={tab === "campaigns"
              ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }
              : { color: "#6b7f6e", border: "1px solid transparent" }}
          >
            <Send className="w-4 h-4" /> Campanhas
          </button>
          {isAdmin && (
            <button onClick={() => setTab("audit")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={tab === "audit"
                ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }
                : { color: "#6b7f6e", border: "1px solid transparent" }}
            >
              <Shield className="w-4 h-4" /> Auditoria
            </button>
          )}
        </div>

        {tab === "campaigns" && <CampaignReport workspaceId={wid} />}
        {tab === "audit" && isAdmin && <AuditLogViewer workspaceId={wid} />}
      </div>
    </div>
  );
}
