// Supabase Edge Function — Agent Sandbox
//
// Conversa com os agentes de IA sem passar pelo WhatsApp.
//
// Antes, exercitar um agente exigia mandar mensagem de verdade para um número
// conectado: custa por mensagem, precisa de um número de teste, e um agente mal
// configurado responde errado para um cliente real.
//
// Aqui a conversa é marcada como simulação. O `ai-agent-reply` é exatamente o
// mesmo do fluxo real — não há caminho paralelo, então o que funciona aqui
// funciona em produção. O que muda é só a ausência de conexão: o
// `sendWhatsAppText` já trata isso com `onMissingConnection: "skip"`, gravando
// a resposta em vez de enviá-la.
//
// Ações:
//   nova     — cria (ou reaproveita) a conversa de teste do usuário
//   enviar   — grava a mensagem como se fosse do cliente e aciona o agente
//   reiniciar— apaga as mensagens e o rastro, mantendo a conversa
//
// Por que uma function e não chamada direta do navegador: `ai-agent-reply`
// exige service role (isInternalCall). Esta function é a ponte autenticada —
// valida a sessão e o workspace antes de assumir o papel de serviço.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";
import { requireWorkspaceMember, bearerToken } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/ratelimit.ts";
import { createLogger, requestIdFrom } from "../_shared/logger.ts";

// Cada envio vira uma chamada paga de LLM. É um humano digitando, então este
// teto é generoso — mas ele existe para um loop acidental na tela não gerar
// fatura.
const LIMITE_POR_MINUTO = 20;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

