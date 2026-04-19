// Supabase Edge Function — Meta Templates
// Deploy: supabase functions deploy meta-templates
//
// GET  ?connection_id=<uuid>&workspace_id=<uuid>
//        → busca templates na Meta API (paginado), sincroniza com meta_templates, retorna array limpo
//
// POST body:
//   connection_id  string   — UUID da conexão
//   workspace_id   string   — UUID do workspace
//   name           string   — nome do template (a-z, 0-9, _)
//   language       string   — ex: "pt_BR"
//   category       string   — "MARKETING" | "UTILITY" | "AUTHENTICATION"
//   components     array    — componentes no formato exato da Meta API
//
// Secrets needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_BASE = "https://graph.facebook.com/v25.0";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Router ───────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method === "GET")  return await handleList(req);
    if (req.method === "POST") return await handleCreate(req);
    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[meta-templates] unhandled error:", msg);
    return json({ error: msg }, 500);
  }
});

// ── GET: list & sync ─────────────────────────────────────────────

async function handleList(req: Request): Promise<Response> {
  const url          = new URL(req.url);
  const connectionId = url.searchParams.get("connection_id");
  const workspaceId  = url.searchParams.get("workspace_id");

  if (!connectionId || !workspaceId) {
    return json({ error: "connection_id e workspace_id são obrigatórios" }, 400);
  }

  const conn = await getConnection(connectionId, workspaceId);
  if (!conn) return json({ error: "Conexão não encontrada" }, 404);

  // Fetch all pages from Meta
  const { templates, metaError } = await fetchAllTemplates(conn.waba_id, conn.access_token);

  if (metaError) {
    console.error("[meta-templates] list error:", JSON.stringify(metaError));
    return json({
      error:   String((metaError as Record<string,unknown>).message ?? "Erro na Meta API"),
      details: metaError,
    }, 502);
  }

  // Sync to local DB so the Shooting flow can pick templates from there
  await syncToDb(workspaceId, connectionId, templates);

  console.log(`[meta-templates] listados ${templates.length} templates para waba=${conn.waba_id}`);
  return json({ ok: true, count: templates.length, data: templates });
}

// ── POST: create ─────────────────────────────────────────────────

