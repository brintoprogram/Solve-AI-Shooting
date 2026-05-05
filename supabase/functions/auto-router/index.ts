// Supabase Edge Function — Auto-Router (Department Routing Menu)
// Deploy: supabase functions deploy auto-router --no-verify-jwt
//
// Called internally by meta-webhook when a NEW conversation is created
// in a workspace with routing_enabled = true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Inline decrypt — avoids _shared path resolution issues on MCP deploy
const ENC_PREFIX = "enc:v1:";
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}
async function decrypt(value: string): Promise<string> {
  if (!value.startsWith(ENC_PREFIX)) return value;
  const rest     = value.slice(ENC_PREFIX.length);
  const colonIdx = rest.indexOf(":");
  if (colonIdx === -1) throw new Error("Invalid encrypted token format");
  const iv         = hexToBytes(rest.slice(0, colonIdx));
  const ciphertext = Uint8Array.from(atob(rest.slice(colonIdx + 1)), (c) => c.charCodeAt(0));
  const keyHex     = Deno.env.get("ENCRYPTION_KEY") ?? "";
  const key        = await crypto.subtle.importKey("raw", hexToBytes(keyHex), "AES-GCM", false, ["decrypt"]);
  const decrypted  = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

const META_API = "https://graph.facebook.com/v25.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: { conversation_id: string; workspace_id: string; connection_id: string; contact_phone: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { conversation_id, workspace_id, connection_id, contact_phone } = body;
  if (!conversation_id || !workspace_id || !connection_id || !contact_phone) {
    return new Response("Missing required fields", { status: 400 });
  }

  try {
    await runAutoRouter(conversation_id, workspace_id, connection_id, contact_phone);
    return new Response("OK", { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[auto-router] error:", msg);
    return new Response("Internal error", { status: 500 });
  }
});

async function runAutoRouter(
  conversationId: string,
  workspaceId:    string,
  connectionId:   string,
  contactPhone:   string,
): Promise<void> {
  // 1. Fetch workspace routing config + departments in parallel
  const [wsRes, deptRes, connRes] = await Promise.all([
    supabase
      .from("workspaces")
      .select("routing_enabled, routing_header, routing_body")
      .eq("id", workspaceId)
      .single(),
    supabase
      .from("departments")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("order_index", { ascending: true })
      .limit(10),
    supabase
      .from("meta_connections")
      .select("phone_number_id, access_token")
      .eq("id", connectionId)
      .single(),
  ]);

  const workspace = wsRes.data;
  if (!workspace?.routing_enabled) {
    console.log(`[auto-router] routing disabled for workspace=${workspaceId} — skipping`);
    return;
  }

  const departments = deptRes.data ?? [];
  if (departments.length === 0) {
    console.log(`[auto-router] no departments configured for workspace=${workspaceId} — skipping`);
    return;
  }

  const conn = connRes.data;
  if (!conn?.phone_number_id || !conn?.access_token) {
    console.error(`[auto-router] connection ${connectionId} missing phone_number_id or access_token`);
    return;
  }

  const accessToken = await decrypt(conn.access_token);

  // 2. Build interactive list message
  const rows = departments.map((d: { id: string; name: string }) => ({
    id:    d.id,
    title: d.name.slice(0, 24), // WhatsApp max 24 chars per row title
  }));

  const payload = {
    messaging_product: "whatsapp",
    recipient_type:    "individual",
    to:                contactPhone,
    type:              "interactive",
    interactive: {
      type: "list",
      header: workspace.routing_header
        ? { type: "text", text: workspace.routing_header.slice(0, 60) }
        : undefined,
      body:   { text: (workspace.routing_body ?? "Selecione uma opção:").slice(0, 1024) },
      action: {
        button:   "Ver opções",
        sections: [{ title: "Setores", rows }],
      },
    },
  };

  // 3. Send via Meta API
  const sendRes = await fetch(`${META_API}/${conn.phone_number_id}/messages`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!sendRes.ok) {
    const errBody = await sendRes.text().catch(() => "(no body)");
    console.error(`[auto-router] Meta API error ${sendRes.status}: ${errBody}`);
    return;
  }

  const sendData = await sendRes.json() as { messages?: Array<{ id: string }> };
  const wamid    = sendData.messages?.[0]?.id ?? null;

  console.log(`[auto-router] ✓ menu sent to ${contactPhone} wamid=${wamid}`);

  // 4. Save the routing menu as an outbound message in the conversation
  const now = new Date().toISOString();
  if (wamid) {
    await supabase.from("inbox_messages").insert({
      workspace_id:    workspaceId,
      conversation_id: conversationId,
      contact_id:      null, // outbound — no contact_id needed
      wamid,
      direction:       "outbound",
      message_type:    "interactive",
      body:            workspace.routing_body ?? "Selecione uma opção:",
      is_internal:     false,
      status:          "sent",
      created_at:      now,
    }).then(({ error }) => {
      if (error) console.error("[auto-router] failed to save menu message:", error.message);
    });
  }

  // 5. Set conversation to pending (waiting for citizen to pick department)
  await supabase
    .from("inbox_conversations")
    .update({ status: "pending", updated_at: now })
    .eq("id", conversationId);
}
