-- Prova de isolamento entre workspaces nas tabelas de crédito.
--
-- Não basta afirmar que a RLS protege: aqui dois usuários reais são criados,
-- cada um membro de um workspace, e a leitura é feita ASSUMINDO A IDENTIDADE
-- de cada um (role `authenticated` + claim de JWT). É o mesmo caminho que o
-- navegador percorre.
--
-- Se qualquer vazamento aparecer, a migration aborta e nada fica aplicado.
--
-- As fases ficam em blocos separados de propósito: assumir a role dentro do
-- mesmo bloco que faz a limpeza deixava o DELETE rodando sem privilégio.
--
-- Os identificadores são fixos, e não gerados: a fase 2 roda como
-- `authenticated`, que não enxerga tabela temporária. Constante resolve sem
-- precisar afrouxar permissão só para o teste.

-- ── Fase 1: cenário ──────────────────────────────────────────────────
DO $$
DECLARE
  v_ws_a uuid := '11111111-1111-1111-1111-111111111111';
  v_ws_b uuid := '22222222-2222-2222-2222-222222222222';
  v_u_a  uuid := '33333333-3333-3333-3333-333333333333';
  v_u_b  uuid := '44444444-4444-4444-4444-444444444444';
BEGIN
  -- Restos de uma execucao anterior interrompida.
  DELETE FROM workspaces WHERE id IN (v_ws_a, v_ws_b);
  DELETE FROM auth.users WHERE id IN (v_u_a, v_u_b);

  INSERT INTO workspaces (id, name) VALUES (v_ws_a, '__iso_A__'), (v_ws_b, '__iso_B__');

  INSERT INTO auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          created_at, updated_at,
                          confirmation_token, recovery_token,
                          email_change_token_new, email_change)
  VALUES
    (v_u_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'iso_a@teste.local', '', now(), now(), now(), '', '', '', ''),
    (v_u_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'iso_b@teste.local', '', now(), now(), now(), '', '', '', '');

  INSERT INTO workspace_members (user_id, workspace_id, role)
  VALUES (v_u_a, v_ws_a, 'admin'), (v_u_b, v_ws_b, 'admin');

  PERFORM add_credits(v_ws_a, 100, 'iso', NULL, 'setup@teste');
  PERFORM add_credits(v_ws_b, 200, 'iso', NULL, 'setup@teste');
END $$;

-- ── Fase 2: ler como o usuário A, pela mesma porta do navegador ──────
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_ws_a uuid := '11111111-1111-1111-1111-111111111111';
  v_ws_b uuid := '22222222-2222-2222-2222-222222222222';
  v_n    integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', '33333333-3333-3333-3333-333333333333',
                                       'role', 'authenticated')::text, true);

  -- 1. lê o próprio saldo
  SELECT count(*) INTO v_n FROM workspace_credits WHERE workspace_id = v_ws_a;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALHA: membro de A nao le o proprio saldo (viu %)', v_n;
  END IF;

  -- 2. NÃO lê o do vizinho
  SELECT count(*) INTO v_n FROM workspace_credits WHERE workspace_id = v_ws_b;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'VAZAMENTO: membro de A leu o saldo de B';
  END IF;

  -- 3. nem por varredura sem filtro
  SELECT count(*) INTO v_n FROM workspace_credits;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'VAZAMENTO: select sem filtro devolveu % linhas para A', v_n;
  END IF;

  -- 4. extrato do vizinho
  SELECT count(*) INTO v_n FROM credit_ledger WHERE workspace_id = v_ws_b;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'VAZAMENTO: membro de A leu o extrato de B';
  END IF;

  -- 5. trilha da plataforma: ninguém lê, nem a própria
  SELECT count(*) INTO v_n FROM credit_admin_log;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'VAZAMENTO: usuario comum leu credit_admin_log (% linhas)', v_n;
  END IF;

  -- 6. janelas de cobrança também são internas
  SELECT count(*) INTO v_n FROM credit_windows;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'VAZAMENTO: usuario comum leu credit_windows (% linhas)', v_n;
  END IF;

  -- 7. não altera o próprio saldo pelo caminho do navegador.
  -- Sem policy de UPDATE a RLS não lança erro: ela não encontra linha para
  -- atualizar. Por isso conferimos o EFEITO, não a exceção.
  BEGIN
    UPDATE workspace_credits SET saldo = 999999 WHERE workspace_id = v_ws_a;
    IF (SELECT saldo FROM workspace_credits WHERE workspace_id = v_ws_a) = 999999 THEN
      RAISE EXCEPTION 'FALHA GRAVE: usuario alterou o proprio saldo pelo navegador';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;   -- negar de forma explícita também está correto
  END;
END $$;

-- RESET ROLE nao devolve o privilegio neste contexto (a role de sessao do
-- runner de migration nao e o dono). Voltar explicitamente resolve.
SET LOCAL ROLE postgres;

-- ── Fase 3: limpeza, de volta como dono ──────────────────────────────
DO $$
BEGIN
  DELETE FROM workspaces WHERE id IN ('11111111-1111-1111-1111-111111111111',
                                     '22222222-2222-2222-2222-222222222222');
  DELETE FROM auth.users WHERE id IN ('33333333-3333-3333-3333-333333333333',
                                      '44444444-4444-4444-4444-444444444444');
  RAISE LOG 'isolamento de creditos: 7 verificacoes passaram';
END $$;
