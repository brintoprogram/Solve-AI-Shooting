import { useState } from "react";
import { Search, MessageSquareDashed, Clock, User, List, Archive } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import type { UserProfile } from "@/context/AuthContext";
import type { InboxConversation, Department } from "@/types/inbox";

type TabId = "waiting" | "mine" | "all" | "archived";

const CONVERSATION_TAGS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  importante:     { label: "Importante",     color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.25)"  },
  acompanhamento: { label: "Acompanhamento", color: "#60a5fa", bg: "rgba(59,130,246,0.1)",  border: "rgba(59,130,246,0.25)"  },
  urgente:        { label: "Urgente",        color: "#f87171", bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.25)"   },
  resolvido:      { label: "Resolvido",      color: "#3fb06c", bg: "rgba(63,176,108,0.1)",  border: "rgba(63,176,108,0.25)"  },
};

interface Props {
  conversations: InboxConversation[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (conv: InboxConversation) => void;
  teamMembers: UserProfile[];
  departments?: Department[];
}

export function ConversationList({
  conversations, loading, selectedId, onSelect, teamMembers, departments = [],
}: Props) {
  const { profile } = useAuth();
  const [search, setSearch]         = useState("");
  const [activeTab, setActiveTab]   = useState<TabId>("mine");
  const [activeDept, setActiveDept] = useState<string | null>(null);

  const myId           = profile?.id ?? "";
  const isAdminManager = profile ? ["admin", "manager"].includes(profile.role) : false;

  const tabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "waiting",  label: "Aguardando",  icon: Clock   },
    { id: "mine",     label: "Minhas",      icon: User    },
    ...(isAdminManager ? [{ id: "all" as TabId, label: "Todas", icon: List }] : []),
    { id: "archived", label: "Arquivadas",  icon: Archive },
  ];

  const active = conversations.filter((c) => !c.archived);
  const byTab = (activeTab === "archived" ? conversations.filter((c) => c.archived) : active).filter((c) => {
    if (activeTab === "waiting")  return c.assigned_to === null;
    if (activeTab === "mine")     return c.assigned_to === myId;
    if (activeTab === "archived") return true;
    return true;
  });

  const byDept = activeDept === "__central"
    ? byTab.filter((c) => c.department_id === null)
    : activeDept
    ? byTab.filter((c) => c.department_id === activeDept)
    : byTab;

  const filtered = byDept
    .filter((c) => {
      const name = (c.inbox_contacts.name ?? c.inbox_contacts.phone).toLowerCase();
      const q = search.toLowerCase();
      return name.includes(q) || c.inbox_contacts.phone.includes(q);
    })
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });

  const counts: Record<TabId, number> = {
    waiting:  active.filter((c) => c.assigned_to === null).length,
    mine:     active.filter((c) => c.assigned_to === myId).length,
    all:      active.length,
    archived: conversations.filter((c) => c.archived).length,
  };

  const memberMap = new Map(teamMembers.map((m) => [m.id, m]));

  return (
    <div
      className="flex flex-col w-full md:w-[360px] md:shrink-0 overflow-hidden"
      style={{ borderRight: "1px solid rgba(63,176,108,0.1)" }}
    >
      {/* ── Header ──────────────────────────────────── */}
      <div className="px-4 pt-4 pb-0" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
        {/* Title row */}
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

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-agro-muted-2 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar contato ou número..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-agro w-full pl-8 text-xs h-9"
            style={{ transition: "box-shadow 0.15s" }}
            onFocus={(e) => { e.currentTarget.style.boxShadow = "0 0 0 2px rgba(63,176,108,0.2)"; }}
            onBlur={(e) => { e.currentTarget.style.boxShadow = "none"; }}
          />
        </div>

        {/* Tabs — underline style */}
        <div className="flex">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 flex items-center justify-center gap-1 pb-2.5 pt-1 text-[10px] font-semibold transition-colors duration-150"
                style={
                  isActive
                    ? { color: "#3fb06c", borderBottom: "2px solid #3fb06c" }
                    : { color: "#4a6052", borderBottom: "2px solid transparent" }
                }
              >
                <span>{tab.label}</span>
                {counts[tab.id] > 0 && (
                  <span
                    className="text-[8px] font-bold px-1.5 py-0.5 rounded-full"
                    style={
                      isActive
                        ? { background: "rgba(63,176,108,0.2)", color: "#3fb06c" }
                        : { background: "rgba(255,255,255,0.05)", color: "#4a6052" }
                    }
                  >
                    {counts[tab.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filtro de Setor ──────────────────────────── */}
      {departments.length > 0 && (
        <div className="px-4 pt-3 pb-2.5" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-2.5" style={{ color: "#4a6052" }}>
            Setor
          </p>
          <div className="flex gap-2 flex-wrap">
            {/* Todos */}
            <button
              onClick={() => setActiveDept(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
              style={!activeDept
                ? { background: "rgba(63,176,108,0.18)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.35)" }
                : { background: "rgba(0,0,0,0.2)", color: "#6b8a75", border: "1px solid rgba(63,176,108,0.08)" }
              }
            >
              Todos
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-md min-w-[20px] text-center"
                style={!activeDept
                  ? { background: "rgba(63,176,108,0.25)", color: "#3fb06c" }
                  : { background: "rgba(255,255,255,0.06)", color: "#4a6052" }
                }
              >
                {byTab.length}
              </span>
            </button>

            {/* Cada departamento */}
            {departments.map((d) => {
              const isActive = activeDept === d.id;
              const count    = byTab.filter((c) => c.department_id === d.id).length;
              return (
                <button
                  key={d.id}
                  onClick={() => setActiveDept(isActive ? null : d.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
                  style={isActive
                    ? { background: `${d.color}22`, color: d.color, border: `1px solid ${d.color}55` }
                    : { background: "rgba(0,0,0,0.2)", color: "#6b8a75", border: "1px solid rgba(63,176,108,0.08)" }
                  }
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: isActive ? d.color : "#4a6052" }}
                  />
                  {d.name}
                  {count > 0 && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-md min-w-[20px] text-center"
                      style={isActive
                        ? { background: `${d.color}30`, color: d.color }
                        : { background: "rgba(255,255,255,0.06)", color: "#4a6052" }
                      }
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Central (sem setor) — só mostra se houver */}
            {(() => {
              const count = byTab.filter((c) => c.department_id === null).length;
              if (count === 0) return null;
              const isActive = activeDept === "__central";
              return (
                <button
                  onClick={() => setActiveDept(isActive ? null : "__central")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
                  style={isActive
                    ? { background: "rgba(107,114,128,0.2)", color: "#9ca3af", border: "1px solid rgba(107,114,128,0.4)" }
                    : { background: "rgba(0,0,0,0.2)", color: "#6b8a75", border: "1px solid rgba(63,176,108,0.08)" }
                  }
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: isActive ? "#9ca3af" : "#4a6052" }} />
                  Sem setor
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-md min-w-[20px] text-center"
                    style={isActive
                      ? { background: "rgba(107,114,128,0.25)", color: "#9ca3af" }
                      : { background: "rgba(255,255,255,0.06)", color: "#4a6052" }
                    }
                  >
                    {count}
                  </span>
                </button>
              );
            })()}
          </div>
        </div>
      )}


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

          // Status bar color: urgente > aguardando atendente > ativo > arquivada
          const statusColor = conv.archived
            ? "#374151"
            : conv.tags?.includes("urgente")
            ? "#ef4444"
            : conv.last_message_direction === "inbound"
            ? "#f59e0b"
            : "#3fb06c";

          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv)}
              className="w-full flex items-start gap-3 px-4 py-3 text-left relative group transition-colors duration-100"
              style={
                isSelected
                  ? { background: "rgba(63,176,108,0.1)", borderLeft: `3px solid ${statusColor}` }
                  : { borderLeft: `3px solid ${statusColor}` }
              }
            >
              {!isSelected && (
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{ background: "rgba(63,176,108,0.04)" }}
                />
              )}

              {/* Avatar — 44px */}
              <div className="relative shrink-0">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold text-white select-none"
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
              <div className="flex-1 min-w-0">
                {/* Row 1: Name + time + unread */}
                <div className="flex items-start justify-between gap-1 mb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {conv.pinned && (
                      <svg className="w-2.5 h-2.5 shrink-0 text-amber-400 fill-amber-400" viewBox="0 0 24 24">
                        <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
                      </svg>
                    )}
                    <p
                      className={`text-[13px] truncate leading-tight ${
                        hasUnread ? "font-semibold text-white" : "font-medium text-agro-text-2"
                      }`}
                    >
                      {displayName}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="text-[10px] text-agro-muted-2 whitespace-nowrap">
                      {formatTime(conv.last_message_at)}
                    </p>
                    {hasUnread && (
                      <span
                        className="min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold text-white px-1"
                        style={{ background: "#3fb06c" }}
                      >
                        {conv.unread_count > 99 ? "99+" : conv.unread_count}
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 2: Preview + assignee */}
                <div className="flex items-center justify-between gap-1">
                  <p
                    className={`text-xs truncate flex items-center gap-1 ${
                      hasUnread ? "text-agro-muted" : "text-agro-muted-2"
                    }`}
                  >
                    {conv.last_message_direction === "outbound" && (
                      <span className="shrink-0 text-agro-muted-2" style={{ fontSize: "10px" }}>Você:</span>
                    )}
                    {conv.last_message_body ?? ""}
                  </p>

                  {/* Assignee — só mostra se atribuído e admin/manager */}
                  {isAdminManager && assignee && (
                    <AssigneeMini assignee={assignee} />
                  )}
                </div>

                {/* Row 3: Tags + dept */}
                {(conv.tags?.length > 0 || conv.departments) && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {conv.tags?.map((tag) => {
                      const cfg = CONVERSATION_TAGS[tag];
                      if (!cfg) return null;
                      return (
                        <span
                          key={tag}
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}
                        >
                          {cfg.label}
                        </span>
                      );
                    })}
                    {conv.departments && (
                      <span
                        className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-1"
                        style={{
                          color:      conv.departments.color,
                          background: `${conv.departments.color}18`,
                          border:     `1px solid ${conv.departments.color}45`,
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: conv.departments.color }} />
                        {conv.departments.name}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function AssigneeMini({ assignee }: { assignee: UserProfile }) {
  const firstName = (assignee.full_name ?? "Agente").split(" ")[0];
  const label     = firstName.length > 8 ? firstName.slice(0, 7) + "…" : firstName;

  if (assignee.avatar_url) {
    return (
      <div className="flex items-center gap-1 shrink-0" title={assignee.full_name ?? "Agente"}>
        <img
          src={assignee.avatar_url}
          alt={firstName}
          className="w-4 h-4 rounded-full object-cover shrink-0"
          style={{ border: "1px solid rgba(63,176,108,0.3)" }}
        />
        <span className="text-[9px] font-medium text-agro-muted-2 max-w-[44px] truncate">
          {label}
        </span>
      </div>
    );
  }

  return (
    <span
      title={assignee.full_name ?? "Agente"}
      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 max-w-[56px] truncate"
      style={{
        background: "rgba(63,176,108,0.08)",
        color: "#6b8a75",
        border: "1px solid rgba(63,176,108,0.15)",
      }}
    >
      {label}
    </span>
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

function shortPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (local.length === 11) return `${local.slice(0, 2)} ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `${local.slice(0, 2)} ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}
