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
import { checkWebhookSecret } from "../_shared/auth.ts";
import { sanitize } from "../_shared/logger.ts";

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

// ── Auth ─────────────────────────────────────────────────────
// A Z-API não assina os webhooks (não existe HMAC), então usamos um segredo na
// query string da URL configurada no painel da Z-API:
//   https://<ref>.supabase.co/functions/v1/z-api-webhook?s=<segredo>
//
// Sem isso qualquer pessoa na internet pode forjar mensagens de entrada, que
// são gravadas em inbox_messages e disparam o ai-agent-reply — ou seja, fazem
// a IA responder clientes reais.
//
// Rollout seguro: enquanto Z_API_WEBHOOK_SECRET não estiver configurado a
// função só registra um aviso e continua aceitando, para não derrubar o canal
// em produção antes da URL ser atualizada no painel da Z-API. Configure com:
//   supabase secrets set Z_API_WEBHOOK_SECRET=<uuid>
const Z_API_WEBHOOK_SECRET = Deno.env.get("Z_API_WEBHOOK_SECRET") ?? "";

// ── Entry point ──────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Z-API retries if we don't return 200 immediately — always respond ok
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // null = segredo ainda não configurado (rollout em andamento)
  const secretOk = checkWebhookSecret(req, Z_API_WEBHOOK_SECRET);
  if (secretOk === false) {
    console.warn("[z-api-webhook] segredo inválido — requisição rejeitada");
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  if (secretOk === null) {
    console.warn("[z-api-webhook] ⚠ Z_API_WEBHOOK_SECRET não configurado — endpoint aceita qualquer origem");
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

  // Diagnóstico de payload cru. Estava marcado como "temporário" mas rodou por
  // ~3 meses gravando telefone e corpo de mensagem em texto plano — dado pessoal
  // sob LGPD, sem retenção. Agora: desligado por padrão, e mesmo quando ligado
  // o payload passa por sanitize() antes de persistir.
  // Para ligar num incidente: supabase secrets set Z_API_DEBUG_LOG=true
  if (Deno.env.get("Z_API_DEBUG_LOG") === "true") {
    await supabase.from("z_api_debug_log").insert({
      event_type: type ?? "unknown",
      payload:    sanitize(body) as Record<string, unknown>,
    }).then(({ error }: { error: { message: string } | null }) => { if (error) console.error("[debug-log] insert error:", error.message); });
  }

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

  // When contact replies, mark corresponding campaign messages as "replied"
  if (!fromMe && !msgErr) {
    await markCampaignMessagesReplied(workspaceId, phone, ts);
  }

  // Fire-and-forget: AI agent reply (inbound only, skip own messages)
  if (!fromMe && !msgErr) {
    // invoke() não rejeita em erro HTTP — o 401/500 chega em { error }. Sem
    // checar isso, uma falha de auth faria a IA parar de responder clientes
    // silenciosamente.
    EdgeRuntime.waitUntil(
      supabase.functions.invoke("ai-agent-reply", {
        body: { conversation_id: conversationId, message_body: fields.body ?? "" },
      })
        .then(({ error }) => {
          if (error) console.error(JSON.stringify({ level: "error", event: "ai_agent_dispatch_failed",
            fn: "z-api-webhook", conversation_id: conversationId, err: error.message }));
        })
        .catch((e: unknown) => console.error("[received] ai-agent network error:", e))
    );
  }
}

async function markCampaignMessagesReplied(workspaceId: string, phone: string, now: string): Promise<void> {
  const { data: msgs } = await supabase
    .from("shooting_messages")
    .select("id, campaign_id, status, read_at")
    .eq("workspace_id", workspaceId)
    .eq("recipient_phone", phone)
    .in("status", ["sent", "delivered", "read"]);

  if (!msgs || msgs.length === 0) return;

  for (const msg of msgs as { id: string; campaign_id: string; status: string; read_at: string | null }[]) {
    const wasNotRead = msg.read_at === null;
    await supabase.from("shooting_messages")
      .update({
        status: "replied",
        replied_at: now,
        ...(wasNotRead ? { read_at: now } : {}),
      })
      .eq("id", msg.id);
    await supabase.rpc("increment_campaign_counters", {
      p_campaign_id:  msg.campaign_id,
      p_counter_name: "replied_count",
    });
    if (wasNotRead) {
      await supabase.rpc("increment_campaign_counters", {
        p_campaign_id:  msg.campaign_id,
        p_counter_name: "read_count",
      });
    }
    console.log(`[received] ✓ shooting_message ${msg.id} → replied${wasNotRead ? " + read" : ""}`);
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
  if (body.sticker) {
    const m = body.sticker as Record<string, unknown>;
    return { message_type: "sticker", media_url: m.stickerUrl as string, media_mime_type: m.mimeType as string };
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
  if (body.sticker) return "🖼️ Sticker";
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
