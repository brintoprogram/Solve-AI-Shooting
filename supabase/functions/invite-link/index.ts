// invite-link — convites por link compartilhável (para mandar no WhatsApp).
//
// O convite por e-mail (invite-user) não é tocado. Esta função é um caminho
// paralelo, e existe porque os dois resolvem problemas diferentes:
//
//   por e-mail  a identidade de quem entra é provada por receber o e-mail
//   por link    quem tiver o link entra
//
// A segunda frase é o projeto inteiro. Por isso todo o cuidado aqui está em
// limitar o alcance do link — não em facilitar o uso dele.
//
// Ações:
//   create  (autenticado, admin/manager)  gera o link
//   list    (autenticado, admin/manager)  lista os links do workspace
//   revoke  (autenticado, admin/manager)  mata um link na hora
//   peek    (público)                     "você foi convidado para X" — não gasta uso
//   redeem  (público ou autenticado)      entra de verdade

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PAPEIS = ["admin", "manager", "agent"] as const;
type Papel = typeof PAPEIS[number];

/* Lista fechada. Sem ela, "permissions" seria um jsonb livre vindo do
   navegador: bastaria mandar { "can_qualquer_coisa": true } e o banco
   guardaria. Chave fora desta lista é descartada — ela não significa nada
   para hasPermission() de qualquer jeito, mas guardá-la deixaria a
   participação com sujeira que ninguém sabe interpretar depois. */
const PERMISSOES = [
  "can_shoot", "can_manage_campaigns", "can_manage_contacts", "can_import",
  "can_inbox", "can_manage_team", "can_settings", "can_negotiations",
] as const;

function sanearPermissoes(bruto: unknown): Record<string, boolean> | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const limpo: Record<string, boolean> = {};
  for (const chave of PERMISSOES) {
    const v = (bruto as Record<string, unknown>)[chave];
    if (typeof v === "boolean") limpo[chave] = v;
  }
  return Object.keys(limpo).length ? limpo : null;
}

const ROTULO: Record<Papel, string> = {
  admin:   "Administrador",
  manager: "Gerente",
  agent:   "Agente",
};

/** Endereço do app. O link é montado aqui, e não no navegador de quem pediu:
 *  origin vem do cliente e pode ser qualquer coisa. APP_URL manda quando
 *  existe, e a origem só serve de fallback em desenvolvimento. */
function appUrl(req: Request): string {
  const configurado = Deno.env.get("APP_URL");
  if (configurado) return configurado.replace(/\/+$/, "");
  const origin = req.headers.get("origin");
  if (origin) return origin.replace(/\/+$/, "");
  return "https://system.solveai.consulting";
}

/** Quem está chamando, e qual o cargo dele NESTE workspace.
 *  O cargo tem que vir de workspace_members e não de user_profiles: alguém
 *  pode ser admin no workspace A e agente no B, e convidar para o B não pode
 *  se apoiar no cargo que ele tem no A. */
