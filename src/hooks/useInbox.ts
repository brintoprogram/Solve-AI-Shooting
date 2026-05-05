import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { InboxConversation, InboxMessage } from "@/types/inbox";

// Untyped accessor for inbox tables (not yet in generated Database types)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useInboxConversations(workspaceId?: string) {
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    const { data, error } = await db
      .from("inbox_conversations")
      .select("*, inbox_contacts(*), departments(*)")
      .eq("workspace_id", workspaceId)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) console.error("[useInbox] erro ao carregar conversas:", error.message);
    setConversations(data ?? []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    load();

    const channel = db
      .channel(`inbox-convs-${workspaceId ?? "none"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inbox_conversations" },
        () => { load(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [load]);

  async function markAsRead(conversationId: string) {
    if (!workspaceId) return;
    await db.from("inbox_conversations").update({ unread_count: 0 })
      .eq("id", conversationId).eq("workspace_id", workspaceId);
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c))
    );
  }

  async function pinConversation(id: string, pinned: boolean) {
    if (!workspaceId) return;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, pinned } : c)));
    await db.from("inbox_conversations").update({ pinned })
      .eq("id", id).eq("workspace_id", workspaceId);
  }

  async function archiveConversation(id: string, archived: boolean) {
    if (!workspaceId) return;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, archived } : c)));
    await db.from("inbox_conversations").update({ archived })
      .eq("id", id).eq("workspace_id", workspaceId);
  }

  async function deleteConversation(id: string) {
    if (!workspaceId) return;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    await db.from("inbox_conversations").delete()
      .eq("id", id).eq("workspace_id", workspaceId);
  }

  async function updateTags(id: string, tags: string[]) {
    if (!workspaceId) return;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, tags } : c)));
    await db.from("inbox_conversations").update({ tags })
      .eq("id", id).eq("workspace_id", workspaceId);
  }

  return { conversations, loading, markAsRead, pinConversation, archiveConversation, deleteConversation, updateTags };
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

    // Realtime: append new messages, update existing, remove deleted
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
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "inbox_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: { new: InboxMessage }) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === payload.new.id ? payload.new : m))
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "inbox_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: { old: { id: string } }) => {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  async function deleteMessage(id: string) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    await db.from("inbox_messages").delete().eq("id", id);
  }

  return { messages, loading, deleteMessage };
}
