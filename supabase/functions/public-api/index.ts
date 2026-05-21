// Solve AI — Public REST API Gateway  v2
//
// Security layers:
//  1. Authorization: Bearer sk_live_<64hex>  — key validated via SHA-256 hash
//  2. X-Workspace-Id: <uuid>                 — must match key's workspace (defense-in-depth)
//  3. Scopes enforced per endpoint
//  4. All DB queries hard-filtered by workspace_id from the key (never from user input)
//  5. No /workspaces endpoint — workspace list is never exposed
//  6. Every request logged to api_request_logs (including 401s)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db           = createClient(SUPABASE_URL, SERVICE_KEY);

const BATCH_LIMIT  = 100; // max contacts per batch import
const RATE_LIMIT   = 100; // max requests per 60-second sliding window per key

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Workspace-Id",
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

// ── Auth + workspace validation ───────────────────────────────────────────────

interface ApiKey {
  id:           string;
  workspace_id: string;
  scopes:       string[];
  expires_at:   string | null;
  revoked_at:   string | null;
}

const UNKNOWN_WS = "00000000-0000-0000-0000-000000000000";

// All auth failures return the same generic 401 — never distinguish between
// "key not found", "key revoked", "key expired", or "workspace mismatch".
// This prevents enumeration attacks.
const UNAUTHORIZED = apiError("Invalid or unauthorized API key", 401, "UNAUTHORIZED");

async function authenticate(
  req: Request,
): Promise<{ key: ApiKey } | { fail: Response; workspaceId: string }> {
  // ── Layer 1: Bearer token ──
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return {
      fail: apiError(
        "Missing Authorization header. Required: Authorization: Bearer sk_live_...",
        401, "UNAUTHORIZED",
      ),
      workspaceId: UNKNOWN_WS,
    };
  }

  const rawKey = auth.slice(7).trim();
  // Structural check — reject malformed keys without touching the DB
  if (!/^sk_live_[0-9a-f]{64}$/.test(rawKey)) {
    return { fail: UNAUTHORIZED, workspaceId: UNKNOWN_WS };
  }

  // ── Layer 2: X-Workspace-Id header (required) ──
  const wsHeader = (req.headers.get("X-Workspace-Id") ?? "").trim();
  if (!wsHeader) {
    return {
      fail: apiError(
        "Missing X-Workspace-Id header. Include your workspace UUID with every request.",
        401, "UNAUTHORIZED",
      ),
      workspaceId: UNKNOWN_WS,
    };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wsHeader)) {
    return { fail: UNAUTHORIZED, workspaceId: UNKNOWN_WS };
  }

  // ── Layer 3: Hash lookup ──
  const hash = await sha256Hex(rawKey);
  const { data } = await db
    .from("api_keys")
    .select("id, workspace_id, scopes, expires_at, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();

  if (!data)           return { fail: UNAUTHORIZED, workspaceId: UNKNOWN_WS };
  if (data.revoked_at) return { fail: UNAUTHORIZED, workspaceId: data.workspace_id };
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { fail: UNAUTHORIZED, workspaceId: data.workspace_id };
  }

  // ── Layer 4: Workspace header must match key's workspace ──
  // Even if an attacker has the key, wrong workspace = instant 401.
  // workspace_id is ALWAYS taken from the key record, never from user input.
  if (wsHeader.toLowerCase() !== data.workspace_id.toLowerCase()) {
    return { fail: UNAUTHORIZED, workspaceId: UNKNOWN_WS };
  }

  // Update last_used_at in background
  EdgeRuntime.waitUntil(
    db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id),
  );

  return { key: data as ApiKey };
}

function checkScope(key: ApiKey, scope: string): Response | null {
  if (!key.scopes.includes(scope)) {
    return apiError(`This API key does not have the '${scope}' scope.`, 403, "INSUFFICIENT_SCOPE");
  }
  return null;
}

// ── Rate limiting (sliding 60s window, counted from api_request_logs) ─────────

