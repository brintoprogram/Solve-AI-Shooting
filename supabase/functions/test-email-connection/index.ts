import { corsHeaders as getCors } from "../_shared/cors.ts";
// Supabase Edge Function — test-email-connection
// POST body (SMTP):  { provider:"smtp",  host, port, secure, username, password, from_name, from_email }
// POST body (Graph): { provider:"graph", tenant_id, client_id, password (=client_secret), from_name, from_email }

import nodemailer from "npm:nodemailer@6";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireWorkspaceMember } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/ratelimit.ts";
import { createLogger, requestIdFrom } from "../_shared/logger.ts";

// Testar conexao e acao manual: 6 por minuto por workspace e folgado.
const LIMIT_PER_MINUTE = 6;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);



// ── Microsoft Graph helpers ───────────────────────────────────────

async function getGraphToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  console.log(`[test-email-connection] getGraphToken → ${tokenUrl}`);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         "https://graph.microsoft.com/.default",
      grant_type:    "client_credentials",
    }),
  });

  // deno-lint-ignore no-explicit-any
  const data: any = await res.json();

  console.log(`[test-email-connection] token status=${res.status} error=${data.error ?? "none"}`);

  if (!res.ok || !data.access_token) {
    const codes: number[] = data.error_codes ?? [];
    if (codes.includes(700016) || data.error === "invalid_client") {
      throw new Error(
        `Credenciais inválidas (client_id ou client_secret incorretos). Detalhes: ${data.error_description ?? data.error}`
      );
    }
    if (data.error === "unauthorized_client" || codes.includes(7000222)) {
      throw new Error(
        `App sem permissão Client Credentials. Conceda Mail.Send (aplicativo) como Admin no Azure. Detalhes: ${data.error_description ?? data.error}`
      );
    }
    throw new Error(
      `Falha ao obter token Entra ID (HTTP ${res.status}): ${data.error_description ?? data.error ?? "Erro desconhecido"}`
    );
  }
  return data.access_token as string;
}

async function sendViaGraph(
  token:     string,
  fromEmail: string,
  fromName:  string,
  to:        string,
  subject:   string,
  html:      string,
  cc:        string[] = [],
): Promise<void> {
  const body = {
    message: {
      subject,
      body:         { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: to } }],
      ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
      from:         { emailAddress: { address: fromEmail, name: fromName } },
    },
    saveToSentItems: true,
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`,
    {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    // deno-lint-ignore no-explicit-any
    const err: any = await res.json().catch(() => ({}));
    const code = err?.error?.code ?? "";
    const msg  = err?.error?.message ?? `Graph API error ${res.status}`;
    if (res.status === 403 || code === "Authorization_RequestDenied") {
      throw new Error(
        `Acesso negado (403). Conceda Mail.Send como "Consentimento de admin" no Azure. Detalhe: ${msg}`
      );
    }
    if (res.status === 404) {
      throw new Error(
        `Email "${fromEmail}" nao encontrado no tenant (404). Verifique se e uma conta valida no Entra ID.`
      );
    }
    throw new Error(`Graph API (HTTP ${res.status}): ${msg}`);
  }
}

// ── Handler ───────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const log = createLogger("test-email-connection", { request_id: requestIdFrom(req) });

  // ── Autenticacao ────────────────────────────────────────────────
  // Esta funcao estava PUBLICA. Como ela tenta autenticar em um SMTP/Graph
  // arbitrario e devolve a mensagem de erro do provedor, qualquer pessoa podia
  // usa-la como brute-forcer de credencial de e-mail hospedado por nos — e,
  // com uma credencial valida, como relay de spam. Agora exige sessao com
  // acesso ao workspace.
  const workspace_id = String(body.workspace_id ?? "");
  if (!workspace_id) return json({ error: "workspace_id é obrigatório" }, 400);

  const authErr = await requireWorkspaceMember(supabase, req, workspace_id);
  if (authErr) {
    log.warn("auth_rejected", { workspace_id, reason: authErr });
    return json({ error: authErr }, 401);
  }

  const wlog = log.child({ workspace_id });

  const rl = await checkRateLimit(supabase, `test-email:${workspace_id}`, LIMIT_PER_MINUTE, 60);
  if (!rl.allowed) {
    wlog.warn("rate_limited", { used: rl.used, limit: rl.limit });
    return json({ error: "Muitos testes seguidos. Aguarde um minuto." }, 429);
  }

  const provider    = String(body.provider ?? "smtp");
  const from_email  = String(body.from_email ?? "");
  const from_name   = String(body.from_name  ?? from_email);
  const password    = String(body.password   ?? "");

  try {
    if (provider === "graph") {
      const tenant_id = String(body.tenant_id ?? "");
      const client_id = String(body.client_id ?? "");

      if (!tenant_id || !client_id || !password || !from_email) {
        return json({ error: "tenant_id, client_id, password (client_secret) e from_email são obrigatórios" }, 400);
      }

      const token = await getGraphToken(tenant_id, client_id, password);
      await sendViaGraph(
        token, from_email, from_name, from_email,
        "✅ Teste Microsoft 365 — Solve AI",
        "<p>Sua conexão Microsoft 365 (Graph API) está funcionando corretamente.</p><p>Este email foi enviado como teste de configuração.</p>",
      );
      wlog.info("graph_test_ok");
      return json({ ok: true });

    } else {
      const host     = String(body.host     ?? "");
      const port     = Number(body.port     ?? 587);
      const secure   = Boolean(body.secure  ?? false);
      const username = String(body.username ?? "");

      if (!host || !username || !password || !from_email) {
        return json({ error: "host, username, password e from_email são obrigatórios" }, 400);
      }

      const transport = nodemailer.createTransport({
        host, port, secure,
        auth: { user: username, pass: password },
      });

      await transport.sendMail({
        from:    `${from_name} <${from_email}>`,
        to:      from_email,
        subject: "Teste de conexao SMTP - Solve AI",
        text:    "Sua conexao SMTP esta funcionando corretamente.",
      });
      wlog.info("smtp_test_ok", { host, port });
      return json({ ok: true });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    wlog.error("connection_test_failed", { provider, err: msg });
    return json({ error: msg }, 400);
  }
});
