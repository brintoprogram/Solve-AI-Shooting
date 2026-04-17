import { useState, useEffect } from "react";
import { startOfMonth } from "date-fns";
import { supabase } from "@/lib/supabase";

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
  loading: boolean;
}

export function useDashboardMetrics(): DashboardMetrics {
  const [m, setM] = useState<Omit<DashboardMetrics, "loading">>({
    activeCampaigns:    0,
    messagesSent:       0,
    activeContacts:     0,
    deliveryRate:       0,
    campaignsThisMonth: 0,
    messagesThisMonth:  0,
    contactsThisMonth:  0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const monthStart = startOfMonth(new Date()).toISOString();

      const [
        campaignsTotal,
        campaignsMth,
        messagesTotal,
        messagesMth,
        contactsTotal,
        contactsMth,
        campaignAgg,
      ] = await Promise.all([
        // Total de campanhas
        db.from("shooting_campaigns")
          .select("*", { count: "exact", head: true }),

        // Campanhas criadas este mês
        db.from("shooting_campaigns")
          .select("*", { count: "exact", head: true })
          .gte("created_at", monthStart),

        // Total de mensagens efetivamente enviadas (não pending)
        db.from("shooting_messages")
          .select("*", { count: "exact", head: true })
          .in("status", ["sent", "delivered", "read", "replied", "failed"]),

        // Mensagens enviadas este mês
        db.from("shooting_messages")
          .select("*", { count: "exact", head: true })
          .in("status", ["sent", "delivered", "read", "replied", "failed"])
          .gte("created_at", monthStart),

        // Total de contatos no Inbox
        db.from("inbox_contacts")
          .select("*", { count: "exact", head: true }),

        // Contatos novos este mês
        db.from("inbox_contacts")
          .select("*", { count: "exact", head: true })
          .gte("first_seen_at", monthStart),

        // Contadores acumulados das campanhas para calcular taxa de entrega
        // (mais performático que contar shooting_messages linha a linha)
        db.from("shooting_campaigns")
          .select("sent_count, delivered_count, read_count, replied_count"),
      ]);

      // Taxa de entrega = (entregues + lidas + respondidas) / enviadas
      let totalSent      = 0;
      let totalDelivered = 0;
      for (const c of (campaignAgg.data ?? [])) {
        totalSent      += c.sent_count      ?? 0;
        totalDelivered += (c.delivered_count ?? 0) + (c.read_count ?? 0) + (c.replied_count ?? 0);
      }
      const deliveryRate =
        totalSent > 0 ? Math.round((totalDelivered / totalSent) * 1000) / 10 : 0;

      if (!cancelled) {
        setM({
          activeCampaigns:    campaignsTotal.count  ?? 0,
          messagesSent:       messagesTotal.count   ?? 0,
          activeContacts:     contactsTotal.count   ?? 0,
          deliveryRate,
          campaignsThisMonth: campaignsMth.count    ?? 0,
          messagesThisMonth:  messagesMth.count     ?? 0,
          contactsThisMonth:  contactsMth.count     ?? 0,
        });
        setLoading(false);
      }
    }

    load().catch(console.error);
    return () => { cancelled = true; };
  }, []);

  return { ...m, loading };
}

/** Formata número grande → "12.4k", "1.2M", etc. */
export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1).replace(".", ",")}k`;
  return n.toLocaleString("pt-BR");
}
