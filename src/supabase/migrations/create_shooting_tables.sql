-- ============================================================
-- Solve AI Shooting — Database Migration
-- ============================================================

-- Meta connections
CREATE TABLE IF NOT EXISTS meta_connections (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id        UUID NOT NULL,
  waba_id             TEXT NOT NULL,
  phone_number_id     TEXT NOT NULL,
  display_phone       TEXT NOT NULL,
  business_name       TEXT,
  access_token        TEXT NOT NULL,
  token_expires_at    TIMESTAMPTZ,
  webhook_verify_token TEXT NOT NULL,
  status              TEXT DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'token_expired')),
  quality_rating      TEXT CHECK (quality_rating IN ('GREEN', 'YELLOW', 'RED')),
  messaging_limit     TEXT CHECK (messaging_limit IN ('TIER_1K', 'TIER_10K', 'TIER_100K', 'UNLIMITED')),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, phone_number_id)
);

-- Meta templates cache
CREATE TABLE IF NOT EXISTS meta_templates (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id         UUID NOT NULL,
  meta_connection_id   UUID NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  template_name        TEXT NOT NULL,
  template_id          TEXT NOT NULL,
  language             TEXT NOT NULL DEFAULT 'pt_BR',
  category             TEXT NOT NULL CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  status               TEXT NOT NULL CHECK (status IN ('APPROVED', 'PENDING', 'REJECTED')),
  components           JSONB NOT NULL DEFAULT '[]',
  quality_score        JSONB,
  last_synced_at       TIMESTAMPTZ DEFAULT NOW(),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (meta_connection_id, template_id)
);

