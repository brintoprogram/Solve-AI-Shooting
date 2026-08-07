-- Auditoria da administração de créditos.
--
-- Duas falhas do que eu tinha escrito antes, as duas encontradas ao revisar o
-- requisito de "auditável":
--
-- 1. add_credits gravava created_by = auth.uid(). Mas ela é chamada pela edge
--    function com SERVICE ROLE, onde auth.uid() é NULL. O campo "quem lançou" —
--    o coração da auditoria — nunca foi preenchido. O único rastro do autor era
--    o e-mail concatenado num texto livre, que ninguém consegue consultar.
--
-- 2. A alteração de custo e do liga/desliga da cobrança não registrava NADA.
--    Essa é a pior das duas: zerar custo_ia, ou desligar cobranca_ativa, torna
--    tudo gratuito — e era uma mudança silenciosa, sem antes/depois, sem autor,
--    sem data. Justamente a operação que mais precisa de rastro.
--
-- Aqui as duas viram registro obrigatório, e o autor passa a ser um parâmetro
-- explícito em vez de depender de um contexto de sessão que não existe.

-- ── Trilha de administração ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_admin_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        REFERENCES workspaces(id) ON DELETE SET NULL,
  -- 'recarga' | 'ajuste_custo' | 'ajuste_cobranca' | 'acesso_negado'
  acao          text        NOT NULL,
  ator_id       uuid,
  -- E-mail guardado como texto: se o usuário for removido, o rastro sobrevive.
  -- Trilha que some junto com o autor não serve como trilha.
  ator_email    text        NOT NULL,
  antes         jsonb,
  depois        jsonb,
  detalhe       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_admin_log_data
  ON credit_admin_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_admin_log_workspace
  ON credit_admin_log (workspace_id, created_at DESC);

ALTER TABLE credit_admin_log ENABLE ROW LEVEL SECURITY;
-- Sem policy: nem o admin do workspace lê. É trilha da plataforma, exposta só
-- pela edge function a quem o secret autoriza. Uma trilha que o auditado pode
-- ler é meio caminho para uma trilha que ele aprende a evitar.

-- ── Recarga, agora com autor de verdade ──────────────────────────────
DROP FUNCTION IF EXISTS add_credits(uuid, integer, text);

