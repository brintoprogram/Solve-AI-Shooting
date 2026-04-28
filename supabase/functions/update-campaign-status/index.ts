import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

interface StatusUpdate {
  message_id:     string;
  status:         string;
  sent_at?:       string | null;
  delivered_at?:  string | null;
  read_at?:       string | null;
  error_code?:    string | null;
  error_message?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: { campaign_id: string; updates: StatusUpdate[] };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { campaign_id, updates } = body;
  if (!campaign_id || !Array.isArray(updates) || updates.length === 0) {
    return new Response("Missing required fields: campaign_id, updates[]", { status: 400 });
  }

  console.log(`[update-campaign-status] campaign=${campaign_id} updates=${updates.length}`);

  // ── Update each shooting_message ─────────────────────────
  const results = await Promise.all(updates.map(async (upd) => {
    const patch: Record<string, unknown> = { status: upd.status };

    if (upd.sent_at       !== undefined) patch.sent_at       = upd.sent_at;
    if (upd.delivered_at  !== undefined) patch.delivered_at  = upd.delivered_at;
    if (upd.read_at       !== undefined) patch.read_at       = upd.read_at;
    if (upd.error_code    !== undefined) patch.error_code    = upd.error_code;
    if (upd.error_message !== undefined) patch.error_message = upd.error_message;

    // Auto-set timestamp when not provided
    const now = new Date().toISOString();
    if (upd.status === "sent"       && !patch.sent_at)      patch.sent_at      = now;
    if (upd.status === "delivered"  && !patch.delivered_at) patch.delivered_at = now;
    if (upd.status === "read"       && !patch.read_at)      patch.read_at      = now;

    const { error } = await supabase
      .from("shooting_messages")
      .update(patch)
      .eq("id", upd.message_id)
      .eq("campaign_id", campaign_id);

    if (error) console.error(`[update-campaign-status] message ${upd.message_id} error:`, error.message);
    return { message_id: upd.message_id, ok: !error, error: error?.message ?? null };
  }));

  // ── Recompute campaign counters ────────────────────────────
  const { data: allMsgs } = await supabase
    .from("shooting_messages")
    .select("status")
    .eq("campaign_id", campaign_id);

  if (allMsgs) {
    let sent = 0, delivered = 0, read = 0, replied = 0, failed = 0;
    for (const m of allMsgs) {
      if (["sent", "delivered", "read", "replied"].includes(m.status)) sent++;
      if (["delivered", "read", "replied"].includes(m.status))         delivered++;
      if (["read", "replied"].includes(m.status))                      read++;
      if (m.status === "replied")                                       replied++;
      if (["failed", "undeliverable"].includes(m.status))              failed++;
    }

    const FINAL = new Set(["sent", "delivered", "read", "replied", "failed", "undeliverable"]);
    const allDone = allMsgs.every((m) => FINAL.has(m.status));

    await supabase
      .from("shooting_campaigns")
      .update({
        sent_count:      sent,
        delivered_count: delivered,
        read_count:      read,
        replied_count:   replied,
        failed_count:    failed,
        ...(allDone ? { status: "completed", completed_at: new Date().toISOString() } : {}),
      })
      .eq("id", campaign_id);

    console.log(`[update-campaign-status] counters updated sent=${sent} delivered=${delivered} read=${read} failed=${failed}${allDone ? " COMPLETED" : ""}`);
  }

  return new Response(
    JSON.stringify({ ok: true, processed: updates.length, results }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
