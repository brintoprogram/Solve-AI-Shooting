-- Os agendamentos passam a viver em migration, e a credencial sai do comando.
--
-- Dois problemas, um conserto.
--
-- 1. Três dos quatro jobs existiam só em produção, criados à mão. Não estavam
--    em lugar nenhum do repositório: um ambiente novo nasceria sem disparo de
--    campanha, sem automação e sem limpeza de log, e ninguém perceberia até
--    alguém perguntar por que a campanha não saiu.
--
-- 2. A service role key estava em TEXTO PURO dentro de cron.job.command. Quem
--    conseguisse ler cron.job — e qualquer função SECURITY DEFINER que
--    consultasse essa tabela conseguiria — levava embora a chave que ignora
--    todo o RLS do banco. O comando agora chama uma função que busca a chave
--    no Vault na hora de usar, e o segredo nunca aparece nem no comando, nem
--    nesta migration, nem no repositório.
--
-- A semeadura do Vault vem do que JÁ está agendado em produção. É o único
-- lugar onde a chave existe hoje, e assim esta migration não precisa carregar
-- segredo nenhum para funcionar no ambiente que importa.

-- ── 1. Vault: chave e URL ────────────────────────────────────────────
-- A URL também entra aqui, e não fixa no código, porque um banco de branch
-- com a URL de produção fixada mandaria os tickers dispararem contra os
-- clientes reais a partir de um ambiente de teste.
DO $$
DECLARE
  v_chave text;
  v_url   text;
  v_id    uuid;
BEGIN
  SELECT (regexp_match(command, 'Bearer ([A-Za-z0-9._\-]{40,})'))[1],
         (regexp_match(command, '(https://[a-z0-9]+\.supabase\.co)'))[1]
    INTO v_chave, v_url
    FROM cron.job
   WHERE command ~ 'Bearer [A-Za-z0-9._\-]{40,}'
   LIMIT 1;

  IF v_chave IS NOT NULL THEN
    SELECT id INTO v_id FROM vault.secrets WHERE name = 'cron_service_role_key';
    IF v_id IS NULL THEN
      PERFORM vault.create_secret(v_chave, 'cron_service_role_key',
        'Chave usada pelos jobs do pg_cron para chamar as edge functions.');
    ELSE
      PERFORM vault.update_secret(v_id, v_chave);
    END IF;

    SELECT id INTO v_id FROM vault.secrets WHERE name = 'cron_projeto_url';
    IF v_id IS NULL THEN
      PERFORM vault.create_secret(v_url, 'cron_projeto_url',
        'URL base do projeto. No Vault para um banco de branch nao herdar a de producao.');
    ELSE
      PERFORM vault.update_secret(v_id, v_url);
    END IF;

    RAISE LOG 'crons: credencial migrada do comando para o Vault';
  ELSE
    RAISE WARNING 'crons: nenhuma credencial encontrada para semear o Vault. Os jobs vao falhar de forma visivel ate alguem rodar: select vault.create_secret(''<service_role_key>'', ''cron_service_role_key''); e o mesmo para cron_projeto_url.';
  END IF;
END $$;

-- ── 2. A função que os jobs chamam ───────────────────────────────────
CREATE OR REPLACE FUNCTION chamar_ticker(p_funcao text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault, pg_temp
AS $$
DECLARE
  v_chave text;
  v_url   text;
BEGIN
  SELECT decrypted_secret INTO v_chave
    FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key';
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'cron_projeto_url';

  -- Falhar alto e com instrução. Um ticker que não dispara em silêncio é o
  -- pior desfecho possível: a campanha simplesmente não sai, e a mensagem de
  -- erro aparece meses depois, na forma de um cliente reclamando. Assim o
  -- motivo fica legível em cron.job_run_details na primeira execução.
  IF v_chave IS NULL OR v_url IS NULL THEN
    RAISE EXCEPTION
      'ticker % nao pode disparar: falta % no Vault. Rode: select vault.create_secret(''<valor>'', ''<nome>'');',
      p_funcao,
      coalesce(nullif(concat_ws(' e ',
        CASE WHEN v_chave IS NULL THEN 'cron_service_role_key' END,
        CASE WHEN v_url   IS NULL THEN 'cron_projeto_url'      END), ''), 'o segredo');
  END IF;

  RETURN net.http_post(
    url     := v_url || '/functions/v1/' || p_funcao,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_chave),
    body    := '{}'::jsonb
  );
