// Supabase Edge Function — Meta Webhook Handler
// Deploy: supabase functions deploy meta-webhook --no-verify-jwt
//
// Secrets:
//   WEBHOOK_VERIFY_TOKEN  – token cadastrado na Meta

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";

const META_API = "https://graph.facebook.com/v25.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ENV_VERIFY_TOKEN = Deno.env.get("WEBHOOK_VERIFY_TOKEN") ?? "";

// ── Audit logging ────────────────────────────────────────────────
// Fire-and-forget — never blocks the 20s webhook response window.

function writeAuditLog(
  workspaceId: string,
  eventType:   string,
  entityId:    string | null | undefined,
  entityType:  string | null | undefined,
  status:      "success" | "error" | "warning" | "info",
  error?:      string | null,
  metadata?:   Record<string, unknown>,
): void {
  supabase.from("audit_logs").insert({
    workspace_id: workspaceId,
    event_type:   eventType,
    entity_id:    entityId   ?? null,
    entity_type:  entityType ?? null,
    status,
    error:        error    ?? null,
    metadata:     metadata ?? null,
  }).then(({ error: dbErr }) => {
    if (dbErr) console.error("[audit] write error:", dbErr.message);
  });
}

// ── Signature validation ─────────────────────────────────────────

async function verifySignature(secret: string, rawBody: string, sigHeader: string): Promise<boolean> {
  if (!sigHeader.startsWith("sha256=")) return false;
  const expectedHex = sigHeader.slice(7);
  const encoder     = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig         = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computedHex === expectedHex;
}

// ── Media helpers ────────────────────────────────────────────────

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "audio/ogg":  ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/aac": ".aac",
    "video/mp4":  ".mp4", "video/3gpp": ".3gp",
    "application/pdf": ".pdf",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain": ".txt",
  };
  return map[mime] ?? ".bin";
}

