// Supabase Edge Function — Z-API Unified Webhook Handler
// Deploy: supabase functions deploy z-api-webhook --no-verify-jwt
//
// Configure ALL THREE Z-API webhook URLs to this same endpoint:
//   Ao Enviar:                  https://<ref>.supabase.co/functions/v1/z-api-webhook
//   Ao Receber:                 https://<ref>.supabase.co/functions/v1/z-api-webhook
//   Ao Receber Status:          https://<ref>.supabase.co/functions/v1/z-api-webhook
//
// The handler auto-detects the event type from the `type` field.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Z-API status values → our internal status
const STATUS_MAP: Record<string, string> = {
  SENT:     "sent",
  RECEIVED: "delivered",
  READ:     "read",
  PLAYED:   "read",
};

const COUNTER_MAP: Record<string, string> = {
  RECEIVED: "delivered_count",
  READ:     "read_count",
  PLAYED:   "read_count",
};

const STATUS_ORDER = ["pending", "sending", "sent", "delivered", "read", "replied", "failed"];

function isProgression(current: string, next: string): boolean {
  return STATUS_ORDER.indexOf(next) > STATUS_ORDER.indexOf(current);
}

// ── Entry point ──────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Z-API retries if we don't return 200 immediately — always respond ok
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: true }), { status: 200 }); }

  processEvent(body).catch((err) =>
    console.error("[z-api-webhook] unhandled error:", err?.message)
  );

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// ── Event dispatcher ─────────────────────────────────────────

async function processEvent(body: Record<string, unknown>) {
  const type = body.type as string | undefined;

  // Temporary: log every raw event to z_api_debug_log for diagnostics
  await supabase.from("z_api_debug_log").insert({
    event_type: type ?? "unknown",
    payload:    body,
  }).then(({ error }: { error: { message: string } | null }) => { if (error) console.error("[debug-log] insert error:", error.message); });

  switch (type) {
    case "ReceivedCallback":
      await handleReceived(body);
      break;

    case "MessageStatusCallback":
      await handleStatusUpdate(body);
      break;

    case "DeliveryCallback":
      await handleDelivery(body);
      break;

    case "ConnectedCallback":
    case "DisconnectedCallback":
      await handleConnectionStatus(body);
      break;

    default:
      // Fallback for older payload shapes without explicit `type`
      if (body.instanceId && body.messageId && body.status && !Array.isArray(body.ids)) {
        await handleDelivery(body);
      } else {
        console.log("[z-api-webhook] unknown type:", type, JSON.stringify(body).slice(0, 120));
      }
  }
}

// ── 1. Ao Receber — ReceivedCallback ────────────────────────
// Inbound message from a contact → save to inbox

async function handleReceived(body: Record<string, unknown>) {
  const instanceId  = body.instanceId as string | undefined;
  const messageId   = body.messageId  as string | undefined;
  const phone       = body.phone      as string | undefined;
  const fromMe      = body.fromMe     as boolean | undefined;
  const senderName  = body.senderName as string | undefined;
  const momment     = body.momment    as number | undefined;
  const isGroup     = body.isGroup    as boolean | undefined;

  if (!instanceId || !messageId || !phone) {
    console.warn("[received] missing required fields", JSON.stringify(body).slice(0, 200));
    return;
  }

  // Skip group messages for now
  if (isGroup) {
    console.log(`[received] skipping group message from ${phone}`);
    return;
  }

  // Identify the workspace via instanceId
  const { data: conn, error: connErr } = await supabase
    .from("z_api_connections")
    .select("id, workspace_id")
    .eq("instance_id", instanceId)
    .maybeSingle();

  if (connErr) console.error("[received] connection lookup error:", connErr.message);
  if (!conn) { console.warn("[received] no connection for instanceId:", instanceId); return; }

  const workspaceId = conn.workspace_id as string;
  const connectionId = conn.id as string;
  const ts = momment ? new Date(momment).toISOString() : new Date().toISOString();

  const contactId = await upsertZApiContact(workspaceId, phone, senderName, ts);
  if (!contactId) return;

  const direction  = fromMe ? "outbound" : "inbound";
  const shortBody  = buildShortBody(body);
  const conversationId = await upsertZApiConversation(
    workspaceId, connectionId, contactId, ts, shortBody, direction,
  );
  if (!conversationId) return;

  const fields = extractFields(body);

  const { error: msgErr } = await supabase.from("inbox_messages").upsert(
    {
      workspace_id:     workspaceId,
      conversation_id:  conversationId,
      contact_id:       contactId,
      wamid:            messageId,
      direction,
      message_type:     fields.message_type,
      body:             fields.body             ?? null,
      media_url:        fields.media_url        ?? null,
      media_mime_type:  fields.media_mime_type  ?? null,
      media_filename:   fields.media_filename   ?? null,
      media_size:       fields.media_size       ?? null,
      media_caption:    fields.media_caption    ?? null,
      location_lat:     fields.location_lat     ?? null,
      location_lng:     fields.location_lng     ?? null,
      location_name:    fields.location_name    ?? null,
      location_address: fields.location_address ?? null,
      reaction_emoji:   fields.reaction_emoji   ?? null,
      reaction_wamid:   fields.reaction_wamid   ?? null,
      is_internal:      false,
      // fromMe via phone = already sent, inbound = needs delivery confirmation
      status:           fromMe ? "sent" : "delivered",
      created_at:       ts,
    },
    { onConflict: "wamid", ignoreDuplicates: true }
  );

  if (msgErr) console.error("[received] save message error:", msgErr.message);
  else console.log(`[received] ✓ ${direction} ${fields.message_type} ${fromMe ? "(from phone)" : `de ${phone}`} → conv ${conversationId}`);

  // Fire-and-forget: AI agent reply (inbound only, skip own messages)
  if (!fromMe && !msgErr) {
    EdgeRuntime.waitUntil(
      supabase.functions.invoke("ai-agent-reply", {
        body: { conversation_id: conversationId, message_body: fields.body ?? "" },
      }).catch((e: unknown) => console.error("[received] ai-agent error:", e))
    );
  }
}