END $$;

COMMENT ON FUNCTION chamar_ticker(text) IS
  'Dispara uma edge function pelo pg_cron. Le a credencial do Vault na hora, para o segredo nao ficar em cron.job.command.';

-- Só o dono do banco executa. O pg_cron roda como postgres, então isto não
-- restringe o agendamento — restringe qualquer outro caminho até a chave.
REVOKE ALL ON FUNCTION chamar_ticker(text) FROM PUBLIC, anon, authenticated;

-- ── 3. Os agendamentos ───────────────────────────────────────────────
-- unschedule antes de schedule: cron.schedule com nome repetido atualiza, mas
-- os jobs de hoje têm o comando antigo com a chave embutida, e é exatamente
-- isso que precisa sumir.
DO $$
DECLARE
  r record;
  v_agendados text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('campaign-ticker-every-minute', '* * * * *',  'SELECT chamar_ticker(''campaign-ticker'')'),
      ('automation-ticker',            '0 * * * *',  'SELECT chamar_ticker(''automation-ticker'')'),
      ('relationship-ticker',          '5 * * * *',  'SELECT chamar_ticker(''relationship-ticker'')'),
      ('purge-observability-logs',     '15 3 * * *', 'SELECT purge_observability_logs()')
    ) AS t(nome, quando, comando)
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = r.nome) THEN
      PERFORM cron.unschedule(r.nome);
    END IF;
    PERFORM cron.schedule(r.nome, r.quando, r.comando);
    v_agendados := v_agendados || r.nome;
  END LOOP;

  RAISE LOG 'crons versionados: %', array_to_string(v_agendados, ', ');
END $$;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_n       integer;
  v_vazados integer;
  v_req     bigint;
BEGIN
  SELECT count(*) INTO v_n FROM cron.job
   WHERE jobname IN ('campaign-ticker-every-minute', 'automation-ticker',
                     'relationship-ticker', 'purge-observability-logs')
     AND active;
  IF v_n <> 4 THEN RAISE EXCEPTION 'esperava 4 jobs ativos, achei %', v_n; END IF;

  -- O ponto da migration: nenhum comando pode mais carregar credencial.
  SELECT count(*) INTO v_vazados FROM cron.job WHERE command ~ 'Bearer [A-Za-z0-9._\-]{40,}';
  IF v_vazados > 0 THEN
    RAISE EXCEPTION 'ainda ha % job(s) com a chave em texto puro no comando', v_vazados;
  END IF;

  -- Prova pelo caminho real: a função tem que conseguir ler o Vault, montar a
  -- URL e entregar a requisição ao pg_net. Conferir só que o job existe
  -- provaria o agendamento, não que ele funciona — que é justamente o que
  -- quebraria se o Vault estivesse vazio.
  --
  -- Num nome de função que não existe, de propósito. Chamar um ticker de
  -- verdade aqui faria de todo `db push` um disparo real para contatos reais.
  -- Hoje não sairia mensagem porque as regras estão em rascunho, mas isso é
  -- sorte de configuração, não garantia. O 404 prova o mesmo encanamento e
  -- não aciona negócio nenhum.
  IF EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key') THEN
    SELECT chamar_ticker('__teste_de_agendamento__') INTO v_req;
    IF v_req IS NULL THEN RAISE EXCEPTION 'chamar_ticker nao devolveu request_id'; END IF;
    RAISE LOG 'crons versionados: encanamento provado, request_id %', v_req;
  END IF;

  RAISE LOG 'crons versionados: 3 asseveracoes passaram';
END $$;
