import { useState, useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/context/AuthContext";
import { useInboxConversations } from "@/hooks/useInbox";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { ConversationList } from "./inbox/ConversationList";
import { ConversationPanel } from "./inbox/ConversationPanel";
import type { InboxConversation, Department, ConnectionInfo } from "@/types/inbox";
import { supabase } from "@/lib/supabase";

export function Inbox() {
  const { workspaceId, profile } = useAuth();
  const wsId = workspaceId ?? "";
  const isAdmin = profile?.role === "admin";

  const {
    conversations, loading, markAsRead,
    pinConversation, archiveConversation, deleteConversation, updateTags,
  } = useInboxConversations(wsId);
  const teamMembers = useTeamMembers();
  const [selectedConv, setSelectedConv] = useState<InboxConversation | null>(null);
  const [departments,  setDepartments]  = useState<Department[]>([]);
  const [connections,  setConnections]  = useState<ConnectionInfo[]>([]);
  // IDs dos setores do usuário atual (vazio = sem restrição para admins)
  const [myDeptIds,    setMyDeptIds]    = useState<string[] | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  useEffect(() => {
    if (!wsId) return;

    db.from("departments")
      .select("*")
      .eq("workspace_id", wsId)
      .order("order_index", { ascending: true })
      .then(({ data }: { data: Department[] | null }) => {
        if (data) setDepartments(data);
      });

    Promise.all([
      db.from("meta_connections")
        .select("id, display_phone_number, phone_number_id")
        .eq("workspace_id", wsId),
      db.from("z_api_connections")
        .select("id, phone, name")
        .eq("workspace_id", wsId),
    ]).then(([metaRes, zapiRes]: any[]) => {
      const meta: ConnectionInfo[] = (metaRes.data ?? []).map((c: any) => ({
        id:    c.id,
        type:  "meta" as const,
        label: c.display_phone_number ?? c.phone_number_id ?? "Meta",
        phone: c.display_phone_number ?? c.phone_number_id ?? "",
      }));
      const zapi: ConnectionInfo[] = (zapiRes.data ?? []).map((c: any) => ({
        id:    c.id,
        type:  "zapi" as const,
        label: c.name ?? c.phone ?? "Z-API",
        phone: c.phone ?? "",
      }));
      setConnections([...meta, ...zapi]);
    });

    // Admins veem tudo — não precisamos carregar setores do usuário
    if (isAdmin) {
      setMyDeptIds([]); // [] = sem filtro
      return;
    }

    if (profile?.id) {
      db.from("department_members")
        .select("department_id")
        .eq("user_id", profile.id)
        .eq("workspace_id", wsId)
        .then(({ data }: { data: { department_id: string }[] | null }) => {
          setMyDeptIds((data ?? []).map((r) => r.department_id));
        });
    }
  }, [wsId, profile?.id, isAdmin]);
  const [searchParams] = useSearchParams();
  const targetConvId = searchParams.get("conversation");
  const autoSelectedRef = useRef(false);

  // Keep selected conversation in sync when Realtime refreshes the list
  useEffect(() => {
    if (!selectedConv) return;
    const updated = conversations.find((c) => c.id === selectedConv.id);
    if (updated) setSelectedConv(updated);
    else setSelectedConv(null); // deleted
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

  // Auto-select conversation when navigated from Alerts with ?conversation=
  useEffect(() => {
    if (!targetConvId || loading || autoSelectedRef.current) return;
    const conv = conversations.find((c) => c.id === targetConvId);
    if (conv) {
      handleSelect(conv);
      autoSelectedRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, conversations]);

  function handleSelect(conv: InboxConversation) {
    setSelectedConv(conv);
    if (conv.unread_count > 0) markAsRead(conv.id);
  }

  function handleDelete() {
    if (!selectedConv) return;
    deleteConversation(selectedConv.id);
    setSelectedConv(null);
  }

  // Filtro por setor: admins veem tudo; demais veem apenas seu(s) setor(es) + fila central
  const visibleConversations = isAdmin || myDeptIds === null
    ? conversations
    : conversations.filter(
        (c) => c.department_id === null || myDeptIds.includes(c.department_id)
      );

  return (
    <div
      className="flex flex-col overflow-hidden pb-16 md:pb-0"
      style={{ height: "100vh", background: "#0a110e" }}
    >
      <Topbar breadcrumbs={[{ label: "Inbox" }]} />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className={selectedConv ? "hidden md:flex" : "flex w-full md:w-auto"}>
          <ConversationList
            conversations={visibleConversations}
            loading={loading}
            selectedId={selectedConv?.id ?? null}
            onSelect={handleSelect}
            teamMembers={teamMembers}
            departments={departments}
            connections={connections}
          />
        </div>

        <div className={`${!selectedConv ? "hidden md:flex" : "flex"} flex-1 min-w-0 min-h-0 overflow-hidden`}>
          {selectedConv ? (
            <ConversationPanel
              key={selectedConv.id}
              conversation={selectedConv}
              teamMembers={teamMembers}
              onBack={() => setSelectedConv(null)}
              onPin={(pinned) => pinConversation(selectedConv.id, pinned)}
              onArchive={(archived) => archiveConversation(selectedConv.id, archived)}
              onDelete={handleDelete}
              onUpdateTags={(tags) => updateTags(selectedConv.id, tags)}
            />
          ) : (
            <EmptyState />
          )}
        </div>
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
