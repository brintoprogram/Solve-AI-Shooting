// Supabase Edge Function — Administração de workspaces
//
// Criar workspace é abrir um cliente novo. Quem faz isso NÃO pode ser o "admin"
// do workspace: esse papel pertence ao seu cliente, e ele abriria tenants fora
// da sua cobrança à vontade.
//
// A autorização é a mesma do credits-admin, de propósito: o secret
// PLATFORM_ADMIN_EMAILS. Duas listas de donos da plataforma acabariam
// divergindo, e a que ficasse para trás seria a porta aberta.
//
// Ações:
//   listar    — panorama de todos os workspaces (via RPC fechada ao navegador)
//   criar     — abre workspace novo com código, e entra nele como admin
//   atualizar — nome, código, e-mail de suporte, API ligada/desligada

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";
import { bearerToken } from "../_shared/auth.ts";
import { createLogger, requestIdFrom } from "../_shared/logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function donosDaPlataforma(): string[] {
  return (Deno.env.get("PLATFORM_ADMIN_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Mesmo formato do CHECK no banco. Validar aqui é para dar mensagem legível —
 *  a garantia continua sendo a restrição, não esta função. */
const FORMATO_CODIGO = /^[A-Z0-9][A-Z0-9-]{1,11}$/;

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const log = createLogger("workspaces-admin", { request_id: requestIdFrom(req) });

  const token = bearerToken(req);
  if (!token) return json({ error: "Não autorizado" }, 401);

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: "Sessão inválida" }, 401);

  const permitidos = donosDaPlataforma();
  if (permitidos.length === 0) {
    // Falha fechada: sem a lista configurada ninguém cria workspace. Liberar
    // quando não está configurado deixaria o sistema aberto no primeiro deploy.
    log.fatal("platform_admins_nao_configurado");
    return json({ error: "Administração de workspaces não está configurada no servidor." }, 503);
  }

  const email = (user.email ?? "").toLowerCase();

  if (!user.email_confirmed_at) {
    log.warn("acesso_negado_email_nao_confirmado", { user_id: user.id });
    return json({ error: "Confirme seu e-mail para administrar workspaces." }, 403);
  }

  if (!permitidos.includes(email)) {
    // Mesma trilha do credits-admin: tentativa negada é informação de
    // segurança, e um padrão delas é o primeiro sinal de conta comprometida.
    await supabase.rpc("log_credit_access_denied", {
      p_ator_id:    user.id,
      p_ator_email: email || "sem_email",
      p_detalhe:    { area: "workspaces", acao_tentada: String((await req.clone().json().catch(() => ({}))).acao ?? "") },
    });
    log.warn("acesso_negado_workspaces", { user_id: user.id });
    return json({ error: "Sem permissão para administrar workspaces." }, 403);
  }

  const alog = log.child({ user_id: user.id });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "JSON inválido" }, 400); }

  const acao = String(body.acao ?? "");

  try {
    // ── listar ──────────────────────────────────────────────────────
    if (acao === "listar") {
      const { data, error } = await supabase.rpc("admin_workspaces_panorama");
      if (error) throw error;
      return json({ workspaces: data ?? [] });
    }

    // ── criar ───────────────────────────────────────────────────────
    if (acao === "criar") {
      const nome   = String(body.name ?? "").trim();
      const codigo = String(body.codigo ?? "").trim().toUpperCase();

      if (nome.length < 2)  return json({ error: "Nome precisa de ao menos 2 caracteres." }, 400);
      if (!FORMATO_CODIGO.test(codigo)) {
        return json({
          error: "Código inválido. Use 2 a 12 caracteres: letras maiúsculas, números e hífen, começando por letra ou número.",
        }, 400);
      }

      const { data: ws, error: errCriar } = await supabase
        .from("workspaces")
        .insert({ name: nome, codigo })
        .select("id, codigo, name")
        .single();

      if (errCriar) {
        // 23505 = índice único. O único candidato aqui é o código.
        if ((errCriar as { code?: string }).code === "23505") {
          return json({ error: `O código ${codigo} já está em uso por outro cliente.` }, 409);
        }
        throw errCriar;
      }

      // O gatilho seed_new_workspace já criou setores, regras de negociação e
      // o agente de triagem (desligado). Falta só o dono entrar — sem isto o
      // workspace existe e ninguém o enxerga, porque a RLS é por participação.
      const { error: errMembro } = await supabase
        .from("workspace_members")
        .insert({ workspace_id: ws.id, user_id: user.id, role: "admin" });

      if (errMembro) {
        alog.error("membro_nao_adicionado", { workspace_id: ws.id, err: errMembro.message });
        return json({
          error: "Workspace criado, mas não foi possível te adicionar como admin. Adicione manualmente.",
          workspace: ws,
        }, 500);
      }

      // Trilha antes de responder: se a gravação falhar, o dono fica sabendo
      // agora, e não meses depois quando alguém procurar quem abriu o cliente.
      const { error: errTrilha } = await supabase.rpc("log_admin_workspace", {
        p_workspace_id: ws.id,
        p_acao:         "workspace_criado",
        p_ator_id:      user.id,
        p_ator_email:   email,
        p_antes:        null,
        p_depois:       { name: ws.name, codigo: ws.codigo },
        p_detalhe:      { origem: "console" },
      });
      if (errTrilha) alog.error("trilha_nao_gravou", { workspace_id: ws.id, err: errTrilha.message });

      alog.info("workspace_criado", { workspace_id: ws.id, codigo });
      return json({ ok: true, workspace: ws, trilha: !errTrilha });
    }

    // ── atualizar ───────────────────────────────────────────────────
    if (acao === "atualizar") {
      const id = String(body.workspace_id ?? "");
      if (!id) return json({ error: "workspace_id é obrigatório." }, 400);

      const patch: Record<string, unknown> = {};

      if (body.name !== undefined) {
        const nome = String(body.name).trim();
        if (nome.length < 2) return json({ error: "Nome precisa de ao menos 2 caracteres." }, 400);
        patch.name = nome;
      }
      if (body.codigo !== undefined) {
        const codigo = String(body.codigo).trim().toUpperCase();
        if (!FORMATO_CODIGO.test(codigo)) {
          return json({ error: "Código inválido. Use 2 a 12 caracteres: letras maiúsculas, números e hífen." }, 400);
        }
        patch.codigo = codigo;
      }
      if (body.support_email !== undefined) {
        const e = String(body.support_email).trim();
        if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
          return json({ error: "E-mail de suporte inválido." }, 400);
        }
        patch.support_email = e || null;
      }
      if (body.api_enabled !== undefined) patch.api_enabled = Boolean(body.api_enabled);

      if (Object.keys(patch).length === 0) {
        return json({ error: "Nada para atualizar." }, 400);
      }

      // Estado anterior lido ANTES do update. Uma trilha que só guarda o depois
      // responde "como está", não "o que mudou" — e o que mudou é a pergunta.
      const { data: antes } = await supabase
        .from("workspaces")
        .select("name, codigo, support_email, api_enabled")
        .eq("id", id)
        .maybeSingle();

      const { data, error } = await supabase
        .from("workspaces")
        .update(patch)
        .eq("id", id)
        .select("id, codigo, name, support_email, api_enabled")
        .single();

      if (error) {
        if ((error as { code?: string }).code === "23505") {
          return json({ error: "Esse código já está em uso por outro cliente." }, 409);
        }
        throw error;
      }

      const { error: errTrilha } = await supabase.rpc("log_admin_workspace", {
        p_workspace_id: id,
        p_acao:         "workspace_alterado",
        p_ator_id:      user.id,
        p_ator_email:   email,
        p_antes:        antes ?? null,
        p_depois:       data,
        p_detalhe:      { campos: Object.keys(patch) },
      });
      if (errTrilha) alog.error("trilha_nao_gravou", { workspace_id: id, err: errTrilha.message });

      alog.info("workspace_atualizado", { workspace_id: id, campos: Object.keys(patch) });
      return json({ ok: true, workspace: data, trilha: !errTrilha });
    }

    return json({ error: `Ação desconhecida: ${acao}` }, 400);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alog.error("erro_inesperado", { acao, err: msg });
    return json({ error: `Erro interno: ${msg}` }, 500);
  }
});
