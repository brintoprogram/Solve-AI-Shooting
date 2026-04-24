// Supabase Edge Function — GDPR / LGPD Right to be Forgotten
// Deploy: npx supabase functions deploy gdpr-forget
//
// Body: { workspace_id, contact_id, mode: "anonymize" | "hard_delete" }
//
// mode "anonymize" (default): replaces PII fields, keeps historical records
// mode "hard_delete": full DELETE + cascade (irreversible)
//
// Both modes log to audit_logs.

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

// Simple hash for phone anonymization (no crypto import needed — just for display masking)
function maskPhone(phone: string | null): string {
  if (!phone) return "REMOVIDO";
  const digits = phone.replace(/\D/g, "");
  // Keep last 4 digits visible for audit trail traceability, mask the rest
  return `ANON_${digits.slice(-4)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  // Resolve calling user from JWT
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
  const mode         = (body.mode as string) ?? "anonymize";

  if (!workspace_id || !contact_id) return json({ error: "workspace_id and contact_id required" }, 400);
  if (mode !== "anonymize" && mode !== "hard_delete") return json({ error: "mode must be 'anonymize' or 'hard_delete'" }, 400);

  // ── Fetch contact to verify ownership and get phone for audit ──────
  const { data: contact, error: cErr } = await supabase
    .from("inbox_contacts")
    .select("id, phone, name")
    .eq("id", contact_id)
    .eq("workspace_id", workspace_id)
    .single();

  if (cErr || !contact) return json({ error: "Contact not found" }, 404);

  const originalPhone = contact.phone;
  const originalName  = contact.name;

  if (mode === "hard_delete") {
    // ── Hard delete — cascade expected via FK constraints ─────────────
    const { error: delErr } = await supabase
      .from("inbox_contacts")
      .delete()
      .eq("id", contact_id)
      .eq("workspace_id", workspace_id);

    if (delErr) return json({ error: "Delete failed", detail: delErr.message }, 500);

    await supabase.from("audit_logs").insert({
      workspace_id,
      user_id:    user.id,
      event_type: "gdpr_forget",
      entity_id:  originalPhone ?? contact_id,
      metadata:   { contact_id, mode: "hard_delete", contact_name: originalName },
    });

    return json({ ok: true, mode: "hard_delete" });
  }

  // ── Anonymize — replace PII, keep row for statistical integrity ────
  const anonPhone = maskPhone(originalPhone);

  const { error: updErr } = await supabase
    .from("inbox_contacts")
    .update({
      name:                "TITULAR REMOVIDO",
      phone:               anonPhone,
      cpf_cnpj:            null,
      email:               null,
      email2:              null,
      empresa:             null,
      nome_representante:  null,
      email_representante: null,
      logradouro:          null,
      numero:              null,
      complemento:         null,
      bairro:              null,
      cidade:              null,
      estado:              null,
      cep:                 null,
      tags:                [],
      wa_status:           null,
    })
    .eq("id", contact_id)
    .eq("workspace_id", workspace_id);

  if (updErr) return json({ error: "Anonymization failed", detail: updErr.message }, 500);

  // Anonymize phone in shooting_messages for the same workspace
  if (originalPhone) {
    await supabase
      .from("shooting_messages")
      .update({ phone: anonPhone })
      .eq("phone", originalPhone)
      .eq("workspace_id", workspace_id);
  }

  await supabase.from("audit_logs").insert({
    workspace_id,
    user_id:    user.id,
    event_type: "gdpr_forget",
    entity_id:  originalPhone ?? contact_id,
    metadata:   { contact_id, mode: "anonymize", contact_name: originalName },
  });

  return json({ ok: true, mode: "anonymize" });
});
