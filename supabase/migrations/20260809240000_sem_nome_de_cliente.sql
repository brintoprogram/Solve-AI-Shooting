-- Tira nome de cliente real dos padrões e comentários do banco.
--
-- O padrão de routing_header era 'Olá! Bem-vindo(a) à COHAB-SP.' — o nome de um
-- cliente antigo. Os workspaces que existem hoje já foram corrigidos à mão, mas
-- o PADRÃO continuava lá: todo workspace novo nascia com ele, e essa saudação
-- não fica na tela — é a primeira mensagem que o cliente final recebe no
-- WhatsApp quando o menu de setores está ativo.
--
-- Ficou mais perigoso agora que existe tela de criar workspace: antes era um
-- INSERT manual, com alguém olhando; agora é um botão.

ALTER TABLE workspaces
  ALTER COLUMN routing_header SET DEFAULT 'Olá! Bem-vindo(a).';

-- O comentário da coluna citava dois clientes como exemplo de código.
COMMENT ON COLUMN workspaces.codigo IS
  'Identificador curto e legível do cliente, de 2 a 12 caracteres maiúsculos. Único.';

-- Rede de segurança para o que já existe: se algum workspace ainda carrega o
-- nome antigo, some agora. Não é hipotético — foi assim que o padrão se
-- espalhou para os três que existem.
UPDATE workspaces
   SET routing_header = 'Olá! Bem-vindo(a).'
 WHERE routing_header ILIKE '%cohab%';

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_padrao text;
  v_sujos  integer;
  v_ws     uuid;
  v_novo   text;
BEGIN
  SELECT column_default INTO v_padrao
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'workspaces'
     AND column_name = 'routing_header';
  IF v_padrao ILIKE '%cohab%' THEN
    RAISE EXCEPTION 'o padrao ainda cita um cliente: %', v_padrao;
  END IF;

  SELECT count(*) INTO v_sujos FROM workspaces WHERE routing_header ILIKE '%cohab%';
  IF v_sujos > 0 THEN RAISE EXCEPTION '% workspace(s) ainda com o nome antigo', v_sujos; END IF;

  -- Prova pelo caminho real: cria um workspace e confere com o que ele nasce.
  -- Conferir só o `column_default` provaria o texto do schema, não o efeito.
  INSERT INTO workspaces (name, codigo) VALUES ('__teste_saudacao__', 'TSTSAU') RETURNING id INTO v_ws;
  SELECT routing_header INTO v_novo FROM workspaces WHERE id = v_ws;
  IF v_novo ILIKE '%cohab%' OR v_novo ILIKE '%nitro%' THEN
    RAISE EXCEPTION 'workspace novo nasceu com nome de cliente: %', v_novo;
  END IF;
  DELETE FROM workspaces WHERE id = v_ws;

  RAISE LOG 'saudacao padrao sem nome de cliente: 3 asseveracoes passaram';
END $$;
