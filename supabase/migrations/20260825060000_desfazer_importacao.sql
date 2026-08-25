-- Importação vira um lote que pode ser desfeito.
--
-- Hoje uma importação de 400 linhas que dá meio certo deixa a pessoa com 200
-- registros para apagar à mão antes de tentar de novo. Na prática ninguém faz
-- isso: reimporta por cima, duplica o que der, e a base piora a cada tentativa.
-- O medo de errar vira medo de importar.
--
-- Duas tabelas: o lote, e o que ele mexeu. Guardar o ANTES de cada contato
-- atualizado é o que separa "apagar o que entrou" de "voltar ao que era".
--
-- ── O QUE DESFAZER NÃO FAZ ──────────────────────────────────────────
-- Não apaga contato que já tem conversa ou mensagem. Essas chaves são
-- ON DELETE NO ACTION de propósito: histórico de atendimento não pode sumir
-- porque alguém errou uma planilha. Nesses casos o contato fica, os dados
-- voltam ao que eram, e o desfazer diz quantos foram preservados assim.

CREATE TABLE IF NOT EXISTS import_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  arquivo              text,
  linhas               integer NOT NULL DEFAULT 0,
  contatos_criados     integer NOT NULL DEFAULT 0,
  contatos_atualizados integer NOT NULL DEFAULT 0,
  boletos_criados      integer NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'concluida'
                         CHECK (status IN ('concluida', 'desfeita')),
  criado_por           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  desfeita_em          timestamptz
);

CREATE TABLE IF NOT EXISTS import_run_items (
  id           bigserial PRIMARY KEY,
  run_id       uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('contato_criado', 'contato_atualizado', 'boleto_criado')),
  contato_id   uuid,
  boleto_id    uuid,
  -- Só para 'contato_atualizado': a linha inteira como estava antes.
  antes        jsonb
);

CREATE INDEX IF NOT EXISTS idx_import_runs_ws   ON import_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_items_run ON import_run_items (run_id, tipo);

COMMENT ON TABLE import_runs IS
  'Uma importacao de planilha. Existe para poder ser desfeita.';

ALTER TABLE import_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_run_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS runs_do_meu_workspace ON import_runs;
CREATE POLICY runs_do_meu_workspace ON import_runs
  FOR ALL TO authenticated
  USING      (workspace_id IN (SELECT get_my_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT get_my_workspace_ids()));

