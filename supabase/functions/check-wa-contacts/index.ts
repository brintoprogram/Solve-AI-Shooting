// Supabase Edge Function — Check WhatsApp Contacts
// Deploy: npx supabase functions deploy check-wa-contacts
//
// Modes:
//   mode "persist" (default): contact_ids[] → updates inbox_contacts.wa_status
//   mode "return":            phones[]      → returns results without writing DB

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";

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

async function getConnection(workspace_id: string) {
  const { data, error } = await supabase
    .from("meta_connections")
    .select("phone_number_id, access_token")
    .eq("workspace_id", workspace_id)
    .single();
  if (error || !data) return null;
  return {
    phone_number_id: data.phone_number_id as string,
    access_token:    await decrypt(data.access_token as string),
  };
}

async function checkPhones(
  phones: string[],
  conn: { phone_number_id: string; access_token: string },
): Promise<Array<{ phone: string; status: "valid" | "invalid" | "unknown" }>> {
  const results: Array<{ phone: string; status: "valid" | "invalid" | "unknown" }> = [];

  for (let i = 0; i < phones.length; i += BATCH) {
    const batch  = phones.slice(i, i + BATCH);
    const e164s  = batch.map((p) => {
      const digits = p.replace(/\D/g, "");
      const norm   = digits.startsWith("55") ? digits : "55" + digits;
      return "+" + norm;
    });

    try {
      const res = await fetch(
        `${META_API}/${conn.phone_number_id}/contacts`,
        {
          method:  "POST",
          headers: { "Authorization": `Bearer ${conn.access_token}`, "Content-Type": "application/json" },
          body:    JSON.stringify({ blocking: "wait", contacts: e164s, force_check: false }),
        },
      );

      if (!res.ok) {
        batch.forEach((p) => results.push({ phone: p, status: "unknown" }));
        continue;
      }

      const data = await res.json() as { contacts: Array<{ input: string; status: string }> };
      for (let j = 0; j < batch.length; j++) {
        const entry = (data.contacts ?? [])[j];
        results.push({
          phone:  batch[j],
          status: entry?.status === "valid" ? "valid" : "invalid",
        });
      }
    } catch {
      batch.forEach((p) => results.push({ phone: p, status: "unknown" }));
    }
  }

  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const workspace_id = body.workspace_id as string;
  const mode         = (body.mode as string) ?? "persist";

  if (!workspace_id) return json({ error: "workspace_id required" }, 400);

  const conn = await getConnection(workspace_id);
  if (!conn)  return json({ error: "No WhatsApp connection found for this workspace" }, 400);

  // ── MODE: return — validate phones and return results ──────────────
  if (mode === "return") {
    const phones = body.phones as string[];
    if (!Array.isArray(phones) || !phones.length) return json({ error: "phones[] required" }, 400);
    const results = await checkPhones(phones, conn);
    return json({ ok: true, results });
  }

  // ── MODE: persist — validate contact_ids and update inbox_contacts ─
  const contact_ids = body.contact_ids as string[];
  if (!Array.isArray(contact_ids) || !contact_ids.length)
    return json({ error: "contact_ids[] required" }, 400);

  const { data: contacts } = await supabase
    .from("inbox_contacts")
    .select("id, phone")
    .in("id", contact_ids)
    .eq("workspace_id", workspace_id);

  if (!contacts) return json({ error: "Failed to fetch contacts" }, 500);

  const phoneMap = new Map<string, string>(); // normalized → id
  const phones: string[] = [];

  for (const c of contacts) {
    if (!c.phone) {
      await supabase.from("inbox_contacts")
        .update({ wa_status: "invalid", wa_checked_at: new Date().toISOString() })
        .eq("id", c.id);
      continue;
    }
    const digits = c.phone.replace(/\D/g, "");
    const norm   = digits.startsWith("55") ? digits : "55" + digits;
    phoneMap.set(norm, c.id);
    phones.push(c.phone);
  }

  const results = await checkPhones(phones, conn);

  for (const r of results) {
    const digits = r.phone.replace(/\D/g, "");
    const norm   = digits.startsWith("55") ? digits : "55" + digits;
    const id     = phoneMap.get(norm);
    if (!id) continue;
    await supabase.from("inbox_contacts")
      .update({ wa_status: r.status, wa_checked_at: new Date().toISOString() })
      .eq("id", id);
  }

  return json({ ok: true });
});
