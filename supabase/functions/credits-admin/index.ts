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

  // Defesa em profundidade: e-mail nao confirmado nao vale como identidade.
  // Sem isto, alguem que se cadastrasse com o endereco autorizado e nunca
  // confirmasse passaria pela checagem.
  if (!user.email_confirmed_at) {
    log.warn("acesso_negado_email_nao_confirmado", { user_id: user.id });
    return json({ error: "Confirme seu e-mail para administrar créditos." }, 403);
  }

  if (!permitidos.includes(email)) {
    // Tentativa negada e informacao de seguranca: um padrao delas e o primeiro
    // sinal de conta comprometida. Fica na trilha, nao so no log.
    await supabase.rpc("log_credit_access_denied", {
      p_ator_id:    user.id,
      p_ator_email: email || "sem_email",
      p_detalhe:    { acao_tentada: String((await req.clone().json().catch(() => ({}))).acao ?? "") },
    });
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
        p_motivo:       motivo,
        // Autor explicito: a funcao roda com service role, onde auth.uid() e
        // NULL. Antes disto o campo "quem lancou" ficava sempre vazio.
        p_ator_id:      user.id,
        p_ator_email:   email,
      });
      if (error) throw new Error(error.message);

      alog.info("credito_lancado", { workspace_id, quantidade });
      return json(data);
    }

    // ── ajustar ─────────────────────────────────────────────────────
    if (acao === "ajustar") {
      const workspace_id = String(body.workspace_id ?? "");
      if (!workspace_id) return json({ error: "workspace_id é obrigatório" }, 400);

      // null = nao mexer. A RPC registra antes/depois de tudo que mudar.
      const num = (v: unknown): number | null => {
        if (v === undefined || v === null || v === "") return null;
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 ? n : NaN;
      };
      const custoMensagem = num(body.custo_mensagem);
      const custoIa       = num(body.custo_ia);
      if (Number.isNaN(custoMensagem) || Number.isNaN(custoIa)) {
        return json({ error: "custos precisam ser inteiros não negativos" }, 400);
      }

      const { data, error } = await supabase.rpc("set_credit_config", {
        p_workspace_id:   workspace_id,
        p_custo_mensagem: custoMensagem,
        p_custo_ia:       custoIa,
        p_cobranca_ativa: body.cobranca_ativa === undefined ? null : body.cobranca_ativa === true,
        p_ator_id:        user.id,
        p_ator_email:     email,
      });
      if (error) throw new Error(error.message);

      alog.info("credito_config_alterada", { workspace_id, config: data });
      return json(data);
    }

    // ── trilha de auditoria ─────────────────────────────────────────
    if (acao === "trilha") {
      const { data, error } = await supabase
        .from("credit_admin_log")
        .select("id, workspace_id, acao, ator_email, antes, depois, detalhe, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);

      const { data: nomes } = await supabase.from("workspaces").select("id, name");
      const porId = new Map((nomes ?? []).map((w) => [w.id as string, w.name as string]));

      return json({
        registros: (data ?? []).map((r) => ({
          ...r,
          workspace_nome: r.workspace_id ? (porId.get(r.workspace_id as string) ?? "—") : "—",
        })),
      });
    }

    return json({ error: "acao inválida (use listar, recarregar, ajustar ou trilha)" }, 400);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alog.fatal("unhandled_error", { err: msg, acao });
    return json({ error: "Erro ao administrar créditos." }, 500);
  }
});