// ── 2. Ao Receber Status — MessageStatusCallback ─────────────
// Bulk status update: SENT / RECEIVED / READ / PLAYED

async function handleStatusUpdate(body: Record<string, unknown>) {
  const zapiStatus = body.status as string | undefined;
  const ids        = body.ids    as string[] | undefined;

  if (!zapiStatus || !ids?.length) return;

  const mappedStatus = STATUS_MAP[zapiStatus];
  if (!mappedStatus) {
    console.log(`[status] unknown Z-API status "${zapiStatus}" — ignoring`);
    return;
  }

  console.log(`[status] ${zapiStatus} → ${mappedStatus} for ${ids.length} message(s)`);

  const now = new Date().toISOString();
  const tsField: Record<string, string> = {
    sent:      "sent_at",
    delivered: "delivered_at",
    read:      "read_at",
  };

  for (const wamid of ids) {
    // ── inbox_messages ──
    const { data: inboxMsg } = await supabase
      .from("inbox_messages")
      .select("id, status")
      .eq("wamid", wamid)
      .maybeSingle();

    if (inboxMsg && isProgression(inboxMsg.status, mappedStatus)) {
      const patch: Record<string, unknown> = { status: mappedStatus };
      if (tsField[mappedStatus]) patch[tsField[mappedStatus]] = now;
      await supabase.from("inbox_messages").update(patch).eq("id", inboxMsg.id);
      console.log(`[status] ✓ inbox_message ${wamid} → ${mappedStatus}`);
    }

    // ── shooting_messages ──
    const { data: shootMsg } = await supabase
      .from("shooting_messages")
      .select("id, campaign_id, status")
      .eq("wamid", wamid)
      .maybeSingle();

    if (shootMsg && isProgression(shootMsg.status, mappedStatus)) {
      const patch: Record<string, unknown> = { status: mappedStatus };
      if (tsField[mappedStatus]) patch[tsField[mappedStatus]] = now;
      await supabase.from("shooting_messages").update(patch).eq("id", shootMsg.id);

      const counterName = COUNTER_MAP[zapiStatus];
      if (counterName) {
        await supabase.rpc("increment_campaign_counters", {
          p_campaign_id:  shootMsg.campaign_id,
          p_counter_name: counterName,
        });
      }
      console.log(`[status] ✓ shooting_message ${wamid} → ${mappedStatus}`);
    }
  }
}

// ── 3. Ao Enviar — DeliveryCallback ──────────────────────────
// Fires when message is sent (or fails).
// Z-API returns two IDs: messageId (WhatsApp format, e.g. 3EB0...) and zaapId (internal ULID).
// Outbound messages saved from the inbox use zaapId as wamid (WhatsApp ID isn't always in the
// send-text response). This handler searches by both IDs and upgrades wamid to the WhatsApp
// messageId so that subsequent MessageStatusCallback lookups (which use WhatsApp IDs) succeed.

