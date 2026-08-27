-- Permitir (e limitar) a edição de cargo e permissões de um membro.
--
-- workspace_members não tinha NENHUMA policy de UPDATE. Isso explica o defeito
-- que a migration anterior descreveu por outro ângulo: o seletor de cargo da
-- tela Equipe manda um UPDATE que o RLS descarta, e o PostgREST responde
-- sucesso — porque "atualizou zero linhas" não é erro. A tela mostrava "Cargo
-- atualizado" para uma escrita que nunca aconteceu.
--
-- Agora existe a policy, com os limites que ela precisa ter:
--
--   admin    edita qualquer participação do próprio workspace, inclusive
--            promover alguém a admin
--   gerente  edita agentes e gerentes, e NÃO pode criar nem tocar em admin —
--            senão qualquer gerente se promoveria sozinho
--   agente   não edita ninguém
--   de fora  não existe: o workspace nem aparece para ele
--
-- O cargo de quem edita é lido da PARTICIPAÇÃO, não do perfil global. Ser
-- admin na empresa A não pode dar poder de edição na empresa B.

-- is_workspace_member é o pilar de todo o isolamento — inclusive da policy
-- restritiva que fecha o vazamento entre workspaces. Sendo SECURITY DEFINER
-- sem search_path fixo, ela resolvia os nomes pelo search_path de quem chama.
-- Uma linha de proteção numa função que agora sustenta o sistema inteiro.
CREATE OR REPLACE FUNCTION is_workspace_member(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE user_id = auth.uid() AND workspace_id = ws_id
  );
$$;

/* O cargo de quem chama NESTE workspace. SECURITY DEFINER de propósito: roda
   como dono, que é isento de RLS, então não há recursão ao ser usada numa
   policy da própria workspace_members. */
CREATE OR REPLACE FUNCTION meu_cargo_no_workspace(ws_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM workspace_members
   WHERE user_id = auth.uid() AND workspace_id = ws_id;
$$;

COMMENT ON FUNCTION meu_cargo_no_workspace(uuid) IS
  'Cargo de quem chama NESTE workspace. Diferente de get_my_role(), que le o perfil global e nao sabe em qual empresa a pergunta esta sendo feita.';

GRANT EXECUTE ON FUNCTION meu_cargo_no_workspace(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "wm_update_gestao" ON workspace_members;
CREATE POLICY "wm_update_gestao" ON workspace_members
  FOR UPDATE TO authenticated
  -- USING olha a linha COMO ESTÁ: gerente não encosta em quem já é admin.
  USING (
    meu_cargo_no_workspace(workspace_id) = 'admin'
    OR (meu_cargo_no_workspace(workspace_id) = 'manager' AND role <> 'admin')
  )
  -- WITH CHECK olha a linha COMO FICARIA: gerente não fabrica admin.
  WITH CHECK (
    meu_cargo_no_workspace(workspace_id) = 'admin'
    OR (meu_cargo_no_workspace(workspace_id) = 'manager' AND role <> 'admin')
  );

-- ── Verificação ──────────────────────────────────────────────────────
BEGIN;

DO $prova$
DECLARE
  v_eu    uuid;
  v_alvo  uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_n integer;
  v_barrou boolean;
BEGIN
  SELECT id INTO v_eu   FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_alvo FROM auth.users WHERE id <> v_eu ORDER BY created_at LIMIT 1;
  IF v_eu IS NULL OR v_alvo IS NULL THEN
    RAISE WARNING 'precisa de 2 usuarios — prova pulada';
    RETURN;
  END IF;

  INSERT INTO workspaces (name, codigo) VALUES ('__ed_a__','EDA') RETURNING id INTO v_a;
  INSERT INTO workspaces (name, codigo) VALUES ('__ed_b__','EDB') RETURNING id INTO v_b;
  INSERT INTO workspaces (name, codigo) VALUES ('__ed_c__','EDC') RETURNING id INTO v_c;
  INSERT INTO workspaces (name, codigo) VALUES ('__ed_d__','EDD') RETURNING id INTO v_d;

  -- O mesmo usuário com cargo diferente em cada empresa: é justamente isso
  -- que precisa funcionar.
  INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
    (v_a, v_eu, 'admin'), (v_b, v_eu, 'manager'), (v_c, v_eu, 'agent'),
    (v_a, v_alvo, 'agent'), (v_b, v_alvo, 'agent'),
    (v_c, v_alvo, 'agent'), (v_d, v_alvo, 'agent');

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_eu, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'o teste nao trocou de papel: rodando como %', current_user;
  END IF;

  -- 1. Admin promove no proprio workspace.
  UPDATE workspace_members SET role='manager' WHERE workspace_id=v_a AND user_id=v_alvo;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'admin nao conseguiu mudar cargo no proprio workspace'; END IF;

  -- 2. Admin pode criar outro admin.
  UPDATE workspace_members SET role='admin' WHERE workspace_id=v_a AND user_id=v_alvo;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'admin nao conseguiu promover a admin'; END IF;

  -- 3. Admin edita permissões — o caso da tela Equipe.
  UPDATE workspace_members SET permissions='{"can_import": false}'::jsonb
   WHERE workspace_id=v_a AND user_id=v_alvo;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'admin nao conseguiu editar permissoes'; END IF;

  -- 4. Gerente edita um agente.
  UPDATE workspace_members SET role='manager' WHERE workspace_id=v_b AND user_id=v_alvo;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'gerente nao conseguiu editar um agente'; END IF;

  -- 5. Gerente NÃO fabrica admin.
  v_barrou := false;
  BEGIN
    UPDATE workspace_members SET role='admin' WHERE workspace_id=v_b AND user_id=v_alvo;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN v_barrou := true; END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_barrou := true;
  END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FURO: gerente promoveu alguem a admin'; END IF;

  -- 6. Gerente não se promove sozinho.
  v_barrou := false;
  BEGIN
    UPDATE workspace_members SET role='admin' WHERE workspace_id=v_b AND user_id=v_eu;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN v_barrou := true; END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_barrou := true;
  END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FURO: gerente se promoveu a admin'; END IF;

  -- 7. Agente não edita ninguém.
  UPDATE workspace_members SET role='manager' WHERE workspace_id=v_c AND user_id=v_alvo;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FURO: agente editou cargo de outra pessoa'; END IF;

  -- 8. Ninguém edita workspace de que não participa.
  UPDATE workspace_members SET role='admin' WHERE workspace_id=v_d AND user_id=v_alvo;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FURO: editou participacao de workspace alheio'; END IF;

  EXECUTE 'SET LOCAL ROLE postgres';
  PERFORM set_config('request.jwt.claims', '', false);

  DELETE FROM workspaces WHERE id IN (v_a, v_b, v_c, v_d);
  RAISE LOG 'edicao de cargo/permissoes: 8 casos conferidos rodando como authenticated';
END
$prova$;

COMMIT;
