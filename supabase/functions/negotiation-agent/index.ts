// Supabase Edge Function — Negotiation Agent
// Server-to-server only (called from ai-agent-reply, analyze-reply, negotiation-portal,
// or a manual "Iniciar negociação" click in ConversationPanel.tsx). Never called by the client directly.
//
// Responsibilities:
//   1. Bootstrap a debt_negotiations row for a conversation if one doesn't exist yet.
//   2. Check escalation conditions IN CODE before ever calling the LLM (kill-switch,
//      max rounds, escalation keywords) — financial guardrails are never left to the model.
//   3. Ask the LLM for the next move: OFFER:{...} | ESCALATE:reason | HOLD:NONE.
//   4. Recompute discount%/installment amount in code and validate against negotiation_rules
//      before ever sending a number to the customer. The LLM's own arithmetic is never trusted.
//
// POST body:
//   conversation_id  string  — required
//   message_body     string? — latest inbound customer text, if this run was triggered by a message
//   invoice_id       string? — required only to bootstrap a brand-new negotiation
//   manual           boolean? — true when triggered by a staff "Iniciar negociação" click

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";
import { sendWhatsAppText } from "../_shared/whatsapp.ts";
import { isInternalCall, bearerToken } from "../_shared/auth.ts";
import { createLogger, requestIdFrom } from "../_shared/logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// SHA-256 hex digest — used to hash the CPF/CNPJ last digits for the portal token (one-way, never reversed).
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const META_API = "https://graph.facebook.com/v25.0";

// ── Rows ────────────────────────────────────────────────────────
interface ConvRow {
  id:                  string;
  workspace_id:        string;
  contact_id:          string;
  ai_agent_id:         string | null;
  z_api_connection_id: string | null;
  meta_connection_id:  string | null;
}

interface NegotiationRow {
  id:              string;
  workspace_id:    string;
  contact_id:      string;
  invoice_id:      string;
  conversation_id: string;
  status:          string;
  original_amount: number;
  offer_round:     number;
}

interface RulesRow {
  is_ai_negotiation_enabled: boolean;
  max_discount_pct:          number;
  max_installments:          number;
  min_installment_amount:    number;
  min_down_payment_pct:      number | null;
  max_negotiation_rounds:    number;
  auto_escalate_keywords:    string[];
  escalation_department_id:  string | null;
  portal_token_ttl_hours:    number;
}

const DEFAULT_RULES: RulesRow = {
  is_ai_negotiation_enabled: true,
  max_discount_pct:          20,
  max_installments:          6,
  min_installment_amount:    50,
  min_down_payment_pct:      null,
  max_negotiation_rounds:    3,
  auto_escalate_keywords:    ["advogado", "procon", "fraude", "processo"],
  escalation_department_id:  null,
  portal_token_ttl_hours:    48,
};

