// Supabase Edge Function — Send Inbox Message
// Deploy: supabase functions deploy send-inbox-message
//
// POST body:
//   conversation_id  string  — UUID da conversa
//   type             string  — "text" | "image" | "audio" | "video" | "document"
//   text             string? — corpo (text) ou legenda (mídia)
//   media_url        string? — URL pública do arquivo (Supabase Storage)
//   media_filename   string? — nome do arquivo (para documents)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AES-256-GCM decrypt (inlined — MCP bundler can't resolve cross-function _shared imports)
const ENC_PREFIX = "enc:v1:";
function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return b;
}
async function getKey(): Promise<CryptoKey> {
  const h = Deno.env.get("ENCRYPTION_KEY") ?? "";
  if (h.length !== 64) throw new Error("ENCRYPTION_KEY must be a 64-char hex string");
  return crypto.subtle.importKey("raw", hexToBytes(h), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function decrypt(value: string): Promise<string> {
  if (!value.startsWith(ENC_PREFIX)) return value;
  const rest = value.slice(ENC_PREFIX.length);
  const col = rest.indexOf(":");
  if (col === -1) throw new Error("Invalid encrypted token format");
  const iv = hexToBytes(rest.slice(0, col));
  const ct = Uint8Array.from(atob(rest.slice(col + 1)), (c) => c.charCodeAt(0));
  const key = await getKey();
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(dec);
}

const META_API = "https://graph.facebook.com/v25.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

type JsonFn = (data: unknown, status?: number) => Response;

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json: JsonFn = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    return await handleRequest(req, json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send] unhandled error:", msg);
    return json({ error: msg }, 500);
  }
});

async function handleRequest(req: Request, json: JsonFn): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── Auth ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Não autorizado" }, 401);

  const { data: { user: caller }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !caller) return json({ error: "Token inválido" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { conversation_id, sent_by, type = "text", text, media_url, media_filename } = body as {
    conversation_id: string;
    sent_by?:        string;
    type?:           string;
    text?:           string;
    media_url?:      string;
    media_filename?: string;
  };

  if (!conversation_id)            return json({ error: "conversation_id é obrigatório" }, 400);
  if (!text?.trim() && !media_url) return json({ error: "text ou media_url é obrigatório" }, 400);

  // ── 1. Conversation → connection IDs + workspace_id (nunca do request body) ──
  const { data: conv, error: convErr } = await supabase
    .from("inbox_conversations")
    .select("contact_id, meta_connection_id, z_api_connection_id, workspace_id")
    .eq("id", conversation_id)
    .single();

  if (convErr || !conv) {
    console.error("[send] conversa não encontrada:", convErr?.message);
    return json({ error: "Conversa não encontrada" }, 404);
  }

  const workspace_id = conv.workspace_id as string;

  // ── Verificar membership ──────────────────────────────────────
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", caller.id)
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (!membership) {
    console.warn(`[send] usuário ${caller.id} sem acesso ao workspace ${workspace_id}`);
    return json({ error: "Sem permissão para enviar mensagens neste workspace" }, 403);
  }

  // ── 2. Contact → phone ────────────────────────────────────────
  const { data: contact, error: contactErr } = await supabase
    .from("inbox_contacts")
    .select("phone")
    .eq("id", conv.contact_id)
    .single();

  if (contactErr || !contact) {
    console.error("[send] contato não encontrado:", contactErr?.message);
    return json({ error: "Contato não encontrado" }, 404);
  }

  const msgType     = media_url ? (type as string) : "text";
  const captionText = media_url ? (text?.trim() ?? null) : null;
  const bodyText    = !media_url ? (text?.trim() ?? null) : null;
  const now         = new Date().toISOString();

  // ── Roteamento por tipo de conexão ────────────────────────────
  if (conv.z_api_connection_id) {
    return await sendViaZApi({
      json, conv, contact, conversation_id, workspace_id,
      sent_by: sent_by ?? null, msgType, bodyText, now,
    });
  }

  // ── 3. Meta connection ────────────────────────────────────────
  const { data: conn, error: connErr } = await supabase
    .from("meta_connections")
    .select("phone_number_id, access_token")
    .eq("id", conv.meta_connection_id)
    .single();

  if (connErr || !conn) {
    console.error("[send] conexão Meta não encontrada:", connErr?.message);
    return json({ error: "Conexão Meta não encontrada" }, 404);
  }

  conn.access_token = await decrypt(conn.access_token);

  // ── 4. Send via Meta Graph API ────────────────────────────────
  const metaPayload = buildMetaPayload(
    contact.phone, msgType, bodyText, media_url ?? null, media_filename ?? null, captionText,
  );

  const metaRes = await fetch(`${META_API}/${conn.phone_number_id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${conn.access_token}` },
    body: JSON.stringify(metaPayload),
  });

  const metaBody = await metaRes.json() as Record<string, unknown>;
  if (!metaRes.ok) {
    console.error("[send] Meta API error:", JSON.stringify(metaBody));
    return json({ error: "Meta API rejeitou a mensagem", details: metaBody }, 502);
  }

  const wamid = (metaBody.messages as Array<{ id: string }>)?.[0]?.id ?? null;
  if (!wamid) console.warn("[send] Meta não retornou wamid:", JSON.stringify(metaBody));
  else        console.log(`[send] ✓ Meta → ${contact.phone} wamid=${wamid}`);

  // ── 5. Save outbound message ──────────────────────────────────
  const { data: inserted, error: insertErr } = await supabase.from("inbox_messages").insert({
    workspace_id,
    conversation_id,
    contact_id:     conv.contact_id,
    wamid,
    direction:      "outbound",
    message_type:   msgType,
    body:           bodyText,
    media_url:      media_url      ?? null,
    media_filename: media_filename ?? null,
    media_caption:  captionText,
    sent_by:        sent_by        ?? null,
    status:         "sending",
    created_at:     now,
  }).select("id").single();

  if (insertErr) {
    console.error("[send] erro ao salvar mensagem:", insertErr.message);
    return json({ error: `Mensagem enviada mas não salva: ${insertErr.message}` }, 500);
  }

  console.log(`[send] ✓ inbox_message salva id=${inserted?.id} wamid=${wamid}`);

  await supabase.from("inbox_conversations").update({
    last_message_at:        now,
    last_message_body:      msgType === "text" ? (bodyText ?? "") : mediaLabel(msgType),
    last_message_direction: "outbound",
    updated_at:             now,
  }).eq("id", conversation_id);

  return json({ ok: true, wamid });
}

