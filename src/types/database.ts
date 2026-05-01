export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      meta_connections: {
        Row: MetaConnection;
        Insert: Omit<MetaConnection, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<MetaConnection, "id">>;
      };
      meta_templates: {
        Row: MetaTemplate;
        Insert: Omit<MetaTemplate, "id" | "created_at">;
        Update: Partial<Omit<MetaTemplate, "id">>;
      };
      shooting_campaigns: {
        Row: ShootingCampaign;
        Insert: Omit<ShootingCampaign, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<ShootingCampaign, "id">>;
      };
      shooting_messages: {
        Row: ShootingMessage;
        Insert: Omit<ShootingMessage, "id" | "created_at">;
        Update: Partial<Omit<ShootingMessage, "id">>;
      };
      shooting_uploads: {
        Row: ShootingUpload;
        Insert: Omit<ShootingUpload, "id" | "created_at">;
        Update: Partial<Omit<ShootingUpload, "id">>;
      };
      webhook_events: {
        Row: WebhookEvent;
        Insert: Omit<WebhookEvent, "id" | "created_at">;
        Update: Partial<Omit<WebhookEvent, "id">>;
      };
      workspace_members: {
        Row: { workspace_id: string; user_id: string };
        Insert: { workspace_id: string; user_id: string };
        Update: { workspace_id?: string; user_id?: string };
      };
    };
    Functions: {
      increment_campaign_counters: {
        Args: {
          p_campaign_id: string;
          p_counter_name: string;
          p_increment?: number;
        };
        Returns: void;
      };
    };
  };
}

export interface MetaConnection {
  id: string;
  workspace_id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone: string;
  business_name: string | null;
  access_token: string;
  token_expires_at: string | null;
  webhook_verify_token: string;
  status: "active" | "disconnected" | "token_expired";
  quality_rating: "GREEN" | "YELLOW" | "RED" | null;
  messaging_limit:
    | "TIER_1K"
    | "TIER_10K"
    | "TIER_100K"
    | "UNLIMITED"
    | null;
  created_at: string;
  updated_at: string;
}

export interface MetaTemplate {
  id: string;
  workspace_id: string;
  meta_connection_id: string;
  template_name: string;
  template_id: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  status: "APPROVED" | "PENDING" | "REJECTED";
  components: TemplateComponent[];
  quality_score: Json | null;
  last_synced_at: string;
  created_at: string;
}

export interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  text?: string;
  buttons?: TemplateButton[];
}

export interface TemplateButton {
  type: "URL" | "PHONE_NUMBER" | "QUICK_REPLY";
  text: string;
  url?: string;
  phone_number?: string;
}

export interface ShootingCampaign {
  id: string;
  workspace_id: string;
  meta_connection_id: string | null;
  z_api_connection_id: string | null;
  name: string;
  template_id: string | null;
  message_body: string | null;
  dispatch_channel: "whatsapp" | "n8n_email" | "z_api";
  data_source: "contacts" | "xlsx_upload";
  column_mapping: ColumnMapping;
  filters: Json;
  total_recipients: number;
  status:
    | "draft"
    | "scheduled"
    | "sending"
    | "paused"
    | "completed"
    | "cancelled"
    | "failed";
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  failed_count: number;
  error_summary: Json;
  sending_speed: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ColumnMapping {
  phone_column: string;
  header_variables?: Record<string, string>;
  body_variables?: Record<string, string>;
  button_variables?: Record<string, Record<string, string>>;
}

export interface ShootingMessage {
  id: string;
  campaign_id: string;
  workspace_id: string;
  recipient_phone: string;
  recipient_name: string | null;
  recipient_data: Json;
  wamid: string | null;
  status:
    | "pending"
    | "sent"
    | "delivered"
    | "read"
    | "replied"
    | "failed"
    | "undeliverable";
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  error_details: Json | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
}

export interface ShootingUpload {
  id: string;
  campaign_id: string | null;
  workspace_id: string;
  file_name: string;
  file_url: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  column_headers: string[];
  preview_data: Json;
  validation_errors: Json;
  processed: boolean;
  created_at: string;
}

export interface WebhookEvent {
  id: string;
  workspace_id: string;
  meta_connection_id: string;
  event_type: string;
  wamid: string | null;
  payload: Json;
  processed: boolean;
  created_at: string;
}
