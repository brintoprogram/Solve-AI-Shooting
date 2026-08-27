-- VAZAMENTO ENTRE WORKSPACES — correção.
--
-- Encontrado por execução, rodando como um usuário real: ele enxergava 978
-- boletos, 45 conversas e 243 mensagens de OUTRAS empresas.
--
-- A causa não é uma policy faltando. É que policies PERMISSIVE se somam com
-- OU, e algumas delas checam só o cargo, sem olhar o workspace:
--
--   invoices_team_select    get_my_role() IN ('admin','manager','agent')
--   convs_mgmt_select       get_my_role() IN ('admin','manager')
--   convs_agent_select      get_my_role() = 'agent' AND assigned_to ...
--   msgs_mgmt_select        get_my_role() IN ('admin','manager')
--   ... e as gêmeas de UPDATE, INSERT e DELETE
--
-- Ao lado delas existia a policy certa — is_workspace_member(workspace_id) —
-- e ela não adiantava nada. Basta UMA permissive passar para a linha aparecer,
-- e "sou agente" passa para qualquer linha do banco inteiro. Quem tivesse
-- qualquer cargo em qualquer empresa lia a carteira de cobrança das outras.
--
-- A correção não mexe nas policies existentes, e é de propósito: mexer em onze
-- policies uma a uma é onze chances de errar, e a décima segunda — criada mês
-- que vem — nasceria com o mesmo defeito.
--
-- Em vez disso, uma policy RESTRICTIVE por tabela. Restrictive entra com E
-- contra o OU de todas as permissive, então ela não pode ser furada por
-- policy nenhuma, nem pelas que ainda não existem:
--
--   (o que as permissive já decidiam)  E  (é do meu workspace)
--
-- Dentro do próprio workspace nada muda: todo mundo já passava nessa condição.
-- O que muda é só a parte que nunca deveria ter existido.
--
-- workspace_id IS NULL passa porque linha sem workspace não é dado de empresa
-- nenhuma — é o caso de datas_profissao, que tem um catálogo compartilhado de
-- propósito e é lido por todos.

DO $fechar$
DECLARE
  r         record;
  v_n       integer := 0;
BEGIN
  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN pg_class p       ON p.relname = c.table_name
      JOIN pg_namespace ns  ON ns.oid = p.relnamespace AND ns.nspname = 'public'
     WHERE c.table_schema = 'public'
       AND c.column_name  = 'workspace_id'
       AND p.relkind      = 'r'
     ORDER BY c.table_name
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   'restrito_ao_meu_workspace', r.table_name);
    /* audit_logs.workspace_id é text; o cast cobre as duas formas. */
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        AS RESTRICTIVE FOR ALL TO public
        USING      (workspace_id IS NULL OR is_workspace_member(workspace_id::uuid))
        WITH CHECK (workspace_id IS NULL OR is_workspace_member(workspace_id::uuid))
    $f$, 'restrito_ao_meu_workspace', r.table_name);
    v_n := v_n + 1;
  END LOOP;

  RAISE LOG 'isolamento: policy restritiva aplicada a % tabelas', v_n;
END
$fechar$;

-- ── Verificação ──────────────────────────────────────────────────────
-- Dentro de transação explícita e rodando como authenticated de verdade —
-- SET LOCAL solto é ignorado, e o teste passaria como dono do banco, com RLS
-- desligado, sem ter testado nada.
BEGIN;

DO $conferir$
DECLARE
  v_user  uuid;
  v_meus  uuid[];
  v_antes bigint;
  v_n     bigint;
BEGIN
  SELECT user_id, array_agg(workspace_id) INTO v_user, v_meus
    FROM workspace_members GROUP BY user_id ORDER BY count(*) ASC, user_id LIMIT 1;
  IF v_user IS NULL THEN RETURN; END IF;

  -- As três tabelas onde o vazamento foi medido, ainda como dono.
  SELECT (SELECT count(*) FROM contact_invoices     WHERE NOT (workspace_id = ANY(v_meus)))
       + (SELECT count(*) FROM inbox_conversations  WHERE NOT (workspace_id = ANY(v_meus)))
       + (SELECT count(*) FROM inbox_messages       WHERE NOT (workspace_id = ANY(v_meus)))
    INTO v_antes;

  IF v_antes = 0 THEN
    RAISE EXCEPTION 'nao ha dados alheios nessas tabelas: a conferencia passaria sem provar nada';
  END IF;

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'o teste nao trocou de papel: rodando como %', current_user;
  END IF;

  SELECT (SELECT count(*) FROM contact_invoices     WHERE NOT (workspace_id = ANY(v_meus)))
       + (SELECT count(*) FROM inbox_conversations  WHERE NOT (workspace_id = ANY(v_meus)))
       + (SELECT count(*) FROM inbox_messages       WHERE NOT (workspace_id = ANY(v_meus)))
    INTO v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'AINDA VAZA: % linhas alheias visiveis', v_n;
  END IF;

  -- E o que é dele continua aparecendo: uma correção que cega o usuário no
  -- próprio workspace não é correção, é outro defeito.
  SELECT count(*) INTO v_n FROM contact_invoices WHERE workspace_id = ANY(v_meus);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'a policy restritiva escondeu tambem os boletos do proprio workspace';
  END IF;

  EXECUTE 'SET LOCAL ROLE postgres';
  PERFORM set_config('request.jwt.claims', '', false);

  RAISE LOG 'vazamento fechado: % linhas alheias estavam visiveis, agora 0; % proprias seguem visiveis',
            v_antes, v_n;
END
$conferir$;

COMMIT;
