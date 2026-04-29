/**
 * CORS utility — responde com a origem exata se ela estiver na lista de
 * ALLOWED_ORIGINS, ou com "*" se a lista contiver "*".
 *
 * Suporta wildcard de subdomínio: "https://*.vercel.app" casa com
 * qualquer preview da Vercel sem precisar listar cada uma.
 *
 * Configurar via Supabase Secret:
 *   supabase secrets set ALLOWED_ORIGINS="https://system.solveai.consulting,https://*.vercel.app,http://localhost:5173"
 */

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function getAllowedOrigin(req: Request): string {
  if (allowedOrigins.includes("*")) return "*";

  const origin = req.headers.get("origin") ?? "";
  if (!origin) return allowedOrigins[0] ?? "*";

  if (allowedOrigins.includes(origin)) return origin;

  for (const allowed of allowedOrigins) {
    if (allowed.includes("*")) {
      const escaped = allowed.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, "[^.]+");
      if (new RegExp(`^${escaped}$`).test(origin)) return origin;
    }
  }

  return allowedOrigins[0] ?? "*"; // fallback para primeira origem da lista
}

export const CORS_HEADERS = "authorization, x-client-info, apikey, content-type";

export function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin":  getAllowedOrigin(req),
    "Access-Control-Allow-Headers": CORS_HEADERS,
  };
}
