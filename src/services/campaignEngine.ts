import { supabase } from "@/lib/supabase";

export async function startCampaign(campaignId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("campaign-engine", {
    body: { action: "start", campaign_id: campaignId },
  });
  if (error) throw error;
}

export async function pauseCampaign(campaignId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("campaign-engine", {
    body: { action: "pause", campaign_id: campaignId },
  });
  if (error) throw error;
}

export async function resumeCampaign(campaignId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("campaign-engine", {
    body: { action: "resume", campaign_id: campaignId },
  });
  if (error) throw error;
}

export async function cancelCampaign(campaignId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("campaign-engine", {
    body: { action: "cancel", campaign_id: campaignId },
  });
  if (error) throw error;
}
