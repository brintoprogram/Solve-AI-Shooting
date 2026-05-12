// Tick-based Z-API campaign processor — fires every minute via Deno.cron.
// campaign-engine sets next_message_at on start/resume; this function does the actual sending.
// Architecture: atomic claim → process 1+ messages within budget → schedule next tick.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const Z_API_BASE      = "https://api.z-api.io/instances";
const TICK_BUDGET_MS  = 45_000;        // max processing time per tick
const CLAIM_LOCK_MS   = 10 * 60_000;  // stale-claim TTL (crash recovery)

const db = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function blockDelay(charCount: number): number {
  return Math.max(800, Math.min(5_000, charCount * 50));
}

function writeAuditLog(
  workspaceId: string, eventType: string,
  entityId:    string | null | undefined, entityType: string | null | undefined,
  status:      "success" | "error" | "warning" | "info",
  error?:      string | null, metadata?: Record<string, unknown>,
): void {
  db.from("audit_logs").insert({
    workspace_id: workspaceId, event_type: eventType,
    entity_id: entityId ?? null, entity_type: entityType ?? null,
    status, error: error ?? null, metadata: metadata ?? null,
  }).then(({ error: e }) => { if (e) console.error("[ticker][audit]", e.message); });
}

// ── Light variation engine (identical to campaign-engine) ─────────────────────

type PhraseGroup = [RegExp, string[]];
const VARIATION_GROUPS: PhraseGroup[] = [
  [/^(E aí|Eaí|Eai|Oi|Oii|Olá|Ola|Ei|Hey)\b/im, ["E aí", "Oi", "Olá", "Ei"]],
  [/\btudo certo\?/gi,  ["tudo certo?", "tudo bem?", "como vai?"]],
  [/\btudo bem\?/gi,    ["tudo bem?", "tudo certo?", "como vai?"]],
  [/\bcomo vai\?/gi,    ["como vai?", "tudo bem?", "tudo certo?"]],
  [/Passando para (avisar|informar)\b/gi,
   ["Passando para avisar", "Só te avisando", "Passando para informar"]],
  [/Só te avisando\b/gi,  ["Só te avisando", "Passando para avisar", "Só informando"]],
  [/Só informando\b/gi,   ["Só informando", "Só te avisando", "Passando para informar"]],
  [/responda por aqui\b/gi,
   ["responda por aqui", "pode me chamar por aqui", "me chame aqui"]],
  [/pode me chamar por aqui\b/gi,
   ["pode me chamar por aqui", "responda por aqui", "fala comigo aqui"]],
];

function _extractVars(text: string): string[] {
  return (text.match(/\{\{\d+\}\}/g) ?? []).sort();
}

