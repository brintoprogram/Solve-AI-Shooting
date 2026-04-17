import { useState } from "react";
import { Search, MessageSquareDashed, Clock, User, List } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { useAuth, initials as profileInitials, ROLE_STYLE } from "@/context/AuthContext";
import type { UserProfile } from "@/context/AuthContext";
import type { InboxConversation } from "@/types/inbox";

type TabId = "waiting" | "mine" | "all";

interface Props {
  conversations: InboxConversation[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (conv: InboxConversation) => void;
  teamMembers: UserProfile[];
}

export function ConversationList({
  conversations, loading, selectedId, onSelect, teamMembers,
}: Props) {
  const { profile } = useAuth();
  const [search, setSearch]     = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("waiting");

  const myId           = profile?.id ?? "";
  const isAdminManager = profile ? ["admin", "manager"].includes(profile.role) : false;

  // ── Tab filtering ──────────────────────────────────
  const tabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "waiting", label: "Aguardando", icon: Clock },
    { id: "mine",    label: "Minhas",     icon: User  },
    ...(isAdminManager ? [{ id: "all" as TabId, label: "Todas", icon: List }] : []),
  ];

  const byTab = conversations.filter((c) => {
    if (activeTab === "waiting") return c.assigned_to === null;
    if (activeTab === "mine")    return c.assigned_to === myId;
    return true; // "all"
  });

  const filtered = byTab.filter((c) => {
    const name = (c.inbox_contacts.name ?? c.inbox_contacts.phone).toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || c.inbox_contacts.phone.includes(q);
  });

  // Tab counts (from unfiltered conversations, ignoring search)
  const counts: Record<TabId, number> = {
    waiting: conversations.filter((c) => c.assigned_to === null).length,
    mine:    conversations.filter((c) => c.assigned_to === myId).length,
    all:     conversations.length,
  };

  // Member lookup map
  const memberMap = new Map(teamMembers.map((m) => [m.id, m]));

  return (
    <div
      className="flex flex-col shrink-0 overflow-hidden"
      style={{ width: 300, borderRight: "1px solid rgba(63,176,108,0.1)" }}
    >
      {/* ── Header ──────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
        {/* Title */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-sm font-bold text-agro-text">Conversas</h2>
          {counts.waiting > 0 && (
            <span
              className="text-[10px] font-bold text-white px-2 py-0.5 rounded-full"
              style={{ background: "#3fb06c" }}
            >
              {counts.waiting} na fila
            </span>
          )}
        </div>

        {/* Filter tabs */}
        <div
          className="flex rounded-xl overflow-hidden p-0.5 mb-3"
          style={{
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(63,176,108,0.08)",
          }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all duration-150"
                style={
                  isActive
                    ? {
                        background: "rgba(63,176,108,0.18)",
                        color: "#3fb06c",
                        border: "1px solid rgba(63,176,108,0.3)",
                      }
                    : { color: "#6b8a75", background: "transparent", border: "1px solid transparent" }
                }
              >
                <tab.icon className="w-3 h-3 shrink-0" />
                <span>{tab.label}</span>
                {counts[tab.id] > 0 && (
                  <span
                    className="ml-0.5 text-[8px] font-bold px-1 py-0.5 rounded-full"
                    style={
                      isActive
                        ? { background: "rgba(63,176,108,0.3)", color: "#3fb06c" }
                        : { background: "rgba(255,255,255,0.06)", color: "#6b8a75" }
                    }
                  >
                    {counts[tab.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search */}
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

      {/* ── List ────────────────────────────────────── */}
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
              {search
                ? "Nenhum resultado"
                : activeTab === "waiting"
                ? "Nenhuma conversa na fila"
                : activeTab === "mine"
                ? "Nenhuma conversa atribuída a você"
                : "Nenhuma conversa ainda"}
            </p>
          </div>
        )}

        {filtered.map((conv) => {
          const contact     = conv.inbox_contacts;
          const displayName = contact.name ?? contact.phone;
          const isSelected  = conv.id === selectedId;
          const hasUnread   = conv.unread_count > 0;
          const assignee    = conv.assigned_to ? memberMap.get(conv.assigned_to) : null;

          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left relative group transition-colors duration-100"
              style={
                isSelected
                  ? { background: "rgba(63,176,108,0.1)", borderLeft: "2px solid #3fb06c" }
                  : { borderLeft: "2px solid transparent" }
              }
            >
              {!isSelected && (
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{ background: "rgba(63,176,108,0.04)" }}
                />
              )}

              {/* Contact avatar with optional assignee micro-badge */}
              <div className="relative shrink-0">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white select-none"
                  style={{ background: hashColor(displayName) }}
                >
                  {initials(displayName)}
                </div>

                {/* Online dot */}
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
                      hasUnread ? "font-semibold text-agro-text" : "font-medium text-agro-text-2"
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

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Assignee mini-badge (admin/manager only) */}
                    {isAdminManager && (
                      <AssigneeMini assignee={assignee} />
                    )}

                    {hasUnread && (
                      <span
                        className="min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1"
                        style={{ background: "#3fb06c" }}
                      >
                        {conv.unread_count > 99 ? "99+" : conv.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function AssigneeMini({ assignee }: { assignee: UserProfile | null | undefined }) {
  if (!assignee) {
    // Unassigned — faint dashed circle
    return (
      <div
        title="Sem atribuição"
        className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold"
        style={{
          border: "1px dashed rgba(63,176,108,0.3)",
          color: "rgba(63,176,108,0.4)",
        }}
      >
        ?
      </div>
    );
  }

  const rs = ROLE_STYLE[assignee.role];
  return (
    <div
      title={assignee.full_name ?? "Agente"}
      className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white shrink-0"
      style={{ background: rs.color }}
    >
      {profileInitials(assignee.full_name).slice(0, 2)}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function formatTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isToday(d))     return format(d, "HH:mm");
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
