// Supabase Edge Function — AI Agent Reply
// Called fire-and-forget from z-api-webhook and meta-webhook on inbound messages.
//
// Two execution paths:
//   A) conversation.ai_agent_id IS NULL → run triage agent (if active) to route to correct dept
//   B) conversation.ai_agent_id IS SET  → run department agent and send reply to client

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── AES-256-GCM decrypt (inlined) ───────────────────────────
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
  const col  = rest.indexOf(":");
  if (col === -1) throw new Error("Invalid encrypted token format");
  const iv  = hexToBytes(rest.slice(0, col));
  const ct  = Uint8Array.from(atob(rest.slice(col + 1)), (c) => c.charCodeAt(0));
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
  direction:    "inbound" | "outbound";
  message_type: string;
  body:         string | null;
  created_at:   string;
}

interface ConvRow {
  ai_agent_id:         string | null;
  workspace_id:        string;
  contact_id:          string;
  z_api_connection_id: string | null;
  meta_connection_id:  string | null;
}

// ── Transcript builder ───────────────────────────────────────
function buildTranscript(messages: RawMessage[], newMessage: string): string {
  const lines = [...messages].reverse().map((msg) => {
    const time   = new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const sender = msg.direction === "outbound" ? "Agente" : "Cliente";
    const text   = msg.body?.trim() ? msg.body.trim() : (TYPE_LABELS[msg.message_type] ?? "[Mensagem]");
    return `[${time}] ${sender}: ${text}`;
  });
  return lines.join("\n") || `Cliente: "${newMessage}"`;
}

