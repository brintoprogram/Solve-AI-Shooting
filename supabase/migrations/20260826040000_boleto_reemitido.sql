-- Boleto reemitido passa a atualizar, em vez de ser descartado.
--
-- A identidade de um boleto é o código de barras ou, na falta dele, o número
-- da nota dentro daquele contato. A regra existe por um bom motivo: sem ela,
-- subir a mesma planilha duas vezes dobrava a dívida do cliente.
--
-- Mas ela ignora o VENCIMENTO. E em cobrança o caso mais comum não é a
-- reimportação idêntica — é o boleto reemitido: mesma nota, valor igual ou
-- corrigido, vencimento novo. Esse boleto era tratado como duplicata e
-- descartado, então o vencimento novo nunca entrava. O saldo do cliente ficava
-- certo e a data ficava velha, que é a pior combinação: a régua de cobrança
-- passa a mirar um vencimento que já não existe.
--
-- Foi assim que R$ 69.893,19 de uma planilha de 528 linhas não apareceram no
-- filtro por período: os boletos estavam na base, com o vencimento antigo.
--
-- Agora a linha repetida ATUALIZA o boleto existente. Continua não duplicando,
-- e passa a corrigir. Para o desfazer funcionar, o estado anterior é guardado.

ALTER TABLE import_run_items DROP CONSTRAINT IF EXISTS import_run_items_tipo_check;
ALTER TABLE import_run_items ADD CONSTRAINT import_run_items_tipo_check
  CHECK (tipo IN ('contato_criado', 'contato_atualizado', 'boleto_criado', 'boleto_atualizado'));

-- ── Desfazer também devolve boleto atualizado ────────────────────────
CREATE OR REPLACE FUNCTION desfazer_importacao(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $desfaz$
DECLARE
  v_run       import_runs%ROWTYPE;
  v_boletos   integer := 0;
  v_bol_volta integer := 0;
  v_voltaram  integer := 0;
  v_apagados  integer := 0;
  v_mantidos  integer := 0;
  v_res       jsonb;
BEGIN
  SELECT * INTO v_run FROM import_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'importacao nao encontrada'; END IF;
  IF v_run.status = 'desfeita' THEN RAISE EXCEPTION 'esta importacao ja foi desfeita'; END IF;

  INSERT INTO import_run_logs (run_id, workspace_id, etapa, nivel, mensagem, detalhe)
  VALUES (p_run_id, v_run.workspace_id, 'desfazer', 'info', 'Desfazer iniciado',
          jsonb_build_object('arquivo', v_run.arquivo, 'linhas', v_run.linhas));

  -- 1. Boletos criados por este lote somem.
  WITH mortos AS (
    DELETE FROM contact_invoices
     WHERE id IN (SELECT boleto_id FROM import_run_items
                   WHERE run_id = p_run_id AND tipo = 'boleto_criado' AND boleto_id IS NOT NULL)
    RETURNING 1
  ) SELECT count(*) INTO v_boletos FROM mortos;

  -- 2. Boletos que já existiam e foram corrigidos voltam ao que eram. Sem
  --    isto, desfazer deixaria a base num terceiro estado: nem antes, nem
  --    depois.
  WITH voltando AS (
    UPDATE contact_invoices b SET
      valor         = COALESCE((i.antes->>'valor')::numeric, b.valor),
      vencimento    = NULLIF(i.antes->>'vencimento', '')::date,
      status        = COALESCE(i.antes->>'status', b.status),
      codigo_barras = i.antes->>'codigo_barras'
      FROM import_run_items i
     WHERE i.run_id = p_run_id AND i.tipo = 'boleto_atualizado' AND b.id = i.boleto_id
    RETURNING 1
  ) SELECT count(*) INTO v_bol_volta FROM voltando;

  -- 3. Contatos que já existiam voltam ao que eram.
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
     WHERE i.run_id = p_run_id AND i.tipo = 'contato_atualizado' AND c.id = i.contato_id
    RETURNING 1
  ) SELECT count(*) INTO v_voltaram FROM voltando;

  -- 4. Contatos criados, só os sem histórico de atendimento.
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
  ) SELECT count(*) INTO v_apagados FROM removidos;

  SELECT count(*) INTO v_mantidos
    FROM import_run_items i
   WHERE i.run_id = p_run_id AND i.tipo = 'contato_criado'
     AND EXISTS (SELECT 1 FROM inbox_contacts c WHERE c.id = i.contato_id);

  UPDATE import_runs SET status = 'desfeita', desfeita_em = now() WHERE id = p_run_id;

  v_res := jsonb_build_object(
    'boletos_removidos',    v_boletos,
    'boletos_restaurados',  v_bol_volta,
    'contatos_restaurados', v_voltaram,
    'contatos_removidos',   v_apagados,
    'contatos_mantidos',    v_mantidos
  );

  INSERT INTO import_run_logs (run_id, workspace_id, etapa, nivel, mensagem, detalhe)
  VALUES (p_run_id, v_run.workspace_id, 'desfazer',
          CASE WHEN v_mantidos > 0 THEN 'aviso' ELSE 'info' END,
          CASE WHEN v_mantidos > 0
               THEN v_mantidos || ' contato(s) mantido(s) por ja terem historico de atendimento'
               ELSE 'Desfazer concluido' END,
          v_res);

  RETURN v_res;
