-- Devolução de uso, e a prova de que o link não vaza entre workspaces.
--
-- Duas coisas que a migration anterior deixou em aberto.

-- ── 1. Devolver o uso quando o cadastro falha ────────────────────────
-- A edge function reserva o uso ANTES de criar a conta — é o único jeito de
-- duas pessoas no mesmo link de uso único não entrarem as duas. O preço é que
-- uma falha depois da reserva queimaria o link sem ninguém ter entrado: a
-- pessoa erra a senha, o Auth recusa, e o convite morre.
--
-- O GREATEST existe para o contador nunca ficar negativo, nem numa devolução
-- repetida por retry.
CREATE OR REPLACE FUNCTION devolver_uso_convite_link(p_link_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE workspace_invite_links
     SET uses = GREATEST(uses - 1, 0)
   WHERE id = p_link_id;
$$;

COMMENT ON FUNCTION devolver_uso_convite_link(uuid) IS
  'Devolve o uso reservado quando o cadastro falha depois da reserva. Sem isto, erro de senha queima o convite.';

REVOKE ALL ON FUNCTION devolver_uso_convite_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION devolver_uso_convite_link(uuid) TO service_role;

-- ── 2. Prova de isolamento ───────────────────────────────────────────
-- Rodada DENTRO de uma transação explícita, e não solta: SET LOCAL fora de
-- transação é ignorado com um aviso, e o teste passaria rodando como dono do
-- banco — com RLS desligado. Um teste de vazamento que passa porque não
-- testou nada é pior do que teste nenhum.
BEGIN;

DO $isolamento$
DECLARE
  v_user   uuid;
  v_ws_a   uuid;   -- ele é admin
  v_ws_b   uuid;   -- ele não é nada
  v_ws_c   uuid;   -- ele é agente
  v_visiveis integer;
  v_tok_b  text;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE WARNING 'sem usuarios — prova de isolamento pulada';
    RETURN;
  END IF;

  INSERT INTO workspaces (name, codigo) VALUES ('__iso_a__', 'ISOA') RETURNING id INTO v_ws_a;
  INSERT INTO workspaces (name, codigo) VALUES ('__iso_b__', 'ISOB') RETURNING id INTO v_ws_b;
  INSERT INTO workspaces (name, codigo) VALUES ('__iso_c__', 'ISOC') RETURNING id INTO v_ws_c;

  INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (v_ws_a, v_user, 'admin');
  INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (v_ws_c, v_user, 'agent');
  -- Nenhuma linha para o B: ele é um estranho lá.

  INSERT INTO workspace_invite_links (workspace_id, role, created_by) VALUES (v_ws_a, 'agent', v_user);
  INSERT INTO workspace_invite_links (workspace_id, role, created_by) VALUES (v_ws_b, 'admin', v_user)
    RETURNING token INTO v_tok_b;
  INSERT INTO workspace_invite_links (workspace_id, role, created_by) VALUES (v_ws_c, 'agent', v_user);

  -- ── Vira o usuário de verdade ──────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'o teste nao trocou de papel: rodando como % (RLS estaria desligado)', current_user;
  END IF;
  IF auth.uid() <> v_user THEN
    RAISE EXCEPTION 'auth.uid() nao reflete o usuario do teste';
  END IF;

  -- Workspace onde ele é admin: vê.
  SELECT count(*) INTO v_visiveis FROM workspace_invite_links WHERE workspace_id = v_ws_a;
  IF v_visiveis <> 1 THEN
    RAISE EXCEPTION 'admin do proprio workspace NAO ve o link dele (viu %)', v_visiveis;
  END IF;

  -- Workspace de outra empresa: não vê nem que existe.
  SELECT count(*) INTO v_visiveis FROM workspace_invite_links WHERE workspace_id = v_ws_b;
  IF v_visiveis <> 0 THEN
    RAISE EXCEPTION 'VAZOU: enxergou % link(s) de um workspace onde nao e membro', v_visiveis;
  END IF;

  -- E nem procurando pelo token, que é o que importa: com o token na mão
  -- qualquer um entra, então o token é o segredo que não pode escapar.
  SELECT count(*) INTO v_visiveis FROM workspace_invite_links WHERE token = v_tok_b;
  IF v_visiveis <> 0 THEN
    RAISE EXCEPTION 'VAZOU: achou o link de outro workspace buscando pelo token';
  END IF;

  -- Workspace onde ele é só agente: é membro, mas não convida — e o token é
  -- exatamente o poder de convidar.
  SELECT count(*) INTO v_visiveis FROM workspace_invite_links WHERE workspace_id = v_ws_c;
  IF v_visiveis <> 0 THEN
    RAISE EXCEPTION 'VAZOU: agente enxergou o token de convite do proprio workspace';
  END IF;

  -- As funções não são chamáveis por ele: se fossem, o token seria suficiente
  -- para entrar sem passar pela edge function e sem deixar registro.
  BEGIN
    PERFORM consumir_convite_link(v_tok_b);
    RAISE EXCEPTION 'VAZOU: usuario comum conseguiu chamar consumir_convite_link';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM espiar_convite_link(v_tok_b);
    RAISE EXCEPTION 'VAZOU: usuario comum conseguiu chamar espiar_convite_link';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ── Volta a ser o dono, para limpar ────────────────────────────────
  EXECUTE 'SET LOCAL ROLE postgres';
  PERFORM set_config('request.jwt.claims', '', false);

  DELETE FROM workspaces WHERE id IN (v_ws_a, v_ws_b, v_ws_c);
  RAISE LOG 'convite por link: isolamento entre workspaces e entre cargos conferido rodando como authenticated';
END
$isolamento$;

COMMIT;

-- ── 3. Devolução, conferida ──────────────────────────────────────────
DO $devolucao$
DECLARE
  v_user uuid;
  v_ws   uuid;
  v_id   uuid;
  v_tok  text;
  v_n    integer;
BEGIN
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN RETURN; END IF;

  INSERT INTO workspaces (name, codigo) VALUES ('__devol__', 'DEVOL') RETURNING id INTO v_ws;
  INSERT INTO workspace_invite_links (workspace_id, role, created_by, max_uses)
  VALUES (v_ws, 'agent', v_user, 1) RETURNING id, token INTO v_id, v_tok;

  PERFORM consumir_convite_link(v_tok);
  SELECT uses INTO v_n FROM workspace_invite_links WHERE id = v_id;
  IF v_n <> 1 THEN RAISE EXCEPTION 'reserva nao contou'; END IF;

  PERFORM devolver_uso_convite_link(v_id);
  SELECT uses INTO v_n FROM workspace_invite_links WHERE id = v_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'devolucao nao voltou o contador (ficou %)', v_n; END IF;

  -- E o link volta a funcionar: era esse o ponto.
  SELECT count(*) INTO v_n FROM consumir_convite_link(v_tok);
  IF v_n <> 1 THEN RAISE EXCEPTION 'link nao voltou a valer depois da devolucao'; END IF;

  -- Devolver duas vezes não deixa o contador negativo.
  PERFORM devolver_uso_convite_link(v_id);
  PERFORM devolver_uso_convite_link(v_id);
  SELECT uses INTO v_n FROM workspace_invite_links WHERE id = v_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'contador ficou % apos devolucao repetida', v_n; END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'convite por link: devolucao de uso conferida';
END
$devolucao$;
