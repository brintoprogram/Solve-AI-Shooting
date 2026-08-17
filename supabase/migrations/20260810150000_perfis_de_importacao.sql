-- Perfis de planilha: o formato que cada cliente manda todo mês.
--
-- A planilha de um cliente não muda. É sempre a mesma exportação do mesmo
-- sistema, com os mesmos cabeçalhos, no mesmo idioma. Mas hoje toda importação
-- começa do zero: a pessoa reconfere 25 colunas que já conferiu no mês passado,
-- e reconferir tudo todo mês é como não conferir nada — ninguém lê com atenção
-- na décima vez.
--
-- Guardando o mapeamento conferido uma vez, a importação seguinte deixa de ser
-- uma tarefa e vira uma confirmação: "reconheci o formato Cobrança Mensal, das
-- outras 4 vezes". A atenção da pessoa passa a sobrar para o que MUDOU.
--
-- A ordem das datas entra junto de propósito. É a decisão mais perigosa do
-- importador e a que menos dá sinal quando está errada; se ela precisasse ser
-- retomada a cada mês, o perfil resolveria a parte fácil e deixaria a difícil.

CREATE TABLE IF NOT EXISTS import_profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  nome         text NOT NULL,
  -- Cabeçalhos normalizados (minúsculo, sem acento). Guardados como lista e
  -- não como impressão digital única porque o reconhecimento precisa tolerar
  -- coluna a mais ou a menos: cliente acrescenta campo sem avisar, e um
  -- casamento exato descartaria o perfil justo quando ele é mais útil.
  colunas      text[] NOT NULL,
  mapeamento   jsonb  NOT NULL,
  ordem_data   text   NOT NULL DEFAULT 'dmy' CHECK (ordem_data IN ('dmy', 'mdy')),
  usos         integer NOT NULL DEFAULT 0,
  ultimo_uso   timestamptz,
  criado_por   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_profiles_nome_unico UNIQUE (workspace_id, nome),
  CONSTRAINT import_profiles_nome_nao_vazio CHECK (length(btrim(nome)) > 0),
  CONSTRAINT import_profiles_tem_coluna CHECK (array_length(colunas, 1) > 0)
);

CREATE INDEX IF NOT EXISTS idx_import_profiles_ws
  ON import_profiles (workspace_id, ultimo_uso DESC NULLS LAST);

COMMENT ON TABLE import_profiles IS
  'Mapeamento conferido de uma planilha recorrente, por workspace. Reconhecido pelos cabecalhos.';

-- ── Isolamento ───────────────────────────────────────────────────────
-- Um perfil carrega os cabeçalhos da planilha do cliente, que dizem como a
-- operação dele é organizada. Vazar isso entre workspaces é vazar o cliente.
ALTER TABLE import_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS perfis_do_meu_workspace ON import_profiles;
CREATE POLICY perfis_do_meu_workspace ON import_profiles
  FOR ALL TO authenticated
  USING      (workspace_id IN (SELECT get_my_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT get_my_workspace_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON import_profiles TO authenticated;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_a  uuid := 'a1a1a1a1-0000-4000-8000-000000000011';
  v_b  uuid := 'b1b1b1b1-0000-4000-8000-000000000012';
  v_u  uuid := 'c1c1c1c1-0000-4000-8000-000000000013';
  v_ok boolean;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'perfil@teste.local', '', now(), now(), now(), '', '', '', '')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO user_profiles (id, full_name, role) VALUES (v_u, 'Teste Perfil', 'admin')
  ON CONFLICT (id) DO UPDATE SET role = 'admin';

  INSERT INTO workspaces (id, name, codigo) VALUES (v_a, '__perf_a__', 'PERFA'), (v_b, '__perf_b__', 'PERFB');
  INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (v_a, v_u, 'admin');

  INSERT INTO import_profiles (workspace_id, nome, colunas, mapeamento, ordem_data)
  VALUES (v_a, 'Cobranca Mensal', ARRAY['nome','due date','amount'],
          '{"Nome":"name","Due Date":"inv_vencimento","Amount":"inv_valor"}'::jsonb, 'mdy'),
         (v_b, 'Perfil do vizinho', ARRAY['cliente','vencimento'],
          '{"Cliente":"name"}'::jsonb, 'dmy');

  -- Nome repetido no mesmo workspace não pode: dois perfis com o mesmo nome
  -- tornam impossível saber qual foi aplicado.
  v_ok := false;
  BEGIN
    INSERT INTO import_profiles (workspace_id, nome, colunas, mapeamento)
    VALUES (v_a, 'Cobranca Mensal', ARRAY['x'], '{}'::jsonb);
  EXCEPTION WHEN unique_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'aceitou dois perfis com o mesmo nome'; END IF;

  -- Mas o MESMO nome em outro workspace tem que caber: clientes diferentes
  -- chamam a planilha deles da mesma coisa, e isso não é conflito.
  INSERT INTO import_profiles (workspace_id, nome, colunas, mapeamento)
  VALUES (v_b, 'Cobranca Mensal', ARRAY['y'], '{}'::jsonb);

  RAISE LOG 'perfis de importacao: estrutura ok';
END $$;

-- Isolamento pela porta do navegador. Transação explícita porque o runner de
-- migration não abre uma, e sem ela o SET LOCAL vira aviso ignorado e o teste
-- roda como dono do banco — passando sem ter testado.
BEGIN;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_a uuid := 'a1a1a1a1-0000-4000-8000-000000000011';
  v_b uuid := 'b1b1b1b1-0000-4000-8000-000000000012';
  v_n integer;
BEGIN
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'teste invalido: rodando como %', current_user;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'c1c1c1c1-0000-4000-8000-000000000013',
                      'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_n FROM import_profiles WHERE workspace_id = v_b;
  IF v_n > 0 THEN RAISE EXCEPTION 'VAZAMENTO: leu % perfil(is) do vizinho', v_n; END IF;

  SELECT count(*) INTO v_n FROM import_profiles;
  IF v_n <> 1 THEN RAISE EXCEPTION 'varredura sem filtro devolveu % (esperava 1)', v_n; END IF;

  -- Escrever no workspace alheio também não: o WITH CHECK é o lado que
  -- costuma ser esquecido, e sem ele daria para plantar perfil no vizinho.
  BEGIN
    INSERT INTO import_profiles (workspace_id, nome, colunas, mapeamento)
    VALUES (v_b, 'invasao', ARRAY['z'], '{}'::jsonb);
    RAISE EXCEPTION 'FALHA GRAVE: escreveu perfil no workspace alheio';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

COMMIT;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', false);
  DELETE FROM workspaces WHERE id IN ('a1a1a1a1-0000-4000-8000-000000000011',
                                      'b1b1b1b1-0000-4000-8000-000000000012');
  DELETE FROM auth.users WHERE id = 'c1c1c1c1-0000-4000-8000-000000000013';
  RAISE LOG 'perfis de importacao: isolamento provado';
END $$;
