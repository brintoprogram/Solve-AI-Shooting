// Supabase Edge Function — Campaign Engine
// Deploy: supabase functions deploy campaign-engine
//
// POST body: { action: "start"|"pause"|"resume"|"cancel", campaign_id: string }
//
// Security: verify_jwt=false (in config.toml), auth validated manually.
// Only users with role "admin" or "manager" can start/cancel campaigns.
//
// Rate limiting: messages processed in batches of BATCH_SIZE with a
// calculated delay between batches based on campaign.sending_speed (msg/min).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";
import { corsHeaders as getCors } from "../_shared/cors.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY          = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_BASE            = "https://graph.facebook.com/v25.0";
const BATCH_SIZE           = 20;
const PRIVILEGED_ROLES     = ["admin", "manager"];


// Service-role client for all DB operations
const db = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Audit logging ─────────────────────────────────────────────────
// fire-and-forget — never blocks the send loop

function writeAuditLog(
  workspaceId: string,
  eventType:   string,
  entityId:    string | null | undefined,
  entityType:  string | null | undefined,
  status:      "success" | "error" | "warning" | "info",
  error?:      string | null,
  metadata?:   Record<string, unknown>,
): void {
  db.from("audit_logs").insert({
    workspace_id: workspaceId,
    event_type:   eventType,
    entity_id:    entityId   ?? null,
    entity_type:  entityType ?? null,
    status,
    error:        error    ?? null,
    metadata:     metadata ?? null,
  }).then(({ error: dbErr }) => {
    if (dbErr) console.error("[audit] write error:", dbErr.message);
  });
}

// ── Helpers ───────────────────────────────────────────────


function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Auth ─────────────────────────────────────────────────

async function authorizeRequest(req: Request): Promise<
  { ok: true; userId: string } | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) return { ok: false, status: 401, error: "Token ausente" };

  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401, error: "Token inválido" };

  const { data: profile } = await db
    .from("user_profiles")
    .select("role, permissions")
    .eq("id", user.id)
    .maybeSingle();

  const role        = (profile as { role?: string; permissions?: Record<string, boolean> } | null)?.role ?? "";
  const permissions = (profile as { role?: string; permissions?: Record<string, boolean> } | null)?.permissions ?? {};

  if (!PRIVILEGED_ROLES.includes(role)) {
    return { ok: false, status: 403, error: `Permissão negada. Cargo "${role}" não autorizado.` };
  }

  if (role === "manager" && permissions.can_shoot === false) {
    return { ok: false, status: 403, error: "Permissão negada. Você não tem autorização para disparar campanhas." };
  }

  return { ok: true, userId: user.id };
}

// ── Meta API ─────────────────────────────────────────────

interface SendSuccess { wamid: string }
interface SendFailure { error: string; code: string }
type SendResult = SendSuccess | SendFailure;