function applyLightVariation(text: string, seed: number): string {
  try {
    const tokens: string[] = [];
    const protected_ = text.replace(/\{\{\d+\}\}/g, (m) => {
      const i = tokens.length; tokens.push(m); return `\x00VAR${i}\x00`;
    });
    let varied = protected_;
    for (const [pattern, options] of VARIATION_GROUPS) {
      if (pattern.test(varied)) {
        const choice = options[seed % options.length];
        pattern.lastIndex = 0;
        const next = varied.replace(pattern, choice);
        pattern.lastIndex = 0;
        if (next !== varied) { varied = next; break; }
      }
    }
    const restored = varied.replace(/\x00VAR(\d+)\x00/g, (_, i) => tokens[Number(i)]);
    const a = _extractVars(text), b = _extractVars(restored);
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) return text;
    return restored;
  } catch { return text; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ZApiConn {
  id: string; instance_id: string; token: string; client_token: string;
}
interface ZApiTpl {
  id: string; message_type: "text" | "button_list"; header_text: string | null;
  body: string; footer: string | null; buttons: Array<{ id: string; label: string }>;
  enable_light_variations: boolean; blocks: string[] | null;
}
interface ZApiSendResult { zaapId?: string; error?: string; retryable?: boolean; }
interface Message {
  id: string; recipient_phone: string; recipient_data: Record<string, unknown>;
  retry_count: number; max_retries: number;
}
interface Campaign {
  id: string; workspace_id: string; z_api_connection_id: string;
  z_api_template_id: string | null; message_body: string | null;
  column_mapping: Record<string, unknown>; sending_speed: number;
  sending_speed_mode: string; min_delay_seconds: number | null;
  max_delay_seconds: number | null;
}

// ── Z-API send helpers ────────────────────────────────────────────────────────

async function sendZApiMessage(
  instanceId: string, token: string, clientToken: string, phone: string, message: string,
): Promise<ZApiSendResult> {
  const cleanPhone = phone.replace(/\D/g, "");
  try {
    const res = await fetch(`${Z_API_BASE}/${instanceId}/token/${token}/send-text`, {
      method: "POST",
      headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: cleanPhone, message }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) return { error: String(data.error ?? data.message ?? `HTTP ${res.status}`), retryable: res.status >= 500 };
    const id = String(data.zaapId ?? data.messageId ?? data.id ?? "");
    if (id) return { zaapId: id };
    return { error: String(data.error ?? data.message ?? "Unknown Z-API response"), retryable: false };
  } catch (err) { return { error: String(err), retryable: true }; }
}

async function sendZApiButtonList(
  instanceId: string, token: string, clientToken: string, phone: string,
  message: string, title: string | null, footer: string | null,
  buttons: Array<{ id: string; label: string }>,
): Promise<ZApiSendResult> {
  const cleanPhone = phone.replace(/\D/g, "");
  try {
    const body: Record<string, unknown> = { phone: cleanPhone, message, buttonList: { buttons } };
    if (title)  body.title  = title;
    if (footer) body.footer = footer;
    const res = await fetch(`${Z_API_BASE}/${instanceId}/token/${token}/send-button-list`, {
      method: "POST",
      headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) return { error: String(data.error ?? data.message ?? `HTTP ${res.status}`), retryable: res.status >= 500 };
    const id = String(data.zaapId ?? data.messageId ?? data.id ?? "");
    if (id) return { zaapId: id };
    return { error: String(data.error ?? data.message ?? "Unknown Z-API response"), retryable: false };
  } catch (err) { return { error: String(err), retryable: true }; }
}

function substituteVars(template: string, vars: Record<string, string>, contactData: Record<string, unknown>): string {
  let result = template;
  for (const [idx, col] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${idx}\\}\\}`, "g"), String(contactData[col] ?? ""));
  }
  return result;
}

function buildZApiText(
  body: string, mapping: Record<string, unknown>, contactData: Record<string, unknown>,
  tpl?: ZApiTpl | null, seed?: number,
): string {
  const bodyVars   = (mapping.body_variables   ?? {}) as Record<string, string>;
  const headerVars = (mapping.header_variables  ?? {}) as Record<string, string>;
  const footerVars = (mapping.footer_variables  ?? {}) as Record<string, string>;
  const bodyToUse  = (tpl?.enable_light_variations && seed !== undefined) ? applyLightVariation(body, seed) : body;
  const text = substituteVars(bodyToUse, bodyVars, contactData);
  if (tpl?.message_type === "text") {
    const parts: string[] = [];
    if (tpl.header_text) parts.push(`*${substituteVars(tpl.header_text, headerVars, contactData)}*`);
    parts.push(text);
    if (tpl.footer) parts.push(`_${substituteVars(tpl.footer, footerVars, contactData)}_`);
    return parts.join("\n\n");
  }
  return text;
}

// ── Inbox persistence ─────────────────────────────────────────────────────────

async function upsertInboxContact(workspaceId: string, phone: string, ts: string): Promise<string | null> {
  const { data: existing } = await db.from("inbox_contacts").select("id")
    .eq("workspace_id", workspaceId).eq("phone", phone).maybeSingle();
  if (existing) return existing.id as string;
  const { data: created } = await db.from("inbox_contacts")
    .insert({ workspace_id: workspaceId, phone, first_seen_at: ts, last_seen_at: ts })
    .select("id").single();
  return (created?.id as string) ?? null;
}

async function upsertZApiConversation(
  workspaceId: string, zApiConnectionId: string, contactId: string, ts: string, lastBody: string,
): Promise<string | null> {
  const { data: existing } = await db.from("inbox_conversations").select("id")
    .eq("workspace_id", workspaceId).eq("contact_id", contactId)
    .eq("z_api_connection_id", zApiConnectionId).maybeSingle();
  if (existing) {
    await db.from("inbox_conversations").update({
      last_message_at: ts, last_message_body: lastBody,
      last_message_direction: "outbound", updated_at: ts,
    }).eq("id", existing.id);
    return existing.id as string;
  }
  const { data: created } = await db.from("inbox_conversations").insert({
    workspace_id: workspaceId, z_api_connection_id: zApiConnectionId, contact_id: contactId,
    status: "open", unread_count: 0, last_message_at: ts,
    last_message_body: lastBody, last_message_direction: "outbound",
  }).select("id").single();
  return (created?.id as string) ?? null;
}

async function saveZApiMessageToInbox(
  workspaceId: string, zApiConnectionId: string, phone: string, zaapId: string, body: string, ts: string,
): Promise<void> {
  try {
    const contactId = await upsertInboxContact(workspaceId, phone, ts);
    if (!contactId) return;
    const convId = await upsertZApiConversation(workspaceId, zApiConnectionId, contactId, ts, body);
    if (!convId) return;
    await db.from("inbox_messages").upsert({
      workspace_id: workspaceId, conversation_id: convId, contact_id: contactId,
      wamid: zaapId, direction: "outbound", message_type: "text",
      body, status: "sent", created_at: ts, sent_at: ts,
    }, { onConflict: "wamid", ignoreDuplicates: true });
  } catch (err) {
    console.error("[ticker] saveZApiMessageToInbox:", err instanceof Error ? err.message : String(err));
  }
}

// ── Message processor ─────────────────────────────────────────────────────────

async function processZApiMessage(
  msg: Message, zConn: ZApiConn, messageBody: string,
  mapping: Record<string, unknown>, campaignId: string, workspaceId: string,
  tpl?: ZApiTpl | null, seed?: number,
): Promise<void> {
  // ── Multi-block path ──────────────────────────────────────────────────────────
  const activeBlocks = tpl?.blocks?.filter((b) => b.trim()) ?? [];
  if (activeBlocks.length > 0) {
    const bodyVars = (mapping.body_variables ?? {}) as Record<string, string>;
    const contact  = (msg.recipient_data ?? {}) as Record<string, unknown>;
    let lastZaapId = "";

    for (let i = 0; i < activeBlocks.length; i++) {
      const blockText = substituteVars(activeBlocks[i], bodyVars, contact);
      const res = await sendZApiMessage(
        zConn.instance_id, zConn.token, zConn.client_token, msg.recipient_phone, blockText,
      );

      if (!res.zaapId) {
        const retryCount = (msg.retry_count ?? 0) + 1;
        const canRetry   = (res.retryable ?? false) && retryCount < (msg.max_retries ?? 3);
        const now = new Date().toISOString();
        if (canRetry) {
          await db.from("shooting_messages").update({ retry_count: retryCount, error_message: res.error }).eq("id", msg.id);
          writeAuditLog(workspaceId, "message_retry", msg.id, "shooting_message", "warning", res.error, {
            phone: msg.recipient_phone, campaign_id: campaignId, retry_count: retryCount, block_index: i,
          });
        } else {
          await db.from("shooting_messages").update({
            status: "failed", failed_at: now, error_message: res.error, retry_count: retryCount,
          }).eq("id", msg.id);
          await db.rpc("increment_campaign_counters", { p_campaign_id: campaignId, p_counter_name: "failed_count" });
          writeAuditLog(workspaceId, "message_failed", msg.id, "shooting_message", "error", res.error, {
            phone: msg.recipient_phone, campaign_id: campaignId, block_index: i,
          });
        }
        console.warn(`[ticker] msg ${msg.id} block ${i} → ${canRetry ? "retry" : "failed"}: ${res.error}`);
        return;
      }

      const now = new Date().toISOString();
      await saveZApiMessageToInbox(workspaceId, zConn.id, msg.recipient_phone, res.zaapId, blockText, now);
      lastZaapId = res.zaapId;

      if (i < activeBlocks.length - 1) {
        await sleep(blockDelay(activeBlocks[i].length));
      }
    }

    const now = new Date().toISOString();
    await db.from("shooting_messages").update({ status: "sent", wamid: lastZaapId, sent_at: now }).eq("id", msg.id);
    await db.rpc("increment_campaign_counters", { p_campaign_id: campaignId, p_counter_name: "sent_count" });
    writeAuditLog(workspaceId, "message_sent", msg.id, "shooting_message", "success", null, {
      phone: msg.recipient_phone, campaign_id: campaignId, zaap_id: lastZaapId, blocks: activeBlocks.length,
    });
    return;
  }

  // ── Single-message path ───────────────────────────────────────────────────────
  const text = buildZApiText(messageBody, mapping, msg.recipient_data ?? {}, tpl, seed);

  let result: ZApiSendResult;
  if (tpl?.message_type === "button_list" && tpl.buttons.length > 0) {
    const headerVars = (mapping.header_variables ?? {}) as Record<string, string>;
    const footerVars = (mapping.footer_variables ?? {}) as Record<string, string>;
    const contact    = msg.recipient_data ?? {};
    result = await sendZApiButtonList(
      zConn.instance_id, zConn.token, zConn.client_token, msg.recipient_phone, text,
      tpl.header_text ? substituteVars(tpl.header_text, headerVars, contact) : null,
      tpl.footer      ? substituteVars(tpl.footer,      footerVars, contact) : null,
      tpl.buttons,
    );
  } else {
    result = await sendZApiMessage(zConn.instance_id, zConn.token, zConn.client_token, msg.recipient_phone, text);
  }

  const now = new Date().toISOString();

  if (result.zaapId) {
    await db.from("shooting_messages").update({ status: "sent", wamid: result.zaapId, sent_at: now }).eq("id", msg.id);
    await db.rpc("increment_campaign_counters", { p_campaign_id: campaignId, p_counter_name: "sent_count" });
    writeAuditLog(workspaceId, "message_sent", msg.id, "shooting_message", "success", null, {
      phone: msg.recipient_phone, campaign_id: campaignId, zaap_id: result.zaapId,
    });
    await saveZApiMessageToInbox(workspaceId, zConn.id, msg.recipient_phone, result.zaapId, text, now);
  } else {
    const retryCount = (msg.retry_count ?? 0) + 1;
    const canRetry   = (result.retryable ?? false) && retryCount < (msg.max_retries ?? 3);
    if (canRetry) {
      await db.from("shooting_messages").update({ retry_count: retryCount, error_message: result.error }).eq("id", msg.id);
      writeAuditLog(workspaceId, "message_retry", msg.id, "shooting_message", "warning", result.error, {
        phone: msg.recipient_phone, campaign_id: campaignId, retry_count: retryCount,
      });
    } else {
      await db.from("shooting_messages").update({
        status: "failed", failed_at: now, error_message: result.error, retry_count: retryCount,
      }).eq("id", msg.id);
      await db.rpc("increment_campaign_counters", { p_campaign_id: campaignId, p_counter_name: "failed_count" });
      writeAuditLog(workspaceId, "message_failed", msg.id, "shooting_message", "error", result.error, {
        phone: msg.recipient_phone, campaign_id: campaignId,
      });
    }
    console.warn(`[ticker] msg ${msg.id} → ${canRetry ? "retry" : "failed"}: ${result.error}`);
  }
}

// ── Campaign processor ────────────────────────────────────────────────────────

async function processCampaign(campaign: Campaign, tickStart: number): Promise<void> {
  const { data: rawConn } = await db.from("z_api_connections")
    .select("id, instance_id, token, client_token")
    .eq("id", campaign.z_api_connection_id)
    .single();

  if (!rawConn) {
    console.error(`[ticker] z_api_connection not found for campaign ${campaign.id}`);
    await db.from("shooting_campaigns").update({ status: "failed" }).eq("id", campaign.id);
    writeAuditLog(campaign.workspace_id, "campaign_failed", campaign.id, "campaign", "error", "Z-API connection not found");
    return;
  }

  const zConn: ZApiConn = {
    id:           rawConn.id           as string,
    instance_id:  rawConn.instance_id  as string,
    token:        await decrypt(rawConn.token        as string),
    client_token: await decrypt(rawConn.client_token as string),
  };

  let zApiTpl: ZApiTpl | null = null;
  if (campaign.z_api_template_id) {
    const { data: tpl } = await db.from("z_api_templates").select("*").eq("id", campaign.z_api_template_id).single();
    zApiTpl = (tpl as ZApiTpl) ?? null;
  }

  const messageBody  = zApiTpl?.body ?? String(campaign.message_body ?? "");
  const mapping      = (campaign.column_mapping ?? {}) as Record<string, unknown>;
  const isRandom     = campaign.sending_speed_mode === "random";
  const minDelayMs   = isRandom ? Number(campaign.min_delay_seconds ?? 5)  * 1_000 : 0;
  const maxDelayMs   = isRandom ? Number(campaign.max_delay_seconds ?? 30) * 1_000 : 0;
  const fixedDelayMs = !isRandom ? Math.ceil(60_000 / Number(campaign.sending_speed ?? 80)) : 0;

  // Variation seed starts from already-sent count so seeds are globally unique per campaign
  const { count: sentCount } = await db.from("shooting_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .in("status", ["sent", "failed"]);
  let msgIndex = sentCount ?? 0;

  while (true) {
    // Budget guard
    if (TICK_BUDGET_MS - (Date.now() - tickStart) < 1_000) {
      await db.from("shooting_campaigns")
        .update({ next_message_at: new Date(Date.now() + 5_000).toISOString() })
        .eq("id", campaign.id);
      console.log(`[ticker] campaign ${campaign.id} budget exhausted, scheduled +5s`);
      return;
    }

    // Respect pause/cancel
    const { data: fresh } = await db.from("shooting_campaigns").select("status").eq("id", campaign.id).single();
    if (fresh?.status !== "sending") {
      console.log(`[ticker] campaign ${campaign.id} stopped (status=${fresh?.status})`);
      return;
    }

    // Fetch next pending message
    const { data: msgs } = await db.from("shooting_messages")
      .select("id, recipient_phone, recipient_data, retry_count, max_retries")
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .order("created_at").order("id")
      .limit(1);

    if (!msgs || msgs.length === 0) {
      await db.from("shooting_campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString(), next_message_at: null })
        .eq("id", campaign.id)
        .eq("status", "sending");
      console.log(`[ticker] campaign ${campaign.id} completed`);
      writeAuditLog(campaign.workspace_id, "campaign_completed", campaign.id, "campaign", "success");
      return;
    }

    const msg = msgs[0] as Message;

    const delayMs = isRandom
      ? minDelayMs + Math.random() * (maxDelayMs - minDelayMs)
      : fixedDelayMs;

    await processZApiMessage(msg, zConn, messageBody, mapping, campaign.id, campaign.workspace_id, zApiTpl, msgIndex);
    msgIndex++;

    const budgetAfterSend = TICK_BUDGET_MS - (Date.now() - tickStart);

    if (delayMs > budgetAfterSend) {
      // Delay exceeds remaining budget — schedule for a future tick
      const nextAt = new Date(Date.now() + Math.round(delayMs)).toISOString();
      await db.from("shooting_campaigns").update({ next_message_at: nextAt }).eq("id", campaign.id);
      console.log(`[ticker] campaign ${campaign.id} next msg in ${Math.round(delayMs / 1000)}s`);
      return;
    }

    if (delayMs > 50) {
      // Keep claim lock alive across the sleep so another instance doesn't re-claim
      await db.from("shooting_campaigns")
        .update({ next_message_at: new Date(Date.now() + CLAIM_LOCK_MS).toISOString() })
        .eq("id", campaign.id);
      await sleep(delayMs);
    }
  }
}

// ── Tick logic ────────────────────────────────────────────────────────────────

async function runTick(): Promise<void> {
  const tickStart = Date.now();
  const now       = new Date().toISOString();
  console.log(`[ticker] tick ${now}`);

  // Self-heal: reset campaigns stuck in sending with no next_message_at
  await db.from("shooting_campaigns")
    .update({ next_message_at: new Date().toISOString() })
    .eq("status", "sending")
    .eq("dispatch_channel", "z_api")
    .is("next_message_at", null);

  const { data: dueCampaigns, error: qErr } = await db
    .from("shooting_campaigns")
    .select("id, workspace_id, z_api_connection_id, z_api_template_id, message_body, column_mapping, sending_speed, sending_speed_mode, min_delay_seconds, max_delay_seconds")
    .eq("status", "sending")
    .eq("dispatch_channel", "z_api")
    .not("next_message_at", "is", null)
    .lte("next_message_at", now);

  if (qErr) { console.error("[ticker] query error:", qErr.message); return; }
  if (!dueCampaigns || dueCampaigns.length === 0) { console.log("[ticker] no due campaigns"); return; }

  console.log(`[ticker] ${dueCampaigns.length} due campaign(s)`);

  for (const campaign of dueCampaigns as Campaign[]) {
    if (Date.now() - tickStart > TICK_BUDGET_MS) {
      console.log("[ticker] global budget exhausted, deferring remaining");
      break;
    }

    // Atomic claim: advance next_message_at to prevent re-entry from concurrent invocations
    const lockUntil = new Date(Date.now() + CLAIM_LOCK_MS).toISOString();
    const { data: claimed } = await db
      .from("shooting_campaigns")
      .update({ next_message_at: lockUntil })
      .eq("id", campaign.id)
      .eq("status", "sending")
      .lte("next_message_at", now)   // re-check atomically
      .select("id")
      .maybeSingle();

    if (!claimed) { console.log(`[ticker] campaign ${campaign.id} already claimed`); continue; }

    try {
      await processCampaign(campaign, tickStart);
    } catch (err) {
      console.error(`[ticker] campaign ${campaign.id}:`, err instanceof Error ? err.message : String(err));
      // Retry after the configured minimum delay so a crash doesn't send the next message too soon
      const minDelayMs = campaign.sending_speed_mode === "random"
        ? (campaign.min_delay_seconds ?? 60) * 1_000
        : Math.ceil(60_000 / (campaign.sending_speed ?? 60));
      const retryMs = Math.max(60_000, minDelayMs);
      await db.from("shooting_campaigns")
        .update({ next_message_at: new Date(Date.now() + retryMs).toISOString() })
        .eq("id", campaign.id)
        .catch((e) => console.error("[ticker] retry schedule failed:", e));
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

// Scheduling is handled by pg_cron (PostgreSQL-level) which POSTs to this endpoint.
// Deno.cron is intentionally NOT used — it stops firing when the container goes cold.
Deno.serve((req) => {
  if (req.method === "POST") {
    // Return 200 immediately so pg_net doesn't time out (it has a 5s timeout).
    // runTick runs in background for up to 45s via EdgeRuntime.waitUntil.
    EdgeRuntime.waitUntil(
      runTick().catch((err) =>
        console.error("[ticker] unhandled error:", err instanceof Error ? err.message : String(err))
      )
    );
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }
  return new Response("campaign-ticker OK", { status: 200 });
});