async function handleCreate(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const {
    connection_id,
    workspace_id,
    name,
    language,
    category,
    components,
  } = body as {
    connection_id: string;
    workspace_id:  string;
    name:          string;
    language:      string;
    category:      string;
    components:    unknown[];
  };

  // ── Validações ─────────────────────────────────────────────────
  if (!connection_id || !workspace_id) {
    return json({ error: "connection_id e workspace_id são obrigatórios" }, 400);
  }
  if (!name?.trim()) {
    return json({ error: "name é obrigatório" }, 400);
  }
  if (!/^[a-z0-9_]+$/.test(name)) {
    return json({
      error: "O nome do template deve ter apenas letras minúsculas, números e underscores. Ex: meu_template_1",
    }, 400);
  }
  if (!language) return json({ error: "language é obrigatório (ex: pt_BR)" }, 400);

  const validCategories = ["MARKETING", "UTILITY", "AUTHENTICATION"];
  if (!validCategories.includes(category)) {
    return json({ error: `category deve ser: ${validCategories.join(", ")}` }, 400);
  }
  if (!Array.isArray(components) || components.length === 0) {
    return json({ error: "components é obrigatório e não pode ser vazio" }, 400);
  }

  // ── Busca conexão ──────────────────────────────────────────────
  const conn = await getConnection(connection_id, workspace_id);
  if (!conn) return json({ error: "Conexão não encontrada" }, 404);

  // ── Envia para Meta ────────────────────────────────────────────
  const metaRes = await fetch(`${META_BASE}/${conn.waba_id}/message_templates`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${conn.access_token}`,
    },
    body: JSON.stringify({ name, language, category, components, allow_category_change: true }),
  });

  const metaBody = await metaRes.json() as Record<string, unknown>;

  if (!metaRes.ok) {
    const err = metaBody.error as Record<string, unknown> | undefined;
    console.error("[meta-templates] create error:", JSON.stringify(metaBody));

    // Retorna erro detalhado para o frontend exibir ao usuário
    return json({
      error:   String(err?.error_user_msg ?? err?.message ?? "Erro na Meta API"),
      code:    err?.code           ?? null,
      subcode: err?.error_subcode  ?? null,
      details: err                 ?? metaBody,
    }, 400);
  }

  const templateId     = String(metaBody.id     ?? "");
  const templateStatus = String(metaBody.status ?? "PENDING");

  console.log(`[meta-templates] template criado: ${name} id=${templateId} status=${templateStatus}`);

  // ── Persiste no DB ─────────────────────────────────────────────
  // Status inicial é sempre PENDING — Meta faz a revisão assíncrona
  const { error: dbErr } = await supabase.from("meta_templates").upsert(
    {
      workspace_id:       workspace_id,
      meta_connection_id: connection_id,
      template_id:        templateId,
      template_name:      name,
      language,
      category,
      status:             templateStatus,
      components,
      quality_score:      null,
      last_synced_at:     new Date().toISOString(),
    },
    { onConflict: "meta_connection_id,template_id" },
  );

  if (dbErr) console.warn("[meta-templates] db upsert warning:", dbErr.message);

  return json({ ok: true, id: templateId, status: templateStatus });
}

// ── Helpers ─────────────────────────────────────────────────────

async function getConnection(connectionId: string, workspaceId: string) {
  const { data, error } = await supabase
    .from("meta_connections")
    .select("id, waba_id, access_token")
    .eq("id", connectionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) console.error("[meta-templates] getConnection:", error.message);
  return data as { id: string; waba_id: string; access_token: string } | null;
}

// ── Meta API types ───────────────────────────────────────────────

interface MetaTemplate {
  id:            string;
  name:          string;
  language:      string;
  status:        string;
  category:      string;
  components:    unknown[];
  quality_score: unknown | null;
}

interface FetchResult {
  templates: MetaTemplate[];
  metaError: unknown | null;
}

// Busca todas as páginas de templates (Meta pagina em até 100 por request)
async function fetchAllTemplates(wabaId: string, accessToken: string): Promise<FetchResult> {
  const templates: MetaTemplate[] = [];
  const FIELDS = "id,name,language,status,category,components,quality_score";

  let nextUrl: string | null =
    `${META_BASE}/${wabaId}/message_templates?fields=${FIELDS}&limit=100`;

  while (nextUrl) {
    const res  = await fetch(nextUrl, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    const body = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      return { templates: [], metaError: body.error ?? body };
    }

    const page = (body.data as MetaTemplate[]) ?? [];
    templates.push(...page);

    // Segue cursor de paginação se existir
    const paging = body.paging as Record<string, unknown> | undefined;
    nextUrl = (paging?.next as string | undefined) ?? null;
  }

  return { templates, metaError: null };
}

// Faz upsert de todos os templates na tabela local
async function syncToDb(
  workspaceId: string,
  connectionId: string,
  templates: MetaTemplate[],
): Promise<void> {
  const now = new Date().toISOString();

  // Batch em chunks de 25 para não exceder limites do PostgREST
  const CHUNK = 25;
  for (let i = 0; i < templates.length; i += CHUNK) {
    const chunk = templates.slice(i, i + CHUNK).map((t) => ({
      workspace_id:       workspaceId,
      meta_connection_id: connectionId,
      template_id:        t.id,
      template_name:      t.name,
      language:           t.language,
      category:           t.category,
      status:             t.status,
      components:         t.components,
      quality_score:      t.quality_score ?? null,
      last_synced_at:     now,
    }));

    const { error } = await supabase
      .from("meta_templates")
      .upsert(chunk, { onConflict: "meta_connection_id,template_id" });

    if (error) console.warn(`[meta-templates] sync chunk ${i} error:`, error.message);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
