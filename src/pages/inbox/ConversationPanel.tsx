import { useState, useEffect, useRef } from "react";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { MoreVertical, UserCheck, UserMinus, ArrowRightLeft, Loader2, Pin, Archive, Trash2, ClipboardList, X, ChevronLeft } from "lucide-react";
import type { InboxConversation } from "@/types/inbox";
import type { UserProfile } from "@/context/AuthContext";
import { useAuth, initials as profileInitials, ROLE_LABELS, ROLE_STYLE } from "@/context/AuthContext";
import { useInboxMessages } from "@/hooks/useInbox";
import { supabase } from "@/lib/supabase";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { ContactHistory } from "@/pages/contacts/ContactHistory";

const CONVERSATION_TAGS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  importante:     { label: "Importante",     color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.25)"  },
  acompanhamento: { label: "Acompanhamento", color: "#60a5fa", bg: "rgba(59,130,246,0.1)",  border: "rgba(59,130,246,0.25)"  },
  urgente:        { label: "Urgente",        color: "#f87171", bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.25)"   },
  resolvido:      { label: "Resolvido",      color: "#3fb06c", bg: "rgba(63,176,108,0.1)",  border: "rgba(63,176,108,0.25)"  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Props {
  conversation:  InboxConversation;
  teamMembers:   UserProfile[];
  onBack?:       () => void;
  onPin:         (pinned: boolean) => void;
  onArchive:     (archived: boolean) => void;
  onDelete:      () => void;
  onUpdateTags:  (tags: string[]) => void;
}

async function triggerResolveMedia(conversationId: string) {
  try {
    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-media`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      },
    );
  } catch (e) {
    console.warn("[resolve-media] call failed:", e);
  }
}

export function ConversationPanel({ conversation, teamMembers, onBack, onPin, onArchive, onDelete, onUpdateTags }: Props) {
  const { profile, workspaceId } = useAuth();
  const contact     = conversation.inbox_contacts;
  const displayName = contact.name ?? contact.phone;
  const { messages, loading } = useInboxMessages(conversation.id);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const resolvedRef = useRef<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Auto-resolve media: whenever messages load for this conversation, check
  // for any with media_id but no media_url and call the edge function once.
  useEffect(() => {
    if (loading || messages.length === 0) return;
    const key = conversation.id;
    if (resolvedRef.current.has(key)) return; // already triggered for this conversation
    const hasPending = messages.some((m) => m.media_id && !m.media_url);
    if (!hasPending) return;
    resolvedRef.current.add(key);
    triggerResolveMedia(key); // fire-and-forget; realtime UPDATE propagates results
  }, [loading, messages, conversation.id]);

  return (
    <div className="flex-1 flex flex-row min-w-0 overflow-hidden">
      {/* ── Main column (header + messages + input) ────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

      {/* ── Contact header ─────────────────────────────────── */}
      <div
        className="px-5 py-3 shrink-0"
        style={{
          borderBottom: "1px solid rgba(63,176,108,0.1)",
          background: "rgba(10,17,14,0.9)",
          backdropFilter: "blur(8px)",
        }}
      >
        {/* Row 1: avatar, name, status, menu */}
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden p-1.5 -ml-1 mr-0 rounded-lg text-agro-muted hover:text-agro-text transition-colors shrink-0"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 select-none"
            style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
          >
            {initials(displayName)}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-agro-text truncate leading-none">
              {displayName}
            </p>
            <p className="text-[11px] text-agro-muted font-mono mt-0.5">{contact.phone}</p>
          </div>

          <StatusBadge status={conversation.status} />

          <img
            src="/logo.png"
            alt="Solve AI"
            className="h-6 w-auto object-contain opacity-40"
            style={{ filter: "drop-shadow(0 0 4px rgba(63,176,108,0.3))" }}
          />

          <button
            onClick={() => setShowHistory((v) => !v)}
            title="Histórico do cliente"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={
              showHistory
                ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }
                : { color: "#6b8a75", border: "1px solid rgba(63,176,108,0.1)" }
            }
          >
            <ClipboardList className="w-4 h-4" />
          </button>

          <ConversationActionsMenu
            conversation={conversation}
            onPin={onPin}
            onArchive={onArchive}
            onDelete={onDelete}
            onUpdateTags={onUpdateTags}
          />
        </div>

        {/* Row 2: assignment bar */}
        {profile && (
          <div className="mt-2.5">
            <AssignmentBar
              conversation={conversation}
              teamMembers={teamMembers}
              myProfile={profile}
            />
          </div>
        )}
      </div>

      {/* ── Message list ───────────────────────────────────── */}
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
          const prev    = messages[i - 1];
          const showSep =
            !prev || !isSameDay(new Date(msg.created_at), new Date(prev.created_at));
          return (
            <div key={msg.id}>
              {showSep && <DateSeparator date={msg.created_at} />}
              <MessageBubble
                message={msg}
                teamMembers={teamMembers}
                currentUserId={profile?.id}
              />
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* ── Reply bar ──────────────────────────────────────── */}
      <MessageInput
        conversationId={conversation.id}
        workspaceId={conversation.workspace_id}
        sentBy={profile?.id ?? ""}
      />

      </div>{/* end main column */}

      {/* ── History sidebar ─────────────────────────────────── */}
      {showHistory && contact.phone && (
        <div
          className="flex flex-col overflow-hidden shrink-0"
          style={{
            width: 280,
            borderLeft: "1px solid rgba(63,176,108,0.1)",
            background: "rgba(8,14,10,0.7)",
          }}
        >
          {/* Sidebar header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="w-3.5 h-3.5 text-[#3fb06c]" />
              <span className="text-xs font-semibold text-agro-text">Histórico</span>
            </div>
            <button
              onClick={() => setShowHistory(false)}
              className="w-6 h-6 flex items-center justify-center rounded text-agro-muted hover:text-agro-text transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* History content */}
          <div className="flex-1 overflow-hidden p-3">
            <ContactHistory
              phone={contact.phone}
              contactName={contact.name ?? undefined}
              workspaceId={workspaceId ?? ""}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── ConversationActionsMenu ─────────────────────────────────

interface ActionsMenuProps {
  conversation: InboxConversation;
  onPin:        (pinned: boolean) => void;
  onArchive:    (archived: boolean) => void;
  onDelete:     () => void;
  onUpdateTags: (tags: string[]) => void;
}

function ConversationActionsMenu({ conversation, onPin, onArchive, onDelete, onUpdateTags }: ActionsMenuProps) {
  const [open, setOpen]                   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref                               = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function toggleTag(tag: string) {
    const current = conversation.tags ?? [];
    const next    = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    onUpdateTags(next);
  }

  const tags = conversation.tags ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen((v) => !v); setConfirmDelete(false); }}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors"
        style={{ border: "1px solid rgba(63,176,108,0.1)" }}
        title="Mais opções"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-xl overflow-hidden"
          style={{
            background:   "rgba(13,26,17,0.98)",
            border:       "1px solid rgba(63,176,108,0.2)",
            boxShadow:    "0 8px 32px rgba(0,0,0,0.5)",
            minWidth:     200,
            backdropFilter: "blur(16px)",
          }}
        >
          {/* Pin */}
          <button
            onClick={() => { onPin(!conversation.pinned); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-agro-muted hover:text-agro-text hover:bg-white/5 transition-colors"
          >
            <Pin
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: conversation.pinned ? "#f59e0b" : undefined, transform: "rotate(45deg)" }}
            />
            {conversation.pinned ? "Desafixar" : "Fixar conversa"}
          </button>

          {/* Archive */}
          <button
            onClick={() => { onArchive(!conversation.archived); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-agro-muted hover:text-agro-text hover:bg-white/5 transition-colors"
            style={{ borderTop: "1px solid rgba(63,176,108,0.06)" }}
          >
            <Archive className="w-3.5 h-3.5 shrink-0" />
            {conversation.archived ? "Desarquivar" : "Arquivar"}
          </button>

          {/* Tags */}
          <div style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-agro-muted-2 px-3 pt-2.5 pb-1 select-none">
              Tags
            </p>
            {Object.entries(CONVERSATION_TAGS).map(([key, cfg]) => {
              const active = tags.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleTag(key)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-white/5"
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center"
                    style={{
                      background: active ? cfg.bg : "rgba(255,255,255,0.05)",
                      border:     `1px solid ${active ? cfg.border : "rgba(255,255,255,0.1)"}`,
                    }}
                  >
                    {active && (
                      <span className="w-1.5 h-1.5 rounded-full block" style={{ background: cfg.color }} />
                    )}
                  </span>
                  <span style={{ color: active ? cfg.color : undefined }} className={active ? "" : "text-agro-muted"}>
                    {cfg.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Delete */}
          <div style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-red-400 hover:bg-red-400/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                Excluir conversa
              </button>
            ) : (
              <div className="px-3 py-2.5 space-y-2">
                <p className="text-xs text-agro-muted">Tem certeza? Esta ação é irreversível.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 py-1.5 rounded-lg text-xs text-agro-muted transition-colors hover:bg-white/5"
                    style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => { onDelete(); setOpen(false); }}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
                    style={{ background: "#ef4444" }}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AssignmentBar ───────────────────────────────────────────

interface AssignmentBarProps {
  conversation: InboxConversation;
  teamMembers: UserProfile[];
  myProfile: UserProfile;
}

function AssignmentBar({ conversation, teamMembers, myProfile }: AssignmentBarProps) {
  const [saving, setSaving] = useState(false);
  const isAdminManager = ["admin", "manager"].includes(myProfile.role);
  const assignedToMe   = conversation.assigned_to === myProfile.id;
  const unassigned     = conversation.assigned_to === null;

  const assignee = unassigned
    ? null
    : teamMembers.find((m) => m.id === conversation.assigned_to) ?? null;

  async function patch(newAssignedTo: string | null) {
    setSaving(true);
    await db
      .from("inbox_conversations")
      .update({ assigned_to: newAssignedTo })
      .eq("id", conversation.id);
    setSaving(false);
    // Realtime will fire and update the conversation in the parent
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Current assignee pill */}
      {unassigned ? (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{
            background: "rgba(107,114,128,0.1)",
            color: "#9ca3af",
            border: "1px solid rgba(107,114,128,0.2)",
          }}
        >
          <UserMinus className="w-3 h-3" />
          Na fila
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{
            background: assignedToMe
              ? "rgba(63,176,108,0.12)"
              : "rgba(59,130,246,0.1)",
            color: assignedToMe ? "#3fb06c" : "#60a5fa",
            border: `1px solid ${assignedToMe ? "rgba(63,176,108,0.25)" : "rgba(59,130,246,0.25)"}`,
          }}
        >
          <UserCheck className="w-3 h-3" />
          {assignedToMe
            ? "Você"
            : assignee?.full_name ?? "Agente"}
          {!assignedToMe && assignee && (
            <span
              className="text-[8px] px-1 rounded"
              style={{ background: ROLE_STYLE[assignee.role].bg, color: ROLE_STYLE[assignee.role].color }}
            >
              {ROLE_LABELS[assignee.role]}
            </span>
          )}
        </span>
      )}

      {/* "Assumir" button — anyone can claim an unassigned conversation */}
      {unassigned && (
        <button
          disabled={saving}
          onClick={() => patch(myProfile.id)}
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-0.5 rounded-full transition-all disabled:opacity-50"
          style={{
            background: "rgba(63,176,108,0.15)",
            color: "#3fb06c",
            border: "1px solid rgba(63,176,108,0.35)",
          }}
        >
          {saving ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <UserCheck className="w-3 h-3" />
          )}
          Assumir
        </button>
      )}

      {/* Transfer dropdown — admin/manager only */}
      {isAdminManager && teamMembers.length > 0 && (
        <TransferDropdown
          conversation={conversation}
          teamMembers={teamMembers}
          myId={myProfile.id}
          onTransfer={patch}
          saving={saving}
        />
      )}
    </div>
  );
}

// ── TransferDropdown ────────────────────────────────────────

interface TransferProps {
  conversation: InboxConversation;
  teamMembers: UserProfile[];
  myId: string;
  onTransfer: (id: string | null) => void;
  saving: boolean;
}

function TransferDropdown({ conversation, teamMembers, myId, onTransfer, saving }: TransferProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        disabled={saving}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-0.5 rounded-full transition-all disabled:opacity-50"
        style={{
          background: "rgba(59,130,246,0.08)",
          color: "#60a5fa",
          border: "1px solid rgba(59,130,246,0.2)",
        }}
      >
        <ArrowRightLeft className="w-3 h-3" />
        Transferir
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden"
          style={{
            background: "rgba(13,26,17,0.98)",
            border: "1px solid rgba(63,176,108,0.2)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            minWidth: 180,
          }}
        >
          {/* Unassign option */}
          <button
            onClick={() => { onTransfer(null); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-agro-muted hover:bg-white/5 transition-colors"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.06)" }}
          >
            <UserMinus className="w-3.5 h-3.5 text-agro-muted-2" />
            Devolver para a fila
          </button>

          {/* Team members */}
          {teamMembers.map((member) => {
            const isCurrentAssignee = member.id === conversation.assigned_to;
            const rs = ROLE_STYLE[member.role];
            return (
              <button
                key={member.id}
                disabled={isCurrentAssignee}
                onClick={() => { onTransfer(member.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {/* Mini avatar */}
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0"
                  style={{ background: rs.color }}
                >
                  {profileInitials(member.full_name).slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-agro-text truncate">
                    {member.full_name ?? "—"}
                    {member.id === myId && (
                      <span className="ml-1 text-[9px] text-agro-green">(você)</span>
                    )}
                  </p>
                  <p className="text-[9px]" style={{ color: rs.color }}>
                    {ROLE_LABELS[member.role]}
                  </p>
                </div>
                {isCurrentAssignee && (
                  <span className="text-[9px] text-agro-muted-2">atual</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function DateSeparator({ date }: { date: string }) {
  const d = new Date(date);
  let label: string;
  if (isToday(d))     label = "Hoje";
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
