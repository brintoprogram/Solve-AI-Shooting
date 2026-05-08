// Supabase Edge Function — AI Agent Reply
// Called fire-and-forget from z-api-webhook and meta-webhook on inbound messages.
// If the conversation has an ai_agent_id set, generates and sends an automatic reply.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── AES-256-GCM decrypt (inlined — same as send-inbox-message) ───
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

const TYPE_LABELS: Record<string, string> = {
  image: "[Imagem]", audio: "[Áudio]", video: "[Vídeo]",
  document: "[Documento]", sticker: "[Sticker]",
  location: "[Localização]", reaction: "[Reação]",
};

interface RawMessage {
  direction: "inbound" | "outbound";
  message_type: string;
  body: string | null;
  created_at: string;
}

function buildTranscript(messages: RawMessage[], newMessage: string): string {
  const lines = [...messages].reverse().map((msg) => {
    const time   = new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const sender = msg.direction === "outbound" ? "Agente" : "Cliente";
    const text   = msg.body?.trim() ? msg.body.trim() : (TYPE_LABELS[msg.message_type] ?? "[Mensagem]");
    return `[${time}] ${sender}: ${text}`;
  });
  return lines.join("\n") || `Cliente: "${newMessage}"`;
}

async function callAnthropic(apiKey: string, model: string, systemPrompt: string, transcript: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   [{ role: "user", content: transcript }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content?.[0]?.text?.trim() ?? "";
}

async function callOpenAI(apiKey: string, model: string, systemPrompt: string, transcript: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: transcript },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function saveAndUpdateConversation(
  workspaceId: string,
  conversationId: string,
  contactId: string,
  replyText: string,
  wamid: string | null,
  agentId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await supabase.from("inbox_messages").insert({
    workspace_id:  workspaceId,
    conversation_id: conversationId,
    contact_id:    contactId,
    wamid,
    direction:     "outbound",
    message_type:  "text",
    body:          replyText,
    sent_by:       `ai_agent:${agentId}`,
    is_internal:   false,
    status:        "sent",
    created_at:    now,
  });
  await supabase.from("inbox_conversations").update({
    last_message_at:        now,
    last_message_body:      replyText,
    last_message_direction: "outbound",
    updated_at:             now,
  }).eq("id", conversationId);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: { conversation_id: string; message_body?: string };
  try { body = await req.json(); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const { conversation_id, message_body = "" } = body;
  if (!conversation_id) return new Response("conversation_id required", { status: 400 });

  try {
    // 1. Fetch conversation
    const { data: conv, error: convErr } = await supabase
      .from("inbox_conversations")
      .select("ai_agent_id, workspace_id, contact_id, z_api_connection_id, meta_connection_id")
      .eq("id", conversation_id)
      .single();

    if (convErr || !conv) {
      console.error("[ai-agent] conversa não encontrada:", convErr?.message);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no conversation" }), { status: 200 });
    }

    if (!conv.ai_agent_id) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no agent assigned" }), { status: 200 });
    }

    // 2. Fetch agent config
    const { data: agent, error: agentErr } = await supabase
      .from("ai_agents")
      .select("id, name, system_prompt, model, is_active")
      .eq("id", conv.ai_agent_id)
      .single();

    if (agentErr || !agent) {
      console.error("[ai-agent] agente não encontrado:", agentErr?.message);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "agent not found" }), { status: 200 });
    }

    if (!agent.is_active) {
      console.log(`[ai-agent] agente ${agent.id} inativo — pulando`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "agent inactive" }), { status: 200 });
    }

    console.log(`[ai-agent] agente "${agent.name}" (${agent.model}) → conversa ${conversation_id}`);

    // 3. Get workspace AI keys
    const { data: ws } = await supabase
      .from("workspaces")
      .select("anthropic_api_key, openai_api_key")
      .eq("id", conv.workspace_id)
      .maybeSingle();

    const isOpenAI = agent.model.startsWith("gpt");
    const rawKey   = isOpenAI
      ? (ws?.openai_api_key    || Deno.env.get("OPENAI_API_KEY")    || "")
      : (ws?.anthropic_api_key || Deno.env.get("ANTHROPIC_API_KEY") || "");

    const apiKey = rawKey.startsWith(ENC_PREFIX) ? await decrypt(rawKey) : rawKey;

    if (!apiKey) {
      console.error(`[ai-agent] API key não configurada para ${isOpenAI ? "OpenAI" : "Anthropic"}`);
      return new Response(JSON.stringify({ error: "API key not configured" }), { status: 500 });
    }

    // 4. Build transcript from last 20 messages
    const { data: messages } = await supabase
      .from("inbox_messages")
      .select("direction, message_type, body, created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(20);

    const transcript = buildTranscript((messages ?? []) as RawMessage[], message_body);

    // 5. Call AI
    const replyText = isOpenAI
      ? await callOpenAI(apiKey, agent.model, agent.system_prompt, transcript)
      : await callAnthropic(apiKey, agent.model, agent.system_prompt, transcript);

    if (!replyText) {
      console.warn("[ai-agent] resposta vazia do modelo — não enviando");
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "empty reply" }), { status: 200 });
    }

    console.log(`[ai-agent] resposta gerada (${replyText.length} chars)`);

    // 6. Send via Z-API or Meta
    if (conv.z_api_connection_id) {
      const { data: zapiConn } = await supabase
        .from("z_api_connections")
        .select("instance_id, token, client_token")
        .eq("id", conv.z_api_connection_id)
        .single();

      if (!zapiConn) throw new Error("Z-API connection not found");

      const { data: contact } = await supabase
        .from("inbox_contacts")
        .select("phone")
        .eq("id", conv.contact_id)
        .single();

      const instanceId  = zapiConn.instance_id as string;
      const token       = await decrypt(zapiConn.token as string);
      const clientToken = await decrypt(zapiConn.client_token as string);

      const zapiRes = await fetch(
        `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`,
        {
          method:  "POST",
          headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
          body:    JSON.stringify({ phone: contact?.phone, message: replyText }),
        }
      );

      const zapiBody = await zapiRes.json() as Record<string, unknown>;
      if (!zapiRes.ok) throw new Error(`Z-API error: ${JSON.stringify(zapiBody)}`);

      const wamid = (zapiBody.zaapId ?? zapiBody.messageId ?? null) as string | null;
      console.log(`[ai-agent] ✓ Z-API enviado wamid=${wamid}`);

      await saveAndUpdateConversation(conv.workspace_id, conversation_id, conv.contact_id, replyText, wamid, agent.id);

    } else if (conv.meta_connection_id) {
      const { data: conn } = await supabase
        .from("meta_connections")
        .select("phone_number_id, access_token")
        .eq("id", conv.meta_connection_id)
        .single();

      if (!conn) throw new Error("Meta connection not found");

      const { data: contact } = await supabase
        .from("inbox_contacts")
        .select("phone")
        .eq("id", conv.contact_id)
        .single();

      const accessToken = await decrypt(conn.access_token as string);

      const metaRes = await fetch(`${META_API}/${conn.phone_number_id}/messages`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
        body:    JSON.stringify({
          messaging_product: "whatsapp",
          to:   contact?.phone,
          type: "text",
          text: { body: replyText },
        }),
      });

      const metaBody = await metaRes.json() as Record<string, unknown>;
      if (!metaRes.ok) throw new Error(`Meta API error: ${JSON.stringify(metaBody)}`);

      const wamid = (metaBody.messages as Array<{ id: string }>)?.[0]?.id ?? null;
      console.log(`[ai-agent] ✓ Meta enviado wamid=${wamid}`);

      await saveAndUpdateConversation(conv.workspace_id, conversation_id, conv.contact_id, replyText, wamid, agent.id);

    } else {
      console.warn("[ai-agent] conversa sem conexão Z-API ou Meta");
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-agent] erro:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
