-- Rastro para criação e edição de workspace.
--
-- Recarregar crédito já deixava trilha em credit_admin_log, com quem fez, antes
-- e depois. Criar workspace, não: a edge function só escrevia no log dela, que
-- expira e não é consultável pelo produto.
--
-- Isso importa porque criar workspace é abrir cliente novo — evento comercial —
-- e mudar o código muda a chave pela qual a cobrança é conferida. Sem registro,
-- a pergunta "quem abriu esse cliente e quando" não tem resposta.
--
-- A trilha reaproveita credit_admin_log em vez de ganhar tabela nova: o formato
-- já é o de uma trilha de administração da plataforma (ator, antes, depois), e
-- uma segunda tabela significaria duas telas para ver a mesma história.

COMMENT ON TABLE credit_admin_log IS
  'Trilha de administração da plataforma: crédito e workspaces. Toda ação do dono da plataforma passa por aqui.';

CREATE OR REPLACE FUNCTION log_admin_workspace(
  p_workspace_id uuid,
  p_acao         text,
  p_ator_id      uuid,
  p_ator_email   text,
  p_antes        jsonb DEFAULT NULL,
  p_depois       jsonb DEFAULT NULL,
  p_detalhe      jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_acao NOT IN ('workspace_criado', 'workspace_alterado') THEN
    RAISE EXCEPTION 'acao invalida para trilha de workspace: %', p_acao;
  END IF;

  INSERT INTO credit_admin_log (workspace_id, acao, ator_id, ator_email, antes, depois, detalhe)
  VALUES (p_workspace_id, p_acao, p_ator_id, p_ator_email, p_antes, p_depois,
          coalesce(p_detalhe, '{}'::jsonb));
END $$;

-- Só a edge function escreve, e ela já confere o e-mail contra o secret. Aberta
-- ao navegador, qualquer um forjaria uma linha de trilha — o que é pior que não
-- ter trilha, porque uma trilha falsificável passa a ser usada como prova.
REVOKE ALL ON FUNCTION log_admin_workspace(uuid, text, uuid, text, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION log_admin_workspace(uuid, text, uuid, text, jsonb, jsonb, jsonb)
  TO service_role;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE v_ws uuid; v_n integer; v_depois jsonb;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__teste_trilha__', 'TSTTRL') RETURNING id INTO v_ws;

  PERFORM log_admin_workspace(v_ws, 'workspace_criado', NULL, 'dono@teste',
                              NULL, '{"codigo":"TSTTRL"}'::jsonb, '{}'::jsonb);

  -- Sem max(jsonb): esse agregado não existe no Postgres.
  SELECT count(*) INTO v_n
    FROM credit_admin_log WHERE workspace_id = v_ws AND acao = 'workspace_criado';
  SELECT depois INTO v_depois
    FROM credit_admin_log WHERE workspace_id = v_ws AND acao = 'workspace_criado' LIMIT 1;
  IF v_n <> 1 THEN RAISE EXCEPTION 'trilha nao gravou: % linhas', v_n; END IF;
  IF v_depois->>'codigo' <> 'TSTTRL' THEN RAISE EXCEPTION 'trilha perdeu o depois'; END IF;

  -- Ação fora do conjunto não pode entrar: a trilha vale pelo que ela recusa.
  BEGIN
    PERFORM log_admin_workspace(v_ws, 'qualquer_coisa', NULL, 'x', NULL, NULL, '{}'::jsonb);
    RAISE EXCEPTION 'aceitou acao invalida';
  EXCEPTION WHEN raise_exception THEN
    IF sqlerrm = 'aceitou acao invalida' THEN RAISE; END IF;
  END;

  IF has_function_privilege('authenticated',
       'log_admin_workspace(uuid, text, uuid, text, jsonb, jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'trilha gravavel pelo navegador — seria falsificavel';
  END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'trilha de workspaces: 4 asseveracoes passaram';
END $$;
