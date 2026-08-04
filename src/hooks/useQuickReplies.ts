import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

export interface QuickReply {
  id:           string;
  workspace_id: string;
  title:        string;
  body:         string;
  created_by:   string | null;
  created_at:   string;
}


export function useQuickReplies(workspaceId: string) {
  const { profile } = useAuth();
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    supabase
      .from("quick_replies")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("title", { ascending: true })
      .then(({ data }: { data: QuickReply[] | null }) => {
        setReplies(data ?? []);
        setLoading(false);
      });
  }, [workspaceId]);

  async function addReply(title: string, body: string) {
    const { data, error } = await supabase
      .from("quick_replies")
      .insert({ workspace_id: workspaceId, title, body, created_by: profile?.id ?? null })
      .select()
      .single();
    if (error) throw error;
    setReplies((prev) =>
      [...prev, data as QuickReply].sort((a, b) => a.title.localeCompare(b.title))
    );
    return data as QuickReply;
  }

  async function deleteReply(id: string) {
    const { error } = await supabase.from("quick_replies").delete().eq("id", id);
    if (error) throw error;
    setReplies((prev) => prev.filter((r) => r.id !== id));
  }

  return { replies, loading, addReply, deleteReply };
}
