-- Retenção das tabelas de observabilidade.
--
-- Motivo: webhook_events e z_api_debug_log guardam o payload cru dos webhooks
-- (telefone + corpo da mensagem do cliente) e audit_logs guardava telefone em
-- texto plano. Nenhuma tinha política de expurgo — o z_api_debug_log estava
-- marcado como "temporário" no código e acumulava há ~3 meses. Sob LGPD, dado
-- pessoal não pode ser retido indefinidamente sem finalidade.
--
-- Prazos:
--   webhook_events / z_api_debug_log → 30 dias (finalidade é depuração)
--   audit_logs                       → 12 meses (é trilha de auditoria)

-- Índices em created_at: sem eles o expurgo faz seq scan na tabela inteira.
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at  ON webhook_events  (created_at);
CREATE INDEX IF NOT EXISTS idx_z_api_debug_log_created_at ON z_api_debug_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at      ON audit_logs      (created_at);

CREATE OR REPLACE FUNCTION purge_observability_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_webhook  bigint;
  v_debug    bigint;
  v_audit    bigint;
BEGIN
  DELETE FROM webhook_events  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_webhook = ROW_COUNT;

  DELETE FROM z_api_debug_log WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_debug = ROW_COUNT;

  DELETE FROM audit_logs      WHERE created_at < now() - interval '12 months';
  GET DIAGNOSTICS v_audit = ROW_COUNT;

  RAISE LOG 'purge_observability_logs: webhook_events=% z_api_debug_log=% audit_logs=%',
    v_webhook, v_debug, v_audit;
END;
$$;

-- Agenda diária às 03:15 UTC (fora do horário comercial no Brasil).
SELECT cron.unschedule('purge-observability-logs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-observability-logs');

SELECT cron.schedule('purge-observability-logs', '15 3 * * *', $$SELECT purge_observability_logs()$$);
