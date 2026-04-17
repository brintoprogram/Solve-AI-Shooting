import { useEffect, useRef } from "react";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { MoreVertical } from "lucide-react";
import type { InboxConversation } from "@/types/inbox";
import { useInboxMessages } from "@/hooks/useInbox";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";

interface Props {
  conversation: InboxConversation;
}

export function ConversationPanel({ conversation }: Props) {
  const contact = conversation.inbox_contacts;
  const displayName = contact.name ?? contact.phone;
  const { messages, loading } = useInboxMessages(conversation.id);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* ── Contact header ─────────────────────────────────────── */}
      <div
        className="h-14 px-5 flex items-center gap-3 shrink-0"
        style={{
          borderBottom: "1px solid rgba(63,176,108,0.1)",
          background: "rgba(10,17,14,0.9)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 select-none"
          style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
        >
          {initials(displayName)}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-agro-text truncate leading-none">{displayName}</p>
          <p className="text-[11px] text-agro-muted font-mono mt-0.5">{contact.phone}</p>
        </div>

        <StatusBadge status={conversation.status} />

        <button
          className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.1)" }}
          title="Mais opções"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>

      {/* ── Message list ───────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4"
        style={{ background: "rgba(8,14,10,0.6)" }}
      >
        {loading && (
          <div className="flex justify-center py-10">
            <div className="w-5 h-5 rounded-full border-2 border-agro-green border-t-transparent animate-spin" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-sm text-agro-muted">Nenhuma mensagem ainda</p>
            <p className="text-xs text-agro-muted-2">
              Mensagens trocadas aparecem aqui em tempo real
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const showSep =
            !prev || !isSameDay(new Date(msg.created_at), new Date(prev.created_at));

          return (
            <div key={msg.id}>
              {showSep && <DateSeparator date={msg.created_at} />}
              <MessageBubble message={msg} />
            </div>
          );
        })}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* ── Reply bar ─────────────────────────────────────────────── */}
      <MessageInput
        conversationId={conversation.id}
        workspaceId={conversation.workspace_id}
      />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function DateSeparator({ date }: { date: string }) {
  const d = new Date(date);
  let label: string;
  if (isToday(d)) label = "Hoje";
  else if (isYesterday(d)) label = "Ontem";
  else label = format(d, "dd/MM/yyyy");

  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px" style={{ background: "rgba(63,176,108,0.07)" }} />
      <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest px-1 whitespace-nowrap">
        {label}
      </p>
      <div className="flex-1 h-px" style={{ background: "rgba(63,176,108,0.07)" }} />
    </div>
  );
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  open:     { label: "Aberta",    color: "#3fb06c", bg: "rgba(63,176,108,0.1)",  border: "rgba(63,176,108,0.25)"  },
  pending:  { label: "Pendente",  color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)"  },
  resolved: { label: "Resolvida", color: "#6b7280", bg: "rgba(107,114,128,0.1)",border: "rgba(107,114,128,0.25)" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.open;
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
