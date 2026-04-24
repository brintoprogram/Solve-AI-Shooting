// Supabase Edge Function — GDPR / LGPD Data Export
// Deploy: npx supabase functions deploy gdpr-export
//
// Body: { workspace_id, contact_id }
// Returns structured JSON with all personal data held for the titular.
// Logs the export event to audit_logs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  // Resolve the calling user from the JWT
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const workspace_id = body.workspace_id as string;
  const contact_id   = body.contact_id   as string;

  if (!workspace_id || !contact_id) return json({ error: "workspace_id and contact_id required" }, 400);

  // ── Fetch contact ──────────────────────────────────────────────────
  const { data: contact, error: cErr } = await supabase
    .from("inbox_contacts")
    .select("*")
    .eq("id", contact_id)
    .eq("workspace_id", workspace_id)
    .single();

  if (cErr || !contact) return json({ error: "Contact not found" }, 404);

  // ── Fetch related data in parallel ────────────────────────────────
  const [invoicesRes, notesRes, convsRes, shootingRes] = await Promise.all([
    supabase.from("contact_invoices")
      .select("numero_nf, valor, vencimento, status, created_at")
      .eq("contact_id", contact_id)
      .order("vencimento", { ascending: false }),

    supabase.from("contact_notes")
      .select("tipo, conteudo, created_by, created_at")
      .eq("contact_id", contact_id)
      .order("created_at", { ascending: false }),

    supabase.from("inbox_conversations")
      .select("id, status, created_at")
      .eq("contact_id", contact_id)
      .eq("workspace_id", workspace_id)
      .order("created_at", { ascending: false }),

    supabase.from("shooting_messages")
      .select("campaign_id, status, sent_at, delivered_at, read_at")
      .eq("phone", contact.phone ?? "")
      .eq("workspace_id", workspace_id)
      .order("sent_at", { ascending: false })
      .limit(500),
  ]);

  // Fetch messages for all conversations
  const convIds = (convsRes.data ?? []).map((c: { id: string }) => c.id);
  let messages: unknown[] = [];
  if (convIds.length > 0) {
    const { data: msgs } = await supabase
      .from("inbox_messages")
      .select("conversation_id, direction, body, status, created_at")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: false })
      .limit(1000);
    messages = msgs ?? [];
  }

  // ── Build export payload ───────────────────────────────────────────
  const exportData = {
    exported_at: new Date().toISOString(),
    contact: {
      id:                  contact.id,
      name:                contact.name,
      phone:               contact.phone,
      cpf_cnpj:            contact.cpf_cnpj,
      email:               contact.email,
      email2:              contact.email2,
      empresa:             contact.empresa,
      nome_representante:  contact.nome_representante,
      email_representante: contact.email_representante,
      logradouro:          contact.logradouro,
      numero:              contact.numero,
      complemento:         contact.complemento,
      bairro:              contact.bairro,
      cidade:              contact.cidade,
      estado:              contact.estado,
      cep:                 contact.cep,
      tags:                contact.tags ?? [],
      wa_status:           contact.wa_status,
      created_at:          contact.created_at,
    },
    invoices:         invoicesRes.data   ?? [],
    notes:            notesRes.data      ?? [],
    conversations:    convsRes.data      ?? [],
    messages,
    campaign_messages: shootingRes.data  ?? [],
  };

  // ── Audit log ──────────────────────────────────────────────────────
  await supabase.from("audit_logs").insert({
    workspace_id,
    user_id:    user.id,
    event_type: "gdpr_export",
    entity_id:  contact.phone ?? contact_id,
    metadata:   { contact_id, contact_name: contact.name },
  });

  return json({ ok: true, data: exportData });
});
