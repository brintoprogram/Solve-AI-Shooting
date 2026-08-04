import type { InboxContact } from "@/types/inbox";

export type NegotiationStatus =
  | "triggered"
  | "ai_negotiating"
  | "awaiting_customer"
  | "escalated"
  | "human_negotiating"
  | "formalized"
  | "expired"
  | "cancelled";

export interface DebtNegotiation {
  id: string;
  workspace_id: string;
  contact_id: string;
  invoice_id: string;
  conversation_id: string;
  status: NegotiationStatus;
  original_amount: number;
  offer_round: number;
  agreed_amount: number | null;
  agreed_installments: number | null;
  agreed_first_due_date: string | null;
  agreed_at: string | null;
  escalation_reason: string | null;
  created_at: string;
  updated_at: string;
  inbox_contacts?: InboxContact;
  contact_invoices?: { numero_nf: string | null; vencimento: string | null; status: string };
}

export type OfferProposedBy = "ai" | "customer" | "staff" | "system";
export type OfferStatus = "pending" | "accepted" | "rejected" | "superseded" | "expired";

export interface NegotiationOffer {
  id: string;
  negotiation_id: string;
  workspace_id: string;
  round: number;
  proposed_by: OfferProposedBy;
  proposed_by_user_id: string | null;
  proposed_by_agent_id: string | null;
  offer_amount: number;
  discount_pct: number;
  installments: number;
  installment_amount: number;
  first_due_date: string | null;
  status: OfferStatus;
  rejection_reason: string | null;
  source_message_id: string | null;
  rule_snapshot: Record<string, unknown> | null;
  created_at: string;
}

export interface NegotiationRules {
  id: string;
  workspace_id: string;
  is_ai_negotiation_enabled: boolean;
  max_discount_pct: number;
  max_installments: number;
  min_installment_amount: number;
  min_down_payment_pct: number | null;
  max_negotiation_rounds: number;
  auto_escalate_keywords: string[];
  escalation_department_id: string | null;
  portal_token_ttl_hours: number;
  created_at: string;
  updated_at: string;
}
