import { useState } from "react";
import { Search, MessageSquareDashed } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import type { InboxConversation } from "@/types/inbox";

interface Props {
  conversations: InboxConversation[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (conv: InboxConversation) => void;
}

export function ConversationList({ conversations, loading, selectedId, onSelect }: Props) {
  const [search, setSearch] = useState("");

  const filtered = conversations.filter((c) => {
    const name = (c.inbox_contacts.name ?? c.inbox_contacts.phone).toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || c.inbox_contacts.phone.includes(q);
  });

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);

  return (
    <div
      className="flex flex-col shrink-0 overflow-hidden"
      style={{ width: 300, borderRight: "1px solid rgba(63,176,108,0.1)" }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-sm font-bold text-agro-text">Conversas</h2>
          {totalUnread > 0 && (
            <span
              className="text-[10px] font-bold text-white px-2 py-0.5 rounded-full"
              style={{ background: "#3fb06c" }}
            >
              {totalUnread} nova{totalUnread !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-agro-muted-2 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar contato ou número..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-agro w-full pl-8 text-xs h-9"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && (
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 rounded-full border-2 border-agro-green border-t-transparent animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-12 px-4 text-center">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.1)" }}
            >
              <MessageSquareDashed className="w-5 h-5 text-agro-muted-2" />
            </div>
            <p className="text-xs text-agro-muted">
              {search ? "Nenhum resultado" : "Nenhuma conversa ainda"}
            </p>
            {!search && (
              <p className="text-[10px] text-agro-muted-2 leading-relaxed">
                Mensagens recebidas via<br />WhatsApp aparecerão aqui
              </p>
            )}
          </div>
        )}

        {filtered.map((conv) => {
          const contact = conv.inbox_contacts;
          const displayName = contact.name ?? contact.phone;
          const isSelected = conv.id === selectedId;
          const hasUnread = conv.unread_count > 0;

          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left relative group transition-colors duration-100"
              style={
                isSelected
                  ? {
                      background: "rgba(63,176,108,0.1)",
                      borderLeft: "2px solid #3fb06c",
                    }
                  : { borderLeft: "2px solid transparent" }
              }
            >
              {/* Hover layer */}
              {!isSelected && (
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{ background: "rgba(63,176,108,0.04)" }}
                />
              )}

              {/* Avatar */}
              <div className="relative shrink-0">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white select-none"
                  style={{ background: hashColor(displayName) }}
                >
                  {initials(displayName)}
                </div>
                <div
                  className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
                  style={{ background: "#3fb06c", borderColor: "#0a110e" }}
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 relative">
                <div className="flex items-baseline justify-between gap-1">
                  <p
                    className={`text-sm truncate ${
                      hasUnread
                        ? "font-semibold text-agro-text"
                        : "font-medium text-agro-text-2"
                    }`}
                  >
                    {displayName}
                  </p>
                  <p className="text-[10px] text-agro-muted-2 shrink-0">
                    {formatTime(conv.last_message_at)}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-1 mt-0.5">
                  <p
                    className={`text-xs truncate ${
                      hasUnread ? "text-agro-muted" : "text-agro-muted-2"
                    }`}
                  >
                    {conv.last_message_body ?? ""}
                  </p>
                  {hasUnread && (
                    <span
                      className="shrink-0 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1"
                      style={{ background: "#3fb06c" }}
                    >
                      {conv.unread_count > 99 ? "99+" : conv.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function formatTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Ontem";
  return format(d, "dd/MM");
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_PALETTE = [
  "#1e6e45", "#2d5a6e", "#5a3d6e", "#6e3d3d",
  "#4a5c3d", "#3d4a5c", "#5c4a3d", "#1a5c5c",
  "#2a4a6e", "#6e2a4a",
];

function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}
