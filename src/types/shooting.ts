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
  | "draft" | "scheduled" | "agendada" | "sending" | "paused"
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
  agendada: "Agendada",
  sending: "Enviando",
  paused: "Pausado",
  completed: "Concluído",
  cancelled: "Cancelado",
  failed: "Falhou",
};

/**
 * Aparência do status, em UM lugar.
 *
 * Estava declarado identicamente em CampaignDetail e em CampaignList, e o
 * mesmo mapa existe ainda em Reports e no Dashboard. Quando o status
 * "agendada" nasceu junto com o disparo agendado, cada cópia teve que ser
 * lembrada — e a de CampaignDetail não foi. Abrir o detalhe de uma campanha
 * agendada quebrava a página inteira com "Cannot read properties of undefined
 * (reading 'bg')".
 *
 * A busca é por `estiloDoStatus()` e não por índice direto de propósito: um
 * status que o front ainda não conhece precisa render um selo neutro, não
 * derrubar a tela. O banco pode ganhar valor novo a qualquer deploy; a tela
 * não pode depender de ter sido atualizada junto.
 */
export interface EstiloDeStatus { bg: string; color: string; border: string }

export const STATUS_STYLE: Record<CampaignStatus, EstiloDeStatus> = {
  draft:     { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "rgba(107,114,128,0.2)"  },
  scheduled: { bg: "rgba(59,130,246,0.1)",   color: "#60a5fa", border: "rgba(59,130,246,0.2)"   },
  agendada:  { bg: "rgba(168,85,247,0.12)",  color: "#c084fc", border: "rgba(168,85,247,0.28)"  },
  sending:   { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa", border: "rgba(59,130,246,0.3)"   },
  paused:    { bg: "rgba(245,158,11,0.1)",   color: "#fbbf24", border: "rgba(245,158,11,0.2)"   },
  completed: { bg: "rgba(63,176,108,0.1)",   color: "#3fb06c", border: "rgba(63,176,108,0.2)"   },
  cancelled: { bg: "rgba(107,114,128,0.08)", color: "#6b7280", border: "rgba(107,114,128,0.15)" },
  failed:    { bg: "rgba(239,68,68,0.1)",    color: "#f87171", border: "rgba(239,68,68,0.2)"    },
};

const NEUTRO: EstiloDeStatus =
  { bg: "rgba(107,114,128,0.1)", color: "#9ca3af", border: "rgba(107,114,128,0.2)" };

export function estiloDoStatus(status: string | null | undefined): EstiloDeStatus {
  return STATUS_STYLE[status as CampaignStatus] ?? NEUTRO;
}

export function rotuloDoStatus(status: string | null | undefined): string {
  return STATUS_LABELS[status as CampaignStatus] ?? (status ?? "—");
}

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  pending: "Na fila",
  sent: "Enviado",
  delivered: "Entregue",
  read: "Lido",
  replied: "Respondido",
  failed: "Falhou",
  undeliverable: "Não entregável",
};