async function handleDelivery(body: Record<string, unknown>) {
  const waId   = body.messageId as string | undefined;  // WhatsApp format (3EB0...)
  const zaapId = body.zaapId    as string | undefined;  // Z-API internal ULID
  const error  = body.error     as string | undefined;

  if (!waId && !zaapId) return;

  const mappedStatus = error ? "failed" : "sent";
  const now = new Date().toISOString();

  console.log(`[delivery] waId=${waId} zaapId=${zaapId} → ${mappedStatus}${error ? ` (${error})` : ""}`);

  // ── inbox_messages ──
  // Try WhatsApp ID first, then Z-API ULID (outbound inbox messages are stored with zaapId)
  let inboxMsg: { id: string; status: string } | null = null;
  let matchedBy: string | null = null;

  for (const id of ([waId, zaapId].filter(Boolean) as string[])) {
    const { data } = await supabase
      .from("inbox_messages")
      .select("id, status")
      .eq("wamid", id)
      .maybeSingle();
    if (data) { inboxMsg = data; matchedBy = id; break; }
  }

  if (inboxMsg) {
    const patch: Record<string, unknown> = {};
    // Upgrade wamid unconditionally so MessageStatusCallback can find this row later
    if (matchedBy === zaapId && waId && waId !== zaapId) {
      patch.wamid = waId;
      console.log(`[delivery] upgrading wamid ${zaapId} → ${waId}`);
    }
    if (isProgression(inboxMsg.status, mappedStatus)) {
      patch.status = mappedStatus;
      if (mappedStatus === "sent")   patch.sent_at   = now;
      if (mappedStatus === "failed") patch.failed_at = now;
    }
    if (Object.keys(patch).length > 0) {
      await supabase.from("inbox_messages").update(patch).eq("id", inboxMsg.id);
      if ("status" in patch) console.log(`[delivery] ✓ inbox_message → ${mappedStatus}`);
    }
  } else {
    console.log(`[delivery] inbox_message not found (waId=${waId} zaapId=${zaapId})`);
  }

  // ── shooting_messages ──
  let shootMsg: { id: string; campaign_id: string; status: string } | null = null;
  let shootMatchedBy: string | null = null;
  for (const id of ([waId, zaapId].filter(Boolean) as string[])) {
    const { data } = await supabase
      .from("shooting_messages")
      .select("id, campaign_id, status")
      .eq("wamid", id)
      .maybeSingle();
    if (data) { shootMsg = data; shootMatchedBy = id; break; }
  }

  if (shootMsg) {
    const patch: Record<string, unknown> = {};
    // Upgrade wamid unconditionally so MessageStatusCallback can find this row later
    if (shootMatchedBy === zaapId && waId && waId !== zaapId) {
      patch.wamid = waId;
      console.log(`[delivery] upgrading shooting_message wamid ${zaapId} → ${waId}`);
    }
    if (isProgression(shootMsg.status, mappedStatus)) {
      patch.status = mappedStatus;
      if (mappedStatus === "sent")   { patch.sent_at = now; }
      if (mappedStatus === "failed") {
        patch.failed_at     = now;
        patch.error_message = error ?? "Erro desconhecido";
        await supabase.rpc("increment_campaign_counters", {
          p_campaign_id: shootMsg.campaign_id, p_counter_name: "failed_count",
        });
      }
    }
    if (Object.keys(patch).length > 0) {
      await supabase.from("shooting_messages").update(patch).eq("id", shootMsg.id);
      if ("status" in patch) console.log(`[delivery] ✓ shooting_message → ${mappedStatus}`);
    }
  }
}

// ── 4. Connection status ─────────────────────────────────────

async function handleConnectionStatus(body: Record<string, unknown>) {
  const instanceId  = body.instanceId as string | undefined;
  const connected   = body.connected  as boolean | undefined;
  if (!instanceId) return;

  const newStatus = connected === true ? "connected" : "disconnected";
  await supabase
    .from("z_api_connections")
    .update({ status: newStatus })
    .eq("instance_id", instanceId);

  console.log(`[connection] ✓ instance ${instanceId} → ${newStatus}`);
}

// ── Helpers ──────────────────────────────────────────────────

async function upsertZApiContact(
  workspaceId: string,
  phone: string,
  senderName: string | undefined,
  ts: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("inbox_contacts")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("phone", phone)
    .maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = { last_seen_at: ts };
    if (senderName && !existing.name) patch.name = senderName;
    await supabase.from("inbox_contacts").update(patch).eq("id", existing.id);
    return existing.id as string;
  }

  const { data: created, error } = await supabase
    .from("inbox_contacts")
    .insert({ workspace_id: workspaceId, phone, name: senderName ?? null, first_seen_at: ts, last_seen_at: ts })
    .select("id")
    .single();

  if (error) console.error("[upsertContact] insert error:", error.message);
  return (created?.id as string) ?? null;
}