DROP POLICY IF EXISTS itens_do_meu_workspace ON import_run_items;
CREATE POLICY itens_do_meu_workspace ON import_run_items
  FOR ALL TO authenticated
  USING      (workspace_id IN (SELECT get_my_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT get_my_workspace_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON import_runs      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON import_run_items TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE import_run_items_id_seq  TO authenticated;

-- ── Importar registrando o lote ──────────────────────────────────────
DROP FUNCTION IF EXISTS importar_contatos(uuid, jsonb);

CREATE OR REPLACE FUNCTION importar_contatos(p_workspace_id uuid, p_linhas jsonb, p_run_id uuid DEFAULT NULL)
RETURNS TABLE (id_contato uuid, telefone text, documento text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $funcao$
BEGIN
  -- Fotografa quem já existe ANTES de mexer. Depois do upsert é tarde: o
  -- valor antigo já não está em lugar nenhum.
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
    -- xmax = 0 marca a linha que acabou de nascer. É como o Postgres deixa
    -- distinguir INSERT de UPDATE dentro de um upsert, e é o que permite
    -- desfazer apagando só o que foi criado.
    RETURNING c.id, c.phone, c.cpf_cnpj, (c.xmax = 0) AS nasceu_agora
  ),
  registro AS (
    INSERT INTO import_run_items (run_id, workspace_id, tipo, contato_id)
    SELECT p_run_id, p_workspace_id, 'contato_criado', g.id
      FROM gravados g
     WHERE p_run_id IS NOT NULL AND g.nasceu_agora
  )
  SELECT g.id, g.phone, g.cpf_cnpj FROM gravados g;
END
$funcao$;

REVOKE ALL ON FUNCTION importar_contatos(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION importar_contatos(uuid, jsonb, uuid) TO authenticated, service_role;

-- ── Desfazer ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION desfazer_importacao(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $desfaz$
DECLARE
  v_run       import_runs%ROWTYPE;
  v_boletos   integer := 0;
  v_voltaram  integer := 0;
  v_apagados  integer := 0;
  v_mantidos  integer := 0;
BEGIN
  SELECT * INTO v_run FROM import_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'importacao nao encontrada';
  END IF;
  IF v_run.status = 'desfeita' THEN
    RAISE EXCEPTION 'esta importacao ja foi desfeita';
  END IF;

  -- 1. Boletos criados por este lote somem. Vêm primeiro porque seguram o
  --    contato pela chave estrangeira.
  WITH mortos AS (
    DELETE FROM contact_invoices
     WHERE id IN (SELECT boleto_id FROM import_run_items
                   WHERE run_id = p_run_id AND tipo = 'boleto_criado' AND boleto_id IS NOT NULL)
    RETURNING 1
  )
  SELECT count(*) INTO v_boletos FROM mortos;

  -- 2. Contatos que já existiam voltam ao que eram. Campo a campo, a partir da
  --    foto tirada antes da importação.
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
     WHERE i.run_id = p_run_id AND i.tipo = 'contato_atualizado'
       AND c.id = i.contato_id
    RETURNING 1
  )
  SELECT count(*) INTO v_voltaram FROM voltando;

  -- 3. Contatos criados pelo lote. Só saem os que não têm histórico de
  --    atendimento: conversa e mensagem seguram o contato de propósito, e
  --    apagar isso seria um estrago maior que o da planilha errada.
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
  )
  SELECT count(*) INTO v_apagados FROM removidos;

  SELECT count(*) INTO v_mantidos
    FROM import_run_items i
   WHERE i.run_id = p_run_id AND i.tipo = 'contato_criado'
     AND EXISTS (SELECT 1 FROM inbox_contacts c WHERE c.id = i.contato_id);

  UPDATE import_runs SET status = 'desfeita', desfeita_em = now() WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'boletos_removidos',    v_boletos,
    'contatos_restaurados', v_voltaram,
    'contatos_removidos',   v_apagados,
    'contatos_mantidos',    v_mantidos
  );
END
$desfaz$;

COMMENT ON FUNCTION desfazer_importacao(uuid) IS
  'Desfaz uma importacao: apaga boletos criados, devolve contatos atualizados ao estado anterior e remove contatos criados que nao tenham historico de atendimento.';

REVOKE ALL ON FUNCTION desfazer_importacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION desfazer_importacao(uuid) TO authenticated, service_role;

-- ── Verificação ──────────────────────────────────────────────────────
DO $teste$
DECLARE
  v_ws   uuid;
  v_run  uuid;
  v_c    uuid;
  v_inv  uuid;
  v_r    record;
  v_res  jsonb;
  v_n    integer;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__desfaz__', 'DESFAZ') RETURNING id INTO v_ws;

  -- Cliente que JÁ existia, com dados que precisam sobreviver ao desfazer.
  INSERT INTO inbox_contacts (workspace_id, name, phone, email, empresa)
  VALUES (v_ws, 'Antigo', '5511988880001', 'antigo@x.com', 'Empresa Antiga') RETURNING id INTO v_c;

  INSERT INTO import_runs (workspace_id, arquivo, linhas) VALUES (v_ws, 'teste.xlsx', 2) RETURNING id INTO v_run;

  -- Importa: atualiza o antigo e cria um novo.
  PERFORM importar_contatos(v_ws,
    '[{"phone":"5511988880001","name":"Antigo Alterado","email":"novo@x.com"},
      {"phone":"5511988880002","name":"Novato","email":"novato@x.com"}]'::jsonb, v_run);

  SELECT count(*) INTO v_n FROM inbox_contacts WHERE workspace_id = v_ws;
  IF v_n <> 2 THEN RAISE EXCEPTION 'esperava 2 contatos, achei %', v_n; END IF;

  -- Um boleto do lote.
  INSERT INTO contact_invoices (workspace_id, contact_id, valor, vencimento)
  VALUES (v_ws, v_c, 100, current_date) RETURNING id INTO v_inv;
  INSERT INTO import_run_items (run_id, workspace_id, tipo, boleto_id) VALUES (v_run, v_ws, 'boleto_criado', v_inv);

  -- ── Desfaz ──
  v_res := desfazer_importacao(v_run);

  -- 1. O contato que já existia voltou ao que era.
  SELECT * INTO v_r FROM inbox_contacts WHERE id = v_c;
  IF v_r.name <> 'Antigo' THEN RAISE EXCEPTION 'nome nao voltou: %', v_r.name; END IF;
  IF v_r.email <> 'antigo@x.com' THEN RAISE EXCEPTION 'email nao voltou: %', v_r.email; END IF;
  IF v_r.empresa <> 'Empresa Antiga' THEN RAISE EXCEPTION 'empresa nao voltou'; END IF;

  -- 2. O contato criado sumiu.
  IF EXISTS (SELECT 1 FROM inbox_contacts WHERE workspace_id = v_ws AND phone = '5511988880002') THEN
    RAISE EXCEPTION 'contato criado pelo lote sobreviveu ao desfazer';
  END IF;

  -- 3. O boleto sumiu.
  IF EXISTS (SELECT 1 FROM contact_invoices WHERE id = v_inv) THEN
    RAISE EXCEPTION 'boleto do lote sobreviveu';
  END IF;

  -- 4. O contato que já existia NÃO foi apagado. Desfazer devolve, não limpa.
  IF NOT EXISTS (SELECT 1 FROM inbox_contacts WHERE id = v_c) THEN
    RAISE EXCEPTION 'FALHA GRAVE: desfazer apagou um contato que ja existia antes';
  END IF;

  IF (v_res->>'contatos_removidos')::int <> 1 THEN RAISE EXCEPTION 'relatorio errado: %', v_res; END IF;
  IF (v_res->>'boletos_removidos')::int  <> 1 THEN RAISE EXCEPTION 'relatorio errado: %', v_res; END IF;

  -- 5. Desfazer duas vezes não pode.
  BEGIN
    PERFORM desfazer_importacao(v_run);
    RAISE EXCEPTION 'aceitou desfazer duas vezes';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'aceitou desfazer duas vezes' THEN RAISE; END IF;
  END;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'desfazer importacao: 5 asseveracoes passaram';
END
$teste$;