-- Shooting campaigns
CREATE TABLE IF NOT EXISTS shooting_campaigns (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id         UUID NOT NULL,
  meta_connection_id   UUID NOT NULL REFERENCES meta_connections(id),
  name                 TEXT NOT NULL,
  template_id          UUID NOT NULL REFERENCES meta_templates(id),
  data_source          TEXT NOT NULL CHECK (data_source IN ('contacts', 'xlsx_upload')),
  column_mapping       JSONB NOT NULL DEFAULT '{}',
  filters              JSONB DEFAULT '{}',
  total_recipients     INT DEFAULT 0,
  status               TEXT DEFAULT 'draft' CHECK (status IN (
    'draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled', 'failed'
  )),
  scheduled_at         TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  sent_count           INT DEFAULT 0,
  delivered_count      INT DEFAULT 0,
  read_count           INT DEFAULT 0,
  replied_count        INT DEFAULT 0,
  failed_count         INT DEFAULT 0,
  error_summary        JSONB DEFAULT '{}',
  sending_speed        INT DEFAULT 80,
  created_by           UUID,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Individual messages
CREATE TABLE IF NOT EXISTS shooting_messages (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id       UUID NOT NULL REFERENCES shooting_campaigns(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL,
  recipient_phone   TEXT NOT NULL,
  recipient_name    TEXT,
  recipient_data    JSONB DEFAULT '{}',
  wamid             TEXT,
  status            TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'sent', 'delivered', 'read', 'replied', 'failed', 'undeliverable'
  )),
  sent_at           TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  read_at           TIMESTAMPTZ,
  replied_at        TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  error_code        TEXT,
  error_message     TEXT,
  error_details     JSONB,
  retry_count       INT DEFAULT 0,
  max_retries       INT DEFAULT 3,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- XLSX uploads
CREATE TABLE IF NOT EXISTS shooting_uploads (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id       UUID REFERENCES shooting_campaigns(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL,
  file_name         TEXT NOT NULL,
  file_url          TEXT NOT NULL,
  total_rows        INT DEFAULT 0,
  valid_rows        INT DEFAULT 0,
  invalid_rows      INT DEFAULT 0,
  column_headers    TEXT[] DEFAULT '{}',
  preview_data      JSONB DEFAULT '[]',
  validation_errors JSONB DEFAULT '[]',
  processed         BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook events log
CREATE TABLE IF NOT EXISTS webhook_events (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id         UUID NOT NULL,
  meta_connection_id   UUID NOT NULL,
  event_type           TEXT NOT NULL,
  wamid                TEXT,
  payload              JSONB NOT NULL,
  processed            BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_shooting_messages_campaign   ON shooting_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_shooting_messages_status     ON shooting_messages(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_shooting_messages_wamid      ON shooting_messages(wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_wamid         ON webhook_events(wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meta_templates_workspace     ON meta_templates(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_shooting_campaigns_workspace ON shooting_campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_shooting_campaigns_status    ON shooting_campaigns(workspace_id, status);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE meta_connections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE shooting_campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE shooting_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE shooting_uploads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events        ENABLE ROW LEVEL SECURITY;

-- Helper function: get workspace_id for current user
CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT workspace_id
  FROM workspace_members
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- RLS policies — meta_connections
CREATE POLICY "workspace_access" ON meta_connections
  USING (workspace_id = current_workspace_id());

CREATE POLICY "workspace_insert" ON meta_connections
  FOR INSERT WITH CHECK (workspace_id = current_workspace_id());

CREATE POLICY "workspace_update" ON meta_connections
  FOR UPDATE USING (workspace_id = current_workspace_id());

CREATE POLICY "workspace_delete" ON meta_connections
  FOR DELETE USING (workspace_id = current_workspace_id());

-- RLS policies — meta_templates
CREATE POLICY "workspace_access" ON meta_templates
  USING (workspace_id = current_workspace_id());

CREATE POLICY "workspace_insert" ON meta_templates
  FOR INSERT WITH CHECK (workspace_id = current_workspace_id());

-- RLS policies — shooting_campaigns
CREATE POLICY "workspace_access" ON shooting_campaigns
  USING (workspace_id = current_workspace_id());

CREATE POLICY "workspace_insert" ON shooting_campaigns
  FOR INSERT WITH CHECK (workspace_id = current_workspace_id());

CREATE POLICY "workspace_update" ON shooting_campaigns
  FOR UPDATE USING (workspace_id = current_workspace_id());

CREATE POLICY "workspace_delete" ON shooting_campaigns
  FOR DELETE USING (workspace_id = current_workspace_id());

-- RLS policies — shooting_messages
CREATE POLICY "workspace_access" ON shooting_messages
  USING (workspace_id = current_workspace_id());

CREATE POLICY "workspace_insert" ON shooting_messages
  FOR INSERT WITH CHECK (workspace_id = current_workspace_id());

CREATE POLICY "workspace_update" ON shooting_messages
  FOR UPDATE USING (workspace_id = current_workspace_id());

-- RLS policies — shooting_uploads
CREATE POLICY "workspace_access" ON shooting_uploads
  USING (workspace_id = current_workspace_id());

CREATE POLICY "workspace_insert" ON shooting_uploads
  FOR INSERT WITH CHECK (workspace_id = current_workspace_id());

-- RLS policies — webhook_events
CREATE POLICY "workspace_access" ON webhook_events
  USING (workspace_id = current_workspace_id());

-- ============================================================
-- Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE shooting_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE shooting_campaigns;

-- ============================================================
-- RPC: increment campaign counters (avoids race conditions)
-- ============================================================
CREATE OR REPLACE FUNCTION increment_campaign_counters(
  p_campaign_id  UUID,
  p_counter_name TEXT,
  p_increment    INT DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE format(
    'UPDATE shooting_campaigns SET %I = COALESCE(%I, 0) + $1, updated_at = NOW() WHERE id = $2',
    p_counter_name, p_counter_name
  ) USING p_increment, p_campaign_id;
END;
$$;

-- ============================================================
-- Updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER shooting_campaigns_updated_at
  BEFORE UPDATE ON shooting_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER meta_connections_updated_at
  BEFORE UPDATE ON meta_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