async function fetchAndStoreMedia(
  mediaId:     string,
  accessToken: string,
  workspaceId: string,
  messageId:   string,
  mimeType:    string | undefined,
): Promise<void> {
  try {
    // 1. Get the temporary CDN URL from Meta
    const infoRes = await fetch(`${META_API}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!infoRes.ok) {
      console.error(`[media] info error ${mediaId}: ${infoRes.status}`);
      return;
    }
    const info = await infoRes.json() as { url: string; mime_type?: string; file_size?: number };

    // 2. Download binary from CDN (Meta requires the same token)
    const dlRes = await fetch(info.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!dlRes.ok) {
      console.error(`[media] download error ${mediaId}: ${dlRes.status}`);
      return;
    }
    const buffer = await dlRes.arrayBuffer();
    const mime   = mimeType ?? info.mime_type ?? "application/octet-stream";
    const ext    = mimeToExt(mime);
    const path   = `${workspaceId}/${messageId}${ext}`;

    // 3. Upload to Supabase Storage bucket "inbox-media"
    const { error: upErr } = await supabase.storage
      .from("inbox-media")
      .upload(path, buffer, { contentType: mime, upsert: true });
    if (upErr) {
      console.error(`[media] upload error: ${upErr.message}`);
      return;
    }

    // 4. Get public URL and update the message row
    const { data: { publicUrl } } = supabase.storage.from("inbox-media").getPublicUrl(path);
    await supabase.from("inbox_messages")
      .update({ media_url: publicUrl, media_size: info.file_size ?? buffer.byteLength })
      .eq("id", messageId);

    console.log(`[media] ✓ ${mediaId} → ${path}`);
  } catch (err) {
    console.error(`[media] error for ${mediaId}:`, err instanceof Error ? err.message : String(err));
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ── GET: verificação pela Meta ─────────────────────────────────
  if (req.method === "GET") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode !== "subscribe" || !token || !challenge) {
      return new Response("Bad Request", { status: 400 });
    }

    if (ENV_VERIFY_TOKEN && token === ENV_VERIFY_TOKEN) {
      console.log("[webhook] verificado via env ✓");
      return new Response(challenge, { status: 200 });
    }

    const { data: conn } = await supabase
      .from("meta_connections")
      .select("id")
      .eq("webhook_verify_token", token)
      .maybeSingle();

    if (conn) {
      console.log("[webhook] verificado via DB ✓");
      return new Response(challenge, { status: 200 });
    }

    console.warn("[webhook] token inválido:", token);
    return new Response("Forbidden", { status: 403 });
  }

  // ── POST: eventos recebidos ────────────────────────────────────
  if (req.method === "POST") {
    // Lê o body bruto antes de qualquer parsing — necessário para HMAC
    const rawBody = await req.text();

    // Valida X-Hub-Signature-256 se META_APP_SECRET estiver configurado.
    const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
    if (appSecret) {
      const sigHeader = req.headers.get("X-Hub-Signature-256") ?? "";
      const valid     = await verifySignature(appSecret, rawBody, sigHeader);
      if (!valid) {
        console.warn("[webhook] assinatura X-Hub-Signature-256 inválida — rejeitando");
        return new Response("Forbidden", { status: 403 });
      }
      console.log("[webhook] assinatura verificada ✓");
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Meta exige resposta em até 20s — processar e responder
    await processWebhook(body).catch((err) =>
      console.error("[webhook] erro crítico:", err?.message)
    );
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});

// ── Processamento ────────────────────────────────────────────────

async function processWebhook(body: Record<string, unknown>) {
  const entries = (body.entry as unknown[]) ?? [];

  for (const entry of entries) {
    // waba_id is the entry id — needed for WABA-level events
    const wabaId  = (entry as Record<string, unknown>).id as string | undefined;
    const changes = ((entry as Record<string, unknown>).changes as unknown[]) ?? [];

    for (const change of changes) {
      const c     = change as Record<string, unknown>;
      const value = c.value as Record<string, unknown>;
      const field = (c.field as string) ?? "unknown";

      // ── Identifica a conexão pelo phone_number_id do payload ───
      const metadata   = value?.metadata as Record<string, unknown> | undefined;
      const phoneNumId = metadata?.phone_number_id as string | undefined;

      let connectionId: string | null = null;
      let workspaceId:  string | null = null;
      let accessToken:  string | null = null;

      if (phoneNumId) {
        const { data: conn, error: connErr } = await supabase
          .from("meta_connections")
          .select("id, workspace_id, access_token")
          .eq("phone_number_id", phoneNumId)
          .maybeSingle();

        if (connErr) console.error("[webhook] erro ao buscar conexão:", connErr.message);

        connectionId = conn?.id           ?? null;
        workspaceId  = conn?.workspace_id ?? null;
        accessToken  = conn?.access_token ? await decrypt(conn.access_token) : null;

        console.log(`[webhook] phone_number_id=${phoneNumId} → connection=${connectionId} workspace=${workspaceId}`);
      }

      // ── WABA-level events: no phone_number_id in metadata ─────
      // Handle before the connection-required check below.
      if (field === "message_template_status_update") {
        // Look up workspace by waba_id when phone_number_id is absent
        let wsId = workspaceId;
        if (!wsId && wabaId) {
          const { data: conn } = await supabase
            .from("meta_connections")
            .select("workspace_id")
            .eq("waba_id", wabaId)
            .maybeSingle();
          wsId = conn?.workspace_id ?? null;
        }
        await handleTemplateStatusUpdate(value, wsId, wabaId).catch((e) =>
          console.error("[template_status] handler error:", e?.message)
        );
        continue; // no messages/statuses to process in this event type
      }

      if (!connectionId || !workspaceId) {
        console.warn("[webhook] conexão não encontrada para phone_number_id:", phoneNumId, "field:", field);
        await supabase.from("webhook_events").insert({
          workspace_id:       "unknown",
          meta_connection_id: "unknown",
          event_type:         field,
          payload:            value,
          processed:          false,
        });
        continue;
      }

      // Salva evento raw
      await supabase.from("webhook_events").insert({
        workspace_id:       workspaceId,
        meta_connection_id: connectionId,
        event_type:         field,
        payload:            value,
        processed:          false,
      }).then(({ error }) => {
        if (error) console.error("[webhook] erro ao salvar evento:", error.message);
      });

      // ── Advanced event handlers (account + quality) ────────────
      if (field === "account_update") {
        await handleAccountUpdate(value, connectionId, workspaceId).catch((e) =>
          console.error("[account_update] handler error:", e?.message)
        );
        continue;
      }

      if (field === "phone_number_quality_update") {
        await handleQualityUpdate(value, connectionId, workspaceId).catch((e) =>
          console.error("[quality_update] handler error:", e?.message)
        );
        continue;
      }

      // ── 1. Mensagens inbound → inbox ────────────────────────────
      const rawMessages = (value?.messages as unknown[]) ?? [];
      const rawContacts = (value?.contacts as unknown[]) ?? [];

      for (const rawMsg of rawMessages) {
        const msg   = rawMsg as Record<string, unknown>;
        const wamid = msg.id   as string;
        const from  = msg.from as string;
        const ts    = new Date(Number(msg.timestamp) * 1000).toISOString();
        const type  = (msg.type as string) ?? "unsupported";

        const contactEntry = rawContacts.find(
          (ct: unknown) => (ct as Record<string, unknown>).wa_id === from
        ) as Record<string, unknown> | undefined;
        const profileName = (
          (contactEntry?.profile as Record<string, unknown>)?.name as string
        ) ?? undefined;

        console.log(`[inbox] recebido tipo=${type} de=${from} wamid=${wamid}`);

        const contactId = await upsertContact(workspaceId, from, profileName, ts);
        if (!contactId) { console.error("[inbox] falhou contato:", from); continue; }

        const shortBody      = buildShortBody(type, msg);
        const conversationId = await upsertConversation(
          workspaceId, connectionId, contactId, ts, shortBody
        );
        if (!conversationId) { console.error("[inbox] falhou conversa:", from); continue; }

        const fields = extractMessageFields(type, msg);

        const { data: savedMsg, error: msgErr } = await supabase.from("inbox_messages").upsert(
          {
            workspace_id:     workspaceId,
            conversation_id:  conversationId,
            contact_id:       contactId,
            wamid,
            direction:        "inbound",
            message_type:     fields.message_type,
            body:             fields.body             ?? null,
            media_id:         fields.media_id         ?? null,
            media_url:        fields.media_url         ?? null,
            media_mime_type:  fields.media_mime_type  ?? null,
            media_filename:   fields.media_filename   ?? null,
            media_size:       fields.media_size        ?? null,
            media_caption:    fields.media_caption    ?? null,
            location_lat:     fields.location_lat     ?? null,
            location_lng:     fields.location_lng     ?? null,
            location_name:    fields.location_name    ?? null,
            location_address: fields.location_address ?? null,
            reaction_emoji:   fields.reaction_emoji   ?? null,
            reaction_wamid:   fields.reaction_wamid   ?? null,
            status:           "delivered",
            created_at:       ts,
          },
          { onConflict: "wamid", ignoreDuplicates: true }
        ).select("id").maybeSingle();

        if (msgErr) {
          console.error("[inbox] erro ao salvar mensagem:", msgErr.message);
        } else {
          console.log(`[inbox] ✓ ${type} de ${from} → conv ${conversationId}`);

          // Fire-and-forget: download media and store permanently
          const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"];
          if (savedMsg?.id && fields.media_id && accessToken && MEDIA_TYPES.includes(type)) {
            fetchAndStoreMedia(
              fields.media_id, accessToken, workspaceId, savedMsg.id, fields.media_mime_type,
            ).catch((e) => console.error("[media] bg error:", e?.message));
          }

          // Fire-and-forget: detect if this is a reply to a campaign and classify with AI
          const replyText = fields.body ?? buildShortBody(type, msg);
          if (replyText && type !== "reaction") {
            detectCampaignReply(from, workspaceId, conversationId, replyText)
              .catch((e) => console.error("[reply-detect] bg error:", e?.message));
          }
        }
      }

      // ── 2. Status updates → inbox_messages + shooting_messages ──
      const statuses = (value?.statuses as unknown[]) ?? [];

      if (statuses.length > 0) {
        console.log(`[status] recebidos ${statuses.length} status update(s)`);
      }

      for (const s of statuses) {
        const status = s as Record<string, unknown>;
        const wamid  = status.id     as string;
        const st     = status.status as string;
        const ts     = new Date(Number(status.timestamp) * 1000).toISOString();

        console.log(`[status] wamid=${wamid} status=${st}`);

        // ── 2a. Tenta atualizar inbox_messages ──────────────────────
        const { data: inboxMsg, error: inboxLookupErr } = await supabase
          .from("inbox_messages")
          .select("id, status")
          .eq("wamid", wamid)
          .maybeSingle();

        if (inboxLookupErr) {
          console.error(`[status] erro ao buscar inbox_message wamid=${wamid}:`, inboxLookupErr.message);
        }

        if (inboxMsg) {
          console.log(`[status] inbox_message encontrada id=${inboxMsg.id} status_atual=${inboxMsg.status}`);

          const inboxUpdates: Record<string, unknown> = {};

          if (st === "sent" && !["sent", "delivered", "read"].includes(inboxMsg.status)) {
            inboxUpdates.status = "sent";
          } else if (st === "delivered" && !["delivered", "read"].includes(inboxMsg.status)) {
            inboxUpdates.status = "delivered";
          } else if (st === "read" && inboxMsg.status !== "read") {
            inboxUpdates.status = "read";
          } else if (st === "failed") {
            inboxUpdates.status = "failed";
          }

          if (Object.keys(inboxUpdates).length > 0) {
            const { error: updateErr } = await supabase
              .from("inbox_messages")
              .update(inboxUpdates)
              .eq("id", inboxMsg.id);

            if (updateErr) {
              console.error(`[status] erro ao atualizar inbox_message ${wamid}:`, updateErr.message);
            } else {
              console.log(`[status] ✓ inbox_message ${wamid} → ${st}`);
            }
          } else {
            console.log(`[status] inbox_message ${wamid} já em status=${inboxMsg.status}, sem update necessário`);
          }
        }

        // ── 2b. Tenta atualizar shooting_messages ───────────────────
        const { data: shootingMsg, error: shootingLookupErr } = await supabase
          .from("shooting_messages")
          .select("id, campaign_id, status")
          .eq("wamid", wamid)
          .maybeSingle();

        if (shootingLookupErr) {
          console.error(`[status] erro ao buscar shooting_message wamid=${wamid}:`, shootingLookupErr.message);
        }

        if (!shootingMsg) {
          console.warn(`[status] wamid=${wamid} não encontrado em inbox nem em shooting_messages`);
          continue;
        }

        const updates: Record<string, unknown> = {};

        if (st === "sent" && !["delivered", "read", "replied"].includes(shootingMsg.status)) {
          updates.status  = "sent";
          updates.sent_at = ts;
        } else if (st === "delivered" && !["delivered", "read", "replied"].includes(shootingMsg.status)) {
          updates.status       = "delivered";
          updates.delivered_at = ts;
          await supabase.rpc("increment_campaign_counters", {
            p_campaign_id: shootingMsg.campaign_id, p_counter_name: "delivered_count",
          });
        } else if (st === "read" && !["read", "replied"].includes(shootingMsg.status)) {
          updates.status  = "read";
          updates.read_at = ts;
          await supabase.rpc("increment_campaign_counters", {
            p_campaign_id: shootingMsg.campaign_id, p_counter_name: "read_count",
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
            p_campaign_id: shootingMsg.campaign_id, p_counter_name: "failed_count",
          });
        }

        if (Object.keys(updates).length > 0) {
          const { error: updateErr } = await supabase
            .from("shooting_messages")
            .update(updates)
            .eq("id", shootingMsg.id);

          if (updateErr) {
            console.error(`[status] erro ao atualizar shooting_message ${wamid}:`, updateErr.message);
          } else {
            console.log(`[status] ✓ shooting_message ${wamid} → ${st}`);
          }
        }
      }
    }
  }
}

// ── Advanced webhook event handlers ─────────────────────────────

async function handleAccountUpdate(
  value:        Record<string, unknown>,
  connectionId: string,
  workspaceId:  string,
): Promise<void> {
  const event   = String(value.event ?? "");
  // deno-lint-ignore no-explicit-any
  const banInfo = value.ban_info as any;

  console.log(`[account_update] event=${event} connection=${connectionId}`);

  const STATUS_MAP: Record<string, "active" | "disconnected" | "token_expired"> = {
    DISABLED:              "disconnected",
    ACCOUNT_RESTRICTION:   "disconnected",
    ACCOUNT_REVIEW_UPDATE: "active",
    FLAGGED:               "active",
  };

  const newStatus = STATUS_MAP[event];
  if (newStatus) {
    const { error } = await supabase
      .from("meta_connections")
      .update({ status: newStatus })
      .eq("id", connectionId);
    if (error) console.error("[account_update] status update error:", error.message);
    else console.log(`[account_update] ✓ connection ${connectionId} → ${newStatus}`);
  }

  const auditStatus = ["DISABLED", "ACCOUNT_RESTRICTION"].includes(event) ? "warning" : "info";
  writeAuditLog(
    workspaceId,
    "account_update",
    connectionId,
    "connection",
    auditStatus,
    event === "DISABLED" ? "Conta desabilitada pela Meta" : null,
    { event, ban_info: banInfo ?? null },
  );
}

async function handleTemplateStatusUpdate(
  value:       Record<string, unknown>,
  workspaceId: string | null,
  wabaId?:     string,
): Promise<void> {
  const event      = String(value.event                ?? "");
  const templateId = String(value.message_template_id  ?? "");
  const name       = String(value.message_template_name ?? "");
  const reason     = value.reason ? String(value.reason) : null;

  console.log(`[template_status] event=${event} template_id=${templateId} name=${name}`);

  const STATUS_MAP: Record<string, "APPROVED" | "PENDING" | "REJECTED"> = {
    APPROVED:         "APPROVED",
    REJECTED:         "REJECTED",
    PENDING_DELETION: "PENDING",
    PAUSED:           "PENDING",
    DISABLED:         "REJECTED",
    FLAGGED:          "PENDING",
  };

  const newStatus = STATUS_MAP[event];
  if (newStatus && templateId) {
    const { error } = await supabase
      .from("meta_templates")
      .update({ status: newStatus })
      .eq("template_id", templateId);
    if (error) console.error("[template_status] update error:", error.message);
    else console.log(`[template_status] ✓ template ${templateId} (${name}) → ${newStatus}`);
  }

  if (workspaceId) {
    const auditStatus = event === "APPROVED" ? "success" : event === "REJECTED" ? "error" : "warning";
    writeAuditLog(
      workspaceId,
      "template_status_update",
      templateId,
      "template",
      auditStatus,
      reason,
      { event, template_name: name, waba_id: wabaId ?? null },
    );
  }
}

async function handleQualityUpdate(
  value:        Record<string, unknown>,
  connectionId: string,
  workspaceId:  string,
): Promise<void> {
  const event         = String(value.event          ?? "");
  const currentLimit  = String(value.current_limit  ?? "");
  const previousLimit = String(value.previous_limit ?? "");
  const currentScore  = String(value.current_score  ?? ""); // "HIGH" | "MEDIUM" | "LOW" or already "GREEN" | "YELLOW" | "RED"

  console.log(`[quality_update] event=${event} limit=${currentLimit} score=${currentScore} connection=${connectionId}`);

  // Map quality score to our DB enum
  const SCORE_MAP: Record<string, "GREEN" | "YELLOW" | "RED"> = {
    HIGH:   "GREEN",  GREEN:  "GREEN",
    MEDIUM: "YELLOW", YELLOW: "YELLOW",
    LOW:    "RED",    RED:    "RED",
  };

  // Map messaging tier to our DB enum (Meta uses TIER_50 / TIER_250 / etc.)
  const TIER_MAP: Record<string, string> = {
    TIER_50:   "TIER_1K", TIER_250:  "TIER_1K", TIER_1K:    "TIER_1K",
    TIER_10K:  "TIER_10K", TIER_100K: "TIER_100K", UNLIMITED: "UNLIMITED",
  };

  const updates: Record<string, unknown> = {};
  const newRating = SCORE_MAP[currentScore] ?? SCORE_MAP[event];
  if (newRating) updates.quality_rating = newRating;
  const newTier = TIER_MAP[currentLimit];
  if (newTier) updates.messaging_limit = newTier;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from("meta_connections")
      .update(updates)
      .eq("id", connectionId);
    if (error) console.error("[quality_update] update error:", error.message);
    else console.log(`[quality_update] ✓ connection ${connectionId} rating=${newRating} tier=${newTier}`);
  }

  writeAuditLog(
    workspaceId,
    "quality_update",
    connectionId,
    "connection",
    newRating === "RED" ? "warning" : "info",
    null,
    { event, current_limit: currentLimit, previous_limit: previousLimit, current_score: currentScore },
  );
}

// ── Helpers ─────────────────────────────────────────────────────

async function detectCampaignReply(
  phone:          string,
  workspaceId:    string,
  conversationId: string | null,
  replyText:      string,
): Promise<void> {
  console.log(`[reply-detect] checking phone=${phone} workspace=${workspaceId}`);

  // 90-day window prevents matching stale campaigns from months ago.
  // "replied" included so re-analysis fires on every subsequent message in the same conversation.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: shootingMsg, error: lookupErr } = await supabase
    .from("shooting_messages")
    .select("id, campaign_id, workspace_id, recipient_name")
    .eq("recipient_phone", phone)
    .eq("workspace_id", workspaceId)
    .in("status", ["sent", "delivered", "read", "replied"])
    .gte("created_at", ninetyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupErr) {
    console.error(`[reply-detect] DB lookup error for phone=${phone}:`, lookupErr.message);
    supabase.from("audit_logs").insert({
      workspace_id: workspaceId,
      event_type:   "reply_detect_error",
      entity_type:  "shooting_message",
      entity_id:    null,
      status:       "error",
      error:        lookupErr.message,
      metadata:     { phone, conversation_id: conversationId },
    }).then(({ error: e }) => { if (e) console.error("[reply-detect] audit log error:", e.message); });
    return;
  }

  if (!shootingMsg) {
    console.log(`[reply-detect] no active campaign message found for phone=${phone} — not a campaign reply`);
    return;
  }

  console.log(`[reply-detect] ✓ campaign reply detected — message=${shootingMsg.id} campaign=${shootingMsg.campaign_id} phone=${phone}`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")             ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const analyzePayload = {
    message_id:      shootingMsg.id,
    workspace_id:    shootingMsg.workspace_id,
    campaign_id:     shootingMsg.campaign_id,
    conversation_id: conversationId,
    reply_text:      replyText,
    recipient_phone: phone,
    recipient_name:  shootingMsg.recipient_name ?? null,
  };

  fetch(`${supabaseUrl}/functions/v1/analyze-reply`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(analyzePayload),
  })
    .then(async (res) => {
      if (!res.ok) {
        const errBody = await res.text().catch(() => "(no body)");
        console.error(`[reply-detect] analyze-reply returned ${res.status}: ${errBody}`);
        supabase.from("audit_logs").insert({
          workspace_id: workspaceId,
          event_type:   "reply_detect_dispatch_error",
          entity_type:  "shooting_message",
          entity_id:    shootingMsg.id,
          status:       "error",
          error:        `analyze-reply HTTP ${res.status}: ${errBody}`,
          metadata:     analyzePayload,
        }).then(() => {});
      } else {
        console.log(`[reply-detect] ✓ analyze-reply dispatched for message=${shootingMsg.id}`);
      }
    })
    .catch((e) => {
      console.error("[reply-detect] fetch to analyze-reply failed:", e?.message);
      supabase.from("audit_logs").insert({
        workspace_id: workspaceId,
        event_type:   "reply_detect_dispatch_error",
        entity_type:  "shooting_message",
        entity_id:    shootingMsg.id,
        status:       "error",
        error:        e?.message ?? String(e),
        metadata:     analyzePayload,
      }).then(() => {});
    });
}

async function upsertContact(
  workspaceId: string, phone: string,
  profileName: string | undefined, ts: string,
): Promise<string | null> {
  const { data: existing, error: fetchErr } = await supabase
    .from("inbox_contacts")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("phone", phone)
    .maybeSingle();

  if (fetchErr) console.error("[upsertContact] fetch:", fetchErr.message);

  if (existing) {
    const patch: Record<string, unknown> = { last_seen_at: ts };
    if (profileName && !existing.name) patch.name = profileName;
    await supabase.from("inbox_contacts").update(patch).eq("id", existing.id);
    return existing.id as string;
  }

  const { data: created, error: insertErr } = await supabase
    .from("inbox_contacts")
    .insert({ workspace_id: workspaceId, phone, name: profileName ?? null, first_seen_at: ts, last_seen_at: ts })
    .select("id")
    .single();

  if (insertErr) console.error("[upsertContact] insert:", insertErr.message);
  return (created?.id as string) ?? null;
}

async function upsertConversation(
  workspaceId: string, connectionId: string,
  contactId: string, ts: string, lastBody: string,
): Promise<string | null> {
  const { data: existing, error: fetchErr } = await supabase
    .from("inbox_conversations")
    .select("id, unread_count")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .maybeSingle();

  if (fetchErr) console.error("[upsertConversation] fetch:", fetchErr.message);

  if (existing) {
    await supabase.from("inbox_conversations").update({
      status:                  "open",
      unread_count:            (existing.unread_count as number) + 1,
      last_message_at:         ts,
      last_message_body:       lastBody,
      last_message_direction:  "inbound",
      updated_at:              ts,
    }).eq("id", existing.id);
    return existing.id as string;
  }

  const { data: created, error: insertErr } = await supabase
    .from("inbox_conversations")
    .insert({
      workspace_id:            workspaceId,
      meta_connection_id:      connectionId,
      contact_id:              contactId,
      status:                  "open",
      unread_count:            1,
      last_message_at:         ts,
      last_message_body:       lastBody,
      last_message_direction:  "inbound",
    })
    .select("id")
    .single();

  if (insertErr) console.error("[upsertConversation] insert:", insertErr.message);
  return (created?.id as string) ?? null;
}

interface MessageFields {
  message_type: string; body?: string; media_id?: string; media_url?: string;
  media_mime_type?: string; media_filename?: string; media_size?: number;
  media_caption?: string; location_lat?: number; location_lng?: number;
  location_name?: string; location_address?: string;
  reaction_emoji?: string; reaction_wamid?: string;
}

function extractMessageFields(type: string, msg: Record<string, unknown>): MessageFields {
  switch (type) {
    case "text": {
      const t = msg.text as Record<string, unknown>;
      return { message_type: "text", body: t?.body as string };
    }
    case "image": case "video": case "audio": case "sticker": {
      const m = msg[type] as Record<string, unknown>;
      return { message_type: type, media_id: m?.id as string, media_mime_type: m?.mime_type as string, media_caption: m?.caption as string, media_size: m?.file_size as number };
    }
    case "document": {
      const d = msg.document as Record<string, unknown>;
      return { message_type: "document", media_id: d?.id as string, media_mime_type: d?.mime_type as string, media_filename: d?.filename as string, media_caption: d?.caption as string, media_size: d?.file_size as number };
    }
    case "location": {
      const l = msg.location as Record<string, unknown>;
      return { message_type: "location", location_lat: l?.latitude as number, location_lng: l?.longitude as number, location_name: l?.name as string, location_address: l?.address as string };
    }
    case "reaction": {
      const r = msg.reaction as Record<string, unknown>;
      return { message_type: "reaction", reaction_emoji: r?.emoji as string, reaction_wamid: r?.message_id as string };
    }
    case "button": {
      const b = msg.button as Record<string, unknown>;
      return { message_type: "button_reply", body: (b?.text as string) ?? "Botão clicado" };
    }
    case "interactive": {
      const interactive = msg.interactive as Record<string, unknown>;
      const iType = interactive?.type as string;
      if (iType === "button_reply") {
        const br = interactive.button_reply as Record<string, unknown>;
        return { message_type: "button_reply", body: (br?.title as string) ?? "Botão clicado" };
      }
      if (iType === "list_reply") {
        const lr = interactive.list_reply as Record<string, unknown>;
        return { message_type: "button_reply", body: (lr?.title as string) ?? "Opção selecionada" };
      }
      return { message_type: "button_reply", body: "Resposta interativa" };
    }
    default: return { message_type: "unsupported" };
  }
}

function buildShortBody(type: string, msg: Record<string, unknown>): string {
  switch (type) {
    case "text":     return ((msg.text as Record<string, unknown>)?.body as string) ?? "";
    case "image":    return "📷 Imagem";
    case "audio":    return "🎵 Áudio";
    case "video":    return "🎬 Vídeo";
    case "document": return "📄 Documento";
    case "sticker":  return "🎯 Sticker";
    case "location": return "📍 Localização";
    case "reaction":     return `Reagiu: ${((msg.reaction as Record<string, unknown>)?.emoji as string) ?? "👍"}`;
    case "button": {
      const b = msg.button as Record<string, unknown>;
      return `🔘 ${(b?.text as string) ?? "Botão"}`;
    }
    case "interactive": {
      const interactive = msg.interactive as Record<string, unknown>;
      const iType = interactive?.type as string;
      if (iType === "button_reply") return `🔘 ${((interactive.button_reply as Record<string, unknown>)?.title as string) ?? "Botão"}`;
      if (iType === "list_reply")   return `📋 ${((interactive.list_reply as Record<string, unknown>)?.title as string) ?? "Lista"}`;
      return "🔘 Resposta interativa";
    }
    default:             return "Mensagem";
  }
}
