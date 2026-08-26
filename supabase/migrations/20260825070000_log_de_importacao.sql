-- Trilha de eventos da importação, e conserto da contagem.
--
-- ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────
-- A importação de 528 linhas reportou "235 criados · 0 atualizados". A verdade
-- era 205 criados e 30 atualizados. O desfazer acertou — removeu exatamente os
-- 205 que nasceram e restaurou os 30 que já existiam, campo a campo — mas o
-- número mostrado à pessoa estava errado nos dois sentidos ao mesmo tempo.
--
-- A causa: `stats.contactsInserted += chunk.length` contava o LOTE INTEIRO como
-- inserção, sem saber quais linhas o banco tinha criado e quais tinha
-- atualizado. E `contactsUpdated` só era incrementado num caminho lateral, o de
-- linha sem telefone — por isso zero.
--
-- Um relatório errado sobre uma operação certa é pior do que parece: foi ele
-- que fez a conta não fechar na tela e levantar a suspeita de que o desfazer
-- estava com defeito.
--
-- O banco já sabia a resposta: xmax = 0 marca a linha recém-nascida. A função
-- passa a devolver esse dado em vez de deixar o cliente adivinhar.
--
-- ── A TRILHA ────────────────────────────────────────────────────────
-- Importação é um processo de vários passos que roda no navegador de outra
-- pessoa. Quando dá errado, não há como pedir para ela repetir o que aconteceu:
-- o logger do front escreve só no console, e o console fecha junto com a aba.
-- Sem registro no servidor, todo diagnóstico vira reconstrução por adivinhação
-- — foi exatamente o que aconteceu ao investigar a importação que não gravava
-- nada.

