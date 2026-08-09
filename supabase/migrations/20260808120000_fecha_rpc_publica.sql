-- Tira do alcance do REST as funções SECURITY DEFINER que ninguém deveria chamar.
--
-- Toda função em `public` vira um endpoint /rest/v1/rpc/<nome>, e o Postgres dá
-- EXECUTE a PUBLIC por padrão — o que alcança `anon`, ou seja, a internet. Como
-- estas rodam com SECURITY DEFINER, elas ignoram RLS: quem chama de fora herda
-- o poder do dono.
--
-- A pior era `purge_observability_logs`: um POST sem autenticação nenhuma
-- apagava audit_logs. Justamente a tabela que registraria o apagamento.
--
-- ── Por que revogar de PUBLIC e não de anon ──────────────────────────
-- O privilégio não está concedido a `anon` diretamente; vem de PUBLIC. Um
-- `REVOKE ... FROM anon` roda sem erro e não muda nada — a função continua
-- aberta e a migration passa verde. Foi exatamente o que aconteceu na primeira
-- tentativa desta migration; a verificação no fim do arquivo é o que pegou.
--
-- ── O que NÃO é tocado, e por quê ────────────────────────────────────
-- is_workspace_member (53 policies), get_my_workspace_ids (26) e get_my_role
-- (14) são chamadas DENTRO das policies de RLS, e o Postgres exige EXECUTE do
-- papel que consulta mesmo quando a chamada parte da policy. Revogá-las
-- derrubaria o isolamento entre workspaces em 93 lugares. Como anon as três já
-- devolvem vazio/false (auth.uid() é nulo), expostas não entregam nada.
--
-- handle_new_user, seed_new_workspace e rls_auto_enable são funções de GATILHO:
-- referenciam NEW e falham ao serem chamadas fora de um trigger, então a
-- exposição é inerte. Mexer nelas alcançaria o caminho de criação de usuário
-- (handle_new_user dispara em auth.users, sob supabase_auth_admin) — risco de
-- quebrar login para fechar uma porta que não abre.

DO $$
DECLARE
  v_oid oid;
BEGIN
  -- Destrutiva. Só o cron precisa, e ele roda como postgres, que é o dono —
  -- dono mantém EXECUTE implicitamente, então revogar de PUBLIC não o afeta.
  FOR v_oid IN
    SELECT p.oid FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'purge_observability_logs'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
                   v_oid::regprocedure);
  END LOOP;

  -- Escreve contador de campanha. Só as edge functions chamam, com service role.
  FOR v_oid IN
    SELECT p.oid FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'increment_campaign_counters'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
                   v_oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',
                   v_oid::regprocedure);
  END LOOP;

  -- Alimenta /primeiros-passos e /tutoriais: o frontend chama como
  -- authenticated. Já confere participação no workspace por dentro, mas não há
  -- motivo para deslogado alcançá-la.
  FOR v_oid IN
    SELECT p.oid FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'get_setup_status'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
                   v_oid::regprocedure);
  END LOOP;
END $$;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE v_erro text;
BEGIN
  -- 1. As duas fechadas não podem mais ser executadas por anon nem authenticated.
  SELECT string_agg(p.oid::regprocedure::text || ' via ' || g, ', ')
    INTO v_erro
    FROM pg_proc p
    CROSS JOIN unnest(ARRAY['anon','authenticated']) AS g
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('purge_observability_logs','increment_campaign_counters')
     AND has_function_privilege(g, p.oid, 'EXECUTE');
  IF v_erro IS NOT NULL THEN
    RAISE EXCEPTION 'ainda executaveis: %', v_erro;
  END IF;

  -- 2. Mas service_role precisa continuar chamando increment_campaign_counters,
  --    senão toda campanha para de contabilizar entrega.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'increment_campaign_counters'
       AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'increment_campaign_counters fechou para service_role — campanhas parariam de contar';
  END IF;

  -- 3. get_setup_status: fechada para anon, aberta para authenticated.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'get_setup_status'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'get_setup_status ainda aberta para anon';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'get_setup_status'
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'get_setup_status fechou para authenticated — primeiros passos e tutoriais quebrariam';
  END IF;

  -- 4. As auxiliares de RLS PRECISAM continuar abertas, ou o isolamento cai.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('is_workspace_member','get_my_workspace_ids','get_my_role')
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'auxiliar de RLS perdeu EXECUTE — o isolamento entre workspaces quebraria';
  END IF;

  RAISE LOG 'rpc fechadas e verificadas: 4 asseveracoes passaram';
END $$;
