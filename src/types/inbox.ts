export interface InboxContact {
  id: string;
  workspace_id: string;
  phone: string;
  name: string | null;
  profile_pic_url: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface InboxConversation {
  id: string;
  workspace_id: string;
  meta_connection_id: string;
  contact_id: string;
  assigned_to: string | null;
  status: "open" | "resolved" | "pending";
  unread_count: number;
  last_message_at: string | null;
  last_message_body: string | null;
  last_message_direction: "inbound" | "outbound" | null;
  created_at: string;
  updated_at: string;
  inbox_contacts: InboxContact;
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
  status: "sending" | "sent" | "delivered" | "read" | "failed";
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  created_at: string;
}
