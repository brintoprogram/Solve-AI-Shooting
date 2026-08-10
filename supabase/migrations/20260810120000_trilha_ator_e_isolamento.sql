-- Duas lacunas da trilha: quem convidou, e a prova de que ela não vaza.
--
-- 1. O convite passa por edge function com service role, então auth.uid() é
--    nulo e a linha nascia com origem 'servidor' e ator nenhum. Sabia-se que um
--    convite foi criado, não quem criou — que é metade da pergunta que a trilha
--    existe para responder.
--
--    A saída não é instrumentar a edge function. É que a resposta já está na
--    linha: workspace_invites.invited_by É o ator. Ler dali não pode ser
--    esquecido por uma tela nova nem contornado por um script, ao contrário de
--    uma chamada que alguém precisa lembrar de fazer.
--
-- 2. O teste de isolamento, no mesmo formato de teste_isolamento_creditos: a
--    regra "nada vaza entre workspaces" só vale se estiver provada por
--    execução, e uma trilha de configuração é exatamente o tipo de tabela cujo
--    vazamento entrega a operação de um cliente para outro.

-- ── 1. O ator, quando o servidor escreve ─────────────────────────────
CREATE OR REPLACE FUNCTION auditar_mudanca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_antes  jsonb;
  v_depois jsonb;
  v_linha  jsonb;
  v_ws     uuid;
  v_campos text[];
  v_acao   text;
  v_ator   uuid;
  v_email  text;
  v_papel  text;
  v_origem text;
  v_reg    text;
BEGIN
  v_antes  := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_depois := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_linha  := coalesce(v_depois, v_antes);
  v_acao   := CASE TG_OP WHEN 'INSERT' THEN 'criado'
                         WHEN 'UPDATE' THEN 'alterado'
                         ELSE 'removido' END;

  v_ws := CASE WHEN TG_TABLE_NAME = 'workspaces'
                 THEN (v_linha ->> 'id')::uuid
               ELSE (v_linha ->> 'workspace_id')::uuid END;
  IF v_ws IS NULL THEN RETURN NULL; END IF;

  -- Dentro do cascade da remoção do workspace: gravar aqui criaria linha
  -- órfã, a chave estrangeira recusa e a remoção do cliente é revertida.
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = v_ws) THEN RETURN NULL; END IF;

  v_reg := v_linha ->> 'id';

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(chave ORDER BY chave) INTO v_campos
      FROM jsonb_each(v_depois) AS e(chave, valor)
     WHERE chave <> 'updated_at'
       AND v_antes -> chave IS DISTINCT FROM valor;
    IF v_campos IS NULL THEN RETURN NULL; END IF;
  END IF;

  v_ator := auth.uid();

  BEGIN v_papel := auth.role(); EXCEPTION WHEN OTHERS THEN v_papel := NULL; END;

  v_origem := CASE WHEN v_ator IS NOT NULL       THEN 'painel'
                   WHEN v_papel = 'service_role' THEN 'servidor'
                   ELSE 'banco' END;

  -- Escrita de servidor: a linha costuma dizer quem pediu. invited_by no
  -- convite, created_by onde houver. Só como reserva — quando há sessão, quem
  -- vale é o usuário logado, porque essas colunas podem ser preenchidas com
  -- qualquer valor por quem escreve.
  IF v_ator IS NULL THEN
    v_ator := coalesce(nullif(v_linha ->> 'invited_by', ''),
                       nullif(v_linha ->> 'created_by', ''))::uuid;
  END IF;

  IF v_ator IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_ator;
  END IF;

  INSERT INTO workspace_audit_log
    (workspace_id, tabela, registro_id, acao, ator_id, ator_email, origem, campos, antes, depois)
  VALUES
    (v_ws, TG_TABLE_NAME, v_reg, v_acao, v_ator, v_email, v_origem, v_campos,
     ocultar_segredos(v_antes), ocultar_segredos(v_depois));

  RETURN NULL;
END $$;

-- ── 2. Isolamento, provado por execução ──────────────────────────────
-- Três fases, no mesmo formato de teste_isolamento_creditos: montar como dono,
-- ler pela porta do navegador, limpar como dono. A troca de papel fica em
-- nível de instrução porque RESET ROLE não devolve o privilégio aqui — a role
-- de sessão do runner de migration não é a dona.

-- Fase 1: montar.
DO $$
DECLARE
  v_a    uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_b    uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  v_user uuid := 'cccccccc-0000-4000-8000-000000000003';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'iso_trilha@teste.local', '', now(), now(), now(), '', '', '', '')
  ON CONFLICT (id) DO NOTHING;

  -- get_my_role() lê user_profiles. Um usuário que não fosse admin veria zero
  -- nos DOIS workspaces, e o teste passaria sem ter provado nada.
  INSERT INTO user_profiles (id, full_name, role) VALUES (v_user, 'Teste Isolamento', 'admin')
  ON CONFLICT (id) DO UPDATE SET role = 'admin';

  INSERT INTO workspaces (id, name, codigo) VALUES (v_a, '__iso_a__', 'ISOA'), (v_b, '__iso_b__', 'ISOB');

  -- Membro só de A. B é o workspace alheio.
  INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (v_a, v_user, 'admin');

  -- Trilha nos dois, para haver o que vazar.
  INSERT INTO departments (workspace_id, name) VALUES (v_a, 'Setor A'), (v_b, 'Setor B');
