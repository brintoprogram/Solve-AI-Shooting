-- Corrige a chave da janela de 24h: destino normalizado, não contact_id.
--
-- O desenho anterior chaveava a janela em contact_id. Ao ligar o consumo nas
-- campanhas, apareceu o furo: shooting_messages não tem contact_id — o disparo
-- vai para telefones de uma planilha, que podem nem ser contatos cadastrados.
--
-- Pior que não funcionar nas campanhas: chavear por contato COBRARIA DUAS VEZES
-- a mesma pessoa. Alcançada pela campanha (sem contact_id) e depois respondida
-- pelo Inbox (com contact_id), seriam duas janelas para o que a Meta cobra como
-- uma conversa só. O erro seria a favor de quem cobra, o que é pior ainda —
-- ninguém reclama, e a conta do cliente infla em silêncio.
--
-- A chave passa a ser o destino normalizado. Assim campanha e Inbox para a
-- mesma pessoa dentro de 24h são um crédito, que é o que a Meta cobra.
--
-- A normalização importa: "5511999998888" e "11999998888" são o MESMO número
-- gravado em formatos diferentes (a base tem os dois, como já vimos nos
-- contatos duplicados). Sem normalizar, seriam duas janelas — o mesmo bug de
-- duplicação de antes, agora custando dinheiro.

-- ── Normalizador, espelho do phoneKey() do frontend ──────────────────
CREATE OR REPLACE FUNCTION normaliza_destino(p_destino text, p_canal text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_canal = 'email' THEN lower(btrim(p_destino))
    ELSE (
      -- só dígitos; tira o 55 quando sobra um número brasileiro válido
      WITH d AS (SELECT regexp_replace(coalesce(p_destino, ''), '\D', '', 'g') AS n)
      SELECT CASE
               WHEN n LIKE '55%' AND length(n) IN (12, 13) THEN substr(n, 3)
               ELSE n
             END
        FROM d
    )
  END;
$$;

-- ── Nova coluna ──────────────────────────────────────────────────────
ALTER TABLE credit_windows
  ADD COLUMN IF NOT EXISTS destino text;

-- Migra o que já existe (só os testes, na prática) para não deixar linha órfã.
UPDATE credit_windows w
   SET destino = normaliza_destino(c.phone, w.canal)
  FROM inbox_contacts c
 WHERE c.id = w.contact_id
   AND w.destino IS NULL;

DELETE FROM credit_windows WHERE destino IS NULL;

ALTER TABLE credit_windows
  ALTER COLUMN destino SET NOT NULL,
  ALTER COLUMN contact_id DROP NOT NULL;   -- vira só referência, pode faltar

DROP INDEX IF EXISTS idx_credit_windows_viva;
CREATE INDEX IF NOT EXISTS idx_credit_windows_destino
  ON credit_windows (workspace_id, destino, canal, expira_em DESC);

-- ── Consumo, agora por destino ───────────────────────────────────────
DROP FUNCTION IF EXISTS consume_credit(uuid, text, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION consume_credit(
  p_workspace_id uuid,
  p_tipo         text,                    -- 'mensagem' | 'ia'
  p_destino      text    DEFAULT NULL,    -- telefone ou e-mail do cliente
  p_canal        text    DEFAULT NULL,
  p_contact_id   uuid    DEFAULT NULL,    -- só para o extrato, quando existir
  p_detalhe      jsonb   DEFAULT '{}'::jsonb
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

  v_custo := CASE WHEN p_tipo = 'ia' THEN v_c_ia ELSE v_c_msg END;

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
          p_detalhe || jsonb_build_object('destino', v_dest));

  IF p_tipo = 'mensagem' AND v_dest IS NOT NULL AND v_dest <> '' THEN
    INSERT INTO credit_windows (workspace_id, contact_id, destino, canal, expira_em)
    VALUES (p_workspace_id, p_contact_id, v_dest, v_canal, now() + interval '24 hours');
  END IF;

  RETURN jsonb_build_object('permitido', true, 'cobrado', v_custo,
                            'motivo', 'debitado', 'saldo', v_saldo - v_custo);
END;
$$;

REVOKE ALL ON FUNCTION consume_credit(uuid, text, text, text, uuid, jsonb) FROM public, anon, authenticated;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_ws uuid;
  v_r  jsonb;
BEGIN
  INSERT INTO workspaces (name) VALUES ('__teste_destino__') RETURNING id INTO v_ws;
  PERFORM add_credits(v_ws, 10, 'teste');

  -- campanha alcanca o numero COM codigo do pais
  v_r := consume_credit(v_ws, 'mensagem', '5511999998888', 'whatsapp');
  IF (v_r->>'cobrado')::int <> 1 THEN
    RAISE EXCEPTION 'primeira mensagem deveria cobrar, veio %', v_r;
  END IF;

  -- Inbox responde a mesma pessoa, gravada SEM o codigo do pais.
  -- Tem que cair na mesma janela: e a mesma conversa para a Meta.
  v_r := consume_credit(v_ws, 'mensagem', '11999998888', 'whatsapp');
  IF (v_r->>'motivo') <> 'janela_aberta' THEN
    RAISE EXCEPTION 'formato diferente do mesmo numero deveria reusar a janela, veio %', v_r;
  END IF;

  -- e-mail para a mesma pessoa e outro canal, cobra
  v_r := consume_credit(v_ws, 'mensagem', 'Cliente@Exemplo.COM', 'email');
  IF (v_r->>'cobrado')::int <> 1 THEN
    RAISE EXCEPTION 'email deveria abrir janela propria, veio %', v_r;
  END IF;

  -- e-mail em caixa diferente e o mesmo destino
  v_r := consume_credit(v_ws, 'mensagem', 'cliente@exemplo.com', 'email');
  IF (v_r->>'motivo') <> 'janela_aberta' THEN
    RAISE EXCEPTION 'email deveria ser case-insensitive, veio %', v_r;
  END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'teste de janela por destino: 4 verificacoes passaram';
END $$;
