-- Trilha das mudanças de configuração e de equipe, por workspace.
--
-- O buraco: convidar um membro e mudar uma configuração não deixavam rastro
-- nenhum. Remover membro deixava; convidar, não. E o limite de desconto da
-- negociação, a chave de IA, a conexão de WhatsApp, o prompt do agente — tudo
-- isso podia mudar sem nenhum registro de quem mudou nem do que era antes.
-- Quando o cliente diz "eu não mexi nisso", não havia como verificar.
--
-- Por que GATILHO e não código de tela: código de tela é esquecível. Toda tela
-- nova, todo script de manutenção, todo acerto feito direto no SQL passaria por
-- fora. O gatilho pega a escrita onde ela acontece, não onde alguém lembrou de
-- registrar. É a diferença entre uma trilha e um hábito.
--
-- Esta trilha é do CLIENTE, e é separada de credit_admin_log de propósito:
-- aquela é minha, sobre cobrança, e nenhum workspace enxerga. Esta o admin do
-- workspace enxerga, porque é a história dele — e só a dele.

-- ── A tabela ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tabela       text NOT NULL,
  registro_id  text,
  acao         text NOT NULL CHECK (acao IN ('criado', 'alterado', 'removido')),
  ator_id      uuid,
  ator_email   text,
  -- 'painel'   = alguém logado, pela tela
  -- 'servidor' = edge function com service role (convite, integração)
  -- 'banco'    = acesso direto ao SQL. Raro por definição, e o mais importante
  --              de conseguir distinguir dos outros dois.
  origem       text NOT NULL,
  campos       text[],
  antes        jsonb,
  depois       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wal_workspace ON workspace_audit_log (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wal_tabela    ON workspace_audit_log (workspace_id, tabela, created_at DESC);

COMMENT ON TABLE workspace_audit_log IS
  'Quem mudou o que, quando, e o que era antes. Alimentada por gatilho; ninguem escreve nela a mao.';

-- ── Ocultar segredo ──────────────────────────────────────────────────
-- Sem isto a trilha vira um cofre aberto: workspace_invites.token É o magic
-- link (quem lê o log entra no lugar do convidado), e meta_connections
-- .access_token e z_api_connections.token são as credenciais de envio.
--
-- Casa por NOME e não por lista de colunas, e essa escolha é o ponto: uma
-- coluna nova chamada `algo_token` já nasce oculta. Uma lista fixa só protege
-- o que existia no dia em que foi escrita, e falha em silêncio depois.
CREATE OR REPLACE FUNCTION ocultar_segredos(p_dados jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_dados IS NULL THEN NULL ELSE
    (SELECT jsonb_object_agg(
              chave,
              CASE WHEN chave ~* '(token|secret|senha|password|hash|api_?key|chave)'
                     AND jsonb_typeof(valor) <> 'null'
                   THEN to_jsonb('(oculto)'::text)
                   ELSE valor END)
       FROM jsonb_each(p_dados) AS e(chave, valor))
  END;
$$;

COMMENT ON FUNCTION ocultar_segredos(jsonb) IS
  'Troca o valor de qualquer campo cujo NOME sugira credencial. Casa por padrao para coluna nova nascer protegida.';

-- ── O gatilho ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auditar_mudanca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_antes  jsonb;
  v_depois jsonb;
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
  v_acao   := CASE TG_OP WHEN 'INSERT' THEN 'criado'
                         WHEN 'UPDATE' THEN 'alterado'
                         ELSE 'removido' END;

  -- A própria tabela workspaces não tem workspace_id: ela é o workspace.
  v_ws := CASE
            WHEN TG_TABLE_NAME = 'workspaces'
              THEN (coalesce(v_depois, v_antes) ->> 'id')::uuid
            ELSE (coalesce(v_depois, v_antes) ->> 'workspace_id')::uuid
          END;
  IF v_ws IS NULL THEN RETURN NULL; END IF;

  -- Workspace já removido: estamos dentro do cascade da remoção dele, e cada
  -- tabela filha está sendo esvaziada. Gravar aqui criaria uma linha apontando
  -- para um workspace que não existe mais — a chave estrangeira recusa, e a
  -- remoção inteira do cliente é revertida. A trilha morre com o workspace de
  -- qualquer forma; o registro do fim dele é da plataforma, em credit_admin_log.
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = v_ws) THEN RETURN NULL; END IF;

  v_reg := coalesce(v_depois, v_antes) ->> 'id';

  -- O que realmente mudou. updated_at fica de fora: ele muda sempre, e uma
  -- trilha que registra toda gravação como se fosse mudança some no ruído.
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(chave ORDER BY chave) INTO v_campos
      FROM jsonb_each(v_depois) AS e(chave, valor)
     WHERE chave <> 'updated_at'
       AND v_antes -> chave IS DISTINCT FROM valor;
    IF v_campos IS NULL THEN RETURN NULL; END IF;
  END IF;

  v_ator := auth.uid();
  IF v_ator IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_ator;
  END IF;

  BEGIN v_papel := auth.role(); EXCEPTION WHEN OTHERS THEN v_papel := NULL; END;

  v_origem := CASE WHEN v_ator IS NOT NULL           THEN 'painel'
                   WHEN v_papel = 'service_role'     THEN 'servidor'
                   ELSE 'banco' END;

  INSERT INTO workspace_audit_log
    (workspace_id, tabela, registro_id, acao, ator_id, ator_email, origem, campos, antes, depois)
  VALUES
    (v_ws, TG_TABLE_NAME, v_reg, v_acao, v_ator, v_email, v_origem, v_campos,
     ocultar_segredos(v_antes), ocultar_segredos(v_depois));

  RETURN NULL;
END $$;

-- ── Onde ele fica ────────────────────────────────────────────────────
-- As tabelas em que uma mudança silenciosa custa caro: quem entra na equipe,
-- quem responde pelo cliente, e as réguas que definem o que a IA pode oferecer.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workspaces', 'workspace_members', 'workspace_invites',
    'ai_agents', 'negotiation_rules', 'departments',
    'meta_connections', 'z_api_connections', 'api_keys'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE WARNING 'trilha: tabela % nao existe, pulando', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditar ON public.%I', t);
    -- workspaces não audita a própria remoção, e não é preguiça: a trilha
    -- referencia o workspace e cai junto no cascade, então a linha nasceria
    -- apontando para algo que já não existe — o INSERT falha na chave
    -- estrangeira e a remoção inteira é revertida. Quem registra o fim de um
    -- cliente é credit_admin_log, que é da plataforma e sobrevive a ele.
    EXECUTE format(
      'CREATE TRIGGER trg_auditar AFTER INSERT OR UPDATE %s ON public.%I
         FOR EACH ROW EXECUTE FUNCTION auditar_mudanca()',
      CASE WHEN t = 'workspaces' THEN '' ELSE 'OR DELETE' END, t);
  END LOOP;
END $$;

-- ── Quem lê ──────────────────────────────────────────────────────────
ALTER TABLE workspace_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ler_trilha_do_meu_workspace ON workspace_audit_log;
CREATE POLICY ler_trilha_do_meu_workspace ON workspace_audit_log
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT get_my_workspace_ids()) AND get_my_role() = 'admin');

