// Envio de mensagem de texto pelo canal da conversa (Meta Cloud API ou Z-API),
// com persistência em inbox_messages e atualização da conversa.
//
// Consolida três implementações que existiam duplicadas em ai-agent-reply,
// negotiation-agent e negotiation-portal. As diferenças de comportamento entre
// elas eram reais (não cosméticas) e estão preservadas via SendOptions — em
// especial a tolerância a erro do portal, onde o acordo já foi gravado no banco
// antes do envio e lançar exceção mostraria falha a um cliente bem-sucedido.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "./crypto.ts";
import { consumirCredito } from "./credits.ts";

const META_API = "https://graph.facebook.com/v25.0";

/** Lancado quando o workspace nao tem saldo. Erro proprio para o chamador poder
 *  tratar diferente de uma falha de rede — um e problema de plano, o outro e
 *  problema tecnico, e a mensagem ao usuario precisa ser outra. */
export class SemCreditoError extends Error {
  readonly saldo: number;
  constructor(saldo: number) {
    super("Créditos insuficientes");
    this.name  = "SemCreditoError";
    this.saldo = saldo;
  }
}

export interface ConvRef {
  id:                  string;
  workspace_id:        string;
  contact_id:          string;
  meta_connection_id:  string | null;
  z_api_connection_id: string | null;
}

export interface SendOptions {
  /**
   * Falha ao falar com a Meta/Z-API:
   *   "throw"   (padrão) — propaga o erro; a mensagem NÃO é gravada.
   *   "swallow"          — loga e grava a mensagem com wamid null.
   */
  onError?: "throw" | "swallow";
  /**
   * Conversa sem meta_connection_id nem z_api_connection_id:
   *   "throw" (padrão) — erro explícito.
   *   "skip"           — grava a mensagem sem enviar (comportamento legado do ai-agent-reply).
   */
  onMissingConnection?: "throw" | "skip";
  /** Atualiza inbox_conversations.updated_at junto (padrão true). */
  touchUpdatedAt?: boolean;
  /** Prefixo do log, para rastrear qual fluxo enviou. */
  logLabel?: string;
}

/** Dispara o texto e devolve o wamid quando o provedor retorna um. */
export async function sendWhatsAppText(
  supabase: SupabaseClient,
  conv: ConvRef,
  text: string,
  sentBy: string,
  opts: SendOptions = {},
): Promise<{ wamid: string | null }> {
  const {
    onError = "throw",
    onMissingConnection = "throw",
    touchUpdatedAt = true,
    logLabel = "whatsapp",
  } = opts;

  const now = new Date().toISOString();
  let wamid: string | null = null;

  // ── Credito ───────────────────────────────────────────────────────
  // So cobra quando existe canal para enviar. Conversa sem conexao (o
  // ambiente de teste de agentes, por exemplo) grava a mensagem sem manda-la:
  // nao saiu nada, nao ha o que cobrar.
  //
  // Antes do envio, de proposito. Debitar depois significaria que saldo zerado
  // nao impede nada — a mensagem ja teria saido.
  const temCanal = !!(conv.z_api_connection_id || conv.meta_connection_id);
  if (temCanal) {
    const credito = await consumirCredito(supabase, conv.workspace_id, "mensagem", {
      contactId: conv.contact_id,
      canal:     "whatsapp",
      detalhe:   { origem: logLabel },
    });
    if (!credito.permitido) {
      console.warn(JSON.stringify({
        level: "warn", event: "envio_bloqueado_sem_credito",
        workspace_id: conv.workspace_id, saldo: credito.saldo, origem: logLabel,
      }));
      throw new SemCreditoError(credito.saldo);
    }
  }

  try {
    const { data: contact } = await supabase
      .from("inbox_contacts").select("phone").eq("id", conv.contact_id).single();

    if (conv.z_api_connection_id) {
      const { data: zapiConn } = await supabase
        .from("z_api_connections")
        .select("instance_id, token, client_token")
        .eq("id", conv.z_api_connection_id)
        .single();
      if (!zapiConn) throw new Error("Z-API connection not found");

      const token       = await decrypt(zapiConn.token as string);
      const clientToken = await decrypt(zapiConn.client_token as string);

      const res = await fetch(
        `https://api.z-api.io/instances/${zapiConn.instance_id}/token/${token}/send-text`,
        {
          method:  "POST",
          headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
          body:    JSON.stringify({ phone: contact?.phone, message: text }),
        },
      );
      const resBody = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(`Z-API error: ${JSON.stringify(resBody)}`);
      wamid = (resBody.zaapId ?? resBody.messageId ?? null) as string | null;

    } else if (conv.meta_connection_id) {
      const { data: conn } = await supabase
        .from("meta_connections")
        .select("phone_number_id, access_token")
        .eq("id", conv.meta_connection_id)
        .single();
      if (!conn) throw new Error("Meta connection not found");

      const accessToken = await decrypt(conn.access_token as string);
      const res = await fetch(`${META_API}/${conn.phone_number_id}/messages`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
        body:    JSON.stringify({ messaging_product: "whatsapp", to: contact?.phone, type: "text", text: { body: text } }),
      });
      const metaBody = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(`Meta API error: ${JSON.stringify(metaBody)}`);
      wamid = (metaBody.messages as Array<{ id: string }>)?.[0]?.id ?? null;

    } else if (onMissingConnection === "throw") {
      throw new Error("Conversation has no meta_connection_id or z_api_connection_id");
    }
  } catch (err) {
    if (onError === "throw") throw err;
    console.error(`[${logLabel}] falha ao enviar WhatsApp:`, err instanceof Error ? err.message : err);
  }

  console.log(`[${logLabel}] ✓ enviado wamid=${wamid}`);

  await supabase.from("inbox_messages").insert({
    workspace_id:    conv.workspace_id,
    conversation_id: conv.id,
    contact_id:      conv.contact_id,
    wamid,
    direction:       "outbound",
    message_type:    "text",
    body:            text,
    sent_by:         sentBy,
    is_internal:     false,
    status:          "sent",
    created_at:      now,
  });

  await supabase.from("inbox_conversations").update({
    last_message_at:        now,
    last_message_body:      text,
    last_message_direction: "outbound",
    ...(touchUpdatedAt ? { updated_at: now } : {}),
  }).eq("id", conv.id);

  return { wamid };
}
