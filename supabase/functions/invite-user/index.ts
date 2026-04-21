// Edge Function — invite-user
// POST { email, full_name, role }
// Authorization: Bearer <caller_access_token>
//
// Flow:
//   1. Verifica JWT do chamador + cargo (admin/manager)
//   2. Resolve workspace_id do chamador
//   3. Se o email já tem conta → adiciona direto ao workspace
//   4. Se é email novo → cria workspace_invites + inviteUserByEmail
//
// No primeiro login do convidado, AuthContext detecta o invite e
// insere em workspace_members automaticamente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── 1. Verificar JWT do chamador ──────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Não autorizado" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: { user: caller }, error: authErr } = await admin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authErr || !caller) return json({ error: "Token inválido" }, 401);

  // ── 2. Verificar cargo do chamador ────────────────────────────
  const { data: callerProfile } = await admin
    .from("user_profiles")
    .select("role")
    .eq("id", caller.id)
    .single();

  const callerRole = (callerProfile?.role as string) ?? "";
  if (!["admin", "manager"].includes(callerRole)) {
    return json({ error: "Apenas admins e gerentes podem convidar membros" }, 403);
  }

  // ── 3. Resolver workspace do chamador ─────────────────────────
  const { data: callerMember } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", caller.id)
    .maybeSingle();

  if (!callerMember?.workspace_id) {
    return json({ error: "Workspace não encontrado para o seu usuário" }, 404);
  }
  const workspaceId = callerMember.workspace_id as string;

  // ── 4. Validar body ───────────────────────────────────────────
  let body: { email?: string; full_name?: string; role?: string };
  try { body = await req.json(); }
  catch { return json({ error: "JSON inválido" }, 400); }

  const { email, full_name, role = "agent" } = body;

  if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return json({ error: "Email inválido" }, 400);
  }
  if (!["admin", "manager", "agent"].includes(role)) {
    return json({ error: "Cargo inválido" }, 400);
  }
  if (callerRole === "manager" && role === "admin") {
    return json({ error: "Gerentes não podem convidar admins" }, 403);
  }

  const normalizedEmail = email.trim().toLowerCase();

  // ── 5. Verificar se o email já tem conta ──────────────────────
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existingUser = existingUsers?.users.find(
    (u) => u.email?.toLowerCase() === normalizedEmail,
  );

  if (existingUser) {
    // Usuário já existe → adicionar direto ao workspace
    const { error: memberErr } = await admin
      .from("workspace_members")
      .upsert(
        { workspace_id: workspaceId, user_id: existingUser.id, role },
        { onConflict: "workspace_id,user_id" },
      );

    if (memberErr) return json({ error: memberErr.message }, 500);

    // Garantir que o perfil tem o cargo certo
    await admin
      .from("user_profiles")
      .upsert(
        { id: existingUser.id, full_name: full_name?.trim() ?? existingUser.user_metadata?.full_name ?? null, role, permissions: {} },
        { onConflict: "id" },
      );

    console.log(`[invite-user] ✓ usuário existente ${normalizedEmail} adicionado ao workspace ${workspaceId}`);
    return json({ ok: true, type: "added", email: normalizedEmail });
  }

  // ── 6. Novo usuário: criar convite + enviar email ─────────────
  const { data: invite, error: inviteInsertErr } = await admin
    .from("workspace_invites")
    .insert({
      workspace_id: workspaceId,
      email:        normalizedEmail,
      role,
      invited_by:   caller.id,
    })
    .select("token")
    .single();

  if (inviteInsertErr) return json({ error: inviteInsertErr.message }, 500);

  const { data: invited, error: inviteEmailErr } = await admin.auth.admin.inviteUserByEmail(
    normalizedEmail,
    {
      data: {
        full_name:               full_name?.trim() ?? null,
        role,
        workspace_invite_token:  invite.token,
      },
    },
  );

  if (inviteEmailErr) {
    // Limpar o registro de convite se o email falhou
    await admin.from("workspace_invites").delete().eq("token", invite.token);
    console.error("[invite-user] erro ao enviar email:", inviteEmailErr.message);
    return json({ error: inviteEmailErr.message }, 400);
  }

  // Criar user_profiles preventivamente com os dados do convite
  if (invited.user) {
    await admin.from("user_profiles").upsert(
      { id: invited.user.id, full_name: full_name?.trim() ?? null, role, permissions: {} },
      { onConflict: "id" },
    );
  }

  console.log(`[invite-user] ✓ convite enviado para ${normalizedEmail} (workspace ${workspaceId})`);
  return json({ ok: true, type: "invited", email: normalizedEmail });
});
