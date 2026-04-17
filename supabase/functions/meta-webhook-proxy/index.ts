/**
 * meta-webhook-proxy
 *
 * Recebe eventos da Meta e repassa em paralelo para:
 *   1. Chatwoot  → https://chatwoot.solveai.consulting/webhooks/whatsapp/+5511950239278
 *   2. Solve.AI  → SOLVE_WEBHOOK_URL (secret)
 *
 * Secrets necessários:
 *   SOLVE_WEBHOOK_URL  – URL da função meta-webhook deste projeto Supabase
 */

const CHATWOOT_VERIFY_TOKEN = "73c0163c89186e2fb98921d14d8d1ec4";
const CHATWOOT_URL          = "https://chatwoot.solveai.consulting/webhooks/whatsapp/+5511950239278";
const SOLVE_URL             = Deno.env.get("SOLVE_WEBHOOK_URL") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    const params    = new URL(req.url).searchParams;
    const mode      = params.get("hub.mode");
    const token     = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");

    if (mode === "subscribe" && token === CHATWOOT_VERIFY_TOKEN && challenge) {
      console.log("[proxy] webhook verificado pela Meta ✓");
      return new Response(challenge, { status: 200 });
    }

    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "POST") {
    const body = await req.text();

    const targets = [
      { name: "chatwoot", url: CHATWOOT_URL },
      ...(SOLVE_URL ? [{ name: "solve", url: SOLVE_URL }] : []),
    ];

    const results = await Promise.allSettled(
      targets.map(({ name, url }) =>
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })
          .then((r) => { console.log(`[proxy] → ${name} ${r.status}`); return r; })
          .catch((err) => { console.error(`[proxy] → ${name} FALHOU:`, err?.message); throw err; })
      )
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    console.log(`[proxy] ${ok}/${targets.length} destinos OK`);

    return new Response("ok", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});
