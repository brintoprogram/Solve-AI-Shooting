-- ══════════════════════════════════════════════════════════════════
-- RLS Security Migration — 2026-04-28
-- Objetivo: isolar dados por workspace e bloquear escalada de cargos
-- via console ou chamadas diretas à API.
--
-- IMPORTANTE: edge functions usam SUPABASE_SERVICE_ROLE_KEY e
-- SEMPRE ignoram RLS — o código server-side não é afetado.
-- Apenas requisições via anon key (browser) são afetadas.
-- ══════════════════════════════════════════════════════════════════

-- ── Helper: retorna os workspace_ids do usuário autenticado ───────
-- SECURITY DEFINER: roda com permissões do criador, evitando
-- dependência circular se workspace_members também tiver RLS.
CREATE OR REPLACE FUNCTION get_my_workspace_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid();
$$;

-- ══════════════════════════════════════════════════════════════════
-- 1. user_profiles — impede escalada de cargo via console
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Usuário vê o próprio perfil + perfis de membros do mesmo workspace
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

-- Apenas admins do mesmo workspace podem alterar role/permissions
-- Isso bloqueia: db.from("user_profiles").update({ role:"admin" }).eq("id", myId)
DROP POLICY IF EXISTS "profiles_update_admin_only" ON user_profiles;
CREATE POLICY "profiles_update_admin_only" ON user_profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM workspace_members wm_caller
      JOIN workspace_members wm_target ON wm_caller.workspace_id = wm_target.workspace_id
      JOIN user_profiles    up_caller  ON up_caller.id = wm_caller.user_id
      WHERE wm_caller.user_id  = auth.uid()
        AND wm_target.user_id  = user_profiles.id
        AND up_caller.role     = 'admin'
    )
  );

-- ══════════════════════════════════════════════════════════════════
-- 2. shooting_campaigns — isolamento por workspace
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE shooting_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaigns_workspace_isolation" ON shooting_campaigns;
CREATE POLICY "campaigns_workspace_isolation" ON shooting_campaigns
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 3. shooting_messages — isolamento por workspace
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE shooting_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_workspace_isolation" ON shooting_messages;
CREATE POLICY "messages_workspace_isolation" ON shooting_messages
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 4. inbox_conversations — isolamento por workspace
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE inbox_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbox_convs_workspace_isolation" ON inbox_conversations;
CREATE POLICY "inbox_convs_workspace_isolation" ON inbox_conversations
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 5. inbox_messages — isolamento por workspace
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE inbox_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbox_msgs_workspace_isolation" ON inbox_messages;
CREATE POLICY "inbox_msgs_workspace_isolation" ON inbox_messages
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 6. inbox_contacts — isolamento por workspace
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE inbox_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contacts_workspace_isolation" ON inbox_contacts;
CREATE POLICY "contacts_workspace_isolation" ON inbox_contacts
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 7. contact_invoices — isolamento por workspace
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE contact_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_workspace_isolation" ON contact_invoices;
CREATE POLICY "invoices_workspace_isolation" ON contact_invoices
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 8. contact_notes — isolamento por workspace
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notes_workspace_isolation" ON contact_notes;
CREATE POLICY "notes_workspace_isolation" ON contact_notes
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 9. meta_connections — isolamento por workspace (contém tokens!)
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE meta_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta_conn_workspace_isolation" ON meta_connections;
CREATE POLICY "meta_conn_workspace_isolation" ON meta_connections
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 10. meta_templates — isolamento por workspace
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE meta_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta_tpl_workspace_isolation" ON meta_templates;
CREATE POLICY "meta_tpl_workspace_isolation" ON meta_templates
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 11. workspace_invites — apenas membros do workspace veem convites
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invites_workspace_isolation" ON workspace_invites;
CREATE POLICY "invites_workspace_isolation" ON workspace_invites
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 12. email_campaigns / email_messages / email_connections
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_campaigns_isolation" ON email_campaigns;
CREATE POLICY "email_campaigns_isolation" ON email_campaigns
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_messages_isolation" ON email_messages;
CREATE POLICY "email_messages_isolation" ON email_messages
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_connections_isolation" ON email_connections;
CREATE POLICY "email_connections_isolation" ON email_connections
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ══════════════════════════════════════════════════════════════════
-- 13. audit_logs — apenas leitura pelo próprio workspace
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_logs_workspace_isolation" ON audit_logs;
CREATE POLICY "audit_logs_workspace_isolation" ON audit_logs
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));
