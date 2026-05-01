// Edge Function — z-api-proxy
// Proxies Z-API calls from the browser, handling credential encryption/decryption.
//
// POST { action, ...fields }
// action: "save"    → encrypt + upsert credentials
//         "qrcode"  → fetch QR code image from Z-API
//         "status"  → fetch /me, update DB status, return connection state
//         "delete"  → remove a connection by id

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { encrypt, decrypt } from "../_shared/crypto.ts";

Deno.serve(async (req: Request) => {
  const CORS = corsHeaders(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: { user } } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!user) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const action = body.action as string | undefined;
  if (!action) return json({ error: "action required" }, 400);

  // ── action: save ──────────────────────────────────────────────────
  if (action === "save") {
    const { workspace_id, name, instance_id, token, client_token, id } =
      body as Record<string, string | undefined>;

    if (!workspace_id || !name || !instance_id || !token || !client_token) {
      return json({ error: "Missing required fields: workspace_id, name, instance_id, token, client_token" }, 400);
    }

    const { count } = await admin
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspace_id)
      .eq("user_id", user.id);
    if ((count ?? 0) === 0) return json({ error: "Forbidden" }, 403);

    const encToken       = await encrypt(token);
    const encClientToken = await encrypt(client_token);

    if (id) {
      const { error } = await admin
        .from("z_api_connections")
        .update({ name, instance_id, token: encToken, client_token: encClientToken, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("workspace_id", workspace_id);
      if (error) return json({ error: error.message }, 500);
      const { data } = await admin.from("z_api_connections").select("*").eq("id", id).single();
      return json({ ok: true, data });
    }

    const { data, error } = await admin
      .from("z_api_connections")
      .upsert(
        { workspace_id, name, instance_id, token: encToken, client_token: encClientToken },
        { onConflict: "workspace_id,instance_id" },
      )
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, data });
  }

  // ── action: delete ────────────────────────────────────────────────
  if (action === "delete") {
    const { connection_id } = body as { connection_id?: string };
    if (!connection_id) return json({ error: "connection_id required" }, 400);

    const { data: conn } = await admin
      .from("z_api_connections")
      .select("workspace_id")
      .eq("id", connection_id)
      .maybeSingle();
    if (!conn) return json({ ok: true }); // already gone

    const { count } = await admin
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", conn.workspace_id)
      .eq("user_id", user.id);
    if ((count ?? 0) === 0) return json({ error: "Forbidden" }, 403);

    await admin.from("z_api_connections").delete().eq("id", connection_id);
    return json({ ok: true });
  }

  // ── actions that need connection_id + decrypted credentials ───────
  const { connection_id } = body as { connection_id?: string };
  if (!connection_id) return json({ error: "connection_id required" }, 400);

  const { data: conn, error: connErr } = await admin
    .from("z_api_connections")
    .select("*")
    .eq("id", connection_id)
    .maybeSingle();
  if (connErr || !conn) return json({ error: "Connection not found" }, 404);

  const { count: memberCount } = await admin
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", conn.workspace_id)
    .eq("user_id", user.id);
  if ((memberCount ?? 0) === 0) return json({ error: "Forbidden" }, 403);

  const rawToken       = await decrypt(conn.token);
  const rawClientToken = await decrypt(conn.client_token);
  const baseUrl        = `https://api.z-api.io/instances/${conn.instance_id}/token/${rawToken}`;
  const zHeaders       = { "Client-Token": rawClientToken, "Content-Type": "application/json" };

  // ── action: qrcode ────────────────────────────────────────────────
  if (action === "qrcode") {
    const res = await fetch(`${baseUrl}/qr-code/image`, { headers: zHeaders });
    if (!res.ok) {
      const txt = await res.text();
      console.error(`[z-api-proxy] qrcode error ${res.status}:`, txt);
      return json({ error: `Z-API error ${res.status}` }, 502);
    }
    const data = await res.json() as { value?: string };
    return json({ ok: true, qrcode: data.value ?? "" });
  }

  // ── action: status ────────────────────────────────────────────────
  if (action === "status") {
    const res = await fetch(`${baseUrl}/me`, { headers: zHeaders });
    if (!res.ok) {
      const txt = await res.text();
      console.error(`[z-api-proxy] status error ${res.status}:`, txt);
      return json({ error: `Z-API error ${res.status}` }, 502);
    }
    const data = await res.json() as { connected?: boolean; phone?: string; name?: string };
    const connected    = data.connected ?? false;
    const phone        = data.phone        ?? null;
    const display_name = data.name         ?? null;
    const status       = connected ? "connected" : "disconnected";

    await admin
      .from("z_api_connections")
      .update({ status, phone, display_name, updated_at: new Date().toISOString() })
      .eq("id", connection_id);

    return json({ ok: true, connected, phone, display_name });
  }

  return json({ error: "Unknown action" }, 400);
});
