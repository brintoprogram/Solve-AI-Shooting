// automation-ticker — runs every hour via pg_cron.
// For each active automation_rule where send_hour == current UTC hour:
//   for each enabled trigger: find recipients whose vencimento == today - day_offset,
//   verify boleto is still pending, dedup via automation_logs, send, log result.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const Z_API_BASE   = "https://api.z-api.io/instances";
const META_BASE    = "https://graph.facebook.com/v19.0";

const db = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatBRL(v: number | null): string {
  if (v === null || v === undefined) return "";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("T")[0].split("-");
  return `${d}/${m}/${y}`;
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function substituteAutoVars(tpl: string, r: Recipient, dayOffset: number): string {
  const dias       = Math.abs(dayOffset);
  const statusVenc = dayOffset < 0 ? "a vencer"
    : dayOffset === 0 ? "no dia do vencimento" : "vencido";
  return tpl
    .replace(/\{nome\}/g,              r.contact_name  ?? "")
    .replace(/\{valor\}/g,             formatBRL(r.valor))
    .replace(/\{vencimento\}/g,        formatDate(r.vencimento))
    .replace(/\{dias\}/g,              String(dias))
    .replace(/\{status_vencimento\}/g, statusVenc)
    .replace(/\{boleto\}/g,            r.numero_nf ?? r.codigo_barras ?? "");
}

function substituteTemplateVars(template: string, mapping: Record<string, string>, recipient: Recipient): string {
  let result = template;
  for (const [idx, field] of Object.entries(mapping)) {
    const value = getRecipientField(recipient, field);
    result = result.replace(new RegExp(`\\{\\{${idx}\\}\\}`, "g"), value);
  }
  return result;
}

function getRecipientField(r: Recipient, field: string): string {
  switch (field) {
    case "nome":              return r.contact_name  ?? "";
    case "valor":             return formatBRL(r.valor);
    case "vencimento":        return formatDate(r.vencimento);
    case "dias":              return "";  // computed later with dayOffset context
    case "status_vencimento": return "";  // computed later with dayOffset context
    case "boleto":            return r.numero_nf ?? r.codigo_barras ?? "";
    default:                  return "";
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Recipient {
  id:            string;
  contact_id:    string;
  contact_name:  string;
  contact_phone: string;
  vencimento:    string;
  valor:         number | null;
  numero_nf:     string | null;
  codigo_barras: string | null;
}

interface Trigger {
  id:                  string;
  day_offset:          number;
  label:               string;
  channel:             string | null;
  z_api_connection_id: string | null;
  z_api_template_id:   string | null;
  meta_connection_id:  string | null;
  meta_template_id:    string | null;
  column_mapping:      Record<string, string>;
  message_body:        string | null;
  enabled:             boolean;
}

interface Rule {
  id:                  string;
  workspace_id:        string;
  name:                string;
  send_hour:           number;
  channel:             string;
  z_api_connection_id: string | null;
  meta_connection_id:  string | null;
  template_mode:       string;
  unified_message:     string | null;
}

// ── Z-API send ─────────────────────────────────────────────────────────────

async function sendZApiMessage(
  instanceId: string, token: string, clientToken: string,
  phone: string, message: string,
): Promise<{ zaapId?: string; error?: string }> {
  const cleanPhone = phone.replace(/\D/g, "");
  try {
    const res = await fetch(`${Z_API_BASE}/${instanceId}/token/${token}/send-text`, {
      method: "POST",
      headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: cleanPhone, message }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) return { error: String(data.error ?? data.message ?? `HTTP ${res.status}`) };
    const id = String(data.zaapId ?? data.messageId ?? data.id ?? "");
    if (id) return { zaapId: id };
    return { error: String(data.error ?? "Unknown Z-API response") };
  } catch (err) { return { error: String(err) }; }
}

// ── META send ──────────────────────────────────────────────────────────────

interface MetaTemplateComp {
  type:    string;
  text?:   string;
  format?: string;
  buttons?: Array<{ text: string }>;
}

function buildMetaComponents(
  templateComps: MetaTemplateComp[],
  mapping:       Record<string, string>,
  recipient:     Recipient,
  dayOffset:     number,
): unknown[] {
  const out: unknown[] = [];
  for (const comp of templateComps) {
    if (comp.type === "BODY" && comp.text?.includes("{{")) {
      const params = Object.entries(mapping)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, field]) => {
          let value = getRecipientField(recipient, field);
          if (field === "dias")              value = String(Math.abs(dayOffset));
          if (field === "status_vencimento") value = dayOffset < 0 ? "a vencer" : dayOffset === 0 ? "no dia" : "vencido";
          return { type: "text", text: value };
        });
      if (params.length) out.push({ type: "body", parameters: params });
    }
  }
  return out;
}

