// Rate limit compartilhado entre as edge functions.
//
// Protege dois tipos de custo:
//   - dinheiro: endpoints que chamam LLM cobram por requisição
//   - banco: endpoints públicos que escrevem a cada chamada
//
// A contagem e o registro acontecem numa transação só (RPC check_rate_limit),
// senão duas requisições simultâneas contariam o mesmo estado antigo e
// passariam juntas.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface RateLimitResult {
  allowed: boolean;
  used:    number;
  limit:   number;
}

/**
 * `bucket` identifica o que está sendo limitado — nunca coloque segredo nele.
 * Ex.: "fix-grammar:user:<uuid>", "negportal:<hash-do-token>".
 *
 * Em caso de erro no banco devolve `allowed: true`: um limitador quebrado não
 * pode derrubar o produto inteiro. A falha fica registrada no log.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error(JSON.stringify({
      level: "error", event: "rate_limit_check_failed", bucket, err: error.message,
    }));
    return { allowed: true, used: 0, limit };
  }

  return data as unknown as RateLimitResult;
}

/** SHA-256 em hex — para usar um segredo como bucket sem gravá-lo. */
export async function bucketHash(secret: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(buf)).slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}
