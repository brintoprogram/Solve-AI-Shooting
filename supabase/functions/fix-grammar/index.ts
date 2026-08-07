// Supabase Edge Function — Fix Grammar
//
// Corrige gramática do texto que o atendente está digitando no Inbox.
//
// Esta função chama a OpenAI com a chave DA CASA, então cada requisição custa
// dinheiro. Antes ela era pública, sem autenticação, sem rate limit e sem
// limite de tamanho de entrada: qualquer pessoa na internet podia mandar
// megabytes de texto em loop e gerar uma fatura arbitrária. Só não virou
// prejuízo porque a chave estava com valor de placeholder.
//
// Agora: exige sessão de usuário, limita o tamanho do texto e aplica um teto
// por usuário por minuto.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";
import { bearerToken } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/ratelimit.ts";
import { consumirCredito, mensagemSemCredito } from "../_shared/credits.ts";
import { createLogger, requestIdFrom } from "../_shared/logger.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

// Uma mensagem de WhatsApp cabe folgadamente em 5 mil caracteres. O limite
// existe para o custo por chamada ser previsível.
const MAX_CHARS = 5_000;
// Revisar texto é ação manual: 20 por minuto já é muito mais que o uso real.
const LIMIT_PER_MINUTE = 20;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  const CORS = getCors(req);
  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const log = createLogger("fix-grammar", { request_id: requestIdFrom(req) });

  // ── Autenticação ────────────────────────────────────────────────
  // Chamada pelo MessageInput via supabase.functions.invoke, que já envia o
  // JWT da sessão — não é preciso mudar nada no frontend.
  const token = bearerToken(req);
  if (!token) return json({ error: "Não autorizado" }, 401);

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    log.warn("auth_rejected");
    return json({ error: "Sessão inválida. Entre novamente." }, 401);
  }

  const ulog = log.child({ user_id: user.id });

  if (!OPENAI_API_KEY || OPENAI_API_KEY === "placeholder") {
    ulog.error("openai_key_missing");
    return json({ error: "Correção automática não está configurada." }, 503);
  }

  let text: string;
  try {
    const body = await req.json();
    text = String(body?.text ?? "");
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const trimmed = text.trim();
  if (!trimmed) return json({ error: "Texto vazio" }, 400);

  // Antes do rate limit: rejeitar entrada gigante não deve consumir cota.
  if (trimmed.length > MAX_CHARS) {
    ulog.warn("text_too_long", { chars: trimmed.length });
    return json({ error: `Texto muito longo (máximo ${MAX_CHARS.toLocaleString("pt-BR")} caracteres).` }, 413);
  }

  // ── Teto por usuário ────────────────────────────────────────────
  const rl = await checkRateLimit(supabase, `fix-grammar:user:${user.id}`, LIMIT_PER_MINUTE, 60);
  if (!rl.allowed) {
    ulog.warn("rate_limited", { used: rl.used, limit: rl.limit });
    return json({ error: "Muitas correções seguidas. Aguarde um minuto." }, 429);
  }

  // Correcao de texto e chamada paga como qualquer outra. O workspace vem da
  // associacao do usuario, nao do corpo da requisicao.
  const { data: membro } = await supabase
    .from("workspace_members").select("workspace_id").eq("user_id", user.id).limit(1).maybeSingle();

  if (membro?.workspace_id) {
    const creditoIA = await consumirCredito(supabase, membro.workspace_id as string, "ia", {
      detalhe: { etapa: "correcao_de_texto" },
    });
    if (!creditoIA.permitido) {
      ulog.warn("correcao_bloqueada_sem_credito", { saldo: creditoIA.saldo });
      return json({ error: mensagemSemCredito(creditoIA) }, 402);
    }
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content:
              "Você é um assistente de revisão de texto em português brasileiro. " +
              "Corrija apenas erros gramaticais, ortográficos e de pontuação. " +
              "Mantenha o tom, estilo e intenção originais do texto. " +
              "Responda APENAS com o texto corrigido, sem explicações, aspas ou formatação adicional.",
          },
          { role: "user", content: trimmed },
        ],
      }),
    });

    if (!res.ok) {
      // O corpo da OpenAI pode conter fragmento da chave — nunca devolver ao browser.
      ulog.error("openai_failed", { http_status: res.status });
      return json({ error: "Não foi possível corrigir agora. Tente de novo." }, 502);
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const corrected = data.choices?.[0]?.message?.content?.trim() ?? trimmed;

    ulog.info("grammar_fixed", { chars: trimmed.length });
    return json({ corrected });

  } catch (err) {
    ulog.error("unhandled_error", { err: err instanceof Error ? err.message : String(err) });
    return json({ error: "Erro ao corrigir. Tente de novo." }, 500);
  }
});
