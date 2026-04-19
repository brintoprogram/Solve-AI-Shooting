// Supabase Edge Function — Email Engine
// Deploy: supabase functions deploy email-engine
//
// POST body: { action: "start"|"pause"|"resume"|"cancel", campaign_id: string }
//
// Mirrors campaign-engine but sends via SMTP instead of Meta Cloud API.
// Rate limiting: BATCH_SIZE emails per batch, delay = (BATCH_SIZE / sending_speed) * 60s

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient }   from "https://deno.land/x/smtp@v0.7.0/mod.ts";

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

// Replace {{variavel}} with contact data values
function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ""));
}

// ── Auth (same as campaign-engine) ───────────────────────────────

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

// ── SMTP send (one email) ─────────────────────────────────────────

interface SmtpConfig {
  host: string; port: number; secure: boolean;
  username: string; password: string;
  from_name: string; from_email: string;
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

async function sendEmail(
  smtp:    SmtpConfig,
  msg:     EmailMessage,
  subject: string,
  bodyHtml: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const data        = { ...msg.recipient_data, email: msg.recipient_email, nome: msg.recipient_name ?? msg.recipient_email };
  const finalSubject = interpolate(subject, data);
  const finalHtml    = interpolate(bodyHtml, data);

  const client = new SMTPClient({
    connection: {
      hostname: smtp.host,
      port:     smtp.port,
      tls:      smtp.secure,
      auth:     { username: smtp.username, password: smtp.password },
    },
  });

  try {
    await client.send({
      from:    `${smtp.from_name} <${smtp.from_email}>`,
      to:      msg.recipient_name ? `${msg.recipient_name} <${msg.recipient_email}>` : msg.recipient_email,
      cc:      msg.cc_emails.length > 0 ? msg.cc_emails.join(", ") : undefined,
      subject: finalSubject,
      html:    finalHtml,
      content: finalHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), // plain-text fallback
    });
    await client.close();
    return { ok: true };
  } catch (err) {
    try { await client.close(); } catch { /* ignore */ }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Process one email_message row ────────────────────────────────

async function processMessage(
  msg:        EmailMessage,
  smtp:       SmtpConfig,
  campaignId: string,
  subject:    string,
  bodyHtml:   string,
): Promise<void> {
  const now    = new Date().toISOString();
  const result = await sendEmail(smtp, msg, subject, bodyHtml);

  if (result.ok) {
    await db.from("email_messages")
      .update({ status: "sent", sent_at: now })
      .eq("id", msg.id);

    // Safe read-modify-write: messages are processed sequentially, no race condition
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

async function startSendLoop(campaignId: string, smtpArg?: SmtpConfig, campaignArg?: Record<string, unknown>): Promise<void> {
  let smtp     = smtpArg;
  let campaign = campaignArg;

  if (!smtp || !campaign) {
    const { data } = await db
      .from("email_campaigns")
      .select("*, email_connections(*)")
      .eq("id", campaignId)
      .single();
    if (!data) return;
    campaign = data as Record<string, unknown>;
    smtp     = data.email_connections as SmtpConfig;
  }

  if (!smtp) {
    console.error(`[email-engine] no SMTP config for campaign ${campaignId}`);
    await db.from("email_campaigns").update({ status: "failed" }).eq("id", campaignId);
    return;
  }

  const subject      = String(campaign.subject      ?? "");
  const bodyHtml     = String(campaign.body_html    ?? "");
  const sendingSpeed = Number(campaign.sending_speed ?? 60);
  // Target interval between messages (ms). We subtract actual send time so
  // throughput matches what the user configured, regardless of SMTP latency.
  const targetIntervalMs = Math.ceil(60_000 / sendingSpeed);

  console.log(`[email-engine] starting campaign ${campaignId} speed=${sendingSpeed}/min interval=${targetIntervalMs}ms/msg`);

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
      await processMessage(msg, smtp, campaignId, subject, bodyHtml);
      // Sleep only the remaining time so total time per message ≈ targetIntervalMs
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
    // ── Quick actions ─────────────────────────────────────────
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
      .select("*, email_connections(*)")
      .eq("id", campaign_id)
      .single();

    if (campErr || !campaign) return json({ error: "Campanha não encontrada" }, 404);

    if (!["draft", "paused"].includes(campaign.status)) {
      return json({ error: `Campanha não pode ser iniciada no status "${campaign.status}"` }, 409);
    }

    const smtp = campaign.email_connections as SmtpConfig | null;
    if (!smtp) return json({ error: "Conexão SMTP não encontrada" }, 400);

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

    await startSendLoop(campaign_id, smtp, campaign as unknown as Record<string, unknown>);

    return json({ ok: true, processed: pendingCount });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email-engine] unhandled:", msg);
    return json({ error: msg }, 500);
  }
});
