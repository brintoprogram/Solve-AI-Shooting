// Supabase Edge Function — relationship-ticker
//
// Roda de hora em hora, disparada por pg_cron. Para cada regra ativa cuja hora
// de envio bate com a hora ATUAL EM SÃO PAULO, busca quem faz aniversário (ou
// tem dia de profissão, ou completa tempo de casa) e envia.
//
// Diferença deliberada do automation-ticker: aquele compara send_hour com a
// hora UTC. Para cobrança de boleto passa; para "parabéns" não — 9 viraria 6 da
// manhã. Aqui a comparação é no fuso de Brasília.
//
// Idempotência não é feita aqui. Quem garante "um por pessoa por ano" é o
// índice único (rule_id, contact_id, ano) em relationship_sends: o registro é
// gravado ANTES do envio, então duas execuções concorrentes colidem no banco em
// vez de mandarem duas mensagens.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";
import { consumirCredito } from "../_shared/credits.ts";
import { decrypt } from "../_shared/crypto.ts";
import { createLogger, requestIdFrom } from "../_shared/logger.ts";

const META_BASE  = "https://graph.facebook.com/v25.0";
const Z_API_BASE = "https://api.z-api.io/instances";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

interface Regra {
  id: string; workspace_id: string; name: string; tipo: string;
  send_hour: number; canal: string;
  meta_connection_id: string | null; z_api_connection_id: string | null;
  meta_template_id: string | null; message_body: string | null;
}
interface Alvo {
  contact_id: string; nome: string | null; telefone: string;
  motivo: string; detalhe: string | null;
}

/** Primeiro nome — "Maria das Dores Silva" vira "Maria". Mensagem de
 *  relacionamento com nome completo soa como cobrança. */
function primeiroNome(n: string | null): string {
  return (n ?? "").trim().split(/\s+/)[0] || "tudo bem";
}

function preencher(texto: string, alvo: Alvo): string {
  return texto
    .replace(/\{\{\s*nome\s*\}\}/gi,    primeiroNome(alvo.nome))
    .replace(/\{\{\s*detalhe\s*\}\}/gi, alvo.detalhe ?? "");
}

async function enviarZApi(
  instanceId: string, token: string, clientToken: string,
  phone: string, message: string,
): Promise<{ id?: string; error?: string }> {
  try {
    const res = await fetch(`${Z_API_BASE}/${instanceId}/token/${token}/send-text`, {
      method: "POST",
      headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.replace(/\D/g, ""), message }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) return { error: String(data.error ?? data.message ?? `HTTP ${res.status}`) };
    const id = String(data.zaapId ?? data.messageId ?? data.id ?? "");
    return id ? { id } : { error: "resposta da Z-API sem id" };
  } catch (err) { return { error: String(err) }; }
}

