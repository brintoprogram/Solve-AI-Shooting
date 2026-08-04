-- ══════════════════════════════════════════════════════════════════
-- Departments (Setores) — 2026-05-05
-- ══════════════════════════════════════════════════════════════════

-- Tabela de setores/departamentos por workspace
CREATE TABLE IF NOT EXISTS departments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '#6366f1',
  description  TEXT,
  order_index  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_workspace_access" ON departments;
CREATE POLICY "departments_workspace_access" ON departments FOR ALL
  USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- Agente pertence a um setor
ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

-- Conversa pertence a um setor (null = fila central / não roteada)
ALTER TABLE inbox_conversations
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

-- Configuração de roteamento automático no workspace
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS routing_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS routing_header  TEXT NOT NULL DEFAULT 'Olá! Bem-vindo(a) à COHAB-SP.',
  ADD COLUMN IF NOT EXISTS routing_body    TEXT NOT NULL DEFAULT 'Sobre qual assunto podemos te ajudar? Escolha uma opção abaixo:';

-- Índice para queries de inbox filtradas por setor
CREATE INDEX IF NOT EXISTS idx_inbox_conversations_department
  ON inbox_conversations (workspace_id, department_id);