/** Telefone fictício estável por usuário — nunca colide com número real. */
function telefoneDeTeste(userId: string): string {
  // Prefixo 5599 + 9 dígitos derivados do id. Não é um número válido em
  // lugar nenhum, o que é justamente o ponto: se algum dia vazar para um
  // envio real, a mensagem falha em vez de chegar a um desconhecido.
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return `5599${String(h).padStart(9, "0").slice(0, 9)}`;
}

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const log = createLogger("agent-sandbox", { request_id: requestIdFrom(req) });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "JSON inválido" }, 400); }

  const workspace_id = String(body.workspace_id ?? "");
  const acao         = String(body.acao ?? "");
  if (!workspace_id) return json({ error: "workspace_id é obrigatório" }, 400);

  const authErr = await requireWorkspaceMember(supabase, req, workspace_id);
  if (authErr) {
    log.warn("auth_rejected", { workspace_id, reason: authErr });
    return json({ error: authErr }, 401);
  }

  const { data: { user } } = await supabase.auth.getUser(bearerToken(req));
  if (!user) return json({ error: "Sessão inválida" }, 401);

  const wlog = log.child({ workspace_id, user_id: user.id });

  // ── Contato e conversa de teste (um par por usuário) ──────────────
  // Reaproveitar em vez de criar a cada abertura evita encher a base de
  // contatos fictícios — e mantém o histórico entre sessões.
  async function garantirConversa(): Promise<{ conversationId: string; contactId: string } | null> {
    const phone = telefoneDeTeste(user!.id);

    const { data: contatoExistente } = await supabase
      .from("inbox_contacts")
      .select("id")
      .eq("workspace_id", workspace_id)
      .eq("phone", phone)
      .maybeSingle();

    let contactId = contatoExistente?.id as string | undefined;

    if (!contactId) {
      const { data: novo, error } = await supabase
        .from("inbox_contacts")
        .insert({
          workspace_id,
          phone,
          name: "Cliente de teste",
          is_simulation: true,
        })
        .select("id")
        .single();
      if (error || !novo) {
        wlog.error("contato_teste_falhou", { err: error?.message });
        return null;
      }
      contactId = novo.id as string;
    }

    const { data: convExistente } = await supabase
      .from("inbox_conversations")
      .select("id")
      .eq("workspace_id", workspace_id)
      .eq("contact_id", contactId)
      .eq("is_simulation", true)
      .maybeSingle();

    if (convExistente) return { conversationId: convExistente.id as string, contactId };

    const { data: novaConv, error } = await supabase
      .from("inbox_conversations")
      .insert({
        workspace_id,
        contact_id: contactId,
        is_simulation: true,
        status: "open",
        // Sem conexão de propósito: é o que faz o envio virar gravação.
        meta_connection_id: null,
        z_api_connection_id: null,
      })
      .select("id")
      .single();

    if (error || !novaConv) {
      wlog.error("conversa_teste_falhou", { err: error?.message });
      return null;
    }
    return { conversationId: novaConv.id as string, contactId };
  }

  try {
    // ── nova ────────────────────────────────────────────────────────
    if (acao === "nova") {
      const r = await garantirConversa();
      if (!r) return json({ error: "Não foi possível preparar a conversa de teste." }, 500);
      return json({ conversation_id: r.conversationId });
    }

    // ── reiniciar ───────────────────────────────────────────────────
    if (acao === "reiniciar") {
      const r = await garantirConversa();
      if (!r) return json({ error: "Não foi possível preparar a conversa de teste." }, 500);

      await supabase.from("inbox_messages").delete().eq("conversation_id", r.conversationId);
      await supabase.from("agent_trace_events").delete().eq("conversation_id", r.conversationId);
      // Zera o roteamento: a próxima mensagem volta a cair na triagem.
      await supabase
        .from("inbox_conversations")
        .update({ ai_agent_id: null, department_id: null, last_message_body: null })
        .eq("id", r.conversationId);

      wlog.info("sandbox_reiniciado", { conversation_id: r.conversationId });
      return json({ conversation_id: r.conversationId, reiniciado: true });
    }

    // ── enviar ──────────────────────────────────────────────────────
    if (acao === "enviar") {
      const texto = String(body.mensagem ?? "").trim();
      if (!texto)              return json({ error: "Mensagem vazia" }, 400);
      if (texto.length > 2000) return json({ error: "Mensagem muito longa (máximo 2.000 caracteres)." }, 413);

      // Depois da validação de entrada: texto inválido não consome cota.
      const rl = await checkRateLimit(supabase, `sandbox:${user.id}`, LIMITE_POR_MINUTO, 60);
      if (!rl.allowed) {
        wlog.warn("rate_limited", { used: rl.used, limit: rl.limit });
        return json({ error: "Muitas mensagens seguidas. Aguarde um minuto." }, 429);
      }

      const r = await garantirConversa();
      if (!r) return json({ error: "Não foi possível preparar a conversa de teste." }, 500);

      const agora = new Date().toISOString();
      const { error: msgErr } = await supabase.from("inbox_messages").insert({
        workspace_id,
        conversation_id: r.conversationId,
        contact_id:      r.contactId,
        direction:       "inbound",
        message_type:    "text",
        body:            texto,
        status:          "received",
        created_at:      agora,
      });
      if (msgErr) {
        wlog.error("mensagem_teste_falhou", { err: msgErr.message });
        return json({ error: "Não foi possível registrar a mensagem." }, 500);
      }

      await supabase
        .from("inbox_conversations")
        .update({
          last_message_at: agora,
          last_message_body: texto,
          last_message_direction: "inbound",
          updated_at: agora,
        })
        .eq("id", r.conversationId);

      await supabase.from("agent_trace_events").insert({
        workspace_id,
        conversation_id: r.conversationId,
        step: "mensagem_recebida",
        detail: { texto },
      });

      // Aciona o MESMO agente do fluxo real. Aguarda a conclusão (ao contrário
      // dos webhooks, que disparam e seguem) para a tela poder mostrar o
      // resultado assim que a chamada volta.
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-agent-reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ conversation_id: r.conversationId, message_body: texto }),
      });

      if (!res.ok) {
        const detalhe = await res.text().catch(() => "");
        wlog.error("agente_falhou", { http_status: res.status, detalhe: detalhe.slice(0, 200) });
        await supabase.from("agent_trace_events").insert({
          workspace_id,
          conversation_id: r.conversationId,
          step: "erro_no_agente",
          detail: { http_status: res.status },
        });
        return json({ conversation_id: r.conversationId, aviso: "O agente falhou ao responder. Veja o rastro." });
      }

      wlog.info("sandbox_mensagem_processada", { conversation_id: r.conversationId });
      return json({ conversation_id: r.conversationId });
    }

    return json({ error: "acao inválida (use nova, enviar ou reiniciar)" }, 400);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    wlog.fatal("unhandled_error", { err: msg });
    return json({ error: "Erro inesperado no ambiente de teste." }, 500);
  }
});
