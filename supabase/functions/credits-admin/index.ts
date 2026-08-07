// Supabase Edge Function — Administração de créditos
//
// Recarregar crédito é dar dinheiro. Quem pode fazer isso NÃO pode ser o
// "admin" do workspace: esse papel pertence ao seu cliente, e ele se creditaria
// à vontade. O sistema inteiro viraria decoração.
//
// A lista de quem pode vive num secret (PLATFORM_ADMIN_EMAILS), não numa
// tabela. A diferença importa: uma tabela é alcançável por qualquer falha de
// RLS ou por um SQL mal escrito no futuro; o secret só é lido aqui dentro, e
// nem uma conta de admin comprometida chega nele.
//
// Ações:
//   listar     — todos os workspaces com saldo (só dono da plataforma)
//   recarregar — soma (ou subtrai) crédito de um workspace
//   ajustar    — muda custo por mensagem / por IA / liga e desliga a cobrança

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";
import { bearerToken } from "../_shared/auth.ts";
import { createLogger, requestIdFrom } from "../_shared/logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/** E-mails autorizados, separados por vírgula, no secret PLATFORM_ADMIN_EMAILS. */
function donosDaPlataforma(): string[] {
  return (Deno.env.get("PLATFORM_ADMIN_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const log = createLogger("credits-admin", { request_id: requestIdFrom(req) });

  const token = bearerToken(req);
  if (!token) return json({ error: "Não autorizado" }, 401);

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: "Sessão inválida" }, 401);

  const permitidos = donosDaPlataforma();
  if (permitidos.length === 0) {
    // Falha fechada: sem a lista configurada, ninguém recarrega. O contrário —
    // liberar quando não está configurado — deixaria o sistema aberto no
    // primeiro deploy, que é exatamente quando ninguém está olhando.
    log.fatal("platform_admins_nao_configurado");
    return json({ error: "Administração de créditos não está configurada no servidor." }, 503);
  }

  const email = (user.email ?? "").toLowerCase();
  if (!permitidos.includes(email)) {
    log.warn("acesso_negado_creditos", { user_id: user.id });
    return json({ error: "Sem permissão para administrar créditos." }, 403);
  }

  const alog = log.child({ user_id: user.id });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "JSON inválido" }, 400); }

  const acao = String(body.acao ?? "");

  try {
    // ── listar ──────────────────────────────────────────────────────
    if (acao === "listar") {
      const { data: workspaces, error } = await supabase
        .from("workspaces")
        .select("id, name")
        .order("name");
      if (error) throw new Error(error.message);

      const { data: saldos } = await supabase
        .from("workspace_credits")
        .select("workspace_id, saldo, custo_mensagem, custo_ia, cobranca_ativa, updated_at");

      const porId = new Map((saldos ?? []).map((s) => [s.workspace_id as string, s]));

      return json({
        workspaces: (workspaces ?? []).map((w) => {
          const s = porId.get(w.id as string);
          return {
            id:             w.id,
            nome:           w.name,
            // Workspace que nunca consumiu não tem linha ainda — saldo zero,
            // custos no padrão.
            saldo:          (s?.saldo          as number  | undefined) ?? 0,
            custo_mensagem: (s?.custo_mensagem as number  | undefined) ?? 1,
            custo_ia:       (s?.custo_ia       as number  | undefined) ?? 3,
            cobranca_ativa: (s?.cobranca_ativa as boolean | undefined) ?? true,
          };
        }),
      });
    }

    // ── recarregar ──────────────────────────────────────────────────
    if (acao === "recarregar") {
      const workspace_id = String(body.workspace_id ?? "");
      const quantidade   = Number(body.quantidade ?? 0);
      const motivo       = String(body.motivo ?? "recarga manual");

      if (!workspace_id)                        return json({ error: "workspace_id é obrigatório" }, 400);
      if (!Number.isInteger(quantidade) || quantidade === 0) {
        return json({ error: "quantidade precisa ser um inteiro diferente de zero" }, 400);
      }
      // Teto de sanidade: um dígito a mais numa recarga manual é fácil de
      // digitar e difícil de perceber depois.
      if (Math.abs(quantidade) > 10_000_000) {
        return json({ error: "quantidade acima do limite permitido (10 milhões)" }, 400);
      }

      const { data, error } = await supabase.rpc("add_credits", {
        p_workspace_id: workspace_id,
        p_quantidade:   quantidade,
        p_motivo:       `${motivo} (por ${email})`,
      });
      if (error) throw new Error(error.message);

      alog.info("credito_lancado", { workspace_id, quantidade });
      return json(data);
    }

    // ── ajustar ─────────────────────────────────────────────────────
    if (acao === "ajustar") {
      const workspace_id = String(body.workspace_id ?? "");
      if (!workspace_id) return json({ error: "workspace_id é obrigatório" }, 400);

      const patch: Record<string, unknown> = {};
      if (body.custo_mensagem !== undefined) {
        const v = Number(body.custo_mensagem);
        if (!Number.isInteger(v) || v < 0) return json({ error: "custo_mensagem inválido" }, 400);
        patch.custo_mensagem = v;
      }
      if (body.custo_ia !== undefined) {
        const v = Number(body.custo_ia);
        if (!Number.isInteger(v) || v < 0) return json({ error: "custo_ia inválido" }, 400);
        patch.custo_ia = v;
      }
      if (body.cobranca_ativa !== undefined) patch.cobranca_ativa = body.cobranca_ativa === true;

      if (Object.keys(patch).length === 0) return json({ error: "nada para ajustar" }, 400);

      // upsert: workspace que nunca consumiu ainda não tem linha.
      const { error } = await supabase
        .from("workspace_credits")
        .upsert({ workspace_id, ...patch, updated_at: new Date().toISOString() },
                { onConflict: "workspace_id" });
      if (error) throw new Error(error.message);

      alog.info("credito_ajustado", { workspace_id, patch });
      return json({ ok: true });
    }

    return json({ error: "acao inválida (use listar, recarregar ou ajustar)" }, 400);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alog.fatal("unhandled_error", { err: msg, acao });
    return json({ error: "Erro ao administrar créditos." }, 500);
  }
});
