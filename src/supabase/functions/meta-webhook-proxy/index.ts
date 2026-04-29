/**
 * meta-webhook-proxy
 *
 * Recebe eventos da Meta e repassa para:
 *   SOLVE_WEBHOOK_URL (secret) → função meta-webhook deste projeto
 *
 * Secrets necessários (Supabase Dashboard → Edge Functions → Secrets):
 *   SOLVE_WEBHOOK_URL – URL da função meta-webhook deste projeto Supabase
 */

const META_VERIFY_TOKEN = "73c0163c89186e2fb98921d14d8d1ec4";
const SOLVE_URL         = Deno.env.get("SOLVE_WEBHOOK_URL") ?? "";

Deno.serve(async (req: Request) => {

  // ── GET: verificação pela Meta ──────────────────────────────────────
  if (req.method === "GET") {
    const params    = new URL(req.url).searchParams;
    const mode      = params.get("hub.mode");
    const token     = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");

    if (mode === "subscribe" && token === META_VERIFY_TOKEN && challenge) {
      console.log("[proxy] webhook verificado pela Meta ✓");
      return new Response(challenge, { status: 200 });
    }

    return new Response("Forbidden", { status: 403 });
  }

  // ── POST: evento recebido → repassa para Solve.AI ──────────────────
  if (req.method === "POST") {
    if (!SOLVE_URL) {
      console.error("[proxy] SOLVE_WEBHOOK_URL não configurado");
      return new Response("ok", { status: 200 }); // Meta sempre precisa de 200
    }

    const body = await req.text();

    try {
      const res = await fetch(SOLVE_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      console.log(`[proxy] → solve ${res.status}`);
    } catch (err) {
      console.error("[proxy] → solve FALHOU:", (err as Error)?.message);
    }

    return new Response("ok", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});
