// Supabase Edge Function — Resolve Media
// Deploy: supabase functions deploy resolve-media
//
// POST { conversation_id: string }
// Fetches all inbox_messages with media_id set but media_url null,
// downloads from Meta Graph API, uploads to Supabase Storage "inbox-media",
// then updates media_url in the DB (realtime subscription picks up the change).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";
import { decrypt } from "../_shared/crypto.ts";
import { bearerToken } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/ratelimit.ts";
import { createLogger, requestIdFrom } from "../_shared/logger.ts";

// Cada chamada baixa midia da Meta e sobe no Storage: e banda + armazenamento
// pagos. 30/min por workspace cobre abrir uma conversa cheia de anexos.
const LIMIT_PER_MINUTE = 30;

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

  const log = createLogger("resolve-media", { request_id: requestIdFrom(req) });

  let body: { conversation_id?: string; message_id?: string };
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { conversation_id, message_id } = body;
  if (!conversation_id && !message_id) {
    return json({ error: "conversation_id or message_id required" }, 400);
  }

  // ── Autenticação ───────────────────────────────────────────────
  // A função estava PÚBLICA: bastava chutar um conversation_id para o servidor
  // baixar mídia da Meta e gravar no nosso Storage — banda e armazenamento
  // pagos por nós, além de expor mídia de outro tenant.
  //
  // A validação do token vem ANTES de qualquer query: sem isso, um anônimo em
  // loop ainda faria um SELECT em inbox_messages por requisição, que é
  // exatamente o flood de banco que se quer evitar.
  const token = bearerToken(req);
  if (!token) return json({ error: "Não autorizado" }, 401);

  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) {
    log.warn("auth_rejected", { reason: "token inválido" });
    return json({ error: "Sessão inválida. Entre novamente." }, 401);
  }

  const ulog = log.child({ user_id: user.id });

  // ── Resolver a conversa (é ela que diz o workspace) ────────────
  // Pelo message_id o caminho é indireto: mensagem → conversa.
  let convId = conversation_id ?? "";
  if (!convId) {
    const { data: msgRow } = await supabase
      .from("inbox_messages")
      .select("conversation_id")
      .eq("id", message_id!)
      .maybeSingle();
    if (!msgRow) return json({ error: "Mensagem não encontrada" }, 404);
    convId = msgRow.conversation_id as string;
  }

  const { data: conv, error: convErr } = await supabase
    .from("inbox_conversations")
    .select("meta_connection_id, workspace_id")
    .eq("id", convId)
    .single();

  if (convErr || !conv) return json({ error: "Conversa não encontrada" }, 404);

  // ── Autorização: o usuário pertence ao workspace desta conversa? ──
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", conv.workspace_id as string)
    .maybeSingle();

  if (!membership) {
    ulog.warn("cross_tenant_blocked", { conversation_id: convId });
    return json({ error: "Sem permissão neste workspace" }, 403);
  }

  const rl = await checkRateLimit(supabase, `resolve-media:${conv.workspace_id}`, LIMIT_PER_MINUTE, 60);
  if (!rl.allowed) {
    ulog.warn("rate_limited", { workspace_id: conv.workspace_id, used: rl.used, limit: rl.limit });
    return json({ error: "Muitas mídias seguidas. Aguarde um minuto." }, 429);
  }

  // ── Mensagens com mídia ainda não baixada ──────────────────────
  // Escopado ao workspace já autorizado: um id de outro tenant não retorna nada.
  let q = supabase
    .from("inbox_messages")
    .select("id, media_id, media_mime_type, conversation_id, workspace_id")
    .eq("workspace_id", conv.workspace_id as string)
    .not("media_id", "is", null)
    .is("media_url", null);

  if (message_id)           q = q.eq("id", message_id);
  else if (conversation_id) q = q.eq("conversation_id", conversation_id);

  const { data: pending, error: fetchErr } = await q;
  if (fetchErr) {
    ulog.error("pending_query_failed", { err: fetchErr.message });
    return json({ error: "Não foi possível carregar as mídias." }, 500);
  }
  if (!pending || pending.length === 0) return json({ resolved: 0, total: 0 });

  const { data: conn, error: connErr } = await supabase
    .from("meta_connections")
    .select("access_token")
    .eq("id", conv.meta_connection_id)
    .single();

  if (connErr || !conn?.access_token) return json({ error: "Conexão Meta não encontrada" }, 404);

  const workspaceId  = conv.workspace_id as string;
  // decrypt() e retrocompativel: valor sem o prefixo "enc:v1:" passa direto.
  // Sem isto, toda conexao criada pelo embedded-signup (que cifra o token)
  // falharia aqui com 401 da Graph.
  const accessToken  = await decrypt(conn.access_token as string);

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

  ulog.info("resolve_done", { resolved, total: pending.length, workspace_id: conv.workspace_id });
  return json({ resolved, total: pending.length });
});
