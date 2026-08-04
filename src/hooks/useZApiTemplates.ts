import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { ZApiTemplate } from "@/types/database";

export function useZApiTemplates(workspaceId: string, connectionId?: string | null) {
  const [templates, setTemplates] = useState<ZApiTemplate[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, connectionId]);

  async function load() {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = supabase
      .from("z_api_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (connectionId) {
      q = q.eq("z_api_connection_id", connectionId);
    }

    const { data } = await q;
    setTemplates((data as ZApiTemplate[]) ?? []);
    setLoading(false);
  }

  return { templates, loading, refetch: load };
}
