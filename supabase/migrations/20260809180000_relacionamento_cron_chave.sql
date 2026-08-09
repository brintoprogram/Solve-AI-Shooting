-- Reagenda o relationship-ticker com credencial que funciona.
--
-- A migration anterior fez o job ler a chave de app.settings.service_role_key,
-- que seria melhor: rotacionar viraria um comando só, e a chave não ficaria
-- legível em cron.job. Não dá — no Postgres gerenciado do Supabase o papel das
-- migrations não tem permissão para criar parâmetro `app.*`:
--
--   ERROR: permission denied to set parameter "app.settings.service_role_key"
--
-- Então segue o padrão que campaign-ticker e automation-ticker já usam: a chave
-- vai no comando do job. A diferença é que ela é COPIADA de um job existente,
-- nunca escrita aqui — chave em migration fica no git para sempre, inclusive
-- depois de rotacionada.
--
-- Consequência a saber: ao rotacionar a service role key, os três jobs precisam
-- ser reescritos. É o custo de não ter o parâmetro.

DO $$
DECLARE
  v_key text;
  v_cmd text;
BEGIN
  SELECT substring(command from 'Bearer ([A-Za-z0-9._-]+)')
    INTO v_key
    FROM cron.job
   WHERE command LIKE '%Bearer %'
     AND jobname <> 'relationship-ticker'
   LIMIT 1;

  IF coalesce(v_key, '') = '' THEN
    RAISE WARNING 'nenhum job anterior com Bearer para copiar. O relationship-ticker '
                  'continua agendado e sera rejeitado com 401 ate a credencial ser corrigida.';
    RETURN;
  END IF;

  v_cmd := format(
    'SELECT net.http_post(url := %L, headers := %L::jsonb, body := ''{}''::jsonb);',
    'https://emmtsjbpnavlzzspzcmt.supabase.co/functions/v1/relationship-ticker',
    jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    )::text
  );

  PERFORM cron.unschedule('relationship-ticker')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'relationship-ticker');

  PERFORM cron.schedule('relationship-ticker', '5 * * * *', v_cmd);
  RAISE LOG 'relationship-ticker reagendado com credencial copiada';
END $$;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE v_sched text; v_ativo boolean; v_tem_key boolean;
BEGIN
  SELECT schedule, active, command ~ 'Bearer [A-Za-z0-9._-]{100,}'
    INTO v_sched, v_ativo, v_tem_key
    FROM cron.job WHERE jobname = 'relationship-ticker';

  IF v_sched IS NULL      THEN RAISE EXCEPTION 'job nao existe'; END IF;
  IF v_sched <> '5 * * * *' THEN RAISE EXCEPTION 'agenda inesperada: %', v_sched; END IF;
  IF NOT v_ativo          THEN RAISE EXCEPTION 'job inativo'; END IF;
  IF NOT v_tem_key        THEN RAISE EXCEPTION 'job sem credencial — seria rejeitado com 401'; END IF;

  RAISE LOG 'relationship-ticker: agendado, ativo e com credencial';
END $$;
