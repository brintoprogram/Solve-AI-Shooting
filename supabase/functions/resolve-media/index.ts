// Supabase Edge Function — Resolve Media
// Deploy: supabase functions deploy resolve-media
//
// POST { conversation_id: string }
// Fetches all inbox_messages with media_id set but media_url null,
// downloads from Meta Graph API, uploads to Supabase Storage "inbox-media",
// then updates media_url in the DB (realtime subscription picks up the change).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";

const META_API = "https://graph.facebook.com/v25.0";


const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);


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

async function resolveMessage(
  messageId:   string,
  mediaId:     string,
  mimeType:    string | null,
  workspaceId: string,
  accessToken: string,
): Promise<boolean> {
  try {
    // 1. Get the temporary CDN URL from Meta
    const infoRes = await fetch(`${META_API}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!infoRes.ok) {
      console.error(`[resolve] Meta info error ${mediaId}: ${infoRes.status} ${await infoRes.text()}`);
      return false;
    }
    const info = await infoRes.json() as { url: string; mime_type?: string; file_size?: number };

    // 2. Download binary (Meta requires the same token)
    const dlRes = await fetch(info.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!dlRes.ok) {
      console.error(`[resolve] download error ${mediaId}: ${dlRes.status}`);
      return false;
    }
    const buffer = await dlRes.arrayBuffer();
    const mime   = mimeType ?? info.mime_type ?? "application/octet-stream";
    const ext    = mimeToExt(mime);
    const path   = `${workspaceId}/${messageId}${ext}`;

    // 3. Upload to Supabase Storage
    const { error: upErr } = await supabase.storage
      .from("inbox-media")
      .upload(path, buffer, { contentType: mime, upsert: true });
    if (upErr) {
      console.error(`[resolve] upload error for ${messageId}: ${upErr.message}`);
      return false;
    }

    // 4. Get public URL and update row
    const { data: { publicUrl } } = supabase.storage.from("inbox-media").getPublicUrl(path);
    const { error: updErr } = await supabase.from("inbox_messages")
      .update({ media_url: publicUrl, media_size: info.file_size ?? buffer.byteLength })
      .eq("id", messageId);
    if (updErr) {
      console.error(`[resolve] db update error ${messageId}: ${updErr.message}`);
      return false;
    }

    console.log(`[resolve] ✓ ${mediaId} → ${path}`);
    return true;
  } catch (err) {
    console.error(`[resolve] exception for ${mediaId}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { conversation_id?: string; message_id?: string };
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { conversation_id, message_id } = body;
  if (!conversation_id && !message_id) {
    return json({ error: "conversation_id or message_id required" }, 400);
  }

  // ── Build query for pending messages ───────────────────────
  let q = supabase
    .from("inbox_messages")
    .select("id, media_id, media_mime_type, conversation_id, workspace_id")
    .not("media_id", "is", null)
    .is("media_url", null);

  if (message_id)      q = q.eq("id", message_id);
  else if (conversation_id) q = q.eq("conversation_id", conversation_id);

  const { data: pending, error: fetchErr } = await q;
  if (fetchErr) return json({ error: fetchErr.message }, 500);
  if (!pending || pending.length === 0) return json({ resolved: 0, skipped: 0 });

  // ── Get access_token via conversation → meta_connection ────
  // Use first message's conversation_id to resolve connection
  const convId = conversation_id ?? (pending[0].conversation_id as string);
  const { data: conv, error: convErr } = await supabase
    .from("inbox_conversations")
    .select("meta_connection_id, workspace_id")
    .eq("id", convId)
    .single();

  if (convErr || !conv) return json({ error: "Conversa não encontrada" }, 404);

  const { data: conn, error: connErr } = await supabase
    .from("meta_connections")
    .select("access_token")
    .eq("id", conv.meta_connection_id)
    .single();

  if (connErr || !conn?.access_token) return json({ error: "Conexão Meta não encontrada" }, 404);

  const workspaceId  = conv.workspace_id as string;
  const accessToken  = conn.access_token as string;

  // ── Resolve each message sequentially (avoid rate limits) ──
  let resolved = 0;
  for (const msg of pending) {
    const ok = await resolveMessage(
      msg.id as string,
      msg.media_id as string,
      msg.media_mime_type as string | null,
      workspaceId,
      accessToken,
    );
    if (ok) resolved++;
  }

  console.log(`[resolve] done — ${resolved}/${pending.length} resolved`);
  return json({ resolved, total: pending.length });
});
