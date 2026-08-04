-- Portal de negociação de dívidas: negociações, histórico de ofertas,
-- regras por workspace e tokens do link público do cliente.

-- ── debt_negotiations ──────────────────────────────────────────────
CREATE TABLE debt_negotiations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id        UUID NOT NULL REFERENCES inbox_contacts(id) ON DELETE CASCADE,
  invoice_id        UUID NOT NULL REFERENCES contact_invoices(id) ON DELETE RESTRICT,
  conversation_id   UUID NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,

  status            TEXT NOT NULL DEFAULT 'triggered'
                     CHECK (status IN (
                       'triggered', 'ai_negotiating', 'awaiting_customer',
                       'escalated', 'human_negotiating',
                       'formalized', 'expired', 'cancelled'
                     )),

  original_amount   NUMERIC(15,2) NOT NULL CHECK (original_amount >= 0),
  offer_round       INT NOT NULL DEFAULT 0,

  agreed_amount         NUMERIC(15,2),
  agreed_installments   INT,
  agreed_first_due_date DATE,
  agreed_at             TIMESTAMPTZ,

  escalation_reason TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No máximo 1 negociação ativa por contato (mesmo com múltiplas faturas em aberto)
CREATE UNIQUE INDEX idx_debt_negotiations_active_contact
  ON debt_negotiations (contact_id)
  WHERE status NOT IN ('formalized', 'expired', 'cancelled');

CREATE INDEX idx_debt_negotiations_conversation ON debt_negotiations (conversation_id);
CREATE INDEX idx_debt_negotiations_invoice ON debt_negotiations (invoice_id);
CREATE INDEX idx_debt_negotiations_workspace_status ON debt_negotiations (workspace_id, status);

CREATE TRIGGER debt_negotiations_updated_at
  BEFORE UPDATE ON debt_negotiations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE debt_negotiations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "debt_negotiations_workspace_isolation" ON debt_negotiations
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ── negotiation_offers ─────────────────────────────────────────────
CREATE TABLE negotiation_offers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id        UUID NOT NULL REFERENCES debt_negotiations(id) ON DELETE CASCADE,
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  round                 INT NOT NULL,
  proposed_by           TEXT NOT NULL CHECK (proposed_by IN ('ai', 'customer', 'staff', 'system')),
  proposed_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  proposed_by_agent_id  UUID REFERENCES ai_agents(id) ON DELETE SET NULL,

  offer_amount          NUMERIC(15,2) NOT NULL CHECK (offer_amount >= 0),
  discount_pct          NUMERIC(5,2) NOT NULL,
  installments          INT NOT NULL DEFAULT 1 CHECK (installments >= 1),
  installment_amount    NUMERIC(15,2) NOT NULL,
  first_due_date        DATE,

  status                TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded', 'expired')),
  rejection_reason      TEXT,

  source_message_id     UUID REFERENCES inbox_messages(id) ON DELETE SET NULL,
  rule_snapshot          JSONB,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_negotiation_offers_negotiation ON negotiation_offers (negotiation_id, round);

ALTER TABLE negotiation_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "negotiation_offers_workspace_isolation" ON negotiation_offers
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ── negotiation_rules ──────────────────────────────────────────────
CREATE TABLE negotiation_rules (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,

  is_ai_negotiation_enabled BOOLEAN NOT NULL DEFAULT true,

  max_discount_pct          NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (max_discount_pct >= 0 AND max_discount_pct <= 100),
  max_installments          INT NOT NULL DEFAULT 6 CHECK (max_installments >= 1),
  min_installment_amount    NUMERIC(15,2) NOT NULL DEFAULT 50 CHECK (min_installment_amount >= 0),
  min_down_payment_pct      NUMERIC(5,2) CHECK (min_down_payment_pct IS NULL OR (min_down_payment_pct >= 0 AND min_down_payment_pct <= 100)),

  max_negotiation_rounds    INT NOT NULL DEFAULT 3 CHECK (max_negotiation_rounds >= 1),
  auto_escalate_keywords    TEXT[] NOT NULL DEFAULT ARRAY['advogado','procon','fraude','processo'],

  escalation_department_id  UUID REFERENCES departments(id) ON DELETE SET NULL,

  portal_token_ttl_hours    INT NOT NULL DEFAULT 48 CHECK (portal_token_ttl_hours >= 1),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER negotiation_rules_updated_at
  BEFORE UPDATE ON negotiation_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE negotiation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "negotiation_rules_workspace_isolation" ON negotiation_rules
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

-- ── negotiation_portal_tokens ──────────────────────────────────────
-- Magic link do cliente externo. Dados financeiros sensíveis expostos por uma
-- function pública (sem sessão Supabase Auth) — RLS fica ativada e SEM NENHUMA
-- policy: nega tudo por padrão para chaves anon/authenticated. Só a service role
-- (usada pela edge function negotiation-portal) enxerga esta tabela.
CREATE TABLE negotiation_portal_tokens (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id        UUID NOT NULL REFERENCES debt_negotiations(id) ON DELETE CASCADE,
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  token                 TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  cpf_last_digits_hash  TEXT NOT NULL,

  expires_at            TIMESTAMPTZ NOT NULL,
  used_at               TIMESTAMPTZ,
  locked_at             TIMESTAMPTZ,
  verified_at           TIMESTAMPTZ,
  attempts              INT NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_negotiation_portal_tokens_negotiation ON negotiation_portal_tokens (negotiation_id);

ALTER TABLE negotiation_portal_tokens ENABLE ROW LEVEL SECURITY;
