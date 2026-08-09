-- Previsão dos próximos dias e saúde dos dados.
--
-- A previsão existe para responder a pergunta que só aparece depois do
-- estrago: "quantas mensagens isso vai disparar, e quanto vai custar?".
-- Uma regra de aniversário numa base de 50 mil contatos manda ~137 por dia,
-- todo dia, para sempre. Melhor ver antes de ligar.

CREATE OR REPLACE FUNCTION relacionamento_previsao(p_rule_id uuid, p_dias integer DEFAULT 30)
RETURNS TABLE (dia date, total bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d::date,
         (SELECT count(*) FROM relacionamento_alvos(p_rule_id, d::date))
  FROM generate_series(
         (now() AT TIME ZONE 'America/Sao_Paulo')::date,
         (now() AT TIME ZONE 'America/Sao_Paulo')::date
           + (least(greatest(coalesce(p_dias, 30), 1), 90) - 1),
         interval '1 day') d;
$$;

-- Quanto da base está preenchida. Sem isto o usuário liga a regra, não sai
-- nada, e conclui que o sistema está quebrado — quando na verdade a coluna
-- está vazia. É o primeiro número que a tela precisa mostrar.
CREATE OR REPLACE FUNCTION relacionamento_saude(p_workspace_id uuid)
RETURNS TABLE (
  contatos            bigint,
  com_nascimento      bigint,
  com_profissao       bigint,
  profissao_sem_data  bigint,
  com_cliente_desde   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE c.data_nascimento IS NOT NULL),
    count(*) FILTER (WHERE c.profissao IS NOT NULL AND c.profissao <> ''),
    -- Profissão preenchida que não casa com nenhuma data cadastrada: some do
    -- disparo sem erro nenhum. É a falha silenciosa que a tela precisa expor.
    count(*) FILTER (
      WHERE c.profissao IS NOT NULL AND c.profissao <> ''
        AND NOT EXISTS (
          SELECT 1 FROM datas_profissao d
           WHERE (d.workspace_id = p_workspace_id OR d.workspace_id IS NULL)
             AND (d.chave = normaliza_texto(c.profissao)
                  OR normaliza_texto(c.profissao) = ANY(d.apelidos)))),
    count(*) FILTER (WHERE c.cliente_desde IS NOT NULL)
  FROM inbox_contacts c
  WHERE c.workspace_id = p_workspace_id
    AND coalesce(c.is_simulation, false) = false;
$$;

-- Quais profissões existem na base e se têm data. Alimenta a tela de datas:
-- cadastrar "Dia do Zootecnista" só faz sentido se houver zootecnista ali.
CREATE OR REPLACE FUNCTION relacionamento_profissoes(p_workspace_id uuid)
RETURNS TABLE (profissao text, contatos bigint, rotulo text, dia integer, mes integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.profissao, count(*), d.rotulo, d.dia, d.mes
  FROM inbox_contacts c
  LEFT JOIN LATERAL (
    SELECT x.rotulo, x.dia, x.mes FROM datas_profissao x
     WHERE (x.workspace_id = p_workspace_id OR x.workspace_id IS NULL)
       AND (x.chave = normaliza_texto(c.profissao)
            OR normaliza_texto(c.profissao) = ANY(x.apelidos))
     ORDER BY x.workspace_id NULLS LAST LIMIT 1
  ) d ON true
  WHERE c.workspace_id = p_workspace_id
    AND coalesce(c.is_simulation, false) = false
    AND c.profissao IS NOT NULL AND c.profissao <> ''
  GROUP BY c.profissao, d.rotulo, d.dia, d.mes
  ORDER BY count(*) DESC;
$$;

REVOKE ALL ON FUNCTION relacionamento_previsao(uuid, integer)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION relacionamento_saude(uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION relacionamento_profissoes(uuid)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION relacionamento_previsao(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION relacionamento_saude(uuid)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION relacionamento_profissoes(uuid)        TO authenticated, service_role;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE v_ws uuid; v_rule uuid; v_n integer; v_soma bigint;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__teste_previsao__', 'TSTPRV')
    RETURNING id INTO v_ws;

  -- Um aniversário hoje, um daqui a 5 dias, um fora da janela de 30.
  INSERT INTO inbox_contacts (workspace_id, name, phone, data_nascimento) VALUES
    (v_ws, 'Hoje',  '5511900000201', (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '40 years'),
    (v_ws, 'Em 5',  '5511900000202', (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '40 years' + interval '5 days'),
    (v_ws, 'Em 60', '5511900000203', (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '40 years' + interval '60 days');

  INSERT INTO relationship_rules (workspace_id, name, tipo, status)
    VALUES (v_ws, 'teste', 'aniversario', 'active') RETURNING id INTO v_rule;

  SELECT count(*), sum(total) INTO v_n, v_soma FROM relacionamento_previsao(v_rule, 30);
  IF v_n <> 30 THEN RAISE EXCEPTION 'previsao deveria ter 30 dias, veio %', v_n; END IF;
  IF v_soma <> 2 THEN RAISE EXCEPTION 'previsao de 30 dias deveria somar 2, veio %', v_soma; END IF;

  -- Profissão sem data cadastrada tem que aparecer como lacuna.
  UPDATE inbox_contacts SET profissao = 'Domador de Leões' WHERE workspace_id = v_ws AND name = 'Hoje';
  SELECT profissao_sem_data INTO v_soma FROM relacionamento_saude(v_ws);
  IF v_soma <> 1 THEN RAISE EXCEPTION 'profissao sem data deveria ser 1, veio %', v_soma; END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'previsao de relacionamento: 3 asseveracoes passaram';
END $$;
