import { log } from "@/lib/logger";

/**
 * Envolve uma operação do Supabase para que o erro nunca passe despercebido.
 *
 * O projeto tinha 54 mutações no formato:
 *
 *     await supabase.from("x").update({...}).eq("id", id);
 *
 * sem qualquer verificação. Se a RLS bloqueasse ou a rede caísse, a UI seguia
 * como se tivesse dado certo — o usuário via "salvo" e nada tinha mudado.
 *
 * Uso:
 *     const ok = await run("negotiation_claim",
 *       supabase.from("debt_negotiations").update({ status: "human_negotiating" }).eq("id", id));
 *     if (!ok) toast({ title: "Não foi possível assumir", variant: "destructive" });
 */
export async function run<T>(
  action: string,
  query: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>,
  ctx?: Record<string, unknown>,
): Promise<T | null> {
  try {
    const { data, error } = await query;
    if (error) {
      log.error("db_operation_failed", { action, err: error.message, code: error.code, ...ctx });
      return null;
    }
    return data;
  } catch (e) {
    log.error("db_operation_threw", { action, err: e instanceof Error ? e.message : String(e), ...ctx });
    return null;
  }
}

/**
 * Igual a run(), mas para quando o chamador só precisa saber se deu certo.
 * Retorna true em sucesso.
 */
export async function runOk(
  action: string,
  query: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
  ctx?: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { error } = await query;
    if (error) {
      log.error("db_operation_failed", { action, err: error.message, code: error.code, ...ctx });
      return false;
    }
    return true;
  } catch (e) {
    log.error("db_operation_threw", { action, err: e instanceof Error ? e.message : String(e), ...ctx });
    return false;
  }
}

/**
 * Extrai a mensagem de erro real de uma chamada a edge function.
 *
 * `supabase.functions.invoke` NÃO rejeita em erro HTTP: devolve
 * `{ data: null, error: FunctionsHttpError }`. Como `data` vem nulo, ler
 * `data.error` não funciona e o código cai no `error.message`, que é a string
 * interna "Edge Function returned a non-2xx status code" — ela estava sendo
 * exibida a clientes finais no portal de negociação.
 *
 * O corpo da resposta fica em `error.context` (um Response). É de lá que sai a
 * mensagem que a função de fato escreveu.
 */
export async function edgeErrorMessage(
  fnErr: unknown,
  fallback = "Não foi possível completar a operação. Tente novamente.",
): Promise<string> {
  const ctx = (fnErr as { context?: unknown })?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const body = await (ctx as Response).json();
      if (body && typeof body.error === "string" && body.error.trim()) return body.error;
    } catch { /* corpo não era JSON — usa o fallback */ }
  }
  return fallback;
}
