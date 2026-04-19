// Supabase Edge Function — Invite User
// Deploy: supabase functions deploy invite-user
//
// POST { email, full_name, role }
// Requires: Authorization: Bearer <caller_jwt>  (admin ou manager)
//
// Supabase envia o email com magic link automaticamente.
// O novo usuário clica → define senha → fica autenticado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── 1. Verificar JWT do chamador ──────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Não autorizado" }, 401);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: { user: caller }, error: authErr } = await adminClient.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authErr || !caller) return json({ error: "Token inválido" }, 401);

  // ── 2. Verificar cargo do chamador ────────────────────────
  const { data: callerProfile } = await adminClient
    .from("user_profiles")
    .select("role")
    .eq("id", caller.id)
    .single();

  const callerRole = (callerProfile?.role as string) ?? "";
  if (!["admin", "manager"].includes(callerRole)) {
    return json({ error: "Apenas admins e gerentes podem convidar usuários" }, 403);
  }

  // ── 3. Ler e validar body ─────────────────────────────────
  let body: { email?: string; full_name?: string; role?: string };
  try { body = await req.json(); }
  catch { return json({ error: "JSON inválido" }, 400); }

  const { email, full_name, role = "agent" } = body;

  if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return json({ error: "Email inválido" }, 400);
  }
  if (!["admin", "manager", "agent"].includes(role)) {
    return json({ error: "Cargo inválido. Use: admin, manager ou agent" }, 400);
  }
  if (callerRole === "manager" && role === "admin") {
    return json({ error: "Gerentes não podem convidar admins" }, 403);
  }

  // ── 4. Enviar convite via Supabase Auth ───────────────────
  // Supabase cria o usuário em auth.users e envia o email com o link.
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
    email.trim().toLowerCase(),
    { data: { full_name: full_name?.trim() ?? null, role } },
  );

  if (inviteErr) {
    console.error("[invite-user] erro:", inviteErr.message);
    if (inviteErr.message.toLowerCase().includes("already been registered")) {
      return json({ error: "Este email já possui uma conta cadastrada." }, 409);
    }
    return json({ error: inviteErr.message }, 400);
  }

  // ── 5. Criar user_profiles imediatamente ─────────────────
  // O trigger do banco também faz isso, mas garantimos aqui caso
  // o trigger ainda não tenha sido criado no ambiente de produção.
  if (invited.user) {
    const { error: profileErr } = await adminClient.from("user_profiles").upsert(
      { id: invited.user.id, full_name: full_name?.trim() ?? null, role, permissions: {} },
      { onConflict: "id" },
    );
    if (profileErr) console.warn("[invite-user] profile upsert:", profileErr.message);
  }

  console.log(`[invite-user] ✓ convite enviado para ${email} (${role}) por ${caller.email}`);
  return json({ ok: true, email: email.trim().toLowerCase() });
});
