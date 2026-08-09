-- Motor de mensagens de relacionamento.
--
-- Estrutura própria em vez de estender automation_rules: aquele motor é casado
-- com fatura (automation_recipients carrega invoice_id, vencimento, valor,
-- codigo_barras) e dispara por deslocamento em dias a partir do vencimento.
-- Aqui a data é anual e recorrente e não existe fatura. Reaproveitar teria
-- custado colunas nulas nas duas tabelas e um `if tipo` espalhado pelo ticker.

CREATE TABLE IF NOT EXISTS relationship_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('aniversario','profissao','cliente_desde')),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused')),

  -- Hora LOCAL (America/Sao_Paulo), não UTC. Parabéns às 6 da manhã é pior que
  -- parabéns nenhum, e é o que aconteceria comparando com a hora do servidor.
  send_hour     integer NOT NULL DEFAULT 9 CHECK (send_hour BETWEEN 0 AND 23),

  canal         text NOT NULL DEFAULT 'meta' CHECK (canal IN ('meta','z_api')),
  meta_connection_id  uuid REFERENCES meta_connections(id)  ON DELETE SET NULL,
  z_api_connection_id uuid REFERENCES z_api_connections(id) ON DELETE SET NULL,

  -- Pela via Meta a mensagem é sempre template: aniversário chega a quem não
  -- fala com você há meses, ou seja, fora da janela de 24h. Texto livre ali é
  -- recusado pela Meta, não pelo sistema.
  meta_template_id uuid,
  message_body     text,

  -- Só para tipo='profissao'. NULL = todas as profissões que tiverem data hoje.
  profissao_chave  text,

  enviados      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS relationship_rules_ws  ON relationship_rules (workspace_id);
CREATE INDEX IF NOT EXISTS relationship_rules_ativa ON relationship_rules (status, send_hour) WHERE status = 'active';

-- ── Log e idempotência ───────────────────────────────────────────────
-- O ticker roda de hora em hora e pode repetir por retentativa. A única
-- garantia real de "um por ano por pessoa" é o índice único abaixo — contar no
-- código sempre perde para duas execuções concorrentes.
CREATE TABLE IF NOT EXISTS relationship_sends (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id      uuid NOT NULL REFERENCES relationship_rules(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES inbox_contacts(id) ON DELETE CASCADE,
  ano          integer NOT NULL,
  status       text NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado','falhou','sem_credito')),
  wamid        text,
  erro         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS relationship_sends_uma_por_ano
  ON relationship_sends (rule_id, contact_id, ano);
CREATE INDEX IF NOT EXISTS relationship_sends_ws ON relationship_sends (workspace_id, created_at DESC);

ALTER TABLE relationship_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rel_rules_ws ON relationship_rules;
CREATE POLICY rel_rules_ws ON relationship_rules
  FOR ALL USING (is_workspace_member(workspace_id))
          WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS rel_sends_ws ON relationship_sends;
CREATE POLICY rel_sends_ws ON relationship_sends
  FOR SELECT USING (is_workspace_member(workspace_id));

-- ── Quem recebe hoje ─────────────────────────────────────────────────
-- p_data permite simular outro dia — é o que alimenta a prévia dos próximos
-- 30 dias na tela. Sem isso o usuário só descobre o volume quando ele sai.
CREATE OR REPLACE FUNCTION relacionamento_alvos(p_rule_id uuid, p_data date DEFAULT NULL)
RETURNS TABLE (
  contact_id uuid,
  nome       text,
  telefone   text,
  motivo     text,
  detalhe    text
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

  -- Data no fuso de São Paulo, não do servidor. Entre 21h e meia-noite a data
  -- UTC já virou, e o aniversário sairia um dia antes.
  v_hoje := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_ano  := extract(year from v_hoje)::integer;

  RETURN QUERY
  SELECT c.id, c.name, c.phone, m.motivo, m.detalhe
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
            -- Data do próprio workspace ganha da global: é a correção dele.
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
            -- Nascido em 29/02: em ano não bissexto comemora no dia 28.
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
          -- No dia em que virou cliente não faz "1 ano". Só a partir do primeiro.
          AND c.cliente_desde < v_hoje
      END
    )
    -- Já recebeu esta regra neste ano: não repete.
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
  v_ws uuid; v_rule uuid; v_c1 uuid; v_c2 uuid; v_n integer;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__teste_relacionamento__', 'TSTREL')
    RETURNING id INTO v_ws;

  -- Aniversariante de hoje e alguém de outro dia.
  INSERT INTO inbox_contacts (workspace_id, name, phone, data_nascimento)
    VALUES (v_ws, 'Faz Hoje', '5511900000101',
            (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '30 years')
    RETURNING id INTO v_c1;
  INSERT INTO inbox_contacts (workspace_id, name, phone, data_nascimento)
    VALUES (v_ws, 'Outro Dia', '5511900000102',
            (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '30 years' + interval '3 days')
    RETURNING id INTO v_c2;

  INSERT INTO relationship_rules (workspace_id, name, tipo, status)
    VALUES (v_ws, 'teste', 'aniversario', 'active') RETURNING id INTO v_rule;

  SELECT count(*) INTO v_n FROM relacionamento_alvos(v_rule);
  IF v_n <> 1 THEN RAISE EXCEPTION 'esperava 1 aniversariante hoje, veio %', v_n; END IF;

  -- Registrado o envio, não pode voltar no mesmo ano.
  INSERT INTO relationship_sends (rule_id, workspace_id, contact_id, ano)
    VALUES (v_rule, v_ws, v_c1, extract(year from (now() AT TIME ZONE 'America/Sao_Paulo')::date)::int);

  SELECT count(*) INTO v_n FROM relacionamento_alvos(v_rule);
  IF v_n <> 0 THEN RAISE EXCEPTION 'repetiu no mesmo ano: % alvos', v_n; END IF;

  -- Índice único é a garantia real contra duplicidade concorrente.
  BEGIN
    INSERT INTO relationship_sends (rule_id, workspace_id, contact_id, ano)
      VALUES (v_rule, v_ws, v_c1, extract(year from now())::int);
    RAISE EXCEPTION 'indice unico nao impediu envio duplicado';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- A prévia de outro dia enxerga o do futuro.
  SELECT count(*) INTO v_n FROM relacionamento_alvos(
    v_rule, (now() AT TIME ZONE 'America/Sao_Paulo')::date + 3);
  IF v_n <> 1 THEN RAISE EXCEPTION 'previa de 3 dias deveria achar 1, veio %', v_n; END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'relacionamento: 4 asseveracoes passaram';
END $$;
