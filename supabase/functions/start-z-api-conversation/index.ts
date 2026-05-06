// Supabase Edge Function — Start a new outbound Z-API conversation
// Deploy: supabase functions deploy start-z-api-conversation
//
// POST body:
//   z_api_connection_id  string  — UUID da conexão Z-API
//   phone                string  — número destino (apenas dígitos, com DDI)
//   message              string  — texto da primeira mensagem
//   sent_by              string? — UUID do usuário que iniciou

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  // ── Auth ───────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const authToken  = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!authToken) return json({ error: "Não autorizado" }, 401);

  const { data: { user: caller }, error: authErr } = await supabase.auth.getUser(authToken);
  if (authErr || !caller) return json({ error: "Token inválido" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { z_api_connection_id, phone, message, sent_by } = body as {
    z_api_connection_id: string;
    phone:               string;
    message:             string;
    sent_by?:            string;
  };

  if (!z_api_connection_id) return json({ error: "z_api_connection_id é obrigatório" }, 400);
  if (!phone?.trim())        return json({ error: "phone é obrigatório" }, 400);
  if (!message?.trim())      return json({ error: "message é obrigatório" }, 400);

  // ── 1. Buscar conexão Z-API ────────────────────────────────────
  const { data: zapiConn, error: connErr } = await supabase
    .from("z_api_connections")
    .select("id, workspace_id, instance_id, token, client_token")
    .eq("id", z_api_connection_id)
    .single();

  if (connErr || !zapiConn) {
    console.error("[start-zapi] conexão não encontrada:", connErr?.message);
    return json({ error: "Conexão Z-API não encontrada" }, 404);
  }

  const workspace_id = zapiConn.workspace_id as string;
  const instanceId   = zapiConn.instance_id  as string;

  // ── 2. Verificar membership do caller ─────────────────────────
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", caller.id)
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (!membership) {
    console.warn(`[start-zapi] usuário ${caller.id} sem acesso ao workspace ${workspace_id}`);
    return json({ error: "Sem permissão" }, 403);
  }

  const normalizedPhone = phone.replace(/\D/g, "");
  const now = new Date().toISOString();

  // ── 3. Upsert contato ─────────────────────────────────────────
  const { data: existingContact } = await supabase
    .from("inbox_contacts")
    .select("id")
    .eq("workspace_id", workspace_id)
    .eq("phone", normalizedPhone)
    .maybeSingle();

  let contactId: string;

  if (existingContact) {
    contactId = existingContact.id as string;
    await supabase.from("inbox_contacts").update({ last_seen_at: now }).eq("id", contactId);
  } else {
    const { data: newContact, error: contactErr } = await supabase
      .from("inbox_contacts")
      .insert({ workspace_id, phone: normalizedPhone, first_seen_at: now, last_seen_at: now })
      .select("id")
      .single();
    if (contactErr || !newContact) {
      console.error("[start-zapi] erro ao criar contato:", contactErr?.message);
      return json({ error: "Erro ao criar contato" }, 500);
    }
    contactId = newContact.id as string;
  }

  // ── 4. Upsert conversa (segrega por conexão — mesmo contato pode ter Meta e Z-API separados) ──
  const { data: existingConv } = await supabase
    .from("inbox_conversations")
    .select("id")
    .eq("workspace_id", workspace_id)
    .eq("contact_id", contactId)
    .eq("z_api_connection_id", z_api_connection_id)
    .maybeSingle();

  let conversationId: string;

  if (existingConv) {
    conversationId = existingConv.id as string;
    await supabase.from("inbox_conversations").update({
      status:                 "open",
      last_message_at:        now,
      last_message_body:      message.trim(),
      last_message_direction: "outbound",
      updated_at:             now,
    }).eq("id", conversationId);
  } else {
    const { data: newConv, error: convErr } = await supabase
      .from("inbox_conversations")
      .insert({
        workspace_id,
        z_api_connection_id,
        meta_connection_id:     null,
        contact_id:             contactId,
        status:                 "open",
        pinned:                 false,
        archived:               false,
        tags:                   [],
        unread_count:           0,
        last_message_at:        now,
        last_message_body:      message.trim(),
        last_message_direction: "outbound",
      })
      .select("id")
      .single();

    if (convErr || !newConv) {
      console.error("[start-zapi] erro ao criar conversa:", convErr?.message);
      return json({ error: "Erro ao criar conversa" }, 500);
    }
    conversationId = newConv.id as string;
  }

  // ── 5. Enviar mensagem via Z-API ──────────────────────────────
  const token       = await decrypt(zapiConn.token        as string);
  const clientToken = await decrypt(zapiConn.client_token as string);

  const zapiRes = await fetch(
    `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`,
    {
      method:  "POST",
      headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
      body:    JSON.stringify({ phone: normalizedPhone, message: message.trim() }),
    }
  );

  const zapiBody = await zapiRes.json() as Record<string, unknown>;

  if (!zapiRes.ok) {
    console.error("[start-zapi] Z-API error:", JSON.stringify(zapiBody));
    return json({ error: "Z-API rejeitou a mensagem", details: zapiBody }, 502);
  }

  const wamid = (zapiBody.zaapId ?? zapiBody.messageId ?? null) as string | null;
  console.log(`[start-zapi] ✓ enviado → ${normalizedPhone} wamid=${wamid} conv=${conversationId}`);

  // ── 6. Salvar mensagem no banco ───────────────────────────────
  const { error: insertErr } = await supabase.from("inbox_messages").insert({
    workspace_id,
    conversation_id: conversationId,
    contact_id:      contactId,
    wamid,
    direction:       "outbound",
    message_type:    "text",
    body:            message.trim(),
    sent_by:         sent_by ?? null,
    is_internal:     false,
    status:          "sent",
    created_at:      now,
  });

  if (insertErr) {
    console.error("[start-zapi] erro ao salvar mensagem:", insertErr.message);
    return json({ error: `Mensagem enviada mas não salva: ${insertErr.message}` }, 500);
  }

  return json({ ok: true, conversation_id: conversationId, wamid });
});

// ── CORS ────────────────────────────────────────────────────────

function getCors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
