// Supabase Edge Function — Embedded Signup (conexão do número do cliente)
//
// POST { code, waba_id, phone_number_id?, workspace_id, coexistence?, pin? }
//
//   1. Troca o code por um User Access Token
//   2. Descobre o phone_number_id quando ele não veio (caminho Coexistence)
//   3. Busca dados do número
//   4. Grava/atualiza meta_connections
//   5. Assina a WABA nos webhooks do app
//   6. Registra o número na Cloud API — PULADO em Coexistence (já registrado)
//
// Coexistence: o cliente mantém o app WhatsApp Business no celular E ganha a
// Cloud API no mesmo número. O fluxo devolve só o waba_id (sem
// phone_number_id) e não passa por registro de número.
//
// Histórico de correções (a versão anterior nunca funcionou):
//   - `getCors` era usado sem import → ReferenceError em toda requisição
//   - as 3 chamadas à Graph usavam o token CIFRADO em vez do texto plano
//   - o token ia na query string, onde vaza para logs de proxy
//   - não havia autenticação: qualquer um podia injetar uma conexão em
//     qualquer workspace passando o workspace_id de outra pessoa

// esm.sh (e não npm:) para bater com o tipo usado em _shared/*. Misturar as
// duas origens cria dois SupabaseClient incompatíveis entre si.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encrypt } from "../_shared/crypto.ts";
import { corsHeaders as getCors } from "../_shared/cors.ts";
import { requireWorkspaceMember } from "../_shared/auth.ts";
import { createLogger, requestIdFrom } from "../_shared/logger.ts";

