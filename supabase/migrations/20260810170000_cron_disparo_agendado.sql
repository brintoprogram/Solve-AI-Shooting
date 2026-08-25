-- O ticker do disparo agendado, de minuto em minuto.
--
-- Minuto e não hora porque a promessa da tela é "amanhã às 8h". Um ticker
-- horário entregaria "entre 8h e 9h", e a diferença aparece justamente na
-- campanha que foi agendada para as 8h de propósito.
--
-- Reusa chamar_ticker, então a credencial continua no Vault e não entra no
-- comando do job.
--
-- SEGURO POR CONSTRUÇÃO: a função só pega campanhas com status 'agendada' e
-- agendado_para preenchido. Nenhuma das campanhas que existem hoje satisfaz
-- isso — inclusive a "Safra Verão 2026", com 490 destinatários reais parada em
-- status 'scheduled'. Ligar este cron agora não dispara nada.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'disparo-agendado') THEN
    PERFORM cron.unschedule('disparo-agendado');
  END IF;
  PERFORM cron.schedule('disparo-agendado', '* * * * *', 'SELECT chamar_ticker(''disparo-agendado'')');
END $$;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_n         integer;
  v_elegiveis integer;
BEGIN
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'disparo-agendado' AND active;
  IF v_n <> 1 THEN RAISE EXCEPTION 'o job nao ficou agendado'; END IF;

  -- Antes e depois de ligar o cron: continua zero. Esta é a asseveração que
  -- responde "isso vai disparar alguma campanha existente?".
  SELECT count(*) INTO v_elegiveis
    FROM shooting_campaigns
   WHERE status = 'agendada' AND agendado_para IS NOT NULL;
  IF v_elegiveis <> 0 THEN
    RAISE EXCEPTION 'PERIGO: cron ligado com % campanha(s) ja elegiveis', v_elegiveis;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'disparo-agendado'
                   AND command NOT LIKE '%Bearer%') THEN
    RAISE EXCEPTION 'a credencial vazou para o comando do job';
  END IF;

  RAISE LOG 'cron do disparo agendado: ativo, 0 campanhas elegiveis';
END $$;
