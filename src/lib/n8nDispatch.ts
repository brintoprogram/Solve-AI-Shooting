import { supabase } from "@/lib/supabase";

export async function dispatchToN8N(
  campaignId: string,
  workspaceId: string,
  campaignName: string,
  messages: { id: string; recipient_name: string | null; recipient_phone: string; recipient_data: unknown }[],
) {
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/n8n-dispatch`,
    {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session?.access_token ?? ""}`,
        "apikey":        import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        campaign_id:   campaignId,
        workspace_id:  workspaceId,
        campaign_name: campaignName,
        recipients: messages.map((m) => ({
          message_id:     m.id,
          name:           m.recipient_name,
          phone:          m.recipient_phone,
          recipient_data: m.recipient_data,
        })),
      }),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? "Falha ao disparar via N8N");
  }
}
