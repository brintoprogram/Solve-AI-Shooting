-- Rate limiting compartilhado pelas edge functions.
--
-- Motivação: várias functions eram chamáveis sem qualquer freio. As caras são
-- as que chamam LLM (cada requisição vira fatura na OpenAI/Anthropic) e as
-- públicas que escrevem no banco a cada chamada. Sem teto, um loop de curl
-- vira conta no fim do mês.
--
-- Por que no banco e não em memória da function: cada invocação de edge
-- function pode cair numa instância diferente, então um contador em memória
-- não vê as outras. O estado precisa ser compartilhado.

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  bucket     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A consulta é sempre "quantos hits deste bucket na última janela".
CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_bucket
  ON rate_limit_hits (bucket, created_at DESC);

-- RLS ligada e SEM policy: ninguém além da service role enxerga. Os buckets
-- podem conter id de usuário/workspace, não é dado para expor ao cliente.
ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY;

-- Conta e registra na MESMA chamada. Se fossem dois roundtrips separados,
-- duas requisições simultâneas leriam o mesmo estado antigo e passariam juntas.
--
-- Quando estoura o limite NÃO insere: assim um atacante em loop não faz a
-- tabela crescer — ela fica limitada a (limite × número de buckets ativos).
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_bucket         text,
  p_limit          int,
  p_window_seconds int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used int;
BEGIN
  SELECT count(*) INTO v_used
    FROM rate_limit_hits
   WHERE bucket = p_bucket
     AND created_at > now() - make_interval(secs => p_window_seconds);

  IF v_used >= p_limit THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_used, 'limit', p_limit);
  END IF;

  INSERT INTO rate_limit_hits (bucket) VALUES (p_bucket);
  RETURN jsonb_build_object('allowed', true, 'used', v_used + 1, 'limit', p_limit);
END;
$$;

-- Só a service role (as edge functions) chama. Se o browser pudesse chamar,
-- daria para queimar a própria cota de propósito ou inflar a tabela.
REVOKE ALL ON FUNCTION check_rate_limit(text, int, int) FROM public, anon, authenticated;

-- Limpeza: hits com mais de 1 dia não servem para nenhuma janela em uso.
-- Reescreve a purga de 20260804_log_retention.sql acrescentando rate_limit_hits;
-- o resto do corpo é idêntico ao original e o agendamento no pg_cron continua
-- o mesmo (a função é substituída, o job não muda).
CREATE OR REPLACE FUNCTION purge_observability_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_webhook bigint; v_debug bigint; v_audit bigint; v_rate bigint;
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

  RAISE LOG 'purge_observability_logs: webhook=% debug=% audit=% rate=%',
    v_webhook, v_debug, v_audit, v_rate;
END;
$$;
