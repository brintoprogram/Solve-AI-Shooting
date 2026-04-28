import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { ShootingCampaign, CampaignWithTemplate } from "@/types/shooting";

export function useCampaigns(workspaceId: string) {
  const [campaigns, setCampaigns] = useState<CampaignWithTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCampaigns = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const { data } = await supabase
      .from("shooting_campaigns")
      .select("*, meta_templates(*), meta_connections(display_phone, business_name, quality_rating)")
      .eq("workspace_id", workspaceId)
      .neq("dispatch_channel", "n8n_email")
      .order("created_at", { ascending: false });
    setCampaigns((data as CampaignWithTemplate[]) ?? []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  async function createCampaign(
    data: Omit<ShootingCampaign, "id" | "created_at" | "updated_at" | "sent_count" | "delivered_count" | "read_count" | "replied_count" | "failed_count">
  ): Promise<ShootingCampaign> {
    const { data: created, error } = await supabase
      .from("shooting_campaigns")
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    await fetchCampaigns();
    return created;
  }

  async function deleteCampaign(id: string) {
    const { error } = await supabase
      .from("shooting_campaigns")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId); // impede deletar campanhas de outros workspaces
    if (error) throw error;
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  }

  return { campaigns, loading, createCampaign, deleteCampaign, refetch: fetchCampaigns };
}

export function useCampaignDetail(campaignId: string) {
  const [campaign, setCampaign] = useState<CampaignWithTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);
    supabase
      .from("shooting_campaigns")
      .select("*, meta_templates(*), meta_connections(*)")
      .eq("id", campaignId)
      // RLS já garante isolamento, mas filtrar explicitamente impede fetch de campanhas alheias
      // mesmo se o RLS ainda não estiver ativo no banco.
      .single()
      .then(({ data }) => {
        setCampaign(data as CampaignWithTemplate);
        setLoading(false);
      });

    // Realtime updates for campaign counters
    const channel = supabase
      .channel(`campaign:${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "shooting_campaigns",
          filter: `id=eq.${campaignId}`,
        },
        (payload) => {
          setCampaign((prev) =>
            prev ? { ...prev, ...(payload.new as ShootingCampaign) } : null
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  return { campaign, loading };
}
