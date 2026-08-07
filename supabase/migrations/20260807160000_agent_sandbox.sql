-- Ambiente de teste para os agentes de IA.
--
-- Hoje só dá para exercitar um agente mandando mensagem de WhatsApp de verdade
-- para um número conectado: custa dinheiro por mensagem, exige um número de
-- teste e, se o agente estiver mal configurado, quem recebe a resposta errada é
-- um cliente real.
--
-- Pior: as decisões de roteamento da triagem só existem em console.log da edge
-- function. Os dois casos de falha mais comuns —
--
--   "setor X não encontrado"                (o prompt cita um setor inexistente)
--   "nenhum agente ativo para o setor X"    (o setor existe mas está sem agente)
--
-- — são invisíveis para quem configura. O agente simplesmente não roteia, sem
-- dizer por quê.
--
-- Esta migration cria o que falta para conversar com o agente sem WhatsApp e
-- ver o motivo de cada decisão.

-- ── 1. Marcar o que é simulação ──────────────────────────────────────
-- Sem isso a conversa de teste apareceria no Inbox junto das reais e o contato
-- fictício entraria na base de Contatos — e, pior, em campanha de disparo.

ALTER TABLE inbox_conversations
  ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false;

ALTER TABLE inbox_contacts
  ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false;

-- As telas filtram por is_simulation = false; o índice parcial serve ao caso
-- oposto (listar só as simuladas), que é o da tela de teste.
CREATE INDEX IF NOT EXISTS idx_inbox_conversations_simulacao
  ON inbox_conversations (workspace_id, updated_at DESC)
  WHERE is_simulation;

CREATE INDEX IF NOT EXISTS idx_inbox_contacts_simulacao
  ON inbox_contacts (workspace_id)
  WHERE is_simulation;

-- ── 2. Rastro das decisões ───────────────────────────────────────────
-- Tabela própria, e não audit_logs: isto é dado de depuração, some em dias, e
-- misturar com a trilha de auditoria (que tem retenção de 12 meses e valor
-- probatório) atrapalharia as duas coisas.

CREATE TABLE IF NOT EXISTS agent_trace_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id uuid        NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
  -- Passo do fluxo. Texto livre de propósito: uma etapa nova no agente não
  -- deve exigir migration para poder ser registrada.
  step            text        NOT NULL,
  detail          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_trace_conversa
  ON agent_trace_events (conversation_id, created_at);

ALTER TABLE agent_trace_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_trace_membros ON agent_trace_events;
CREATE POLICY agent_trace_membros ON agent_trace_events
  FOR SELECT USING (workspace_id IN (SELECT get_my_workspace_ids()));
-- Só leitura pelo app: quem escreve é a edge function, com service role. Assim
-- o rastro não pode ser forjado pelo navegador.

-- Rastro velho não serve para nada e a tabela cresce a cada teste.
-- Entra na purga diária que já roda no pg_cron.
CREATE OR REPLACE FUNCTION purge_observability_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_webhook bigint; v_debug bigint; v_audit bigint; v_rate bigint; v_trace bigint;
BEGIN
  DELETE FROM webhook_events  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_webhook = ROW_COUNT;

  DELETE FROM z_api_debug_log WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_debug = ROW_COUNT;

  DELETE FROM audit_logs      WHERE created_at < now() - interval '12 months';
  GET DIAGNOSTICS v_audit = ROW_COUNT;

  -- Janelas de rate limit são de minutos; 1 dia é folga de sobra.
  DELETE FROM rate_limit_hits WHERE created_at < now() - interval '1 day';
  GET DIAGNOSTICS v_rate = ROW_COUNT;

  DELETE FROM agent_trace_events WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS v_trace = ROW_COUNT;

  RAISE LOG 'purge_observability_logs: webhook=% debug=% audit=% rate=% trace=%',
    v_webhook, v_debug, v_audit, v_rate, v_trace;
END;
$$;
