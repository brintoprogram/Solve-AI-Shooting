-- Conserta importar_contatos quando o contato não tem tag nenhuma.
--
-- `array_agg` sobre conjunto vazio devolve NULL, não array vazio. Então
-- `array_agg(DISTINCT t) FROM unnest(c.tags || EXCLUDED.tags)` produzia NULL
-- quando os dois lados estavam vazios — e tags é NOT NULL. Resultado: toda
-- importação de contato sem tag falhava, que é o caso mais comum de todos.
--
-- As asseverações da migration anterior não pegaram porque o contato de teste
-- sempre teve tag. Quem pegou foi rodar a função pelo caminho real, com um
-- contato comum. Teste que só exercita o caminho que o autor imaginou prova
-- menos do que parece.

CREATE OR REPLACE FUNCTION importar_contatos(p_workspace_id uuid, p_linhas jsonb)
RETURNS TABLE (id_contato uuid, telefone text, documento text)
LANGUAGE plpgsql
SECURITY INVOKER
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
    -- COALESCE por fora: sem ele, contato sem tag nenhuma gravava NULL numa
    -- coluna NOT NULL e a importação inteira parava.
    tags                = COALESCE(
                            (SELECT array_agg(DISTINCT t)
                               FROM unnest(c.tags || EXCLUDED.tags) t
                              WHERE t IS NOT NULL AND t <> ''),
                            '{}'::text[])
  RETURNING c.id, c.phone, c.cpf_cnpj;
END
$funcao$;

-- ── Verificação ──────────────────────────────────────────────────────
DO $teste$
DECLARE
  v_ws uuid;
  v_r  record;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__imp_tags__', 'IMPTAG') RETURNING id INTO v_ws;

  -- O caso que quebrou: contato SEM tag, atualizado por linha SEM tag.
  PERFORM importar_contatos(v_ws, '[{"phone":"5511999990002","name":"Sem Tag"}]'::jsonb);
  PERFORM importar_contatos(v_ws, '[{"phone":"5511999990002","email":"semtag@x.com"}]'::jsonb);
  SELECT * INTO v_r FROM inbox_contacts WHERE workspace_id = v_ws AND phone = '5511999990002';
  IF v_r.tags IS NULL THEN RAISE EXCEPTION 'tags virou NULL numa coluna NOT NULL'; END IF;
  IF v_r.email <> 'semtag@x.com' THEN RAISE EXCEPTION 'nao atualizou o contato sem tag'; END IF;
  IF v_r.name <> 'Sem Tag' THEN RAISE EXCEPTION 'perdeu o nome'; END IF;

  -- E o acréscimo de tag continua funcionando.
  PERFORM importar_contatos(v_ws, '[{"phone":"5511999990002","tags":["novo"]}]'::jsonb);
  SELECT * INTO v_r FROM inbox_contacts WHERE workspace_id = v_ws AND phone = '5511999990002';
  IF NOT ('novo' = ANY(v_r.tags)) THEN RAISE EXCEPTION 'nao acrescentou a tag'; END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'importar_contatos: caso sem tag coberto';
END
$teste$;