async function sendViaZApi(params: {
  json:            JsonFn;
  conv:            Record<string, unknown>;
  contact:         { phone: string };
  conversation_id: string;
  workspace_id:    string;
  sent_by:         string | null;
  msgType:         string;
  bodyText:        string | null;
  now:             string;
}): Promise<Response> {
  const { json, conv, contact, conversation_id, workspace_id, sent_by, msgType, bodyText, now } = params;

  const { data: zapiConn, error: zapiErr } = await supabase
    .from("z_api_connections")
    .select("instance_id, token, client_token")
    .eq("id", conv.z_api_connection_id)
    .single();

  if (zapiErr || !zapiConn) {
    console.error("[send/zapi] conexão Z-API não encontrada:", zapiErr?.message);
    return json({ error: "Conexão Z-API não encontrada" }, 404);
  }

  const instanceId  = zapiConn.instance_id  as string;
  const token       = await decrypt(zapiConn.token        as string);
  const clientToken = await decrypt(zapiConn.client_token as string);

  const zapiRes = await fetch(
    `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`,
    {
      method:  "POST",
      headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
      body:    JSON.stringify({ phone: contact.phone, message: bodyText ?? "" }),
    }
  );

  const zapiBody = await zapiRes.json() as Record<string, unknown>;
  if (!zapiRes.ok) {
    console.error("[send/zapi] Z-API error:", JSON.stringify(zapiBody));
    return json({ error: "Z-API rejeitou a mensagem", details: zapiBody }, 502);
  }

  const wamid = (zapiBody.zaapId ?? zapiBody.messageId ?? null) as string | null;
  console.log(`[send/zapi] ✓ Z-API → ${contact.phone} wamid=${wamid}`);

  const { error: insertErr } = await supabase.from("inbox_messages").insert({
    workspace_id,
    conversation_id,
    contact_id:   conv.contact_id,
    wamid,
    direction:    "outbound",
    message_type: msgType,
    body:         bodyText,
    sent_by,
    is_internal:  false,
    status:       "sending",
    created_at:   now,
  });

  if (insertErr) {
    console.error("[send/zapi] erro ao salvar mensagem:", insertErr.message);
    return json({ error: `Mensagem enviada mas não salva: ${insertErr.message}` }, 500);
  }

  await supabase.from("inbox_conversations").update({
    last_message_at:        now,
    last_message_body:      bodyText ?? mediaLabel(msgType),
    last_message_direction: "outbound",
    updated_at:             now,
  }).eq("id", conversation_id);

  return json({ ok: true, wamid });
}

// ── Helpers ─────────────────────────────────────────────────────

function getCors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function buildMetaPayload(
  to: string, type: string, text: string | null,
  mediaUrl: string | null, mediaFilename: string | null, caption: string | null,
): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", to };
  switch (type) {
    case "image":
      return { ...base, type: "image", image: { link: mediaUrl, ...(caption ? { caption } : {}) } };
    case "audio":
      return { ...base, type: "audio", audio: { link: mediaUrl } };
    case "video":
      return { ...base, type: "video", video: { link: mediaUrl, ...(caption ? { caption } : {}) } };
    case "document":
      return {
        ...base, type: "document",
        document: { link: mediaUrl, ...(mediaFilename ? { filename: mediaFilename } : {}), ...(caption ? { caption } : {}) },
      };
    default:
      return { ...base, type: "text", text: { body: text ?? "" } };
  }
}

function mediaLabel(type: string): string {
  const labels: Record<string, string> = {
    image: "📷 Imagem", audio: "🎵 Áudio", video: "🎬 Vídeo", document: "📄 Documento",
  };
  return labels[type] ?? "Mensagem";
}
