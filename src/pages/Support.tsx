import { useCallback, useEffect, useRef, useState } from "react";
import {
  LifeBuoy, Plus, X, Send, Paperclip, ChevronDown,
  FileText, Image as ImageIcon, Loader2, CheckCircle2,
  Clock, AlertCircle, XCircle, RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Topbar }    from "@/components/layout/Topbar";
import { supabase }  from "@/lib/supabase";
import { useAuth }   from "@/context/AuthContext";
import { useToast }  from "@/hooks/use-toast";


// ── Types ─────────────────────────────────────────────────────────

type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

interface Attachment { name: string; url: string; size: number; type: string }

interface Ticket {
  id: string;
  workspace_id: string;
  created_by: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  creator_name?: string;
}

interface TicketMessage {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  is_staff: boolean;
  attachments: Attachment[];
  created_at: string;
  author_name?: string;
}

// ── Constants ─────────────────────────────────────────────────────

const STATUS: Record<TicketStatus, { label: string; color: string; bg: string; border: string; icon: React.ComponentType<{ className?: string }> }> = {
  open:        { label: "Aberto",       color: "#3fb06c", bg: "rgba(63,176,108,0.12)",  border: "rgba(63,176,108,0.3)",  icon: Clock       },
  in_progress: { label: "Em Andamento", color: "#60a5fa", bg: "rgba(59,130,246,0.12)",  border: "rgba(59,130,246,0.3)",  icon: RefreshCw   },
  resolved:    { label: "Resolvido",    color: "#a78bfa", bg: "rgba(139,92,246,0.12)",  border: "rgba(139,92,246,0.3)",  icon: CheckCircle2 },
  closed:      { label: "Encerrado",    color: "#9ca3af", bg: "rgba(107,114,128,0.12)", border: "rgba(107,114,128,0.25)", icon: XCircle     },
};

const STATUS_FLOW: TicketStatus[] = ["open", "in_progress", "resolved", "closed"];

const MAX_FILES     = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// ── Helpers ───────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return format(new Date(iso), "dd/MM HH:mm", { locale: ptBR });
}

function fmtSize(bytes: number) {
  if (bytes < 1024)         return `${bytes} B`;
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(type: string) {
  return type.startsWith("image/");
}

async function callNotify(ticketId: string, event: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/support-notify`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${session.access_token}`,
      "apikey":        import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({ ticket_id: ticketId, event }),
  }).catch(() => {}); // fire-and-forget — never blocks the UI
}

// ── AttachmentPreview ─────────────────────────────────────────────

function AttachmentChip({ att }: { att: Attachment }) {
  if (isImage(att.type)) {
    return (
      <a href={att.url} target="_blank" rel="noreferrer" title={att.name}>
        <img
          src={att.url}
          alt={att.name}
          className="w-16 h-16 rounded-lg object-cover cursor-pointer hover:opacity-80 transition-opacity"
          style={{ border: "1px solid rgba(63,176,108,0.2)" }}
        />
      </a>
    );
  }
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-agro-muted hover:text-agro-text transition-colors"
      style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.15)" }}
    >
      <FileText className="w-3.5 h-3.5 shrink-0 text-agro-green" />
      <span className="truncate max-w-[140px]">{att.name}</span>
      <span className="text-[10px] text-agro-muted-2 shrink-0">{fmtSize(att.size)}</span>
    </a>
  );
}

// ── FilePreviewList ───────────────────────────────────────────────