// ── AI callers ───────────────────────────────────────────────
async function callAnthropic(apiKey: string, model: string, systemPrompt: string, transcript: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body:    JSON.stringify({ model, max_tokens: 1024, system: systemPrompt, messages: [{ role: "user", content: transcript }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content?.[0]?.text?.trim() ?? "";
}

async function callOpenAI(apiKey: string, model: string, systemPrompt: string, transcript: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({
      model, max_tokens: 1024,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: transcript }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function callAI(apiKey: string, model: string, systemPrompt: string, transcript: string): Promise<string> {
  return model.startsWith("gpt")
    ? callOpenAI(apiKey, model, systemPrompt, transcript)
    : callAnthropic(apiKey, model, systemPrompt, transcript);
}

// ── Workspace AI keys ────────────────────────────────────────
async function getApiKey(workspaceId: string, model: string): Promise<string> {
  const { data: ws } = await supabase
    .from("workspaces")
    .select("anthropic_api_key, openai_api_key")
    .eq("id", workspaceId)
    .maybeSingle();

  const isOpenAI = model.startsWith("gpt");
  const rawKey   = isOpenAI
    ? (ws?.openai_api_key    || Deno.env.get("OPENAI_API_KEY")    || "")
    : (ws?.anthropic_api_key || Deno.env.get("ANTHROPIC_API_KEY") || "");
  return rawKey.startsWith(ENC_PREFIX) ? await decrypt(rawKey) : rawKey;
}

// ── Transcript fetch ─────────────────────────────────────────
async function fetchTranscript(conversationId: string, fallback: string): Promise<string> {
  const { data } = await supabase
    .from("inbox_messages")
    .select("direction, message_type, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);
  return buildTranscript((data ?? []) as RawMessage[], fallback);
}

// ── Message sender (Z-API or Meta) ──────────────────────────
async function sendMessage(
  conv:           ConvRow,
  conversationId: string,
  text:           string,
  agentId:        string,
  label:          string,
): Promise<void> {
  const now = new Date().toISOString();
  let wamid: string | null = null;

  if (conv.z_api_connection_id) {
    const { data: zapiConn } = await supabase
      .from("z_api_connections")
      .select("instance_id, token, client_token")
      .eq("id", conv.z_api_connection_id)
      .single();
    if (!zapiConn) throw new Error("Z-API connection not found");

    const { data: contact } = await supabase
      .from("inbox_contacts").select("phone").eq("id", conv.contact_id).single();

    const instanceId  = zapiConn.instance_id as string;
    const token       = await decrypt(zapiConn.token as string);
    const clientToken = await decrypt(zapiConn.client_token as string);

    const res = await fetch(
      `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`,
      { method: "POST", headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: contact?.phone, message: text }) },
    );
    const resBody = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(`Z-API error: ${JSON.stringify(resBody)}`);
    wamid = (resBody.zaapId ?? resBody.messageId ?? null) as string | null;

  } else if (conv.meta_connection_id) {
    const { data: conn } = await supabase
      .from("meta_connections").select("phone_number_id, access_token").eq("id", conv.meta_connection_id).single();
    if (!conn) throw new Error("Meta connection not found");

    const { data: contact } = await supabase
      .from("inbox_contacts").select("phone").eq("id", conv.contact_id).single();

    const accessToken = await decrypt(conn.access_token as string);
    const res = await fetch(`${META_API}/${conn.phone_number_id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: contact?.phone, type: "text", text: { body: text } }),
    });
    const metaBody = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(`Meta API error: ${JSON.stringify(metaBody)}`);
    wamid = (metaBody.messages as Array<{ id: string }>)?.[0]?.id ?? null;
  }

  console.log(`[${label}] ✓ enviado wamid=${wamid}`);

  await supabase.from("inbox_messages").insert({
    workspace_id:    conv.workspace_id,
    conversation_id: conversationId,
    contact_id:      conv.contact_id,
    wamid,
    direction:    "outbound",
    message_type: "text",
    body:         text,
    sent_by:      `ai_agent:${agentId}`,
    is_internal:  false,
    status:       "sent",
    created_at:   now,
  });

  await supabase.from("inbox_conversations").update({
    last_message_at:        now,
    last_message_body:      text,
    last_message_direction: "outbound",
    updated_at:             now,
  }).eq("id", conversationId);
}

// ── Triage routing instruction injected into system prompt ───
const ROUTING_INSTRUCTION = `

---
INSTRUÇÃO DE ROTEAMENTO (obrigatória):
Ao final de CADA resposta inclua exatamente uma das seguintes linhas:
ROUTE:NomeDoSetor  — quando souber para qual setor direcionar o cliente
ROUTE:NONE         — quando ainda precisar de mais informações do cliente
O texto antes da linha ROUTE: será enviado ao cliente. A linha ROUTE: nunca é enviada.`;

// ── Triage handler ───────────────────────────────────────────
async function handleTriage(
  conv:          ConvRow,
  conversationId: string,
  messageBody:   string,
): Promise<void> {
  // Find active triage agent
  const { data: triageAgent } = await supabase
    .from("ai_agents")
    .select("id, name, system_prompt, model, is_active")
    .eq("workspace_id", conv.workspace_id)
    .eq("is_triage", true)
    .eq("is_active", true)
    .maybeSingle();

  if (!triageAgent) {
    console.log("[triage] nenhum agente de triagem ativo — ignorando");
    return;
  }

  console.log(`[triage] agente "${triageAgent.name}" processando conversa ${conversationId}`);

  const apiKey = await getApiKey(conv.workspace_id, triageAgent.model as string);
  if (!apiKey) { console.error("[triage] API key não configurada"); return; }

  const transcript  = await fetchTranscript(conversationId, messageBody);
  const systemPrompt = (triageAgent.system_prompt as string) + ROUTING_INSTRUCTION;

  const rawResponse = await callAI(apiKey, triageAgent.model as string, systemPrompt, transcript);
  console.log(`[triage] resposta bruta: ${rawResponse.slice(0, 200)}`);

  // Parse ROUTE: from the LAST occurrence (in case the prompt itself contains the word)
  const routeIdx = rawResponse.lastIndexOf("ROUTE:");
  let replyText  = rawResponse.trim();
  let routeValue = "NONE";

  if (routeIdx !== -1) {
    replyText  = rawResponse.slice(0, routeIdx).trim();
    routeValue = rawResponse.slice(routeIdx + 6).split("\n")[0].trim().toUpperCase();
  }

  // Send reply to client if triage agent produced one
  if (replyText) {
    console.log(`[triage] enviando resposta ao cliente (${replyText.length} chars)`);
    try {
      await sendMessage(conv, conversationId, replyText, triageAgent.id as string, "triage");
    } catch (e) {
      console.error("[triage] erro ao enviar resposta:", e instanceof Error ? e.message : e);
    }
  }

  // Route to department if decided
  if (!routeValue || routeValue === "NONE") {
    console.log("[triage] ROUTE:NONE — aguardando mais informações do cliente");
    return;
  }

  console.log(`[triage] roteando para setor: "${routeValue}"`);

  // Find department by name (case-insensitive)
  const { data: dept } = await supabase
    .from("departments")
    .select("id, name")
    .eq("workspace_id", conv.workspace_id)
    .ilike("name", routeValue)
    .maybeSingle();

  if (!dept) {
    console.warn(`[triage] setor "${routeValue}" não encontrado — sem roteamento`);
    return;
  }

  // Find active agent for that department
  const { data: deptAgent } = await supabase
    .from("ai_agents")
    .select("id, name")
    .eq("workspace_id", conv.workspace_id)
    .eq("department_id", dept.id)
    .eq("is_active", true)
    .eq("is_triage", false)
    .limit(1)
    .maybeSingle();

  if (!deptAgent) {
    console.warn(`[triage] nenhum agente ativo para o setor "${dept.name}" — sem roteamento`);
    return;
  }

  await supabase
    .from("inbox_conversations")
    .update({ ai_agent_id: deptAgent.id, updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  console.log(`[triage] ✓ conversa ${conversationId} → agente "${deptAgent.name}" (setor ${dept.name})`);
}

// ── Department agent handler ─────────────────────────────────
async function handleAgentReply(
  conv:           ConvRow,
  conversationId: string,
  messageBody:    string,
): Promise<void> {
  const { data: agent } = await supabase
    .from("ai_agents")
    .select("id, name, system_prompt, model, is_active")
    .eq("id", conv.ai_agent_id!)
    .single();

  if (!agent?.is_active) {
    console.log(`[agent] agente ${conv.ai_agent_id} inativo — ignorando`);
    return;
  }

  console.log(`[agent] "${agent.name}" (${agent.model}) → conversa ${conversationId}`);

  const apiKey = await getApiKey(conv.workspace_id, agent.model as string);
  if (!apiKey) { console.error("[agent] API key não configurada"); return; }

  const transcript = await fetchTranscript(conversationId, messageBody);
  const replyText  = await callAI(apiKey, agent.model as string, agent.system_prompt as string, transcript);

  if (!replyText) { console.warn("[agent] resposta vazia — não enviando"); return; }

  await sendMessage(conv, conversationId, replyText, agent.id as string, "agent");
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: { conversation_id: string; message_body?: string };
  try { body = await req.json(); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const { conversation_id, message_body = "" } = body;
  if (!conversation_id) return new Response("conversation_id required", { status: 400 });

  try {
    const { data: conv, error: convErr } = await supabase
      .from("inbox_conversations")
      .select("ai_agent_id, workspace_id, contact_id, z_api_connection_id, meta_connection_id")
      .eq("id", conversation_id)
      .single();

    if (convErr || !conv) {
      console.error("[ai-agent] conversa não encontrada:", convErr?.message);
      return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
    }

    if (conv.ai_agent_id) {
      await handleAgentReply(conv as ConvRow, conversation_id, message_body);
    } else {
      await handleTriage(conv as ConvRow, conversation_id, message_body);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-agent] erro:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
