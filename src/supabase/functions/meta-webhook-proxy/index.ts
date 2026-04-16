/**
 * meta-webhook-proxy
 *
 * Receives all Meta webhook events and forwards them in parallel to:
 *   1. Chatwoot  (CHATWOOT_WEBHOOK_URL)
 *   2. Solve.AI  (SOLVE_WEBHOOK_URL)
 *
 * Environment variables (set via `supabase secrets set`):
 *   WEBHOOK_VERIFY_TOKEN  – token you register on Meta for Developers
 *   CHATWOOT_WEBHOOK_URL  – e.g. https://chatwoot.solveai.consulting/webhooks/whatsapp/+5511950239278
 *   SOLVE_WEBHOOK_URL     – e.g. https://<ref>.supabase.co/functions/v1/meta-webhook
 */

const VERIFY_TOKEN     = Deno.env.get("WEBHOOK_VERIFY_TOKEN") ?? "";
const CHATWOOT_URL     = Deno.env.get("CHATWOOT_WEBHOOK_URL") ?? "";
const SOLVE_URL        = Deno.env.get("SOLVE_WEBHOOK_URL")    ?? "";

Deno.serve(async (req: Request) => {
  // ── GET: Meta webhook verification challenge ─────────────────────────────
  if (req.method === "GET") {
    const url    = new URL(req.url);
    const mode   = url.searchParams.get("hub.mode");
    const token  = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      console.log("[proxy] webhook verified by Meta");
      return new Response(challenge, { status: 200 });
    }

    return new Response("Forbidden", { status: 403 });
  }

  // ── POST: incoming event — forward to both services ──────────────────────
  if (req.method === "POST") {
    const body = await req.text();

    const targets: { name: string; url: string }[] = [];
    if (CHATWOOT_URL) targets.push({ name: "chatwoot", url: CHATWOOT_URL });
    if (SOLVE_URL)    targets.push({ name: "solve",    url: SOLVE_URL    });

    if (targets.length === 0) {
      console.error("[proxy] no forwarding targets configured");
      return new Response("No targets", { status: 500 });
    }

    // Fire all forwards in parallel — never let one failure block the other
    const results = await Promise.allSettled(
      targets.map(({ name, url }) =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
          .then((r) => {
            console.log(`[proxy] → ${name} ${r.status}`);
            return r;
          })
          .catch((err) => {
            console.error(`[proxy] → ${name} FAILED:`, err?.message);
            throw err;
          })
      )
    );

    const anyOk = results.some((r) => r.status === "fulfilled");
    console.log("[proxy] done. ok:", anyOk);

    // Meta just needs a 200 back quickly — always respond OK
    return new Response("ok", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});