CREATE TABLE IF NOT EXISTS import_run_logs (
  id           bigserial PRIMARY KEY,
  run_id       uuid REFERENCES import_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  etapa        text NOT NULL,
  nivel        text NOT NULL DEFAULT 'info' CHECK (nivel IN ('info', 'aviso', 'erro')),
  mensagem     text NOT NULL,
  detalhe      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_logs_run
  ON import_run_logs (run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_import_logs_erro
  ON import_run_logs (workspace_id, created_at DESC) WHERE nivel = 'erro';

COMMENT ON TABLE import_run_logs IS
  'Eventos de uma importacao. Existe porque o console do navegador fecha com a aba e leva o diagnostico junto.';

ALTER TABLE import_run_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS logs_do_meu_workspace ON import_run_logs;
CREATE POLICY logs_do_meu_workspace ON import_run_logs
  FOR ALL TO authenticated
  USING      (workspace_id IN (SELECT get_my_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT get_my_workspace_ids()));

GRANT SELECT, INSERT ON import_run_logs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE import_run_logs_id_seq TO authenticated;

-- Log não se reescreve: um registro de diagnóstico que pode ser editado depois
-- não serve para diagnosticar.
REVOKE UPDATE, DELETE ON import_run_logs FROM authenticated;

-- ── A função passa a dizer o que criou e o que atualizou ─────────────
DROP FUNCTION IF EXISTS importar_contatos(uuid, jsonb, uuid);

CREATE OR REPLACE FUNCTION importar_contatos(p_workspace_id uuid, p_linhas jsonb, p_run_id uuid DEFAULT NULL)
RETURNS TABLE (id_contato uuid, telefone text, documento text, nasceu_agora boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $funcao$
BEGIN
  IF p_run_id IS NOT NULL THEN
    INSERT INTO import_run_items (run_id, workspace_id, tipo, contato_id, antes)
    SELECT p_run_id, p_workspace_id, 'contato_atualizado', c.id, to_jsonb(c)
      FROM inbox_contacts c
     WHERE c.workspace_id = p_workspace_id
       AND c.phone IN (SELECT nullif(btrim(l->>'phone'), '')
                         FROM jsonb_array_elements(p_linhas) l);
  END IF;

  RETURN QUERY
  WITH gravados AS (
    INSERT INTO inbox_contacts AS c (
      workspace_id, phone, name, cpf_cnpj, empresa, email, email2,
      nome_representante, email_representante,
      gerente1_nome, gerente1_email, gerente2_nome, gerente2_email,
      cep, logradouro, numero, complemento, bairro, cidade, estado, tags
    )
    SELECT
      p_workspace_id,
      nullif(btrim(l->>'phone'), ''),
      nullif(btrim(l->>'name'), ''),
      nullif(btrim(l->>'cpf_cnpj'), ''),
      nullif(btrim(l->>'empresa'), ''),
      nullif(btrim(l->>'email'), ''),
      nullif(btrim(l->>'email2'), ''),
      nullif(btrim(l->>'nome_representante'), ''),
      nullif(btrim(l->>'email_representante'), ''),
      nullif(btrim(l->>'gerente1_nome'), ''),
      nullif(btrim(l->>'gerente1_email'), ''),
      nullif(btrim(l->>'gerente2_nome'), ''),
      nullif(btrim(l->>'gerente2_email'), ''),
      nullif(btrim(l->>'cep'), ''),
      nullif(btrim(l->>'logradouro'), ''),
      nullif(btrim(l->>'numero'), ''),
      nullif(btrim(l->>'complemento'), ''),
      nullif(btrim(l->>'bairro'), ''),
      nullif(btrim(l->>'cidade'), ''),
      nullif(btrim(l->>'estado'), ''),
      COALESCE(
        (SELECT array_agg(t) FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(l->'tags') = 'array' THEN l->'tags' ELSE '[]'::jsonb END) t),
        '{}'::text[])
    FROM jsonb_array_elements(p_linhas) l
    WHERE nullif(btrim(l->>'phone'), '') IS NOT NULL

    ON CONFLICT (workspace_id, phone) DO UPDATE SET
      name                = COALESCE(EXCLUDED.name,                c.name),
      cpf_cnpj            = COALESCE(EXCLUDED.cpf_cnpj,            c.cpf_cnpj),
      empresa             = COALESCE(EXCLUDED.empresa,             c.empresa),
      email               = COALESCE(EXCLUDED.email,               c.email),
      email2              = COALESCE(EXCLUDED.email2,              c.email2),
      nome_representante  = COALESCE(EXCLUDED.nome_representante,  c.nome_representante),
      email_representante = COALESCE(EXCLUDED.email_representante, c.email_representante),
      gerente1_nome       = COALESCE(EXCLUDED.gerente1_nome,       c.gerente1_nome),
      gerente1_email      = COALESCE(EXCLUDED.gerente1_email,      c.gerente1_email),
      gerente2_nome       = COALESCE(EXCLUDED.gerente2_nome,       c.gerente2_nome),
      gerente2_email      = COALESCE(EXCLUDED.gerente2_email,      c.gerente2_email),
      cep                 = COALESCE(EXCLUDED.cep,                 c.cep),
      logradouro          = COALESCE(EXCLUDED.logradouro,          c.logradouro),
      numero              = COALESCE(EXCLUDED.numero,              c.numero),
      complemento         = COALESCE(EXCLUDED.complemento,         c.complemento),
      bairro              = COALESCE(EXCLUDED.bairro,              c.bairro),
      cidade              = COALESCE(EXCLUDED.cidade,              c.cidade),
      estado              = COALESCE(EXCLUDED.estado,              c.estado),
      tags                = COALESCE(
                              (SELECT array_agg(DISTINCT t)
                                 FROM unnest(c.tags || EXCLUDED.tags) t
                                WHERE t IS NOT NULL AND t <> ''),
                              '{}'::text[])
    RETURNING c.id, c.phone, c.cpf_cnpj, (c.xmax = 0) AS criado
  ),
  registro AS (
    INSERT INTO import_run_items (run_id, workspace_id, tipo, contato_id)
    SELECT p_run_id, p_workspace_id, 'contato_criado', g.id
      FROM gravados g
     WHERE p_run_id IS NOT NULL AND g.criado
  )
  SELECT g.id, g.phone, g.cpf_cnpj, g.criado FROM gravados g;
END
$funcao$;

REVOKE ALL ON FUNCTION importar_contatos(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION importar_contatos(uuid, jsonb, uuid) TO authenticated, service_role;

-- ── Desfazer também deixa rastro ─────────────────────────────────────
CREATE OR REPLACE FUNCTION desfazer_importacao(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $desfaz$
DECLARE
  v_run      import_runs%ROWTYPE;
  v_boletos  integer := 0;
  v_voltaram integer := 0;
  v_apagados integer := 0;
  v_mantidos integer := 0;
  v_res      jsonb;
BEGIN
  SELECT * INTO v_run FROM import_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'importacao nao encontrada'; END IF;
  IF v_run.status = 'desfeita' THEN RAISE EXCEPTION 'esta importacao ja foi desfeita'; END IF;

  INSERT INTO import_run_logs (run_id, workspace_id, etapa, nivel, mensagem, detalhe)
  VALUES (p_run_id, v_run.workspace_id, 'desfazer', 'info', 'Desfazer iniciado',
          jsonb_build_object('arquivo', v_run.arquivo, 'linhas', v_run.linhas));

  WITH mortos AS (
    DELETE FROM contact_invoices
     WHERE id IN (SELECT boleto_id FROM import_run_items
                   WHERE run_id = p_run_id AND tipo = 'boleto_criado' AND boleto_id IS NOT NULL)
    RETURNING 1
  ) SELECT count(*) INTO v_boletos FROM mortos;

  WITH voltando AS (
    UPDATE inbox_contacts c SET
      name                = i.antes->>'name',
      cpf_cnpj            = i.antes->>'cpf_cnpj',
      empresa             = i.antes->>'empresa',
      email               = i.antes->>'email',
      email2              = i.antes->>'email2',
      nome_representante  = i.antes->>'nome_representante',
      email_representante = i.antes->>'email_representante',
      gerente1_nome       = i.antes->>'gerente1_nome',
      gerente1_email      = i.antes->>'gerente1_email',
      gerente2_nome       = i.antes->>'gerente2_nome',
      gerente2_email      = i.antes->>'gerente2_email',
      cep                 = i.antes->>'cep',
      logradouro          = i.antes->>'logradouro',
      numero              = i.antes->>'numero',
      complemento         = i.antes->>'complemento',
      bairro              = i.antes->>'bairro',
      cidade              = i.antes->>'cidade',
      estado              = i.antes->>'estado',
      tags                = COALESCE(
                              (SELECT array_agg(t) FROM jsonb_array_elements_text(
                                 CASE WHEN jsonb_typeof(i.antes->'tags') = 'array'
                                      THEN i.antes->'tags' ELSE '[]'::jsonb END) t),
                              '{}'::text[])
      FROM import_run_items i
     WHERE i.run_id = p_run_id AND i.tipo = 'contato_atualizado' AND c.id = i.contato_id
    RETURNING 1
  ) SELECT count(*) INTO v_voltaram FROM voltando;

  WITH criados AS (
    SELECT contato_id FROM import_run_items
     WHERE run_id = p_run_id AND tipo = 'contato_criado' AND contato_id IS NOT NULL
  ),
  sem_historico AS (
    SELECT c.contato_id FROM criados c
     WHERE NOT EXISTS (SELECT 1 FROM inbox_conversations x WHERE x.contact_id = c.contato_id)
       AND NOT EXISTS (SELECT 1 FROM inbox_messages     x WHERE x.contact_id = c.contato_id)
  ),
  removidos AS (
    DELETE FROM inbox_contacts WHERE id IN (SELECT contato_id FROM sem_historico)
    RETURNING 1
  ) SELECT count(*) INTO v_apagados FROM removidos;

  SELECT count(*) INTO v_mantidos
    FROM import_run_items i
   WHERE i.run_id = p_run_id AND i.tipo = 'contato_criado'
     AND EXISTS (SELECT 1 FROM inbox_contacts c WHERE c.id = i.contato_id);

  UPDATE import_runs SET status = 'desfeita', desfeita_em = now() WHERE id = p_run_id;

  v_res := jsonb_build_object(
    'boletos_removidos',    v_boletos,
    'contatos_restaurados', v_voltaram,
    'contatos_removidos',   v_apagados,
    'contatos_mantidos',    v_mantidos
  );

  INSERT INTO import_run_logs (run_id, workspace_id, etapa, nivel, mensagem, detalhe)
  VALUES (p_run_id, v_run.workspace_id, 'desfazer',
          CASE WHEN v_mantidos > 0 THEN 'aviso' ELSE 'info' END,
          CASE WHEN v_mantidos > 0
               THEN v_mantidos || ' contato(s) mantido(s) por ja terem historico de atendimento'
               ELSE 'Desfazer concluido' END,
          v_res);

  RETURN v_res;
END
$desfaz$;

REVOKE ALL ON FUNCTION desfazer_importacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION desfazer_importacao(uuid) TO authenticated, service_role;

-- ── Verificação ──────────────────────────────────────────────────────
DO $teste$
DECLARE
  v_ws   uuid;
  v_run  uuid;
  v_c    uuid;
  v_cria integer;
  v_atu  integer;
  v_logs integer;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__logimp__', 'LOGIMP') RETURNING id INTO v_ws;
  INSERT INTO inbox_contacts (workspace_id, name, phone, email)
  VALUES (v_ws, 'Ja Existia', '5511977770001', 'antigo@x.com') RETURNING id INTO v_c;
  INSERT INTO import_runs (workspace_id, arquivo, linhas) VALUES (v_ws, 't.xlsx', 2) RETURNING id INTO v_run;

  -- Uma linha atualiza, a outra cria. A contagem tem que separar as duas.
  SELECT count(*) FILTER (WHERE nasceu_agora),
         count(*) FILTER (WHERE NOT nasceu_agora)
    INTO v_cria, v_atu
    FROM importar_contatos(v_ws,
      '[{"phone":"5511977770001","name":"Alterado"},
        {"phone":"5511977770002","name":"Novo"}]'::jsonb, v_run);

  IF v_cria <> 1 THEN RAISE EXCEPTION 'esperava 1 criado, contou %', v_cria; END IF;
  IF v_atu  <> 1 THEN RAISE EXCEPTION 'esperava 1 atualizado, contou %', v_atu; END IF;

  -- O desfazer registra inicio e fim.
  PERFORM desfazer_importacao(v_run);
  SELECT count(*) INTO v_logs FROM import_run_logs WHERE run_id = v_run;
  IF v_logs < 2 THEN RAISE EXCEPTION 'desfazer nao deixou rastro: % linha(s)', v_logs; END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'log de importacao: contagem separa criado de atualizado, e desfazer deixa rastro';
END
$teste$;
