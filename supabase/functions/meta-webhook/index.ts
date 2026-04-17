// Supabase Edge Function — Meta Webhook Handler
// Deploy: supabase functions deploy meta-webhook
//
// Routes:
//   GET  /meta-webhook?workspace_id=...&hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//   POST /meta-webhook?workspace_id=...

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl        = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase           = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req: Request) => {
  const url         = new URL(req.url);
  const workspaceId = url.searchParams.get("workspace_id");

  // ── GET: Webhook verification by Meta ──────────────────────────
  if (req.method === "GET") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode !== "subscribe" || !token || !challenge) {
      return new Response("Bad Request", { status: 400 });
    }

    // 1. Try env variable (set via: supabase secrets set WEBHOOK_VERIFY_TOKEN=...)
    const envToken = Deno.env.get("WEBHOOK_VERIFY_TOKEN");
    if (envToken && token === envToken) {
      console.log("[webhook] verificado via env token ✓");
      return new Response(challenge, { status: 200 });
    }

    // 2. Try DB lookup (works after saving a connection in Settings)
    if (workspaceId) {
      const { data: conn } = await supabase
        .from("meta_connections")
        .select("webhook_verify_token")
        .eq("workspace_id", workspaceId)
        .eq("webhook_verify_token", token)
        .maybeSingle();

      if (conn) {
        console.log("[webhook] verificado via DB ✓");
        return new Response(challenge, { status: 200 });
      }
    }

    console.warn("[webhook] token inválido:", token);
    return new Response("Forbidden", { status: 403 });
  }

  // ── POST: Incoming webhook events ──────────────────────────────
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

    // Fetch the meta_connection for this workspace
    const { data: conn } = await supabase
      .from("meta_connections")
      .select("id")
      .eq("workspace_id", workspaceId)
      .single();

    const connectionId = conn?.id ?? "unknown";

    const entries = (body.entry as unknown[]) ?? [];

    for (const entry of entries) {
      const e       = entry as Record<string, unknown>;
      const changes = (e.changes as unknown[]) ?? [];

      for (const change of changes) {
        const c     = change as Record<string, unknown>;
        const value = c.value as Record<string, unknown>;

        // Save raw event for debugging
        await supabase.from("webhook_events").insert({
          workspace_id:       workspaceId,
          meta_connection_id: connectionId,
          event_type:         (c.field as string) ?? "unknown",
          payload:            value,
          processed:          false,
        });

        // ── 1. Inbound messages → inbox ──────────────────────────
        const rawMessages = (value?.messages as unknown[]) ?? [];
        const rawContacts = (value?.contacts as unknown[]) ?? [];

        for (const rawMsg of rawMessages) {
          const msg   = rawMsg as Record<string, unknown>;
          const wamid = msg.id as string;
          const from  = msg.from as string; // phone without +
          const ts    = new Date(Number(msg.timestamp) * 1000).toISOString();
          const type  = (msg.type as string) ?? "unsupported";

          // Extract profile name from contacts array
          const contactEntry = rawContacts.find(
            (ct: unknown) => (ct as Record<string, unknown>).wa_id === from
          ) as Record<string, unknown> | undefined;
          const profileName = (
            (contactEntry?.profile as Record<string, unknown>)?.name as string
          ) ?? undefined;

          // ── Upsert contact ──────────────────────────────────────
          const contactId = await upsertContact(workspaceId, from, profileName, ts);
          if (!contactId) {
            console.error("[inbox] failed to upsert contact", from);
            continue;
          }

          // ── Upsert conversation ─────────────────────────────────
          const shortBody      = buildShortBody(type, msg);
          const conversationId = await upsertConversation(
            workspaceId, connectionId, contactId, ts, shortBody
          );
          if (!conversationId) {
            console.error("[inbox] failed to upsert conversation for", from);
            continue;
          }

          // ── Extract typed fields and insert message ─────────────
          const fields = extractMessageFields(type, msg);

          await supabase.from("inbox_messages").upsert(
            {
              workspace_id:     workspaceId,
              conversation_id:  conversationId,
              contact_id:       contactId,
              wamid,
              direction:        "inbound",
              message_type:     fields.message_type,
              body:             fields.body             ?? null,
              media_id:         fields.media_id         ?? null,
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
              status:           "delivered",
              created_at:       ts,
            },
            { onConflict: "wamid", ignoreDuplicates: true }
          );

          console.log(`[inbox] ${type} from ${from} → conv ${conversationId}`);
        }

        // ── 2. Status updates → shooting_messages ────────────────
        const statuses = (value?.statuses as unknown[]) ?? [];
        for (const s of statuses) {
          const status = s as Record<string, unknown>;
          const wamid  = status.id as string;
          const st     = status.status as string;
          const ts     = new Date(Number(status.timestamp) * 1000).toISOString();

          const { data: shootingMsg } = await supabase
            .from("shooting_messages")
            .select("id, campaign_id, status")
            .eq("wamid", wamid)
            .single();

          if (!shootingMsg) continue;

          const updates: Record<string, unknown> = {};

          if (st === "sent" && shootingMsg.status === "pending") {
            updates.status  = "sent";
            updates.sent_at = ts;
            await supabase.rpc("increment_campaign_counters", {
              p_campaign_id:  shootingMsg.campaign_id,
              p_counter_name: "sent_count",
            });
          } else if (st === "delivered" && !["delivered","read","replied"].includes(shootingMsg.status)) {
            updates.status       = "delivered";
            updates.delivered_at = ts;
            await supabase.rpc("increment_campaign_counters", {
              p_campaign_id:  shootingMsg.campaign_id,
              p_counter_name: "delivered_count",
            });
          } else if (st === "read" && !["read","replied"].includes(shootingMsg.status)) {
            updates.status  = "read";
            updates.read_at = ts;
            await supabase.rpc("increment_campaign_counters", {
              p_campaign_id:  shootingMsg.campaign_id,
              p_counter_name: "read_count",
            });
          } else if (st === "failed") {
            const errors = status.errors as Array<Record<string, unknown>> | undefined;
            const err    = errors?.[0];
            updates.status        = "failed";
            updates.failed_at     = ts;
            updates.error_code    = String(err?.code    ?? "");
            updates.error_message = String(err?.title   ?? err?.message ?? "Unknown error");
            updates.error_details = err ?? null;
            await supabase.rpc("increment_campaign_counters", {
              p_campaign_id:  shootingMsg.campaign_id,
              p_counter_name: "failed_count",
            });
          }

          if (Object.keys(updates).length > 0) {
            await supabase
              .from("shooting_messages")
              .update(updates)
              .eq("id", shootingMsg.id);
          }
        }
      }
    }

    // Meta requires 200 OK quickly
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});

