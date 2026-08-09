-- Mapeamento de variáveis do template.
--
-- Antes a tela bloqueava template com mais de duas variáveis, porque o envio
-- preenchia só nome e detalhe, em posição fixa. Bloquear era melhor que mandar
-- dado errado — mas escondia metade dos templates do cliente, que é o caso
-- comum: template de cobrança tem nome, vencimento e valor.
--
-- Agora cada {{n}} recebe uma origem escolhida na tela. O array é posicional:
-- variaveis[0] alimenta {{1}}, e assim por diante.
--
--   {"origem":"primeiro_nome"}          → "Maria"
--   {"origem":"nome_completo"}          → "Maria Aparecida Santos"
--   {"origem":"detalhe"}                → "32 anos" / "Dia do Administrador"
--   {"origem":"empresa"}                → "Fazenda São João"
--   {"origem":"fixo","valor":"agosto"}  → literal

ALTER TABLE relationship_rules
  ADD COLUMN IF NOT EXISTS variaveis jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN relationship_rules.variaveis IS
  'Origem de cada variável do template, por posição: [0] alimenta {{1}}.';

-- A tela impede salvar com contagem errada, mas a tela não é a garantia: uma
-- regra criada por API ou por script passaria direto e só falharia na Meta,
-- em cima da hora do envio.
ALTER TABLE relationship_rules DROP CONSTRAINT IF EXISTS relationship_rules_variaveis_lista;
ALTER TABLE relationship_rules ADD CONSTRAINT relationship_rules_variaveis_lista
  CHECK (jsonb_typeof(variaveis) = 'array' AND jsonb_array_length(variaveis) <= 10);

-- ── Alvos com mais campos ────────────────────────────────────────────
-- `empresa` entra porque é a origem mais pedida depois do nome. Os demais
-- campos do contato ficam de fora de propósito: cada um vira uma opção na
-- tela, e uma lista longa demais transforma uma escolha simples em formulário.
DROP FUNCTION IF EXISTS relacionamento_alvos(uuid, date);

CREATE OR REPLACE FUNCTION relacionamento_alvos(p_rule_id uuid, p_data date DEFAULT NULL)
RETURNS TABLE (
  contact_id uuid,
  nome       text,
  telefone   text,
  motivo     text,
  detalhe    text,
  empresa    text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r      relationship_rules%ROWTYPE;
  v_hoje date;
  v_ano  integer;
BEGIN
  SELECT * INTO r FROM relationship_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_hoje := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_ano  := extract(year from v_hoje)::integer;

  RETURN QUERY
  SELECT c.id, c.name, c.phone, m.motivo, m.detalhe, c.empresa
  FROM inbox_contacts c
  JOIN LATERAL (
    SELECT
      CASE r.tipo
        WHEN 'aniversario'   THEN 'aniversário'
        WHEN 'profissao'     THEN 'dia da profissão'
        ELSE 'aniversário de cliente'
      END AS motivo,
      CASE r.tipo
        WHEN 'aniversario' THEN
          extract(year from age(v_hoje, c.data_nascimento))::text || ' anos'
        WHEN 'profissao' THEN
          (SELECT d.rotulo FROM datas_profissao d
            WHERE (d.workspace_id = r.workspace_id OR d.workspace_id IS NULL)
              AND (d.chave = normaliza_texto(c.profissao)
                   OR normaliza_texto(c.profissao) = ANY(d.apelidos))
              AND d.dia = extract(day   from v_hoje)::int
              AND d.mes = extract(month from v_hoje)::int
            ORDER BY d.workspace_id NULLS LAST LIMIT 1)
        ELSE
          extract(year from age(v_hoje, c.cliente_desde))::text || ' ano(s) de casa'
      END AS detalhe
  ) m ON true
  WHERE c.workspace_id = r.workspace_id
    AND coalesce(c.is_simulation, false) = false
    AND c.phone IS NOT NULL AND c.phone <> ''
    AND (
      CASE r.tipo
        WHEN 'aniversario' THEN
          c.data_nascimento IS NOT NULL
          AND (
            (extract(day from c.data_nascimento) = extract(day from v_hoje)
             AND extract(month from c.data_nascimento) = extract(month from v_hoje))
            OR (extract(month from c.data_nascimento) = 2
                AND extract(day from c.data_nascimento) = 29
                AND extract(month from v_hoje) = 2 AND extract(day from v_hoje) = 28
                AND NOT (v_ano % 4 = 0 AND (v_ano % 100 <> 0 OR v_ano % 400 = 0)))
          )
        WHEN 'profissao' THEN
          c.profissao IS NOT NULL AND c.profissao <> ''
          AND (r.profissao_chave IS NULL
               OR r.profissao_chave = normaliza_texto(c.profissao))
          AND m.detalhe IS NOT NULL
        ELSE
          c.cliente_desde IS NOT NULL
          AND extract(day   from c.cliente_desde) = extract(day   from v_hoje)
          AND extract(month from c.cliente_desde) = extract(month from v_hoje)
          AND c.cliente_desde < v_hoje
      END
    )
    AND NOT EXISTS (
      SELECT 1 FROM relationship_sends s
       WHERE s.rule_id = r.id AND s.contact_id = c.id AND s.ano = v_ano
         AND s.status <> 'falhou'
    );
END $$;

REVOKE ALL ON FUNCTION relacionamento_alvos(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION relacionamento_alvos(uuid, date) TO authenticated, service_role;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_ws uuid; v_rule uuid; v_n integer; v_emp text;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__teste_vars__', 'TSTVAR') RETURNING id INTO v_ws;
  INSERT INTO inbox_contacts (workspace_id, name, phone, empresa, data_nascimento)
    VALUES (v_ws, 'Maria Aparecida Santos', '5511900000301', 'Fazenda Sao Joao',
            (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '32 years');
  INSERT INTO relationship_rules (workspace_id, name, tipo, status)
    VALUES (v_ws, 'teste', 'aniversario', 'active') RETURNING id INTO v_rule;

  SELECT count(*), max(empresa) INTO v_n, v_emp FROM relacionamento_alvos(v_rule);
  IF v_n <> 1        THEN RAISE EXCEPTION 'esperava 1 alvo, veio %', v_n; END IF;
  IF v_emp IS NULL   THEN RAISE EXCEPTION 'empresa nao voltou na consulta de alvos'; END IF;

  -- A restrição precisa barrar lista absurda vinda de fora da tela.
  BEGIN
    UPDATE relationship_rules
       SET variaveis = (SELECT jsonb_agg(jsonb_build_object('origem','detalhe'))
                          FROM generate_series(1, 11))
     WHERE id = v_rule;
    RAISE EXCEPTION 'restricao nao barrou 11 variaveis';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'variaveis de relacionamento: 3 asseveracoes passaram';
END $$;
