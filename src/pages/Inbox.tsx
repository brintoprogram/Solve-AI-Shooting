import { useState, useEffect, useRef } from "react";
import { MessageSquare, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/context/AuthContext";
import { useInboxConversations } from "@/hooks/useInbox";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { ConversationList } from "./inbox/ConversationList";
import { ConversationPanel } from "./inbox/ConversationPanel";
import { NewConversationDialog } from "./inbox/NewConversationDialog";
import type { InboxConversation, Department, ConnectionInfo } from "@/types/inbox";
import { supabase } from "@/lib/supabase";

export function Inbox() {
  const { workspaceId, profile } = useAuth();
  const wsId = workspaceId ?? "";
  const isAdmin = profile?.role === "admin";

  const {
    conversations, loading, markAsRead,
    pinConversation, archiveConversation, deleteConversation, updateTags, refresh,
  } = useInboxConversations(wsId);
  const teamMembers = useTeamMembers();
  const [selectedConv, setSelectedConv] = useState<InboxConversation | null>(null);
  const [departments,  setDepartments]  = useState<Department[]>([]);
  const [connections,  setConnections]  = useState<ConnectionInfo[]>([]);
  const [myDeptIds,    setMyDeptIds]    = useState<string[] | null>(null);
  const [activeConn,   setActiveConn]   = useState<string | null>(null);
  const [showNewConv,  setShowNewConv]  = useState(false);

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
        .select("id, display_phone, phone_number_id")
        .eq("workspace_id", wsId),
      db.from("z_api_connections")
        .select("id, phone, name")
        .eq("workspace_id", wsId),
    ]).then(([metaRes, zapiRes]: any[]) => {
      const meta: ConnectionInfo[] = (metaRes.data ?? []).map((c: any) => ({
        id:    c.id,
        type:  "meta" as const,
        label: c.display_phone ?? c.phone_number_id ?? "Meta",
        phone: c.display_phone ?? c.phone_number_id ?? "",
      }));
      const zapi: ConnectionInfo[] = (zapiRes.data ?? []).map((c: any) => ({
        id:    c.id,
        type:  "zapi" as const,
        label: c.name ?? c.phone ?? "Z-API",
        phone: c.phone ?? "",
      }));
      setConnections([...meta, ...zapi]);
    });

    if (isAdmin) {
      setMyDeptIds([]);
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

  useEffect(() => {
    if (!selectedConv) return;
    const updated = conversations.find((c) => c.id === selectedConv.id);
    if (updated) setSelectedConv(updated);
    else setSelectedConv(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

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

  async function handleConversationCreated(convId: string) {
    setShowNewConv(false);
    // Force reload and fetch the new conversation directly (don't rely on Realtime or stale closure)
    await refresh();
    const { data } = await (supabase as any)
      .from("inbox_conversations")
      .select("*, inbox_contacts(*), departments(*)")
      .eq("id", convId)
      .single();
    if (data) handleSelect(data as InboxConversation);
  }

  const visibleConversations = isAdmin || myDeptIds === null
    ? conversations
    : conversations.filter(
        (c) => c.department_id === null || myDeptIds.includes(c.department_id)
      );

  const filteredByConn = activeConn
    ? visibleConversations.filter(
        (c) => c.meta_connection_id === activeConn || c.z_api_connection_id === activeConn
      )
    : visibleConversations;

  const zapiConnections = connections.filter((c) => c.type === "zapi");

  return (
    <div
      className="flex flex-col overflow-hidden pb-16 md:pb-0"
      style={{ height: "100vh", background: "#0a110e" }}
    >
      <Topbar breadcrumbs={[{ label: "Inbox" }]} />

      {/* ── Connection sub-header ──────────────────── */}
      {connections.length > 0 && (
        <div
          className="flex items-center gap-2 px-5 py-2 shrink-0"
          style={{ borderBottom: "1px solid rgba(63,176,108,0.08)", background: "rgba(10,17,14,0.6)" }}
        >
          <div className="flex items-center gap-1.5 flex-1 flex-wrap">
            <button
              onClick={() => setActiveConn(null)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
              style={!activeConn
                ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }
                : { background: "rgba(0,0,0,0.2)", color: "#6b8a75", border: "1px solid rgba(63,176,108,0.08)" }
              }
            >
              Todas
            </button>
            {connections.map((conn) => {
              const accent   = conn.type === "meta" ? "#1877F2" : "#f59e0b";
              const isActive = activeConn === conn.id;
              return (
                <button
                  key={conn.id}
                  onClick={() => setActiveConn(isActive ? null : conn.id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                  style={isActive
                    ? { background: `${accent}20`, color: accent, border: `1px solid ${accent}50` }
                    : { background: "rgba(0,0,0,0.2)", color: "#6b8a75", border: "1px solid rgba(63,176,108,0.08)" }
                  }
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: isActive ? accent : "#6b8a75" }} />
                  {conn.type === "meta" ? "Meta" : "Z-API"}
                  {conn.phone && (
                    <span className="opacity-60 text-[10px]">· {shortPhone(conn.phone)}</span>
                  )}
                </button>
              );
            })}
          </div>

          {zapiConnections.length > 0 && (
            <button
              onClick={() => setShowNewConv(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold shrink-0 transition-all"
              style={{ background: "rgba(63,176,108,0.12)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }}
            >
              <Plus className="w-3.5 h-3.5" />
              Nova conversa
            </button>
          )}
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className={selectedConv ? "hidden md:flex" : "flex w-full md:w-auto"}>
          <ConversationList
            conversations={filteredByConn}
            loading={loading}
            selectedId={selectedConv?.id ?? null}
            onSelect={handleSelect}
            teamMembers={teamMembers}
            departments={departments}
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

      <NewConversationDialog
        open={showNewConv}
        onClose={() => setShowNewConv(false)}
        zapiConnections={zapiConnections}
        workspaceId={wsId}
        onCreated={handleConversationCreated}
        initialConnId={
          // Se o chip ativo no header for Z-API, pré-selecionar; senão, usar a primeira Z-API disponível
          (activeConn && zapiConnections.some((c) => c.id === activeConn) ? activeConn : null)
          ?? zapiConnections[0]?.id
          ?? ""
        }
      />
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

function shortPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (local.length === 11) return `${local.slice(0, 2)} ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `${local.slice(0, 2)} ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}
