// Supabase Edge Function — test-email-connection
// POST body (SMTP):  { provider:"smtp",  host, port, secure, username, password, from_name, from_email }
// POST body (Graph): { provider:"graph", tenant_id, client_id, password (=client_secret), from_name, from_email }

import { SMTPClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

  const data = await res.json() as {
    access_token?: string;
    error?: string;
    error_description?: string;
    error_codes?: number[];
    suberror?: string;
  };

  console.log(`[test-email-connection] token response status=${res.status} ok=${res.ok} error=${data.error ?? "none"}`);

  if (!res.ok || !data.access_token) {
    // Erro específico para contas pessoais (erro 700016 ou AADSTS700016)
    const codes = data.error_codes ?? [];
    if (codes.includes(700016) || data.error === "invalid_client") {
      throw new Error(
        `Credenciais inválidas (client_id ou client_secret incorretos). ` +
        `Detalhes: ${data.error_description ?? data.error}`
      );
    }
    if (data.error === "unauthorized_client" || codes.includes(7000222)) {
      throw new Error(
        `App não tem permissão de Client Credentials. ` +
        `Verifique se a permissão Mail.Send (aplicativo) foi concedida como Admin no Azure. ` +
        `Detalhes: ${data.error_description ?? data.error}`
      );
    }
    throw new Error(
      `Falha ao obter token do Entra ID (HTTP ${res.status}): ` +
      (data.error_description ?? data.error ?? "Erro desconhecido")
    );
  }
  return data.access_token;
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
    const err = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    const code = err?.error?.code ?? "";
    const msg  = err?.error?.message ?? `Graph API error ${res.status}`;
    if (res.status === 403 || code === "Authorization_RequestDenied") {
      throw new Error(
        `Acesso negado pela Graph API (403). ` +
        `Verifique se a permissão Mail.Send foi concedida como "Consentimento de administrador" no Azure. ` +
        `Detalhe: ${msg}`
      );
    }
    if (res.status === 404) {
      throw new Error(
        `Caixa de email "${fromEmail}" não encontrada no tenant (404). ` +
        `Verifique se o email do remetente é uma conta válida no tenant Entra ID.`
      );
    }
    throw new Error(`Graph API (HTTP ${res.status}): ${msg}`);
  }
}

// ── Handler ───────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
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
      console.log(`[test-email-connection] Graph OK → ${from_email}`);
      return json({ ok: true });

    } else {
      const host     = String(body.host     ?? "");
      const port     = Number(body.port     ?? 587);
      const secure   = Boolean(body.secure  ?? false);
      const username = String(body.username ?? "");

      if (!host || !username || !password || !from_email) {
        return json({ error: "host, username, password e from_email são obrigatórios" }, 400);
      }

      const client = new SMTPClient({
        connection: { hostname: host, port, tls: secure, auth: { username, password } },
      });

      try {
        await client.send({
          from:    `${from_name} <${from_email}>`,
          to:      from_email,
          subject: "✅ Teste de conexão SMTP — Solve AI",
          content: "Sua conexão SMTP está funcionando corretamente. Este email foi enviado como teste de configuração.",
        });
        await client.close();
        console.log(`[test-email-connection] SMTP OK → ${host}:${port} / ${from_email}`);
        return json({ ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try { await client.close(); } catch { /* ignore */ }
        throw new Error(msg);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[test-email-connection] error:", msg);
    return json({ error: msg }, 400);
  }
});
