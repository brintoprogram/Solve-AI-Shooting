// Edge Function — n8n-dispatch
// Move o disparo para N8N para o servidor, permitindo incluir o
// WEBHOOK_CALLBACK_SECRET no payload sem expô-lo no bundle do browser.
//
// POST body: { campaign_id, workspace_id, campaign_name, recipients[] }
// Authorization: Bearer <user_access_token>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET  = Deno.env.get("WEBHOOK_CALLBACK_SECRET") ?? "";
const N8N_WEBHOOK     = Deno.env.get("N8N_WEBHOOK_URL");

const db = createClient(SUPABASE_URL, SERVICE_KEY);



Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── Auth: validar JWT ─────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Não autorizado" }, 401);

  const { data: { user: caller }, error: authErr } = await db.auth.getUser(token);
  if (authErr || !caller) return json({ error: "Token inválido" }, 401);

  // ── Ler body ──────────────────────────────────────────────────
  let body: {
    campaign_id:   string;
    workspace_id:  string;
    campaign_name: string;
    recipients:    { message_id: string; name: string | null; phone: string; recipient_data: unknown }[];
  };
  try { body = await req.json(); }
  catch { return json({ error: "JSON inválido" }, 400); }

  const { campaign_id, workspace_id, campaign_name, recipients } = body;
  if (!campaign_id || !workspace_id || !Array.isArray(recipients)) {
    return json({ error: "campaign_id, workspace_id e recipients são obrigatórios" }, 400);
  }

  // ── Verificar que o chamador pertence ao workspace ────────────
  const { data: membership } = await db
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", caller.id)
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (!membership) {
    return json({ error: "Sem permissão para este workspace" }, 403);
  }

  // ── Montar payload com secret server-side ─────────────────────
  const callbackUrl = `${SUPABASE_URL}/functions/v1/update-campaign-status`;

  const n8nPayload = {
    campaign_id,
    workspace_id,
    campaign_name,
    dispatched_at:   new Date().toISOString(),
    callback_api:    callbackUrl,
    callback_secret: WEBHOOK_SECRET, // nunca exposto no bundle do browser
    recipients,
  };

  if (!N8N_WEBHOOK) {
    console.error("[n8n-dispatch] N8N_WEBHOOK_URL não configurado");
    return json({ error: "Configuração incompleta no servidor" }, 500);
  }

  const n8nRes = await fetch(N8N_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(n8nPayload),
  });

  if (!n8nRes.ok) {
    const text = await n8nRes.text().catch(() => "");
    console.error(`[n8n-dispatch] N8N retornou ${n8nRes.status}: ${text}`);
    return json({ error: `N8N retornou ${n8nRes.status}` }, 502);
  }

  console.log(`[n8n-dispatch] ✓ campaign ${campaign_id} → N8N (${recipients.length} recipients)`);
  return json({ ok: true });
});
