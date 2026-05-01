// Supabase Edge Function — Z-API Webhook Handler
// Deploy: supabase functions deploy z-api-webhook --no-verify-jwt
//
// Configure this URL in the Z-API panel under "Webhooks → Delivery Callbacks"
// for each instance. One endpoint handles all instances (identified by instanceId).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Z-API status → our shooting_messages status
const STATUS_MAP: Record<string, string> = {
  SENT:     "sent",
  RECEIVED: "delivered",
  READ:     "read",
  PLAYED:   "read", // audio messages treated as read
};

// Which Z-API statuses should increment campaign counters
const COUNTER_MAP: Record<string, string> = {
  RECEIVED: "delivered_count",
  READ:     "read_count",
  PLAYED:   "read_count",
};

// Statuses that must not be downgraded (ordered by progress)
const STATUS_ORDER = ["pending", "sent", "delivered", "read", "replied", "failed"];

function isProgression(current: string, next: string): boolean {
  const ci = STATUS_ORDER.indexOf(current);
  const ni = STATUS_ORDER.indexOf(next);
  return ni > ci;
}

Deno.serve(async (req: Request) => {
  // Z-API requires 200 on every request or it will retry — always return ok
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // Handle async — Z-API doesn't wait for processing
  processEvent(body).catch((err) =>
    console.error("[z-api-webhook] unhandled error:", err?.message)
  );

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function processEvent(body: Record<string, unknown>) {
  const instanceId = body.instanceId as string | undefined;
  const messageId  = body.messageId  as string | undefined;
  const zapiStatus = body.status     as string | undefined;
  const phone      = body.phone      as string | undefined;

  // ── Delivery callback: has instanceId + messageId + status string ──
  if (instanceId && messageId && zapiStatus && typeof zapiStatus === "string") {
    await handleDeliveryCallback(instanceId, messageId, zapiStatus, phone);
    return;
  }

  // ── Connection status callback: {instanceId, connected} ───────────
  if (instanceId && "connected" in body) {
    await handleConnectionStatus(instanceId, body.connected as boolean);
    return;
  }

  console.log("[z-api-webhook] unrecognised payload shape — ignoring", JSON.stringify(body).slice(0, 200));
}

async function handleDeliveryCallback(
  instanceId: string,
  messageId:  string,
  zapiStatus: string,
  _phone:     string | undefined,
) {
  const mappedStatus = STATUS_MAP[zapiStatus];
  if (!mappedStatus) {
    console.log(`[delivery] unknown Z-API status "${zapiStatus}" — ignoring`);
    return;
  }

  console.log(`[delivery] instanceId=${instanceId} messageId=${messageId} status=${zapiStatus} → ${mappedStatus}`);

  // Find the shooting message by zaapId stored in wamid field
  const { data: msg, error: lookupErr } = await supabase
    .from("shooting_messages")
    .select("id, campaign_id, status")
    .eq("wamid", messageId)
    .maybeSingle();

  if (lookupErr) {
    console.error(`[delivery] DB lookup error for messageId=${messageId}:`, lookupErr.message);
    return;
  }

  if (!msg) {
    console.log(`[delivery] messageId=${messageId} not found in shooting_messages — possibly an inbox message`);
    return;
  }

  // Only update if this is a status progression (never downgrade)
  if (!isProgression(msg.status, mappedStatus)) {
    console.log(`[delivery] messageId=${messageId} already at status=${msg.status}, skip ${mappedStatus}`);
    return;
  }

  const now     = new Date().toISOString();
  const updates: Record<string, unknown> = { status: mappedStatus };

  if (mappedStatus === "sent")      updates.sent_at      = now;
  if (mappedStatus === "delivered") updates.delivered_at = now;
  if (mappedStatus === "read")      updates.read_at      = now;

  const { error: updateErr } = await supabase
    .from("shooting_messages")
    .update(updates)
    .eq("id", msg.id);

  if (updateErr) {
    console.error(`[delivery] failed to update message ${msg.id}:`, updateErr.message);
    return;
  }

  console.log(`[delivery] ✓ message ${msg.id} → ${mappedStatus}`);

  // Increment campaign counter if applicable
  const counterName = COUNTER_MAP[zapiStatus];
  if (counterName) {
    const { error: rpcErr } = await supabase.rpc("increment_campaign_counters", {
      p_campaign_id:  msg.campaign_id,
      p_counter_name: counterName,
    });
    if (rpcErr) {
      console.error(`[delivery] counter increment error (${counterName}):`, rpcErr.message);
    } else {
      console.log(`[delivery] ✓ ${counterName} incremented for campaign ${msg.campaign_id}`);
    }
  }
}

async function handleConnectionStatus(instanceId: string, connected: boolean) {
  const newStatus = connected ? "connected" : "disconnected";
  console.log(`[connection] instanceId=${instanceId} → ${newStatus}`);

  const { error } = await supabase
    .from("z_api_connections")
    .update({ status: newStatus })
    .eq("instance_id", instanceId);

  if (error) {
    console.error(`[connection] update error for instance ${instanceId}:`, error.message);
  } else {
    console.log(`[connection] ✓ instance ${instanceId} → ${newStatus}`);
  }
}
