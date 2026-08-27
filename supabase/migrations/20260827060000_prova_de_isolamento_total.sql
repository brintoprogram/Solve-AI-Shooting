-- Prova de que um membro não enxerga NADA de outro workspace.
--
-- Não é um teste de uma tabela: percorre TODA tabela de public que tenha uma
-- coluna workspace_id, sem lista fixa. Tabela nova criada amanhã entra sozinha
-- nesta verificação — e se ela esquecer o RLS, a próxima migration não sobe.
--
-- Roda sobre os dados reais, não sobre dados de teste: a pergunta é se a
-- cobrança de uma empresa aparece para outra, e isso só se responde olhando a
-- cobrança que existe de verdade.
--
-- Duas armadilhas que este arquivo evita de propósito:
--
--   1. SET LOCAL fora de transação é ignorado com um aviso. O teste rodaria
--      como dono do banco, com RLS desligado, e passaria sem testar nada. Daí
--      o BEGIN/COMMIT explícito e a conferência de current_user.
--   2. Um teste de vazamento passa trivialmente se não houver o que vazar.
--      Antes de trocar de papel, ele conta quantas linhas de OUTROS workspaces
--      existem e exige que haja alguma. Se não houver, ele falha dizendo que
--      não provou nada — em vez de dizer "tudo certo".

BEGIN;

DO $prova$
DECLARE
  v_user      uuid;
  v_meus      uuid[];
  /* audit_logs.workspace_id e text, nao uuid. Comparar como texto dos dois
     lados cobre as duas formas sem precisar de lista de excecao — e a trilha
     de auditoria e justamente uma das que nao pode vazar. */
  v_meus_txt  text[];
  v_tabelas   integer := 0;
  v_alcance   bigint  := 0;
  v_n         bigint;
  v_vazou     text := '';
  r           record;
BEGIN
  -- O usuário com MENOS workspaces: é o que tem mais coisa alheia à volta,
  -- e portanto o caso mais exigente.
  SELECT user_id, array_agg(workspace_id)
    INTO v_user, v_meus
    FROM workspace_members
   GROUP BY user_id
   ORDER BY count(*) ASC, user_id
   LIMIT 1;

  v_meus_txt := ARRAY(SELECT unnest(v_meus)::text);

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'nao ha nenhum membro de workspace — impossivel provar isolamento';
  END IF;

  -- ── Ainda como dono: existe o que vazar? ───────────────────────────
  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN pg_class p ON p.relname = c.table_name
      JOIN pg_namespace n ON n.oid = p.relnamespace AND n.nspname = 'public'
     WHERE c.table_schema = 'public'
       AND c.column_name  = 'workspace_id'
       AND p.relkind      = 'r'
     ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE workspace_id IS NOT NULL AND NOT (workspace_id::text = ANY($1))',
      r.table_name)
      INTO v_n USING v_meus_txt;
    v_alcance := v_alcance + v_n;
    v_tabelas := v_tabelas + 1;
  END LOOP;

  IF v_tabelas = 0 THEN
    RAISE EXCEPTION 'nenhuma tabela com workspace_id encontrada — a varredura esta quebrada';
  END IF;
  IF v_alcance = 0 THEN
    RAISE EXCEPTION 'nao ha dados de outros workspaces: este teste passaria sem provar nada';
  END IF;

  RAISE LOG 'isolamento: % tabelas, % linhas de outros workspaces ao alcance', v_tabelas, v_alcance;

  -- ── Vira o usuário de verdade ──────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'o teste nao trocou de papel: rodando como % — RLS estaria desligado', current_user;
  END IF;

  -- ── A varredura ────────────────────────────────────────────────────
  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN pg_class p ON p.relname = c.table_name
      JOIN pg_namespace n ON n.oid = p.relnamespace AND n.nspname = 'public'
     WHERE c.table_schema = 'public'
       AND c.column_name  = 'workspace_id'
       AND p.relkind      = 'r'
     ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE workspace_id IS NOT NULL AND NOT (workspace_id::text = ANY($1))',
      r.table_name)
      INTO v_n USING v_meus_txt;
    IF v_n > 0 THEN
      v_vazou := v_vazou || format('%s(%s) ', r.table_name, v_n);
    END IF;
  END LOOP;

  -- A própria lista de empresas: ele não pode nem saber que as outras existem.
  SELECT count(*) INTO v_n FROM workspaces WHERE NOT (id = ANY(v_meus));
  IF v_n > 0 THEN
    v_vazou := v_vazou || format('workspaces(%s) ', v_n);
  END IF;

  -- Nem quem trabalha nelas.
  SELECT count(*) INTO v_n FROM workspace_members WHERE NOT (workspace_id = ANY(v_meus));
  IF v_n > 0 THEN
    v_vazou := v_vazou || format('workspace_members(%s) ', v_n);
  END IF;

  IF v_vazou <> '' THEN
    RAISE EXCEPTION 'VAZAMENTO ENTRE WORKSPACES -> %', v_vazou;
  END IF;

  EXECUTE 'SET LOCAL ROLE postgres';
  PERFORM set_config('request.jwt.claims', '', false);

  RAISE LOG 'isolamento provado: % tabelas varridas, % linhas alheias ao alcance, 0 visiveis',
            v_tabelas, v_alcance;
END
$prova$;

COMMIT;
