import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { InboxConversation, InboxMessage } from "@/types/inbox";

// Untyped accessor for inbox tables (not yet in generated Database types)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useInboxConversations(workspaceId: string) {
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await db
      .from("inbox_conversations")
      .select("*, inbox_contacts(*)")
      .eq("workspace_id", workspaceId)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    setConversations(data ?? []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    load();

    // Realtime: reload conversation list on any inbox change
    const channel = db
      .channel(`inbox-convs-${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inbox_conversations" },
        () => { load(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [workspaceId, load]);

  async function markAsRead(conversationId: string) {
    await db
      .from("inbox_conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId);
    // Optimistic update
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c))
    );
  }

  return { conversations, loading, markAsRead };
}

export function useInboxMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    // Initial load
    setLoading(true);
    db
      .from("inbox_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .then(({ data }: { data: InboxMessage[] | null }) => {
        setMessages(data ?? []);
        setLoading(false);
      });

    // Realtime: append new messages as they arrive
    const channel = db
      .channel(`inbox-msgs-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "inbox_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: { new: InboxMessage }) => {
          setMessages((prev) => {
            // Guard against duplicates
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  return { messages, loading };
}
