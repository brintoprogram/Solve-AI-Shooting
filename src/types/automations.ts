export type AutomationStatus  = "draft" | "active" | "paused" | "completed";
export type AutomationChannel = "z_api" | "meta";
export type TemplateMode      = "per_trigger" | "unified";

export interface AutomationRule {
  id:                   string;
  workspace_id:         string;
  name:                 string;
  status:               AutomationStatus;
  send_hour:            number;
  channel:              AutomationChannel;
  z_api_connection_id:  string | null;
  meta_connection_id:   string | null;
  template_mode:        TemplateMode;
  unified_message:      string | null;
  total_recipients:     number;
  sent_count:           number;
  created_at:           string;
  updated_at:           string;
}

export interface AutomationTrigger {
  id:                   string;
  rule_id:              string;
  workspace_id:         string;
  day_offset:           number;
  label:                string | null;
  channel:              AutomationChannel | null;
  z_api_connection_id:  string | null;
  z_api_template_id:    string | null;
  meta_connection_id:   string | null;
  meta_template_id:     string | null;
  column_mapping:       Record<string, string>;
  message_body:         string | null;
  enabled:              boolean;
  created_at:           string;
}

export interface AutomationRecipient {
  id:            string;
  rule_id:       string;
  workspace_id:  string;
  contact_id:    string;
  invoice_id:    string | null;
  contact_name:  string;
  contact_phone: string;
  vencimento:    string;
  valor:         number | null;
  numero_nf:     string | null;
  codigo_barras: string | null;
  removed:       boolean;
  created_at:    string;
}

export interface AutomationLog {
  id:            string;
  rule_id:       string;
  trigger_id:    string | null;
  recipient_id:  string | null;
  workspace_id:  string;
  contact_name:  string | null;
  contact_phone: string | null;
  day_offset:    number | null;
  channel:       string | null;
  status:        "sent" | "failed";
  zaap_id:       string | null;
  wamid:         string | null;
  error_message: string | null;
  scheduled_for: string | null;
  sent_at:       string;
  created_at:    string;
}

// ── Wizard state ──────────────────────────────────────────────────────────────

export interface TriggerDraft {
  key:                  string;   // local uuid for React key
  day_offset:           number;
  label:                string;
  channel:              AutomationChannel | null;  // null = inherit rule default
  z_api_connection_id:  string | null;
  z_api_template_id:    string | null;
  meta_connection_id:   string | null;
  meta_template_id:     string | null;
  column_mapping:       Record<string, string>;   // "0"→"nome", "1"→"valor", etc.
  message_body:         string;   // free text (Z-API without template)
  enabled:              boolean;
}

export interface RecipientDraft {
  contact_id:    string;
  invoice_id:    string | null;
  contact_name:  string;
  contact_phone: string;
  vencimento:    string;          // ISO date "YYYY-MM-DD"
  valor:         number | null;
  numero_nf:     string | null;
  codigo_barras: string | null;
}

export interface AutomationWizardState {
  step:                 1 | 2 | 3 | 4;
  name:                 string;
  channel:              AutomationChannel;
  z_api_connection_id:  string;
  meta_connection_id:   string;
  send_hour:            number;
  template_mode:        TemplateMode;
  unified_message:      string;
  triggers:             TriggerDraft[];
  selectedRecipients:   RecipientDraft[];
}

// Available automation variable names for column_mapping
export const AUTOMATION_VAR_OPTIONS = [
  { key: "nome",              label: "Nome do contato" },
  { key: "valor",             label: "Valor do boleto" },
  { key: "vencimento",        label: "Data de vencimento" },
  { key: "dias",              label: "Dias (relativo ao vencimento)" },
  { key: "status_vencimento", label: "Status (a vencer / vencido)" },
  { key: "boleto",            label: "Código do boleto / NF" },
] as const;