async function checkRateLimit(keyId: string): Promise<Response | null> {
  const windowStart = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await db
    .from("api_request_logs")
    .select("*", { count: "exact", head: true })
    .eq("key_id", keyId)
    .gte("created_at", windowStart);

  if (error) return null; // fail open — don't block on DB error

  const current   = count ?? 0;
  const remaining = Math.max(0, RATE_LIMIT - current);
  const resetEpoch = Math.floor((Date.now() + 60_000) / 1000);

  if (current >= RATE_LIMIT) {
    return new Response(
      JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests. Maximum 100 requests per 60 seconds per API key." } }),
      {
        status: 429,
        headers: {
          ...CORS_HEADERS,
          "Content-Type":          "application/json",
          "Retry-After":           "60",
          "X-RateLimit-Limit":     String(RATE_LIMIT),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset":     String(resetEpoch),
        },
      },
    );
  }
  return null;
}

// ── Input helpers ─────────────────────────────────────────────────────────────

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

// Upsert a single contact + optional invoice. Returns { id, name, phone } or throws.
async function upsertOne(
  wsId: string,
  entry: Record<string, unknown>,
): Promise<{ id: string; name: string; phone: string }> {
  const name  = (entry.name  as string | undefined)?.trim();
  const phone = safePhone((entry.phone as string | undefined) ?? "");
  if (!name  || name.length < 2) throw new Error("'name' is required (min 2 chars)");
  if (!phone)                     throw new Error("'phone' is required (min 8 digits)");

  const { data: contact, error: cErr } = await db
    .from("inbox_contacts")
    .upsert(
      {
        workspace_id: wsId,
        name,
        phone,
        empresa: (entry.empresa as string | undefined) ?? null,
        cidade:  (entry.cidade  as string | undefined) ?? null,
        estado:  (entry.estado  as string | undefined) ?? null,
        tags:    Array.isArray(entry.tags) ? entry.tags : [],
      },
      { onConflict: "workspace_id,phone" },
    )
    .select("id, name, phone")
    .single();

  if (cErr || !contact) throw new Error(cErr?.message ?? "DB error");

  if (entry.invoice && typeof entry.invoice === "object") {
    const inv  = entry.invoice as Record<string, unknown>;
    const venc = (inv.vencimento as string | undefined)?.slice(0, 10);
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
        { onConflict: "contact_id,numero_nf" },
      );
    }
  }

  return contact as { id: string; name: string; phone: string };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// GET /v1/contacts?q=&venc_from=&venc_to=&valor_min=&valor_max=&invoice_status=&page=0&limit=50