CREATE OR REPLACE FUNCTION add_credits(
  p_workspace_id uuid,
  p_quantidade   integer,
  p_motivo       text,
  p_ator_id      uuid,
  p_ator_email   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_antes integer;
  v_saldo integer;
BEGIN
  IF p_quantidade = 0 THEN
    RAISE EXCEPTION 'quantidade nao pode ser zero';
  END IF;
  -- Autor é obrigatório: sem ele o lançamento não é auditável, e um lançamento
  -- de crédito sem autor não deveria existir.
  IF p_ator_email IS NULL OR btrim(p_ator_email) = '' THEN
    RAISE EXCEPTION 'ator_email e obrigatorio';
  END IF;

  INSERT INTO workspace_credits (workspace_id)
  VALUES (p_workspace_id) ON CONFLICT (workspace_id) DO NOTHING;

  SELECT saldo INTO v_antes FROM workspace_credits
   WHERE workspace_id = p_workspace_id FOR UPDATE;

  UPDATE workspace_credits
     SET saldo = greatest(0, saldo + p_quantidade), updated_at = now()
   WHERE workspace_id = p_workspace_id
   RETURNING saldo INTO v_saldo;

  INSERT INTO credit_ledger (workspace_id, delta, saldo_apos, tipo, detalhe, created_by)
  VALUES (p_workspace_id, p_quantidade, v_saldo,
          CASE WHEN p_quantidade > 0 THEN 'recarga' ELSE 'ajuste' END,
          jsonb_build_object('motivo', p_motivo, 'ator', p_ator_email),
          p_ator_id);

  INSERT INTO credit_admin_log (workspace_id, acao, ator_id, ator_email, antes, depois, detalhe)
  VALUES (p_workspace_id, 'recarga', p_ator_id, p_ator_email,
          jsonb_build_object('saldo', v_antes),
          jsonb_build_object('saldo', v_saldo),
          jsonb_build_object('quantidade', p_quantidade, 'motivo', p_motivo));

  RETURN jsonb_build_object('saldo', v_saldo, 'antes', v_antes);
END;
$$;

REVOKE ALL ON FUNCTION add_credits(uuid, integer, text, uuid, text) FROM public, anon, authenticated;

-- ── Configuração, agora registrada ───────────────────────────────────
CREATE OR REPLACE FUNCTION set_credit_config(
  p_workspace_id   uuid,
  p_custo_mensagem integer,
  p_custo_ia       integer,
  p_cobranca_ativa boolean,
  p_ator_id        uuid,
  p_ator_email     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_antes  jsonb;
  v_depois jsonb;
  v_cm integer; v_ci integer; v_ca boolean;
BEGIN
  IF p_ator_email IS NULL OR btrim(p_ator_email) = '' THEN
    RAISE EXCEPTION 'ator_email e obrigatorio';
  END IF;

  INSERT INTO workspace_credits (workspace_id)
  VALUES (p_workspace_id) ON CONFLICT (workspace_id) DO NOTHING;

  SELECT custo_mensagem, custo_ia, cobranca_ativa
    INTO v_cm, v_ci, v_ca
    FROM workspace_credits
   WHERE workspace_id = p_workspace_id FOR UPDATE;

  v_antes := jsonb_build_object('custo_mensagem', v_cm, 'custo_ia', v_ci, 'cobranca_ativa', v_ca);

  -- NULL = não mexer neste campo.
  v_cm := coalesce(p_custo_mensagem, v_cm);
  v_ci := coalesce(p_custo_ia,       v_ci);
  v_ca := coalesce(p_cobranca_ativa, v_ca);

  IF v_cm < 0 OR v_ci < 0 THEN
    RAISE EXCEPTION 'custo nao pode ser negativo';
  END IF;

  UPDATE workspace_credits
     SET custo_mensagem = v_cm, custo_ia = v_ci, cobranca_ativa = v_ca, updated_at = now()
   WHERE workspace_id = p_workspace_id;

  v_depois := jsonb_build_object('custo_mensagem', v_cm, 'custo_ia', v_ci, 'cobranca_ativa', v_ca);

  -- Só registra se algo mudou de fato: trilha cheia de linha idêntica é trilha
  -- que ninguém lê.
  IF v_antes <> v_depois THEN
    INSERT INTO credit_admin_log (workspace_id, acao, ator_id, ator_email, antes, depois)
    VALUES (p_workspace_id,
            CASE WHEN (v_antes->>'cobranca_ativa') <> (v_depois->>'cobranca_ativa')
                 THEN 'ajuste_cobranca' ELSE 'ajuste_custo' END,
            p_ator_id, p_ator_email, v_antes, v_depois);
  END IF;

  RETURN v_depois;
END;
$$;

REVOKE ALL ON FUNCTION set_credit_config(uuid, integer, integer, boolean, uuid, text) FROM public, anon, authenticated;

-- ── Registrar tentativa negada ───────────────────────────────────────
-- Quem tentou administrar crédito e não podia é informação de segurança: um
-- padrão de tentativas é o primeiro sinal de conta comprometida.
CREATE OR REPLACE FUNCTION log_credit_access_denied(
  p_ator_id    uuid,
  p_ator_email text,
  p_detalhe    jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO credit_admin_log (acao, ator_id, ator_email, detalhe)
  VALUES ('acesso_negado', p_ator_id, coalesce(p_ator_email, 'desconhecido'), p_detalhe);
$$;

REVOKE ALL ON FUNCTION log_credit_access_denied(uuid, text, jsonb) FROM public, anon, authenticated;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_ws uuid; v_r jsonb; v_n integer;
BEGIN
  INSERT INTO workspaces (name) VALUES ('__teste_auditoria__') RETURNING id INTO v_ws;

  -- recarga registra autor
  PERFORM add_credits(v_ws, 500, 'teste', NULL, 'auditor@teste');
  SELECT count(*) INTO v_n FROM credit_admin_log
   WHERE workspace_id = v_ws AND acao = 'recarga' AND ator_email = 'auditor@teste';
  IF v_n <> 1 THEN RAISE EXCEPTION 'recarga deveria gerar 1 registro, veio %', v_n; END IF;

  -- recarga sem autor e recusada
  BEGIN
    PERFORM add_credits(v_ws, 10, 'teste', NULL, '');
    RAISE EXCEPTION 'deveria ter recusado recarga sem autor';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ator_email%' THEN RAISE; END IF;
  END;

  -- ajuste registra antes e depois
  v_r := set_credit_config(v_ws, NULL, 7, NULL, NULL, 'auditor@teste');
  IF (v_r->>'custo_ia')::int <> 7 THEN RAISE EXCEPTION 'custo_ia deveria virar 7, veio %', v_r; END IF;
  SELECT count(*) INTO v_n FROM credit_admin_log
   WHERE workspace_id = v_ws AND acao = 'ajuste_custo'
     AND (antes->>'custo_ia') = '3' AND (depois->>'custo_ia') = '7';
  IF v_n <> 1 THEN RAISE EXCEPTION 'ajuste deveria registrar antes/depois, veio %', v_n; END IF;

  -- desligar cobranca e classificado a parte
  PERFORM set_credit_config(v_ws, NULL, NULL, false, NULL, 'auditor@teste');
  SELECT count(*) INTO v_n FROM credit_admin_log
   WHERE workspace_id = v_ws AND acao = 'ajuste_cobranca';
  IF v_n <> 1 THEN RAISE EXCEPTION 'desligar cobranca deveria ter acao propria, veio %', v_n; END IF;

  -- ajuste que nao muda nada nao polui a trilha
  PERFORM set_credit_config(v_ws, NULL, 7, NULL, NULL, 'auditor@teste');
  SELECT count(*) INTO v_n FROM credit_admin_log WHERE workspace_id = v_ws;
  IF v_n <> 3 THEN RAISE EXCEPTION 'ajuste sem mudanca nao deveria registrar; total %', v_n; END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'teste de auditoria de creditos: 5 verificacoes passaram';
END $$;
