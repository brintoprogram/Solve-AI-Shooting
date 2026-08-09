-- Ajusta demo_atualizar() depois de ver o resultado da primeira versão.
--
-- Dois problemas que só apareceram rodando:
--
-- 1. Deslocamento único para tudo preserva a distância relativa — correto para
--    uma conversa, errado entre blocos. As campanhas eram 2 meses mais velhas
--    que as mensagens, então continuaram 2 meses velhas: "última campanha em
--    28/05" numa reunião de agosto. Agora cada bloco (inbox, campanhas) tem seu
--    próprio deslocamento, e a coerência interna de cada um é mantida.
--
-- 2. 47 faturas vencidas contra 2 a vencer. É tecnicamente um dado, mas lê como
--    carteira morta. Vencimento agora é redistribuído numa curva realista:
--    atrasadas, vencendo hoje, e futuras.

CREATE OR REPLACE FUNCTION demo_atualizar()
RETURNS TABLE (item text, resultado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws     uuid;
  v_nome   text;
  v_delta  interval;
  v_par    text[];
  v_col    text;
  v_n      integer;
  v_hoje   date;

  -- Bloco do inbox: conversas e mensagens andam juntas.
  v_inbox  text[][] := ARRAY[
    ['inbox_messages',      'created_at,sent_at,delivered_at,read_at,failed_at'],
    ['inbox_conversations', 'created_at,updated_at,last_message_at'],
    ['inbox_contacts',      'first_seen_at,last_seen_at,wa_checked_at'],
    ['contact_notes',       'created_at'],
    ['debt_negotiations',   'created_at,updated_at,agreed_at'],
    ['negotiation_offers',  'created_at']
  ];
  -- Bloco das campanhas: disparo, mensagens do disparo e alertas de resposta.
  v_camp   text[][] := ARRAY[
    ['shooting_campaigns',  'created_at,updated_at,scheduled_at,started_at,completed_at'],
    ['shooting_messages',   'created_at,sent_at,delivered_at,read_at,replied_at,failed_at'],
    ['campaign_alerts',     'created_at,read_at,analyzed_at']
  ];
BEGIN
  SELECT id, name INTO v_ws, v_nome FROM workspaces WHERE codigo = 'DEMOSOLVEAI';
  IF v_ws IS NULL THEN
    RETURN QUERY SELECT 'erro'::text, 'workspace DEMOSOLVEAI nao encontrado'::text; RETURN;
  END IF;
  IF position('demo' in lower(v_nome)) = 0 THEN
    RETURN QUERY SELECT 'erro'::text,
      format('recusado: o workspace %L nao parece ser de demonstracao', v_nome); RETURN;
  END IF;

  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  -- ── Inbox: última mensagem há 12 minutos ───────────────────────────
  -- Doze e não zero: exatamente "agora" parece dado plantado na frente do
  -- cliente. Doze minutos lê como conversa que acabou de acontecer.
  SELECT (now() - interval '12 minutes') - max(created_at)
    INTO v_delta FROM inbox_messages WHERE workspace_id = v_ws;

  IF v_delta IS NOT NULL AND v_delta > interval '5 minutes' THEN
    FOREACH v_par SLICE 1 IN ARRAY v_inbox LOOP
      FOREACH v_col IN ARRAY string_to_array(v_par[2], ',') LOOP
        -- Comparação por texto: contact_notes.workspace_id é `text` enquanto
        -- todo o resto do schema usa `uuid`.
        EXECUTE format(
          'UPDATE %I SET %I = %I + %L::interval WHERE workspace_id::text = %L AND %I IS NOT NULL',
          v_par[1], v_col, v_col, v_delta, v_ws::text, v_col);
      END LOOP;
    END LOOP;
    RETURN QUERY SELECT 'inbox'::text,
      format('deslocado %s dias — ultima mensagem ha 12 min', (extract(epoch from v_delta)/86400)::int);
  ELSE
    RETURN QUERY SELECT 'inbox'::text, 'ja estava atual'::text;
  END IF;

  -- ── Campanhas: a mais recente há 2 dias ────────────────────────────
  -- Deslocamento próprio. Com o do inbox, campanha de maio continuaria de maio.
  SELECT (now() - interval '2 days') - max(created_at)
    INTO v_delta FROM shooting_campaigns WHERE workspace_id = v_ws;

  IF v_delta IS NOT NULL AND v_delta > interval '1 hour' THEN
    FOREACH v_par SLICE 1 IN ARRAY v_camp LOOP
      FOREACH v_col IN ARRAY string_to_array(v_par[2], ',') LOOP
        EXECUTE format(
          'UPDATE %I SET %I = %I + %L::interval WHERE workspace_id::text = %L AND %I IS NOT NULL',
          v_par[1], v_col, v_col, v_delta, v_ws::text, v_col);
      END LOOP;
    END LOOP;
    RETURN QUERY SELECT 'campanhas'::text,
      format('deslocadas %s dias — a mais recente ha 2 dias', (extract(epoch from v_delta)/86400)::int);
  ELSE
    RETURN QUERY SELECT 'campanhas'::text, 'ja estavam atuais'::text;
  END IF;

  -- ── Faturas: carteira viva, não cemitério ──────────────────────────
  -- 47 vencidas contra 2 a vencer é tecnicamente um dado e lê como base morta.
  -- A curva abaixo cobre a régua inteira de cobrança: quem já passou de 30
  -- dias, quem vence hoje, e quem ainda vai vencer.
  WITH ordenadas AS (
    SELECT id, row_number() OVER (ORDER BY id) AS n,
           count(*) OVER () AS total
      FROM contact_invoices WHERE workspace_id = v_ws
  )
  UPDATE contact_invoices i
     SET vencimento = v_hoje + (CASE
           WHEN o.n % 10 IN (0, 1) THEN  (o.n % 40) + 5      -- a vencer, 5 a 45 dias
           WHEN o.n % 10 = 2       THEN  0                    -- vence hoje
           WHEN o.n % 10 IN (3, 4) THEN -((o.n % 5) + 1)      -- 1 a 5 dias de atraso
           WHEN o.n % 10 IN (5, 6) THEN -((o.n % 20) + 6)     -- 6 a 25 dias
           ELSE                         -((o.n % 60) + 26)    -- mais de 26 dias
         END || ' days')::interval
    FROM ordenadas o
   WHERE i.id = o.id;

  SELECT count(*) INTO v_n FROM contact_invoices
   WHERE workspace_id = v_ws AND vencimento >= v_hoje;
  RETURN QUERY SELECT 'faturas'::text, format('%s a vencer, %s em atraso',
    v_n, (SELECT count(*) FROM contact_invoices WHERE workspace_id = v_ws AND vencimento < v_hoje));

  -- ── Agentes de IA ──────────────────────────────────────────────────
  INSERT INTO ai_agents (workspace_id, name, is_triage, is_active, model, department_id, system_prompt)
  SELECT v_ws, 'Triagem', true, true, 'claude-haiku-4-5-20251001', NULL,
         'Você faz a triagem do primeiro contato. Leia a mensagem e escolha o setor: '
         'Cobrança para boleto, dívida, pagamento e negociação; Financeiro para nota fiscal, '
         'reembolso e comprovante; Jurídico quando houver menção a advogado, processo ou '
         'Procon; Atendimento Geral para o resto. Não converse: apenas roteie.'
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
             format('Você atende o setor %s. Responda de forma objetiva e cordial. Quando não '
                    'souber, diga que vai verificar e passe para um atendente.', d.name)
         END
    FROM departments d
   WHERE d.workspace_id = v_ws
     AND NOT EXISTS (SELECT 1 FROM ai_agents a WHERE a.workspace_id = v_ws AND a.department_id = d.id);

  UPDATE ai_agents SET is_active = true WHERE workspace_id = v_ws AND NOT is_active;
  SELECT count(*) INTO v_n FROM ai_agents WHERE workspace_id = v_ws AND is_active;
  RETURN QUERY SELECT 'agentes de IA'::text, format('%s ativos', v_n);

  -- ── Extrato de crédito ─────────────────────────────────────────────
  DELETE FROM credit_ledger WHERE workspace_id = v_ws;
  INSERT INTO credit_ledger (workspace_id, delta, saldo_apos, tipo, canal, detalhe, created_at)
  SELECT v_ws, m.delta, 2000 + sum(m.delta) OVER (ORDER BY m.quando),
         m.tipo, m.canal, m.detalhe, m.quando
    FROM (
      SELECT 2000 AS delta, 'recarga' AS tipo, NULL::text AS canal,
             '{"origem":"contrato mensal"}'::jsonb AS detalhe, now() - interval '30 days' AS quando
      UNION ALL SELECT -1, 'mensagem', 'whatsapp', '{"origem":"campanha"}'::jsonb,
             now() - (random() * interval '29 days') FROM generate_series(1, 120)
      UNION ALL SELECT -3, 'ia', 'whatsapp', '{"origem":"agente","etapa":"triagem"}'::jsonb,
             now() - (random() * interval '29 days') FROM generate_series(1, 45)
      UNION ALL SELECT -1, 'mensagem', 'email', '{"origem":"campanha de e-mail"}'::jsonb,
             now() - (random() * interval '29 days') FROM generate_series(1, 25)
    ) m;

  UPDATE workspace_credits
     SET saldo = (SELECT 2000 + coalesce(sum(delta),0) FROM credit_ledger WHERE workspace_id = v_ws),
         updated_at = now()
   WHERE workspace_id = v_ws;

  SELECT count(*) INTO v_n FROM credit_ledger WHERE workspace_id = v_ws;
  RETURN QUERY SELECT 'extrato de credito'::text, format('%s lancamentos em 30 dias', v_n);

  -- ── Aniversários reancorados no dia de hoje ────────────────────────
  WITH ordenados AS (
    SELECT id, row_number() OVER (ORDER BY id) AS n
      FROM inbox_contacts WHERE workspace_id = v_ws AND coalesce(is_simulation,false) = false
  )
  UPDATE inbox_contacts c
     SET data_nascimento = CASE
           WHEN o.n <= 3 THEN v_hoje - (20 + o.n) * interval '1 year'
           ELSE v_hoje + ((o.n - 3) * interval '1 day') - (25 + o.n) * interval '1 year'
         END
    FROM ordenados o
   WHERE c.id = o.id AND o.n <= 20;

  RETURN QUERY SELECT 'aniversarios'::text, '20 contatos, 3 fazem hoje'::text;
END $$;

REVOKE ALL ON FUNCTION demo_atualizar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION demo_atualizar() TO authenticated, service_role;

-- ── Executa e verifica ───────────────────────────────────────────────
DO $$
DECLARE r record; BEGIN
  FOR r IN SELECT * FROM demo_atualizar() LOOP
    RAISE LOG 'demo — %: %', r.item, r.resultado;
    IF r.item = 'erro' THEN RAISE EXCEPTION '%', r.resultado; END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  v_ws uuid; v_msg interval; v_camp interval; v_ok integer; v_vencer integer;
BEGIN
  SELECT id INTO v_ws FROM workspaces WHERE codigo = 'DEMOSOLVEAI';

  SELECT now() - max(created_at) INTO v_msg  FROM inbox_messages     WHERE workspace_id = v_ws;
  SELECT now() - max(created_at) INTO v_camp FROM shooting_campaigns WHERE workspace_id = v_ws;

  IF v_msg  > interval '1 hour' THEN RAISE EXCEPTION 'inbox parado: ultima msg ha %', v_msg; END IF;
  IF v_camp > interval '4 days' THEN RAISE EXCEPTION 'campanha velha: ultima ha %', v_camp; END IF;

  SELECT count(*) INTO v_vencer FROM contact_invoices
   WHERE workspace_id = v_ws AND vencimento >= (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  IF v_vencer < 8 THEN RAISE EXCEPTION 'poucas faturas a vencer (%): a carteira lê como morta', v_vencer; END IF;

  SELECT count(*) INTO v_ok FROM ai_agents WHERE workspace_id = v_ws AND is_active;
  IF v_ok < 4 THEN RAISE EXCEPTION 'poucos agentes ativos: %', v_ok; END IF;

  RAISE LOG 'demo v2: 4 asseveracoes passaram';
END $$;
