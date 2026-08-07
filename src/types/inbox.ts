export interface InboxContact {
  id: string;
  workspace_id: string;
  phone: string;
  name: string | null;
  profile_pic_url: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface Department {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  description: string | null;
  order_index: number;
  created_at: string;
}

export interface ConnectionInfo {
  id: string;
  type: "meta" | "zapi";
  label: string;
  phone: string;
}

export interface InboxConversation {
  /** Conversa/contato do ambiente de teste de agentes — fora das telas reais. */
  is_simulation?: boolean | null;
  id: string;
  workspace_id: string;
  meta_connection_id: string | null;
  z_api_connection_id: string | null;
  contact_id: string;
  assigned_to: string | null;
  department_id: string | null;
  status: "open" | "resolved" | "pending";
  pinned:   boolean;
  archived: boolean;
  tags:     string[];
  ai_agent_id: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_body: string | null;
  last_message_direction: "inbound" | "outbound" | null;
  created_at: string;
  updated_at: string;
  inbox_contacts: InboxContact;
  departments: Department | null;
}

export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "reaction"
  | "template"
  | "button_reply"
  | "interactive"
  | "unsupported";

export interface InboxMessage {
  id: string;
  workspace_id: string;
  conversation_id: string;
  contact_id: string;
  wamid: string | null;
  direction: "inbound" | "outbound";
  message_type: MessageType;
  body: string | null;
  media_id: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_filename: string | null;
  media_size: number | null;
  media_caption: string | null;
  location_lat: number | null;
  location_lng: number | null;
  location_name: string | null;
  location_address: string | null;
  reaction_emoji: string | null;
  reaction_wamid: string | null;
  sent_by: string | null;
  is_internal: boolean;
  status: "sending" | "sent" | "delivered" | "read" | "failed";
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  created_at: string;
}
