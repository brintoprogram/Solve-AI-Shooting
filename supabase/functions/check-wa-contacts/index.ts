// Supabase Edge Function — Check WhatsApp Contacts
// Deploy: npx supabase functions deploy check-wa-contacts
//
// POST body:
//   workspace_id  string    — workspace UUID
//   contact_ids   string[]  — IDs of inbox_contacts to verify

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_API = "https://graph.facebook.com/v21.0";
const BATCH    = 50;

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
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const workspace_id = body.workspace_id as string;
  const contact_ids  = body.contact_ids  as string[];

  if (!workspace_id || !Array.isArray(contact_ids) || !contact_ids.length) {
    return json({ error: "workspace_id and contact_ids required" }, 400);
  }

  // Get workspace WhatsApp connection
  const { data: conn, error: connErr } = await supabase
    .from("meta_connections")
    .select("phone_number_id, access_token")
    .eq("workspace_id", workspace_id)
    .single();

  if (connErr || !conn) {
    return json({ error: "No WhatsApp connection found for this workspace" }, 400);
  }

  // Fetch contacts with their phone numbers
  const { data: contacts, error: contErr } = await supabase
    .from("inbox_contacts")
    .select("id, phone")
    .in("id", contact_ids)
    .eq("workspace_id", workspace_id);

  if (contErr || !contacts) {
    return json({ error: "Failed to fetch contacts" }, 500);
  }

  // Process in batches
  for (let i = 0; i < contacts.length; i += BATCH) {
    const batch = contacts.slice(i, i + BATCH);
    const phoneMap = new Map<string, string>(); // normalized phone → contact id

    const phoneList: string[] = [];
    for (const c of batch) {
      if (!c.phone) {
        // no phone — mark invalid immediately
        await supabase
          .from("inbox_contacts")
          .update({ wa_status: "invalid", wa_checked_at: new Date().toISOString() })
          .eq("id", c.id);
        continue;
      }
      const digits = c.phone.replace(/\D/g, "");
      const norm   = digits.startsWith("55") ? digits : "55" + digits;
      const e164   = "+" + norm;
      phoneMap.set(norm, c.id);
      phoneList.push(e164);
    }

    if (!phoneList.length) continue;

    try {
      const res = await fetch(
        `${META_API}/${conn.phone_number_id}/contacts`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${conn.access_token}`,
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({
            blocking:    "wait",
            contacts:    phoneList,
            force_check: false,
          }),
        },
      );

      if (!res.ok) {
        // Mark all in batch as unknown on API error
        for (const c of batch) {
          await supabase
            .from("inbox_contacts")
            .update({ wa_status: "unknown", wa_checked_at: new Date().toISOString() })
            .eq("id", c.id);
        }
        continue;
      }

      const result = await res.json() as { contacts: Array<{ input: string; status: string; wa_id?: string }> };

      for (const entry of result.contacts ?? []) {
        // entry.input is e164 like "+5511987654321"
        const norm = entry.input.replace(/^\+/, "");
        const id   = phoneMap.get(norm);
        if (!id) continue;
        await supabase
          .from("inbox_contacts")
          .update({
            wa_status:     entry.status === "valid" ? "valid" : "invalid",
            wa_checked_at: new Date().toISOString(),
          })
          .eq("id", id);
      }
    } catch {
      // on network error, leave as unknown
      for (const c of batch) {
        await supabase
          .from("inbox_contacts")
          .update({ wa_status: "unknown", wa_checked_at: new Date().toISOString() })
          .eq("id", c.id);
      }
    }
  }

  return json({ ok: true });
});