const GRAPH = "https://graph.facebook.com/v25.0";

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ error: "Method not allowed" }, 405);

  const log = createLogger("embedded-signup", { request_id: requestIdFrom(req) });

  const APP_ID       = Deno.env.get("META_APP_ID")               ?? "";
  const APP_SECRET   = Deno.env.get("META_APP_SECRET")           ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")              ?? "";
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!APP_ID || !APP_SECRET) {
    log.fatal("missing_meta_env");
    return json({ error: "Integração com a Meta não está configurada no servidor." }, 500);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    log.fatal("missing_supabase_env");
    return json({ error: "Configuração do servidor incompleta." }, 500);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "JSON inválido" }, 400); }

  const code            = String(body.code            ?? "");
  const waba_id         = String(body.waba_id         ?? "");
  const workspace_id    = String(body.workspace_id    ?? "");
  const coexistence     = body.coexistence === true;
  const pin: string | undefined = body.pin ? String(body.pin) : undefined;
  let   phone_number_id = String(body.phone_number_id ?? "");

  // Em Coexistence a Meta devolve só o waba_id — o número é descoberto depois.
  if (!code || !waba_id || !workspace_id) {
    return json({ error: "code, waba_id e workspace_id são obrigatórios" }, 400);
  }
  if (!coexistence && !phone_number_id) {
    return json({ error: "phone_number_id é obrigatório fora do fluxo de coexistência" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Sem isto, qualquer pessoa com um code próprio poderia anexar o próprio
  // WhatsApp ao workspace de outro cliente.
  const authErr = await requireWorkspaceMember(supabase, req, workspace_id);
  if (authErr) {
    log.warn("auth_rejected", { workspace_id, reason: authErr });
    return json({ error: authErr }, 401);
  }

  const wlog = log.child({ workspace_id });
  wlog.info("signup_started", { coexistence, has_phone_number_id: !!phone_number_id });

  const webhook_verify_token = crypto.randomUUID();

  try {
    // ── 1. code → access token ───────────────────────────────────────
    const tokenRes = await fetch(
      `https://graph.facebook.com/oauth/access_token?${new URLSearchParams({
        client_id: APP_ID, client_secret: APP_SECRET, code,
      })}`,
    );
    const tokenData = await tokenRes.json() as Record<string, unknown>;

    if (!tokenRes.ok || !tokenData.access_token) {
      const detail = (tokenData.error as { message?: string })?.message ?? String(tokenData.error_description ?? "");
      wlog.error("token_exchange_failed", { http_status: tokenRes.status, detail });
      return json({ error: "A Meta recusou a autorização. Refaça a conexão." }, 400);
    }

    // TEXTO PLANO para falar com a Graph; a versão cifrada só vai para o banco.
    const tokenPlain = tokenData.access_token as string;
    const tokenStored = await encrypt(tokenPlain);
    // Sempre no header Authorization: token em query string vaza em log de proxy.
    const authHeader = { Authorization: `Bearer ${tokenPlain}` };
    wlog.info("token_exchanged");

    // ── 2. Coexistence: descobrir o número da WABA ───────────────────
    if (!phone_number_id) {
      const listRes  = await fetch(`${GRAPH}/${waba_id}/phone_numbers?fields=id,display_phone_number`, { headers: authHeader });
      const listData = await listRes.json() as { data?: Array<{ id: string; display_phone_number?: string }> };

      if (!listRes.ok || !listData.data?.length) {
        wlog.error("phone_discovery_failed", { http_status: listRes.status, waba_id });
        return json({ error: "Não foi possível identificar o número nesta conta do WhatsApp Business." }, 400);
      }
      phone_number_id = listData.data[0].id;
      wlog.info("phone_discovered", { count: listData.data.length });
    }

    // ── 3. Dados do número ───────────────────────────────────────────
    const phoneRes = await fetch(
      `${GRAPH}/${phone_number_id}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
      { headers: authHeader },
    );
    const phoneData = await phoneRes.json() as Record<string, unknown>;
    if (!phoneRes.ok) {
      // Não é fatal: dá para salvar a conexão e completar os dados depois.
      wlog.warn("phone_info_failed", { http_status: phoneRes.status });
    }

    // ── 4. Persistir a conexão ───────────────────────────────────────
    // upsert: reconectar o mesmo número deve atualizar, não duplicar nem falhar.
    const { data: conn, error: dbErr } = await supabase
      .from("meta_connections")
      .upsert({
        workspace_id,
        waba_id,
        phone_number_id,
        display_phone:    (phoneData.display_phone_number ?? "") as string,
        business_name:    (phoneData.verified_name        ?? null) as string | null,
        access_token:     tokenStored,
        token_expires_at: null,
        webhook_verify_token,
        status:           "active",
        quality_rating:   (phoneData.quality_rating       ?? null) as string | null,
        messaging_limit:  (phoneData.messaging_limit_tier ?? null) as string | null,
      // A constraint única é composta: (workspace_id, phone_number_id). Assim o
      // mesmo número pode existir em workspaces diferentes, e reconectar no
      // mesmo workspace atualiza a linha em vez de duplicar.
      }, { onConflict: "workspace_id,phone_number_id" })
      .select("id")
      .single();

    if (dbErr) {
      wlog.fatal("connection_save_failed", { err: dbErr.message, code: dbErr.code });
      return json({ error: "Não foi possível salvar a conexão. Tente novamente." }, 500);
    }
    wlog.info("connection_saved", { connection_id: conn?.id, coexistence });

    // ── 5. Assinar a WABA nos webhooks ───────────────────────────────
    // Sem isto nenhuma mensagem chega. Falha aqui não desfaz a conexão —
    // o passo "Receber a primeira mensagem" do guia vai acusar o problema.
    const subRes = await fetch(`${GRAPH}/${waba_id}/subscribed_apps`, { method: "POST", headers: authHeader });
    if (!subRes.ok) {
      const subBody = await subRes.text().catch(() => "");
      wlog.error("webhook_subscribe_failed", { http_status: subRes.status, detail: subBody.slice(0, 200) });
    } else {
      wlog.info("webhook_subscribed");
    }

    // ── 6. Registrar na Cloud API ────────────────────────────────────
    // Em Coexistence o número JÁ está registrado (segue no app do cliente);
    // chamar /register aqui derrubaria o app dele.
    if (coexistence) {
      wlog.info("register_skipped_coexistence");
    } else if (pin) {
      const regRes = await fetch(`${GRAPH}/${phone_number_id}/register`, {
        method:  "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body:    JSON.stringify({ messaging_product: "whatsapp", pin }),
      });
      if (!regRes.ok) {
        const regBody = await regRes.text().catch(() => "");
        wlog.error("register_failed", { http_status: regRes.status, detail: regBody.slice(0, 200) });
      } else {
        wlog.info("register_ok");
      }
    }

    return json({ ok: true, connection_id: conn?.id, coexistence, webhook_verify_token });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    wlog.fatal("unhandled_error", { err: msg });
    return json({ error: "Erro inesperado ao conectar. Tente novamente em instantes." }, 500);
  }
});
