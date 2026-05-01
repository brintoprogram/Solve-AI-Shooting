import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { ZApiTemplate } from "@/types/database";

export function useZApiTemplates(workspaceId: string) {
  const [templates, setTemplates] = useState<ZApiTemplate[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("z_api_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    setTemplates((data as ZApiTemplate[]) ?? []);
    setLoading(false);
  }

  return { templates, loading, refetch: load };
}