async function handleGetContacts(req: Request, wsId: string): Promise<Response> {
  const url = new URL(req.url);
  const { page, limit } = pageParams(url);
  const q            = url.searchParams.get("q")?.trim();
  const vencFrom     = url.searchParams.get("venc_from")?.slice(0, 10);
  const vencTo       = url.searchParams.get("venc_to")?.slice(0, 10);
  const valorMinRaw  = url.searchParams.get("valor_min");
  const valorMaxRaw  = url.searchParams.get("valor_max");
  const invoiceStatus = url.searchParams.get("invoice_status")?.trim();

  // Date format guard
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (vencFrom  && !ISO_DATE.test(vencFrom))  return apiError("'venc_from' must be YYYY-MM-DD",  400, "INVALID_PARAM");
  if (vencTo    && !ISO_DATE.test(vencTo))    return apiError("'venc_to' must be YYYY-MM-DD",    400, "INVALID_PARAM");
  if (vencFrom && vencTo && vencFrom > vencTo) return apiError("'venc_from' must be <= 'venc_to'", 400, "INVALID_PARAM");

  const valorMin = valorMinRaw ? parseFloat(valorMinRaw) : null;
  const valorMax = valorMaxRaw ? parseFloat(valorMaxRaw) : null;
  if (valorMinRaw && isNaN(valorMin!)) return apiError("'valor_min' must be a number", 400, "INVALID_PARAM");
  if (valorMaxRaw && isNaN(valorMax!)) return apiError("'valor_max' must be a number", 400, "INVALID_PARAM");

  const VALID_INV_STATUSES = ["pendente","vencido","pago","aberto","em_aberto","cancelado"];
  if (invoiceStatus && !VALID_INV_STATUSES.includes(invoiceStatus)) {
    return apiError(`'invoice_status' must be one of: ${VALID_INV_STATUSES.join(", ")}`, 400, "INVALID_PARAM");
  }

  // Use !inner join when any invoice filter is active — excludes contacts with no matching invoices
  const hasInvFilter = !!(vencFrom || vencTo || valorMin != null || valorMax != null || invoiceStatus);
  const selectStr = hasInvFilter
    ? "id, name, phone, empresa, cidade, estado, tags, created_at, contact_invoices!inner(id, valor, vencimento, status, numero_nf)"
    : "id, name, phone, empresa, cidade, estado, tags, created_at, contact_invoices(id, valor, vencimento, status, numero_nf)";

  let query = db
    .from("inbox_contacts")
    .select(selectStr, { count: "exact" })
    .eq("workspace_id", wsId)
    .order("name")
    .range(page * limit, (page + 1) * limit - 1);

  if (q)             query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,empresa.ilike.%${q}%`);
  if (vencFrom)      query = query.gte("contact_invoices.vencimento", vencFrom);
  if (vencTo)        query = query.lte("contact_invoices.vencimento", vencTo);
  if (valorMin != null) query = query.gte("contact_invoices.valor", valorMin);
  if (valorMax != null) query = query.lte("contact_invoices.valor", valorMax);
  if (invoiceStatus) query = query.eq("contact_invoices.status", invoiceStatus);

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

// POST /v1/contacts  — upsert single contact
async function handleUpsertContact(req: Request, wsId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return apiError("Invalid JSON body", 400, "INVALID_BODY"); }

  try {
    const contact = await upsertOne(wsId, body);
    return json({ data: contact, message: "Contact upserted successfully" }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("required") || msg.includes("invalid")) {
      return apiError(msg, 400, "INVALID_PARAM");
    }
    return apiError("Failed to upsert contact", 500, "INTERNAL_ERROR");
  }
}

// POST /v1/contacts/batch  — import up to 100 contacts at once
// Body: { "contacts": [ { name, phone, empresa?, cidade?, estado?, tags?, invoice? }, ... ] }
async function handleBatchUpsertContacts(req: Request, wsId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return apiError("Invalid JSON body", 400, "INVALID_BODY"); }

  const list = body.contacts;
  if (!Array.isArray(list) || list.length === 0) {
    return apiError("'contacts' must be a non-empty array", 400, "INVALID_PARAM");
  }
  if (list.length > BATCH_LIMIT) {
    return apiError(`Maximum ${BATCH_LIMIT} contacts per batch request`, 400, "INVALID_PARAM");
  }

  let created = 0;
  let updated = 0;
  let errors  = 0;

  const results: Array<{
    index:   number;
    phone:   string | null;
    status:  "created" | "updated" | "error";
    error?:  string;
  }> = [];

  for (let i = 0; i < list.length; i++) {
    const entry = list[i] as Record<string, unknown>;
    const phoneRaw = safePhone((entry.phone as string | undefined) ?? "");

    try {
      const contact = await upsertOne(wsId, entry);
      // Supabase upsert doesn't distinguish insert vs update natively,
      // so we check if created_at is very recent (within last 5s)
      const { data: fresh } = await db
        .from("inbox_contacts").select("created_at").eq("id", contact.id).single();
      const isNew = fresh && (Date.now() - new Date(fresh.created_at).getTime()) < 5_000;
      if (isNew) created++; else updated++;
      results.push({ index: i, phone: contact.phone, status: isNew ? "created" : "updated" });
    } catch (e) {
      errors++;
      results.push({
        index:  i,
        phone:  phoneRaw,
        status: "error",
        error:  e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return json({
    data: results,
    summary: { total: list.length, created, updated, errors },
  }, errors === list.length ? 422 : 207);
}

// GET /v1/campaigns?status=&channel=&page=0&limit=20
async function handleGetCampaigns(req: Request, wsId: string): Promise<Response> {
  const url = new URL(req.url);
  const { page, limit } = pageParams(url, 50);
  const status  = url.searchParams.get("status");
  const channel = url.searchParams.get("channel");

  // Allowlist prevents injection via query params
  const VALID_STATUSES = ["draft","scheduled","sending","paused","completed","cancelled","failed"];
  const VALID_CHANNELS = ["z_api","whatsapp","meta","n8n_email"];
  if (status  && !VALID_STATUSES.includes(status))  return apiError("Invalid status value",  400, "INVALID_PARAM");
  if (channel && !VALID_CHANNELS.includes(channel)) return apiError("Invalid channel value", 400, "INVALID_PARAM");

  let query = db
    .from("shooting_campaigns")
    .select(
      "id, name, status, dispatch_channel, total_recipients, sent_count, delivered_count, read_count, failed_count, created_at, started_at, completed_at",
      { count: "exact" },
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
    db.from("inbox_contacts")    .select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
    db.from("shooting_campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
    db.from("shooting_campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", wsId).in("status", ["sending","paused"]),
    db.from("shooting_campaigns").select("sent_count").eq("workspace_id", wsId),
  ]);

  const total_sent = (msgs.data ?? []).reduce(
    (acc: number, c: { sent_count: number | null }) => acc + (c.sent_count ?? 0), 0,
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

  // ── Auth (all 4 layers) ──
  const authResult = await authenticate(req);
  if ("fail" in authResult) {
    EdgeRuntime.waitUntil(
      auditLog(null, authResult.workspaceId, method, path, authResult.fail.status, Date.now() - start, req),
    );
    return authResult.fail;
  }

  const { key } = authResult;
  const wsId    = key.workspace_id; // ← source of truth, never from URL/body

  // ── Rate limit check (after auth so we have key.id) ──
  const rateLimited = await checkRateLimit(key.id);
  if (rateLimited) {
    EdgeRuntime.waitUntil(
      auditLog(key.id, wsId, method, path, 429, Date.now() - start, req),
    );
    return rateLimited;
  }

  // ── API kill switch — check api_enabled on the workspace ──
  const { data: ws } = await db
    .from("workspaces")
    .select("api_enabled")
    .eq("id", wsId)
    .single();
  if (ws && ws.api_enabled === false) {
    const r = apiError("API access is currently disabled for this workspace.", 503, "API_DISABLED");
    EdgeRuntime.waitUntil(auditLog(key.id, wsId, method, path, 503, Date.now() - start, req));
    return r;
  }

  // ── Route dispatch ──
  const parts    = path.split("/").filter(Boolean); // ["v1", "contacts", ...]
  const version  = parts[0];
  const resource = parts[1];
  const sub      = parts[2]; // phone, id, or "batch"

  let response: Response;

  if (version !== "v1") {
    response = apiError("Unknown API version. Use /v1/", 404, "NOT_FOUND");

  } else if (resource === "contacts" && !sub && method === "GET") {
    response = checkScope(key, "contacts:read") ?? await handleGetContacts(req, wsId);

  } else if (resource === "contacts" && sub && sub !== "batch" && method === "GET") {
    response = checkScope(key, "contacts:read") ?? await handleGetContact(sub, wsId);

  } else if (resource === "contacts" && !sub && method === "POST") {
    response = checkScope(key, "contacts:write") ?? await handleUpsertContact(req, wsId);

  } else if (resource === "contacts" && sub === "batch" && method === "POST") {
    response = checkScope(key, "contacts:write") ?? await handleBatchUpsertContacts(req, wsId);

  } else if (resource === "campaigns" && !sub && method === "GET") {
    response = checkScope(key, "campaigns:read") ?? await handleGetCampaigns(req, wsId);

  } else if (resource === "campaigns" && sub && method === "GET") {
    response = checkScope(key, "campaigns:read") ?? await handleGetCampaign(sub, wsId);

  } else if (resource === "stats" && method === "GET") {
    response = checkScope(key, "stats:read") ?? await handleGetStats(wsId);

  } else {
    // Intentionally vague — don't reveal what endpoints exist to unauthenticated probes
    response = apiError(`Cannot ${method} /v1/${resource ?? ""}`, 404, "NOT_FOUND");
  }

  EdgeRuntime.waitUntil(
    auditLog(key.id, wsId, method, path, response.status, Date.now() - start, req),
  );

  return response;
});
