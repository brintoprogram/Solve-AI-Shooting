-- Custo de IA proporcional ao modelo escolhido.
--
-- Ao abrir a escolha de modelo (Haiku, Sonnet, Opus), o custo fixo por chamada
-- de IA virou um problema: Opus custa muito mais por token que Haiku, e cobrar
-- o mesmo pelos dois faria o plano perder dinheiro exatamente nos workspaces
-- que mais usam o modelo caro — os que dão mais trabalho.
--
-- O multiplicador vem de quem chama (espelho de src/lib/aiModels.ts), e não de
-- uma tabela aqui: o catálogo de modelos muda com o mercado, e uma migration
-- por lançamento de modelo seria atrito sem ganho. O banco só aplica.

CREATE OR REPLACE FUNCTION consume_credit(
  p_workspace_id  uuid,
  p_tipo          text,
  p_destino       text    DEFAULT NULL,
  p_canal         text    DEFAULT NULL,
  p_contact_id    uuid    DEFAULT NULL,
  p_detalhe       jsonb   DEFAULT '{}'::jsonb,
  -- 1 = modelo econômico. Só se aplica ao tipo 'ia'; mensagem não tem modelo.
  p_multiplicador integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo   integer;
  v_custo   integer;
  v_ativa   boolean;
  v_c_msg   integer;
  v_c_ia    integer;
  v_janela  uuid;
  v_dest    text;
  v_canal   text;
  v_mult    integer;
BEGIN
  INSERT INTO workspace_credits (workspace_id)
  VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO NOTHING;

  SELECT saldo, cobranca_ativa, custo_mensagem, custo_ia
    INTO v_saldo, v_ativa, v_c_msg, v_c_ia
    FROM workspace_credits
   WHERE workspace_id = p_workspace_id
     FOR UPDATE;

  IF NOT v_ativa THEN
    RETURN jsonb_build_object('permitido', true, 'cobrado', 0,
                              'motivo', 'cobranca_desativada', 'saldo', v_saldo);
  END IF;

  v_canal := coalesce(p_canal, 'whatsapp');
  v_dest  := normaliza_destino(p_destino, v_canal);

  IF p_tipo = 'mensagem' AND v_dest IS NOT NULL AND v_dest <> '' THEN
    SELECT id INTO v_janela
      FROM credit_windows
     WHERE workspace_id = p_workspace_id
       AND destino      = v_dest
       AND canal        = v_canal
       AND expira_em    > now()
     LIMIT 1;

    IF v_janela IS NOT NULL THEN
      RETURN jsonb_build_object('permitido', true, 'cobrado', 0,
                                'motivo', 'janela_aberta', 'saldo', v_saldo);
    END IF;
  END IF;

  -- Teto no multiplicador: um valor absurdo vindo de chamador com bug nao
  -- pode zerar o saldo de um cliente numa unica chamada.
  v_mult  := least(greatest(coalesce(p_multiplicador, 1), 1), 20);
  v_custo := CASE WHEN p_tipo = 'ia' THEN v_c_ia * v_mult ELSE v_c_msg END;

  IF v_saldo < v_custo THEN
    RETURN jsonb_build_object('permitido', false, 'cobrado', 0,
                              'motivo', 'saldo_insuficiente',
                              'saldo', v_saldo, 'custo', v_custo);
  END IF;

  UPDATE workspace_credits
     SET saldo = saldo - v_custo, updated_at = now()
   WHERE workspace_id = p_workspace_id;

  INSERT INTO credit_ledger (workspace_id, delta, saldo_apos, tipo, canal, contact_id, detalhe)
  VALUES (p_workspace_id, -v_custo, v_saldo - v_custo, p_tipo, p_canal, p_contact_id,
          p_detalhe || jsonb_build_object('destino', v_dest, 'multiplicador', v_mult));

  IF p_tipo = 'mensagem' AND v_dest IS NOT NULL AND v_dest <> '' THEN
    INSERT INTO credit_windows (workspace_id, contact_id, destino, canal, expira_em)
    VALUES (p_workspace_id, p_contact_id, v_dest, v_canal, now() + interval '24 hours');
  END IF;

  RETURN jsonb_build_object('permitido', true, 'cobrado', v_custo,
                            'motivo', 'debitado', 'saldo', v_saldo - v_custo);
END;
$$;

REVOKE ALL ON FUNCTION consume_credit(uuid, text, text, text, uuid, jsonb, integer)
  FROM public, anon, authenticated;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE v_ws uuid; v_r jsonb;
BEGIN
  INSERT INTO workspaces (name) VALUES ('__teste_multiplicador__') RETURNING id INTO v_ws;
  PERFORM add_credits(v_ws, 1000, 'teste', NULL, 'setup@teste');

  -- custo_ia padrao e 3
  v_r := consume_credit(v_ws, 'ia', NULL, NULL, NULL, '{}'::jsonb, 1);
  IF (v_r->>'cobrado')::int <> 3 THEN
    RAISE EXCEPTION 'multiplicador 1 deveria cobrar 3, veio %', v_r;
  END IF;

  v_r := consume_credit(v_ws, 'ia', NULL, NULL, NULL, '{}'::jsonb, 8);
  IF (v_r->>'cobrado')::int <> 24 THEN
    RAISE EXCEPTION 'multiplicador 8 deveria cobrar 24, veio %', v_r;
  END IF;

  -- multiplicador absurdo e limitado, nao aceito
  v_r := consume_credit(v_ws, 'ia', NULL, NULL, NULL, '{}'::jsonb, 9999);
  IF (v_r->>'cobrado')::int <> 60 THEN
    RAISE EXCEPTION 'multiplicador deveria ser limitado a 20 (60 creditos), veio %', v_r;
  END IF;

  -- mensagem ignora o multiplicador: nao tem modelo
  v_r := consume_credit(v_ws, 'mensagem', '5511900000001', 'whatsapp', NULL, '{}'::jsonb, 8);
  IF (v_r->>'cobrado')::int <> 1 THEN
    RAISE EXCEPTION 'mensagem nao deveria usar multiplicador, veio %', v_r;
  END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'teste de multiplicador: 4 verificacoes passaram';
END $$;
