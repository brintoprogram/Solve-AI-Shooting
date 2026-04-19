// Supabase Edge Function — test-email-connection
// POST body: { host, port, secure, username, password, from_name, from_email, workspace_id }
// Sends a test email to the from_email address to validate the SMTP config.

import { SMTPClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const { host, port, secure, username, password, from_name, from_email } = body as {
    host: string; port: number; secure: boolean;
    username: string; password: string;
    from_name: string; from_email: string;
  };

  if (!host || !username || !password || !from_email) {
    return json({ error: "host, username, password e from_email são obrigatórios" }, 400);
  }

  const client = new SMTPClient({
    connection: {
      hostname: host,
      port:     port ?? 587,
      tls:      secure ?? false,
      auth:     { username, password },
    },
  });

  try {
    await client.send({
      from:    `${from_name ?? from_email} <${from_email}>`,
      to:      from_email,
      subject: "✅ Teste de conexão SMTP — Solve AI",
      content: "Sua conexão SMTP está funcionando corretamente. Este email foi enviado como teste de configuração.",
    });
    await client.close();
    console.log(`[test-email-connection] Teste OK para ${host}:${port} / ${from_email}`);
    return json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[test-email-connection] SMTP error:", msg);
    try { await client.close(); } catch { /* ignore */ }
    return json({ error: msg }, 400);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
