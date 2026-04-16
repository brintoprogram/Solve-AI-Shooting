export const SETUP_SQL = `-- =====================================================
-- Solve AI Shooting — Setup Automático
-- Cole este SQL no Editor SQL do Supabase e clique em Run
-- =====================================================

-- Conexões WhatsApp (Meta)
CREATE TABLE IF NOT EXISTS meta_connections (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id         UUID NOT NULL,
  waba_id              TEXT NOT NULL,
  phone_number_id      TEXT NOT NULL,
  display_phone        TEXT NOT NULL,
  business_name        TEXT,
  access_token         TEXT NOT NULL,
  token_expires_at     TIMESTAMPTZ,
  webhook_verify_token TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  status               TEXT DEFAULT 'active',
  quality_rating       TEXT,
  messaging_limit      TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, phone_number_id)
);

-- Templates da Meta (cache)
CREATE TABLE IF NOT EXISTS meta_templates (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id         UUID NOT NULL,
  meta_connection_id   UUID NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  template_name        TEXT NOT NULL,
  template_id          TEXT NOT NULL,
  language             TEXT NOT NULL DEFAULT 'pt_BR',
  category             TEXT NOT NULL,
  status               TEXT NOT NULL,
  components           JSONB NOT NULL DEFAULT '[]',
  quality_score        JSONB,
  last_synced_at       TIMESTAMPTZ DEFAULT NOW(),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (meta_connection_id, template_id)
);

-- Campanhas de disparo
CREATE TABLE IF NOT EXISTS shooting_campaigns (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id         UUID NOT NULL,
  meta_connection_id   UUID NOT NULL REFERENCES meta_connections(id),
  name                 TEXT NOT NULL,
  template_id          UUID NOT NULL REFERENCES meta_templates(id),
  data_source          TEXT NOT NULL,
  column_mapping       JSONB NOT NULL DEFAULT '{}',
  filters              JSONB DEFAULT '{}',
  total_recipients     INT DEFAULT 0,
  status               TEXT DEFAULT 'draft',
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

-- Mensagens individuais
CREATE TABLE IF NOT EXISTS shooting_messages (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id      UUID NOT NULL REFERENCES shooting_campaigns(id) ON DELETE CASCADE,
  workspace_id     UUID NOT NULL,
  recipient_phone  TEXT NOT NULL,
  recipient_name   TEXT,
  recipient_data   JSONB DEFAULT '{}',
  wamid            TEXT,
  status           TEXT DEFAULT 'pending',
  sent_at          TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  read_at          TIMESTAMPTZ,
  replied_at       TIMESTAMPTZ,
  failed_at        TIMESTAMPTZ,
  error_code       TEXT,
  error_message    TEXT,
  error_details    JSONB,
  retry_count      INT DEFAULT 0,
  max_retries      INT DEFAULT 3,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Uploads de planilha
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

-- Log de webhooks da Meta
CREATE TABLE IF NOT EXISTS webhook_events (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id       UUID NOT NULL,
  meta_connection_id UUID NOT NULL,
  event_type         TEXT NOT NULL,
  wamid              TEXT,
  payload            JSONB NOT NULL,
  processed          BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_shooting_messages_campaign   ON shooting_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_shooting_messages_status     ON shooting_messages(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_shooting_messages_wamid      ON shooting_messages(wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shooting_campaigns_workspace ON shooting_campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meta_templates_workspace     ON meta_templates(workspace_id, status);

-- Desabilita RLS (modo simples sem autenticação)
ALTER TABLE meta_connections   DISABLE ROW LEVEL SECURITY;
ALTER TABLE meta_templates     DISABLE ROW LEVEL SECURITY;
ALTER TABLE shooting_campaigns DISABLE ROW LEVEL SECURITY;
ALTER TABLE shooting_messages  DISABLE ROW LEVEL SECURITY;
ALTER TABLE shooting_uploads   DISABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events     DISABLE ROW LEVEL SECURITY;

-- Função para incrementar contadores (evita race conditions)
CREATE OR REPLACE FUNCTION increment_campaign_counters(
  p_campaign_id  UUID,
  p_counter_name TEXT,
  p_increment    INT DEFAULT 1
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  EXECUTE format(
    'UPDATE shooting_campaigns SET %I = COALESCE(%I, 0) + $1, updated_at = NOW() WHERE id = $2',
    p_counter_name, p_counter_name
  ) USING p_increment, p_campaign_id;
END;
$$;

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS shooting_campaigns_updated_at ON shooting_campaigns;
CREATE TRIGGER shooting_campaigns_updated_at
  BEFORE UPDATE ON shooting_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS meta_connections_updated_at ON meta_connections;
CREATE TRIGGER meta_connections_updated_at
  BEFORE UPDATE ON meta_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ativa Realtime nas tabelas principais
ALTER PUBLICATION supabase_realtime ADD TABLE shooting_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE shooting_campaigns;
`;

export const TABLES_TO_CHECK = [
  "meta_connections",
  "meta_templates",
  "shooting_campaigns",
  "shooting_messages",
  "shooting_uploads",
  "webhook_events",
] as const;
