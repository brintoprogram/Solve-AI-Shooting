-- Convite por link compartilhável — para mandar no WhatsApp.
--
-- O convite por e-mail continua existindo e não muda. Ele tem uma propriedade
-- que o link não tem: a identidade de quem entra é provada por receber o
-- e-mail. Num link, quem tiver o link entra. É por isso que este arquivo é
-- mais sobre limites do que sobre a funcionalidade.
--
-- As travas, e o porquê de cada uma:
--
--   max_uses     Padrão 1. É a trava mais importante. Um link encaminhado num
--                grupo de WhatsApp, printado ou vazado de qualquer forma já
--                está morto assim que a pessoa certa entrou.
--   expires_at   Padrão 7 dias. Link esquecido em conversa antiga não pode
--                continuar valendo.
--   revoked_at   Mata o link na hora, sem depender de expirar.
--   role         Fixo na criação. Quem cria escolhe uma vez; quem usa não
--                escolhe nada.
--   uses         Contado no banco, não no aplicativo — ver consumir_convite_link.
--
-- E a trava que NÃO existe de propósito: não há como saber de antemão quem vai
-- clicar. Um link é isso. Quem quer garantir a identidade de quem entra usa o
-- convite por e-mail, que continua ali.

CREATE TABLE IF NOT EXISTS workspace_invite_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  /* 32 bytes = 256 bits. Não é adivinhável, e é por isso que o nome do
     workspace pode aparecer na tela de quem abre o link sem ser um vazamento:
     ninguém chega nesta linha sem já ter o link. */
  token        text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  role         text NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'manager', 'agent')),
  /* Para quem criou lembrar, meses depois, para que serviu. */
  label        text,
  max_uses     integer NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 100),
  uses         integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_by   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_links_ws ON workspace_invite_links (workspace_id, created_at DESC);

COMMENT ON TABLE workspace_invite_links IS
  'Links de convite compartilhaveis. Diferente de workspace_invites: nao tem e-mail, entao quem tiver o link entra. max_uses e expires_at sao o que segura isso.';
COMMENT ON COLUMN workspace_invite_links.max_uses IS
  'Quantas pessoas o link aceita. Padrao 1: link vazado depois do uso legitimo nao serve para nada.';

-- Quem entrou por qual link. Sem isto, um link com max_uses=10 vira dez
-- pessoas dentro do workspace sem registro de quem eram.
CREATE TABLE IF NOT EXISTS workspace_invite_link_uses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id      uuid NOT NULL REFERENCES workspace_invite_links(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email        text,
  criou_conta  boolean NOT NULL DEFAULT false,
  user_agent   text,
  used_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_link_uses_link ON workspace_invite_link_uses (link_id);

COMMENT ON TABLE workspace_invite_link_uses IS
  'Quem entrou por qual link, e quando. Registro: nao se reescreve.';

-- ── RLS ──────────────────────────────────────────────────────────────
-- A linha CONTÉM o token. Quem enxerga a linha consegue entrar no workspace,
-- então "quem pode ver" aqui é a mesma pergunta que "quem pode convidar".
-- Agente não convida, logo agente não vê.
ALTER TABLE workspace_invite_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_invite_link_uses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "links_visiveis_a_quem_convida" ON workspace_invite_links;
CREATE POLICY "links_visiveis_a_quem_convida" ON workspace_invite_links
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM workspace_members m
             WHERE m.workspace_id = workspace_invite_links.workspace_id
               AND m.user_id = auth.uid()
               AND m.role IN ('admin', 'manager'))
  );

DROP POLICY IF EXISTS "usos_visiveis_a_quem_convida" ON workspace_invite_link_uses;
CREATE POLICY "usos_visiveis_a_quem_convida" ON workspace_invite_link_uses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM workspace_members m
             WHERE m.workspace_id = workspace_invite_link_uses.workspace_id
               AND m.user_id = auth.uid()
               AND m.role IN ('admin', 'manager'))
  );

