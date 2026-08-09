-- Dados de teste de relacionamento — SOMENTE no workspace demo.
--
-- O alvo é encontrado pelo código DEMOSOLVEAI, não por UUID escrito à mão: um
-- UUID copiado errado aqui preencheria data de nascimento em contato de cliente
-- real, e o próximo disparo mandaria "parabéns" para quem está sendo cobrado.
--
-- Idempotente: rodar de novo não duplica nem embaralha, porque a distribuição
-- vem da ordem estável do id, não de random().

DO $$
DECLARE
  v_ws        uuid;
  v_hoje      date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_n         integer;
  v_profs     text[] := ARRAY['Administrador','Médico','Contador','Advogado','Engenheiro',
                              'Professor','Psicólogo','Nutricionista','Vendedor','ADMINISTRAÇÃO'];
BEGIN
  SELECT id INTO v_ws FROM workspaces WHERE codigo = 'DEMOSOLVEAI';
  IF v_ws IS NULL THEN
    RAISE WARNING 'workspace DEMOSOLVEAI nao encontrado — nada semeado';
    RETURN;
  END IF;

  -- ── Aniversários ───────────────────────────────────────────────────
  -- Espalhados nos próximos 30 dias para a prévia da tela ter o que mostrar,
  -- e três HOJE para dar teste imediato do ticker.
  WITH ordenados AS (
    SELECT id, row_number() OVER (ORDER BY id) AS n
      FROM inbox_contacts
     WHERE workspace_id = v_ws AND coalesce(is_simulation, false) = false
  )
  UPDATE inbox_contacts c
     SET data_nascimento =
           CASE
             WHEN o.n <= 3  THEN v_hoje - (20 + o.n) * interval '1 year'
             WHEN o.n <= 20 THEN v_hoje + ((o.n - 3) * interval '1 day') - (25 + o.n) * interval '1 year'
             ELSE NULL
           END
    FROM ordenados o
   WHERE c.id = o.id AND o.n <= 20;

  -- ── Profissões ─────────────────────────────────────────────────────
  -- Inclui 'ADMINISTRAÇÃO' em caixa alta e com acento de propósito: é o caso
  -- que prova a normalização, e o que mais aparece em planilha de cliente.
  WITH ordenados AS (
    SELECT id, row_number() OVER (ORDER BY id) AS n
      FROM inbox_contacts
     WHERE workspace_id = v_ws AND coalesce(is_simulation, false) = false
  )
  UPDATE inbox_contacts c
     SET profissao = v_profs[1 + ((o.n - 1) % array_length(v_profs, 1))]
    FROM ordenados o
   WHERE c.id = o.id AND o.n <= 25;

  -- Uma profissão sem data cadastrada, para a tela provar que sinaliza a lacuna.
  UPDATE inbox_contacts
     SET profissao = 'Domador de Leões'
   WHERE id = (SELECT id FROM inbox_contacts
                WHERE workspace_id = v_ws AND coalesce(is_simulation,false) = false
                ORDER BY id DESC LIMIT 1);

  -- ── Tempo de casa ──────────────────────────────────────────────────
  WITH ordenados AS (
    SELECT id, row_number() OVER (ORDER BY id) AS n
      FROM inbox_contacts
     WHERE workspace_id = v_ws AND coalesce(is_simulation, false) = false
  )
  UPDATE inbox_contacts c
     SET cliente_desde = CASE WHEN o.n <= 2 THEN v_hoje - interval '2 years'
                              ELSE v_hoje - ((o.n * 11) || ' days')::interval - interval '1 year' END
    FROM ordenados o
   WHERE c.id = o.id AND o.n <= 15;

  -- ── Crédito para o teste ───────────────────────────────────────────
  -- Todo workspace nasce com saldo zero, então sem isto o ticker recusaria
  -- tudo por falta de crédito e o teste não provaria nada sobre o envio.
  PERFORM add_credits(v_ws, 500, 'teste de relacionamento', NULL, 'seed@demo');

  SELECT count(*) INTO v_n FROM inbox_contacts
   WHERE workspace_id = v_ws AND data_nascimento IS NOT NULL;
  RAISE LOG 'demo semeado: % contatos com aniversario', v_n;
END $$;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_ws uuid; v_hoje integer; v_prof integer; v_lacuna integer; v_saldo integer;
BEGIN
  SELECT id INTO v_ws FROM workspaces WHERE codigo = 'DEMOSOLVEAI';
  IF v_ws IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_hoje FROM inbox_contacts
   WHERE workspace_id = v_ws
     AND extract(day   from data_nascimento) = extract(day   from (now() AT TIME ZONE 'America/Sao_Paulo')::date)
     AND extract(month from data_nascimento) = extract(month from (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF v_hoje < 3 THEN RAISE EXCEPTION 'esperava ao menos 3 aniversariantes hoje, veio %', v_hoje; END IF;

  SELECT com_profissao, profissao_sem_data INTO v_prof, v_lacuna
    FROM relacionamento_saude(v_ws);
  IF v_prof < 20  THEN RAISE EXCEPTION 'poucas profissoes semeadas: %', v_prof; END IF;
  IF v_lacuna < 1 THEN RAISE EXCEPTION 'faltou a profissao sem data, que a tela precisa sinalizar'; END IF;

  SELECT saldo INTO v_saldo FROM workspace_credits WHERE workspace_id = v_ws;
  IF coalesce(v_saldo, 0) < 100 THEN RAISE EXCEPTION 'saldo insuficiente para o teste: %', v_saldo; END IF;

  RAISE LOG 'demo: % aniversariantes hoje, % com profissao, % sem data, saldo %',
            v_hoje, v_prof, v_lacuna, v_saldo;
END $$;
