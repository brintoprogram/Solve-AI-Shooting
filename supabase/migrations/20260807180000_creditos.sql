-- Créditos por workspace.
--
-- Modelo escolhido:
--   · a unidade cobrada é a JANELA DE 24H por contato e canal, igual ao jeito
--     que a própria Meta cobra — assim o custo e a receita andam juntos em vez
--     de divergirem conforme o tamanho da conversa
--   · saldo único; a IA consome do mesmo saldo, com custo maior
--   · saldo zerado BLOQUEIA o envio
--   · recarga manual, por um admin
--
-- Uma sutileza que o modelo de janela expõe: a janela cobre a MENSAGEM, mas não
-- cobre o custo do LLM. Tokens são pagos por chamada, não por conversa — então
-- a IA debita a cada invocação, inclusive dentro de uma janela já aberta. Se
-- fosse coberta pela janela, uma conversa longa com IA sairia de graça para o
-- cliente e cara para você.

-- ── Saldo ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_credits (
  workspace_id    uuid        PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  saldo           integer     NOT NULL DEFAULT 0,
  -- Custos configuráveis por workspace: um cliente pode ter acordo diferente
  -- sem precisar de deploy.
  custo_mensagem  integer     NOT NULL DEFAULT 1,
  custo_ia        integer     NOT NULL DEFAULT 3,
  -- Desliga a cobrança para um workspace específico (o de demonstração, o seu
  -- próprio). Sem isso, testar o produto consumiria crédito de verdade.
  cobranca_ativa  boolean     NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saldo_nao_negativo CHECK (saldo >= 0)
);

-- ── Extrato ──────────────────────────────────────────────────────────
-- Toda movimentação, para você poder responder "por que gastou tanto?" e para
-- o cliente poder conferir. Sem isto, o saldo é um número sem história.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Negativo = consumo, positivo = recarga.
  delta         integer     NOT NULL,
  saldo_apos    integer     NOT NULL,
  tipo          text        NOT NULL,   -- 'mensagem' | 'ia' | 'recarga' | 'ajuste'
  canal         text,                   -- 'whatsapp' | 'email' | null
  contact_id    uuid        REFERENCES inbox_contacts(id) ON DELETE SET NULL,
  detalhe       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Quem lançou, nas recargas e ajustes manuais.
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_workspace
  ON credit_ledger (workspace_id, created_at DESC);

-- ── Janelas de 24h ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_windows (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id    uuid        NOT NULL REFERENCES inbox_contacts(id) ON DELETE CASCADE,
  -- Canais são cobrados em separado: falar por WhatsApp e por e-mail com a
  -- mesma pessoa são dois contatos, e custam dois.
  canal         text        NOT NULL,
  aberta_em     timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz NOT NULL
);

-- A consulta é sempre "existe janela viva para este contato neste canal".
CREATE INDEX IF NOT EXISTS idx_credit_windows_viva
  ON credit_windows (workspace_id, contact_id, canal, expira_em DESC);

ALTER TABLE workspace_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger     ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_windows    ENABLE ROW LEVEL SECURITY;

-- Membros LEEM o próprio saldo e extrato. Escrita é exclusiva da service role:
-- se o navegador pudesse gravar, o saldo seria decorativo.
DROP POLICY IF EXISTS creditos_leitura ON workspace_credits;
CREATE POLICY creditos_leitura ON workspace_credits
  FOR SELECT USING (workspace_id IN (SELECT get_my_workspace_ids()));

DROP POLICY IF EXISTS extrato_leitura ON credit_ledger;
CREATE POLICY extrato_leitura ON credit_ledger
  FOR SELECT USING (workspace_id IN (SELECT get_my_workspace_ids()));
-- credit_windows fica sem policy: é mecânica interna, ninguém precisa ver.

-- ═════════════════════════════════════════════════════════════════════
-- Consumo
-- ═════════════════════════════════════════════════════════════════════
-- Tudo numa transação só, com a linha do saldo travada.
--
-- Por que o lock importa: sem ele, duas mensagens saindo ao mesmo tempo com 1
-- crédito restante leem "saldo = 1", ambas aprovam, e o saldo vai a -1. Num
-- disparo em massa isso não é hipótese remota — é o caso normal, com dezenas de
-- envios simultâneos.

