// Supabase Edge Function — Email Engine
// Deploy: supabase functions deploy email-engine
//
// POST body: { action: "start"|"pause"|"resume"|"cancel", campaign_id: string }
//
// Supports two providers:
//   smtp  — sends via SMTPClient
//   graph — sends via Microsoft Graph API (Entra ID client credentials)
//
// Rate limiting: targetIntervalMs = 60_000 / sending_speed — elapsed time per message

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH_SIZE       = 10;
const PRIVILEGED_ROLES = ["admin", "manager"];

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const db = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ""));
}

// ── Auth ──────────────────────────────────────────────────────────

async function authorizeRequest(
  req: Request,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Token ausente" };

  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401, error: "Token inválido" };

  const { data: profile } = await db
    .from("user_profiles")
    .select("role, permissions")
    .eq("id", user.id)
    .maybeSingle();

  const role        = (profile as { role?: string } | null)?.role ?? "";
  const permissions = (profile as { permissions?: Record<string, boolean> } | null)?.permissions ?? {};

  if (!PRIVILEGED_ROLES.includes(role)) {
    return { ok: false, status: 403, error: `Permissão negada. Cargo "${role}" não autorizado.` };
  }
  if (role === "manager" && permissions.can_shoot === false) {
    return { ok: false, status: 403, error: "Permissão negada. Você não tem autorização para disparar campanhas." };
  }
  return { ok: true };
}

// ── Microsoft Graph helpers ───────────────────────────────────────

async function getGraphToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         "https://graph.microsoft.com/.default",
        grant_type:    "client_credentials",
      }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "Falha ao obter token do Entra ID");
  }
  return data.access_token as string;
}

async function refreshOAuthToken(
  connId:       string,
  tenantId:     string | null,
  clientId:     string | null,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const tenant = tenantId || "common";
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        client_id:     clientId ?? "",
        client_secret: clientSecret,
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
        scope:         "https://graph.microsoft.com/Mail.Send offline_access",
      }),
    },
  );
  const data = await res.json() as {
    access_token?:  string;
    refresh_token?: string;
    expires_in?:    number;
    error?:         string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "Falha ao renovar token OAuth2");
  }
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  await db.from("email_connections").update({
    oauth_access_token:     data.access_token,
    oauth_refresh_token:    data.refresh_token ?? refreshToken,
    oauth_token_expires_at: expiresAt,
  }).eq("id", connId);
  return data.access_token;
}

async function sendViaGraph(
  token:     string,
  fromEmail: string,
  fromName:  string,
  to:        string,
  toName:    string | null,
  subject:   string,
  html:      string,
  cc:        string[],
  delegated: boolean,
): Promise<void> {
  const body = {
    message: {
      subject,
      body:         { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: to, name: toName ?? to } }],
      ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
      from:         { emailAddress: { address: fromEmail, name: fromName } },
    },
    saveToSentItems: true,
  };

  // Delegated (oauth2): /me/sendMail — token is already bound to the user
  // Client credentials (graph): /users/{email}/sendMail
  const endpoint = delegated
    ? "https://graph.microsoft.com/v1.0/me/sendMail"
    : `https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`;

  const res = await fetch(endpoint, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } })?.error?.message ?? `Graph API error ${res.status}`);
  }
}

// ── Config types ──────────────────────────────────────────────────

interface EmailConnConfig {
  id:         string;
  provider:   string;
  host:       string; port: number; secure: boolean;
  username:   string; password: string;
  from_name:  string; from_email: string;
  tenant_id:  string | null;
  client_id:  string | null;
  oauth_access_token:     string | null;
  oauth_refresh_token:    string | null;
  oauth_token_expires_at: string | null;
}

interface EmailMessage {
  id:              string;
  recipient_email: string;
  recipient_name:  string | null;
  recipient_data:  Record<string, unknown>;
  cc_emails:       string[];
  retry_count:     number;
  max_retries:     number;
}

// ── Send one email ────────────────────────────────────────────────

