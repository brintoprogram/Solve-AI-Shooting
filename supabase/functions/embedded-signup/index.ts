// POST { code, waba_id, phone_number_id, workspace_id, pin? }
// 1. Exchange code → User Access Token via GET /oauth/access_token
// 2. Fetch phone number display info
// 3. Insert / update meta_connections row
// 4. POST /{waba_id}/subscribed_apps  → receive webhook events
// 5. POST /{phone_number_id}/register → register for Cloud API (if pin provided)

import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt } from "../_shared/crypto.ts";

const GRAPH = "https://graph.facebook.com/v19.0";



Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ error: "Method not allowed" }, 405);

  const APP_ID       = Deno.env.get("META_APP_ID")           ?? "";
  const APP_SECRET   = Deno.env.get("META_APP_SECRET")        ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")           ?? "";
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!APP_ID || !APP_SECRET) return json({ error: "META_APP_ID / META_APP_SECRET não configurados" }, 500);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env vars ausentes" }, 500);

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return json({ error: "JSON inválido" }, 400); }

  const code             = String(body.code             ?? "");
  const waba_id          = String(body.waba_id          ?? "");
  const phone_number_id  = String(body.phone_number_id  ?? "");
  const workspace_id     = String(body.workspace_id     ?? "");
  const pin: string | undefined = body.pin ? String(body.pin) : undefined;
  const webhook_verify_token    = crypto.randomUUID();

  if (!code || !waba_id || !phone_number_id || !workspace_id) {
    return json({ error: "code, waba_id, phone_number_id e workspace_id são obrigatórios" }, 400);
  }

  try {
    // ── 1. Exchange authorization code → access_token ────────────────
    const tokenUrl = `https://graph.facebook.com/oauth/access_token?${new URLSearchParams({
      client_id:     APP_ID,
      client_secret: APP_SECRET,
      code,
    })}`;

    console.log(`[embedded-signup] exchanging code for token…`);
    const tokenRes = await fetch(tokenUrl);
    // deno-lint-ignore no-explicit-any
    const tokenData: any = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      const msg = tokenData.error?.message ?? tokenData.error_description ?? "Erro desconhecido";
      throw new Error(`Troca de código falhou (HTTP ${tokenRes.status}): ${msg}`);
    }

    const access_token_plain = tokenData.access_token as string;
    const access_token       = await encrypt(access_token_plain);
    console.log(`[embedded-signup] token obtained and encrypted, fetching phone info…`);

    // ── 2. Fetch phone number info ────────────────────────────────────
    const phoneRes = await fetch(
      `${GRAPH}/${phone_number_id}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier&access_token=${access_token}`
    );
    // deno-lint-ignore no-explicit-any
    const phoneData: any = await phoneRes.json();

    const display_phone    = (phoneData.display_phone_number ?? "") as string;
    const business_name    = (phoneData.verified_name        ?? null) as string | null;
    const quality_rating   = (phoneData.quality_rating       ?? null) as string | null;
    const messaging_limit  = (phoneData.messaging_limit_tier ?? null) as string | null;

    // ── 3. Save to meta_connections ───────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: conn, error: dbErr } = await supabase
      .from("meta_connections")
      .insert({
        workspace_id,
        waba_id,
        phone_number_id,
        display_phone,
        business_name,
        access_token,
        token_expires_at:     null,
        webhook_verify_token,
        status:               "active",
        quality_rating,
        messaging_limit,
      })
      .select("id")
      .single();

    if (dbErr) throw new Error(`Erro ao salvar conexão: ${dbErr.message}`);
    console.log(`[embedded-signup] connection saved: ${conn?.id}`);

    // ── 4. Subscribe WABA to app webhooks ─────────────────────────────
    const subRes = await fetch(`${GRAPH}/${waba_id}/subscribed_apps`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${access_token}` },
    });
    // deno-lint-ignore no-explicit-any
    const subData: any = await subRes.json();
    if (!subRes.ok) {
      console.warn(`[embedded-signup] subscribed_apps warning (${subRes.status}): ${JSON.stringify(subData)}`);
    } else {
      console.log(`[embedded-signup] subscribed_apps OK`);
    }

    // ── 5. Register number for Cloud API (optional — only if pin given) ──
    if (pin) {
      console.log(`[embedded-signup] registering phone number…`);
      const regRes = await fetch(`${GRAPH}/${phone_number_id}/register`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ messaging_product: "whatsapp", pin }),
      });
      if (!regRes.ok) {
        // deno-lint-ignore no-explicit-any
        const regData: any = await regRes.json();
        console.warn(`[embedded-signup] register warning (${regRes.status}): ${JSON.stringify(regData)}`);
      } else {
        console.log(`[embedded-signup] register OK`);
      }
    }

    return json({ ok: true, connection_id: conn?.id, webhook_verify_token });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[embedded-signup] error:", msg);
    return json({ error: msg }, 400);
  }
});
