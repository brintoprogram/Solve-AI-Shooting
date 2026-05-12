import { useState, useEffect } from "react";
import { startOfMonth, subDays, format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type DashboardDateRange = "7d" | "30d" | "90d" | "all";

export interface DashboardMetrics {
  activeCampaigns:    number;
  messagesSent:       number;
  activeContacts:     number;
  deliveryRate:       number; // 0–100
  // period deltas — "este mês" when dateRange="all", "neste período" when filtered
  campaignsThisMonth: number;
  messagesThisMonth:  number;
  contactsThisMonth:  number;
  // extra cards
  timeSavedMinutes:   number;
  valueDispatched:    number;
  // chart
  dailyMessages:      { date: string; enviadas: number; lidas: number }[];
  // context for UI / exports
  periodLabel:  string; // "este mês" | "neste período"
  chartDays:    number;
  loading: boolean;
}

export function useDashboardMetrics(dateRange: DashboardDateRange = "all"): DashboardMetrics {
  const { workspaceId } = useAuth();
  const [m, setM] = useState<Omit<DashboardMetrics, "loading">>({
    activeCampaigns:    0,
    messagesSent:       0,
    activeContacts:     0,
    deliveryRate:       0,
    campaignsThisMonth: 0,
    messagesThisMonth:  0,
    contactsThisMonth:  0,
    timeSavedMinutes:   0,
    valueDispatched:    0,
    dailyMessages:      [],
    periodLabel:        "este mês",
    chartDays:          30,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setLoading(true);

    async function load() {
      const isFiltered  = dateRange !== "all";
      const days        = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
      // Chart always shows the same window as the period (90d for "all")
      const chartDays   = isFiltered ? days : 90;
      const periodStart = isFiltered ? subDays(new Date(), days).toISOString() : null;
      const monthStart  = startOfMonth(new Date()).toISOString();
      // Delta: when "all" → this-month count; when filtered → same window as main
      const deltaStart  = isFiltered ? periodStart! : monthStart;
      const chartStart  = subDays(new Date(), chartDays - 1).toISOString();
      const periodLabel = isFiltered ? "neste período" : "este mês";

      const SENT_STATUSES = ["sent", "delivered", "read", "replied"];

      const [
        campaignsTotal,
        campaignsDelta,
        messagesTotal,
        messagesDelta,
        contactsTotal,
        contactsDelta,
        campaignAgg,
        valueMsgs,
        dailyMsgs,
      ] = await Promise.all([
        // ── Total de campanhas (filtrado pelo período se ativo) ───────
        (() => {
          let q = db.from("shooting_campaigns")
            .select("*", { count: "exact", head: true })
            .eq("workspace_id", workspaceId);
          if (periodStart) q = q.gte("created_at", periodStart);
          return q;
        })(),

        // ── Delta de campanhas ────────────────────────────────────────
        db.from("shooting_campaigns")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .gte("created_at", deltaStart),

        // ── Total de mensagens enviadas ───────────────────────────────
        (() => {
          let q = db.from("shooting_messages")
            .select("*", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .in("status", [...SENT_STATUSES, "failed"]);
          if (periodStart) q = q.gte("created_at", periodStart);
          return q;
        })(),

        // ── Delta de mensagens ────────────────────────────────────────
        db.from("shooting_messages")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .in("status", [...SENT_STATUSES, "failed"])
          .gte("created_at", deltaStart),

        // ── Total de contatos no Inbox ────────────────────────────────
        (() => {
          let q = db.from("inbox_contacts")
            .select("*", { count: "exact", head: true })
            .eq("workspace_id", workspaceId);
          if (periodStart) q = q.gte("first_seen_at", periodStart);
          return q;
        })(),

        // ── Delta de contatos ─────────────────────────────────────────
        db.from("inbox_contacts")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .gte("first_seen_at", deltaStart),

        // ── Agg de campanhas (entrega + tempo de automação) ───────────
        (() => {
          let q = db.from("shooting_campaigns")
            .select("sent_count, delivered_count, dispatch_channel, total_recipients, started_at, completed_at")
            .eq("workspace_id", workspaceId)
            .not("started_at", "is", null);
          if (periodStart) q = q.gte("created_at", periodStart);
          return q;
        })(),

        // ── Valor disparado ───────────────────────────────────────────
        (() => {
          let q = db.from("shooting_messages")
            .select("recipient_data")
            .eq("workspace_id", workspaceId)
            .in("status", SENT_STATUSES);
          if (periodStart) q = q.gte("created_at", periodStart);
          return q;
        })(),

        // ── Dados do gráfico de área ──────────────────────────────────
        db.from("shooting_messages")
          .select("sent_at, read_at")
          .eq("workspace_id", workspaceId)
          .in("status", SENT_STATUSES)
          .gte("sent_at", chartStart),
      ]);

      // ── Taxa de entrega ───────────────────────────────────────────
      let totalSent         = 0;
      let totalDelivered    = 0;
      let totalRecipients   = 0;
      for (const c of (campaignAgg.data ?? [])) {
        const sent      = c.sent_count ?? 0;
        const delivered = c.dispatch_channel === "n8n_email" ? sent : (c.delivered_count ?? 0);
        totalSent       += sent;
        totalDelivered  += delivered;
        totalRecipients += c.total_recipients ?? 0;
      }
      const denominator  = totalRecipients > 0 ? totalRecipients : totalSent;
      const deliveryRate = denominator > 0
        ? Math.min(100, Math.round((totalDelivered / denominator) * 1000) / 10)
        : 0;

      // ── Economia de tempo ─────────────────────────────────────────
      // Human: 5 min/message manually. Automation: 0.5 min/message (setup + click).
      // We do NOT use (completed_at - started_at) because Z-API campaigns have intentional
      // delays between messages (anti-ban), which is idle time, not actual work.
      const HUMAN_MIN_PER_MSG      = 5;
      const AUTOMATION_MIN_PER_MSG = 0.5;
      const msgCount         = messagesTotal.count ?? 0;
      const timeSavedMinutes = Math.round(msgCount * (HUMAN_MIN_PER_MSG - AUTOMATION_MIN_PER_MSG));

      // ── Valor disparado ───────────────────────────────────────────
      let valueDispatched = 0;
      for (const msg of (valueMsgs.data ?? [])) {
        const rd = msg.recipient_data as Record<string, unknown> | null;
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
        let n: number;
        if (typeof raw === "number") {
          n = raw;
        } else {
          const s = String(raw).replace(/[^\d,]/g, "");
          n = parseFloat(s.replace(",", "."));
        }
        if (!isNaN(n) && n > 0) valueDispatched += n;
      }

      // ── Gráfico de área ───────────────────────────────────────────
      const dayMap: Record<string, { enviadas: number; lidas: number }> = {};
      for (let i = chartDays - 1; i >= 0; i--) {
        dayMap[format(subDays(new Date(), i), "dd/MM")] = { enviadas: 0, lidas: 0 };
      }
      for (const msg of (dailyMsgs.data ?? [])) {
        if (msg.sent_at) {
          const d = format(new Date(msg.sent_at), "dd/MM");
          if (dayMap[d]) dayMap[d].enviadas += 1;
        }
        if (msg.read_at) {
          const d = format(new Date(msg.read_at), "dd/MM");
          if (dayMap[d]) dayMap[d].lidas += 1;
        }
      }
      const dailyMessages = Object.entries(dayMap).map(([date, v]) => ({ date, ...v }));

      if (!cancelled) {
        setM({
          activeCampaigns:    campaignsTotal.count ?? 0,
          messagesSent:       messagesTotal.count  ?? 0,
          activeContacts:     contactsTotal.count  ?? 0,
          deliveryRate,
          campaignsThisMonth: campaignsDelta.count ?? 0,
          messagesThisMonth:  messagesDelta.count  ?? 0,
          contactsThisMonth:  contactsDelta.count  ?? 0,
          timeSavedMinutes,
          valueDispatched,
          dailyMessages,
          periodLabel,
          chartDays,
        });
        setLoading(false);
      }
    }

    load().catch(console.error);
    return () => { cancelled = true; };
  }, [workspaceId, dateRange]);

  return { ...m, loading };
}

/** Formata número grande → "12.4k", "1.2M", etc. */
export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1).replace(".", ",")}k`;
  return n.toLocaleString("pt-BR");
}

/** Formata minutos → "2h 15min", "45min", "3 dias" */
export function fmtTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h < 24) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  const d = Math.floor(h / 8); // jornada de 8h
  return `${d} dia${d !== 1 ? "s" : ""}`;
}

/** Formata valor monetário → "R$ 127.540,00" */
export function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

/** Label legível para o período */
export function periodRangeLabel(dateRange: DashboardDateRange): string {
  if (dateRange === "7d")  return "Últimos 7 dias";
  if (dateRange === "30d") return "Últimos 30 dias";
  if (dateRange === "90d") return "Últimos 90 dias";
  return "Todo o período";
}
