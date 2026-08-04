import { useState, useEffect, useRef } from "react";
import { MessageSquare, Plus, LayoutDashboard, X as XIcon } from "lucide-react";
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
  const [activeConn,     setActiveConn]     = useState<string | null>(null);
  const [showNewConv,    setShowNewConv]    = useState(false);
  const [showSupervision,setShowSupervision]= useState(false);


  useEffect(() => {
    if (!wsId) return;

    supabase.from("departments")
      .select("*")
      .eq("workspace_id", wsId)
      .order("order_index", { ascending: true })
      .then(({ data }: { data: Department[] | null }) => {
        if (data) setDepartments(data);
      });

    Promise.all([
      supabase.from("meta_connections")
        .select("id, display_phone, phone_number_id")
        .eq("workspace_id", wsId),
      supabase.from("z_api_connections")
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
      supabase.from("department_members")
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
    const { data } = await supabase
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

          {isAdmin && (
            <button
              onClick={() => setShowSupervision(v => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold shrink-0 transition-all"
              style={showSupervision
                ? { background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }
                : { background: "rgba(0,0,0,0.2)", color: "#6b8a75", border: "1px solid rgba(63,176,108,0.08)" }}
            >
              <LayoutDashboard className="w-3 h-3" />
              Supervisão
            </button>
          )}

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

      {/* ── Supervisor panel ──────────────────────────────────── */}
      {isAdmin && showSupervision && (
        <SupervisionPanel
          conversations={visibleConversations}
          departments={departments}
          onClose={() => setShowSupervision(false)}
        />
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

function SupervisionPanel({
  conversations,
  departments,
  onClose,
}: {
  conversations: import("@/types/inbox").InboxConversation[];
  departments:   import("@/types/inbox").Department[];
  onClose:       () => void;
}) {
  // compute stats per department from already-loaded conversations
  const deptStats = departments.map(d => {
    const dConvs = conversations.filter(c => c.department_id === d.id);
    return {
      id:         d.id,
      name:       d.name,
      color:      d.color,
      open:       dConvs.filter(c => c.status === "open").length,
      pending:    dConvs.filter(c => c.status === "pending").length,
      resolved:   dConvs.filter(c => c.status === "resolved").length,
      unassigned: dConvs.filter(c => !c.assigned_to && c.status !== "resolved").length,
    };
  });

  const unrouted   = conversations.filter(c => !c.department_id && c.status !== "resolved").length;
  const totalOpen  = conversations.filter(c => c.status === "open").length;
  const totalPend  = conversations.filter(c => c.status === "pending").length;
  const totalUnassigned = conversations.filter(c => !c.assigned_to && c.status !== "resolved").length;

  return (
    <div className="shrink-0 px-5 py-3 space-y-2"
      style={{ background: "rgba(6,10,8,0.85)", borderBottom: "1px solid rgba(167,139,250,0.15)" }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
          <p className="text-[10px] font-bold text-purple-300 uppercase tracking-widest">Supervisão em tempo real</p>
          <span className="text-[10px] text-[#6b7f6e]">·  {totalOpen + totalPend} ativas · {totalUnassigned} sem atribuição</span>
        </div>
        <button onClick={onClose} className="text-[#6b7f6e] hover:text-white transition-colors">
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Department grid */}
      <div className="flex flex-wrap gap-2">
        {deptStats.map(d => (
          <div key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${d.color}22` }}>
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="text-[11px] font-semibold text-white">{d.name}</span>
            <div className="flex items-center gap-1.5 text-[10px]">
              {d.open > 0 && (
                <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>
                  {d.open} ab.
                </span>
              )}
              {d.pending > 0 && (
                <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c" }}>
                  {d.pending} esp.
                </span>
              )}
              {d.unassigned > 0 && (
                <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                  {d.unassigned} livre
                </span>
              )}
              {(d.open + d.pending) === 0 && (
                <span className="text-[#4a6b50]">sem fila</span>
              )}
            </div>
          </div>
        ))}

        {unrouted > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(239,68,68,0.15)" }}>
            <div className="w-2 h-2 rounded-full shrink-0 bg-red-400" />
            <span className="text-[11px] font-semibold text-red-300">Sem setor</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
              {unrouted}
            </span>
          </div>
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

function shortPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (local.length === 11) return `${local.slice(0, 2)} ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `${local.slice(0, 2)} ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}
