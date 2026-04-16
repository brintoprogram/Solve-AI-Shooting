// Supabase Edge Function — Meta Webhook Handler
// Deploy: supabase functions deploy meta-webhook
//
// Routes:
//   GET  /meta-webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//   POST /meta-webhook  (with workspace_id in URL query param)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspace_id");

  // ── GET: Webhook verification by Meta ───────────────────────
  if (req.method === "GET") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode !== "subscribe" || !token || !workspaceId) {
      return new Response("Bad Request", { status: 400 });
    }

    // Validate token against stored webhook_verify_token
    const { data: conn } = await supabase
      .from("meta_connections")
      .select("webhook_verify_token")
      .eq("workspace_id", workspaceId)
      .eq("webhook_verify_token", token)
      .single();

    if (!conn) {
      return new Response("Forbidden", { status: 403 });
    }

    return new Response(challenge, { status: 200 });
  }

  // ── POST: Incoming webhook events ───────────────────────────
  if (req.method === "POST") {
    if (!workspaceId) {
      return new Response("workspace_id required", { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Resolve the meta_connection_id from workspace
    const { data: conn } = await supabase
      .from("meta_connections")
      .select("id")
      .eq("workspace_id", workspaceId)
      .single();

    const connectionId = conn?.id ?? "unknown";

    // Process each entry
    const entries = (body.entry as unknown[]) ?? [];

    for (const entry of entries) {
      const e = entry as Record<string, unknown>;
      const changes = (e.changes as unknown[]) ?? [];

      for (const change of changes) {
        const c = change as Record<string, unknown>;
        const value = c.value as Record<string, unknown>;

        // Save raw event
        await supabase.from("webhook_events").insert({
          workspace_id:      workspaceId,
          meta_connection_id: connectionId,
          event_type:        c.field as string ?? "unknown",
          payload:           value,
          processed:         false,
        });

        // Process message status updates (idempotent)
        const statuses = (value?.statuses as unknown[]) ?? [];
        for (const s of statuses) {
          const status = s as Record<string, unknown>;
          const wamid  = status.id as string;
          const st     = status.status as string;
          const ts     = new Date(Number(status.timestamp) * 1000).toISOString();

          // Look up the message
          const { data: msg } = await supabase
            .from("shooting_messages")
            .select("id, campaign_id, status")
            .eq("wamid", wamid)
            .single();

          if (!msg) continue;

          // Map Meta status → our status
          const updates: Record<string, unknown> = {};
          if (st === "sent" && msg.status === "pending") {
            updates.status  = "sent";
            updates.sent_at = ts;
            await supabase.rpc("increment_campaign_counters", {
              p_campaign_id:  msg.campaign_id,
              p_counter_name: "sent_count",
            });
          } else if (st === "delivered" && !["delivered","read","replied"].includes(msg.status)) {
            updates.status       = "delivered";
            updates.delivered_at = ts;
            await supabase.rpc("increment_campaign_counters", {
              p_campaign_id:  msg.campaign_id,
              p_counter_name: "delivered_count",
            });
          } else if (st === "read" && !["read","replied"].includes(msg.status)) {
            updates.status  = "read";
            updates.read_at = ts;
            await supabase.rpc("increment_campaign_counters", {
              p_campaign_id:  msg.campaign_id,
              p_counter_name: "read_count",
            });
          } else if (st === "failed") {
            const errors = status.errors as Array<Record<string, unknown>> | undefined;
            const err    = errors?.[0];
            updates.status        = "failed";
            updates.failed_at     = ts;
            updates.error_code    = String(err?.code ?? "");
            updates.error_message = String(err?.title ?? err?.message ?? "Unknown error");
            updates.error_details = err ?? null;
            await supabase.rpc("increment_campaign_counters", {
              p_campaign_id:  msg.campaign_id,
              p_counter_name: "failed_count",
            });
          }

          if (Object.keys(updates).length > 0) {
            await supabase
              .from("shooting_messages")
              .update(updates)
              .eq("id", msg.id);
          }
        }

        // Mark webhook event as processed
        await supabase
          .from("webhook_events")
          .update({ processed: true })
          .eq("payload->>id", value?.id as string ?? "")
          .eq("workspace_id", workspaceId);
      }
    }

    // Meta requires 200 OK quickly
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});
