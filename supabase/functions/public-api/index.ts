// Solve AI — Public REST API Gateway
// Auth:  Authorization: Bearer sk_live_<64 hex chars>
// Keys stored as SHA-256(raw_key) — plaintext never persisted.
// Every request (including failures) logged to api_request_logs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db           = createClient(SUPABASE_URL, SERVICE_KEY);

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function apiError(message: string, status: number, code: string): Response {
  return json({ error: { code, message } }, status);
}

// ── Crypto ────────────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Audit log ─────────────────────────────────────────────────────────────────

function auditLog(
  keyId: string | null,
  workspaceId: string,
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  req: Request,
): Promise<unknown> {
  return db.from("api_request_logs").insert({
    key_id:       keyId,
    workspace_id: workspaceId,
    method,
    path,
    status_code:  statusCode,
    duration_ms:  durationMs,
    ip_address:   req.headers.get("x-forwarded-for")?.split(",")[0].trim()
                  ?? req.headers.get("cf-connecting-ip")
                  ?? null,
    user_agent:   req.headers.get("user-agent"),
  });
}

// ── Auth middleware ───────────────────────────────────────────────────────────

interface ApiKey {
  id:           string;
  workspace_id: string;
  scopes:       string[];
  expires_at:   string | null;
  revoked_at:   string | null;
}

const UNKNOWN_WS = "00000000-0000-0000-0000-000000000000";
// Single generic 401 — never leak whether a key exists or was revoked.
const UNAUTHORIZED = apiError("Invalid or unauthorized API key", 401, "UNAUTHORIZED");

async function authenticate(req: Request): Promise<{ key: ApiKey } | { fail: Response; workspaceId: string }> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return { fail: apiError("Missing Authorization header. Use: Authorization: Bearer sk_live_...", 401, "UNAUTHORIZED"), workspaceId: UNKNOWN_WS };
  }

  const rawKey = auth.slice(7).trim();
  // Structural validation — prevents wasting a DB round-trip on garbage input
  if (!/^sk_live_[0-9a-f]{64}$/.test(rawKey)) {
    return { fail: UNAUTHORIZED, workspaceId: UNKNOWN_WS };
  }

  const hash = await sha256Hex(rawKey);

  const { data } = await db
    .from("api_keys")
    .select("id, workspace_id, scopes, expires_at, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();

  if (!data)             return { fail: UNAUTHORIZED, workspaceId: UNKNOWN_WS };
  if (data.revoked_at)   return { fail: UNAUTHORIZED, workspaceId: data.workspace_id };
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { fail: UNAUTHORIZED, workspaceId: data.workspace_id };
  }

  // Update last_used_at in background — never block the response for this
  EdgeRuntime.waitUntil(
    db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id)
  );

  return { key: data as ApiKey };
}

function checkScope(key: ApiKey, scope: string): Response | null {
  if (!key.scopes.includes(scope)) {
    return apiError(`This API key does not have the '${scope}' scope.`, 403, "INSUFFICIENT_SCOPE");
  }
  return null;
}

// ── Validators ────────────────────────────────────────────────────────────────

function safePhone(raw: string): string | null {
  const clean = raw.replace(/[^0-9+]/g, "");
  return clean.length >= 8 ? clean : null;
}

function safeUUID(raw: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
}

