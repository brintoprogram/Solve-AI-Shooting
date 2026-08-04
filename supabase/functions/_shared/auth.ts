// Helpers de autenticação compartilhados pelas edge functions.
//
// Contexto: quase todas as functions são publicadas com `verify_jwt = false`
// (necessário para webhooks e para o portal público), o que significa que a
// plataforma NÃO valida nada — cada function precisa autenticar por conta
// própria. Estes helpers padronizam os três modos usados no projeto:
//
//   isInternalCall()        → chamada server-to-server (service role key)
//   requireWorkspaceMember()→ usuário logado com acesso ao workspace
//   timingSafeEqual()       → comparação de segredos sem vazar tempo
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Comparação em tempo constante. Um `===` comum retorna assim que encontra o
 * primeiro byte diferente, o que permite descobrir um segredo byte a byte
 * medindo o tempo de resposta.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Extrai o token do header Authorization: Bearer <token>. */
export function bearerToken(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * true quando a requisição veio de outra edge function usando a service role
 * key (padrão do `supabase.functions.invoke` a partir de um client service-role).
 */
export function isInternalCall(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = bearerToken(req);
  return !!token && !!serviceKey && timingSafeEqual(token, serviceKey);
}

/**
 * Valida o JWT do usuário e confirma que ele pertence ao workspace informado.
 * Retorna `null` quando está tudo certo, ou a mensagem de erro a devolver.
 */
export async function requireWorkspaceMember(
  supabase: SupabaseClient,
  req: Request,
  workspaceId: string,
): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return "Não autorizado";

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return "Token inválido";

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!membership) return "Sem permissão neste workspace";
  return null;
}

/**
 * Valida um segredo compartilhado vindo de query string (`?s=`) ou do header
 * `X-Webhook-Secret`. Usado por webhooks de terceiros que não assinam o payload
 * (ex.: Z-API). Quando `expected` está vazio, devolve `null` (não configurado)
 * para permitir rollout gradual — o chamador decide se aceita ou bloqueia.
 */
export function checkWebhookSecret(req: Request, expected: string): boolean | null {
  if (!expected) return null;
  const provided = new URL(req.url).searchParams.get("s")
    ?? req.headers.get("X-Webhook-Secret")
    ?? "";
  return timingSafeEqual(provided, expected);
}
