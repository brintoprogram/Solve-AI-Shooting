export const N8N_WEBHOOK = "https://n8n.solveai.consulting/webhook/f03bd652-7164-483f-80cf-b871ff671ae6";

export async function dispatchToN8N(
  campaignId: string,
  workspaceId: string,
  campaignName: string,
  messages: { id: string; recipient_name: string | null; recipient_phone: string; recipient_data: unknown }[],
) {
  const callbackUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-campaign-status`;
  await fetch(N8N_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campaign_id:     campaignId,
      workspace_id:    workspaceId,
      campaign_name:   campaignName,
      dispatched_at:   new Date().toISOString(),
      callback_url:    callbackUrl,
      callback_apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      recipients: messages.map((m) => ({
        message_id:     m.id,
        name:           m.recipient_name,
        phone:          m.recipient_phone,
        recipient_data: m.recipient_data,
      })),
    }),
  });
}