function pageParams(url: URL, maxLimit = 100): { page: number; limit: number } {
  const page  = Math.max(0, parseInt(url.searchParams.get("page")  ?? "0"));
  const limit = Math.min(maxLimit, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50")));
  return { page, limit };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// GET /v1/contacts?page=0&limit=50&q=nome
async function handleGetContacts(req: Request, wsId: string): Promise<Response> {
  const url = new URL(req.url);
  const { page, limit } = pageParams(url);
  const q = url.searchParams.get("q")?.trim();

  let query = db
    .from("inbox_contacts")
    .select(
      "id, name, phone, empresa, cidade, estado, tags, created_at, contact_invoices(id, valor, vencimento, status, numero_nf)",
      { count: "exact" }
    )
    .eq("workspace_id", wsId)
    .order("name")
    .range(page * limit, (page + 1) * limit - 1);

  if (q) {
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,empresa.ilike.%${q}%`);
  }

  const { data, count, error } = await query;
  if (error) return apiError("Internal error", 500, "INTERNAL_ERROR");
  return json({ data: data ?? [], meta: { total: count ?? 0, page, limit } });
}

// GET /v1/contacts/:phone
async function handleGetContact(phone: string, wsId: string): Promise<Response> {
  const clean = safePhone(decodeURIComponent(phone));
  if (!clean) return apiError("Invalid phone number", 400, "INVALID_PARAM");

  const { data, error } = await db
    .from("inbox_contacts")
    .select("id, name, phone, empresa, cidade, estado, tags, created_at, contact_invoices(id, valor, vencimento, status, numero_nf, codigo_barras)")
    .eq("workspace_id", wsId)
    .eq("phone", clean)
    .maybeSingle();

  if (error) return apiError("Internal error", 500, "INTERNAL_ERROR");
  if (!data)  return apiError("Contact not found", 404, "NOT_FOUND");
  return json({ data });
}

// POST /v1/contacts  { name, phone, empresa?, cidade?, estado?, tags?, invoice? }
async function handleUpsertContact(req: Request, wsId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return apiError("Invalid JSON body", 400, "INVALID_BODY"); }

  const name  = (body.name  as string | undefined)?.trim();
  const phone = safePhone((body.phone as string | undefined) ?? "");
  if (!name  || name.length < 2)  return apiError("'name' is required (min 2 chars)",   400, "INVALID_PARAM");
  if (!phone)                      return apiError("'phone' is required (min 8 digits)", 400, "INVALID_PARAM");

  const { data: contact, error: cErr } = await db
    .from("inbox_contacts")
    .upsert(
      {
        workspace_id: wsId,
        name,
        phone,
        empresa: (body.empresa as string | undefined) ?? null,
        cidade:  (body.cidade  as string | undefined) ?? null,
        estado:  (body.estado  as string | undefined) ?? null,
        tags:    Array.isArray(body.tags) ? body.tags : [],
      },
      { onConflict: "workspace_id,phone" }
    )
    .select("id, name, phone")
    .single();

  if (cErr || !contact) return apiError("Failed to upsert contact", 500, "INTERNAL_ERROR");

  // Optional invoice upsert
  if (body.invoice && typeof body.invoice === "object") {
    const inv  = body.invoice as Record<string, unknown>;
    const venc = (inv.vencimento as string | undefined)?.slice(0, 10); // YYYY-MM-DD
    const val  = parseFloat(String(inv.valor ?? ""));
    if (venc && !isNaN(val) && val > 0) {
      await db.from("contact_invoices").upsert(
        {
          contact_id:    contact.id,
          workspace_id:  wsId,
          valor:         val,
          vencimento:    venc,
          status:        (inv.status as string | undefined) ?? "pendente",
          numero_nf:     (inv.numero_nf     as string | undefined) ?? null,
          codigo_barras: (inv.codigo_barras as string | undefined) ?? null,
        },
        { onConflict: "contact_id,numero_nf" }
      );
    }
  }

  return json({ data: contact, message: "Contact upserted successfully" }, 201);
}

// GET /v1/campaigns?page=0&limit=20&status=completed&channel=z_api
async function handleGetCampaigns(req: Request, wsId: string): Promise<Response> {
  const url = new URL(req.url);
  const { page, limit } = pageParams(url, 50);
  const status  = url.searchParams.get("status");
  const channel = url.searchParams.get("channel");

  // Allowlist for status and channel to prevent injection via query params
  const VALID_STATUSES  = ["draft","scheduled","sending","paused","completed","cancelled","failed"];
  const VALID_CHANNELS  = ["z_api","whatsapp","meta","n8n_email"];
  if (status  && !VALID_STATUSES.includes(status))   return apiError("Invalid status value",  400, "INVALID_PARAM");
  if (channel && !VALID_CHANNELS.includes(channel))  return apiError("Invalid channel value", 400, "INVALID_PARAM");

  let query = db
    .from("shooting_campaigns")
    .select(
      "id, name, status, dispatch_channel, total_recipients, sent_count, delivered_count, read_count, failed_count, created_at, started_at, completed_at",
      { count: "exact" }
    )
    .eq("workspace_id", wsId)
    .order("created_at", { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (status)  query = query.eq("status",           status);
  if (channel) query = query.eq("dispatch_channel", channel);

  const { data, count, error } = await query;
  if (error) return apiError("Internal error", 500, "INTERNAL_ERROR");
  return json({ data: data ?? [], meta: { total: count ?? 0, page, limit } });
}

// GET /v1/campaigns/:id
async function handleGetCampaign(id: string, wsId: string): Promise<Response> {
  if (!safeUUID(id)) return apiError("Invalid campaign ID format", 400, "INVALID_PARAM");

  const { data, error } = await db
    .from("shooting_campaigns")
    .select("id, name, status, dispatch_channel, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count, created_at, started_at, completed_at")
    .eq("workspace_id", wsId)
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError("Internal error", 500, "INTERNAL_ERROR");
  if (!data)  return apiError("Campaign not found", 404, "NOT_FOUND");
  return json({ data });
}

// GET /v1/stats
async function handleGetStats(wsId: string): Promise<Response> {
  const [contacts, campaigns, active, msgs] = await Promise.all([
    db.from("inbox_contacts")   .select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
    db.from("shooting_campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
    db.from("shooting_campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", wsId).in("status", ["sending","paused"]),
    db.from("shooting_campaigns").select("sent_count").eq("workspace_id", wsId),
  ]);

  const total_sent = (msgs.data ?? []).reduce(
    (acc: number, c: { sent_count: number | null }) => acc + (c.sent_count ?? 0), 0
  );

  return json({
    data: {
      total_contacts:      contacts.count  ?? 0,
      total_campaigns:     campaigns.count ?? 0,
      active_campaigns:    active.count    ?? 0,
      total_messages_sent: total_sent,
      as_of:               new Date().toISOString(),
    },
  });
}

// ── Main router ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const start = Date.now();

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const url    = new URL(req.url);
  const path   = url.pathname.replace(/^\/public-api/, "").replace(/\/$/, "") || "/";
  const method = req.method;

  // ── Auth ──
  const authResult = await authenticate(req);

  if ("fail" in authResult) {
    const status = authResult.fail.status;
    EdgeRuntime.waitUntil(auditLog(null, authResult.workspaceId, method, path, status, Date.now() - start, req));
    return authResult.fail;
  }

  const { key } = authResult;
  const wsId    = key.workspace_id;

  // ── Route dispatch ──
  const parts = path.split("/").filter(Boolean); // ["v1", "contacts", ...]
  let response: Response;

  if (parts[0] !== "v1") {
    response = apiError("Unknown API version. Use /v1/", 404, "NOT_FOUND");
  } else {
    const resource = parts[1];
    const param    = parts[2] ? decodeURIComponent(parts[2]) : undefined;

    if (resource === "contacts" && !param && method === "GET") {
      response = checkScope(key, "contacts:read") ?? await handleGetContacts(req, wsId);
    } else if (resource === "contacts" && param && method === "GET") {
      response = checkScope(key, "contacts:read") ?? await handleGetContact(param, wsId);
    } else if (resource === "contacts" && !param && method === "POST") {
      response = checkScope(key, "contacts:write") ?? await handleUpsertContact(req, wsId);
    } else if (resource === "campaigns" && !param && method === "GET") {
      response = checkScope(key, "campaigns:read") ?? await handleGetCampaigns(req, wsId);
    } else if (resource === "campaigns" && param && method === "GET") {
      response = checkScope(key, "campaigns:read") ?? await handleGetCampaign(param, wsId);
    } else if (resource === "stats" && method === "GET") {
      response = checkScope(key, "stats:read") ?? await handleGetStats(wsId);
    } else {
      response = apiError(`Cannot ${method} /v1/${resource ?? ""}`, 404, "NOT_FOUND");
    }
  }

  // Audit log — fire-and-forget, never delay the response
  EdgeRuntime.waitUntil(auditLog(key.id, wsId, method, path, response.status, Date.now() - start, req));

  return response;
});
