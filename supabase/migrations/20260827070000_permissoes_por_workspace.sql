-- Cargo e permissões passam a valer POR WORKSPACE.
--
-- Dois defeitos reais, com a mesma raiz: o que a pessoa pode fazer estava
-- guardado em user_profiles, que é global, enquanto a participação dela é por
-- workspace.
--
--   1. VAZAMENTO DE AUTORIDADE. O editor de permissões da tela Equipe grava em
--      user_profiles.permissions. Um admin da empresa A editando um membro
--      mudava as permissões dessa pessoa TAMBÉM na empresa B. Uma empresa
--      mexendo no acesso de outra.
--
--   2. O BOTÃO DE CARGO NÃO FAZIA NADA. O seletor de cargo grava em
--      workspace_members.role, mas quem decide o que a pessoa pode fazer é
--      hasPermission(), que lê user_profiles.role. A tela dizia "Cargo
--      atualizado", mostrava o cargo novo, e a pessoa continuava com o antigo.
--      Silencioso: nenhum erro, nenhum log, só não valia.
--
--      Isso está vivo hoje: whybruno1@gmail.com aparece como Gerente na tela
--      da Solve AI e opera como Agente desde que foi promovido.
--
-- A correção move a verdade para workspace_members, que é onde a participação
-- mora. Depois disto, mudar o cargo de alguém na empresa A não toca a empresa
-- B — e mudar o cargo passa a mudar de fato o que a pessoa pode fazer.
--
-- NULL em permissions significa "herda do perfil". É o que preserva o
-- comportamento de quem já existe: nada muda até alguém editar.

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS permissions jsonb;

COMMENT ON COLUMN workspace_members.permissions IS
  'Permissoes desta pessoa NESTE workspace. NULL = herda user_profiles.permissions. Editar aqui nao afeta os outros workspaces dela.';

ALTER TABLE workspace_invite_links
  ADD COLUMN IF NOT EXISTS permissions jsonb;

COMMENT ON COLUMN workspace_invite_links.permissions IS
  'Permissoes que quem entrar por este link recebe. NULL = so o padrao do cargo.';

-- ── Alinhamento, para o deploy não mudar o acesso de ninguém ─────────
-- A troca de fonte da verdade tem que ser invisível no dia em que entra. Se
-- workspace_members.role já valesse hoje, whybruno1 viraria Gerente no
-- instante do deploy — uma promoção silenciosa saindo de dentro de uma
-- correção de segurança, que é o oposto do que uma correção de segurança deve
-- fazer.
--
-- Então: o cargo efetivo de HOJE (user_profiles.role) é copiado para a
-- participação. Quem quiser promover alguém clica no botão — que agora
-- funciona.
DO $alinhar$
DECLARE
  v_cargos integer;
  v_perms  integer;
  r        record;
BEGIN
  FOR r IN
    SELECT u.email, w.name AS ws, m.role AS era, up.role AS vira
      FROM workspace_members m
      JOIN user_profiles up ON up.id = m.user_id
      JOIN auth.users u     ON u.id  = m.user_id
      JOIN workspaces w     ON w.id  = m.workspace_id
     WHERE m.role IS DISTINCT FROM up.role
  LOOP
    RAISE LOG 'alinhando cargo: % em "%" estava como % na tela e operava como % — fica %',
              r.email, r.ws, r.era, r.vira, r.vira;
  END LOOP;

  UPDATE workspace_members m
     SET role = up.role
    FROM user_profiles up
   WHERE up.id = m.user_id AND m.role IS DISTINCT FROM up.role;
  GET DIAGNOSTICS v_cargos = ROW_COUNT;

  -- Permissões: copia o que já valia. Sem isto, quem tinha um ajuste fino no
  -- perfil o perderia na primeira edição feita por outro workspace.
  UPDATE workspace_members m
     SET permissions = up.permissions
    FROM user_profiles up
   WHERE up.id = m.user_id
     AND m.permissions IS NULL
     AND up.permissions IS NOT NULL
     AND up.permissions <> '{}'::jsonb;
  GET DIAGNOSTICS v_perms = ROW_COUNT;

  RAISE LOG 'permissoes por workspace: % cargo(s) alinhado(s), % participacao(oes) com permissoes copiadas',
            v_cargos, v_perms;
END
$alinhar$;

-- ── Verificação ──────────────────────────────────────────────────────
-- A promessa é "ninguém ganha nem perde acesso neste deploy". Isso se prova
-- comparando, participação por participação, o privilégio efetivo antigo
-- (perfil global) com o novo (participação).
DO $conferir$
DECLARE
  v_dif integer;
  r     record;
BEGIN
  SELECT count(*) INTO v_dif
    FROM workspace_members m
    JOIN user_profiles up ON up.id = m.user_id
   WHERE m.role IS DISTINCT FROM up.role;
  IF v_dif > 0 THEN
    RAISE EXCEPTION 'ainda ha % participacao(oes) com cargo diferente do perfil — o acesso mudaria no deploy', v_dif;
  END IF;

  /* Permissão efetiva: a da participação quando existe, senão a do perfil.
     Tem que dar o mesmo conjunto que o perfil dava sozinho. */
  FOR r IN
    SELECT m.user_id, m.workspace_id,
           coalesce(m.permissions, '{}'::jsonb) AS nova,
           coalesce(up.permissions, '{}'::jsonb) AS velha
      FROM workspace_members m
      JOIN user_profiles up ON up.id = m.user_id
  LOOP
    IF r.nova <> r.velha THEN
      RAISE EXCEPTION 'privilegio mudaria para o usuario % no workspace %: % -> %',
                      r.user_id, r.workspace_id, r.velha, r.nova;
    END IF;
  END LOOP;

  RAISE LOG 'permissoes por workspace: privilegio efetivo identico ao de antes em todas as participacoes';
END
$conferir$;
