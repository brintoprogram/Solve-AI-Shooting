import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { listTemplates } from "@/services/metaApi";
import type { MetaTemplate } from "@/types/shooting";

export function useMetaTemplates(workspaceId: string, connectionId?: string) {
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    let q = supabase
      .from("meta_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("template_name");

    if (connectionId) {
      q = q.eq("meta_connection_id", connectionId);
    }

    q.then(({ data }) => {
      setTemplates(data ?? []);
      setLoading(false);
    });
  }, [workspaceId, connectionId]);

  async function syncTemplates(
    connection: { id: string; waba_id: string; access_token: string }
  ) {
    setSyncing(true);
    try {
      const remote = await listTemplates(connection.waba_id, connection.access_token);

      for (const t of remote) {
        await supabase.from("meta_templates").upsert(
          {
            workspace_id: workspaceId,
            meta_connection_id: connection.id,
            template_name: t.name,
            template_id: t.id,
            language: t.language,
            category: t.category,
            status: t.status,
            components: t.components,
            quality_score: t.quality_score ?? null,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "meta_connection_id,template_id" }
        );
      }

      const { data } = await supabase
        .from("meta_templates")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("meta_connection_id", connection.id)
        .order("template_name");

      setTemplates(data ?? []);
      return remote.length;
    } finally {
      setSyncing(false);
    }
  }

  const approvedTemplates = templates.filter((t) => t.status === "APPROVED");

  return { templates, approvedTemplates, loading, syncing, syncTemplates };
}
