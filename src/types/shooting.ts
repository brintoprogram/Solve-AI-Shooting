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
  sendingSpeedMode: "fixed" | "random";  // Z-API only
  minDelaySeconds: number;
  maxDelaySeconds: number;
  // Step 2
  selectedContacts:  string[];
  selectedInvoices:  Record<string, string[]>;  // contactId → invoiceIds (pinned, same vencimento); empty = use all pending
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
  sendingSpeedMode: "fixed",
  minDelaySeconds: 5,
  maxDelaySeconds: 30,
  selectedContacts:  [],
  selectedInvoices:  {},
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

// Derivar de ShootingMessage["status"] trazia `string | null` junto, e um tipo
// nulavel nao pode ser chave de Record nem indice. As unioes abaixo sao os
// valores que o sistema de fato grava — os mesmos que os mapas de rotulo mais
// abaixo enumeram.
export type MessageStatus =
  | "pending" | "sent" | "delivered" | "read"
  | "replied" | "failed" | "undeliverable";

export type CampaignStatus =
  | "draft" | "scheduled" | "sending" | "paused"
  | "completed" | "cancelled" | "failed";

/** Normaliza o status cru do banco (nulavel, texto livre) para a uniao. */
export function asMessageStatus(raw: string | null | undefined): MessageStatus {
  return (raw && raw in MESSAGE_STATUS_LABELS) ? (raw as MessageStatus) : "pending";
}

/** Idem para campanha. */
export function asCampaignStatus(raw: string | null | undefined): CampaignStatus {
  return (raw && raw in STATUS_LABELS) ? (raw as CampaignStatus) : "draft";
}

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
