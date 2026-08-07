// Consumo de créditos.
//
// A regra vive no banco (`consume_credit`), não aqui: contar e debitar precisa
// acontecer numa transação só, com a linha do saldo travada. Sem isso, um
// disparo em massa — dezenas de envios simultâneos — leria o mesmo saldo várias
// vezes e passaria do limite.
//
// Este módulo é só a porta de entrada, para nenhuma function precisar conhecer
// o formato do retorno.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Espelho de src/lib/aiModels.ts. Opus custa muito mais por token que Haiku;
 *  cobrar o mesmo pelos dois faria o plano perder dinheiro exatamente nos
 *  workspaces que mais usam o modelo caro. Modelo desconhecido conta como 1 —
 *  nao penaliza agente configurado antes desta tabela existir. */
const MULTIPLICADOR: Record<string, number> = {
  "claude-haiku-4-5-20251001": 1,
  "gpt-4o-mini":               1,
  "claude-sonnet-5":           3,
  "claude-opus-5":             8,
};

export function multiplicadorDoModelo(modelo: string | null | undefined): number {
  return MULTIPLICADOR[modelo ?? ""] ?? 1;
}

export type TipoConsumo = "mensagem" | "ia";
export type Canal       = "whatsapp" | "email";

export interface ResultadoCredito {
  permitido: boolean;
  cobrado:   number;
  motivo:    "debitado" | "janela_aberta" | "saldo_insuficiente" | "cobranca_desativada" | "erro";
  saldo:     number;
  custo?:    number;
}

/**
 * Debita e diz se a ação pode prosseguir.
 *
 * IMPORTANTE — chame ANTES de enviar, e respeite `permitido`. Debitar depois
 * do envio significa que um saldo zerado não impede nada.
 *
 * Em erro de banco devolve `permitido: false`. É o oposto da decisão tomada no
 * rate limit, onde a falha libera: ali o pior caso é uma requisição a mais;
 * aqui é enviar sem cobrar, indefinidamente, sem ninguém perceber.
 */
export async function consumirCredito(
  supabase: SupabaseClient,
  workspaceId: string,
  tipo: TipoConsumo,
  opts: {
    /** Telefone ou e-mail do cliente. É a CHAVE da janela de 24h. */
    destino?:   string | null;
    canal?:     Canal;
    /** Só para o extrato — campanha dispara para planilha e pode não ter. */
    contactId?: string | null;
    detalhe?:   Record<string, unknown>;
    /** Modelo usado, quando tipo = "ia". Define o multiplicador do custo. */
    modelo?:    string | null;
  } = {},
): Promise<ResultadoCredito> {
  const { data, error } = await supabase.rpc("consume_credit", {
    p_workspace_id: workspaceId,
    p_tipo:         tipo,
    p_destino:      opts.destino ?? null,
    p_canal:        opts.canal ?? null,
    p_contact_id:   opts.contactId ?? null,
    p_detalhe:      { ...(opts.detalhe ?? {}), modelo: opts.modelo ?? null },
    p_multiplicador: multiplicadorDoModelo(opts.modelo),
  });

  if (error) {
    console.error(JSON.stringify({
      level: "error", event: "credito_falhou", workspace_id: workspaceId, tipo, err: error.message,
    }));
    return { permitido: false, cobrado: 0, motivo: "erro", saldo: 0 };
  }

  return data as unknown as ResultadoCredito;
}

/** Mensagem para o usuário quando o saldo trava a ação. */
export function mensagemSemCredito(r: ResultadoCredito): string {
  if (r.motivo === "erro") {
    return "Não foi possível verificar os créditos. Tente novamente em instantes.";
  }
  return `Créditos insuficientes (saldo: ${r.saldo}). Recarregue para continuar enviando.`;
}
