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
const Z_API_BASE           = "https://api.z-api.io/instances";
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

function substituteVars(
  template:    string,
  vars:        Record<string, string>,
  contactData: Record<string, unknown>,
): string {
  let result = template;
  for (const [idx, col] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${idx}\\}\\}`, "g"), String(contactData[col] ?? ""));
  }
  return result;
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

// ── Z-API ─────────────────────────────────────────────────

interface ZApiConnection {
  id:           string;
  instance_id:  string;
  token:        string;        // decrypted
  client_token: string;        // decrypted
}

interface ZApiTemplateData {
  id:           string;
  message_type: "text" | "button_list";
  header_text:  string | null;
  body:         string;
  footer:       string | null;
  buttons:      Array<{ id: string; label: string }>;
}

interface ZApiSendResult {
  zaapId?:   string;
  error?:    string;
  retryable?: boolean;
}

async function sendZApiMessage(
  instanceId:  string,
  token:       string,
  clientToken: string,
  phone:       string,
  message:     string,
): Promise<ZApiSendResult> {
  const cleanPhone = phone.replace(/\D/g, "");
  try {
    const res = await fetch(`${Z_API_BASE}/${instanceId}/token/${token}/send-text`, {
      method:  "POST",
      headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
      body:    JSON.stringify({ phone: cleanPhone, message }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return { error: String(data.error ?? data.message ?? `HTTP ${res.status}`), retryable: res.status >= 500 };
    }
    const id = String(data.zaapId ?? data.messageId ?? data.id ?? "");
    if (id) return { zaapId: id };
    return { error: String(data.error ?? data.message ?? "Unknown Z-API response"), retryable: false };
  } catch (err) {
    return { error: String(err), retryable: true };
  }
}

async function sendZApiButtonList(
  instanceId:  string,
  token:       string,
  clientToken: string,
  phone:       string,
  message:     string,
  title:       string | null,
  footer:      string | null,
  buttons:     Array<{ id: string; label: string }>,
): Promise<ZApiSendResult> {
  const cleanPhone = phone.replace(/\D/g, "");
  try {
    const body: Record<string, unknown> = {
      phone: cleanPhone,
      message,
      buttonList: { buttons },
    };
    if (title)  body.title  = title;
    if (footer) body.footer = footer;

    const res = await fetch(`${Z_API_BASE}/${instanceId}/token/${token}/send-button-list`, {
      method:  "POST",
      headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return { error: String(data.error ?? data.message ?? `HTTP ${res.status}`), retryable: res.status >= 500 };
    }
    const id = String(data.zaapId ?? data.messageId ?? data.id ?? "");
    if (id) return { zaapId: id };
    return { error: String(data.error ?? data.message ?? "Unknown Z-API response"), retryable: false };
  } catch (err) {
    return { error: String(err), retryable: true };
  }
}

function buildZApiText(
  body:        string,
  mapping:     Record<string, unknown>,
  contactData: Record<string, unknown>,
  tpl?:        ZApiTemplateData | null,
): string {
  const bodyVars   = (mapping.body_variables  ?? {}) as Record<string, string>;
  const headerVars = (mapping.header_variables ?? {}) as Record<string, string>;
  const footerVars = (mapping.footer_variables ?? {}) as Record<string, string>;

  const text = substituteVars(body, bodyVars, contactData);

  // For plain text type: embed header/footer as markdown with variable substitution
  if (tpl && tpl.message_type === "text") {
    const parts: string[] = [];
    if (tpl.header_text) parts.push(`*${substituteVars(tpl.header_text, headerVars, contactData)}*`);
    parts.push(text);
    if (tpl.footer) parts.push(`_${substituteVars(tpl.footer, footerVars, contactData)}_`);
    return parts.join("\n\n");
  }
  return text;
}

async function processZApiMessage(
  msg:         Message,
  zConn:       ZApiConnection,
  messageBody: string,
  mapping:     Record<string, unknown>,
  campaignId:  string,
  workspaceId: string,
  tpl?:        ZApiTemplateData | null,
): Promise<void> {
  const text = buildZApiText(messageBody, mapping, msg.recipient_data ?? {}, tpl);

  let result: ZApiSendResult;
  if (tpl?.message_type === "button_list" && tpl.buttons.length > 0) {
    const headerVars = (mapping.header_variables ?? {}) as Record<string, string>;
    const footerVars = (mapping.footer_variables ?? {}) as Record<string, string>;
    const contact    = msg.recipient_data ?? {};
    result = await sendZApiButtonList(
      zConn.instance_id, zConn.token, zConn.client_token,
      msg.recipient_phone, text,
      tpl.header_text ? substituteVars(tpl.header_text, headerVars, contact) : null,
      tpl.footer      ? substituteVars(tpl.footer,      footerVars, contact) : null,
      tpl.buttons,
    );
  } else {
    result = await sendZApiMessage(zConn.instance_id, zConn.token, zConn.client_token, msg.recipient_phone, text);
  }
  const now    = new Date().toISOString();

  if (result.zaapId) {
    await db.from("shooting_messages")
      .update({ status: "sent", wamid: result.zaapId, sent_at: now })
      .eq("id", msg.id);
    await db.rpc("increment_campaign_counters", { p_campaign_id: campaignId, p_counter_name: "sent_count" });
    writeAuditLog(workspaceId, "message_sent", msg.id, "shooting_message", "success", null, {
      phone: msg.recipient_phone, campaign_id: campaignId, zaap_id: result.zaapId,
    });
    await saveZApiMessageToInbox(workspaceId, zConn.id, msg.recipient_phone, result.zaapId, text, now);
  } else {
    const retryCount = (msg.retry_count ?? 0) + 1;
    const canRetry   = (result.retryable ?? false) && retryCount < (msg.max_retries ?? 3);
    if (canRetry) {
      await db.from("shooting_messages")
        .update({ retry_count: retryCount, error_message: result.error })
        .eq("id", msg.id);
      writeAuditLog(workspaceId, "message_retry", msg.id, "shooting_message", "warning", result.error, {
        phone: msg.recipient_phone, campaign_id: campaignId, retry_count: retryCount,
      });
    } else {
      await db.from("shooting_messages")
        .update({ status: "failed", failed_at: now, error_message: result.error, retry_count: retryCount })
        .eq("id", msg.id);
      await db.rpc("increment_campaign_counters", { p_campaign_id: campaignId, p_counter_name: "failed_count" });
      writeAuditLog(workspaceId, "message_failed", msg.id, "shooting_message", "error", result.error, {
        phone: msg.recipient_phone, campaign_id: campaignId,
      });
    }
    console.warn(`[engine] z-api msg ${msg.id} → ${canRetry ? "retry" : "failed"}: ${result.error}`);
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

async function upsertZApiConversation(workspaceId: string, zApiConnectionId: string, contactId: string, ts: string, lastBody: string): Promise<string | null> {
  const { data: existing } = await db.from("inbox_conversations").select("id").eq("workspace_id", workspaceId).eq("contact_id", contactId).eq("z_api_connection_id", zApiConnectionId).maybeSingle();
  if (existing) {
    await db.from("inbox_conversations").update({ last_message_at: ts, last_message_body: lastBody, last_message_direction: "outbound", updated_at: ts }).eq("id", existing.id);
    return existing.id as string;
  }
  const { data: created } = await db.from("inbox_conversations").insert({ workspace_id: workspaceId, z_api_connection_id: zApiConnectionId, contact_id: contactId, status: "open", unread_count: 0, last_message_at: ts, last_message_body: lastBody, last_message_direction: "outbound" }).select("id").single();
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

async function saveZApiMessageToInbox(
  workspaceId:     string,
  zApiConnectionId: string,
  phone:           string,
  zaapId:          string,
  body:            string,
  ts:              string,
): Promise<void> {
  try {
    const contactId = await upsertInboxContact(workspaceId, phone, ts);
    if (!contactId) return;
    const convId = await upsertZApiConversation(workspaceId, zApiConnectionId, contactId, ts, body);
    if (!convId) return;
    await db.from("inbox_messages").upsert({
      workspace_id:    workspaceId,
      conversation_id: convId,
      contact_id:      contactId,
      wamid:           zaapId,
      direction:       "outbound",
      message_type:    "text",
      body,
      status:          "sent",
      created_at:      ts,
      sent_at:         ts,
    }, { onConflict: "wamid", ignoreDuplicates: true });
  } catch (err) {
    console.error("[engine] saveZApiMessageToInbox error:", err instanceof Error ? err.message : String(err));
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
      // Atomic: only pauses if currently "sending" — prevents corrupting other statuses
      const { data: paused } = await db.from("shooting_campaigns")
        .update({ status: "paused" })
        .eq("id", campaign_id)
        .eq("status", "sending")
        .select("id")
        .maybeSingle();
      if (!paused) return json({ error: "Campanha não está em andamento" }, 409);
      writeAuditLog(auditWid, "campaign_paused", campaign_id, "campaign", "info");
      return json({ ok: true });
    }

    if (action === "resume") {
      // Atomic: only resumes if currently "paused" — prevents spawning duplicate send loops
      // on double-click or concurrent requests
      const { data: resumed } = await db.from("shooting_campaigns")
        .update({ status: "sending" })
        .eq("id", campaign_id)
        .eq("status", "paused")
        .select("id")
        .maybeSingle();
      if (!resumed) return json({ error: "Campanha não está pausada" }, 409);
      writeAuditLog(auditWid, "campaign_resumed", campaign_id, "campaign", "info");
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
    // Atomic status claim: update + fetch in one request, only if status allows starting.
    // Prevents double-start race condition where two concurrent requests both pass a
    // read-then-check pattern and both launch send loops.
    const { data: campaign, error: campErr } = await db
      .from("shooting_campaigns")
      .update({ status: "sending", started_at: new Date().toISOString() })
      .eq("id", campaign_id)
      .in("status", ["draft", "paused"])
      .select("*, meta_connections(*), meta_templates(*), z_api_connections(*)")
      .maybeSingle();

    if (campErr) return json({ error: campErr.message }, 500);
    if (!campaign) {
      const { data: cur } = await db.from("shooting_campaigns").select("status").eq("id", campaign_id).maybeSingle();
      if (!cur) return json({ error: "Campanha não encontrada" }, 404);
      return json({ error: `Campanha não pode ser iniciada no status "${cur.status}"` }, 409);
    }

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

    if (campaign.dispatch_channel === "z_api") {
      const rawZApi = campaign.z_api_connections as (ZApiConnection & { token: string; client_token: string }) | null;
      if (!rawZApi) return json({ error: "Conexão Z-API não encontrada" }, 400);
      if (!campaign.message_body && !campaign.z_api_template_id) return json({ error: "Mensagem ou template da campanha não configurado" }, 400);

      const zApiConn: ZApiConnection = {
        ...rawZApi,
        token:        await decrypt(rawZApi.token),
        client_token: await decrypt(rawZApi.client_token),
      };

      let zApiTpl: ZApiTemplateData | null = null;
      if (campaign.z_api_template_id) {
        const { data: fetchedTpl } = await db.from("z_api_templates").select("*").eq("id", campaign.z_api_template_id).single();
        zApiTpl = (fetchedTpl as ZApiTemplateData) ?? null;
      }

      const msgBody = zApiTpl?.body ?? String(campaign.message_body ?? "");
      await startSendLoop(campaign_id, undefined, undefined, campaign, zApiConn, msgBody, zApiTpl);
    } else {
      const rawConn  = campaign.meta_connections as Connection | null;
      const template = campaign.meta_templates   as Template   | null;
      if (!rawConn)  return json({ error: "Conexão WhatsApp não encontrada" }, 400);
      if (!template) return json({ error: "Template não encontrado" }, 400);
      const connection: Connection = { ...rawConn, access_token: await decrypt(rawConn.access_token) };
      await startSendLoop(campaign_id, connection, template, campaign);
    }

    return json({ ok: true, processed: pendingCount });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[engine] unhandled:", msg);
    return json({ error: msg }, 500);
  }
});

// ── Send loop ─────────────────────────────────────────────

async function startSendLoop(
  campaignId:   string,
  conn?:        Connection,
  tpl?:         Template,
  campaign?:    Record<string, unknown>,
  zApiConn?:    ZApiConnection,
  messageBody?: string,
  zApiTpl?:     ZApiTemplateData | null,
): Promise<void> {
  // Fetch fresh data if not provided (used by resume)
  if (!campaign) {
    const { data } = await db
      .from("shooting_campaigns")
      .select("*, meta_connections(*), meta_templates(*), z_api_connections(*)")
      .eq("id", campaignId)
      .single();
    if (!data) return;
    campaign = data;

    if (data.dispatch_channel === "z_api") {
      const rawZ = data.z_api_connections as (ZApiConnection & { token: string; client_token: string }) | null;
      if (rawZ) {
        zApiConn = { ...rawZ, token: await decrypt(rawZ.token), client_token: await decrypt(rawZ.client_token) };
        if (data.z_api_template_id) {
          const { data: fetchedTpl } = await db.from("z_api_templates").select("*").eq("id", data.z_api_template_id).single();
          zApiTpl = (fetchedTpl as ZApiTemplateData) ?? null;
        }
        messageBody = zApiTpl?.body ?? String(data.message_body ?? "");
      }
    } else if (!conn || !tpl) {
      const rawConn2 = data.meta_connections as Connection;
      conn = { ...rawConn2, access_token: await decrypt(rawConn2.access_token) };
      tpl  = data.meta_templates as Template;
    }
  }

  const isZApi            = String(campaign.dispatch_channel ?? "whatsapp") === "z_api";
  const mapping           = (campaign.column_mapping ?? {}) as Record<string, unknown>;
  const workspaceId       = String(campaign.workspace_id     ?? "");
  const connectionId      = String(campaign.meta_connection_id ?? "");
  const sendingSpeed      = Number(campaign.sending_speed ?? 80);
  const targetIntervalMs  = Math.ceil(60_000 / sendingSpeed);
  const isRandomMode      = isZApi && String(campaign.sending_speed_mode ?? "fixed") === "random";
  const minDelayMs        = isRandomMode ? Number(campaign.min_delay_seconds ?? 5)  * 1_000 : 0;
  const maxDelayMs        = isRandomMode ? Number(campaign.max_delay_seconds ?? 30) * 1_000 : 0;

  console.log(`[engine] starting campaign ${campaignId} channel=${isZApi ? "z_api" : "meta"} speed=${sendingSpeed}msg/min random=${isRandomMode}`);
  writeAuditLog(workspaceId, "campaign_started", campaignId, "campaign", "info", null, { sending_speed: sendingSpeed, random_mode: isRandomMode });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!await isCampaignActive(campaignId)) {
      console.log(`[engine] campaign ${campaignId} stopped (status change)`);
      break;
    }

    const { data: batch } = await db
      .from("shooting_messages")
      .select("id, recipient_phone, recipient_data, retry_count, max_retries")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .order("created_at")
      .limit(BATCH_SIZE);

    if (!batch || batch.length === 0) break;

    console.log(`[engine] batch size=${batch.length}`);

    for (const msg of batch as Message[]) {
      if (!await isCampaignActive(campaignId)) break;

      const t0 = Date.now();
      if (isZApi && zApiConn && messageBody) {
        await processZApiMessage(msg, zApiConn, messageBody, mapping, campaignId, workspaceId, zApiTpl);
      } else {
        await processMessage(msg, conn!, tpl!, mapping, campaignId, workspaceId, connectionId);
      }
      const elapsed   = Date.now() - t0;
      const delayMs   = isRandomMode
        ? minDelayMs + Math.random() * (maxDelayMs - minDelayMs)
        : targetIntervalMs;
      const remaining = delayMs - elapsed;
      if (remaining > 50) await sleep(remaining);
    }

    if (batch.length < BATCH_SIZE) break;
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
