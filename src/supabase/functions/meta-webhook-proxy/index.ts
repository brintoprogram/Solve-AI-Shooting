/**
 * meta-webhook-proxy
 *
 * Recebe todos os eventos da Meta e repassa em paralelo para:
 *   1. Chatwoot  → https://chatwoot.solveai.consulting/webhooks/whatsapp/+5511950239278
 *   2. Solve.AI  → função meta-webhook do próprio Supabase
 *
 * Variáveis de ambiente (defina via Supabase Dashboard → Edge Functions → Secrets):
 *   WEBHOOK_VERIFY_TOKEN  – token que você cadastra no painel da Meta
 *   SOLVE_WEBHOOK_URL     – URL da função meta-webhook deste projeto
 */

const VERIFY_TOKEN = Deno.env.get("WEBHOOK_VERIFY_TOKEN") ?? "";
const SOLVE_URL    = Deno.env.get("SOLVE_WEBHOOK_URL")    ?? "";

const CHATWOOT_URL = "https://chatwoot.solveai.consulting/webhooks/whatsapp/+5511950239278";

Deno.serve(async (req: Request) => {

  // ── GET: verificação do webhook pela Meta ──────────────────────────────────
  if (req.method === "GET") {
    const params    = new URL(req.url).searchParams;
    const mode      = params.get("hub.mode");
    const token     = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      console.log("[proxy] webhook verificado pela Meta ✓");
      return new Response(challenge, { status: 200 });
    }

    return new Response("Forbidden", { status: 403 });
  }

  // ── POST: evento recebido → repassa para Chatwoot e Solve.AI ──────────────
  if (req.method === "POST") {
    const body = await req.text();

    const targets = [
      { name: "chatwoot", url: CHATWOOT_URL },
      ...(SOLVE_URL ? [{ name: "solve", url: SOLVE_URL }] : []),
    ];

    // Dispara os dois em paralelo — falha de um não afeta o outro
    const results = await Promise.allSettled(
      targets.map(({ name, url }) =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
          .then((r) => { console.log(`[proxy] → ${name} ${r.status}`); return r; })
          .catch((err) => { console.error(`[proxy] → ${name} FALHOU:`, err?.message); throw err; })
      )
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    console.log(`[proxy] concluído — ${ok}/${targets.length} destinos OK`);

    // A Meta só precisa de um 200 rápido
    return new Response("ok", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});
