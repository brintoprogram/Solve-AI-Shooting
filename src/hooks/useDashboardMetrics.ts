import { useState, useEffect } from "react";
import { startOfMonth, subDays, format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface DashboardMetrics {
  activeCampaigns:    number;
  messagesSent:       number;
  activeContacts:     number;
  deliveryRate:       number; // 0–100
  // month deltas
  campaignsThisMonth: number;
  messagesThisMonth:  number;
  contactsThisMonth:  number;
  // new cards
  timeSavedMinutes:   number;
  valueDispatched:    number;
  // 30-day area chart
  dailyMessages:      { date: string; enviadas: number; lidas: number }[];
  loading: boolean;
}

export function useDashboardMetrics(): DashboardMetrics {
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
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    async function load() {
      const monthStart = startOfMonth(new Date()).toISOString();

      const SENT_STATUSES  = ["sent", "delivered", "read", "replied"];
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

      const [
        campaignsTotal,
        campaignsMth,
        messagesTotal,
        messagesMth,
        contactsTotal,
        contactsMth,
        campaignAgg,
        valueMsgs,
        dailyMsgs,
      ] = await Promise.all([
        // Total de campanhas
        db.from("shooting_campaigns")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId),

        // Campanhas criadas este mês
        db.from("shooting_campaigns")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .gte("created_at", monthStart),

        // Total de mensagens efetivamente enviadas (não pending)
        db.from("shooting_messages")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .in("status", [...SENT_STATUSES, "failed"]),

        // Mensagens enviadas este mês
        db.from("shooting_messages")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .in("status", [...SENT_STATUSES, "failed"])
          .gte("created_at", monthStart),

        // Total de contatos no Inbox
        db.from("inbox_contacts")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId),

        // Contatos novos este mês
        db.from("inbox_contacts")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .gte("first_seen_at", monthStart),

        // Contadores acumulados das campanhas (taxa de entrega + tempo de automação)
        db.from("shooting_campaigns")
          .select("sent_count, delivered_count, read_count, replied_count, started_at, completed_at")
          .eq("workspace_id", workspaceId)
          .not("started_at", "is", null),

        // Valor disparado — campo inv_valor no recipient_data (snapshot do contato)
        db.from("shooting_messages")
          .select("recipient_data")
          .eq("workspace_id", workspaceId)
          .in("status", SENT_STATUSES),

        // Últimos 30 dias — só sent_at e read_at para o gráfico de área
        db.from("shooting_messages")
          .select("sent_at, read_at")
          .eq("workspace_id", workspaceId)
          .in("status", SENT_STATUSES)
          .gte("sent_at", thirtyDaysAgo),
      ]);

      // Taxa de entrega + tempo de automação
      // delivered_count já inclui mensagens que depois foram lidas ou respondidas
      // (o WhatsApp acumula por estado máximo), então somar read+replied dobra a contagem.
      // Usamos só delivered_count como proxy de "entregue ou melhor" e capamos em 100%.
      let totalSent           = 0;
      let totalDelivered      = 0;
      let automationMinutes   = 0;
      for (const c of (campaignAgg.data ?? [])) {
        totalSent      += c.sent_count ?? 0;
        totalDelivered += c.delivered_count ?? 0;
        if (c.started_at && c.completed_at) {
          automationMinutes +=
            (new Date(c.completed_at).getTime() - new Date(c.started_at).getTime()) / 60_000;
        }
      }
      const deliveryRate =
        totalSent > 0 ? Math.min(100, Math.round((totalDelivered / totalSent) * 1000) / 10) : 0;

      // Economia de tempo: assume 2 min/mensagem para envio humano (abrir WA, colar número, digitar, enviar)
      const HUMAN_MIN_PER_MSG = 2;
      const humanMinutes      = (messagesTotal.count ?? 0) * HUMAN_MIN_PER_MSG;
      const timeSavedMinutes  = Math.max(0, humanMinutes - automationMinutes);

      // Valor disparado: for new campaigns prefer canonical valor_total_pendente;
      // for legacy campaigns do a heuristic scan (excluding codigo_barras).
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
          // pt-BR currency: "R$ 12.312,00" — dot is thousands separator, comma is decimal
          const s = String(raw).replace(/[^\d,]/g, ""); // keep digits + comma only
          n = parseFloat(s.replace(",", "."));
        }
        if (!isNaN(n) && n > 0) valueDispatched += n;
      }

      // Últimos 30 dias: gerar array com todos os dias e contar por dia
      const dayMap: Record<string, { enviadas: number; lidas: number }> = {};
      for (let i = 29; i >= 0; i--) {
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
          activeCampaigns:    campaignsTotal.count  ?? 0,
          messagesSent:       messagesTotal.count   ?? 0,
          activeContacts:     contactsTotal.count   ?? 0,
          deliveryRate,
          campaignsThisMonth: campaignsMth.count    ?? 0,
          messagesThisMonth:  messagesMth.count     ?? 0,
          contactsThisMonth:  contactsMth.count     ?? 0,
          timeSavedMinutes,
          valueDispatched,
          dailyMessages,
        });
        setLoading(false);
      }
    }

    load().catch(console.error);
    return () => { cancelled = true; };
  }, [workspaceId]);

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
  if (minutes < 60)  return `${Math.round(minutes)}min`;
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
