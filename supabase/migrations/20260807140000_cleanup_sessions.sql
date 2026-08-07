-- Tabelas da "Limpeza de Base" — que nunca foram criadas.
--
-- Como isto foi descoberto: os erros de tipo em BaseCleanup.tsx diziam que
-- "workspace_id" não era uma coluna válida. Não era teimosia do TypeScript —
-- as tabelas simplesmente não existiam. Confirmado contra o banco: as duas
-- respondem 404 (tabela ausente do schema), não 200 vazio (tabela vazia).
--
-- A tela está renderizada em produção como uma aba de Contatos e todas as
-- consultas dela falham. O DDL existia, mas dentro daquele painel "SQL do
-- workspace" no frontend, com um botão Copiar e a instrução de rodar à mão no
-- SQL Editor. Ninguém rodou — e como o painel foi removido (era vazamento de
-- schema, e mandava desligar RLS), o DDL só sobreviveu no histórico do git.
--
-- Diferenças em relação ao DDL original, de propósito:
--
--   1. RLS LIGADA. O original tinha ALTER TABLE ... DISABLE ROW LEVEL SECURITY
--      nas duas, o que deixaria qualquer usuário autenticado ler a planilha de
--      qualquer outro cliente. Aqui vale o mesmo padrão do resto do schema.
--   2. workspace_id é UUID com FK, não TEXT solto. Como a tabela está sendo
--      criada agora, não há dado legado para acomodar.
--   3. session_id tem FK com ON DELETE CASCADE. Sem ela, apagar uma sessão
--      deixaria as linhas órfãs para sempre.

CREATE TABLE IF NOT EXISTS cleanup_sessions (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename      TEXT        NOT NULL,
  total         INTEGER     NOT NULL DEFAULT 0,
  valid         INTEGER     NOT NULL DEFAULT 0,
  invalid_phone INTEGER     NOT NULL DEFAULT 0,
  no_phone      INTEGER     NOT NULL DEFAULT 0,
  landline      INTEGER     NOT NULL DEFAULT 0,
  wa_valid      INTEGER     NOT NULL DEFAULT 0,
  wa_invalid    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cleanup_sessions_workspace
  ON cleanup_sessions (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cleanup_session_rows (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id    UUID        NOT NULL REFERENCES cleanup_sessions(id) ON DELETE CASCADE,
  row_index     INTEGER,
  row_data      JSONB       NOT NULL,
  name          TEXT,
  phone         TEXT,
  phone_norm    TEXT,
  phone_problem TEXT        DEFAULT 'ok',
  wa_status     TEXT        DEFAULT 'unknown',
  wa_checked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cleanup_rows_session
  ON cleanup_session_rows (session_id, row_index);

-- ── Isolamento entre clientes ────────────────────────────────────────
-- Uma planilha de higienização é a base de contatos do cliente: nome e
-- telefone de gente real. É exatamente o tipo de dado que não pode vazar
-- entre tenants.

ALTER TABLE cleanup_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleanup_session_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cleanup_sessions_membros ON cleanup_sessions;
CREATE POLICY cleanup_sessions_membros ON cleanup_sessions
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- As linhas não carregam workspace_id: a dona é a sessão. A política segue a
-- FK para não duplicar a coluna (e não correr o risco de as duas divergirem).
DROP POLICY IF EXISTS cleanup_rows_membros ON cleanup_session_rows;
CREATE POLICY cleanup_rows_membros ON cleanup_session_rows
  FOR ALL USING (
    session_id IN (
      SELECT id FROM cleanup_sessions
       WHERE workspace_id IN (SELECT get_my_workspace_ids())
    )
  );
