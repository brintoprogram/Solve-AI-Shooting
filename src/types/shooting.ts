import type {
  MetaConnection,
  MetaTemplate,
  ShootingCampaign,
  ShootingMessage,
  ShootingUpload,
  ColumnMapping,
} from "./database";

export type {
  MetaConnection,
  MetaTemplate,
  ShootingCampaign,
  ShootingMessage,
  ShootingUpload,
  ColumnMapping,
};

export interface WizardState {
  step: 1 | 2 | 3 | 4;
  // Step 1
  channel: "meta" | "z_api";
  dataSource: "contacts" | "xlsx_upload" | null;
  campaignName: string;
  connectionId: string;
  scheduleMode: "now" | "later";
  scheduledAt: Date | null;
  sendingSpeed: number;
  // Step 2
  selectedContacts: string[];
  uploadId: string | null;
  // Step 3 — Meta
  templateId: string;
  columnMapping: ColumnMapping;
  previewIndex: number;
  // Step 3 — Z-API
  messageBody: string;
  zApiTemplateId: string | null;
  // Derived
  totalRecipients: number;
}

export const initialWizardState: WizardState = {
  step: 1,
  channel: "meta",
  dataSource: null,
  campaignName: "",
  connectionId: "",
  scheduleMode: "now",
  scheduledAt: null,
  sendingSpeed: 80,
  selectedContacts: [],
  uploadId: null,
  templateId: "",
  columnMapping: { phone_column: "" },
  previewIndex: 0,
  messageBody: "",
  zApiTemplateId: null,
  totalRecipients: 0,
};

export interface XlsxRow {
  [key: string]: string | number | null;
}

export interface XlsxValidationResult {
  headers: string[];
  validRows: XlsxRow[];
  invalidRows: Array<{ rowIndex: number; data: XlsxRow; error: string }>;
  phoneColumn: string | null;
  previewData: XlsxRow[];
}

export interface MetaApiTemplate {
  id: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  status: "APPROVED" | "PENDING" | "REJECTED";
  components: MetaTemplate["components"];
  quality_score?: unknown;
}

export interface MetaApiPhoneInfo {
  id: string;
  display_phone_number: string;
  verified_name: string;
  quality_rating: string;
  messaging_limit_tier: string;
}

export interface CampaignWithTemplate extends ShootingCampaign {
  meta_templates?: MetaTemplate;
  meta_connections?: MetaConnection;
}

export type MessageStatus = ShootingMessage["status"];
export type CampaignStatus = ShootingCampaign["status"];

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  sending: "Enviando",
  paused: "Pausado",
  completed: "Concluído",
  cancelled: "Cancelado",
  failed: "Falhou",
};

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  pending: "Na fila",
  sent: "Enviado",
  delivered: "Entregue",
  read: "Lido",
  replied: "Respondido",
  failed: "Falhou",
  undeliverable: "Não entregável",
};
