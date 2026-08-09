-- Demonstração viva: função que rejuvenesce o workspace demo.
--
-- O que mata uma demonstração não é falta de dado, é dado velho. Hoje o demo
-- tem 35 contatos, 28 conversas e 12 campanhas — e a última campanha é de
-- 18/05. Numa reunião de agosto isso lê como produto abandonado.
--
-- Dado semeado com data fixa envelhece sozinho. A saída é deslocar TUDO pelo
-- mesmo intervalo, preservando o espaçamento relativo: a conversa que tinha
-- três respostas com dez minutos entre elas continua tendo, só que agora
-- terminando "há 40 minutos" em vez de "em 30 de julho".
--
-- Re-executável de propósito. Rodar antes de cada reunião custa um clique.

CREATE OR REPLACE FUNCTION demo_atualizar()
RETURNS TABLE (item text, resultado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws     uuid;
  v_nome   text;
  v_ultimo timestamptz;
  v_delta  interval;
  v_par    text[];
  v_pares  text[][] := ARRAY[
    ['inbox_messages',      'created_at,sent_at,delivered_at,read_at,failed_at'],
    ['inbox_conversations', 'created_at,updated_at,last_message_at'],
    ['inbox_contacts',      'first_seen_at,last_seen_at,wa_checked_at'],
    ['shooting_campaigns',  'created_at,updated_at,scheduled_at,started_at,completed_at'],
    ['shooting_messages',   'created_at,sent_at,delivered_at,read_at,replied_at,failed_at'],
    ['campaign_alerts',     'created_at,read_at,analyzed_at'],
    ['contact_invoices',    'created_at,updated_at'],
    ['contact_notes',       'created_at'],
    ['debt_negotiations',   'created_at,updated_at,agreed_at'],
    ['negotiation_offers',  'created_at']
  ];
  v_datas  text[][] := ARRAY[
    ['contact_invoices',   'vencimento'],
    ['contact_notes',      'follow_up_date'],
    ['debt_negotiations',  'agreed_first_due_date'],
    ['negotiation_offers', 'first_due_date']
  ];
  v_col    text;
  v_n      integer;
BEGIN
  -- Guarda dupla. O código sozinho poderia ser renomeado; o nome sozinho
  -- poderia coincidir. Exigir os dois torna acidente muito improvável — e o
  -- acidente aqui seria reescrever as datas de um cliente real.
  SELECT id, name INTO v_ws, v_nome FROM workspaces WHERE codigo = 'DEMOSOLVEAI';
  IF v_ws IS NULL THEN
    RETURN QUERY SELECT 'erro'::text, 'workspace DEMOSOLVEAI nao encontrado'::text; RETURN;
  END IF;
  IF position('demo' in lower(v_nome)) = 0 THEN
    RETURN QUERY SELECT 'erro'::text,
      format('recusado: o workspace %L nao parece ser de demonstracao', v_nome); RETURN;
  END IF;

  -- Quão velho está o dado mais novo. Deslocar por este intervalo faz a última
  -- mensagem cair "agora", e todo o resto acompanha.
  SELECT greatest(
           coalesce((SELECT max(created_at)      FROM inbox_messages      WHERE workspace_id = v_ws), '-infinity'),
           coalesce((SELECT max(last_message_at) FROM inbox_conversations WHERE workspace_id = v_ws), '-infinity'),
           coalesce((SELECT max(created_at)      FROM campaign_alerts     WHERE workspace_id = v_ws), '-infinity'))
    INTO v_ultimo;

  IF v_ultimo IS NULL OR v_ultimo = '-infinity' THEN
    RETURN QUERY SELECT 'erro'::text, 'sem dado para rejuvenescer'::text; RETURN;
  END IF;

  -- Menos 12 minutos: a última mensagem fica "há 12 min", que lê como conversa
  -- viva. Exatamente "agora" parece dado plantado na frente do cliente.
  v_delta := (now() - interval '12 minutes') - v_ultimo;

  IF v_delta < interval '1 hour' THEN
    RETURN QUERY SELECT 'datas'::text, 'ja estavam atuais, nada a deslocar'::text;
  ELSE
    FOREACH v_par SLICE 1 IN ARRAY v_pares LOOP
      FOREACH v_col IN ARRAY string_to_array(v_par[2], ',') LOOP
        -- Compara por texto de propósito: contact_notes.workspace_id é `text`
        -- enquanto todo o resto do schema usa `uuid`. Forçar ::uuid aqui
        -- quebrava exatamente nessa tabela.
        EXECUTE format(
          'UPDATE %I SET %I = %I + %L::interval WHERE workspace_id::text = %L AND %I IS NOT NULL',
          v_par[1], v_col, v_col, v_delta, v_ws, v_col);
      END LOOP;
    END LOOP;

    FOREACH v_par SLICE 1 IN ARRAY v_datas LOOP
      -- Vencimento é `date`: desloca em dias inteiros, senão a fatura anda
      -- algumas horas e o "dias em atraso" da tela sai errado por um.
      EXECUTE format(
        'UPDATE %I SET %I = %I + %L::interval WHERE workspace_id::text = %L AND %I IS NOT NULL',
        v_par[1], v_par[2], v_par[2],
        ((extract(epoch from v_delta) / 86400)::integer || ' days'), v_ws, v_par[2]);
    END LOOP;

    RETURN QUERY SELECT 'datas'::text,
      format('deslocadas em %s dias', (extract(epoch from v_delta) / 86400)::integer);
  END IF;

  -- ── Agentes de IA ──────────────────────────────────────────────────
  -- Este workspace é anterior ao gatilho que semeia o agente de triagem, então
  -- não tem nenhum: a maior promessa do produto abriria vazia na reunião.
  INSERT INTO ai_agents (workspace_id, name, is_triage, is_active, model, department_id, system_prompt)
  SELECT v_ws, 'Triagem', true, true, 'claude-haiku-4-5-20251001', NULL,
         'Você faz a triagem do primeiro contato. Leia a mensagem e escolha o setor: '
         'Cobrança para assunto de boleto, dívida, pagamento e negociação; Financeiro para '
         'nota fiscal, reembolso e comprovante; Jurídico quando houver menção a advogado, '
         'processo ou Procon; Atendimento Geral para o resto. Não converse: apenas roteie.'
  WHERE NOT EXISTS (SELECT 1 FROM ai_agents WHERE workspace_id = v_ws AND is_triage);

  INSERT INTO ai_agents (workspace_id, name, is_triage, is_active, model, department_id, system_prompt)
  SELECT v_ws, 'Atendente de ' || d.name, false, true,
         CASE WHEN d.name = 'Cobrança' THEN 'claude-sonnet-5' ELSE 'claude-haiku-4-5-20251001' END,
         d.id,
         CASE d.name
           WHEN 'Cobrança' THEN
             'Você atende cobrança. Seja cordial e direto. Confirme valor e vencimento antes '
             'de falar em desconto, e nunca prometa condição fora das regras de negociação. '
             'Se o cliente pedir atendente humano, encerre e passe adiante.'
           ELSE
             format('Você atende o setor %s. Responda de forma objetiva e cordial. '
                    'Quando não souber, diga que vai verificar e passe para um atendente.', d.name)
         END
    FROM departments d
   WHERE d.workspace_id = v_ws
     AND NOT EXISTS (SELECT 1 FROM ai_agents a WHERE a.workspace_id = v_ws AND a.department_id = d.id);

  UPDATE ai_agents SET is_active = true WHERE workspace_id = v_ws AND NOT is_active;

  SELECT count(*) INTO v_n FROM ai_agents WHERE workspace_id = v_ws AND is_active;
  RETURN QUERY SELECT 'agentes de IA'::text, format('%s ativos', v_n);

  -- ── Extrato de crédito ─────────────────────────────────────────────
  -- A tela de Créditos com um lançamento só não conta história. Aqui vira um
  -- mês de consumo com a proporção que o produto realmente tem: mais mensagem
  -- que IA, e uma recarga no começo do período.
  DELETE FROM credit_ledger WHERE workspace_id = v_ws;

  INSERT INTO credit_ledger (workspace_id, delta, saldo_apos, tipo, canal, detalhe, created_at)
  SELECT v_ws, m.delta,
         2000 + sum(m.delta) OVER (ORDER BY m.quando),
         m.tipo, m.canal, m.detalhe, m.quando
    FROM (
      SELECT  2000 AS delta, 'recarga'  AS tipo, NULL::text AS canal,
              '{"origem":"contrato mensal"}'::jsonb AS detalhe,
              now() - interval '30 days' AS quando
      UNION ALL
      SELECT -1, 'mensagem', 'whatsapp', '{"origem":"campanha"}'::jsonb,
             now() - (random() * interval '29 days')
        FROM generate_series(1, 120)
      UNION ALL
      SELECT -3, 'ia', 'whatsapp', '{"origem":"agente","etapa":"triagem"}'::jsonb,
             now() - (random() * interval '29 days')
        FROM generate_series(1, 45)
      UNION ALL
      SELECT -1, 'mensagem', 'email', '{"origem":"campanha de e-mail"}'::jsonb,
             now() - (random() * interval '29 days')
        FROM generate_series(1, 25)
    ) m;

  UPDATE workspace_credits
     SET saldo = (SELECT 2000 + coalesce(sum(delta), 0) FROM credit_ledger WHERE workspace_id = v_ws),
         updated_at = now()
   WHERE workspace_id = v_ws;

  SELECT count(*) INTO v_n FROM credit_ledger WHERE workspace_id = v_ws;
  RETURN QUERY SELECT 'extrato de credito'::text, format('%s lancamentos em 30 dias', v_n);

  -- ── Aniversários ───────────────────────────────────────────────────
  -- Reancorados no dia da execução: sem isto, o "faz aniversário hoje" da
  -- semeadura anterior deixa de ser hoje já na reunião seguinte.
  WITH ordenados AS (
    SELECT id, row_number() OVER (ORDER BY id) AS n
      FROM inbox_contacts WHERE workspace_id = v_ws AND coalesce(is_simulation, false) = false
  )
  UPDATE inbox_contacts c
     SET data_nascimento = CASE
           WHEN o.n <= 3  THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date - (20 + o.n) * interval '1 year'
           ELSE (now() AT TIME ZONE 'America/Sao_Paulo')::date + ((o.n - 3) * interval '1 day') - (25 + o.n) * interval '1 year'
         END
    FROM ordenados o
   WHERE c.id = o.id AND o.n <= 20;

  RETURN QUERY SELECT 'aniversarios'::text, '20 contatos, 3 fazem hoje'::text;
END $$;

REVOKE ALL ON FUNCTION demo_atualizar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION demo_atualizar() TO authenticated, service_role;

-- ── Executa uma vez agora ────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM demo_atualizar() LOOP
    RAISE LOG 'demo_atualizar — %: %', r.item, r.resultado;
    IF r.item = 'erro' THEN RAISE EXCEPTION 'demo_atualizar falhou: %', r.resultado; END IF;
  END LOOP;
END $$;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_ws uuid; v_idade interval; v_agentes integer; v_ledger integer; v_hoje integer;
BEGIN
  SELECT id INTO v_ws FROM workspaces WHERE codigo = 'DEMOSOLVEAI';

  SELECT now() - max(created_at) INTO v_idade FROM inbox_messages WHERE workspace_id = v_ws;
  IF v_idade > interval '2 hours' THEN
    RAISE EXCEPTION 'mensagem mais nova ainda tem % — o inbox pareceria parado', v_idade;
  END IF;

  SELECT count(*) INTO v_agentes FROM ai_agents WHERE workspace_id = v_ws AND is_active;
  IF v_agentes < 4 THEN RAISE EXCEPTION 'poucos agentes ativos: %', v_agentes; END IF;

  SELECT count(*) INTO v_ledger FROM credit_ledger WHERE workspace_id = v_ws;
  IF v_ledger < 150 THEN RAISE EXCEPTION 'extrato raso demais: % lancamentos', v_ledger; END IF;

  SELECT count(*) INTO v_hoje FROM inbox_contacts
   WHERE workspace_id = v_ws
     AND extract(day   from data_nascimento) = extract(day   from (now() AT TIME ZONE 'America/Sao_Paulo')::date)
     AND extract(month from data_nascimento) = extract(month from (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF v_hoje < 3 THEN RAISE EXCEPTION 'esperava 3 aniversariantes hoje, veio %', v_hoje; END IF;

  RAISE LOG 'demo: 4 asseveracoes passaram';
END $$;
