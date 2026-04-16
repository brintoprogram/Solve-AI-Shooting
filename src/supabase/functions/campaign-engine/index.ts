// Supabase Edge Function — Campaign Engine
// Deploy: supabase functions deploy campaign-engine
//
// Actions: start | pause | resume | cancel

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_BASE = "https://graph.facebook.com/v21.0";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  language: string,
  components: unknown[]
): Promise<{ wamid: string } | { error: string; code: string }> {
  try {
    const res = await fetch(`${META_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          components,
        },
      }),
    });

    const data = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      const err = (data.error as Record<string, unknown>) ?? {};
      return {
        error: String(err.message ?? "API error"),
        code:  String(err.code ?? res.status),
      };
    }

    const messages = data.messages as Array<{ id: string }>;
    return { wamid: messages?.[0]?.id ?? "" };
  } catch (err) {
    return { error: String(err), code: "NETWORK_ERROR" };
  }
}

function buildMessageComponents(
  template: { components: Array<{ type: string; text?: string; buttons?: Array<{ url?: string }> }> },
  mapping: Record<string, unknown>,
  row: Record<string, unknown>
): unknown[] {
  const components: unknown[] = [];

  for (const comp of template.components) {
    if (comp.type === "HEADER" && comp.text?.includes("{{")) {
      const headerVars = (mapping.header_variables ?? {}) as Record<string, string>;
      const params = Object.entries(headerVars).map(([, col]) => ({
        type: "text",
        text: String(row[col] ?? ""),
      }));
      if (params.length) {
        components.push({ type: "header", parameters: params });
      }
    }

    if (comp.type === "BODY" && comp.text?.includes("{{")) {
      const bodyVars = (mapping.body_variables ?? {}) as Record<string, string>;
      const params = Object.entries(bodyVars)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, col]) => ({
          type: "text",
          text: String(row[col] ?? ""),
        }));
      if (params.length) {
        components.push({ type: "body", parameters: params });
      }
    }

    if (comp.type === "BUTTONS" && comp.buttons) {
      const btnVars = (mapping.button_variables ?? {}) as Record<string, Record<string, string>>;
      comp.buttons.forEach((btn, bi) => {
        const btnMap = btnVars[bi] ?? {};
        const params = Object.entries(btnMap).map(([, col]) => ({
          type: "text",
          text: String(row[col] ?? ""),
        }));
        if (params.length) {
          components.push({
            type:  "button",
            sub_type: "url",
            index: bi,
            parameters: params,
          });
        }
      });
    }
  }

  return components;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const body = await req.json() as { action: string; campaign_id: string };
  const { action, campaign_id } = body;

  if (!campaign_id || !action) {
    return new Response(JSON.stringify({ error: "campaign_id and action required" }), { status: 400 });
  }

  // ── Pause / Resume / Cancel ─────────────────────────────────
  if (action === "pause") {
    await supabase
      .from("shooting_campaigns")
      .update({ status: "paused" })
      .eq("id", campaign_id);
    return new Response(JSON.stringify({ ok: true }));
  }

  if (action === "cancel") {
    await supabase
      .from("shooting_campaigns")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", campaign_id);
    return new Response(JSON.stringify({ ok: true }));
  }

  if (action === "resume") {
    await supabase
      .from("shooting_campaigns")
      .update({ status: "sending" })
      .eq("id", campaign_id);
    // Falls through to start logic below by re-invoking is fine,
    // but here we just update the status and the frontend polls.
    return new Response(JSON.stringify({ ok: true }));
  }

  // ── Start ───────────────────────────────────────────────────
  if (action !== "start") {
    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
  }

  // Fetch campaign with connection and template
  const { data: campaign, error: campErr } = await supabase
    .from("shooting_campaigns")
    .select("*, meta_connections(*), meta_templates(*)")
    .eq("id", campaign_id)
    .single();

  if (campErr || !campaign) {
    return new Response(JSON.stringify({ error: "Campaign not found" }), { status: 404 });
  }

  const connection = (campaign as Record<string, unknown>).meta_connections as Record<string, unknown>;
  const template   = (campaign as Record<string, unknown>).meta_templates  as Record<string, unknown>;

  if (!connection || !template) {
    return new Response(JSON.stringify({ error: "Missing connection or template" }), { status: 400 });
  }

  // Mark as sending
  await supabase
    .from("shooting_campaigns")
    .update({ status: "sending", started_at: new Date().toISOString() })
    .eq("id", campaign_id);

  // Fetch pending messages
  const { data: messages } = await supabase
    .from("shooting_messages")
    .select("*")
    .eq("campaign_id", campaign_id)
    .eq("status", "pending")
    .order("created_at");

  const pendingMessages = messages ?? [];
  const sendingSpeed    = Number(campaign.sending_speed ?? 80);
  const delayMs         = Math.ceil(60_000 / sendingSpeed); // ms between sends

  for (const msg of pendingMessages) {
    // Check if paused/cancelled between sends
    const { data: freshCampaign } = await supabase
      .from("shooting_campaigns")
      .select("status")
      .eq("id", campaign_id)
      .single();

    if (freshCampaign?.status === "paused" || freshCampaign?.status === "cancelled") {
      break;
    }

    const row        = (msg.recipient_data ?? {}) as Record<string, unknown>;
    const mapping    = campaign.column_mapping as Record<string, unknown>;
    const components = buildMessageComponents(
      template as Parameters<typeof buildMessageComponents>[0],
      mapping,
      row
    );

    const result = await sendWhatsAppMessage(
      connection.phone_number_id as string,
      connection.access_token as string,
      msg.recipient_phone,
      template.template_name as string,
      template.language as string,
      components
    );

    if ("wamid" in result) {
      await supabase
        .from("shooting_messages")
        .update({ status: "sent", wamid: result.wamid, sent_at: new Date().toISOString() })
        .eq("id", msg.id);

      await supabase.rpc("increment_campaign_counters", {
        p_campaign_id:  campaign_id,
        p_counter_name: "sent_count",
      });
    } else {
      // Handle retry logic
      const retryCount = (msg.retry_count ?? 0) + 1;
      const isRetryable = !["131026", "131047", "131051"].includes(result.code);

      if (isRetryable && retryCount < (msg.max_retries ?? 3)) {
        await supabase
          .from("shooting_messages")
          .update({
            retry_count:   retryCount,
            error_code:    result.code,
            error_message: result.error,
          })
          .eq("id", msg.id);
      } else {
        await supabase
          .from("shooting_messages")
          .update({
            status:        "failed",
            failed_at:     new Date().toISOString(),
            error_code:    result.code,
            error_message: result.error,
            retry_count:   retryCount,
          })
          .eq("id", msg.id);

        await supabase.rpc("increment_campaign_counters", {
          p_campaign_id:  campaign_id,
          p_counter_name: "failed_count",
        });
      }
    }

    // Rate limiting
    await sleep(delayMs);
  }

  // Check if all messages are done
  const { count: pending } = await supabase
    .from("shooting_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("status", "pending");

  const { data: finalCampaign } = await supabase
    .from("shooting_campaigns")
    .select("status")
    .eq("id", campaign_id)
    .single();

  if (finalCampaign?.status === "sending" && (pending ?? 0) === 0) {
    await supabase
      .from("shooting_campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaign_id);
  }

  return new Response(JSON.stringify({ ok: true, processed: pendingMessages.length }));
});
