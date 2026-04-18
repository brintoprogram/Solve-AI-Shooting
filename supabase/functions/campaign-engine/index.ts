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

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY          = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_BASE            = "https://graph.facebook.com/v25.0";
const BATCH_SIZE           = 20;
const PRIVILEGED_ROLES     = ["admin", "manager"];

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Service-role client for all DB operations
const db = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Auth ─────────────────────────────────────────────────

async function authorizeRequest(req: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) return { ok: false, status: 401, error: "Token ausente" };

  // Verify token against Supabase auth
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401, error: "Token inválido" };

  // Check role in user_profiles table
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

  // Granular check: manager needs explicit can_shoot permission (admin always passes)
  if (role === "manager" && permissions.can_shoot === false) {
    return { ok: false, status: 403, error: "Permissão negada. Você não tem autorização para disparar campanhas." };
  }

  return { ok: true };
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

interface TemplateComp { type: string; text?: string; buttons?: Array<{ url?: string }> }

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
  id:             string;
  recipient_phone: string;
  recipient_data:  Record<string, unknown>;
  retry_count:     number;
  max_retries:     number;
}

interface Connection { phone_number_id: string; access_token: string }
interface Template   { template_name: string; language: string; components: TemplateComp[] }

async function processMessage(
  msg:        Message,
  conn:       Connection,
  tpl:        Template,
  mapping:    Record<string, unknown>,
  campaignId: string,
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
      .update({ status: "sent", wamid: result.wamid })
      .eq("id", msg.id);
    await db.rpc("increment_campaign_counters", {
      p_campaign_id: campaignId, p_counter_name: "sent_count",
    });

  } else {
    // Non-retryable Meta error codes (invalid number, opted-out, etc.)
    const NON_RETRYABLE = ["131026", "131047", "131051", "131008", "130472"];
    const retryCount    = (msg.retry_count ?? 0) + 1;
    const canRetry      = !NON_RETRYABLE.includes(result.code) && retryCount < (msg.max_retries ?? 3);

    if (canRetry) {
      await db.from("shooting_messages")
        .update({ retry_count: retryCount, error_code: result.code, error_message: result.error })
        .eq("id", msg.id);
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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
    // ── Quick actions ──────────────────────────────────────────
    if (action === "pause") {
      await db.from("shooting_campaigns").update({ status: "paused" }).eq("id", campaign_id);
      return json({ ok: true });
    }

    if (action === "resume") {
      await db.from("shooting_campaigns").update({ status: "sending" }).eq("id", campaign_id);
      // Fire-and-forget: re-kick the engine by starting the send loop
      startSendLoop(campaign_id); // intentionally not awaited
      return json({ ok: true, info: "resumed" });
    }

    if (action === "cancel") {
      await db.from("shooting_campaigns")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
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

    const connection = campaign.meta_connections as Connection | null;
    const template   = campaign.meta_templates   as Template   | null;

    if (!connection) return json({ error: "Conexão WhatsApp não encontrada" }, 400);
    if (!template)   return json({ error: "Template não encontrado" }, 400);

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
    conn     = data.meta_connections as Connection;
    tpl      = data.meta_templates   as Template;
    campaign = data;
  }

  const mapping      = (campaign.column_mapping ?? {}) as Record<string, unknown>;
  const sendingSpeed = Number(campaign.sending_speed ?? 80); // msg/min
  // delay between batches = (batchSize / speed) * 60s → ms
  const batchDelayMs = Math.max(1000, Math.ceil((BATCH_SIZE / sendingSpeed) * 60_000));

  let offset = 0;

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
      .range(offset, offset + BATCH_SIZE - 1);

    if (!batch || batch.length === 0) break;

    console.log(`[engine] batch offset=${offset} size=${batch.length} speed=${sendingSpeed}msg/min delay=${batchDelayMs}ms`);

    // Process entire batch concurrently; failures don't abort the batch
    await Promise.allSettled(
      (batch as Message[]).map((msg) =>
        processMessage(msg, conn!, tpl!, mapping, campaignId)
      )
    );

    if (batch.length < BATCH_SIZE) break; // last batch — done

    offset += BATCH_SIZE;
    await sleep(batchDelayMs);
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
  }
}
