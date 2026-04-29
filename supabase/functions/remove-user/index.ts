// Edge Function — remove-user
// POST { user_id, workspace_id }
// Authorization: Bearer <caller_access_token>
//
// Flow:
//   1. Verifica JWT do chamador + cargo (admin/manager)
//   2. Valida membership do chamador no workspace
//   3. Impede auto-remoção
//   4. Deleta de workspace_members (workspace atual)
//   5. Se usuário não tem outros workspaces → deleta user_profiles + auth.users

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

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
    const { data: callerMember } = await admin
      .from("workspace_members")
      .select("role")
      .eq("user_id", caller.id)
      .eq("workspace_id", "placeholder") // will be replaced below after body parse
      .maybeSingle();

    // ── 3. Validar body ───────────────────────────────────────────
    let body: { user_id?: string; workspace_id?: string };
    try { body = await req.json(); }
    catch { return json({ error: "JSON inválido" }, 400); }

    const { user_id: targetId, workspace_id: workspaceId } = body;

    if (!targetId || !workspaceId) {
      return json({ error: "user_id e workspace_id são obrigatórios" }, 400);
    }

    // Impedir auto-remoção
    if (targetId === caller.id) {
      return json({ error: "Você não pode remover a si mesmo" }, 403);
    }

    // Verificar que o chamador é membro do workspace solicitado
    const { data: callerWsMember } = await admin
      .from("workspace_members")
      .select("role")
      .eq("user_id", caller.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!callerWsMember) {
      return json({ error: "Você não tem permissão neste workspace" }, 403);
    }

    const callerRole = (callerWsMember.role as string) ?? "";
    if (!["admin", "manager"].includes(callerRole)) {
      return json({ error: "Apenas admins e gerentes podem remover membros" }, 403);
    }

    // ── 4. Verificar cargo do alvo (manager não pode remover admin) ──
    const { data: targetMember } = await admin
      .from("workspace_members")
      .select("role")
      .eq("user_id", targetId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!targetMember) {
      return json({ error: "Usuário não encontrado neste workspace" }, 404);
    }

    const targetRole = (targetMember.role as string) ?? "";
    if (callerRole === "manager" && targetRole === "admin") {
      return json({ error: "Gerentes não podem remover admins" }, 403);
    }

    // ── 5. Remover do workspace atual ─────────────────────────────
    const { error: removeErr } = await admin
      .from("workspace_members")
      .delete()
      .eq("user_id", targetId)
      .eq("workspace_id", workspaceId);

    if (removeErr) {
      console.error("[remove-user] erro ao remover workspace_members:", removeErr.message);
      return json({ error: removeErr.message }, 500);
    }

    // ── 6. Verificar outros workspaces ────────────────────────────
    const { data: otherWorkspaces } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", targetId);

    const hasOtherWorkspaces = (otherWorkspaces ?? []).length > 0;

    let fullyDeleted = false;

    if (!hasOtherWorkspaces) {
      // Buscar email do usuário para limpar convites pendentes
      const { data: authUser } = await admin.auth.admin.getUserById(targetId);
      const userEmail = authUser?.user?.email ?? "";

      if (userEmail) {
        // Deletar convites pendentes pelo email
        await admin
          .from("workspace_invites")
          .delete()
          .eq("email", userEmail.toLowerCase())
          .is("accepted_at", null);
      }

      // Deletar user_profiles
      await admin.from("user_profiles").delete().eq("id", targetId);

      // Deletar do Supabase Auth
      const { error: deleteAuthErr } = await admin.auth.admin.deleteUser(targetId);
      if (deleteAuthErr) {
        console.error("[remove-user] erro ao deletar auth user:", deleteAuthErr.message);
        // Não falha a operação — workspace_members já foi removido
      } else {
        fullyDeleted = true;
      }
    }

    // ── 7. Audit log ──────────────────────────────────────────────
    await admin.from("audit_logs").insert({
      workspace_id: workspaceId,
      event_type:   "member_removed",
      entity_type:  "user",
      entity_id:    targetId,
      status:       "success",
      metadata:     {
        removed_by:    caller.id,
        target_role:   targetRole,
        fully_deleted: fullyDeleted,
      },
    });

    console.log(`[remove-user] ✓ ${targetId} removido do workspace ${workspaceId} (fully_deleted=${fullyDeleted})`);
    return json({ ok: true, fully_deleted: fullyDeleted });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[remove-user] erro inesperado:", message);
    return json({ error: `Erro interno: ${message}` }, 500);
  }
});
