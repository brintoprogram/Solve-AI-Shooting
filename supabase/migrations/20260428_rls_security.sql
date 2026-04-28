-- ══════════════════════════════════════════════════════════════════
-- RLS Security Migration — 2026-04-28
-- ══════════════════════════════════════════════════════════════════

-- DROP primeiro para evitar "cannot change return type" se a função
-- já existir com RETURNS SETOF TEXT de tentativas anteriores.
-- CASCADE remove automaticamente qualquer política que dependa dela.
DROP FUNCTION IF EXISTS get_my_workspace_ids() CASCADE;

-- Retorna SETOF UUID (workspace_members.workspace_id é UUID).
-- user_id = auth.uid() → UUID = UUID, sem cast necessário.
CREATE FUNCTION get_my_workspace_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid();
$$;

-- Todas as políticas usam workspace_id::uuid para ser agnóstico ao
-- tipo da coluna: UUID→UUID é no-op; TEXT→UUID converte (audit_logs).

-- ══════════════════════════════════════════════════════════════════
-- 1. user_profiles — impede escalada de cargo via console
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON user_profiles;
CREATE POLICY "profiles_select" ON user_profiles
  FOR SELECT USING (
    id = auth.uid()
    OR id IN (
      SELECT wm2.user_id
      FROM workspace_members wm1
      JOIN workspace_members wm2 USING (workspace_id)
      WHERE wm1.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "profiles_update_admin_only" ON user_profiles;
CREATE POLICY "profiles_update_admin_only" ON user_profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM workspace_members wm_caller
      JOIN workspace_members wm_target USING (workspace_id)
      JOIN user_profiles    up_caller  ON up_caller.id = wm_caller.user_id
      WHERE wm_caller.user_id = auth.uid()
        AND wm_target.user_id = user_profiles.id
        AND up_caller.role    = 'admin'
    )
  );

-- ══════════════════════════════════════════════════════════════════
-- 2. shooting_campaigns
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE shooting_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaigns_workspace_isolation" ON shooting_campaigns;
CREATE POLICY "campaigns_workspace_isolation" ON shooting_campaigns
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 3. shooting_messages
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE shooting_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_workspace_isolation" ON shooting_messages;
CREATE POLICY "messages_workspace_isolation" ON shooting_messages
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 4. inbox_conversations
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE inbox_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbox_convs_workspace_isolation" ON inbox_conversations;
CREATE POLICY "inbox_convs_workspace_isolation" ON inbox_conversations
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 5. inbox_messages
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE inbox_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbox_msgs_workspace_isolation" ON inbox_messages;
CREATE POLICY "inbox_msgs_workspace_isolation" ON inbox_messages
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 6. inbox_contacts
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE inbox_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contacts_workspace_isolation" ON inbox_contacts;
CREATE POLICY "contacts_workspace_isolation" ON inbox_contacts
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 7. contact_invoices
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE contact_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoices_workspace_isolation" ON contact_invoices;
CREATE POLICY "invoices_workspace_isolation" ON contact_invoices
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 8. contact_notes
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notes_workspace_isolation" ON contact_notes;
CREATE POLICY "notes_workspace_isolation" ON contact_notes
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 9. meta_connections
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE meta_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meta_conn_workspace_isolation" ON meta_connections;
CREATE POLICY "meta_conn_workspace_isolation" ON meta_connections
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 10. meta_templates
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE meta_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meta_tpl_workspace_isolation" ON meta_templates;
CREATE POLICY "meta_tpl_workspace_isolation" ON meta_templates
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 11. workspace_invites
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invites_workspace_isolation" ON workspace_invites;
CREATE POLICY "invites_workspace_isolation" ON workspace_invites
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 12. email_campaigns / email_messages / email_connections
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_campaigns_isolation" ON email_campaigns;
CREATE POLICY "email_campaigns_isolation" ON email_campaigns
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_messages_isolation" ON email_messages;
CREATE POLICY "email_messages_isolation" ON email_messages
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_connections_isolation" ON email_connections;
CREATE POLICY "email_connections_isolation" ON email_connections
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 13. audit_logs — workspace_id é TEXT aqui; ::uuid converte
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_logs_workspace_isolation" ON audit_logs;
CREATE POLICY "audit_logs_workspace_isolation" ON audit_logs
  FOR ALL USING (workspace_id::uuid IN (SELECT get_my_workspace_ids()));
