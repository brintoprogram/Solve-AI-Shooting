import { useState, useEffect } from "react";
import { MessageSquare } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/context/AuthContext";
import { useInboxConversations } from "@/hooks/useInbox";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { ConversationList } from "./inbox/ConversationList";
import { ConversationPanel } from "./inbox/ConversationPanel";
import type { InboxConversation } from "@/types/inbox";

export function Inbox() {
  const workspaceId = useAuth().workspaceId ?? "";
  const { conversations, loading, markAsRead } = useInboxConversations(workspaceId);
  const teamMembers = useTeamMembers();
  const [selectedConv, setSelectedConv] = useState<InboxConversation | null>(null);

  // Keep selected conversation in sync when Realtime refreshes the list
  useEffect(() => {
    if (!selectedConv) return;
    const updated = conversations.find((c) => c.id === selectedConv.id);
    if (updated) setSelectedConv(updated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

  function handleSelect(conv: InboxConversation) {
    setSelectedConv(conv);
    if (conv.unread_count > 0) markAsRead(conv.id);
  }

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ height: "100vh", background: "#0a110e" }}
    >
      <Topbar breadcrumbs={[{ label: "Inbox" }]} />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <ConversationList
          conversations={conversations}
          loading={loading}
          selectedId={selectedConv?.id ?? null}
          onSelect={handleSelect}
          teamMembers={teamMembers}
        />

        {selectedConv ? (
          <ConversationPanel
            key={selectedConv.id}
            conversation={selectedConv}
            teamMembers={teamMembers}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{
            background: "rgba(63,176,108,0.06)",
            border: "1px solid rgba(63,176,108,0.12)",
          }}
        >
          <MessageSquare className="w-8 h-8 text-agro-muted-2" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-agro-muted">Selecione uma conversa</p>
          <p className="text-xs text-agro-muted-2 leading-relaxed">
            Clique em um contato à esquerda para<br />ver o histórico de mensagens
          </p>
        </div>
      </div>
    </div>
  );
}