function FilePreviewList({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {files.map((f, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-agro-muted"
          style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.15)" }}
        >
          {isImage(f.type) ? <ImageIcon className="w-3 h-3 text-agro-green" /> : <FileText className="w-3 h-3 text-agro-green" />}
          <span className="truncate max-w-[100px]">{f.name}</span>
          <button onClick={() => onRemove(i)} className="text-agro-muted-2 hover:text-red-400 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────

function StatusBadge({ status }: { status: TicketStatus }) {
  const s = STATUS[status] ?? STATUS.open;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  );
}

// ── NewTicketModal ────────────────────────────────────────────────

function NewTicketModal({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose:     () => void;
  onCreated:   (ticket: Ticket) => void;
}) {
  const { profile } = useAuth();
  const { toast }   = useToast();
  const [title,       setTitle]       = useState("");
  const [description, setDescription] = useState("");
  const [files,       setFiles]       = useState<File[]>([]);
  const [saving,      setSaving]      = useState(false);
  const [dragging,    setDragging]    = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: File[]) {
    const valid = incoming.filter((f) => {
      if (f.size > MAX_FILE_SIZE) {
        toast({ title: `${f.name} excede 10 MB`, variant: "destructive" });
        return false;
      }
      return true;
    });
    setFiles((prev) => [...prev, ...valid].slice(0, MAX_FILES));
  }

  async function handleSubmit() {
    if (!title.trim() || !description.trim()) return;
    setSaving(true);
    try {
      // Upload attachments first
      const attachments = await uploadFiles(files, workspaceId, "tickets");

      // Insert ticket
      const { data: ticket, error: ticketErr } = await supabase
        .from("support_tickets")
        .insert({ workspace_id: workspaceId, created_by: profile?.id, title: title.trim(), description: description.trim() })
        .select("*")
        .single();

      if (ticketErr) throw new Error(ticketErr.message);

      // Insert first message (description)
      if (description.trim() || attachments.length) {
        await supabase.from("support_messages").insert({
          ticket_id:    ticket.id,
          workspace_id: workspaceId,
          author_id:    profile?.id,
          body:         description.trim(),
          is_staff:     false,
          attachments,
        });
      }

      await callNotify(ticket.id, "created");
      toast({ title: "Ticket aberto!", description: "Nossa equipe responderá em breve.", variant: "success" });
      onCreated({ ...ticket, creator_name: profile?.full_name ?? "Você" });
      onClose();
    } catch (err) {
      toast({ title: "Não foi possível abrir o ticket", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl flex flex-col overflow-hidden"
        style={{ background: "#0d1a11", border: "1px solid rgba(63,176,108,0.2)", boxShadow: "0 32px 80px rgba(0,0,0,0.7)", maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}>
              <LifeBuoy className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-semibold text-agro-text text-sm">Novo Ticket de Suporte</p>
              <p className="text-[11px] text-agro-muted-2">Descreva sua dúvida ou problema</p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving} className="text-agro-muted-2 hover:text-agro-text transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest block mb-1.5">Título *</label>
            <input
              className="input-agro w-full"
              placeholder="Ex: Erro ao enviar campanha de WhatsApp"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest block mb-1.5">Descrição *</label>
            <textarea
              className="input-agro w-full resize-none"
              rows={5}
              placeholder="Explique o problema com o máximo de detalhes possível..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ lineHeight: "1.5" }}
            />
          </div>

          {/* Drag-drop zone */}
          <div>
            <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest block mb-1.5">
              Anexos <span className="normal-case text-agro-muted-2 font-normal">(opcional · máx {MAX_FILES} arquivos · 10 MB cada)</span>
            </label>
            <div
              className="rounded-xl p-4 text-center cursor-pointer transition-all"
              style={{
                border:     `2px dashed ${dragging ? "rgba(63,176,108,0.5)" : "rgba(63,176,108,0.2)"}`,
                background: dragging ? "rgba(63,176,108,0.06)" : "transparent",
              }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="w-5 h-5 text-agro-muted-2 mx-auto mb-1" />
              <p className="text-xs text-agro-muted">Clique ou arraste arquivos aqui</p>
              <p className="text-[10px] text-agro-muted-2 mt-0.5">Imagens, PDF, XLSX, DOCX</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.pdf,.xlsx,.xls,.docx,.doc,.txt,.csv"
              className="hidden"
              onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
            />
            <FilePreviewList files={files} onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 shrink-0" style={{ borderTop: "1px solid rgba(63,176,108,0.1)", background: "rgba(10,17,14,0.5)" }}>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
            style={{ border: "1px solid rgba(63,176,108,0.15)" }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !title.trim() || !description.trim()}
            className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {saving ? "Enviando…" : "Abrir Ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── File upload util ──────────────────────────────────────────────

async function uploadFiles(files: File[], workspaceId: string, folder: string): Promise<Attachment[]> {
  const result: Attachment[] = [];
  for (const file of files) {
    const ext  = file.name.split(".").pop() ?? "bin";
    const path = `${workspaceId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("support_attachments").upload(path, file, { contentType: file.type });
    if (error) throw new Error(`Upload falhou: ${error.message}`);
    const { data: { publicUrl } } = supabase.storage.from("support_attachments").getPublicUrl(path);
    result.push({ name: file.name, url: publicUrl, size: file.size, type: file.type });
  }
  return result;
}

// ── StatusDropdown ────────────────────────────────────────────────

function StatusDropdown({ value, onChange }: { value: TicketStatus; onChange: (s: TicketStatus) => void }) {
  const [open, setOpen] = useState(false);
  const s = STATUS[value];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
        style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
      >
        {s.label}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-8 z-20 rounded-xl overflow-hidden min-w-[160px]"
          style={{ background: "#0d1a11", border: "1px solid rgba(63,176,108,0.2)", boxShadow: "0 16px 40px rgba(0,0,0,0.5)" }}
        >
          {STATUS_FLOW.map((st) => {
            const opt = STATUS[st];
            return (
              <button
                key={st}
                onClick={() => { onChange(st); setOpen(false); }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors hover:bg-white/5 text-left"
                style={{ color: opt.color }}
              >
                <opt.icon className="w-3.5 h-3.5 shrink-0" />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── TicketDetail ──────────────────────────────────────────────────

function TicketDetail({
  ticket,
  messages,
  loading,
  isStaff,
  workspaceId,
  userId,
  onStatusChange,
  onNewMessage,
}: {
  ticket:         Ticket;
  messages:       TicketMessage[];
  loading:        boolean;
  isStaff:        boolean;
  workspaceId:    string;
  userId:         string;
  onStatusChange: (id: string, status: TicketStatus) => void;
  onNewMessage:   (msg: TicketMessage) => void;
}) {
  const { profile } = useAuth();
  const { toast }   = useToast();
  const [replyText,  setReplyText]  = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [sending,    setSending]    = useState(false);
  const [dragging,   setDragging]   = useState(false);
  const fileRef   = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function addFiles(incoming: File[]) {
    const valid = incoming.filter((f) => {
      if (f.size > MAX_FILE_SIZE) { toast({ title: `${f.name} excede 10 MB`, variant: "destructive" }); return false; }
      return true;
    });
    setReplyFiles((prev) => [...prev, ...valid].slice(0, MAX_FILES));
  }

  async function handleSend() {
    if (!replyText.trim() && !replyFiles.length) return;
    if (ticket.status === "closed") return;
    setSending(true);
    try {
      const attachments = await uploadFiles(replyFiles, workspaceId, `replies/${ticket.id}`);
      const { data: msg, error } = await supabase
        .from("support_messages")
        .insert({
          ticket_id:    ticket.id,
          workspace_id: workspaceId,
          author_id:    userId,
          body:         replyText.trim(),
          is_staff:     isStaff,
          attachments,
        })
        .select("*")
        .single();

      if (error) throw new Error(error.message);

      // Update ticket updated_at
      await supabase.from("support_tickets").update({ updated_at: new Date().toISOString() }).eq("id", ticket.id);

      const event = isStaff ? "staff_replied" : "user_replied";
      await callNotify(ticket.id, event);

      setReplyText("");
      setReplyFiles([]);
      onNewMessage({ ...msg, attachments: msg.attachments ?? [], author_name: profile?.full_name ?? "Você" });
    } catch (err) {
      toast({ title: "Não foi possível enviar a resposta", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  async function handleStatusChange(newStatus: TicketStatus) {
    const updates: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === "closed") updates.closed_at = new Date().toISOString();
    await supabase.from("support_tickets").update(updates).eq("id", ticket.id);
    if (newStatus === "closed") callNotify(ticket.id, "closed");
    onStatusChange(ticket.id, newStatus);
    toast({ title: `Status atualizado para "${STATUS[newStatus]?.label}"` });
  }

  const isClosed = ticket.status === "closed";

  return (
    <div className="flex flex-col h-full">
      {/* Ticket header */}
      <div className="px-6 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-agro-text leading-snug mb-1 break-words">{ticket.title}</h2>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-agro-muted-2">
              <span>Por <span className="text-agro-muted">{ticket.creator_name ?? "Usuário"}</span></span>
              <span>·</span>
              <span>{fmtDate(ticket.created_at)}</span>
              {!isStaff && <StatusBadge status={ticket.status} />}
            </div>
          </div>
          {isStaff && (
            <div className="shrink-0">
              <StatusDropdown value={ticket.status} onChange={handleStatusChange} />
            </div>
          )}
        </div>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "" : "justify-end"}`}>
              <div className="h-12 rounded-2xl animate-pulse w-48" style={{ background: "rgba(63,176,108,0.06)" }} />
            </div>
          ))
        ) : messages.length === 0 ? (
          <div className="text-center py-10 text-agro-muted-2 text-sm">Nenhuma mensagem ainda</div>
        ) : messages.map((msg) => {
          const isMine  = msg.author_id === userId;
          const isRight = isMine && !isStaff || (isStaff && msg.is_staff);
          return (
            <div key={msg.id} className={`flex flex-col ${isRight ? "items-end" : "items-start"}`}>
              <p className="text-[10px] text-agro-muted-2 mb-1 px-1">
                {msg.author_name ?? "Usuário"} · {fmtDate(msg.created_at)}
                {msg.is_staff && <span className="ml-1 text-agro-green font-semibold">· Suporte</span>}
              </p>
              <div
                className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                style={msg.is_staff
                  ? { background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)", color: "#c8e6cc" }
                  : { background: "rgba(15,26,19,0.9)",   border: "1px solid rgba(63,176,108,0.1)", color: "#8faf9a"  }
                }
              >
                {msg.body && <p className="whitespace-pre-wrap">{msg.body}</p>}
                {msg.attachments.length > 0 && (
                  <div className={`flex flex-wrap gap-2 ${msg.body ? "mt-2" : ""}`}>
                    {msg.attachments.map((att, i) => <AttachmentChip key={i} att={att} />)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply input */}
      {isClosed ? (
        <div
          className="px-6 py-3 shrink-0 text-center text-xs text-agro-muted-2"
          style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}
        >
          Ticket encerrado — abra um novo ticket se precisar de mais ajuda
        </div>
      ) : (
        <div
          className="px-4 py-3 shrink-0"
          style={{ borderTop: "1px solid rgba(63,176,108,0.08)", background: "rgba(8,14,10,0.6)" }}
        >
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: `1px solid ${dragging ? "rgba(63,176,108,0.4)" : "rgba(63,176,108,0.15)"}`, transition: "border-color 0.2s" }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
          >
            <textarea
              className="w-full bg-transparent px-4 pt-3 pb-1 text-sm text-agro-text placeholder:text-agro-muted-2 resize-none focus:outline-none"
              rows={3}
              placeholder={isStaff ? "Responder ao ticket…" : "Escreva sua mensagem…"}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
              style={{ lineHeight: "1.5" }}
            />
            <FilePreviewList files={replyFiles} onRemove={(i) => setReplyFiles((prev) => prev.filter((_, j) => j !== i))} />
            <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-agro-muted-2 hover:text-agro-green transition-colors px-2 py-1 rounded-lg"
                title="Anexar arquivo"
              >
                <Paperclip className="w-3.5 h-3.5" />
                Anexar
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.pdf,.xlsx,.xls,.docx,.doc,.txt,.csv"
                className="hidden"
                onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
              />
              <button
                onClick={handleSend}
                disabled={sending || (!replyText.trim() && !replyFiles.length)}
                className="btn-agro flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {sending ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </div>
          <p className="text-[10px] text-agro-muted-2 mt-1.5 px-1">Ctrl + Enter para enviar</p>
        </div>
      )}
    </div>
  );
}

// ── EmptyDetail ───────────────────────────────────────────────────

function EmptyDetail({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.15)" }}>
        <LifeBuoy className="w-7 h-7 text-agro-muted-2" />
      </div>
      <div>
        <p className="text-sm font-semibold text-agro-text">Selecione um ticket</p>
        <p className="text-xs text-agro-muted-2 mt-1">ou abra um novo para começar</p>
      </div>
      <button
        onClick={onNew}
        className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
      >
        <Plus className="w-4 h-4" /> Novo Ticket
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

type FilterKey = "all" | TicketStatus;

const FILTERS: { id: FilterKey; label: string }[] = [
  { id: "all",         label: "Todos"        },
  { id: "open",        label: "Abertos"      },
  { id: "in_progress", label: "Em Andamento" },
  { id: "resolved",    label: "Resolvidos"   },
  { id: "closed",      label: "Encerrados"   },
];

export function Support() {
  const { profile, workspaceId } = useAuth();
  const { toast }                = useToast();
  const wid     = workspaceId ?? "";
  const uid     = profile?.id  ?? "";
  const isStaff = profile?.role === "admin" || profile?.role === "manager";

  const [tickets,    setTickets]    = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages,   setMessages]   = useState<TicketMessage[]>([]);
  const [filter,     setFilter]     = useState<FilterKey>("all");
  const [loading,    setLoading]    = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [showModal,  setShowModal]  = useState(false);

  const selectedTicket = tickets.find((t) => t.id === selectedId) ?? null;

  // ── Load tickets ─────────────────────────────────────────────────

  const loadTickets = useCallback(async () => {
    if (!wid) return;
    setLoading(true);
    try {
      let q = supabase.from("support_tickets").select("*").eq("workspace_id", wid).order("updated_at", { ascending: false });
      if (!isStaff) q = q.eq("created_by", uid);
      if (filter !== "all") q = q.eq("status", filter);

      const { data } = await q;
      if (!data) return;

      // Batch-fetch creator names
      const ids = [...new Set<string>((data as Ticket[]).map((t) => t.created_by))];
      const { data: profiles } = await supabase.from("user_profiles").select("id, full_name").in("id", ids);
      const nameMap = Object.fromEntries((profiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name ?? "Usuário"]));

      setTickets((data as Ticket[]).map((t) => ({ ...t, creator_name: nameMap[t.created_by] ?? "Usuário" })));
    } finally {
      setLoading(false);
    }
  }, [wid, uid, isStaff, filter]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  // ── Load messages ─────────────────────────────────────────────────

  const loadMessages = useCallback(async (ticketId: string) => {
    setMsgLoading(true);
    try {
      const { data } = await supabase.from("support_messages").select("*").eq("ticket_id", ticketId).order("created_at", { ascending: true });
      if (!data) return;

      const ids = [...new Set<string>((data as TicketMessage[]).map((m) => m.author_id))];
      const { data: profiles } = await supabase.from("user_profiles").select("id, full_name").in("id", ids);
      const nameMap = Object.fromEntries((profiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name ?? "Usuário"]));

      setMessages((data as TicketMessage[]).map((m) => ({
        ...m,
        attachments: (m.attachments ?? []) as Attachment[],
        author_name: nameMap[m.author_id] ?? "Usuário",
      })));
    } finally {
      setMsgLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadMessages(selectedId);
    else setMessages([]);
  }, [selectedId, loadMessages]);

  // ── Realtime ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedId) return;
    const channel = supabase
      .channel(`support_messages_${selectedId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages", filter: `ticket_id=eq.${selectedId}` },
        () => { loadMessages(selectedId); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedId, loadMessages]);

  useEffect(() => {
    if (!wid) return;
    const channel = supabase
      .channel(`support_tickets_${wid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets", filter: `workspace_id=eq.${wid}` },
        () => { loadTickets(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [wid, loadTickets]);

  // ── Handlers ──────────────────────────────────────────────────────

  function handleStatusChange(id: string, status: TicketStatus) {
    setTickets((prev) => prev.map((t) => t.id === id ? { ...t, status, updated_at: new Date().toISOString() } : t));
  }

  function handleNewMessage(msg: TicketMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  function handleCreated(ticket: Ticket) {
    setTickets((prev) => [ticket, ...prev]);
    setSelectedId(ticket.id);
  }

  const filtered = filter === "all" ? tickets : tickets.filter((t) => t.status === filter);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Suporte" }]} />

      <div className="flex-1 flex flex-col max-w-7xl w-full mx-auto px-6 py-6 gap-4" style={{ minHeight: 0 }}>

        {/* Header */}
        <div className="flex items-center justify-between animate-fade-up shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}>
              <LifeBuoy className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-agro-text leading-none">Suporte</h1>
              <p className="text-xs text-agro-muted mt-0.5">
                {isStaff ? "Todos os tickets do workspace" : "Seus tickets de suporte"}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          >
            <Plus className="w-4 h-4" /> Novo Ticket
          </button>
        </div>

        {/* Split panel */}
        <div
          className="flex-1 flex rounded-2xl overflow-hidden animate-fade-up"
          style={{ border: "1px solid rgba(63,176,108,0.1)", minHeight: 0, height: "calc(100vh - 220px)" }}
        >
          {/* ── Left: ticket list ── */}
          <div
            className="w-72 shrink-0 flex flex-col"
            style={{ borderRight: "1px solid rgba(63,176,108,0.08)", background: "rgba(13,26,17,0.7)" }}
          >
            {/* Filters */}
            <div className="px-3 pt-3 pb-2 shrink-0 space-y-2" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              <div className="flex flex-wrap gap-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
                    style={filter === f.id
                      ? { background: "rgba(63,176,108,0.18)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }
                      : { color: "#6b7f6e", border: "1px solid transparent" }
                    }
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="px-4 py-3" style={{ borderBottom: "1px solid rgba(63,176,108,0.05)" }}>
                    <div className="h-4 rounded animate-pulse mb-2" style={{ background: "rgba(63,176,108,0.06)", width: "75%" }} />
                    <div className="h-3 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.04)", width: "50%" }} />
                  </div>
                ))
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 py-10 text-center px-4">
                  <AlertCircle className="w-6 h-6 text-agro-muted-2" />
                  <p className="text-xs text-agro-muted-2">Nenhum ticket encontrado</p>
                  <button onClick={() => setShowModal(true)} className="text-xs text-agro-green hover:underline">
                    Abrir novo ticket
                  </button>
                </div>
              ) : filtered.map((t) => {
                const s       = STATUS[t.status] ?? STATUS.open;
                const active  = t.id === selectedId;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className="w-full text-left px-4 py-3 transition-all"
                    style={{
                      borderBottom: "1px solid rgba(63,176,108,0.05)",
                      background:   active ? "rgba(63,176,108,0.08)" : "transparent",
                      borderLeft:   active ? "2px solid #3fb06c" : "2px solid transparent",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold text-agro-text leading-snug line-clamp-2">{t.title}</p>
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                        style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
                      >
                        {s.label}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      {isStaff && <p className="text-[10px] text-agro-muted-2 truncate">{t.creator_name}</p>}
                      <p className="text-[10px] text-agro-muted-2 ml-auto">{fmtDate(t.updated_at)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Right: detail ── */}
          <div className="flex-1 min-w-0" style={{ background: "rgba(10,17,14,0.9)" }}>
            {selectedTicket ? (
              <TicketDetail
                ticket={selectedTicket}
                messages={messages}
                loading={msgLoading}
                isStaff={isStaff}
                workspaceId={wid}
                userId={uid}
                onStatusChange={handleStatusChange}
                onNewMessage={handleNewMessage}
              />
            ) : (
              <EmptyDetail onNew={() => setShowModal(true)} />
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <NewTicketModal
          workspaceId={wid}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
