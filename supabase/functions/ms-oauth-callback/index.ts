// Supabase Edge Function — ms-oauth-callback
// GET ?code=...&state=... (redirect from Microsoft after user login)
//
// state = base64(JSON.stringify({
//   workspace_id, name, from_name, from_email,
//   tenant_id, client_id, client_secret, frontend_url
// }))
//
// After success: redirects to {frontend_url}/settings?ms_oauth_success=1&conn_id={id}
// After error:   redirects to {frontend_url}/settings?ms_oauth_error={desc}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/ms-oauth-callback`;

const db = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const url     = new URL(req.url);
  const code    = url.searchParams.get("code");
  const state   = url.searchParams.get("state");
  const msError = url.searchParams.get("error");

  // Helper: redirect to frontend with error
  function redirectError(frontendUrl: string, msg: string): Response {
    return Response.redirect(
      `${frontendUrl}/settings?ms_oauth_error=${encodeURIComponent(msg)}`,
      302,
    );
  }

  let frontendUrl = "https://app";
  let stateObj: {
    workspace_id:  string;
    name:          string;
    from_name:     string;
    from_email:    string;
    tenant_id:     string;
    client_id:     string;
    client_secret: string;
    frontend_url:  string;
  };

  try {
    if (!state) throw new Error("state ausente");
    stateObj   = JSON.parse(atob(state));
    frontendUrl = stateObj.frontend_url ?? frontendUrl;
  } catch {
    return redirectError(frontendUrl, "State inválido ou expirado");
  }

  if (msError) {
    const desc = url.searchParams.get("error_description") ?? msError;
    return redirectError(frontendUrl, desc);
  }

  if (!code) {
    return redirectError(frontendUrl, "Código de autorização ausente");
  }

  const { workspace_id, name, from_name, from_email, tenant_id, client_id, client_secret } = stateObj;

  // Use 'common' tenant if none specified (supports personal + org accounts)
  const tokenTenant = tenant_id || "common";

  // Exchange authorization code for tokens
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${tokenTenant}/oauth2/v2.0/token`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        client_id,
        client_secret,
        grant_type:    "authorization_code",
        code,
        redirect_uri:  REDIRECT_URI,
        scope:         "https://graph.microsoft.com/Mail.Send offline_access",
      }),
    },
  );

  const tokenData = await tokenRes.json() as {
    access_token?:  string;
    refresh_token?: string;
    expires_in?:    number;
    error?:         string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenData.access_token) {
    const msg = tokenData.error_description ?? tokenData.error ?? "Falha na troca de código OAuth";
    return redirectError(frontendUrl, msg);
  }

  const expiresAt = new Date(
    Date.now() + (tokenData.expires_in ?? 3600) * 1000,
  ).toISOString();

  // Save connection to DB
  const { data, error } = await db
    .from("email_connections")
    .insert({
      workspace_id,
      name,
      provider:               "oauth2",
      host:                   "",
      port:                   0,
      secure:                 false,
      username:               from_email,
      password:               client_secret,
      from_name,
      from_email,
      tenant_id:              tenant_id || null,
      client_id,
      oauth_access_token:     tokenData.access_token,
      oauth_refresh_token:    tokenData.refresh_token ?? null,
      oauth_token_expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    return redirectError(frontendUrl, error?.message ?? "Erro ao salvar conexão no banco");
  }

  return Response.redirect(
    `${frontendUrl}/settings?ms_oauth_success=1&conn_id=${(data as { id: string }).id}`,
    302,
  );
});