// ── Transcript (same shape as ai-agent-reply) ─────────────────────
interface RawMessage { direction: "inbound" | "outbound"; message_type: string; body: string | null; created_at: string }
const TYPE_LABELS: Record<string, string> = {
  image: "[Imagem]", audio: "[Áudio]", video: "[Vídeo]",
  document: "[Documento]", sticker: "[Sticker]", location: "[Localização]", reaction: "[Reação]",
};
function buildTranscript(messages: RawMessage[], fallback: string): string {
  const lines = [...messages].reverse().map((msg) => {
    const time   = new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const sender = msg.direction === "outbound" ? "Empresa" : "Cliente";
    const text   = msg.body?.trim() ? msg.body.trim() : (TYPE_LABELS[msg.message_type] ?? "[Mensagem]");
    return `[${time}] ${sender}: ${text}`;
  });
  return lines.join("\n") || `Cliente: "${fallback}"`;
}
async function fetchTranscript(conversationId: string, fallback: string): Promise<string> {
  const { data } = await supabase
    .from("inbox_messages")
    .select("direction, message_type, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);
  return buildTranscript((data ?? []) as RawMessage[], fallback);
}

// ── AI callers (same shape as ai-agent-reply) ─────────────────────
async function callAnthropic(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body:    JSON.stringify({ model, max_tokens: 1024, system: systemPrompt, messages: [{ role: "user", content: userMessage }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content?.[0]?.text?.trim() ?? "";
}
async function callOpenAI(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ model, max_tokens: 1024, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }] }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}
async function callAI(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<string> {
  return model.startsWith("gpt") ? callOpenAI(apiKey, model, systemPrompt, userMessage) : callAnthropic(apiKey, model, systemPrompt, userMessage);
}
async function getApiKey(workspaceId: string, model: string): Promise<string> {
  const { data: ws } = await supabase.from("workspaces").select("anthropic_api_key, openai_api_key").eq("id", workspaceId).maybeSingle();
  const isOpenAI = model.startsWith("gpt");
  const rawKey   = isOpenAI
    ? (ws?.openai_api_key    || Deno.env.get("OPENAI_API_KEY")    || "")
    : (ws?.anthropic_api_key || Deno.env.get("ANTHROPIC_API_KEY") || "");
  return await decrypt(rawKey);
}

// ── WhatsApp sender (same shape as ai-agent-reply) ────────────────
async function sendMessage(conv: ConvRow, text: string, sentByLabel: string): Promise<void> {
  await sendWhatsAppText(supabase, conv, text, sentByLabel, { logLabel: "negotiation-agent" });
}

// ── Rule validation — never trust the LLM's own arithmetic ────────
interface ProposedOffer { amount: number; installments: number; first_due_date: string | null }
type ValidationResult = { ok: true; discount_pct: number; installment_amount: number } | { ok: false; reason: string };

function validateOffer(rules: RulesRow, originalAmount: number, offer: ProposedOffer): ValidationResult {
  if (!Number.isFinite(offer.amount) || offer.amount < 0) return { ok: false, reason: "valor inválido" };
  if (offer.amount > originalAmount) return { ok: false, reason: "valor proposto maior que a dívida original" };
  if (!Number.isInteger(offer.installments) || offer.installments < 1) return { ok: false, reason: "número de parcelas inválido" };
  if (offer.installments > rules.max_installments) return { ok: false, reason: `parcelas acima do máximo permitido (${rules.max_installments}x)` };

  const discount_pct       = originalAmount > 0 ? ((originalAmount - offer.amount) / originalAmount) * 100 : 0;
  const installment_amount = offer.amount / offer.installments;

  if (discount_pct > rules.max_discount_pct + 0.01) {
    return { ok: false, reason: `desconto de ${discount_pct.toFixed(1)}% acima do máximo permitido (${rules.max_discount_pct}%)` };
  }
  if (installment_amount < rules.min_installment_amount - 0.01) {
    return { ok: false, reason: `parcela de R$ ${installment_amount.toFixed(2)} abaixo do mínimo permitido (R$ ${rules.min_installment_amount})` };
  }
  return { ok: true, discount_pct, installment_amount };
}

// ── Bootstrap / lookup ─────────────────────────────────────────────
async function ensureNegotiation(conv: ConvRow, invoiceId?: string): Promise<NegotiationRow | null> {
  const { data: existing } = await supabase
    .from("debt_negotiations")
    .select("*")
    .eq("conversation_id", conv.id)
    .not("status", "in", "(formalized,expired,cancelled)")
    .maybeSingle();
  if (existing) return existing as NegotiationRow;

  // No invoice_id given (e.g. AI-triage trigger) — pick the contact's most relevant open invoice.
  let invoice: { id: string; valor: number } | null = null;
  if (invoiceId) {
    const { data } = await supabase.from("contact_invoices").select("id, valor").eq("id", invoiceId).maybeSingle();
    invoice = data;
  } else {
    const { data } = await supabase
      .from("contact_invoices")
      .select("id, valor")
      .eq("contact_id", conv.contact_id)
      .in("status", ["pendente", "vencido"])
      .order("vencimento", { ascending: true })
      .limit(1)
      .maybeSingle();
    invoice = data;
  }
  if (!invoice) {
    console.log(`[negotiation-agent] contato ${conv.contact_id} não tem fatura pendente/vencida — nada a negociar`);
    return null;
  }

  const { data: created, error } = await supabase
    .from("debt_negotiations")
    .insert({
      workspace_id: conv.workspace_id, contact_id: conv.contact_id, invoice_id: invoice.id,
      conversation_id: conv.id, status: "triggered", original_amount: invoice.valor,
    })
    .select("*")
    .single();

  if (error) {
    // Unique-index race: another trigger created it milliseconds earlier — just fetch it.
    const { data: raced } = await supabase.from("debt_negotiations").select("*").eq("conversation_id", conv.id).maybeSingle();
    if (raced) return raced as NegotiationRow;
    console.error("[negotiation-agent] falha ao criar negociação:", error.message);
    return null;
  }
  console.log(`[negotiation-agent] ✓ negociação ${created.id} criada (fatura ${invoice.id}, valor original ${invoice.valor})`);
  return created as NegotiationRow;
}

async function getRules(workspaceId: string): Promise<RulesRow> {
  const { data } = await supabase.from("negotiation_rules").select("*").eq("workspace_id", workspaceId).maybeSingle();
  return (data as RulesRow | null) ?? DEFAULT_RULES;
}

// ── Escalation ──────────────────────────────────────────────────────
async function escalate(conv: ConvRow, negotiation: NegotiationRow, rules: RulesRow, reason: string): Promise<void> {
  console.log(`[negotiation-agent] ⚠ escalando negociação ${negotiation.id}: ${reason}`);

  await supabase.from("debt_negotiations").update({
    status: "escalated", escalation_reason: reason,
  }).eq("id", negotiation.id);

  await supabase.from("inbox_conversations").update({
    department_id: rules.escalation_department_id ?? undefined,
    assigned_to:   null, // put back in the shared queue for a human to claim
  }).eq("id", conv.id);

  await supabase.from("inbox_messages").insert({
    workspace_id: conv.workspace_id, conversation_id: conv.id, contact_id: conv.contact_id,
    direction: "outbound", message_type: "text",
    body: `[Negociação escalada para atendimento humano — motivo: ${reason}]`,
    is_internal: true, status: "sent", created_at: new Date().toISOString(),
  });

  try {
    await sendMessage(conv, "Vou te transferir para um dos nossos atendentes para continuar essa conversa com mais detalhes. Só um instante!", "negotiation-agent:escalation");
  } catch (e) {
    console.error("[negotiation-agent] falha ao enviar aviso de escalada:", e instanceof Error ? e.message : e);
  }
}

// ── Portal link ─────────────────────────────────────────────────────
async function sendPortalLink(conv: ConvRow, negotiation: NegotiationRow, rules: RulesRow): Promise<void> {
  const { data: contact } = await supabase.from("inbox_contacts").select("cpf_cnpj").eq("id", conv.contact_id).single();
  const cpfDigits = (contact?.cpf_cnpj ?? "").replace(/\D/g, "").slice(-4);
  if (cpfDigits.length < 4) {
    console.warn(`[negotiation-agent] contato ${conv.contact_id} sem CPF/CNPJ cadastrado — link do portal não pode ser gerado (verificação impossível)`);
    return;
  }

  const pepper = Deno.env.get("ENCRYPTION_KEY") ?? "";
  const hash   = await sha256Hex(`${pepper}:${cpfDigits}`);
  const expiresAt = new Date(Date.now() + rules.portal_token_ttl_hours * 3600_000).toISOString();

  const { data: tokenRow, error } = await supabase
    .from("negotiation_portal_tokens")
    .insert({ negotiation_id: negotiation.id, workspace_id: conv.workspace_id, cpf_last_digits_hash: hash, expires_at: expiresAt })
    .select("token")
    .single();

  if (error || !tokenRow) {
    console.error("[negotiation-agent] falha ao gerar token do portal:", error?.message);
    return;
  }

  const appUrl = Deno.env.get("APP_URL") ?? "https://system.solveai.consulting";
  const link   = `${appUrl}/negociacao/${tokenRow.token}`;

  try {
    await sendMessage(
      conv,
      `Para formalizar essa negociação, acesse o link abaixo e confirme os últimos 4 dígitos do seu CPF/CNPJ:\n${link}\n\n(Link válido por ${rules.portal_token_ttl_hours}h)`,
      "negotiation-agent:portal_link",
    );
  } catch (e) {
    console.error("[negotiation-agent] falha ao enviar link do portal:", e instanceof Error ? e.message : e);
  }
}

// ── LLM prompt & parsing ─────────────────────────────────────────────
function buildSystemPrompt(basePrompt: string, rules: RulesRow, negotiation: NegotiationRow, offersHistory: string): string {
  return `${basePrompt}

---
VOCÊ ESTÁ NEGOCIANDO UMA DÍVIDA EM ATRASO COM O CLIENTE.
Valor original da dívida: R$ ${negotiation.original_amount.toFixed(2)}

REGRAS RÍGIDAS — nunca proponha nada fora destes limites, mesmo se o cliente insistir:
- Desconto máximo sobre o valor original: ${rules.max_discount_pct}%
- Número máximo de parcelas: ${rules.max_installments}x
- Valor mínimo de cada parcela: R$ ${rules.min_installment_amount.toFixed(2)}

HISTÓRICO DE OFERTAS DESTA NEGOCIAÇÃO:
${offersHistory || "(nenhuma oferta feita ainda)"}

INSTRUÇÃO OBRIGATÓRIA: ao final da sua resposta, inclua exatamente UMA das linhas abaixo (a última linha da mensagem):
OFFER:{"amount":1234.56,"installments":3,"first_due_date":"2026-08-15"}  — quando você decidir propor/ajustar uma oferta concreta DENTRO das regras acima
ESCALATE:motivo em texto curto  — quando o cliente pedir algo fora das regras, recusar repetidamente, pedir para falar com um atendente humano, ou a negociação não estiver evoluindo
HOLD:NONE  — quando for só uma resposta conversacional, sem mudar a oferta atual (ex: tirando dúvida, ou aguardando o cliente responder a uma oferta já enviada)

O texto ANTES dessa linha final é exatamente o que será enviado ao cliente no WhatsApp. NUNCA mencione as palavras OFFER/ESCALATE/HOLD para o cliente — elas são só para o sistema.`;
}

function parseDirective(raw: string): { replyText: string; directive: "OFFER" | "ESCALATE" | "HOLD" | null; payload: string } {
  const markers = ["OFFER:", "ESCALATE:", "HOLD:"];
  let bestIdx = -1;
  let bestMarker = "";
  for (const m of markers) {
    const idx = raw.lastIndexOf(m);
    if (idx > bestIdx) { bestIdx = idx; bestMarker = m; }
  }
  if (bestIdx === -1) return { replyText: raw.trim(), directive: null, payload: "" };

  const replyText = raw.slice(0, bestIdx).trim();
  const payload    = raw.slice(bestIdx + bestMarker.length).split("\n")[0].trim();
  const directive  = bestMarker.slice(0, -1) as "OFFER" | "ESCALATE" | "HOLD";
  return { replyText, directive, payload };
}

async function formatOffersHistory(negotiationId: string): Promise<string> {
  const { data } = await supabase
    .from("negotiation_offers")
    .select("round, proposed_by, offer_amount, installments, status, created_at")
    .eq("negotiation_id", negotiationId)
    .order("round", { ascending: true });
  if (!data || data.length === 0) return "";
  return data.map((o) =>
    `Rodada ${o.round} — ${o.proposed_by}: R$ ${Number(o.offer_amount).toFixed(2)} em ${o.installments}x [${o.status}]`
  ).join("\n");
}

// ── Auth ─────────────────────────────────────────────────────────
// Dois chamadores legítimos, ambos precisam ser validados porque a função está
// publicada com verify_jwt=false (senão qualquer um com um conversation_id
// dispararia propostas por WhatsApp e consumiria créditos de LLM):
//   1. server-to-server (ai-agent-reply, analyze-reply, negotiation-portal) → service role key
//   2. staff clicando em "Iniciar negociação" no Inbox → JWT do usuário + membership no workspace

// ── Main handler ───────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const log = createLogger("negotiation-agent", { request_id: requestIdFrom(req) });

  // Chamada de usuário: precisa de um JWT válido já aqui; a checagem de
  // membership no workspace acontece depois, quando a conversa for carregada.
  let callerUserId: string | null = null;
  if (!isInternalCall(req)) {
    const bearer = bearerToken(req);
    if (!bearer) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(bearer);
    if (authErr || !user) {
      log.warn("auth_rejected", { reason: "invalid_jwt" });
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    callerUserId = user.id;
  }

  let body: { conversation_id: string; message_body?: string; invoice_id?: string; manual?: boolean };
  try { body = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const { conversation_id, message_body = "", invoice_id } = body;
  if (!conversation_id) return new Response("conversation_id required", { status: 400 });

  try {
    const { data: conv, error: convErr } = await supabase
      .from("inbox_conversations")
      .select("id, workspace_id, contact_id, ai_agent_id, z_api_connection_id, meta_connection_id")
      .eq("id", conversation_id)
      .single();

    if (convErr || !conv) {
      console.error("[negotiation-agent] conversa não encontrada:", convErr?.message);
      return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
    }

    // Usuário só pode agir sobre conversas do workspace ao qual pertence.
    // Impede que um atendente de outro tenant inicie negociações aqui.
    if (callerUserId) {
      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", callerUserId)
        .eq("workspace_id", conv.workspace_id)
        .maybeSingle();

      if (!membership) {
        console.warn(`[negotiation-agent] usuário ${callerUserId} sem acesso ao workspace ${conv.workspace_id}`);
        return new Response(JSON.stringify({ error: "Sem permissão neste workspace" }), { status: 403 });
      }
    }

    const negotiation = await ensureNegotiation(conv as ConvRow, invoice_id);
    if (!negotiation) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no_open_invoice" }), { status: 200 });
    }

    if (negotiation.status === "escalated" || negotiation.status === "human_negotiating") {
      console.log(`[negotiation-agent] negociação ${negotiation.id} já está com humano — ignorando`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_escalated" }), { status: 200 });
    }
    if (negotiation.status === "formalized") {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_formalized" }), { status: 200 });
    }

    const rules = await getRules(conv.workspace_id);

    // ── Code-level escalation checks — run BEFORE ever calling the LLM ──
    if (!rules.is_ai_negotiation_enabled) {
      await escalate(conv as ConvRow, negotiation, rules, "IA de negociação desativada para este workspace");
      return new Response(JSON.stringify({ ok: true, escalated: true }), { status: 200 });
    }
    if (negotiation.offer_round >= rules.max_negotiation_rounds) {
      await escalate(conv as ConvRow, negotiation, rules, `limite de ${rules.max_negotiation_rounds} rodadas de proposta atingido`);
      return new Response(JSON.stringify({ ok: true, escalated: true }), { status: 200 });
    }
    const lowerMsg = message_body.toLowerCase();
    const hitKeyword = rules.auto_escalate_keywords.find((kw) => kw && lowerMsg.includes(kw.toLowerCase()));
    if (hitKeyword) {
      await escalate(conv as ConvRow, negotiation, rules, `palavra-chave de escalada detectada: "${hitKeyword}"`);
      return new Response(JSON.stringify({ ok: true, escalated: true }), { status: 200 });
    }

    // ── Resolve which ai_agents persona/model to speak as ──────────
    let basePrompt = "Você é um atendente cordial e objetivo de uma empresa, negociando uma dívida em atraso via WhatsApp.";
    let model       = "claude-haiku-4-5-20251001";
    let agentId: string | null = null;
    if (conv.ai_agent_id) {
      const { data: agent } = await supabase.from("ai_agents").select("id, system_prompt, model, is_active").eq("id", conv.ai_agent_id).maybeSingle();
      if (agent?.is_active) { basePrompt = agent.system_prompt as string; model = agent.model as string; agentId = agent.id as string; }
    }

    const apiKey = await getApiKey(conv.workspace_id, model);
    if (!apiKey) { console.error("[negotiation-agent] API key não configurada"); return new Response(JSON.stringify({ ok: false, error: "no_api_key" }), { status: 200 }); }

    const [transcript, offersHistory] = await Promise.all([
      fetchTranscript(conversation_id, message_body),
      formatOffersHistory(negotiation.id),
    ]);
    const systemPrompt = buildSystemPrompt(basePrompt, rules, negotiation, offersHistory);

    let raw = await callAI(apiKey, model, systemPrompt, transcript);
    let { replyText, directive, payload } = parseDirective(raw);

    if (directive === "OFFER") {
      let proposed: ProposedOffer;
      try { proposed = JSON.parse(payload); } catch { proposed = { amount: NaN, installments: 0, first_due_date: null }; }

      let validation = validateOffer(rules, negotiation.original_amount, proposed);

      if (!validation.ok) {
        console.warn(`[negotiation-agent] oferta inválida (${validation.reason}) — tentando 1 auto-correção`);
        const correctionPrompt = `${transcript}\n\n[SISTEMA] Sua última proposta violou uma regra: ${validation.reason}. Gere uma nova resposta e uma nova linha OFFER dentro dos limites definidos, ou ESCALATE se não for possível atender o cliente dentro das regras.`;
        raw = await callAI(apiKey, model, systemPrompt, correctionPrompt);
        ({ replyText, directive, payload } = parseDirective(raw));

        if (directive === "OFFER") {
          try { proposed = JSON.parse(payload); } catch { proposed = { amount: NaN, installments: 0, first_due_date: null }; }
          validation = validateOffer(rules, negotiation.original_amount, proposed);
        } else {
          validation = { ok: false, reason: "sem nova oferta após correção" };
        }

        if (!validation.ok) {
          await escalate(conv as ConvRow, negotiation, rules, `oferta gerada pela IA fora das regras: ${validation.reason}`);
          return new Response(JSON.stringify({ ok: true, escalated: true }), { status: 200 });
        }
      }

      // Valid offer — persist, bump round, send to customer.
      const round = negotiation.offer_round + 1;
      await supabase.from("negotiation_offers")
        .update({ status: "superseded" })
        .eq("negotiation_id", negotiation.id).eq("proposed_by", "ai").eq("status", "pending");

      await supabase.from("negotiation_offers").insert({
        negotiation_id: negotiation.id, workspace_id: conv.workspace_id, round,
        proposed_by: "ai", proposed_by_agent_id: agentId,
        offer_amount: proposed.amount, discount_pct: validation.discount_pct,
        installments: proposed.installments, installment_amount: validation.installment_amount,
        first_due_date: proposed.first_due_date ?? null, status: "pending",
        rule_snapshot: rules,
      });

      const wasFirstOffer = negotiation.offer_round === 0;
      await supabase.from("debt_negotiations").update({
        status: "awaiting_customer", offer_round: round,
      }).eq("id", negotiation.id);

      if (replyText) await sendMessage(conv as ConvRow, replyText, agentId ? `ai_agent:${agentId}` : "negotiation-agent");
      if (wasFirstOffer) await sendPortalLink(conv as ConvRow, negotiation, rules);

      return new Response(JSON.stringify({ ok: true, action: "offer", round }), { status: 200 });
    }

    if (directive === "ESCALATE") {
      await escalate(conv as ConvRow, negotiation, rules, payload || "IA decidiu escalar a negociação");
      return new Response(JSON.stringify({ ok: true, escalated: true }), { status: 200 });
    }

    // HOLD or unparseable directive — just send the conversational reply, no state change.
    if (replyText) await sendMessage(conv as ConvRow, replyText, agentId ? `ai_agent:${agentId}` : "negotiation-agent");
    return new Response(JSON.stringify({ ok: true, action: "hold" }), { status: 200 });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.fatal("unhandled_error", { err: msg });
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