async function quemChama(
  admin: SupabaseClient, req: Request, workspaceId: string,
): Promise<{ userId: string; papel: Papel } | { erro: string; status: number }> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return { erro: "Não autorizado", status: 401 };

  const { data: { user }, error } = await admin.auth.getUser(auth.replace("Bearer ", ""));
  if (error || !user) return { erro: "Sessão inválida", status: 401 };

  const { data: membro } = await admin
    .from("workspace_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!membro) return { erro: "Você não participa deste workspace", status: 403 };

  const papel = membro.role as Papel;
  if (!["admin", "manager"].includes(papel)) {
    return { erro: "Apenas administradores e gerentes podem convidar", status: 403 };
  }
  return { userId: user.id, papel };
}

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return json({ error: "JSON inválido" }, 400); }

    const acao = String(body.action ?? "");

    // ── create ───────────────────────────────────────────────────────
    if (acao === "create") {
      const workspaceId = String(body.workspace_id ?? "");
      if (!workspaceId) return json({ error: "workspace_id é obrigatório" }, 400);

      const chamador = await quemChama(admin, req, workspaceId);
      if ("erro" in chamador) return json({ error: chamador.erro }, chamador.status);

      const papel = String(body.role ?? "agent") as Papel;
      if (!PAPEIS.includes(papel)) return json({ error: "Cargo inválido" }, 400);

      /* Mesma regra do convite por e-mail: gerente não fabrica admin. Sem
         isto, um gerente criaria um link de admin e o usaria ele mesmo. */
      if (chamador.papel === "manager" && papel === "admin") {
        return json({ error: "Gerentes não podem criar links de administrador" }, 403);
      }

      const usos = Math.min(Math.max(Number(body.max_uses ?? 1) || 1, 1), 100);
      const dias = Math.min(Math.max(Number(body.expires_in_days ?? 7) || 7, 1), 90);
      const rotulo = String(body.label ?? "").trim().slice(0, 80) || null;
      const permissoes = sanearPermissoes(body.permissions);

      /* Gerente não contorna o limite do cargo pela porta das permissões:
         can_manage_team é justamente o que deixa convidar e mexer na equipe,
         então concedê-la equivale a promover. */
      if (chamador.papel === "manager" && permissoes?.can_manage_team) {
        return json({ error: "Gerentes não podem conceder gestão de equipe" }, 403);
      }

      const { data: link, error } = await admin
        .from("workspace_invite_links")
        .insert({
          workspace_id: workspaceId,
          role:         papel,
          label:        rotulo,
          permissions:  permissoes,
          max_uses:     usos,
          expires_at:   new Date(Date.now() + dias * 86_400_000).toISOString(),
          created_by:   chamador.userId,
        })
        .select("id, token, role, label, permissions, max_uses, uses, expires_at, created_at")
        .single();

      if (error) return json({ error: error.message }, 500);

      await admin.from("audit_logs").insert({
        workspace_id: workspaceId,
        event_type:   "invite_link_created",
        entity_type:  "workspace_invite_link",
        entity_id:    link.id,
        status:       "ok",
        /* O token NÃO entra na trilha. Trilha é lida por mais gente e guardada
           por mais tempo do que a tabela do link — copiar o segredo para lá
           seria criar uma segunda porta com fechadura pior. */
        metadata:     { role: papel, max_uses: usos, expires_in_days: dias,
                        label: rotulo, permissions: permissoes },
      });

      return json({ ok: true, link: { ...link, url: `${appUrl(req)}/entrar/${link.token}` } });
    }

    // ── list ─────────────────────────────────────────────────────────
    if (acao === "list") {
      const workspaceId = String(body.workspace_id ?? "");
      if (!workspaceId) return json({ error: "workspace_id é obrigatório" }, 400);

      const chamador = await quemChama(admin, req, workspaceId);
      if ("erro" in chamador) return json({ error: chamador.erro }, chamador.status);

      const { data: links } = await admin
        .from("workspace_invite_links")
        .select("id, token, role, label, permissions, max_uses, uses, expires_at, revoked_at, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(50);

      const base = appUrl(req);
      return json({
        ok: true,
        links: (links ?? []).map((l) => ({ ...l, url: `${base}/entrar/${l.token}` })),
      });
    }

    // ── update — mexer no link DEPOIS de criado ──────────────────────
    // Enquanto ninguém usou, mudar o cargo ou as permissões do link é mudar o
    // que a próxima pessoa vai receber. Depois que alguém entrou, o acesso
    // dela já existe e se edita na tela Equipe: mexer no link não alcança
    // quem já está dentro, e fingir que alcança seria pior do que não ter.
    if (acao === "update") {
      const id = String(body.id ?? "");
      if (!id) return json({ error: "id é obrigatório" }, 400);

      const { data: alvo } = await admin
        .from("workspace_invite_links")
        .select("workspace_id, uses, revoked_at").eq("id", id).maybeSingle();
      if (!alvo) return json({ error: "Link não encontrado" }, 404);

      const chamador = await quemChama(admin, req, alvo.workspace_id as string);
      if ("erro" in chamador) return json({ error: chamador.erro }, chamador.status);
      if (alvo.revoked_at) return json({ error: "Este link foi cancelado." }, 410);

      const mudanca: Record<string, unknown> = {};

      if (body.role !== undefined) {
        const novoPapel = String(body.role) as Papel;
        if (!PAPEIS.includes(novoPapel)) return json({ error: "Cargo inválido" }, 400);
        if (chamador.papel === "manager" && novoPapel === "admin") {
          return json({ error: "Gerentes não podem criar links de administrador" }, 403);
        }
        mudanca.role = novoPapel;
      }
      if (body.permissions !== undefined) {
        const permissoes = sanearPermissoes(body.permissions);
        if (chamador.papel === "manager" && permissoes?.can_manage_team) {
          return json({ error: "Gerentes não podem conceder gestão de equipe" }, 403);
        }
        mudanca.permissions = permissoes;
      }
      if (body.max_uses !== undefined) {
        const usos = Math.min(Math.max(Number(body.max_uses) || 1, 1), 100);
        /* Não dá para pedir menos usos do que o link já teve: o contador é
           histórico, e baixá-lo abaixo dele reabriria vagas já gastas. */
        if (usos < (alvo.uses as number)) {
          return json({ error: `Este link já foi usado ${alvo.uses} vez(es).` }, 400);
        }
        mudanca.max_uses = usos;
      }
      if (body.expires_in_days !== undefined) {
        const dias = Math.min(Math.max(Number(body.expires_in_days) || 7, 1), 90);
        mudanca.expires_at = new Date(Date.now() + dias * 86_400_000).toISOString();
      }
      if (body.label !== undefined) {
        mudanca.label = String(body.label ?? "").trim().slice(0, 80) || null;
      }

      if (!Object.keys(mudanca).length) return json({ error: "Nada para alterar" }, 400);

      const { data: atualizado, error } = await admin
        .from("workspace_invite_links").update(mudanca).eq("id", id)
        .select("id, token, role, label, permissions, max_uses, uses, expires_at, revoked_at, created_at")
        .single();
      if (error) return json({ error: error.message }, 500);

      await admin.from("audit_logs").insert({
        workspace_id: alvo.workspace_id,
        event_type:   "invite_link_updated",
        entity_type:  "workspace_invite_link",
        entity_id:    id,
        status:       "ok",
        metadata:     { ...mudanca, updated_by: chamador.userId },
      });

      return json({ ok: true, link: { ...atualizado, url: `${appUrl(req)}/entrar/${atualizado.token}` } });
    }

    // ── revoke ───────────────────────────────────────────────────────
    if (acao === "revoke") {
      const id = String(body.id ?? "");
      if (!id) return json({ error: "id é obrigatório" }, 400);

      const { data: alvo } = await admin
        .from("workspace_invite_links").select("workspace_id").eq("id", id).maybeSingle();
      if (!alvo) return json({ error: "Link não encontrado" }, 404);

      const chamador = await quemChama(admin, req, alvo.workspace_id as string);
      if ("erro" in chamador) return json({ error: chamador.erro }, chamador.status);

      await admin.from("workspace_invite_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id).is("revoked_at", null);

      await admin.from("audit_logs").insert({
        workspace_id: alvo.workspace_id,
        event_type:   "invite_link_revoked",
        entity_type:  "workspace_invite_link",
        entity_id:    id,
        status:       "ok",
        metadata:     { revoked_by: chamador.userId },
      });

      return json({ ok: true });
    }

    // ── peek — público, não gasta uso ────────────────────────────────
    if (acao === "peek") {
      const token = String(body.token ?? "");
      if (!/^[a-f0-9]{64}$/.test(token)) return json({ ok: true, valido: false, motivo: "invalido" });

      const { data } = await admin.rpc("espiar_convite_link", { p_token: token });
      const info = (data ?? [])[0];
      if (!info) return json({ ok: true, valido: false, motivo: "invalido" });

      /* Só nome do workspace e cargo. Nada de quem criou, quantos membros tem
         ou qualquer coisa da operação: esta resposta é pública. */
      return json({
        ok:        true,
        valido:    info.valido,
        motivo:    info.motivo,
        workspace: info.ws_nome,
        role:      info.papel,
        role_label: ROTULO[info.papel as Papel] ?? info.papel,
      });
    }

    // ── redeem ───────────────────────────────────────────────────────
    if (acao === "redeem") {
      const token = String(body.token ?? "");
      if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "Link inválido" }, 400);

      // 1. Confere antes de gastar: erro de link expirado não pode custar um uso.
      const { data: espiada } = await admin.rpc("espiar_convite_link", { p_token: token });
      const info = (espiada ?? [])[0];
      if (!info)        return json({ error: "Link inválido" }, 404);
      if (!info.valido) return json({ error: `Este link está ${info.motivo}.`, motivo: info.motivo }, 410);

      const workspaceId = info.ws_id as string;

      // 2. Quem é a pessoa: sessão aberta, ou conta nova.
      let userId: string | null = null;
      let emailUsado = "";
      let criouConta = false;

      const auth = req.headers.get("Authorization") ?? "";
      if (auth.startsWith("Bearer ")) {
        const { data: { user } } = await admin.auth.getUser(auth.replace("Bearer ", ""));
        if (user) { userId = user.id; emailUsado = user.email ?? ""; }
      }

      const email = String(body.email ?? "").trim().toLowerCase();
      const senha = String(body.password ?? "");
      const nome  = String(body.full_name ?? "").trim();

      if (!userId) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "E-mail inválido" }, 400);
        if (senha.length < 8) return json({ error: "A senha precisa ter pelo menos 8 caracteres" }, 400);
        if (!nome)            return json({ error: "Informe seu nome" }, 400);

        /* Se o e-mail já tem conta, NÃO criamos nem anexamos. Aceitar uma senha
           aqui deixaria qualquer um com o link entrar usando o e-mail de outra
           pessoa. Quem já tem conta faz login e reabre o link — aí a sessão
           prova quem é. */
        const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if ((lista?.users ?? []).some((u) => u.email?.toLowerCase() === email)) {
          return json({
            error: "Já existe uma conta com este e-mail. Faça login e abra o link novamente.",
            precisa_login: true,
          }, 409);
        }
      }

      // 3. Já é membro? Então não há o que fazer, e não se gasta um uso por isso.
      if (userId) {
        const { data: jaMembro } = await admin
          .from("workspace_members").select("workspace_id")
          .eq("user_id", userId).eq("workspace_id", workspaceId).maybeSingle();
        if (jaMembro) return json({ ok: true, ja_era_membro: true, workspace: info.ws_nome });
      }

      // 4. Reserva o uso ANTES de criar a conta. Duas pessoas no mesmo link de
      //    uso único: uma reserva, a outra recebe zero linhas e para aqui.
      const { data: consumo } = await admin.rpc("consumir_convite_link", { p_token: token });
      const reserva = (consumo ?? [])[0];
      if (!reserva) return json({ error: "Este link acabou de ser usado por outra pessoa." }, 410);

      const papel = reserva.papel as Papel;
      const devolverUso = () => admin.rpc("devolver_uso_convite_link", { p_link_id: reserva.link_id });

      /* As permissões que quem convidou escolheu. Vão para a PARTICIPAÇÃO e
         não para o perfil: quem entra na empresa A com um acesso restrito não
         leva essa restrição — nem esse acesso — para a empresa B. */
      const { data: linkRow } = await admin
        .from("workspace_invite_links")
        .select("permissions").eq("id", reserva.link_id).maybeSingle();
      const permissoesDoLink = (linkRow?.permissions ?? null) as Record<string, boolean> | null;

      try {
        if (!userId) {
          /* email_confirm: true de propósito. Quem prova o convite aqui é o
             token, não a caixa de entrada — e exigir confirmação por e-mail
             num fluxo que começou no WhatsApp devolveria a pessoa justamente
             para o canal que ela não usou. */
          const { data: novo, error: errNovo } = await admin.auth.admin.createUser({
            email, password: senha, email_confirm: true,
            user_metadata: { full_name: nome },
          });
          if (errNovo || !novo?.user) {
            await devolverUso();
            return json({ error: errNovo?.message ?? "Não foi possível criar a conta" }, 400);
          }
          userId     = novo.user.id;
          emailUsado = email;
          criouConta = true;

          await admin.from("user_profiles").upsert(
            { id: userId, full_name: nome, role: papel, permissions: {} },
            { onConflict: "id" });
        }
        /* Conta que já existia mantém o cargo global dela. Rebaixar um admin
           porque ele entrou num link de agente mexeria no acesso dele a OUTRO
           workspace — o cargo do link vale para este workspace, em
           workspace_members. */

        const { error: errMembro } = await admin
          .from("workspace_members")
          .upsert({ workspace_id: workspaceId, user_id: userId, role: papel,
                    permissions: permissoesDoLink },
                  { onConflict: "workspace_id,user_id" });
        if (errMembro) {
          await devolverUso();
          return json({ error: errMembro.message }, 500);
        }

        await admin.from("workspace_invite_link_uses").insert({
          link_id:      reserva.link_id,
          workspace_id: workspaceId,
          user_id:      userId,
          email:        emailUsado,
          criou_conta:  criouConta,
          user_agent:   req.headers.get("user-agent")?.slice(0, 200) ?? null,
        });

        await admin.from("audit_logs").insert({
          workspace_id: workspaceId,
          event_type:   "invite_link_redeemed",
          entity_type:  "workspace_member",
          entity_id:    userId,
          status:       "ok",
          metadata:     { email: emailUsado, role: papel, criou_conta: criouConta,
                          link_id: reserva.link_id, permissions: permissoesDoLink },
        });

        console.log(`[invite-link] ✓ ${emailUsado} entrou no workspace ${workspaceId} como ${papel}`);
        return json({ ok: true, workspace: info.ws_nome, role: papel, criou_conta: criouConta });

      } catch (err) {
        await devolverUso();
        throw err;
      }
    }

    return json({ error: "Ação desconhecida" }, 400);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[invite-link] erro inesperado:", msg);
    return json({ error: `Erro interno: ${msg}` }, 500);
  }
});