async function enviarMeta(
  phoneNumberId: string, accessToken: string, to: string,
  templateName: string, language: string, components: unknown[],
): Promise<{ id?: string; error?: string }> {
  try {
    const res = await fetch(`${META_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "template",
        template: { name: templateName, language: { code: language }, components },
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const err = (data.error as Record<string, unknown>) ?? {};
      return { error: String(err.message ?? `HTTP ${res.status}`) };
    }
    const msgs = data.messages as Array<{ id: string }> | undefined;
    return { id: msgs?.[0]?.id ?? "" };
  } catch (err) { return { error: String(err) }; }
}

/** Só o corpo, com uma variável: o primeiro nome. Template de felicitação com
 *  muitos parâmetros vira template recusado. */
function componentesMeta(alvo: Alvo): unknown[] {
  return [{ type: "body", parameters: [{ type: "text", text: primeiroNome(alvo.nome) }] }];
}

async function processarRegra(regra: Regra, ano: number, log: ReturnType<typeof createLogger>) {
  const { data: alvos, error } = await db.rpc("relacionamento_alvos", { p_rule_id: regra.id });
  if (error) { log.error("alvos_falhou", { rule_id: regra.id, err: error.message }); return; }

  const lista = (alvos ?? []) as Alvo[];
  if (lista.length === 0) return;

  log.info("regra_iniciada", { rule_id: regra.id, tipo: regra.tipo, alvos: lista.length });

  // Conexão e template resolvidos UMA vez por regra, não por contato: decrypt
  // por destinatário multiplicaria trabalho de CPU por nada.
  let zapi: { instanceId: string; token: string; clientToken: string } | null = null;
  let meta: { phoneNumberId: string; accessToken: string; nome: string; idioma: string } | null = null;

  if (regra.canal === "z_api") {
    if (!regra.z_api_connection_id) { log.warn("sem_conexao_zapi", { rule_id: regra.id }); return; }
    const { data: conn } = await db.from("z_api_connections")
      .select("instance_id, token, client_token").eq("id", regra.z_api_connection_id).single();
    if (!conn) { log.warn("conexao_zapi_sumiu", { rule_id: regra.id }); return; }
    zapi = {
      instanceId:  conn.instance_id as string,
      token:       await decrypt(conn.token as string),
      clientToken: await decrypt(conn.client_token as string),
    };
  } else {
    if (!regra.meta_connection_id || !regra.meta_template_id) {
      // Sem template não há como falar fora da janela de 24h — que é
      // exatamente o caso de uma mensagem de aniversário.
      log.warn("meta_sem_conexao_ou_template", { rule_id: regra.id });
      return;
    }
    const [{ data: conn }, { data: tpl }] = await Promise.all([
      db.from("meta_connections").select("phone_number_id, access_token").eq("id", regra.meta_connection_id).single(),
      db.from("meta_templates").select("template_name, language").eq("id", regra.meta_template_id).single(),
    ]);
    if (!conn || !tpl) { log.warn("meta_conexao_ou_template_sumiu", { rule_id: regra.id }); return; }
    meta = {
      phoneNumberId: conn.phone_number_id as string,
      accessToken:   await decrypt(conn.access_token as string),
      nome:          tpl.template_name as string,
      idioma:        (tpl.language as string) ?? "pt_BR",
    };
  }

  let enviados = 0;

  for (const alvo of lista) {
    // Reserva a vaga ANTES de enviar. Se outra execução já reservou, o índice
    // único rejeita aqui e este processo pula — em vez de mandar a segunda
    // mensagem e só depois descobrir.
    const { error: errReserva } = await db.from("relationship_sends").insert({
      rule_id: regra.id, workspace_id: regra.workspace_id,
      contact_id: alvo.contact_id, ano, status: "enviado",
    });
    if (errReserva) {
      if ((errReserva as { code?: string }).code === "23505") continue;  // já reservado
      log.error("reserva_falhou", { rule_id: regra.id, err: errReserva.message });
      continue;
    }

    const credito = await consumirCredito(db, regra.workspace_id, "mensagem", {
      destino: alvo.telefone, canal: "whatsapp", contactId: alvo.contact_id,
      detalhe: { origem: "relacionamento", rule_id: regra.id, motivo: alvo.motivo },
    });
    if (!credito.permitido) {
      // Marca como sem_credito, não apaga: a regra não deve tentar de novo
      // amanhã, e o registro explica por que a pessoa não recebeu.
      await db.from("relationship_sends")
        .update({ status: "sem_credito", erro: `saldo ${credito.saldo}` })
        .eq("rule_id", regra.id).eq("contact_id", alvo.contact_id).eq("ano", ano);
      log.warn("sem_credito", { rule_id: regra.id, saldo: credito.saldo });
      break;  // saldo não volta no meio do lote
    }

    const r = regra.canal === "z_api" && zapi
      ? await enviarZApi(zapi.instanceId, zapi.token, zapi.clientToken, alvo.telefone,
                         preencher(regra.message_body ?? "Parabéns, {{nome}}!", alvo))
      : meta
        ? await enviarMeta(meta.phoneNumberId, meta.accessToken, alvo.telefone,
                           meta.nome, meta.idioma, componentesMeta(alvo))
        : { error: "canal não resolvido" };

    if (r.id) {
      enviados++;
      await db.from("relationship_sends").update({ wamid: r.id })
        .eq("rule_id", regra.id).eq("contact_id", alvo.contact_id).eq("ano", ano);
    } else {
      // Falhou fica como 'falhou' — relacionamento_alvos ignora esse status,
      // então a próxima execução tenta de novo. Erro de rede não deve custar
      // o aniversário da pessoa.
      await db.from("relationship_sends")
        .update({ status: "falhou", erro: (r.error ?? "").slice(0, 300) })
        .eq("rule_id", regra.id).eq("contact_id", alvo.contact_id).eq("ano", ano);
      log.warn("envio_falhou", { rule_id: regra.id, err: r.error });
    }
  }

  // Sem contador desnormalizado de propósito: relationship_sends já é a
  // verdade, e ler-somar-escrever daqui seria corrida entre duas execuções.
  // A tela conta a partir do log.
  log.info("regra_concluida", { rule_id: regra.id, enviados, alvos: lista.length });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const CORS = getCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const log = createLogger("relationship-ticker", { request_id: requestIdFrom(req) });

  // Hora e ano em São Paulo. Usar a hora do servidor mandaria parabéns às 6h.
  const agoraSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const hora    = agoraSP.getHours();
  const ano     = agoraSP.getFullYear();

  const { data: regras, error } = await db
    .from("relationship_rules")
    .select("id, workspace_id, name, tipo, send_hour, canal, meta_connection_id, z_api_connection_id, meta_template_id, message_body")
    .eq("status", "active")
    .eq("send_hour", hora);

  if (error) {
    log.error("busca_regras_falhou", { err: error.message });
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS });
  }

  const lista = (regras ?? []) as Regra[];

  // Responde já e trabalha depois: o pg_net tem timeout curto e o lote pode
  // levar minutos. Mesmo padrão do campaign-ticker.
  const trabalho = (async () => {
    for (const regra of lista) {
      try { await processarRegra(regra, ano, log); }
      catch (err) { log.error("regra_estourou", { rule_id: regra.id, err: String(err) }); }
    }
  })();

  // @ts-ignore — EdgeRuntime existe no runtime do Supabase, não nos tipos.
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(trabalho);
  else await trabalho;

  return new Response(
    JSON.stringify({ ok: true, hora_sp: hora, regras: lista.length }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