-- Nenhuma policy de INSERT/UPDATE/DELETE, e isso é intencional: quem escreve é
-- o gatilho, que roda como dono da tabela e não passa por RLS.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON workspace_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON workspace_audit_log TO authenticated;

-- ── O que faz dela uma trilha ────────────────────────────────────────
-- Um log que pode ser editado depois não serve para resolver divergência: a
-- primeira coisa que alguém faria ao apagar um rastro é apagar o rastro. Nem
-- a service role passa daqui, porque um gatilho não é RLS.
--
-- A exceção é o fim do próprio workspace. Um gatilho de linha DISPARA no
-- cascade, então um bloqueio total tornaria o workspace indelével — a trilha
-- seguraria o cliente no banco para sempre. A regra fica explícita: a linha só
-- pode sair quando o workspace dela já não existe, o que só acontece dentro do
-- cascade da remoção. Apagar o cliente apaga a história dele; apagar a
-- história sem apagar o cliente, não.
CREATE OR REPLACE FUNCTION trilha_e_imutavel()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'workspace_audit_log e imutavel: % nao e permitido', TG_OP;
END $$;

DROP TRIGGER IF EXISTS trg_trilha_imutavel ON workspace_audit_log;
CREATE TRIGGER trg_trilha_imutavel
  BEFORE UPDATE OR DELETE ON workspace_audit_log
  FOR EACH ROW EXECUTE FUNCTION trilha_e_imutavel();

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_ws     uuid;
  v_dep    uuid;
  v_n      integer;
  v_campos text[];
  v_tok    jsonb;
  v_ok     boolean;
  v_user   uuid;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__teste_trilha_ws__', 'TSTWAL') RETURNING id INTO v_ws;

  -- 1. Criar registra. Filtrando pelo registro e não só pela tabela: criar um
  --    workspace já semeia setores padrão, e contar a tabela inteira contaria
  --    os que o próprio banco criou.
  INSERT INTO departments (workspace_id, name) VALUES (v_ws, 'Setor de teste') RETURNING id INTO v_dep;
  SELECT count(*) INTO v_n FROM workspace_audit_log
   WHERE workspace_id = v_ws AND tabela = 'departments' AND acao = 'criado'
     AND registro_id = v_dep::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'criacao nao registrou: % linhas', v_n; END IF;

  -- 2. Alterar registra QUAIS campos mudaram.
  UPDATE departments SET name = 'Setor renomeado' WHERE id = v_dep;
  SELECT campos INTO v_campos FROM workspace_audit_log
   WHERE workspace_id = v_ws AND tabela = 'departments' AND acao = 'alterado'
     AND registro_id = v_dep::text LIMIT 1;
  IF v_campos IS NULL OR NOT ('name' = ANY(v_campos)) THEN
    RAISE EXCEPTION 'alteracao nao registrou o campo: %', v_campos;
  END IF;

  -- 3. Gravar o mesmo valor de novo NÃO vira linha. Sem isto a trilha enche de
  --    "alterou" que não alterou nada e deixa de ser legível.
  SELECT count(*) INTO v_n FROM workspace_audit_log WHERE workspace_id = v_ws;
  UPDATE departments SET name = 'Setor renomeado' WHERE id = v_dep;
  IF (SELECT count(*) FROM workspace_audit_log WHERE workspace_id = v_ws) <> v_n THEN
    RAISE EXCEPTION 'gravacao sem mudanca virou linha na trilha';
  END IF;

  -- 4. O segredo não entra, e o resto entra. É a asseveração que mais importa:
  --    esses tokens são a credencial de envio e o magic link do convite.
  INSERT INTO z_api_connections (workspace_id, name, instance_id, token, client_token)
  VALUES (v_ws, 'Conexao de teste', 'inst-teste', 'segredo-nao-pode-vazar-123', 'outro-segredo-456');
  SELECT depois INTO v_tok FROM workspace_audit_log
   WHERE workspace_id = v_ws AND tabela = 'z_api_connections' LIMIT 1;
  IF v_tok IS NULL THEN RAISE EXCEPTION 'conexao nao registrou'; END IF;
  IF v_tok->>'token' = 'segredo-nao-pode-vazar-123'
     OR v_tok->>'client_token' = 'outro-segredo-456' THEN
    RAISE EXCEPTION 'VAZAMENTO: credencial foi parar na trilha';
  END IF;
  IF v_tok->>'name' <> 'Conexao de teste' THEN
    RAISE EXCEPTION 'ocultou demais: perdeu o nome da conexao';
  END IF;

  -- 4b. O convite, que é o buraco que originou esta migration. Depende de um
  --     usuário existir, porque invited_by é obrigatório — num banco recém
  --     criado não há nenhum, e aí a asseveração se cala em vez de mentir.
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NOT NULL THEN
    INSERT INTO workspace_invites (workspace_id, email, role, token, expires_at, invited_by)
    VALUES (v_ws, 'teste@exemplo.invalido', 'agent', 'magic-link-nao-pode-vazar', now() + interval '1 day', v_user);
    SELECT depois INTO v_tok FROM workspace_audit_log
     WHERE workspace_id = v_ws AND tabela = 'workspace_invites' LIMIT 1;
    IF v_tok IS NULL THEN RAISE EXCEPTION 'convite nao registrou'; END IF;
    IF v_tok->>'token' = 'magic-link-nao-pode-vazar' THEN
      RAISE EXCEPTION 'VAZAMENTO: o magic link do convite foi parar na trilha';
    END IF;
    IF v_tok->>'email' <> 'teste@exemplo.invalido' THEN
      RAISE EXCEPTION 'ocultou demais: perdeu o email do convidado';
    END IF;
  ELSE
    RAISE WARNING 'trilha: sem usuario no banco, asseveracao do convite pulada';
  END IF;

  -- 5. Remover registra.
  DELETE FROM departments WHERE id = v_dep;
  SELECT count(*) INTO v_n FROM workspace_audit_log
   WHERE workspace_id = v_ws AND tabela = 'departments' AND acao = 'removido'
     AND registro_id = v_dep::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'remocao nao registrou'; END IF;

  -- 6. A trilha não se deixa reescrever.
  v_ok := false;
  BEGIN
    UPDATE workspace_audit_log SET ator_email = 'outro@exemplo.invalido' WHERE workspace_id = v_ws;
  EXCEPTION WHEN raise_exception THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'a trilha aceitou ser editada'; END IF;

  v_ok := false;
  BEGIN
    DELETE FROM workspace_audit_log WHERE workspace_id = v_ws;
  EXCEPTION WHEN raise_exception THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'a trilha aceitou ser apagada'; END IF;

  -- 7. E ainda assim o workspace tem que conseguir morrer, levando a trilha
  --    junto. É o outro lado da asseveração 6, e a que eu errei primeiro: um
  --    bloqueio total de DELETE deixaria todo workspace indelével.
  DELETE FROM workspace_invites WHERE workspace_id = v_ws;
  DELETE FROM z_api_connections WHERE workspace_id = v_ws;
  DELETE FROM workspaces WHERE id = v_ws;
  SELECT count(*) INTO v_n FROM workspace_audit_log WHERE workspace_id = v_ws;
  IF v_n <> 0 THEN RAISE EXCEPTION 'trilha sobreviveu ao fim do workspace: % linhas', v_n; END IF;

  RAISE LOG 'trilha do workspace: 7 asseveracoes passaram';
END $$;
