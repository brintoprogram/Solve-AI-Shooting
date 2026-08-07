-- Teste da mecânica de créditos, executado uma vez na aplicação.
--
-- Não é migration de schema: é uma verificação. Crédito é dinheiro, e as três
-- propriedades abaixo precisam valer antes de qualquer envio real depender
-- delas. Se alguma falhar, a migration aborta e nada fica meio aplicado.
--
--   1. a janela de 24h cobra uma vez e cobre as mensagens seguintes
--   2. IA debita mesmo dentro de janela aberta (token é por chamada)
--   3. saldo insuficiente bloqueia, e não deixa o saldo negativo
--
-- Tudo roda sobre um workspace descartável, removido no fim.

DO $$
DECLARE
  v_ws       uuid;
  v_contato  uuid;
  v_r        jsonb;
  v_saldo    integer;
BEGIN
  INSERT INTO workspaces (name) VALUES ('__teste_creditos__') RETURNING id INTO v_ws;
  INSERT INTO inbox_contacts (workspace_id, phone, name)
  VALUES (v_ws, '5599000000001', 'teste') RETURNING id INTO v_contato;

  PERFORM add_credits(v_ws, 10, 'teste');

  -- ── 1. primeira mensagem cobra ──
  v_r := consume_credit(v_ws, 'mensagem', v_contato, 'whatsapp');
  IF (v_r->>'cobrado')::int <> 1 OR (v_r->>'motivo') <> 'debitado' THEN
    RAISE EXCEPTION 'esperado debito de 1 na primeira mensagem, veio %', v_r;
  END IF;

  -- ── 2. segunda mensagem no mesmo contato NAO cobra (janela viva) ──
  v_r := consume_credit(v_ws, 'mensagem', v_contato, 'whatsapp');
  IF (v_r->>'cobrado')::int <> 0 OR (v_r->>'motivo') <> 'janela_aberta' THEN
    RAISE EXCEPTION 'segunda mensagem deveria estar coberta pela janela, veio %', v_r;
  END IF;

  -- ── 3. outro canal para o MESMO contato cobra de novo ──
  v_r := consume_credit(v_ws, 'mensagem', v_contato, 'email');
  IF (v_r->>'cobrado')::int <> 1 THEN
    RAISE EXCEPTION 'canal diferente deveria abrir janela propria, veio %', v_r;
  END IF;

  -- ── 4. IA cobra mesmo com janela aberta ──
  v_r := consume_credit(v_ws, 'ia', v_contato, 'whatsapp');
  IF (v_r->>'cobrado')::int <> 3 THEN
    RAISE EXCEPTION 'IA deveria custar 3 mesmo com janela aberta, veio %', v_r;
  END IF;

  -- Gastou 1 + 0 + 1 + 3 = 5 dos 10.
  SELECT saldo INTO v_saldo FROM workspace_credits WHERE workspace_id = v_ws;
  IF v_saldo <> 5 THEN
    RAISE EXCEPTION 'saldo esperado 5, veio %', v_saldo;
  END IF;

  -- ── 5. saldo insuficiente bloqueia ──
  PERFORM add_credits(v_ws, -4, 'teste');       -- sobra 1
  v_r := consume_credit(v_ws, 'ia', v_contato, 'whatsapp');   -- custa 3
  IF (v_r->>'permitido')::boolean <> false OR (v_r->>'motivo') <> 'saldo_insuficiente' THEN
    RAISE EXCEPTION 'deveria bloquear por saldo insuficiente, veio %', v_r;
  END IF;

  SELECT saldo INTO v_saldo FROM workspace_credits WHERE workspace_id = v_ws;
  IF v_saldo <> 1 THEN
    RAISE EXCEPTION 'bloqueio nao pode alterar o saldo; esperado 1, veio %', v_saldo;
  END IF;

  -- ── 6. cobranca desativada nao debita ──
  UPDATE workspace_credits SET cobranca_ativa = false WHERE workspace_id = v_ws;
  v_r := consume_credit(v_ws, 'ia', v_contato, 'whatsapp');
  IF (v_r->>'permitido')::boolean <> true OR (v_r->>'cobrado')::int <> 0 THEN
    RAISE EXCEPTION 'com cobranca desativada deveria passar sem debitar, veio %', v_r;
  END IF;

  DELETE FROM workspaces WHERE id = v_ws;   -- cascata limpa o resto
  RAISE LOG 'teste de creditos: 6 verificacoes passaram';
END $$;
