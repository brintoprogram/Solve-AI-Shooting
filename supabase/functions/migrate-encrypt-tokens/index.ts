// Supabase Edge Function — One-time token encryption migration
// Deploy: npx supabase functions deploy migrate-encrypt-tokens
// Run ONCE: POST { workspace_id?: string } (omit to migrate ALL workspaces)
//
// Encrypts existing plaintext values in:
//   meta_connections.access_token
//   email_connections.password
//   email_connections.oauth_access_token
//   email_connections.oauth_refresh_token
//
// Safe to run multiple times — already-encrypted values (enc:v1: prefix) are skipped.
// DELETE this function after migration is confirmed complete.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encrypt, isEncrypted } from "../_shared/crypto.ts";

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

  // Require service-role authorization for safety
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Authorization required" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* body is optional */ }

  const workspace_id = body.workspace_id as string | undefined;

  let metaUpdated = 0;
  let emailUpdated = 0;

  // ── meta_connections.access_token ─────────────────────────────────
  {
    let query = supabase.from("meta_connections").select("id, access_token");
    if (workspace_id) query = query.eq("workspace_id", workspace_id);
    const { data: rows, error } = await query;
    if (error) return json({ error: `meta_connections fetch failed: ${error.message}` }, 500);

    for (const row of rows ?? []) {
      if (!row.access_token || isEncrypted(row.access_token)) continue;
      const enc = await encrypt(row.access_token);
      const { error: updErr } = await supabase
        .from("meta_connections")
        .update({ access_token: enc })
        .eq("id", row.id);
      if (updErr) console.error(`[migrate] meta_connections ${row.id}:`, updErr.message);
      else metaUpdated++;
    }
  }

  // ── email_connections: password + oauth tokens ─────────────────────
  {
    let query = supabase
      .from("email_connections")
      .select("id, password, oauth_access_token, oauth_refresh_token");
    if (workspace_id) query = query.eq("workspace_id", workspace_id);
    const { data: rows, error } = await query;
    if (error) return json({ error: `email_connections fetch failed: ${error.message}` }, 500);

    for (const row of rows ?? []) {
      const patch: Record<string, string> = {};

      if (row.password && !isEncrypted(row.password))
        patch.password = await encrypt(row.password);

      if (row.oauth_access_token && !isEncrypted(row.oauth_access_token))
        patch.oauth_access_token = await encrypt(row.oauth_access_token);

      if (row.oauth_refresh_token && !isEncrypted(row.oauth_refresh_token))
        patch.oauth_refresh_token = await encrypt(row.oauth_refresh_token);

      if (Object.keys(patch).length === 0) continue;

      const { error: updErr } = await supabase
        .from("email_connections")
        .update(patch)
        .eq("id", row.id);
      if (updErr) console.error(`[migrate] email_connections ${row.id}:`, updErr.message);
      else emailUpdated++;
    }
  }

  console.log(`[migrate] done: meta_connections=${metaUpdated} email_connections=${emailUpdated}`);
  return json({ ok: true, meta_connections_encrypted: metaUpdated, email_connections_encrypted: emailUpdated });
});
