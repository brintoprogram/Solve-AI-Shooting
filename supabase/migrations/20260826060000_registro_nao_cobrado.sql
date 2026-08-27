-- Registro do que saiu antes de o disparo por e-mail passar a cobrar.
--
-- O caminho do N8N nunca debitou crédito. Um disparo de 96 e-mails saiu com o
-- saldo intacto, e nada denunciava: sem erro, sem log, só o saldo parado. A
-- correção entrou hoje e vale daqui para frente.
--
-- A decisão sobre o passado foi deixar como está, e não debitar. Mas "deixar
-- como está" sem registro vira buraco: daqui a seis meses ninguém lembra por
-- que o consumo de e-mail começa numa data e não antes, e a única leitura
-- possível seria "o sistema perdeu lançamentos".
--
-- Então nada de saldo muda aqui. O que esta migration faz é escrever o que
-- aconteceu, de forma que possa ser conferido depois.
--
-- Fica invisível para o cliente, como credit_admin_log: é registro de uma
-- falha de cobrança nossa, não extrato dele.

CREATE TABLE IF NOT EXISTS credito_nao_cobrado (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id   uuid,
  campanha      text,
  message_id    uuid,
  destino       text,
  canal         text NOT NULL DEFAULT 'email',
  enviado_em    timestamptz,
  /* Se ESTA mensagem teria gerado cobrança, considerando a janela de 24h por
     destino. Estimado por dia-calendário: é a aproximação honesta possível
     olhando só o histórico, e está no nome da coluna para ninguém tomar por
     valor exato. */
  cobravel_estimado boolean NOT NULL DEFAULT false,
  motivo        text NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nao_cobrado_ws
  ON credito_nao_cobrado (workspace_id, enviado_em DESC);
CREATE INDEX IF NOT EXISTS idx_nao_cobrado_campanha
  ON credito_nao_cobrado (campaign_id);

COMMENT ON TABLE credito_nao_cobrado IS
  'Mensagens que sairam sem debitar credito, antes de o caminho do N8N passar a cobrar. Nao altera saldo: e registro, nao lancamento.';

ALTER TABLE credito_nao_cobrado ENABLE ROW LEVEL SECURITY;
-- Sem policy nenhuma: nem o admin do workspace enxerga. Mesma decisão de
-- credit_admin_log — isto é registro interno de cobrança.
REVOKE ALL ON credito_nao_cobrado FROM PUBLIC, anon, authenticated;

-- Registro não se reescreve. Um log de cobrança que pode ser editado depois
-- não serve para o que ele existe.
CREATE OR REPLACE FUNCTION nao_cobrado_e_imutavel()
RETURNS trigger LANGUAGE plpgsql AS $imut$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id) THEN
    RETURN OLD;   -- só morre junto com o workspace
  END IF;
  RAISE EXCEPTION 'credito_nao_cobrado e imutavel: % nao e permitido', TG_OP;
END $imut$;

DROP TRIGGER IF EXISTS trg_nao_cobrado_imutavel ON credito_nao_cobrado;
CREATE TRIGGER trg_nao_cobrado_imutavel
  BEFORE UPDATE OR DELETE ON credito_nao_cobrado
  FOR EACH ROW EXECUTE FUNCTION nao_cobrado_e_imutavel();

-- ── Levantamento ─────────────────────────────────────────────────────
DO $carga$
DECLARE
  v_saldo_antes jsonb;
  v_saldo_depois jsonb;
  v_linhas integer;
  v_cobraveis integer;
  v_ws integer;
BEGIN
  -- Fotografa os saldos ANTES. A asseveração no fim usa isto para provar que
  -- nada foi debitado — a promessa central desta migration.
  SELECT jsonb_object_agg(workspace_id::text, saldo) INTO v_saldo_antes FROM workspace_credits;

  WITH enviadas AS (
    SELECT
      c.workspace_id,
      c.id   AS campaign_id,
      c.name AS campanha,
      m.id   AS message_id,
      COALESCE(m.recipient_data->>'email', m.recipient_phone) AS destino,
      m.sent_at
    FROM shooting_messages m
    JOIN shooting_campaigns c ON c.id = m.campaign_id
    WHERE c.dispatch_channel = 'n8n_email'
      AND m.status IN ('sent', 'delivered', 'read', 'replied')
  ),
  marcadas AS (
    SELECT e.*,
           /* Primeira do destino naquele dia = a que teria cobrado. As demais
              cairiam na janela de 24h e sairiam de graça. */
           row_number() OVER (
             PARTITION BY e.workspace_id, e.destino, date_trunc('day', COALESCE(e.sent_at, now()))
             ORDER BY e.sent_at NULLS LAST
           ) = 1 AS primeira_do_dia
      FROM enviadas e
  )
  INSERT INTO credito_nao_cobrado
    (workspace_id, campaign_id, campanha, message_id, destino, canal, enviado_em, cobravel_estimado, motivo)
  SELECT workspace_id, campaign_id, campanha, message_id, destino, 'email', sent_at, primeira_do_dia,
         'disparo por e-mail via N8N anterior a 26/08/2026, quando o caminho passou a debitar credito'
    FROM marcadas
   WHERE NOT EXISTS (
     SELECT 1 FROM credito_nao_cobrado x WHERE x.message_id = marcadas.message_id
   );

  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  SELECT count(*) FILTER (WHERE cobravel_estimado), count(DISTINCT workspace_id)
    INTO v_cobraveis, v_ws
    FROM credito_nao_cobrado;

  -- ── Verificação ────────────────────────────────────────────────────
  SELECT jsonb_object_agg(workspace_id::text, saldo) INTO v_saldo_depois FROM workspace_credits;
  IF v_saldo_antes IS DISTINCT FROM v_saldo_depois THEN
    RAISE EXCEPTION 'PROMESSA QUEBRADA: algum saldo mudou. antes=% depois=%', v_saldo_antes, v_saldo_depois;
  END IF;

  IF EXISTS (SELECT 1 FROM credito_nao_cobrado WHERE destino IS NULL AND enviado_em IS NULL) THEN
    RAISE WARNING 'ha registro sem destino e sem data — auditoria incompleta nessas linhas';
  END IF;

  -- A trilha da plataforma guarda o resumo, para o numero ficar achavel sem
  -- precisar consultar a tabela nova.
  INSERT INTO credit_admin_log (acao, ator_email, detalhe)
  VALUES ('registro_nao_cobrado', 'sistema',
          jsonb_build_object(
            'mensagens_registradas', v_linhas,
            'cobraveis_estimados',   v_cobraveis,
            'workspaces',            v_ws,
            'decisao',               'nao debitar o passado; cobranca vale a partir de 26/08/2026'));

  RAISE LOG 'nao cobrado: % mensagens registradas, % cobraveis estimados, saldos intactos',
            v_linhas, v_cobraveis;
END
$carga$;