CREATE OR REPLACE FUNCTION consume_credit(
  p_workspace_id uuid,
  p_tipo         text,                    -- 'mensagem' | 'ia'
  p_contact_id   uuid    DEFAULT NULL,
  p_canal        text    DEFAULT NULL,
  p_detalhe      jsonb   DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo    integer;
  v_custo    integer;
  v_ativa    boolean;
  v_c_msg    integer;
  v_c_ia     integer;
  v_janela   uuid;
BEGIN
  -- Cria a linha de saldo na primeira vez, para o workspace novo não falhar.
  INSERT INTO workspace_credits (workspace_id)
  VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO NOTHING;

  SELECT saldo, cobranca_ativa, custo_mensagem, custo_ia
    INTO v_saldo, v_ativa, v_c_msg, v_c_ia
    FROM workspace_credits
   WHERE workspace_id = p_workspace_id
     FOR UPDATE;                          -- serializa os concorrentes aqui

  IF NOT v_ativa THEN
    RETURN jsonb_build_object('permitido', true, 'cobrado', 0,
                              'motivo', 'cobranca_desativada', 'saldo', v_saldo);
  END IF;

  -- ── Janela viva cobre a mensagem ──
  IF p_tipo = 'mensagem' AND p_contact_id IS NOT NULL THEN
    SELECT id INTO v_janela
      FROM credit_windows
     WHERE workspace_id = p_workspace_id
       AND contact_id   = p_contact_id
       AND canal        = coalesce(p_canal, 'whatsapp')
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
  VALUES (p_workspace_id, -v_custo, v_saldo - v_custo, p_tipo, p_canal, p_contact_id, p_detalhe);

  -- Abre a janela só depois de o débito passar.
  IF p_tipo = 'mensagem' AND p_contact_id IS NOT NULL THEN
    INSERT INTO credit_windows (workspace_id, contact_id, canal, expira_em)
    VALUES (p_workspace_id, p_contact_id, coalesce(p_canal, 'whatsapp'), now() + interval '24 hours');
  END IF;

  RETURN jsonb_build_object('permitido', true, 'cobrado', v_custo,
                            'motivo', 'debitado', 'saldo', v_saldo - v_custo);
END;
$$;

REVOKE ALL ON FUNCTION consume_credit(uuid, text, uuid, text, jsonb) FROM public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════
-- Recarga manual
-- ═════════════════════════════════════════════════════════════════════
-- SECURITY INVOKER de propósito: quem chama precisa ter passado pela checagem
-- de permissão na edge function. Uma função DEFINER aqui deixaria qualquer
-- membro creditar o próprio workspace.

CREATE OR REPLACE FUNCTION add_credits(
  p_workspace_id uuid,
  p_quantidade   integer,
  p_motivo       text DEFAULT 'recarga'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_saldo integer;
BEGIN
  IF p_quantidade = 0 THEN
    RAISE EXCEPTION 'quantidade nao pode ser zero';
  END IF;

  INSERT INTO workspace_credits (workspace_id)
  VALUES (p_workspace_id) ON CONFLICT (workspace_id) DO NOTHING;

  UPDATE workspace_credits
     SET saldo = greatest(0, saldo + p_quantidade), updated_at = now()
   WHERE workspace_id = p_workspace_id
   RETURNING saldo INTO v_saldo;

  INSERT INTO credit_ledger (workspace_id, delta, saldo_apos, tipo, detalhe, created_by)
  VALUES (p_workspace_id, p_quantidade, v_saldo,
          CASE WHEN p_quantidade > 0 THEN 'recarga' ELSE 'ajuste' END,
          jsonb_build_object('motivo', p_motivo), auth.uid());

  RETURN jsonb_build_object('saldo', v_saldo);
END;
$$;

REVOKE ALL ON FUNCTION add_credits(uuid, integer, text) FROM public, anon, authenticated;

-- Janela expirada não serve para nada. Entra na purga diária.
CREATE OR REPLACE FUNCTION purge_observability_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_webhook bigint; v_debug bigint; v_audit bigint; v_rate bigint;
  v_trace bigint; v_janela bigint;
BEGIN
  DELETE FROM webhook_events  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_webhook = ROW_COUNT;

  DELETE FROM z_api_debug_log WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_debug = ROW_COUNT;

  DELETE FROM audit_logs      WHERE created_at < now() - interval '12 months';
  GET DIAGNOSTICS v_audit = ROW_COUNT;

  DELETE FROM rate_limit_hits WHERE created_at < now() - interval '1 day';
  GET DIAGNOSTICS v_rate = ROW_COUNT;

  DELETE FROM agent_trace_events WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS v_trace = ROW_COUNT;

  -- Guarda 7 dias além do vencimento: útil para conferir uma cobrança recente.
  DELETE FROM credit_windows WHERE expira_em < now() - interval '7 days';
  GET DIAGNOSTICS v_janela = ROW_COUNT;

  RAISE LOG 'purge_observability_logs: webhook=% debug=% audit=% rate=% trace=% janela=%',
    v_webhook, v_debug, v_audit, v_rate, v_trace, v_janela;
END;
$$;
