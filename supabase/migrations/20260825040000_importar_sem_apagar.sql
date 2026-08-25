-- Importação deixa de apagar o que a planilha não traz.
--
-- O upsert do importador mandava TODOS os campos, e os ausentes iam como null.
-- Como o ON CONFLICT DO UPDATE grava o que recebe, uma planilha de cobrança com
-- telefone, valor e vencimento zerava e-mail, empresa, endereço, documento e
-- tags de todo cliente que já existia. Provado em transação desfeita: um
-- contato com e-mail, empresa e cidade preenchidos perdeu os três ao ser
-- reimportado sem essas colunas.
--
-- Ninguém percebe na hora. Percebe quando a próxima campanha de e-mail sai com
-- metade da base sem endereço.
--
-- A regra certa é COALESCE: o que a planilha traz manda, o que ela não traz
-- fica como está. Isso não dá para expressar pelo cliente — o PostgREST monta
-- o SET a partir das colunas que chegam — então mora aqui, no banco, onde a
-- semântica é exata.
--
-- Importar nunca deve APAGAR. Se alguém precisa limpar um campo, isso é uma
-- edição consciente na tela do contato, e não efeito colateral de uma planilha
-- que por acaso não tinha aquela coluna.

CREATE OR REPLACE FUNCTION importar_contatos(p_workspace_id uuid, p_linhas jsonb)
-- Nomes de saida diferentes dos das colunas: RETURNS TABLE cria variaveis
-- com esses nomes, e dentro da consulta elas disputam com inbox_contacts.
-- "column reference phone is ambiguous" e o Postgres avisando disso.
RETURNS TABLE (id_contato uuid, telefone text, documento text)
LANGUAGE plpgsql
SECURITY INVOKER          -- respeita a RLS de quem chamou, como o upsert antigo
SET search_path = public
AS $funcao$
BEGIN
  RETURN QUERY
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
    -- Tag é acréscimo, não substituição: a planilha do mês não sabe das
    -- marcações que a equipe fez durante o atendimento.
    tags                = (SELECT array_agg(DISTINCT t)
                             FROM unnest(c.tags || EXCLUDED.tags) t)
  RETURNING c.id, c.phone, c.cpf_cnpj;
END
$funcao$;

COMMENT ON FUNCTION importar_contatos(uuid, jsonb) IS
  'Upsert de contatos por telefone. Campo ausente na planilha NAO apaga o que ja existe.';

REVOKE ALL ON FUNCTION importar_contatos(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION importar_contatos(uuid, jsonb) TO authenticated, service_role;

-- ── Verificação ──────────────────────────────────────────────────────
DO $teste$
DECLARE
  v_ws uuid;
  v_r  record;
  v_n  integer;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__imp_teste__', 'IMPTST') RETURNING id INTO v_ws;

  -- 1. Cria quem não existe.
  PERFORM importar_contatos(v_ws,
    '[{"phone":"5511999990001","name":"Maria","email":"maria@antigo.com","empresa":"Fazenda X","tags":["cliente"]}]'::jsonb);
  SELECT * INTO v_r FROM inbox_contacts WHERE workspace_id = v_ws AND phone = '5511999990001';
  IF v_r.email <> 'maria@antigo.com' THEN RAISE EXCEPTION 'nao criou o contato'; END IF;

  -- 2. O QUE A PLANILHA NÃO TRAZ NÃO SOME. É a asseveração que motiva tudo.
  PERFORM importar_contatos(v_ws, '[{"phone":"5511999990001","name":"Maria Silva"}]'::jsonb);
  SELECT * INTO v_r FROM inbox_contacts WHERE workspace_id = v_ws AND phone = '5511999990001';
  IF v_r.email   IS NULL THEN RAISE EXCEPTION 'APAGOU o email que a planilha nao trazia'; END IF;
  IF v_r.empresa IS NULL THEN RAISE EXCEPTION 'APAGOU a empresa que a planilha nao trazia'; END IF;
  IF v_r.name <> 'Maria Silva' THEN RAISE EXCEPTION 'nao atualizou o nome que a planilha trazia'; END IF;

  -- 3. Célula em branco também não apaga: em branco é ausência de informação,
  --    não ordem de limpar.
  PERFORM importar_contatos(v_ws, '[{"phone":"5511999990001","email":"   "}]'::jsonb);
  SELECT * INTO v_r FROM inbox_contacts WHERE workspace_id = v_ws AND phone = '5511999990001';
  IF v_r.email IS NULL THEN RAISE EXCEPTION 'celula em branco apagou o email'; END IF;

  -- 4. O que a planilha traz manda.
  PERFORM importar_contatos(v_ws, '[{"phone":"5511999990001","email":"maria@novo.com"}]'::jsonb);
  SELECT * INTO v_r FROM inbox_contacts WHERE workspace_id = v_ws AND phone = '5511999990001';
  IF v_r.email <> 'maria@novo.com' THEN RAISE EXCEPTION 'nao atualizou o email novo'; END IF;

  -- 5. Tag soma, não substitui.
  PERFORM importar_contatos(v_ws, '[{"phone":"5511999990001","tags":["inadimplente"]}]'::jsonb);
  SELECT * INTO v_r FROM inbox_contacts WHERE workspace_id = v_ws AND phone = '5511999990001';
  IF NOT ('cliente' = ANY(v_r.tags)) OR NOT ('inadimplente' = ANY(v_r.tags)) THEN
    RAISE EXCEPTION 'tags perderam historico: %', v_r.tags;
  END IF;

  -- 6. Linha sem telefone é ignorada, e não vira contato fantasma.
  PERFORM importar_contatos(v_ws, '[{"name":"Sem Telefone","email":"x@y.com"}]'::jsonb);
  SELECT count(*) INTO v_n FROM inbox_contacts WHERE workspace_id = v_ws;
  IF v_n <> 1 THEN RAISE EXCEPTION 'linha sem telefone criou contato: % no total', v_n; END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'importar_contatos: 6 asseveracoes passaram';
END
$teste$;
