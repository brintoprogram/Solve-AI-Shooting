import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SYSTEM_PROMPT = `Você é um classificador de conversas de clientes que responderam a disparos de cobrança/marketing via WhatsApp.

Você receberá as MENSAGENS MAIS RECENTES da conversa (janela deslizante). As mensagens estão em ordem cronológica — as últimas são as mais recentes e têm MAIOR PESO na classificação.

IMPORTANTE: A classificação deve refletir o ESTADO ATUAL da conversa, não interações passadas isoladas. Se o cliente inicialmente reclamou de fraude ou não reconheceu a dívida, mas depois propôs data de pagamento, confirmou pagamento ou encerrou o conflito positivamente, classifique com base no posicionamento mais recente. Uma conversa que evoluiu positivamente deve ser classificada positivamente.

Retorne EXATAMENTE este JSON (sem markdown, sem explicação):
{"severity":"info|warning|critical","category":"fraude|valor_incorreto|nao_reconhece|ameaca|duvida|reclamacao|elogio|pagamento_confirmado|outros","summary":"resumo do ESTADO ATUAL da conversa em até 2 frases em português, focando na posição atual do cliente"}

Regras de severidade (baseadas no estado ATUAL, não no histórico):
- critical: cliente alega fraude ativamente, não reconhece a dívida, ameaça com advogado/Procon/órgão regulador, alega erro grave de valor — e não houve evolução positiva posterior
- warning: dúvida sobre o valor cobrado, pedido de parcelamento, reclamação sobre atendimento, pedido de mais informações, insatisfação sem resolução ainda
- info: pagamento confirmado, proposta de data de pagamento, agradecimento, situação resolvida ou em andamento positivo, resposta neutra`;

interface AnalyzeResult {
  severity: "info" | "warning" | "critical";
  category: string;
  summary:  string;
}

interface InboxMessage {
  direction:    "inbound" | "outbound";
  message_type: string;
  body:         string | null;
  created_at:   string;
}

// ── Audit log helper ─────────────────────────────────────────────
async function logAudit(
  workspaceId: string,
  eventType:   string,
  status:      "success" | "error" | "warning" | "info",
  entityId?:   string | null,
  error?:      string | null,
  metadata?:   Record<string, unknown>,
): Promise<void> {
  const { error: dbErr } = await supabase.from("audit_logs").insert({
    workspace_id: workspaceId,
    event_type:   eventType,
    entity_type:  "campaign_alert",
    entity_id:    entityId  ?? null,
    status,
    error:        error     ?? null,
    metadata:     metadata  ?? null,
  });
  if (dbErr) console.error("[audit] failed to write log:", dbErr.message);
}

// ── Workspace AI settings ────────────────────────────────────────
async function getWorkspaceAI(
  workspaceId: string,
): Promise<{ provider: "anthropic" | "openai"; apiKey: string }> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("ai_provider, anthropic_api_key, openai_api_key")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    console.warn("[analyze-reply] could not fetch workspace AI settings:", error.message, "— falling back to env vars");
  }

  const provider = (data?.ai_provider ?? "anthropic") as "anthropic" | "openai";
  const apiKey   = provider === "openai"
    ? (data?.openai_api_key    || Deno.env.get("OPENAI_API_KEY")    || "")
    : (data?.anthropic_api_key || Deno.env.get("ANTHROPIC_API_KEY") || "");

  return { provider, apiKey };
}

// ── Conversation transcript ──────────────────────────────────────
const TYPE_LABELS: Record<string, string> = {
  image:    "[Imagem]",
  audio:    "[Áudio]",
  video:    "[Vídeo]",
  document: "[Documento]",
  sticker:  "[Sticker]",
  location: "[Localização]",
  reaction: "[Reação]",
};

