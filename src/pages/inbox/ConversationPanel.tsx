import { useState, useEffect, useRef, useCallback } from "react";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { MoreVertical, UserCheck, UserMinus, ArrowRightLeft, Loader2, Pin, Archive, Trash2, ClipboardList, X, ChevronLeft, GitBranch, Info, Bot, Handshake } from "lucide-react";
import type { InboxConversation, Department } from "@/types/inbox";
import type { UserProfile } from "@/context/AuthContext";
import { useAuth, initials as profileInitials, ROLE_LABELS, ROLE_STYLE } from "@/context/AuthContext";
import { useInboxMessages } from "@/hooks/useInbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { ContactHistory } from "@/pages/contacts/ContactHistory";
import { initials } from "@/lib/format";

const CONVERSATION_TAGS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  importante:     { label: "Importante",     color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.25)"  },
  acompanhamento: { label: "Acompanhamento", color: "#60a5fa", bg: "rgba(59,130,246,0.1)",  border: "rgba(59,130,246,0.25)"  },
  urgente:        { label: "Urgente",        color: "#f87171", bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.25)"   },
  resolvido:      { label: "Resolvido",      color: "#3fb06c", bg: "rgba(63,176,108,0.1)",  border: "rgba(63,176,108,0.25)"  },
};


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
  const { toast } = useToast();
  const contact     = conversation.inbox_contacts;
  const displayName = contact.name ?? contact.phone;
  const { messages, loading, deleteMessage } = useInboxMessages(conversation.id);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const resolvedRef = useRef<Set<string>>(new Set());
  const [showPanel, setShowPanel] = useState(() => {
    try { return localStorage.getItem("inbox_panel_open") === "true"; } catch { return false; }
  });
  const [startingNegotiation, setStartingNegotiation] = useState(false);

  async function handleStartNegotiation() {
    setStartingNegotiation(true);
    try {
      const { data, error } = await supabase.functions.invoke("negotiation-agent", {
        body: { conversation_id: conversation.id, manual: true },
      });
      if (error) throw error;
      if (data?.reason === "no_open_invoice") {
        toast({ title: "Nenhuma fatura em aberto", description: "Este contato não tem fatura pendente/vencida para negociar.", variant: "destructive" });
      } else {
        toast({ title: "Negociação iniciada" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Erro ao iniciar negociação", description: msg, variant: "destructive" });
    } finally {
      setStartingNegotiation(false);
    }
  }

  const [aiAgents,      setAiAgents]      = useState<{ id: string; name: string }[]>([]);
  const [aiAgentId,     setAiAgentId]     = useState<string | null>(conversation.ai_agent_id ?? null);
  const [agentSaving,   setAgentSaving]   = useState(false);

  const fetchAiAgents = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from("ai_agents")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    setAiAgents(data ?? []);
  }, [workspaceId]);

  useEffect(() => { fetchAiAgents(); }, [fetchAiAgents]);
  useEffect(() => { setAiAgentId(conversation.ai_agent_id ?? null); }, [conversation.ai_agent_id]);

  async function handleAgentChange(newAgentId: string | null) {
    setAgentSaving(true);
    await supabase
      .from("inbox_conversations")
      .update({ ai_agent_id: newAgentId })
      .eq("id", conversation.id);
    setAiAgentId(newAgentId);
    setAgentSaving(false);
  }

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
          position: "relative",
          zIndex: 20,
          borderBottom: "1px solid rgba(63,176,108,0.1)",
          background: "rgba(10,17,14,0.9)",
          backdropFilter: "blur(8px)",
        }}
      >
        {/* Row 1: back button, avatar, name/phone, actions */}
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden p-1.5 -ml-1 mr-0 rounded-lg text-agro-muted hover:text-agro-text hover:bg-white/5 transition-colors shrink-0"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 select-none"
            style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
          >
            {initials(displayName)}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-agro-text truncate leading-tight">
              {displayName}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-[11px] text-agro-muted-2 font-mono">{contact.phone}</p>
              {conversation.meta_connection_id && (
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                  style={{ background: "rgba(24,119,242,0.15)", color: "#1877F2", border: "1px solid rgba(24,119,242,0.3)" }}
                >
                  Meta
                </span>
              )}
              {conversation.z_api_connection_id && (
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                  style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}
                >
                  Z-API
                </span>
              )}
            </div>
          </div>

          {/* Actions cluster — right side */}
          <div className="flex items-center gap-1 shrink-0">
            <StatusBadge status={conversation.status} />

            <AgentQuickPicker
              agents={aiAgents}
              currentId={aiAgentId}
              saving={agentSaving}
              onChange={handleAgentChange}
            />

            <button
              onClick={() => {
                const next = !showPanel;
                setShowPanel(next);
                try { localStorage.setItem("inbox_panel_open", String(next)); } catch { /* noop */ }
              }}
              title="Informações do contato"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5"
              style={
                showPanel
                  ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }
                  : { color: "#6b8a75", border: "1px solid rgba(63,176,108,0.1)" }
              }
            >
              <Info className="w-4 h-4" />
            </button>

            <ConversationActionsMenu
              conversation={conversation}
              onPin={onPin}
              onArchive={onArchive}
              onDelete={onDelete}
              onUpdateTags={onUpdateTags}
            />
          </div>
        </div>

        {/* Row 2: assignment bar */}
        {profile && (
          <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
            <AssignmentBar
              conversation={conversation}
              teamMembers={teamMembers}
              myProfile={profile}
            />
            <button
              onClick={handleStartNegotiation}
              disabled={startingNegotiation}
              title="Inicia a negociação de dívida para este contato (usa a fatura pendente mais antiga)"
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-0.5 rounded-full transition-all disabled:opacity-50 shrink-0"
              style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}
            >
              {startingNegotiation ? <Loader2 className="w-3 h-3 animate-spin" /> : <Handshake className="w-3 h-3" />}
              Iniciar negociação
            </button>
          </div>
        )}
      </div>

      {/* ── Message list ───────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto scrollbar-thin py-5"
        style={{ background: "rgba(8,14,10,0.6)" }}
      >
        <div className="px-4">
          {loading && (
            <div className="flex justify-center py-10">
              <div className="w-5 h-5 rounded-full border-2 border-agro-green border-t-transparent animate-spin" />
            </div>
          )}

          {!loading && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-20">
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
                  onDelete={deleteMessage}
                />
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Reply bar ──────────────────────────────────────── */}
      <MessageInput
        conversationId={conversation.id}
        workspaceId={conversation.workspace_id}
        contactId={conversation.contact_id}
        sentBy={profile?.id ?? ""}
        senderName={profile?.full_name ?? ""}
      />

      </div>{/* end main column */}

      {/* ── History sidebar ─────────────────────────────────── */}
      {showPanel && (
        <div
          className="flex flex-col overflow-hidden shrink-0 lg:relative absolute inset-y-0 right-0 z-30"
          style={{
            width: 300,
            borderLeft: "1px solid rgba(63,176,108,0.1)",
            background: "rgba(8,14,10,0.97)",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
          >
            <div className="flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-[#3fb06c]" />
              <span className="text-xs font-semibold text-agro-text">Informações</span>
            </div>
            <button
              onClick={() => {
                setShowPanel(false);
                try { localStorage.setItem("inbox_panel_open", "false"); } catch { /* noop */ }
              }}
              className="w-6 h-6 flex items-center justify-center rounded text-agro-muted hover:text-agro-text hover:bg-white/5 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Panel body */}
          <div className="flex-1 overflow-y-auto scrollbar-thin divide-y" style={{ borderColor: "rgba(63,176,108,0.06)" }}>

            {/* ── Contato ── */}
            <div className="px-4 py-4">
              <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-3">Contato</p>
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
                >
                  {initials(displayName)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-agro-text truncate">{displayName}</p>
                  <p className="text-[11px] text-agro-muted-2 font-mono">{contact.phone}</p>
                </div>
              </div>
              {contact.first_seen_at && (
                <p className="text-[10px] text-agro-muted-2">
                  Cliente desde {format(new Date(contact.first_seen_at), "dd/MM/yyyy")}
                </p>
              )}
            </div>

            {/* ── Tags ── */}
            <div className="px-4 py-4">
              <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-2.5">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(CONVERSATION_TAGS).map(([key, cfg]) => {
                  const active = (conversation.tags ?? []).includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        const current = conversation.tags ?? [];
                        const next = current.includes(key) ? current.filter((t) => t !== key) : [...current, key];
                        onUpdateTags(next);
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors"
                      style={active
                        ? { color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }
                        : { color: "#4a6052", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(63,176,108,0.08)" }
                      }
                    >
                      {active && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />}
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Atribuição ── */}
            <div className="px-4 py-4">
              <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-2.5">Atribuição</p>
              {conversation.assigned_to ? (() => {
                const assignee = teamMembers.find((m) => m.id === conversation.assigned_to);
                return (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                      style={{ background: ROLE_STYLE[assignee?.role ?? "agent"]?.color ?? "#6b7280" }}
                    >
                      {profileInitials(assignee?.full_name ?? "?").slice(0, 2)}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-agro-text">{assignee?.full_name ?? "Agente"}</p>
                      <p className="text-[10px] text-agro-muted-2">{ROLE_LABELS[assignee?.role ?? "agent"] ?? "Agente"}</p>
                    </div>
                  </div>
                );
              })() : (
                <p className="text-xs text-agro-muted-2">Na fila · sem atribuição</p>
              )}
            </div>

            {/* ── Setor ── */}
            {conversation.departments && (
              <div className="px-4 py-4">
                <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-2.5">Setor</p>
                <span
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{
                    color: conversation.departments.color,
                    background: `${conversation.departments.color}18`,
                    border: `1px solid ${conversation.departments.color}45`,
                  }}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: conversation.departments.color }} />
                  {conversation.departments.name}
                </span>
              </div>
            )}

            {/* ── Agente de IA ── */}
            <div className="px-4 py-4" style={{ borderTop: "1px solid rgba(63,176,108,0.07)" }}>
              <div className="flex items-center gap-1.5 mb-2.5">
                <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider">Agente de IA</p>
                {agentSaving && <Loader2 className="w-3 h-3 text-agro-muted animate-spin" />}
              </div>
              {aiAgents.length === 0 ? (
                <p className="text-xs text-agro-muted/60">
                  Nenhum agente ativo.{" "}
                  <span className="text-agro-muted">Configure em Configurações → Agentes.</span>
                </p>
              ) : (
                <div className="space-y-1.5">
                  {aiAgentId && (
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-5 h-5 rounded-lg bg-agro-green/10 flex items-center justify-center shrink-0">
                        <Bot className="w-3 h-3 text-agro-green" />
                      </div>
                      <p className="text-xs font-medium text-agro-text truncate">
                        {aiAgents.find((a) => a.id === aiAgentId)?.name ?? "Agente"}
                      </p>
                    </div>
                  )}
                  <select
                    className="input-agro w-full text-xs"
                    value={aiAgentId ?? ""}
                    onChange={(e) => handleAgentChange(e.target.value || null)}
                    disabled={agentSaving}
                  >
                    <option value="">Nenhum (desativar agente)</option>
                    {aiAgents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* ── Notas & Histórico ── */}
            <div className="px-4 py-4">
              <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-3">Notas & Histórico</p>
              {contact.phone && (
                <ContactHistory
                  phone={contact.phone}
                  contactName={contact.name ?? undefined}
                  workspaceId={workspaceId ?? ""}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AgentQuickPicker ────────────────────────────────────────

interface AgentQuickPickerProps {
  agents:        { id: string; name: string }[];
  currentId:     string | null;
  saving:        boolean;
  onChange:      (id: string | null) => void;
}

function AgentQuickPicker({ agents, currentId, saving, onChange }: AgentQuickPickerProps) {
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const currentAgent = currentId ? agents.find((a) => a.id === currentId) : null;
  const isActive     = !!currentId;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={isActive ? `Agente: ${currentAgent?.name ?? "IA ativa"}` : "Ativar agente de IA"}
        className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5"
        style={
          isActive
            ? { background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.35)" }
            : { color: "#6b8a75", border: "1px solid rgba(63,176,108,0.1)" }
        }
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 z-50 w-52 rounded-2xl py-1 shadow-2xl"
          style={{ background: "#0c1810", border: "1px solid rgba(63,176,108,0.25)", boxShadow: "0 12px 40px rgba(0,0,0,0.85)" }}
        >
          <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest px-3 pt-2 pb-1">Agente de IA</p>

          {/* No agent option */}
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-white/5 ${!currentId ? "text-agro-text" : "text-agro-muted"}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${!currentId ? "bg-agro-green" : "bg-transparent"}`} />
            <span>Sem agente</span>
          </button>

          {agents.length > 0 && (
            <div className="mx-3 my-1" style={{ height: "1px", background: "rgba(63,176,108,0.08)" }} />
          )}

          {agents.map((agent) => {
            const selected = agent.id === currentId;
            return (
              <button
                key={agent.id}
                onClick={() => { onChange(agent.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-white/5 ${selected ? "text-agro-text" : "text-agro-muted"}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selected ? "bg-violet-400" : "bg-transparent"}`} />
                <Bot className={`w-3 h-3 shrink-0 ${selected ? "text-violet-400" : "text-agro-muted-2"}`} />
                <span className="truncate">{agent.name}</span>
              </button>
            );
          })}

          {agents.length === 0 && (
            <p className="px-3 py-2 text-xs text-agro-muted/60">Nenhum agente ativo. Crie em Configurações → Agentes.</p>
          )}
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
  const { workspaceId, profile }      = useAuth();
  const [open, setOpen]               = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteMode, setNoteMode]       = useState(false);
  const [noteDraft, setNoteDraft]     = useState("");
  const [noteSaving, setNoteSaving]   = useState(false);
  const ref                           = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmDelete(false);
        setNoteMode(false);
        setNoteDraft("");
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

  async function saveNote() {
    if (!noteDraft.trim() || !workspaceId) return;
    setNoteSaving(true);
    await supabase.from("contact_notes").insert({
      workspace_id:    workspaceId,
      contact_phone:   conversation.inbox_contacts.phone,
      contact_name:    conversation.inbox_contacts.name ?? null,
      created_by:      profile?.id ?? null,
      created_by_name: profile?.full_name ?? null,
      type:            "manual",
      content:         noteDraft.trim(),
      follow_up_date:  null,
      follow_up_done:  false,
    });
    setNoteSaving(false);
    setNoteDraft("");
    setNoteMode(false);
    setOpen(false);
  }

  const tags = conversation.tags ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen((v) => !v); setConfirmDelete(false); setNoteMode(false); setNoteDraft(""); }}
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
            background: "#0c1810",
            border:     "1px solid rgba(63,176,108,0.25)",
            boxShadow:  "0 12px 40px rgba(0,0,0,0.85)",
            minWidth:   220,
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

          {/* Apontamento */}
          <div style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
            {!noteMode ? (
              <button
                onClick={() => setNoteMode(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-agro-muted hover:text-agro-text hover:bg-white/5 transition-colors"
              >
                <ClipboardList className="w-3.5 h-3.5 shrink-0" />
                Criar apontamento
              </button>
            ) : (
              <div className="px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-agro-muted-2">Apontamento</p>
                  <button onClick={() => { setNoteMode(false); setNoteDraft(""); }} className="text-agro-muted-2 hover:text-agro-muted transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <textarea
                  autoFocus
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Digite o apontamento..."
                  rows={3}
                  className="w-full resize-none text-xs text-agro-text placeholder-agro-muted-2 rounded-lg px-2.5 py-2 focus:outline-none"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border:     "1px solid rgba(63,176,108,0.15)",
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(); }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setNoteMode(false); setNoteDraft(""); }}
                    className="flex-1 py-1.5 rounded-lg text-xs text-agro-muted transition-colors hover:bg-white/5"
                    style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={saveNote}
                    disabled={!noteDraft.trim() || noteSaving}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-40"
                    style={{ background: "rgba(63,176,108,0.8)" }}
                  >
                    {noteSaving ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Salvar"}
                  </button>
                </div>
              </div>
            )}
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
  const [saving, setSaving]         = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const isAdminManager = ["admin", "manager"].includes(myProfile.role);
  const assignedToMe   = conversation.assigned_to === myProfile.id;
  const unassigned     = conversation.assigned_to === null;

  const assignee = unassigned
    ? null
    : teamMembers.find((m) => m.id === conversation.assigned_to) ?? null;

  useEffect(() => {
    supabase.from("departments")
      .select("*")
      .eq("workspace_id", conversation.workspace_id)
      .order("order_index", { ascending: true })
      .then(({ data }: { data: Department[] | null }) => { if (data) setDepartments(data); });
  }, [conversation.workspace_id]);

  async function patch(newAssignedTo: string | null) {
    setSaving(true);
    await supabase
      .from("inbox_conversations")
      .update({ assigned_to: newAssignedTo })
      .eq("id", conversation.id);
    setSaving(false);
  }

  async function patchDept(deptId: string | null) {
    setSaving(true);
    await supabase
      .from("inbox_conversations")
      .update({ department_id: deptId, assigned_to: null })
      .eq("id", conversation.id);
    setSaving(false);
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

      {/* Transfer to agent dropdown — admin/manager only */}
      {isAdminManager && teamMembers.length > 0 && (
        <TransferDropdown
          conversation={conversation}
          teamMembers={teamMembers}
          myId={myProfile.id}
          onTransfer={patch}
          saving={saving}
        />
      )}

      {/* Department badge + transfer — admin/manager only */}
      {isAdminManager && departments.length > 0 && (
        <DeptTransferDropdown
          conversation={conversation}
          departments={departments}
          onTransfer={patchDept}
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
            background: "#0c1810",
            border: "1px solid rgba(63,176,108,0.25)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.85)",
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

// ── DeptTransferDropdown ────────────────────────────────────

interface DeptTransferProps {
  conversation: InboxConversation;
  departments:  Department[];
  onTransfer:   (id: string | null) => void;
  saving:       boolean;
}

function DeptTransferDropdown({ conversation, departments, onTransfer, saving }: DeptTransferProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentDept = conversation.departments ?? null;

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
        style={currentDept
          ? { background: `${currentDept.color}20`, color: currentDept.color, border: `1px solid ${currentDept.color}50` }
          : { background: "rgba(107,114,128,0.08)", color: "#9ca3af", border: "1px solid rgba(107,114,128,0.2)" }
        }
      >
        <GitBranch className="w-3 h-3" />
        {currentDept ? currentDept.name : "Setor"}
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden"
          style={{
            background: "#0c1810",
            border: "1px solid rgba(63,176,108,0.25)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.85)",
            minWidth: 180,
          }}
        >
          <button
            onClick={() => { onTransfer(null); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-agro-muted hover:bg-white/5 transition-colors"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.06)" }}
          >
            <X className="w-3.5 h-3.5 text-agro-muted-2" />
            Sem setor (fila central)
          </button>
          {departments.map((dept) => {
            const isCurrent = dept.id === conversation.department_id;
            return (
              <button
                key={dept.id}
                disabled={isCurrent}
                onClick={() => { onTransfer(dept.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: dept.color }} />
                <p className="text-xs text-agro-text flex-1">{dept.name}</p>
                {isCurrent && <span className="text-[9px] text-agro-muted-2">atual</span>}
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
  if (isToday(d))          label = "Hoje";
  else if (isYesterday(d)) label = "Ontem";
  else                     label = format(d, "dd/MM/yyyy");

  return (
    <div className="flex items-center justify-center my-5">
      <span
        className="text-[10px] font-medium text-agro-muted-2 px-3 py-1 rounded-full select-none"
        style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(63,176,108,0.08)" }}
      >
        {label}
      </span>
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

