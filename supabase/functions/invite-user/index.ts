// Edge Function — invite-user
// POST { email, full_name, role, workspace_id }
// Authorization: Bearer <caller_access_token>
//
// Flow:
//   1. Verifica JWT do chamador + cargo (admin/manager)
//   2. Valida membership do chamador no workspace
//   3. Tenta inviteUserByEmail
//      a. Se sucesso → novo usuário convidado, cria workspace_invites + user_profiles
//      b. Se "already registered" → busca usuário existente e adiciona direto ao workspace
//      c. Outros erros → retorna mensagem de erro

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

  try {
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

    // ── 3. Validar body ───────────────────────────────────────────
    let body: { email?: string; full_name?: string; role?: string; workspace_id?: string };
    try { body = await req.json(); }
    catch { return json({ error: "JSON inválido" }, 400); }

    const { email, full_name, role = "agent", workspace_id: reqWorkspaceId } = body;

    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return json({ error: "Email inválido" }, 400);
    }
    if (!["admin", "manager", "agent"].includes(role)) {
      return json({ error: "Cargo inválido" }, 400);
    }
    if (callerRole === "manager" && role === "admin") {
      return json({ error: "Gerentes não podem convidar admins" }, 403);
    }
    if (!reqWorkspaceId) {
      return json({ error: "workspace_id é obrigatório" }, 400);
    }

    // Verificar que o chamador é membro do workspace solicitado
    const { data: callerMember } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", caller.id)
      .eq("workspace_id", reqWorkspaceId)
      .maybeSingle();

    if (!callerMember) {
      return json({ error: "Você não tem permissão para convidar neste workspace" }, 403);
    }

    const workspaceId = reqWorkspaceId;
    const normalizedEmail = email.trim().toLowerCase();
    const displayName = full_name?.trim() ?? null;

    // ── 4. Tentar enviar convite (detecta se usuário já existe) ───
    // Insere workspace_invite primeiro para ter o token disponível no email
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    const { data: invite, error: inviteInsertErr } = await admin
      .from("workspace_invites")
      .insert({ workspace_id: workspaceId, email: normalizedEmail, role, invited_by: caller.id, expires_at: expiresAt })
      .select("token")
      .single();

    if (inviteInsertErr) {
      // Unique constraint: este email já tem um convite pendente neste workspace
      const isDuplicate = inviteInsertErr.code === "23505";
      return json({
        error: isDuplicate
          ? "Este email já tem um convite pendente para este workspace."
          : inviteInsertErr.message,
      }, isDuplicate ? 409 : 500);
    }

    const { data: invited, error: inviteEmailErr } = await admin.auth.admin.inviteUserByEmail(
      normalizedEmail,
      { data: { full_name: displayName, role, workspace_invite_token: invite.token } },
    );

    // ── 4a. Novo usuário — convite enviado com sucesso ────────────
    if (!inviteEmailErr) {
      if (invited?.user) {
        await admin.from("user_profiles").upsert(
          { id: invited.user.id, full_name: displayName, role, permissions: {} },
          { onConflict: "id" },
        );
      }
      console.log(`[invite-user] ✓ convite enviado para ${normalizedEmail}`);
      return json({ ok: true, type: "invited", email: normalizedEmail });
    }

    // ── 4b. Usuário já existe → adicionar direto ao workspace ─────
    const alreadyRegistered =
      inviteEmailErr.message?.toLowerCase().includes("already registered") ||
      inviteEmailErr.message?.toLowerCase().includes("already been registered") ||
      (inviteEmailErr as { status?: number }).status === 422;

    if (alreadyRegistered) {
      // Limpar workspace_invite (desnecessário para usuário existente)
      await admin.from("workspace_invites").delete().eq("token", invite.token);

      // Buscar o usuário pelo email via listUsers (filtragem client-side)
      // Funciona bem para qualquer tamanho de equipe — perPage=1000 cobre casos reais
      const { data: listData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existingUser = (listData?.users ?? []).find((u) => u.email === normalizedEmail);

      if (!existingUser) {
        console.error(`[invite-user] usuário existente não encontrado via listUsers: ${normalizedEmail}`);
        return json({ error: "Usuário já registrado mas não foi possível localizá-lo. Tente novamente." }, 500);
      }

      const { error: memberErr } = await admin
        .from("workspace_members")
        .upsert(
          { workspace_id: workspaceId, user_id: existingUser.id, role },
          { onConflict: "workspace_id,user_id" },
        );
      if (memberErr) return json({ error: memberErr.message }, 500);

      // Preservar permissões existentes — só atualiza role e nome
      const { error: profileInsertErr } = await admin
        .from("user_profiles")
        .insert({ id: existingUser.id, full_name: displayName ?? existingUser.user_metadata?.full_name ?? null, role, permissions: {} });
      if (profileInsertErr) {
        await admin
          .from("user_profiles")
          .update({ role, full_name: displayName ?? existingUser.user_metadata?.full_name ?? null })
          .eq("id", existingUser.id);
      }

      console.log(`[invite-user] ✓ usuário existente ${normalizedEmail} adicionado ao workspace ${workspaceId}`);
      return json({ ok: true, type: "added", email: normalizedEmail });
    }

    // ── 4c. Outro erro de email ───────────────────────────────────
    await admin.from("workspace_invites").delete().eq("token", invite.token);
    console.error(`[invite-user] erro ao enviar convite: ${inviteEmailErr.message}`);
    return json({ error: inviteEmailErr.message }, 400);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[invite-user] erro inesperado:", message);
    return json({ error: `Erro interno: ${message}` }, 500);
  }
});