async function sendTemplate(
  phoneNumberId: string,
  accessToken:   string,
  to:            string,
  templateName:  string,
  language:      string,
  components:    unknown[],
): Promise<SendResult> {
  try {
    const res = await fetch(`${META_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name:     templateName,
          language: { code: language },
          components,
        },
      }),
    });

    const data = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      const err = (data.error as Record<string, unknown>) ?? {};
      return { error: String(err.message ?? "API error"), code: String(err.code ?? res.status) };
    }

    const msgs = data.messages as Array<{ id: string }>;
    return { wamid: msgs?.[0]?.id ?? "" };
  } catch (err) {
    return { error: String(err), code: "NETWORK_ERROR" };
  }
}

// ── Variable mapping ─────────────────────────────────────
//
// column_mapping shape (set by CampaignBuilder):
//   { phone_column: "phone", body_variables: { "1": "name", "2": "empresa" } }
// recipient_data is the full contact object stored by CampaignBuilder.

interface TemplateButton { type: string; text: string; url?: string; phone_number?: string }
interface TemplateComp  { type: string; text?: string; format?: string; buttons?: TemplateButton[] }

// ── Template preview (rendered for inbox display) ─────────

interface TemplatePreview {
  name:     string;
  header?:  { format: string; text?: string };
  body?:    string;
  footer?:  string;
  buttons?: string[];
}

function buildTemplatePreview(
  tpl:         Template,
  mapping:     Record<string, unknown>,
  contactData: Record<string, unknown>,
): TemplatePreview {
  const preview: TemplatePreview = { name: tpl.template_name };
  const bodyVars   = (mapping.body_variables   ?? {}) as Record<string, string>;
  const headerVars = (mapping.header_variables  ?? {}) as Record<string, string>;

  for (const comp of tpl.components) {
    if (comp.type === "HEADER") {
      let text = comp.text ?? "";
      Object.entries(headerVars).forEach(([idx, col]) => {
        text = text.replace(new RegExp(`\\{\\{${idx}\\}\\}`, "g"), String(contactData[col] ?? ""));
      });
      preview.header = { format: comp.format ?? "TEXT", text };
    }
    if (comp.type === "BODY") {
      let text = comp.text ?? "";
      Object.entries(bodyVars).sort(([a], [b]) => Number(a) - Number(b)).forEach(([idx, col]) => {
        text = text.replace(new RegExp(`\\{\\{${idx}\\}\\}`, "g"), String(contactData[col] ?? ""));
      });
      preview.body = text;
    }
    if (comp.type === "FOOTER") {
      preview.footer = comp.text ?? "";
    }
    if (comp.type === "BUTTONS" && comp.buttons?.length) {
      preview.buttons = comp.buttons.map((b) => b.text);
    }
  }
  return preview;
}

function buildComponents(
  templateComps: TemplateComp[],
  mapping:       Record<string, unknown>,
  contactData:   Record<string, unknown>,
): unknown[] {
  const out: unknown[] = [];

  for (const comp of templateComps) {
    // ── HEADER ────────────────────────────────────────────
    if (comp.type === "HEADER" && comp.text?.includes("{{")) {
      const headerVars = (mapping.header_variables ?? {}) as Record<string, string>;
      const params = Object.entries(headerVars).map(([, col]) => ({
        type: "text",
        text: String(contactData[col] ?? ""),
      }));
      if (params.length) out.push({ type: "header", parameters: params });
    }

    // ── BODY ──────────────────────────────────────────────
    if (comp.type === "BODY" && comp.text?.includes("{{")) {
      const bodyVars = (mapping.body_variables ?? {}) as Record<string, string>;
      const params = Object.entries(bodyVars)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, col]) => ({
          type: "text",
          text: String(contactData[col] ?? ""),
        }));
      if (params.length) out.push({ type: "body", parameters: params });
    }

    // ── BUTTONS ───────────────────────────────────────────
    if (comp.type === "BUTTONS" && comp.buttons) {
      const btnVars = (mapping.button_variables ?? {}) as Record<string, Record<string, string>>;
      comp.buttons.forEach((_, bi) => {
        const btnMap = btnVars[bi] ?? {};
        const params = Object.entries(btnMap).map(([, col]) => ({
          type: "text",
          text: String(contactData[col] ?? ""),
        }));
        if (params.length) out.push({ type: "button", sub_type: "url", index: bi, parameters: params });
      });
    }
  }

  return out;
}

// ── Process one message ───────────────────────────────────

interface Message {
  id:              string;
  recipient_phone: string;
  recipient_data:  Record<string, unknown>;
  retry_count:     number;
  max_retries:     number;
}

interface Connection { phone_number_id: string; access_token: string }
interface Template   { template_name: string; language: string; components: TemplateComp[] }

// ── Inbox helpers (mirrors meta-webhook logic) ────────────

async function upsertInboxContact(workspaceId: string, phone: string, ts: string): Promise<string | null> {
  const { data: existing } = await db.from("inbox_contacts").select("id").eq("workspace_id", workspaceId).eq("phone", phone).maybeSingle();
  if (existing) return existing.id as string;
  const { data: created } = await db.from("inbox_contacts").insert({ workspace_id: workspaceId, phone, first_seen_at: ts, last_seen_at: ts }).select("id").single();
  return (created?.id as string) ?? null;
}

async function upsertInboxConversation(workspaceId: string, connectionId: string, contactId: string, ts: string, lastBody: string): Promise<string | null> {
  const { data: existing } = await db.from("inbox_conversations").select("id").eq("workspace_id", workspaceId).eq("contact_id", contactId).maybeSingle();
  if (existing) {
    await db.from("inbox_conversations").update({ last_message_at: ts, last_message_body: lastBody, last_message_direction: "outbound", updated_at: ts }).eq("id", existing.id);
    return existing.id as string;
  }
  const { data: created } = await db.from("inbox_conversations").insert({ workspace_id: workspaceId, meta_connection_id: connectionId, contact_id: contactId, status: "open", unread_count: 0, last_message_at: ts, last_message_body: lastBody, last_message_direction: "outbound" }).select("id").single();
  return (created?.id as string) ?? null;
}

async function saveTemplateToInbox(workspaceId: string, connectionId: string, phone: string, wamid: string, preview: TemplatePreview, ts: string): Promise<void> {
  try {
    const contactId = await upsertInboxContact(workspaceId, phone, ts);
    if (!contactId) return;
    const sidebarBody = `📋 ${preview.name}`;
    const convId      = await upsertInboxConversation(workspaceId, connectionId, contactId, ts, sidebarBody);
    if (!convId) return;
    await db.from("inbox_messages").upsert({
      workspace_id: workspaceId, conversation_id: convId, contact_id: contactId,
      wamid, direction: "outbound", message_type: "template",
      body: JSON.stringify(preview), // full rendered template stored as JSON
      status: "sent", created_at: ts,
    }, { onConflict: "wamid", ignoreDuplicates: true });
  } catch (err) {
    console.error("[engine] saveTemplateToInbox error:", err instanceof Error ? err.message : String(err));
  }
}

async function processMessage(
  msg:          Message,
  conn:         Connection,
  tpl:          Template,
  mapping:      Record<string, unknown>,
  campaignId:   string,
  workspaceId:  string,
  connectionId: string,
): Promise<void> {
  const components = buildComponents(tpl.components, mapping, msg.recipient_data ?? {});

  const result = await sendTemplate(
    conn.phone_number_id,
    conn.access_token,
    msg.recipient_phone,
    tpl.template_name,
    tpl.language,
    components,
  );

  const now = new Date().toISOString();

  if ("wamid" in result) {
    await db.from("shooting_messages")
      .update({ status: "sent", wamid: result.wamid, sent_at: now })
      .eq("id", msg.id);
    await db.rpc("increment_campaign_counters", {
      p_campaign_id: campaignId, p_counter_name: "sent_count",
    });

    writeAuditLog(workspaceId, "message_sent", msg.id, "shooting_message", "success", null, {
      phone: msg.recipient_phone, campaign_id: campaignId, wamid: result.wamid,
    });

    // Save outbound template to inbox with full rendered preview
    const preview = buildTemplatePreview(tpl, mapping, msg.recipient_data ?? {});
    await saveTemplateToInbox(workspaceId, connectionId, msg.recipient_phone, result.wamid, preview, now);

  } else {
    // Non-retryable Meta error codes (invalid number, opted-out, etc.)
    const NON_RETRYABLE = ["131026", "131047", "131051", "131008", "130472"];
    const retryCount    = (msg.retry_count ?? 0) + 1;
    const canRetry      = !NON_RETRYABLE.includes(result.code) && retryCount < (msg.max_retries ?? 3);

    if (canRetry) {
      await db.from("shooting_messages")
        .update({ retry_count: retryCount, error_code: result.code, error_message: result.error })
        .eq("id", msg.id);
      writeAuditLog(workspaceId, "message_retry", msg.id, "shooting_message", "warning", result.error, {
        phone: msg.recipient_phone, campaign_id: campaignId, retry_count: retryCount, code: result.code,
      });
    } else {
      await db.from("shooting_messages")
        .update({
          status:        "failed",
          failed_at:     now,
          error_code:    result.code,
          error_message: result.error,
          retry_count:   retryCount,
        })
        .eq("id", msg.id);
      await db.rpc("increment_campaign_counters", {
        p_campaign_id: campaignId, p_counter_name: "failed_count",
      });
      writeAuditLog(workspaceId, "message_failed", msg.id, "shooting_message", "error", result.error, {
        phone: msg.recipient_phone, campaign_id: campaignId, code: result.code,
      });
    }

    console.warn(`[engine] msg ${msg.id} → ${canRetry ? "retry" : "failed"}: ${result.error}`);
  }
}

// ── Campaign status check ─────────────────────────────────

async function isCampaignActive(campaignId: string): Promise<boolean> {
  const { data } = await db
    .from("shooting_campaigns")
    .select("status")
    .eq("id", campaignId)
    .single();
  return data?.status === "sending";
}

// ── Router ────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── Auth (only start/cancel need privilege check) ─────
  let body: { action: string; campaign_id: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const { action, campaign_id } = body;
  if (!action || !campaign_id) return json({ error: "action e campaign_id são obrigatórios" }, 400);

  // All mutating actions require auth
  const authResult = await authorizeRequest(req);
  if (!authResult.ok) return json({ error: authResult.error }, authResult.status);

  try {
    // ── Fetch campaign workspace + verify caller membership ────
    const { data: campMeta } = await db
      .from("shooting_campaigns")
      .select("workspace_id")
      .eq("id", campaign_id)
      .maybeSingle();
    const auditWid = (campMeta?.workspace_id as string) ?? "";

    // Verify the caller actually belongs to this campaign's workspace.
    // Prevents a manager from Workspace A triggering campaigns in Workspace B.
    if (auditWid) {
      const { data: membership } = await db
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", authResult.userId)
        .eq("workspace_id", auditWid)
        .maybeSingle();
      if (!membership) {
        return json({ error: "Você não tem acesso a esta campanha." }, 403);
      }
    }

    if (action === "pause") {
      await db.from("shooting_campaigns").update({ status: "paused" }).eq("id", campaign_id);
      writeAuditLog(auditWid, "campaign_paused", campaign_id, "campaign", "info");
      return json({ ok: true });
    }

    if (action === "resume") {
      await db.from("shooting_campaigns").update({ status: "sending" }).eq("id", campaign_id);
      writeAuditLog(auditWid, "campaign_resumed", campaign_id, "campaign", "info");
      // Fire-and-forget: re-kick the engine by starting the send loop
      startSendLoop(campaign_id); // intentionally not awaited
      return json({ ok: true, info: "resumed" });
    }

    if (action === "cancel") {
      await db.from("shooting_campaigns")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
      writeAuditLog(auditWid, "campaign_cancelled", campaign_id, "campaign", "info");
      return json({ ok: true });
    }

    if (action !== "start") return json({ error: "Ação desconhecida" }, 400);

    // ── START ──────────────────────────────────────────────────
    const { data: campaign, error: campErr } = await db
      .from("shooting_campaigns")
      .select("*, meta_connections(*), meta_templates(*)")
      .eq("id", campaign_id)
      .single();

    if (campErr || !campaign) return json({ error: "Campanha não encontrada" }, 404);

    if (!["draft", "paused"].includes(campaign.status)) {
      return json({ error: `Campanha não pode ser iniciada no status "${campaign.status}"` }, 409);
    }

    const rawConn    = campaign.meta_connections as Connection | null;
    const template   = campaign.meta_templates   as Template   | null;

    if (!rawConn) return json({ error: "Conexão WhatsApp não encontrada" }, 400);
    if (!template) return json({ error: "Template não encontrado" }, 400);

    const connection: Connection = {
      ...rawConn,
      access_token: await decrypt(rawConn.access_token),
    };

    // Mark as sending immediately so the UI updates
    await db.from("shooting_campaigns")
      .update({ status: "sending", started_at: new Date().toISOString() })
      .eq("id", campaign_id);

    const { data: pending } = await db
      .from("shooting_messages")
      .select("id")
      .eq("campaign_id", campaign_id)
      .eq("status", "pending");

    const pendingCount = (pending ?? []).length;
    if (pendingCount === 0) {
      await db.from("shooting_campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
      return json({ ok: true, processed: 0, message: "Nenhuma mensagem pendente" });
    }

    // Run the send loop and await it (edge fn stays alive until done)
    await startSendLoop(campaign_id, connection, template, campaign);

    return json({ ok: true, processed: pendingCount });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[engine] unhandled:", msg);
    return json({ error: msg }, 500);
  }
});

// ── Send loop ─────────────────────────────────────────────

async function startSendLoop(
  campaignId:  string,
  conn?:       Connection,
  tpl?:        Template,
  campaign?:   Record<string, unknown>,
): Promise<void> {
  // Fetch fresh data if not provided (used by resume)
  if (!conn || !tpl || !campaign) {
    const { data } = await db
      .from("shooting_campaigns")
      .select("*, meta_connections(*), meta_templates(*)")
      .eq("id", campaignId)
      .single();
    if (!data) return;
    const rawConn2 = data.meta_connections as Connection;
    conn     = { ...rawConn2, access_token: await decrypt(rawConn2.access_token) };
    tpl      = data.meta_templates as Template;
    campaign = data;
  }

  const mapping          = (campaign.column_mapping ?? {}) as Record<string, unknown>;
  const workspaceId      = String(campaign.workspace_id     ?? "");
  const connectionId     = String(campaign.meta_connection_id ?? "");
  const sendingSpeed     = Number(campaign.sending_speed ?? 80); // msg/min
  // Target interval per message so throughput matches user setting regardless of send latency
  const targetIntervalMs = Math.ceil(60_000 / sendingSpeed);

  console.log(`[engine] starting campaign ${campaignId} speed=${sendingSpeed}msg/min interval=${targetIntervalMs}ms/msg`);
  writeAuditLog(workspaceId, "campaign_started", campaignId, "campaign", "info", null, { sending_speed: sendingSpeed });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Stop if paused or cancelled
    if (!await isCampaignActive(campaignId)) {
      console.log(`[engine] campaign ${campaignId} stopped (status change)`);
      break;
    }

    // Fetch next batch of pending messages
    const { data: batch } = await db
      .from("shooting_messages")
      .select("id, recipient_phone, recipient_data, retry_count, max_retries")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .order("created_at")
      .limit(BATCH_SIZE);

    if (!batch || batch.length === 0) break;

    console.log(`[engine] batch size=${batch.length}`);

    // Process messages sequentially with per-message interval
    for (const msg of batch as Message[]) {
      if (!await isCampaignActive(campaignId)) break;

      const t0 = Date.now();
      await processMessage(msg, conn!, tpl!, mapping, campaignId, workspaceId, connectionId);
      const remaining = targetIntervalMs - (Date.now() - t0);
      if (remaining > 50) await sleep(remaining);
    }

    if (batch.length < BATCH_SIZE) break; // last batch — done
  }

  // Final status — only update if still "sending" (wasn't cancelled mid-way)
  const { count: remaining } = await db
    .from("shooting_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "pending");

  const { data: fresh } = await db
    .from("shooting_campaigns")
    .select("status")
    .eq("id", campaignId)
    .single();

  if (fresh?.status === "sending" && (remaining ?? 0) === 0) {
    await db.from("shooting_campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaignId);
    console.log(`[engine] campaign ${campaignId} completed`);
    writeAuditLog(workspaceId, "campaign_completed", campaignId, "campaign", "success");
  }
}