async function buildTranscript(
  conversationId: string,
  lastReplyText:  string,
): Promise<{ transcript: string; messageCount: number }> {
  // Sliding window: fetch the MOST RECENT messages (newest first), then reverse for chronological display.
  // This ensures long conversations don't obscure recent payment proposals or resolutions.
  const WINDOW_SIZE = 15;
  const { data, error } = await supabase
    .from("inbox_messages")
    .select("direction, message_type, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(WINDOW_SIZE);

  if (error || !data || data.length === 0) {
    if (error) console.warn("[analyze-reply] failed to fetch conversation history:", error.message);
    return { transcript: `Cliente: "${lastReplyText}"`, messageCount: 0 };
  }

  // Reverse to chronological order so the transcript reads oldest → newest
  const messages = (data as InboxMessage[]).reverse();
  const lines = messages.map((msg) => {
    const time   = new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const sender = msg.direction === "outbound" ? "Bot" : "Cliente";
    const text   = msg.body?.trim()
      ? msg.body.trim()
      : (TYPE_LABELS[msg.message_type] ?? "[Mensagem]");
    return `[${time}] ${sender}: ${text}`;
  });

  console.log(`[analyze-reply] built transcript with ${lines.length} most-recent messages from conversation ${conversationId}`);

  return {
    transcript:   lines.join("\n"),
    messageCount: lines.length,
  };
}

// ── AI classifiers ────────────────────────────────────────────────
function buildUserMessage(transcript: string, lastReply: string): string {
  return `Analise a conversa completa abaixo e classifique com base em TODO o contexto, especialmente nas intenções demonstradas ao longo da troca de mensagens.

=== CONVERSA ===
${transcript}
=== FIM ===

Última mensagem do cliente que trigou esta análise: "${lastReply}"`;
}

async function classifyWithAnthropic(apiKey: string, transcript: string, lastReply: string): Promise<AnalyzeResult> {
  console.log("[analyze-reply] calling Anthropic Claude Haiku");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: "user", content: buildUserMessage(transcript, lastReply) }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errBody}`);
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  const text = data.content?.[0]?.text ?? "{}";
  console.log("[analyze-reply] Anthropic raw response:", text);

  try {
    return JSON.parse(text) as AnalyzeResult;
  } catch {
    console.warn("[analyze-reply] failed to parse Anthropic JSON, using fallback");
    return { severity: "info", category: "outros", summary: lastReply.slice(0, 200) };
  }
}

async function classifyWithOpenAI(apiKey: string, transcript: string, lastReply: string): Promise<AnalyzeResult> {
  console.log("[analyze-reply] calling OpenAI GPT-4o mini");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:      "gpt-4o-mini",
      max_tokens: 300,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: buildUserMessage(transcript, lastReply) },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${errBody}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "{}";
  console.log("[analyze-reply] OpenAI raw response:", text);

  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned) as AnalyzeResult;
  } catch {
    console.warn("[analyze-reply] failed to parse OpenAI JSON, using fallback");
    return { severity: "info", category: "outros", summary: text.slice(0, 200) };
  }
}

// ── Main handler ─────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: {
    message_id:      string;
    workspace_id:    string;
    campaign_id:     string;
    conversation_id: string | null;
    reply_text:      string;
    recipient_phone: string;
    recipient_name?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const {
    message_id, workspace_id, campaign_id, conversation_id,
    reply_text, recipient_phone, recipient_name,
  } = body;

  if (!message_id || !workspace_id || !campaign_id || !reply_text) {
    console.error("[analyze-reply] missing required fields:", { message_id, workspace_id, campaign_id, reply_text: !!reply_text });
    return new Response("Missing required fields", { status: 400 });
  }

  console.log(`[analyze-reply] start — message=${message_id} campaign=${campaign_id} phone=${recipient_phone} conv=${conversation_id ?? "none"}`);

  // ── 1. Get workspace AI settings ───────────────────────────────
  const { provider, apiKey } = await getWorkspaceAI(workspace_id);
  console.log(`[analyze-reply] using provider=${provider}`);

  if (!apiKey) {
    const msg = `API key not configured for provider '${provider}'. Configure em Configurações → Inteligência Artificial.`;
    console.error("[analyze-reply]", msg);
    await logAudit(workspace_id, "analyze_reply_error", "error", message_id, msg, { provider, campaign_id, recipient_phone });
    return new Response(msg, { status: 500 });
  }

  // ── 2. Cooldown check — skip AI if analyzed within last 60 seconds ─
  // Prevents hammering the AI API when a customer sends rapid-fire messages.
  const COOLDOWN_SECONDS = 60;
  const { data: earlyExisting } = await supabase
    .from("campaign_alerts")
    .select("id, analyzed_at")
    .eq("message_id", message_id)
    .maybeSingle();

  if (earlyExisting?.analyzed_at) {
    const elapsed = (Date.now() - new Date(earlyExisting.analyzed_at).getTime()) / 1000;
    if (elapsed < COOLDOWN_SECONDS) {
      console.log(`[analyze-reply] cooldown — last analyzed ${Math.round(elapsed)}s ago (limit ${COOLDOWN_SECONDS}s), skipping`);
      await logAudit(workspace_id, "analyze_reply_skipped", "info", message_id, null, {
        reason: "cooldown", elapsed_seconds: Math.round(elapsed), cooldown_seconds: COOLDOWN_SECONDS,
      });
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "cooldown" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
  }

  // ── 4. Build conversation transcript ───────────────────────────
  let transcript   = `Cliente: "${reply_text}"`;
  let messageCount = 0;

  if (conversation_id) {
    const result = await buildTranscript(conversation_id, reply_text);
    transcript   = result.transcript;
    messageCount = result.messageCount;
  } else {
    console.log("[analyze-reply] no conversation_id — analyzing single message only");
  }

  // ── 5. Classify with AI ─────────────────────────────────────────
  let result: AnalyzeResult;
  try {
    result = provider === "openai"
      ? await classifyWithOpenAI(apiKey, transcript, reply_text)
      : await classifyWithAnthropic(apiKey, transcript, reply_text);

    console.log(`[analyze-reply] classified: severity=${result.severity} category=${result.category}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[analyze-reply] AI classification failed:", errMsg);
    await logAudit(workspace_id, "analyze_reply_error", "error", message_id, errMsg, {
      provider, campaign_id, recipient_phone,
      reply_text:   reply_text.slice(0, 200),
      transcript:   transcript.slice(0, 500),
    });
    return new Response(JSON.stringify({ error: errMsg }), { status: 500 });
  }

  // ── 6. Upsert alert (one per message_id, updated on every new reply) ──
  // If severity escalated (e.g. info → critical), read_at is reset so the
  // user sees it as unread again and gets notified.
  const { data: existing } = await supabase
    .from("campaign_alerts")
    .select("id, severity, analyzed_at")
    .eq("message_id", message_id)
    .maybeSingle();

  const severityRank: Record<string, number> = { info: 0, warning: 1, critical: 2 };
  const prevRank = existing ? (severityRank[existing.severity] ?? 0) : -1;
  const nextRank = severityRank[result.severity] ?? 0;
  const escalated   = existing ? nextRank > prevRank : false;
  const deescalated = existing ? nextRank < prevRank : false;

  let savedAlert: { id: string } | null = null;
  let alertErr: { message: string } | null = null;

  if (existing) {
    // Update — reset read_at on escalation (new problem) OR de-escalation (situation resolved)
    const patch: Record<string, unknown> = {
      reply_text,
      severity:    result.severity,
      category:    result.category,
      summary:     result.summary,
      analyzed_at: new Date().toISOString(),
    };
    if (escalated || deescalated) patch.read_at = null;

    const { data, error } = await supabase
      .from("campaign_alerts")
      .update(patch)
      .eq("id", existing.id)
      .select("id")
      .single();

    savedAlert = data;
    alertErr   = error;
    const changeNote = escalated ? " (escalated → unread)" : deescalated ? " (de-escalated → unread)" : "";
    if (!error) console.log(`[analyze-reply] ✓ alert updated id=${existing.id} severity=${result.severity}${changeNote}`);
  } else {
    // Insert new alert
    const { data, error } = await supabase
      .from("campaign_alerts")
      .insert({
        workspace_id,
        campaign_id,
        message_id,
        conversation_id: conversation_id ?? null,
        recipient_phone,
        recipient_name:  recipient_name ?? null,
        reply_text,
        severity:        result.severity,
        category:        result.category,
        summary:         result.summary,
        analyzed_at:     new Date().toISOString(),
      })
      .select("id")
      .single();

    savedAlert = data;
    alertErr   = error;
    if (!error) console.log(`[analyze-reply] ✓ alert created id=${data?.id} severity=${result.severity}`);
  }

  if (alertErr) {
    console.error("[analyze-reply] failed to save campaign_alert:", alertErr.message);
    await logAudit(workspace_id, "analyze_reply_error", "error", message_id,
      `DB upsert error: ${alertErr.message}`,
      { provider, campaign_id, severity: result.severity },
    );
  }

  // ── 7. Update shooting_messages → replied ───────────────────────
  const { error: msgErr } = await supabase
    .from("shooting_messages")
    .update({ status: "replied", replied_at: new Date().toISOString() })
    .eq("id", message_id);

  if (msgErr) {
    console.error("[analyze-reply] failed to update shooting_message status:", msgErr.message);
  } else {
    console.log(`[analyze-reply] ✓ shooting_message ${message_id} → replied`);
  }

  // ── 8. Write success audit log ──────────────────────────────────
  await logAudit(workspace_id, "analyze_reply_success", "success", message_id, null, {
    provider,
    model:          provider === "openai" ? "gpt-4o-mini" : "claude-haiku-4-5-20251001",
    severity:       result.severity,
    category:       result.category,
    message_count:  messageCount,
    campaign_id,
    recipient_phone,
    alert_id:       savedAlert?.id ?? null,
  });

  return new Response(
    JSON.stringify({ ok: true, severity: result.severity, category: result.category, alert_id: savedAlert?.id }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
