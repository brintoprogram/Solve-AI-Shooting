import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { MetaConnection } from "@/types/shooting";

export function useMetaConnections(workspaceId: string) {
  const [connections, setConnections] = useState<MetaConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    supabase
      .from("meta_connections")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setConnections(data ?? []);
        setLoading(false);
      });
  }, [workspaceId]);

  async function upsertConnection(
    conn: Omit<MetaConnection, "id" | "created_at" | "updated_at">
  ) {
    const { data, error: err } = await supabase
      .from("meta_connections")
      .upsert(conn, { onConflict: "workspace_id,phone_number_id" })
      .select()
      .single();
    if (err) throw err;
    setConnections((prev) => {
      const idx = prev.findIndex((c) => c.id === data.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = data;
        return next;
      }
      return [data, ...prev];
    });
    return data;
  }

  async function deleteConnection(id: string) {
    const { error: err } = await supabase
      .from("meta_connections")
      .delete()
      .eq("id", id);
    if (err) throw err;
    setConnections((prev) => prev.filter((c) => c.id !== id));
  }

  return { connections, loading, error, upsertConnection, deleteConnection };
}
