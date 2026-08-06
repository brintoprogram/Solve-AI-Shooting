// Supabase Edge Function — Check WhatsApp Contacts
// Deploy: npx supabase functions deploy check-wa-contacts
//
// Modes:
//   mode "persist" (default): contact_ids[] → updates inbox_contacts.wa_status
//   mode "return":            phones[]      → returns results without writing DB

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";

const META_API = "https://graph.facebook.com/v25.0";
const BATCH    = 50;


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

interface CheckResult { phone: string; status: "valid" | "invalid" | "unknown" }

// Returns results for all phones.
// Throws with a human-readable message if the Meta API itself rejects the request.
async function checkPhones(
  phones: string[],
  conn: { phone_number_id: string; access_token: string },
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (let i = 0; i < phones.length; i += BATCH) {
    const batch = phones.slice(i, i + BATCH);
    const e164s = batch.map((p) => {
      const digits = p.replace(/\D/g, "");
      const norm   = digits.startsWith("55") ? digits : "55" + digits;
      return "+" + norm;
    });

    const res = await fetch(`${META_API}/${conn.phone_number_id}/contacts`, {
      method:  "POST",
      headers: { "Authorization": `Bearer ${conn.access_token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ blocking: "wait", contacts: e164s, force_check: false }),
    });

    if (!res.ok) {
      // Parse Meta's error body for the real message
      let metaMsg = `HTTP ${res.status}`;
      try {
        const errBody = await res.json() as { error?: { message?: string; code?: number } };
        if (errBody.error?.message) metaMsg = errBody.error.message;
      } catch { /* ignore */ }
      throw new Error(`Meta API: ${metaMsg}`);
    }

    const data = await res.json() as { contacts?: Array<{ input: string; status: string }> };
    for (let j = 0; j < batch.length; j++) {
      const entry = (data.contacts ?? [])[j];
      results.push({
        phone:  batch[j],
        status: entry?.status === "valid" ? "valid" : "invalid",
      });
    }
  }

  return results;
}

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const workspace_id = body.workspace_id as string;
  const mode         = (body.mode as string) ?? "persist";

  if (!workspace_id) return json({ error: "workspace_id required" }, 400);

  const conn = await getConnection(workspace_id);
  if (!conn)  return json({ error: "Nenhuma conexão WhatsApp encontrada para este workspace" }, 400);

  // ── MODE: return ──────────────────────────────────────────────────
  if (mode === "return") {
    const phones = body.phones as string[];
    if (!Array.isArray(phones) || !phones.length) return json({ error: "phones[] required" }, 400);
    try {
      const results = await checkPhones(phones, conn);
      return json({ ok: true, results });
    } catch (err) {
      return json({ ok: false, error: (err as Error).message }, 502);
    }
  }

  // ── MODE: persist ─────────────────────────────────────────────────
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

  if (!phones.length) return json({ ok: true, verified: 0 });

  let results: CheckResult[];
  try {
    results = await checkPhones(phones, conn);
  } catch (err) {
    // Reset all contacts back to "unknown" so they don't stay stuck as "checking"
    await supabase.from("inbox_contacts")
      .update({ wa_status: "unknown" })
      .in("id", contact_ids);
    return json({ ok: false, error: (err as Error).message }, 502);
  }

  // Only write definitive results (valid / invalid) — never persist "unknown"
  const now = new Date().toISOString();
  for (const r of results) {
    if (r.status === "unknown") continue;
    const digits = r.phone.replace(/\D/g, "");
    const norm   = digits.startsWith("55") ? digits : "55" + digits;
    const id     = phoneMap.get(norm);
    if (!id) continue;
    await supabase.from("inbox_contacts")
      .update({ wa_status: r.status, wa_checked_at: now })
      .eq("id", id);
  }

  const verified = results.filter((r) => r.status !== "unknown").length;
  return json({ ok: true, verified });
});
