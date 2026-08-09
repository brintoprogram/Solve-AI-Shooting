-- Agenda o relationship-ticker.
--
-- Como migration, e não criado à mão no editor SQL. Os outros três jobs desta
-- base foram criados na mão: funcionam, mas o repositório não os descreve, não
-- vão junto num restore e um ambiente novo nasce sem eles. Este não repete isso.
--
-- De hora em hora, no minuto 5: fora do minuto 0, onde os outros tickers e os
-- jobs do próprio Postgres se acumulam.
--
-- A função decide sozinha se é a hora certa de cada regra — comparando a hora
-- de São Paulo com o send_hour. O cron só a acorda; a regra de negócio não mora
-- no agendamento.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  v_url   text := 'https://emmtsjbpnavlzzspzcmt.supabase.co/functions/v1/relationship-ticker';
  v_chave text;
BEGIN
  -- A service role key vive numa configuração do banco, não escrita aqui: uma
  -- chave em migration fica no git para sempre, inclusive depois de rotacionada.
  SELECT current_setting('app.settings.service_role_key', true) INTO v_chave;

  PERFORM cron.unschedule('relationship-ticker')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'relationship-ticker');

  PERFORM cron.schedule(
    'relationship-ticker',
    '5 * * * *',
    format(
      $cmd$SELECT net.http_post(
             url     := %L,
             headers := jsonb_build_object(
               'Content-Type', 'application/json',
               'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')),
             body    := '{}'::jsonb
           );$cmd$,
      v_url)
  );

  IF coalesce(v_chave, '') = '' THEN
    -- Não falha a migration: o job fica agendado e passa a funcionar assim que
    -- a chave for definida. Falhar aqui deixaria o agendamento inexistente, que
    -- é pior — ninguém lembra de voltar.
    RAISE WARNING 'app.settings.service_role_key nao definido: o ticker sera rejeitado ate rodar '
                  'ALTER DATABASE postgres SET app.settings.service_role_key = ''<chave>'';';
  END IF;
END $$;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE v_sched text; v_ativo boolean;
BEGIN
  SELECT schedule, active INTO v_sched, v_ativo
    FROM cron.job WHERE jobname = 'relationship-ticker';

  IF v_sched IS NULL THEN RAISE EXCEPTION 'job relationship-ticker nao foi agendado'; END IF;
  IF v_sched <> '5 * * * *' THEN RAISE EXCEPTION 'agenda inesperada: %', v_sched; END IF;
  IF NOT v_ativo THEN RAISE EXCEPTION 'job agendado mas inativo'; END IF;

  RAISE LOG 'relationship-ticker agendado: % (ativo)', v_sched;
END $$;
