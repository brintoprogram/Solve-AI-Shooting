// Supabase Edge Function — AI Agent Reply
// Called fire-and-forget from z-api-webhook and meta-webhook on inbound messages.
//
// Two execution paths:
//   A) conversation.ai_agent_id IS NULL → run triage agent (if active) to route to correct dept
//   B) conversation.ai_agent_id IS SET  → run department agent and send reply to client

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";
import { sendWhatsAppText } from "../_shared/whatsapp.ts";
import { isInternalCall } from "../_shared/auth.ts";
import { createLogger, requestIdFrom } from "../_shared/logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const META_API = "https://graph.facebook.com/v25.0";

// Freios de custo, ajustaveis por secret sem novo deploy.
// Cooldown: segundos minimos entre duas respostas da IA na MESMA conversa.
const AI_REPLY_COOLDOWN_SECONDS = Number(Deno.env.get("AI_REPLY_COOLDOWN_SECONDS") ?? "8");
// Teto por conversa por hora: rede de seguranca contra loop ou flood.
const AI_REPLY_MAX_PER_HOUR     = Number(Deno.env.get("AI_REPLY_MAX_PER_HOUR") ?? "30");

// ── Rastro das decisoes ──────────────────────────────────────────────
// As decisoes de roteamento existiam so em console.log, que ninguem fora do
// painel do Supabase enxerga. Os dois casos de falha mais comuns (setor
// inexistente, setor sem agente ativo) eram silenciosos: o agente
// simplesmente nao roteava, sem dizer por que.
//
// So grava para conversa de simulacao. Em conversa real seria uma escrita por
// mensagem recebida, sem ninguem para ler.
async function rastro(
  conv: { workspace_id: string; is_simulation?: boolean | null },
  conversationId: string,
  step: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  if (!conv.is_simulation) return;
  const { error } = await supabase.from("agent_trace_events").insert({
    workspace_id:    conv.workspace_id,
    conversation_id: conversationId,
    step,
    detail,
  });
  // Falha de rastro nao pode derrubar o atendimento: e diagnostico, nao fluxo.
  if (error) console.error(JSON.stringify({ level: "error", event: "trace_insert_failed", err: error.message }));
}

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
  is_simulation:       boolean | null;
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
  return await decrypt(rawKey);
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
  // onMissingConnection "skip" preserva o comportamento legado: conversa sem
  // conexão grava a mensagem em vez de estourar erro.
  await sendWhatsAppText(
    supabase,
    { ...conv, id: conversationId },
    text,
    `ai_agent:${agentId}`,
    { onMissingConnection: "skip", logLabel: label },
  );
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
    await rastro(conv, conversationId, "triagem_sem_agente", {
      dica: "Nenhum agente com 'is_triage' e 'is_active' neste workspace. Crie um em Agentes e marque como triagem.",
    });
    return;
  }

  console.log(`[triage] agente "${triageAgent.name}" processando conversa ${conversationId}`);

  const apiKey = await getApiKey(conv.workspace_id, triageAgent.model as string);
  if (!apiKey) {
    console.error("[triage] API key não configurada");
    await rastro(conv, conversationId, "sem_chave_de_ia", {
      modelo: triageAgent.model,
      dica: "Configure a chave do provedor em Configurações → IA.",
    });
    return;
  }

  const transcript  = await fetchTranscript(conversationId, messageBody);
  const systemPrompt = (triageAgent.system_prompt as string) + ROUTING_INSTRUCTION;

  const rawResponse = await callAI(apiKey, triageAgent.model as string, systemPrompt, transcript);
  // A resposta do LLM contém a conversa do cliente — logar só o tamanho.
  console.log(`[triage] resposta recebida (${rawResponse.length} chars)`);

  // Parse ROUTE: from the LAST occurrence (in case the prompt itself contains the word)
  await rastro(conv, conversationId, "triagem_respondeu", {
    agente: triageAgent.name,
    modelo: triageAgent.model,
    resposta_bruta: rawResponse,
  });

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
    await rastro(conv, conversationId, "sem_roteamento", {
      motivo: routeIdx === -1
        ? "O modelo não incluiu a linha ROUTE:. Reforce a instrução no prompt do agente."
        : "ROUTE:NONE — a triagem quer mais informação antes de decidir o setor.",
    });
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
    const { data: existentes } = await supabase
      .from("departments").select("name").eq("workspace_id", conv.workspace_id);
    await rastro(conv, conversationId, "setor_nao_encontrado", {
      setor_pedido: routeValue,
      setores_existentes: (existentes ?? []).map((d) => d.name),
      dica: "O prompt da triagem cita um setor que não existe. Crie o setor ou corrija o nome no prompt.",
    });
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
    await rastro(conv, conversationId, "setor_sem_agente", {
      setor: dept.name,
      dica: "O setor existe mas não tem agente ativo. Crie um agente para ele e marque como ativo.",
    });
    return;
  }

  await supabase
    .from("inbox_conversations")
    .update({ ai_agent_id: deptAgent.id, updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  console.log(`[triage] ✓ conversa ${conversationId} → agente "${deptAgent.name}" (setor ${dept.name})`);
  await rastro(conv, conversationId, "roteado", { setor: dept.name, agente: deptAgent.name });
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
// ── Auth: somente chamadas server-to-server ──────────────────
// Esta função é invocada apenas pelo meta-webhook e pelo z-api-webhook, que
// enviam a service role key automaticamente via supabase.functions.invoke().
// Como está publicada com verify_jwt=false, sem esta checagem qualquer pessoa
// que descubra um conversation_id conseguiria disparar respostas de IA para
// clientes reais e consumir créditos de LLM.

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  if (!isInternalCall(req)) {
    console.warn("[ai-agent] chamada não autorizada rejeitada");
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // Herda o request_id de quem chamou (meta-webhook/z-api-webhook) para que a
  // jornada da mensagem seja rastreável entre os deployments.
  const log = createLogger("ai-agent-reply", { request_id: requestIdFrom(req) });

  let body: { conversation_id: string; message_body?: string };
  try { body = await req.json(); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const { conversation_id, message_body = "" } = body;
  if (!conversation_id) return new Response("conversation_id required", { status: 400 });

  try {
    const { data: conv, error: convErr } = await supabase
      .from("inbox_conversations")
      .select("ai_agent_id, workspace_id, contact_id, z_api_connection_id, meta_connection_id, is_simulation")
      .eq("id", conversation_id)
      .single();

    if (convErr || !conv) {
      console.error("[ai-agent] conversa não encontrada:", convErr?.message);
      return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
    }

    // ── Negotiation guard ─────────────────────────────────────────
    // A negociação de dívida escalada para humano PAUSA a IA nesta conversa.
    // Sem isso, a próxima mensagem do cliente cairia em handleTriage() logo abaixo
    // e poderia re-rotear a conversa de volta pra IA, revertendo a escalada em silêncio.
    const { data: activeNeg } = await supabase
      .from("debt_negotiations")
      .select("id, status")
      .eq("conversation_id", conversation_id)
      .in("status", ["escalated", "human_negotiating"])
      .maybeSingle();

    if (activeNeg) {
      log.info("ai_paused_negotiation_escalated", { conversation_id, negotiation_id: activeNeg.id, status: activeNeg.status });
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "negotiation_escalated" }), { status: 200 });
    }

    // ── Proteção de custo ────────────────────────────────────────
    // Cada mensagem recebida virava UMA chamada de LLM, sem qualquer freio.
    // Um cliente irritado (ou um bot) mandando 500 mensagens gerava 500
    // chamadas pagas — e, a partir de out/2026, 500 respostas cobradas
    // também pela Meta.
    //
    // Os dois limites saem do próprio inbox_messages: não precisa de tabela
    // nova e o dado é a verdade do que já foi respondido.
    const { data: recentReplies } = await supabase
      .from("inbox_messages")
      .select("created_at")
      .eq("conversation_id", conversation_id)
      .eq("direction", "outbound")
      .like("sent_by", "ai_agent:%")
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString())
      .order("created_at", { ascending: false });

    const replies = recentReplies ?? [];

    // 1) Cooldown: agrupa rajadas. Quem manda 3 mensagens seguidas recebe uma
    //    resposta só, que já enxerga as três no transcript.
    if (replies.length > 0) {
      const secondsSinceLast = (Date.now() - new Date(replies[0].created_at as string).getTime()) / 1000;
      if (secondsSinceLast < AI_REPLY_COOLDOWN_SECONDS) {
        log.info("ai_reply_cooldown", { conversation_id, seconds_since_last: Math.round(secondsSinceLast) });
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "cooldown" }), { status: 200 });
      }
    }

    // 2) Teto por hora: rede de segurança contra loop ou flood sustentado.
    if (replies.length >= AI_REPLY_MAX_PER_HOUR) {
      log.warn("ai_reply_hourly_cap", { conversation_id, replies_last_hour: replies.length });
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "hourly_cap" }), { status: 200 });
    }

    // Negociação ativa (proposta em andamento) → delega para o motor de negociação
    // em vez do handleAgentReply genérico, para respeitar as regras de desconto/parcelas.
    const { data: openNeg } = await supabase
      .from("debt_negotiations")
      .select("id")
      .eq("conversation_id", conversation_id)
      .in("status", ["triggered", "ai_negotiating", "awaiting_customer"])
      .maybeSingle();

    if (openNeg) {
      log.info("delegating_to_negotiation_agent", { conversation_id, negotiation_id: openNeg.id });
      const { error: negErr } = await supabase.functions.invoke("negotiation-agent", {
        body: { conversation_id, message_body },
        headers: { "x-request-id": log.ctx.request_id! },
      });
      if (negErr) log.error("negotiation_dispatch_failed", { conversation_id, err: negErr.message });
      return new Response(JSON.stringify({ ok: true, delegated: "negotiation-agent" }), { status: 200 });
    }

    if (conv.ai_agent_id) {
      await handleAgentReply(conv as ConvRow, conversation_id, message_body);
    } else {
      await handleTriage(conv as ConvRow, conversation_id, message_body);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.fatal("unhandled_error", { err: msg });
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