-- Nenhuma policy de INSERT/UPDATE/DELETE, de propósito: criar e revogar passa
-- pela edge function, que confere o cargo de quem pediu. O frontend não
-- escreve aqui nem com sessão de admin.

-- ── Consumo ──────────────────────────────────────────────────────────
-- A conta de usos vive no banco porque é uma corrida: duas pessoas abrindo o
-- mesmo link de max_uses=1 no mesmo segundo. Lido no aplicativo — "busca,
-- confere, incrementa" — as duas leem uses=0 e as duas entram.
--
-- Um UPDATE ... WHERE uses < max_uses RETURNING resolve isso sozinho: no
-- READ COMMITTED, a segunda transação espera o lock da primeira e reavalia o
-- WHERE contra a linha já atualizada. Não sobra brecha entre conferir e
-- incrementar porque não há "entre".
CREATE OR REPLACE FUNCTION consumir_convite_link(p_token text)
RETURNS TABLE (link_id uuid, ws_id uuid, papel text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE workspace_invite_links l
     SET uses = l.uses + 1
   WHERE l.token = p_token
     AND l.revoked_at IS NULL
     AND l.expires_at > now()
     AND l.uses < l.max_uses
  RETURNING l.id, l.workspace_id, l.role;
$$;

COMMENT ON FUNCTION consumir_convite_link(text) IS
  'Gasta um uso do link, atomicamente. Zero linhas = link invalido, expirado, revogado ou esgotado. Chamada so pela edge function.';

-- Espiar não gasta uso: a pessoa precisa ver "você foi convidado para X" antes
-- de decidir entrar, e ver a tela não pode queimar o convite.
CREATE OR REPLACE FUNCTION espiar_convite_link(p_token text)
RETURNS TABLE (ws_id uuid, ws_nome text, papel text, valido boolean, motivo text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.name, l.role,
         (l.revoked_at IS NULL AND l.expires_at > now() AND l.uses < l.max_uses),
         CASE
           WHEN l.revoked_at IS NOT NULL   THEN 'revogado'
           WHEN l.expires_at <= now()      THEN 'expirado'
           WHEN l.uses >= l.max_uses       THEN 'esgotado'
           ELSE NULL
         END
    FROM workspace_invite_links l
    JOIN workspaces w ON w.id = l.workspace_id
   WHERE l.token = p_token;
$$;

COMMENT ON FUNCTION espiar_convite_link(text) IS
  'Estado do link sem gastar uso. Devolve so nome do workspace e cargo — nada sobre membros, cobranca ou quem criou.';

-- Só a edge function chama. Nem anon nem authenticated tocam nestas funções:
-- se o frontend pudesse chamar consumir_convite_link direto, qualquer um
-- entraria em qualquer workspace tendo só o token, sem passar pela conferência
-- de cargo e sem deixar registro em workspace_invite_link_uses.
REVOKE ALL ON FUNCTION consumir_convite_link(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION espiar_convite_link(text)   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION consumir_convite_link(text) TO service_role;
GRANT EXECUTE ON FUNCTION espiar_convite_link(text)   TO service_role;

-- ── Verificação ──────────────────────────────────────────────────────
DO $teste$
DECLARE
  v_ws    uuid;
  v_user  uuid;
  v_tok   text;
  v_n     integer;
  v_valido boolean;
  v_motivo text;
BEGIN
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN
    RAISE WARNING 'sem usuarios em auth.users — verificacao pulada';
    RETURN;
  END IF;

  INSERT INTO workspaces (name, codigo) VALUES ('__link__', 'LINKTS') RETURNING id INTO v_ws;

  -- 1. Link de uso único: entra um, o segundo bate na porta.
  INSERT INTO workspace_invite_links (workspace_id, role, created_by, max_uses)
  VALUES (v_ws, 'agent', v_user, 1) RETURNING token INTO v_tok;

  SELECT count(*) INTO v_n FROM consumir_convite_link(v_tok);
  IF v_n <> 1 THEN RAISE EXCEPTION 'primeiro uso recusado (veio %)', v_n; END IF;

  SELECT count(*) INTO v_n FROM consumir_convite_link(v_tok);
  IF v_n <> 0 THEN RAISE EXCEPTION 'SEGUNDO uso aceito num link de uso unico'; END IF;

  SELECT valido, motivo INTO v_valido, v_motivo FROM espiar_convite_link(v_tok);
  IF v_valido OR v_motivo <> 'esgotado' THEN
    RAISE EXCEPTION 'link esgotado nao se declara esgotado: valido=% motivo=%', v_valido, v_motivo;
  END IF;

  -- 2. max_uses respeitado exatamente: 3 entram, o 4o nao.
  INSERT INTO workspace_invite_links (workspace_id, role, created_by, max_uses)
  VALUES (v_ws, 'agent', v_user, 3) RETURNING token INTO v_tok;
  FOR i IN 1..3 LOOP
    SELECT count(*) INTO v_n FROM consumir_convite_link(v_tok);
    IF v_n <> 1 THEN RAISE EXCEPTION 'uso % de 3 recusado', i; END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM consumir_convite_link(v_tok);
  IF v_n <> 0 THEN RAISE EXCEPTION 'quarto uso aceito num link de 3'; END IF;

  -- 3. Expirado nao entra.
  INSERT INTO workspace_invite_links (workspace_id, role, created_by, expires_at)
  VALUES (v_ws, 'agent', v_user, now() - interval '1 minute') RETURNING token INTO v_tok;
  SELECT count(*) INTO v_n FROM consumir_convite_link(v_tok);
  IF v_n <> 0 THEN RAISE EXCEPTION 'link expirado foi aceito'; END IF;
  SELECT motivo INTO v_motivo FROM espiar_convite_link(v_tok);
  IF v_motivo <> 'expirado' THEN RAISE EXCEPTION 'expirado diz "%"', v_motivo; END IF;

  -- 4. Revogado nao entra, mesmo dentro do prazo e com uso sobrando.
  INSERT INTO workspace_invite_links (workspace_id, role, created_by, revoked_at)
  VALUES (v_ws, 'agent', v_user, now()) RETURNING token INTO v_tok;
  SELECT count(*) INTO v_n FROM consumir_convite_link(v_tok);
  IF v_n <> 0 THEN RAISE EXCEPTION 'link revogado foi aceito'; END IF;

  -- 5. Espiar nao gasta uso. Se gastasse, abrir a tela queimaria o convite.
  INSERT INTO workspace_invite_links (workspace_id, role, created_by, max_uses)
  VALUES (v_ws, 'manager', v_user, 1) RETURNING token INTO v_tok;
  PERFORM espiar_convite_link(v_tok);
  PERFORM espiar_convite_link(v_tok);
  PERFORM espiar_convite_link(v_tok);
  SELECT uses INTO v_n FROM workspace_invite_links WHERE token = v_tok;
  IF v_n <> 0 THEN RAISE EXCEPTION 'espiar gastou % uso(s)', v_n; END IF;
  SELECT papel INTO v_motivo FROM espiar_convite_link(v_tok);
  IF v_motivo <> 'manager' THEN RAISE EXCEPTION 'cargo do link veio errado: %', v_motivo; END IF;

  -- 6. Token inexistente nao devolve nada — e nao explode.
  SELECT count(*) INTO v_n FROM consumir_convite_link('nao-existe');
  IF v_n <> 0 THEN RAISE EXCEPTION 'token inventado foi aceito'; END IF;
  SELECT count(*) INTO v_n FROM espiar_convite_link('nao-existe');
  IF v_n <> 0 THEN RAISE EXCEPTION 'espiar devolveu linha para token inventado'; END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'convite por link: uso unico, max_uses, expiracao, revogacao e espiar-sem-gastar conferidos';
END
$teste$;
