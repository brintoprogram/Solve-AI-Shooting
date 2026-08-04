import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { safeFilterTerm } from "@/lib/utils";
import type { ShootingMessage, MessageStatus } from "@/types/shooting";

const PAGE_SIZE = 50;

export function useCampaignMessages(
  campaignId: string,
  statusFilter?: MessageStatus
) {
  const [messages, setMessages] = useState<ShootingMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);

    let q = supabase
      .from("shooting_messages")
      .select("*", { count: "exact" })
      .eq("campaign_id", campaignId)
      .order("created_at")
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (statusFilter) q = q.eq("status", statusFilter);
    const s = safeFilterTerm(search);
    if (s) {
      q = q.or(
        `recipient_name.ilike.%${s}%,recipient_phone.ilike.%${s}%`
      );
    }

    q.then(({ data, count }) => {
      setMessages(data ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    });
  }, [campaignId, statusFilter, page, search]);

  // Realtime subscription
  useEffect(() => {
    if (!campaignId) return;

    const channel = supabase
      .channel(`messages:${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "shooting_messages",
          filter: `campaign_id=eq.${campaignId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.new.id
                ? { ...m, ...(payload.new as ShootingMessage) }
                : m
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return {
    messages,
    total,
    page,
    totalPages,
    loading,
    search,
    setSearch,
    setPage,
  };
}