// ── Helpers ─────────────────────────────────────────────────────

async function upsertContact(
  workspaceId: string,
  phone: string,
  profileName: string | undefined,
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
    if (profileName && !existing.name) patch.name = profileName;
    await supabase.from("inbox_contacts").update(patch).eq("id", existing.id);
    return existing.id as string;
  }

  const { data: created } = await supabase
    .from("inbox_contacts")
    .insert({
      workspace_id:  workspaceId,
      phone,
      name:          profileName ?? null,
      first_seen_at: ts,
      last_seen_at:  ts,
    })
    .select("id")
    .single();

  return (created?.id as string) ?? null;
}

async function upsertConversation(
  workspaceId: string,
  connectionId: string,
  contactId: string,
  ts: string,
  lastBody: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("inbox_conversations")
    .select("id, unread_count")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("inbox_conversations")
      .update({
        status:             "open",
        unread_count:       (existing.unread_count as number) + 1,
        last_message_at:    ts,
        last_message_body:  lastBody,
        updated_at:         ts,
      })
      .eq("id", existing.id);
    return existing.id as string;
  }

  const { data: created } = await supabase
    .from("inbox_conversations")
    .insert({
      workspace_id:       workspaceId,
      meta_connection_id: connectionId,
      contact_id:         contactId,
      status:             "open",
      unread_count:       1,
      last_message_at:    ts,
      last_message_body:  lastBody,
    })
    .select("id")
    .single();

  return (created?.id as string) ?? null;
}

interface MessageFields {
  message_type:      string;
  body?:             string;
  media_id?:         string;
  media_url?:        string;
  media_mime_type?:  string;
  media_filename?:   string;
  media_size?:       number;
  media_caption?:    string;
  location_lat?:     number;
  location_lng?:     number;
  location_name?:    string;
  location_address?: string;
  reaction_emoji?:   string;
  reaction_wamid?:   string;
}

function extractMessageFields(type: string, msg: Record<string, unknown>): MessageFields {
  switch (type) {
    case "text": {
      const t = msg.text as Record<string, unknown>;
      return { message_type: "text", body: t?.body as string };
    }
    case "image":
    case "video":
    case "audio":
    case "sticker": {
      const m = msg[type] as Record<string, unknown>;
      return {
        message_type:    type,
        media_id:        m?.id        as string,
        media_mime_type: m?.mime_type as string,
        media_caption:   m?.caption   as string,
        media_size:      m?.file_size as number,
      };
    }
    case "document": {
      const d = msg.document as Record<string, unknown>;
      return {
        message_type:    "document",
        media_id:        d?.id        as string,
        media_mime_type: d?.mime_type as string,
        media_filename:  d?.filename  as string,
        media_caption:   d?.caption   as string,
        media_size:      d?.file_size as number,
      };
    }
    case "location": {
      const l = msg.location as Record<string, unknown>;
      return {
        message_type:     "location",
        location_lat:     l?.latitude  as number,
        location_lng:     l?.longitude as number,
        location_name:    l?.name      as string,
        location_address: l?.address   as string,
      };
    }
    case "reaction": {
      const r = msg.reaction as Record<string, unknown>;
      return {
        message_type:   "reaction",
        reaction_emoji: r?.emoji      as string,
        reaction_wamid: r?.message_id as string,
      };
    }
    default:
      return { message_type: "unsupported" };
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
    case "reaction": {
      const emoji = ((msg.reaction as Record<string, unknown>)?.emoji as string) ?? "👍";
      return `Reagiu: ${emoji}`;
    }
    default: return "Mensagem";
  }
}
