-- Sessões passam a ter prazo, e as atuais morrem agora.
--
-- O estado que motivou isto: sessão mais antiga criada em 29/04, ainda válida
-- em 10/08. E uma criada em 09/05 renovada no mesmo dia em que isto foi escrito
-- — alguém logado há 93 dias sem nunca ter reautenticado. Um refresh token que
-- se renova sozinho não expira nunca: enquanto o navegador continuar abrindo, a
-- sessão continua viva. Um notebook roubado em maio ainda estaria dentro.
--
-- Duas regras, que é o que o próprio GoTrue faz quando configurado:
--
--   PRAZO MÁXIMO (7 dias) — conta da criação e ignora atividade. É esta que
--   corta o caso acima; sem ela, uso diário significa sessão eterna.
--
--   INATIVIDADE (3 dias) — sessão parada morre antes. Cobre o computador
--   compartilhado onde alguém esqueceu de sair.
--
-- Por que no banco e não em [auth] no config.toml: o config.toml deste projeto
-- só declara blocos [functions.*]. Um `config push` preencheria todo o resto
-- com os padrões do CLI, inclusive site_url apontando para localhost, e os
-- links de convite e de recuperação de senha dos clientes parariam de
-- funcionar. Apagar a sessão é exatamente o que o GoTrue faz por dentro quando
-- o prazo vence, então o efeito é o mesmo por um caminho que não arrisca isso.
--
-- O ajuste nativo continua sendo o melhor lugar para isto viver, e está em
-- scripts/endurecer-auth.sh — que precisa do token pessoal do Supabase.

CREATE OR REPLACE FUNCTION expirar_sessoes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public, pg_temp
AS $$
DECLARE
  -- Os dois números que definem a política. Mudar aqui muda tudo.
  c_prazo_maximo constant interval := interval '7 days';
  c_inatividade  constant interval := interval '3 days';
  v_n integer;
BEGIN
  WITH mortas AS (
    DELETE FROM auth.sessions
     WHERE created_at < now() - c_prazo_maximo
        -- refreshed_at é nulo enquanto a sessão nunca foi renovada; aí quem
        -- vale é a criação. Sem o coalesce, sessão nova e nunca usada escapa
        -- da regra de inatividade para sempre.
        OR coalesce(refreshed_at, created_at) < now() - c_inatividade
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM mortas;

  IF v_n > 0 THEN
    RAISE LOG 'expirar_sessoes: % sessao(oes) encerrada(s)', v_n;
  END IF;
  RETURN v_n;
END $$;

COMMENT ON FUNCTION expirar_sessoes() IS
  'Encerra sessoes que passaram do prazo maximo ou ficaram paradas. Roda de hora em hora pelo pg_cron.';

REVOKE ALL ON FUNCTION expirar_sessoes() FROM PUBLIC, anon, authenticated;

-- ── De hora em hora ──────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expirar-sessoes') THEN
    PERFORM cron.unschedule('expirar-sessoes');
  END IF;
  PERFORM cron.schedule('expirar-sessoes', '25 * * * *', 'SELECT expirar_sessoes()');
END $$;

-- ── Agora: todo mundo sai ────────────────────────────────────────────
-- Inclui a minha e a de qualquer pessoa logada neste momento. É o pedido, e é
-- o único jeito de as sessões de 100 dias não continuarem valendo até vencerem
-- pela regra nova.
--
-- Não é instantâneo: o token de acesso que já está no navegador continua
-- valendo até expirar sozinho, no padrão uma hora. O que morre agora é a
-- capacidade de renovar — passada essa hora, ninguém volta sem senha.
DO $$
DECLARE v_n integer;
BEGIN
  WITH todas AS (DELETE FROM auth.sessions RETURNING 1)
  SELECT count(*) INTO v_n FROM todas;
  RAISE LOG 'sessoes: % encerrada(s) no corte inicial', v_n;
END $$;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_n     integer;
  v_user  uuid := 'dddddddd-0000-4000-8000-000000000004';
  v_velha uuid := 'eeeeeeee-0000-4000-8000-000000000005';
  v_nova  uuid := 'ffffffff-0000-4000-8000-000000000006';
  v_parada uuid := '11111111-0000-4000-8000-000000000007';
BEGIN
  SELECT count(*) INTO v_n FROM auth.sessions;
  IF v_n <> 0 THEN RAISE EXCEPTION 'o corte inicial deixou % sessao(oes)', v_n; END IF;

  -- Prova pelo caminho real: três sessões que exercitam as três situações.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'sessao@teste.local', '', now(), now(), now(), '', '', '', '')
  ON CONFLICT (id) DO NOTHING;

  -- Velha demais, mas usada hoje: é o caso de 93 dias, e o que a regra de
  -- inatividade sozinha NÃO pegaria.
  INSERT INTO auth.sessions (id, user_id, created_at, refreshed_at)
  VALUES (v_velha, v_user, now() - interval '30 days', now());
  -- Nova e ativa: tem que sobreviver, senão a política vira só um incômodo.
  INSERT INTO auth.sessions (id, user_id, created_at, refreshed_at)
  VALUES (v_nova, v_user, now() - interval '1 day', now());
  -- Nova, mas nunca renovada e parada: é o caso do refreshed_at nulo.
  INSERT INTO auth.sessions (id, user_id, created_at, refreshed_at)
  VALUES (v_parada, v_user, now() - interval '5 days', NULL);

  PERFORM expirar_sessoes();

  IF EXISTS (SELECT 1 FROM auth.sessions WHERE id = v_velha) THEN
    RAISE EXCEPTION 'sessao de 30 dias sobreviveu: o prazo maximo nao esta valendo';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.sessions WHERE id = v_parada) THEN
    RAISE EXCEPTION 'sessao parada com refreshed_at nulo sobreviveu';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = v_nova) THEN
    RAISE EXCEPTION 'sessao ativa e recente foi encerrada por engano';
  END IF;

  DELETE FROM auth.sessions WHERE user_id = v_user;
  DELETE FROM auth.users WHERE id = v_user;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expirar-sessoes' AND active) THEN
    RAISE EXCEPTION 'o job de expiracao nao ficou agendado';
  END IF;

  RAISE LOG 'sessoes expiram: 5 asseveracoes passaram';
END $$;