END
$desfaz$;

REVOKE ALL ON FUNCTION desfazer_importacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION desfazer_importacao(uuid) TO authenticated, service_role;

-- ── Verificação ──────────────────────────────────────────────────────
DO $teste$
DECLARE
  v_ws  uuid;
  v_c   uuid;
  v_b   uuid;
  v_run uuid;
  v_r   record;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__reemit__', 'REEMIT') RETURNING id INTO v_ws;
  INSERT INTO inbox_contacts (workspace_id, name, phone)
  VALUES (v_ws, 'Cliente', '5511966660001') RETURNING id INTO v_c;

  -- Boleto antigo: NF 11078, vencendo em julho.
  INSERT INTO contact_invoices (workspace_id, contact_id, valor, vencimento, numero_nf, status)
  VALUES (v_ws, v_c, 2059.80, '2026-07-09', '11078', 'pendente') RETURNING id INTO v_b;

  INSERT INTO import_runs (workspace_id, arquivo, linhas) VALUES (v_ws, 'r.xlsx', 1) RETURNING id INTO v_run;

  -- Simula o que a importacao passa a fazer: guarda o antes e corrige.
  INSERT INTO import_run_items (run_id, workspace_id, tipo, boleto_id, antes)
  SELECT v_run, v_ws, 'boleto_atualizado', b.id, to_jsonb(b) FROM contact_invoices b WHERE b.id = v_b;
  UPDATE contact_invoices SET vencimento = '2026-08-31', valor = 2100.00 WHERE id = v_b;

  SELECT * INTO v_r FROM contact_invoices WHERE id = v_b;
  IF v_r.vencimento <> '2026-08-31' THEN RAISE EXCEPTION 'nao atualizou o vencimento'; END IF;

  -- Desfazer devolve o vencimento antigo, e nao apaga o boleto.
  PERFORM desfazer_importacao(v_run);
  SELECT * INTO v_r FROM contact_invoices WHERE id = v_b;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHA GRAVE: desfazer apagou boleto que ja existia'; END IF;
  IF v_r.vencimento <> '2026-07-09' THEN RAISE EXCEPTION 'vencimento nao voltou: %', v_r.vencimento; END IF;
  IF v_r.valor <> 2059.80 THEN RAISE EXCEPTION 'valor nao voltou: %', v_r.valor; END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'boleto reemitido: atualiza e o desfazer devolve';
END
$teste$;