async function sendMetaTemplate(
  phoneNumberId: string, accessToken: string, to: string,
  templateName: string, language: string, components: unknown[],
): Promise<{ wamid?: string; error?: string }> {
  try {
    const res = await fetch(`${META_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: { name: templateName, language: { code: language }, components },
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const err = (data.error as Record<string, unknown>) ?? {};
      return { error: String(err.message ?? "API error") };
    }
    const msgs = data.messages as Array<{ id: string }>;
    return { wamid: msgs?.[0]?.id ?? "" };
  } catch (err) { return { error: String(err) }; }
}

// ── Log helper ─────────────────────────────────────────────────────────────

async function writeLog(
  rule: Rule, trigger: Trigger, recipient: Recipient,
  channel: string, status: "sent" | "failed",
  extra: { zaap_id?: string; wamid?: string; error_message?: string },
): Promise<void> {
  await db.from("automation_logs").insert({
    rule_id:       rule.id,
    trigger_id:    trigger.id,
    recipient_id:  recipient.id,
    workspace_id:  rule.workspace_id,
    contact_name:  recipient.contact_name,
    contact_phone: recipient.contact_phone,
    day_offset:    trigger.day_offset,
    channel,
    status,
    zaap_id:       extra.zaap_id       ?? null,
    wamid:         extra.wamid         ?? null,
    error_message: extra.error_message ?? null,
    scheduled_for: new Date().toISOString(),
  });
}

// ── PENDING_STATUSES (mirrors frontend InvoiceSelector) ────────────────────

const PENDING = ["pendente", "vencido", "aberto", "em_aberto"];

// ── Process one trigger + recipient pair ──────────────────────────────────

async function processOne(rule: Rule, trigger: Trigger, recipient: Recipient): Promise<void> {
  // 1. Check invoice still pending
  const { data: invoice } = await db
    .from("contact_invoices")
    .select("status")
    .eq("id", recipient.id)  // we stored invoice_id but recipient.id is the automation_recipients row
    .maybeSingle();
  // If we can't find the invoice row, still proceed (recipient.id is automation_recipients.id, not invoice_id)
  // We check via invoice_id stored on automation_recipients
  const { data: recipRow } = await db
    .from("automation_recipients")
    .select("invoice_id")
    .eq("id", recipient.id)
    .single();

  if (recipRow?.invoice_id) {
    const { data: inv } = await db
      .from("contact_invoices")
      .select("status")
      .eq("id", recipRow.invoice_id)
      .maybeSingle();
    if (inv && !PENDING.includes(inv.status)) {
      console.log(`[ticker] skip paid invoice: recipient=${recipient.id}`);
      return;
    }
  }

  // 2. Dedup — already sent for this trigger + recipient?
  const { data: existing } = await db
    .from("automation_logs")
    .select("id")
    .eq("trigger_id", trigger.id)
    .eq("recipient_id", recipient.id)
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log(`[ticker] skip dedup: trigger=${trigger.id} recipient=${recipient.id}`);
    return;
  }

  // 3. Resolve effective channel + connection
  const effectiveChannel = (trigger.channel ?? rule.channel) as string;
  const isZApi           = effectiveChannel === "z_api";

  try {
    if (isZApi) {
      // Fetch Z-API connection
      const connId = trigger.z_api_connection_id ?? rule.z_api_connection_id;
      if (!connId) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "No Z-API connection configured" });
        return;
      }

      const { data: conn } = await db
        .from("z_api_connections")
        .select("instance_id, token, client_token")
        .eq("id", connId)
        .single();

      if (!conn) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "Z-API connection not found" });
        return;
      }

      const instanceId   = conn.instance_id as string;
      const token        = await decrypt(conn.token        as string);
      const clientToken  = await decrypt(conn.client_token as string);

      let message: string;

      if (rule.template_mode === "unified" && rule.unified_message) {
        message = substituteAutoVars(rule.unified_message, recipient, trigger.day_offset);
      } else if (trigger.z_api_template_id) {
        // Per-trigger: Z-API template with column mapping
        const { data: tpl } = await db
          .from("z_api_templates")
          .select("body")
          .eq("id", trigger.z_api_template_id)
          .single();
        if (!tpl) {
          await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "Z-API template not found" });
          return;
        }
        message = substituteTemplateVars(tpl.body as string, trigger.column_mapping ?? {}, recipient);
        // Replace dias/status_vencimento manually since they need dayOffset
        const dias       = Math.abs(trigger.day_offset);
        const statusVenc = trigger.day_offset < 0 ? "a vencer" : trigger.day_offset === 0 ? "no dia" : "vencido";
        for (const [idx, field] of Object.entries(trigger.column_mapping ?? {})) {
          if (field === "dias")              message = message.replace(new RegExp(`\\{\\{${idx}\\}\\}`, "g"), String(dias));
          if (field === "status_vencimento") message = message.replace(new RegExp(`\\{\\{${idx}\\}\\}`, "g"), statusVenc);
        }
      } else if (trigger.message_body) {
        message = substituteAutoVars(trigger.message_body, recipient, trigger.day_offset);
      } else {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "No message configured for this trigger" });
        return;
      }

      const result = await sendZApiMessage(instanceId, token, clientToken, recipient.contact_phone, message);

      if (result.zaapId) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "sent", { zaap_id: result.zaapId });
      } else {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: result.error });
      }

    } else {
      // META channel
      const metaConnId   = trigger.meta_connection_id ?? rule.meta_connection_id;
      const metaTplId    = trigger.meta_template_id;

      if (!metaConnId || !metaTplId) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "META connection or template not configured" });
        return;
      }

      const { data: conn } = await db
        .from("meta_connections")
        .select("phone_number_id, access_token")
        .eq("id", metaConnId)
        .single();

      if (!conn) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "META connection not found" });
        return;
      }

      const { data: tpl } = await db
        .from("meta_templates")
        .select("template_name, language, components")
        .eq("id", metaTplId)
        .single();

      if (!tpl) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "META template not found" });
        return;
      }

      const phoneNumberId = conn.phone_number_id as string;
      const accessToken   = await decrypt(conn.access_token as string);
      const components    = buildMetaComponents(
        tpl.components as MetaTemplateComp[],
        trigger.column_mapping ?? {},
        recipient,
        trigger.day_offset,
      );

      const result = await sendMetaTemplate(
        phoneNumberId, accessToken, recipient.contact_phone,
        tpl.template_name as string, tpl.language as string, components,
      );

      if (result.wamid) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "sent", { wamid: result.wamid });
      } else {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: result.error });
      }
    }
  } catch (err) {
    await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: String(err) });
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // Allow pg_cron POST and manual triggers
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const hourUTC  = new Date().getUTCHours();
  const today    = todayISO();

  console.log(`[automation-ticker] start hour=${hourUTC} today=${today}`);

  // Load all active rules firing this hour
  const { data: rules, error: rulesErr } = await db
    .from("automation_rules")
    .select("*")
    .eq("status", "active")
    .eq("send_hour", hourUTC);

  if (rulesErr) {
    console.error("[automation-ticker] failed to load rules:", rulesErr.message);
    return new Response(JSON.stringify({ error: rulesErr.message }), { status: 500 });
  }

  let totalSent  = 0;
  let totalFailed = 0;

  for (const rule of (rules ?? []) as Rule[]) {
    console.log(`[automation-ticker] processing rule=${rule.id} name="${rule.name}"`);

    // Load enabled triggers for this rule
    const { data: triggers } = await db
      .from("automation_triggers")
      .select("*")
      .eq("rule_id", rule.id)
      .eq("enabled", true);

    for (const trigger of (triggers ?? []) as Trigger[]) {
      // targetVencimento = date whose day_offset fires today
      // e.g. day_offset=-1 means fire 1 day before: boletos with vencimento = tomorrow
      const targetVencimento = addDays(today, -trigger.day_offset);

      // Find recipients for this vencimento
      const { data: recipients } = await db
        .from("automation_recipients")
        .select("*")
        .eq("rule_id", rule.id)
        .eq("removed", false)
        .eq("vencimento", targetVencimento);

      for (const recipient of (recipients ?? []) as Recipient[]) {
        try {
          await processOne(rule, trigger, recipient);
          totalSent++;
        } catch (err) {
          totalFailed++;
          console.error(`[automation-ticker] error processing recipient=${recipient.id}:`, err);
        }
        await sleep(800); // brief pause between sends
      }
    }

    // Update sent_count
    const { data: logs } = await db
      .from("automation_logs")
      .select("id", { count: "exact" })
      .eq("rule_id", rule.id)
      .eq("status", "sent");

    await db.from("automation_rules").update({
      sent_count: logs?.length ?? 0,
      updated_at: new Date().toISOString(),
    }).eq("id", rule.id);
  }

  const msg = `automation-ticker done: rules=${(rules ?? []).length} sent=${totalSent} failed=${totalFailed}`;
  console.log(`[automation-ticker] ${msg}`);
  return new Response(JSON.stringify({ ok: true, msg }), {
    headers: { "Content-Type": "application/json" },
  });
});
