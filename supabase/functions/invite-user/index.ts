// Supabase Edge Function — Invite User
// Deploy: supabase functions deploy invite-user
//
// POST body:
//   email      string — e-mail do novo membro
//   full_name  string — nome completo
//   role       string — "admin" | "manager" | "agent"
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { email, full_name, role } = body as {
    email: string;
    full_name: string;
    role: string;
  };

  if (!email?.trim()) return json({ error: "email é obrigatório" }, 400);
  if (!full_name?.trim()) return json({ error: "full_name é obrigatório" }, 400);

  const validRoles = ["admin", "manager", "agent"];
  if (!validRoles.includes(role)) {
    return json({ error: `role inválido. Use: ${validRoles.join(", ")}` }, 400);
  }

  // 1. Send invite — creates the auth.users row and sends the email
  const { data: inviteData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
    email.trim().toLowerCase(),
    {
      data: { full_name: full_name.trim(), role },
    },
  );

  if (inviteErr) {
    console.error("[invite-user] inviteUserByEmail error:", inviteErr.message);
    return json({ error: inviteErr.message }, 400);
  }

  const userId = inviteData.user?.id;
  console.log(`[invite-user] convite enviado para ${email} userId=${userId}`);

  // 2. Update user_profiles with the correct name and role
  //    (the DB trigger creates the row with defaults; we overwrite here)
  if (userId) {
    const { error: profileErr } = await supabase
      .from("user_profiles")
      .upsert(
        { id: userId, full_name: full_name.trim(), role },
        { onConflict: "id" },
      );

    if (profileErr) {
      console.warn("[invite-user] profile upsert warning:", profileErr.message);
    }
  }

  return json({ ok: true, user_id: userId });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
