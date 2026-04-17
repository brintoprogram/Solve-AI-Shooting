// Supabase Edge Function — Send Inbox Message
// Deploy: supabase functions deploy send-inbox-message
//
// POST body:
//   conversation_id  string  — UUID da conversa
//   workspace_id     string  — UUID do workspace
//   type             string  — "text" | "image" | "audio" | "video" | "document"
//   text             string? — corpo (text) ou legenda (mídia)
//   media_url        string? — URL pública do arquivo (Supabase Storage)
//   media_filename   string? — nome do arquivo (para documents)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_API = "https://graph.facebook.com/v21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const {
    conversation_id,
    workspace_id,
    type = "text",
    text,
    media_url,
    media_filename,
  } = body as {
    conversation_id: string;
    workspace_id:    string;
    type?:           string;
    text?:           string;
    media_url?:      string;
    media_filename?: string;
  };

  if (!conversation_id || !workspace_id) {
    return json({ error: "conversation_id and workspace_id são obrigatórios" }, 400);
  }
  if (!text?.trim() && !media_url) {
    return json({ error: "text ou media_url é obrigatório" }, 400);
  }

  // 1. Conversation → contact_id + meta_connection_id
  const { data: conv, error: convErr } = await supabase
    .from("inbox_conversations")
    .select("contact_id, meta_connection_id")
    .eq("id", conversation_id)
    .single();

  if (convErr || !conv) {
    console.error("[send] conversa não encontrada:", convErr?.message);
    return json({ error: "Conversa não encontrada" }, 404);
  }

  // 2. Contact → phone
  const { data: contact, error: contactErr } = await supabase
    .from("inbox_contacts")
    .select("phone")
    .eq("id", conv.contact_id)
    .single();

  if (contactErr || !contact) {
    console.error("[send] contato não encontrado:", contactErr?.message);
    return json({ error: "Contato não encontrado" }, 404);
  }

  // 3. Meta connection → phone_number_id + access_token
  const { data: conn, error: connErr } = await supabase
    .from("meta_connections")
    .select("phone_number_id, access_token")
    .eq("id", conv.meta_connection_id)
    .single();

  if (connErr || !conn) {
    console.error("[send] conexão Meta não encontrada:", connErr?.message);
    return json({ error: "Conexão Meta não encontrada" }, 404);
  }

  // 4. Build payload
  const msgType     = media_url ? (type as string) : "text";
  const captionText = media_url ? (text?.trim() ?? null) : null;
  const bodyText    = !media_url ? (text?.trim() ?? null) : null;

  const metaPayload = buildMetaPayload(
    contact.phone, msgType, bodyText, media_url ?? null, media_filename ?? null, captionText,
  );

  // 5. Send via Meta Graph API
  const metaRes = await fetch(`${META_API}/${conn.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${conn.access_token}`,
    },
    body: JSON.stringify(metaPayload),
  });

  const metaBody = await metaRes.json() as Record<string, unknown>;

  if (!metaRes.ok) {
    console.error("[send] Meta API error:", JSON.stringify(metaBody));
    return json({ error: "Meta API rejeitou a mensagem", details: metaBody }, 502);
  }

  const wamid = (metaBody.messages as Array<{ id: string }>)?.[0]?.id ?? null;
  console.log(`[send] enviado → ${contact.phone} wamid=${wamid}`);

  // 6. Save outbound message
  const now = new Date().toISOString();

  await supabase.from("inbox_messages").insert({
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
    status:         "sent",
    created_at:     now,
  });

  // 7. Update conversation preview
  await supabase
    .from("inbox_conversations")
    .update({
      last_message_at:   now,
      last_message_body: msgType === "text" ? (bodyText ?? "") : mediaLabel(msgType),
      updated_at:        now,
    })
    .eq("id", conversation_id);

  return json({ ok: true, wamid });
});

// ── Helpers ────────────────────────────────────────────────────

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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