async function upsertZApiConversation(
  workspaceId:  string,
  connectionId: string,
  contactId:    string,
  ts:           string,
  lastBody:     string,
  direction:    string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("inbox_conversations")
    .select("id, unread_count")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("z_api_connection_id", connectionId)
    .maybeSingle();

  if (existing) {
    const currentUnread = existing.unread_count as number;
    await supabase.from("inbox_conversations").update({
      status:                 "open",
      unread_count:           direction === "inbound" ? currentUnread + 1 : currentUnread,
      last_message_at:        ts,
      last_message_body:      lastBody,
      last_message_direction: direction,
      updated_at:             ts,
    }).eq("id", existing.id);
    return existing.id as string;
  }

  const { data: created, error } = await supabase
    .from("inbox_conversations")
    .insert({
      workspace_id:          workspaceId,
      z_api_connection_id:   connectionId,
      meta_connection_id:    null,
      contact_id:            contactId,
      status:                "open",
      unread_count:          direction === "inbound" ? 1 : 0,
      last_message_at:       ts,
      last_message_body:     lastBody,
      last_message_direction: direction,
    })
    .select("id")
    .single();

  if (error) console.error("[upsertConversation] insert error:", error.message);
  return (created?.id as string) ?? null;
}

interface MsgFields {
  message_type:    string;
  body?:           string;
  media_url?:      string;
  media_mime_type?:string;
  media_filename?: string;
  media_size?:     number;
  media_caption?:  string;
  location_lat?:   number;
  location_lng?:   number;
  location_name?:  string;
  location_address?:string;
  reaction_emoji?: string;
  reaction_wamid?: string;
}

function extractFields(body: Record<string, unknown>): MsgFields {
  if (body.text) {
    const t = body.text as Record<string, unknown>;
    return { message_type: "text", body: t.message as string };
  }
  if (body.image) {
    const m = body.image as Record<string, unknown>;
    return { message_type: "image", media_url: m.imageUrl as string, media_mime_type: m.mimeType as string, media_caption: m.caption as string };
  }
  if (body.audio) {
    const m = body.audio as Record<string, unknown>;
    return { message_type: "audio", media_url: m.audioUrl as string, media_mime_type: m.mimeType as string };
  }
  if (body.video) {
    const m = body.video as Record<string, unknown>;
    return { message_type: "video", media_url: m.videoUrl as string, media_mime_type: m.mimeType as string, media_caption: m.caption as string };
  }
  if (body.document) {
    const m = body.document as Record<string, unknown>;
    return { message_type: "document", media_url: m.documentUrl as string, media_mime_type: m.mimeType as string, media_filename: m.fileName as string };
  }
  if (body.location) {
    const l = body.location as Record<string, unknown>;
    return { message_type: "location", location_lat: l.latitude as number, location_lng: l.longitude as number, location_address: l.address as string };
  }
  if (body.reaction) {
    const r = body.reaction as Record<string, unknown>;
    return { message_type: "reaction", reaction_emoji: r.value as string, reaction_wamid: r.referencedMessageId as string };
  }
  if (body.buttonsResponseMessage) {
    const b = body.buttonsResponseMessage as Record<string, unknown>;
    return { message_type: "button_reply", body: (b.message ?? b.buttonId) as string };
  }
  if (body.listResponseMessage) {
    const l = body.listResponseMessage as Record<string, unknown>;
    return { message_type: "button_reply", body: (l.message ?? l.title) as string };
  }
  if (body.contact) {
    const c = body.contact as Record<string, unknown>;
    return { message_type: "unsupported", body: `Contato: ${c.displayName ?? ""}` };
  }
  return { message_type: "unsupported" };
}

function buildShortBody(body: Record<string, unknown>): string {
  if (body.text)    return ((body.text as Record<string, unknown>).message as string) ?? "";
  if (body.image)   return "📷 Imagem";
  if (body.audio)   return "🎵 Áudio";
  if (body.video)   return "🎬 Vídeo";
  if (body.document) {
    const d = body.document as Record<string, unknown>;
    return `📄 ${d.fileName ?? "Documento"}`;
  }
  if (body.location)  return "📍 Localização";
  if (body.reaction) {
    const r = body.reaction as Record<string, unknown>;
    return `Reagiu: ${r.value ?? "👍"}`;
  }
  if (body.buttonsResponseMessage) {
    const b = body.buttonsResponseMessage as Record<string, unknown>;
    return `🔘 ${b.message ?? "Botão"}`;
  }
  if (body.listResponseMessage) {
    const l = body.listResponseMessage as Record<string, unknown>;
    return `📋 ${l.message ?? l.title ?? "Lista"}`;
  }
  if (body.contact) return "👤 Contato";
  return "Mensagem";
}