END $$;

-- Fase 2: ler como o usuário de A, pela mesma porta do navegador.
--
-- A transação é explícita porque o runner de migration NÃO abre uma: sem ela o
-- SET LOCAL vira um aviso e é ignorado, a fase 2 roda como dona do banco, a RLS
-- não se aplica, e o teste passa sem ter testado. Foi o que aconteceu na
-- primeira tentativa — o pior desfecho possível para um teste de vazamento.
BEGIN;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_a   uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_b   uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  v_n   integer;
  v_meu integer;
BEGIN
  -- Antes de qualquer contagem: provar que a troca de papel valeu. Sem isto o
  -- resto do bloco não significa nada.
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'teste invalido: rodando como %, nao como authenticated', current_user;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'cccccccc-0000-4000-8000-000000000003',
                      'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_n FROM workspace_audit_log WHERE workspace_id = v_b;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'VAZAMENTO ENTRE WORKSPACES: leu % linha(s) da trilha alheia', v_n;
  END IF;

  -- Nem por varredura sem filtro, que é como um vazamento costuma aparecer:
  -- não por alguém pedir o workspace do vizinho, mas por pedir tudo.
  SELECT count(*) INTO v_meu FROM workspace_audit_log;
  IF EXISTS (SELECT 1 FROM workspace_audit_log WHERE workspace_id <> v_a) THEN
    RAISE EXCEPTION 'VAZAMENTO: select sem filtro trouxe trilha de outro workspace';
  END IF;

  -- E o contrário também tem que valer. Sem esta, uma policy que negasse tudo
  -- a todo mundo passaria no teste enquanto quebrava a funcionalidade.
  IF v_meu = 0 THEN
    RAISE EXCEPTION 'a policy negou ate a trilha do proprio workspace';
  END IF;

  -- A trilha não se deixa reescrever nem por quem tem direito de lê-la.
  BEGIN
    UPDATE workspace_audit_log SET ator_email = 'forjado@teste.local' WHERE workspace_id = v_a;
    IF EXISTS (SELECT 1 FROM workspace_audit_log
                WHERE workspace_id = v_a AND ator_email = 'forjado@teste.local') THEN
      RAISE EXCEPTION 'FALHA GRAVE: admin do workspace reescreveu a propria trilha';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;   -- negar de forma explícita também está correto
  END;
END $$;

COMMIT;

-- Fase 3: limpar, de volta como dono. O COMMIT já desfez o SET LOCAL ROLE.
DO $$
BEGIN
  -- A claim de JWT NÃO morre com a transação: set_config local vale enquanto
  -- não há transação aberta, e ela sobreviveu para o bloco seguinte, que passou
  -- a enxergar um usuário logado que não existia mais. Limpar aqui é o que
  -- separa um teste do outro.
  PERFORM set_config('request.jwt.claims', '', false);

  DELETE FROM workspaces  WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000001',
                                       'bbbbbbbb-0000-4000-8000-000000000002');
  DELETE FROM auth.users  WHERE id  = 'cccccccc-0000-4000-8000-000000000003';
  RAISE LOG 'trilha: isolamento entre workspaces provado';
END $$;

-- ── 3. O ator do convite, provado por execução ───────────────────────
DO $$
DECLARE
  v_ws   uuid;
  v_user uuid;
  v_ator uuid;
  v_mail text;
BEGIN
  -- Sem sessão: é justamente o caso que o convite enfrenta, porque a edge
  -- function usa service role. Se houvesse um usuário logado aqui, o ator viria
  -- de auth.uid() e a reserva por invited_by ficaria sem teste.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'teste invalido: ha sessao ativa (%), a reserva nao seria exercitada', auth.uid();
  END IF;

  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN
    RAISE WARNING 'trilha: sem usuario no banco, teste do ator pulado';
    RETURN;
  END IF;

  INSERT INTO workspaces (name, codigo) VALUES ('__iso_c__', 'ISOC') RETURNING id INTO v_ws;

  INSERT INTO workspace_invites (workspace_id, email, role, token, expires_at, invited_by)
  VALUES (v_ws, 'convidado@exemplo.invalido', 'agent', 'link-secreto', now() + interval '1 day', v_user);

  SELECT ator_id, ator_email INTO v_ator, v_mail
    FROM workspace_audit_log WHERE workspace_id = v_ws AND tabela = 'workspace_invites' LIMIT 1;

  IF v_ator IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'convite sem ator: esperava %, veio %', v_user, v_ator;
  END IF;
  IF v_mail IS NULL THEN RAISE EXCEPTION 'convite sem email do ator'; END IF;

  DELETE FROM workspace_invites WHERE workspace_id = v_ws;
  DELETE FROM workspaces WHERE id = v_ws;

  RAISE LOG 'trilha: convite agora identifica quem convidou (%)', v_mail;
END $$;