async function sendEmail(
  conn:       EmailConnConfig,
  msg:        EmailMessage,
  subject:    string,
  bodyHtml:   string,
  graphToken: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const data          = { ...msg.recipient_data, email: msg.recipient_email, nome: msg.recipient_name ?? msg.recipient_email };
  const finalSubject  = interpolate(subject, data);
  const finalHtml     = interpolate(bodyHtml, data);

  try {
    if (conn.provider === "graph" || conn.provider === "oauth2") {
      if (!graphToken) throw new Error("Graph token ausente");
      await sendViaGraph(
        graphToken,
        conn.from_email, conn.from_name,
        msg.recipient_email, msg.recipient_name,
        finalSubject, finalHtml,
        msg.cc_emails,
        conn.provider === "oauth2",
      );
    } else {
      const transport = nodemailer.createTransport({
        host:   conn.host,
        port:   conn.port,
        secure: conn.secure,
        auth:   { user: conn.username, pass: conn.password },
      });
      await transport.sendMail({
        from:    `${conn.from_name} <${conn.from_email}>`,
        to:      msg.recipient_name ? `${msg.recipient_name} <${msg.recipient_email}>` : msg.recipient_email,
        cc:      msg.cc_emails.length > 0 ? msg.cc_emails : undefined,
        subject: finalSubject,
        html:    finalHtml,
        text:    finalHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Process one email_message row ────────────────────────────────

async function processMessage(
  msg:        EmailMessage,
  conn:       EmailConnConfig,
  campaignId: string,
  subject:    string,
  bodyHtml:   string,
  graphToken: string | null,
): Promise<void> {
  const now    = new Date().toISOString();
  const result = await sendEmail(conn, msg, subject, bodyHtml, graphToken);

  if (result.ok) {
    await db.from("email_messages")
      .update({ status: "sent", sent_at: now })
      .eq("id", msg.id);

    const { data: camp } = await db.from("email_campaigns").select("sent_count").eq("id", campaignId).single();
    if (camp) await db.from("email_campaigns")
      .update({ sent_count: ((camp as { sent_count: number }).sent_count ?? 0) + 1 })
      .eq("id", campaignId);

    console.log(`[email-engine] ✓ sent to ${msg.recipient_email}`);
  } else {
    const retryCount = (msg.retry_count ?? 0) + 1;
    const canRetry   = retryCount < (msg.max_retries ?? 2);

    if (canRetry) {
      await db.from("email_messages")
        .update({ retry_count: retryCount, error_message: result.error })
        .eq("id", msg.id);
    } else {
      await db.from("email_messages")
        .update({ status: "failed", failed_at: now, error_message: result.error, retry_count: retryCount })
        .eq("id", msg.id);

      const { data: camp } = await db.from("email_campaigns").select("failed_count").eq("id", campaignId).single();
      if (camp) await db.from("email_campaigns")
        .update({ failed_count: ((camp as { failed_count: number }).failed_count ?? 0) + 1 })
        .eq("id", campaignId);
    }

    console.warn(`[email-engine] ✗ ${msg.recipient_email}: ${result.error}`);
  }
}

// ── Campaign status check ─────────────────────────────────────────

async function isCampaignActive(campaignId: string): Promise<boolean> {
  const { data } = await db
    .from("email_campaigns")
    .select("status")
    .eq("id", campaignId)
    .single();
  return data?.status === "sending";
}

// ── Send loop ─────────────────────────────────────────────────────

async function startSendLoop(
  campaignId:  string,
  connArg?:    EmailConnConfig,
  campaignArg?: Record<string, unknown>,
): Promise<void> {
  let conn     = connArg;
  let campaign = campaignArg;

  if (!conn || !campaign) {
    const { data } = await db
      .from("email_campaigns")
      .select("*, email_connections(id,provider,host,port,secure,username,password,from_name,from_email,tenant_id,client_id,oauth_access_token,oauth_refresh_token,oauth_token_expires_at)")
      .eq("id", campaignId)
      .single();
    if (!data) return;
    campaign = data as Record<string, unknown>;
    conn     = data.email_connections as EmailConnConfig;
  }

  if (!conn) {
    console.error(`[email-engine] no connection config for campaign ${campaignId}`);
    await db.from("email_campaigns").update({ status: "failed" }).eq("id", campaignId);
    return;
  }

  const subject      = String(campaign.subject      ?? "");
  const bodyHtml     = String(campaign.body_html    ?? "");
  const sendingSpeed = Number(campaign.sending_speed ?? 60);
  const targetIntervalMs = Math.ceil(60_000 / sendingSpeed);

  // Fetch Graph token once — valid ~1h, enough for a full campaign run
  let graphToken: string | null = null;
  if (conn.provider === "graph") {
    try {
      graphToken = await getGraphToken(conn.tenant_id!, conn.client_id!, conn.password);
      console.log(`[email-engine] Graph token obtained for campaign ${campaignId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[email-engine] Failed to get Graph token: ${msg}`);
      await db.from("email_campaigns").update({ status: "failed" }).eq("id", campaignId);
      return;
    }
  } else if (conn.provider === "oauth2") {
    try {
      const expiresAt  = conn.oauth_token_expires_at ? new Date(conn.oauth_token_expires_at).getTime() : 0;
      const needsRefresh = expiresAt - Date.now() < 5 * 60 * 1000; // refresh if < 5 min left
      if (needsRefresh && conn.oauth_refresh_token) {
        graphToken = await refreshOAuthToken(conn.id, conn.tenant_id, conn.client_id, conn.password, conn.oauth_refresh_token);
        console.log(`[email-engine] OAuth2 token refreshed for campaign ${campaignId}`);
      } else {
        graphToken = conn.oauth_access_token;
        if (!graphToken) throw new Error("oauth_access_token ausente e sem refresh_token");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[email-engine] Failed to get OAuth2 token: ${msg}`);
      await db.from("email_campaigns").update({ status: "failed" }).eq("id", campaignId);
      return;
    }
  }

  console.log(`[email-engine] starting campaign ${campaignId} provider=${conn.provider} speed=${sendingSpeed}/min interval=${targetIntervalMs}ms/msg`);

  while (true) {
    if (!await isCampaignActive(campaignId)) {
      console.log(`[email-engine] campaign ${campaignId} stopped (status change)`);
      break;
    }

    const { data: batch } = await db
      .from("email_messages")
      .select("id,recipient_email,recipient_name,recipient_data,cc_emails,retry_count,max_retries")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .order("created_at")
      .limit(BATCH_SIZE);

    if (!batch || batch.length === 0) break;

    console.log(`[email-engine] batch size=${batch.length}`);

    for (const msg of batch as EmailMessage[]) {
      if (!await isCampaignActive(campaignId)) break;

      const t0 = Date.now();
      await processMessage(msg, conn, campaignId, subject, bodyHtml, graphToken);
      const remaining = targetIntervalMs - (Date.now() - t0);
      if (remaining > 50) await sleep(remaining);
    }

    if (batch.length < BATCH_SIZE) break;
  }

  // Mark completed if all done and still sending
  const { count: remaining } = await db
    .from("email_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "pending");

  const { data: fresh } = await db
    .from("email_campaigns")
    .select("status")
    .eq("id", campaignId)
    .single();

  if (fresh?.status === "sending" && (remaining ?? 0) === 0) {
    await db.from("email_campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaignId);
    console.log(`[email-engine] campaign ${campaignId} completed`);
  }
}

// ── Router ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  let body: { action: string; campaign_id: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const { action, campaign_id } = body;
  if (!action || !campaign_id) return json({ error: "action e campaign_id são obrigatórios" }, 400);

  const auth = await authorizeRequest(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  try {
    if (action === "pause") {
      await db.from("email_campaigns").update({ status: "paused" }).eq("id", campaign_id);
      return json({ ok: true });
    }

    if (action === "resume") {
      await db.from("email_campaigns").update({ status: "sending" }).eq("id", campaign_id);
      startSendLoop(campaign_id); // fire-and-forget
      return json({ ok: true, info: "resumed" });
    }

    if (action === "cancel") {
      await db.from("email_campaigns")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
      return json({ ok: true });
    }

    if (action !== "start") return json({ error: "Ação desconhecida" }, 400);

    // ── START ─────────────────────────────────────────────────
    const { data: campaign, error: campErr } = await db
      .from("email_campaigns")
      .select("*, email_connections(id,provider,host,port,secure,username,password,from_name,from_email,tenant_id,client_id,oauth_access_token,oauth_refresh_token,oauth_token_expires_at)")
      .eq("id", campaign_id)
      .single();

    if (campErr || !campaign) return json({ error: "Campanha não encontrada" }, 404);

    if (!["draft", "paused"].includes(campaign.status)) {
      return json({ error: `Campanha não pode ser iniciada no status "${campaign.status}"` }, 409);
    }

    const conn = campaign.email_connections as EmailConnConfig | null;
    if (!conn) return json({ error: "Conexão de email não encontrada" }, 400);

    const { count: pendingCount } = await db
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign_id)
      .eq("status", "pending");

    if (!pendingCount || pendingCount === 0) {
      await db.from("email_campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
      return json({ ok: true, processed: 0, message: "Nenhuma mensagem pendente" });
    }

    await db.from("email_campaigns")
      .update({ status: "sending", started_at: new Date().toISOString() })
      .eq("id", campaign_id);

    await startSendLoop(campaign_id, conn, campaign as unknown as Record<string, unknown>);

    return json({ ok: true, processed: pendingCount });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email-engine] unhandled:", msg);
    return json({ error: msg }, 500);
  }
});
