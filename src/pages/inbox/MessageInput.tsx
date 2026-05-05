import {
  useState,
  useRef,
  useEffect,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import {
  Paperclip, Send, X, FileText, Loader2,
  Zap, Sparkles, PenLine, StickyNote, MessageSquare,
  Plus, Trash2, Search,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useQuickReplies } from "@/hooks/useQuickReplies";

interface Props {
  conversationId: string;
  workspaceId:    string;
  contactId:      string;
  sentBy:         string;
  senderName:     string;
}

type AttachType = "image" | "audio" | "video" | "document";

interface Attachment {
  file:    File;
  preview: string | null;
  type:    AttachType;
}

function mimeToType(mime: string): AttachType {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function MessageInput({ conversationId, workspaceId, contactId, sentBy, senderName }: Props) {
  // ── Core state ──────────────────────────────────────────────
  const [text, setText]               = useState("");
  const [attachment, setAttachment]   = useState<Attachment | null>(null);
  const [sending, setSending]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // ── Mode: mensagem vs nota interna ──────────────────────────
  const [isNote, setIsNote] = useState(false);

  // ── Signature ───────────────────────────────────────────────
  const [signatureEnabled, setSignatureEnabled] = useState(
    () => localStorage.getItem(`inbox_sig_${sentBy}`) === "1"
  );
  const [signatureText, setSignatureText] = useState(
    () => localStorage.getItem(`inbox_sig_text_${sentBy}`) ?? `— ${senderName}`
  );
  const [editingSignature, setEditingSignature] = useState(false);
  const sigEditorRef = useRef<HTMLTextAreaElement>(null);

  // ── Grammar correction ──────────────────────────────────────
  const [correcting, setCorrecting] = useState(false);

  // ── Quick replies ───────────────────────────────────────────
  const [showQR,      setShowQR]      = useState(false);
  const [qrSearch,    setQrSearch]    = useState("");
  const [showAddQR,   setShowAddQR]   = useState(false);
  const [newQRTitle,  setNewQRTitle]  = useState("");
  const [newQRBody,   setNewQRBody]   = useState("");
  const [savingQR,    setSavingQR]    = useState(false);
  const { replies, addReply, deleteReply } = useQuickReplies(workspaceId);

  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrRef        = useRef<HTMLDivElement>(null);

  // Close QR panel on outside click
  useEffect(() => {
    if (!showQR) return;
    function handle(e: MouseEvent) {
      if (qrRef.current && !qrRef.current.contains(e.target as Node)) {
        setShowQR(false);
        setShowAddQR(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showQR]);

  // ── File selection ─────────────────────────────────────────
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const type = mimeToType(file.type);
    if (type === "image") {
      const reader = new FileReader();
      reader.onload = () => setAttachment({ file, preview: reader.result as string, type });
      reader.readAsDataURL(file);
    } else {
      setAttachment({ file, preview: null, type });
    }
    e.target.value = "";
  }

  // ── Grammar correction ─────────────────────────────────────
  async function handleCorrect() {
    const trimmed = text.trim();
    if (!trimmed || correcting) return;
    setCorrecting(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("fix-grammar", {
        body: { text: trimmed },
      });
      if (fnErr) {
        let msg = fnErr.message ?? "Erro ao corrigir";
        try { msg = ((fnErr as any).context && await (fnErr as any).context.json?.())?.error ?? msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (data?.corrected) {
        setText(data.corrected);
        setTimeout(() => autoResize(), 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao corrigir gramática");
    }
    setCorrecting(false);
  }

  // ── Signature helpers ──────────────────────────────────────
  function saveSignatureText(val: string) {
    setSignatureText(val);
    localStorage.setItem(`inbox_sig_text_${sentBy}`, val);
  }

  function wrapSignatureSelection(marker: string) {
    const ta = sigEditorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const selected = signatureText.slice(start, end);
    const next = signatureText.slice(0, start) + marker + selected + marker + signatureText.slice(end);
    saveSignatureText(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + marker.length, end + marker.length);
    }, 0);
  }

  // ── Quick reply insert ─────────────────────────────────────
  function applyQuickReply(body: string) {
    setText(body);
    setShowQR(false);
    setQrSearch("");
    setTimeout(() => { autoResize(); textareaRef.current?.focus(); }, 0);
  }

  async function handleAddQR() {
    if (!newQRTitle.trim() || !newQRBody.trim() || savingQR) return;
    setSavingQR(true);
    try {
      await addReply(newQRTitle.trim(), newQRBody.trim());
      setNewQRTitle("");
      setNewQRBody("");
      setShowAddQR(false);
    } catch { /* ignore */ }
    setSavingQR(false);
  }

  // ── Send ───────────────────────────────────────────────────
  async function handleSend() {
    if (sending) return;
    const trimmed = text.trim();
    if (!trimmed && !attachment) return;

    setSending(true);
    setError(null);

    try {
      // Build final text (append signature if enabled, for outbound messages only)
      let finalText = trimmed;
      if (!isNote && signatureEnabled && signatureText.trim() && trimmed) {
        finalText = `${trimmed}\n${signatureText.trim()}`;
      }

      if (isNote) {
        // Direct DB insert — not sent to WhatsApp
        const { error: noteErr } = await db.from("inbox_messages").insert({
          workspace_id:    workspaceId,
          conversation_id: conversationId,
          contact_id:      contactId,
          direction:       "outbound",
          message_type:    "text",
          body:            finalText,
          sent_by:         sentBy,
          is_internal:     true,
          status:          "sent",
        });
        if (noteErr) throw new Error(noteErr.message);
      } else {
        // WhatsApp send via edge function
        let mediaUrl:      string | null = null;
        let mediaFilename: string | null = null;
        let messageType                  = "text";

        if (attachment) {
          const ext  = attachment.file.name.split(".").pop() ?? "bin";
          const path = `${workspaceId}/${conversationId}/${Date.now()}.${ext}`;

          const { error: uploadErr } = await supabase.storage
            .from("inbox_media")
            .upload(path, attachment.file, { contentType: attachment.file.type });

          if (uploadErr) throw new Error(`Upload falhou: ${uploadErr.message}`);

          const { data: { publicUrl } } = supabase.storage
            .from("inbox_media")
            .getPublicUrl(path);

          mediaUrl      = publicUrl;
          mediaFilename = attachment.file.name;
          messageType   = attachment.type;
        }

        const { error: fnErr } = await supabase.functions.invoke("send-inbox-message", {
          body: {
            conversation_id: conversationId,
            workspace_id:    workspaceId,
            sent_by:         sentBy,
            type:            messageType,
            ...(messageType === "text"
              ? { text: finalText }
              : {
                  media_url:      mediaUrl,
                  media_filename: mediaFilename,
                  ...(finalText ? { text: finalText } : {}),
                }),
          },
        });

        if (fnErr) {
          let msg = fnErr.message;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const body = await (fnErr as any).context?.json?.();
            msg = body?.error ?? msg;
          } catch { /* ignore */ }
          throw new Error(msg);
        }
      }

      setText("");
      setAttachment(null);
      autoResize(true);
      textareaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setSending(false);
    }
  }

  // ── Keyboard ───────────────────────────────────────────────
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Auto-resize textarea ───────────────────────────────────
  function autoResize(reset = false) {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (!reset) ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }

  // ── Signature toggle ───────────────────────────────────────
  function toggleSignature() {
    const next = !signatureEnabled;
    setSignatureEnabled(next);
    localStorage.setItem(`inbox_sig_${sentBy}`, next ? "1" : "0");
    if (!next) setEditingSignature(false);
  }

  const canSend      = !sending && (text.trim().length > 0 || attachment !== null);
  const filteredQR   = replies.filter(
    (r) =>
      r.title.toLowerCase().includes(qrSearch.toLowerCase()) ||
      r.body.toLowerCase().includes(qrSearch.toLowerCase())
  );
  const noteActive   = isNote;
  const accentColor  = noteActive ? "#f59e0b" : "#3fb06c";
  const accentAlpha  = noteActive ? "rgba(245,158,11" : "rgba(63,176,108";

  // ── Render ─────────────────────────────────────────────────
  return (
    <div
      className="shrink-0 px-4 pt-2 pb-3 relative"
      style={{
        borderTop:  `1px solid ${accentAlpha},0.1)`,
        background: "rgba(10,17,14,0.9)",
        transition: "border-color 0.2s",
      }}
    >
      {/* ── Mode tabs — underline style ────────────────────── */}
      <div className="flex mb-2" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
        <button
          onClick={() => setIsNote(false)}
          className="flex items-center gap-1.5 px-3 pb-2 pt-1 text-xs font-semibold transition-colors duration-150"
          style={!isNote
            ? { color: "#3fb06c", borderBottom: "2px solid #3fb06c", marginBottom: -1 }
            : { color: "#4a6052", borderBottom: "2px solid transparent", marginBottom: -1 }
          }
        >
          <MessageSquare className="w-3 h-3" />
          Mensagem
        </button>
        <button
          onClick={() => setIsNote(true)}
          className="flex items-center gap-1.5 px-3 pb-2 pt-1 text-xs font-semibold transition-colors duration-150"
          style={isNote
            ? { color: "#f59e0b", borderBottom: "2px solid #f59e0b", marginBottom: -1 }
            : { color: "#4a6052", borderBottom: "2px solid transparent", marginBottom: -1 }
          }
        >
          <StickyNote className="w-3 h-3" />
          Nota interna
        </button>
      </div>

      {/* ── Quick replies panel ────────────────────────────── */}
      {showQR && (
        <div
          ref={qrRef}
          className="absolute bottom-full left-4 right-4 mb-1 rounded-xl overflow-hidden z-50"
          style={{
            background:  "rgba(13,26,17,0.98)",
            border:      "1px solid rgba(63,176,108,0.2)",
            boxShadow:   "0 -8px 32px rgba(0,0,0,0.5)",
            backdropFilter: "blur(16px)",
          }}
        >
          {/* Panel header */}
          <div
            className="flex items-center gap-2 px-3 pt-2.5 pb-2"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
          >
            <Zap className="w-3.5 h-3.5 text-agro-green shrink-0" />
            <span className="text-xs font-semibold text-agro-text flex-1">Respostas rápidas</span>
            <button
              onClick={() => { setShowAddQR((v) => !v); setNewQRTitle(""); setNewQRBody(""); }}
              className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg transition-colors"
              style={{
                background: showAddQR ? "rgba(63,176,108,0.15)" : "rgba(63,176,108,0.08)",
                color:      "#3fb06c",
                border:     "1px solid rgba(63,176,108,0.2)",
              }}
            >
              <Plus className="w-3 h-3" />
              Nova
            </button>
          </div>

          {/* Add form */}
          {showAddQR && (
            <div className="px-3 py-2.5 space-y-2" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)", background: "rgba(0,0,0,0.15)" }}>
              <input
                value={newQRTitle}
                onChange={(e) => setNewQRTitle(e.target.value)}
                placeholder="Título (ex: Boleto vencido)"
                className="w-full text-xs text-agro-text placeholder:text-agro-muted-2 focus:outline-none rounded-lg px-2.5 py-1.5"
                style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.15)" }}
              />
              <textarea
                value={newQRBody}
                onChange={(e) => setNewQRBody(e.target.value)}
                placeholder="Texto da resposta..."
                rows={2}
                className="w-full text-xs text-agro-text placeholder:text-agro-muted-2 focus:outline-none resize-none rounded-lg px-2.5 py-1.5"
                style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.15)" }}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowAddQR(false)}
                  className="text-xs text-agro-muted px-3 py-1 rounded-lg hover:text-agro-text transition-colors"
                  style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddQR}
                  disabled={!newQRTitle.trim() || !newQRBody.trim() || savingQR}
                  className="flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-lg transition-colors disabled:opacity-40"
                  style={{ background: "rgba(63,176,108,0.2)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }}
                >
                  {savingQR ? <Loader2 className="w-3 h-3 animate-spin" /> : "Salvar"}
                </button>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="px-3 py-2" style={{ borderBottom: "1px solid rgba(63,176,108,0.06)" }}>
            <div className="flex items-center gap-2">
              <Search className="w-3 h-3 text-agro-muted-2 shrink-0" />
              <input
                value={qrSearch}
                onChange={(e) => setQrSearch(e.target.value)}
                placeholder="Buscar..."
                className="flex-1 text-xs text-agro-text placeholder:text-agro-muted-2 focus:outline-none bg-transparent"
              />
            </div>
          </div>

          {/* List */}
          <div className="max-h-48 overflow-y-auto scrollbar-thin">
            {filteredQR.length === 0 ? (
              <p className="text-xs text-agro-muted-2 text-center py-4">
                {replies.length === 0 ? "Nenhuma resposta cadastrada" : "Nenhum resultado"}
              </p>
            ) : (
              filteredQR.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start gap-2 px-3 py-2 hover:bg-white/5 transition-colors group/qr"
                  style={{ borderTop: "1px solid rgba(63,176,108,0.04)" }}
                >
                  <button
                    onClick={() => applyQuickReply(r.body)}
                    className="flex-1 text-left min-w-0"
                  >
                    <p className="text-xs font-semibold text-agro-text truncate">{r.title}</p>
                    <p className="text-[11px] text-agro-muted truncate mt-0.5">{r.body}</p>
                  </button>
                  <button
                    onClick={() => deleteReply(r.id)}
                    title="Remover"
                    className="w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover/qr:opacity-100 transition-opacity text-agro-muted-2 hover:text-red-400 shrink-0 mt-0.5"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Attachment preview ─────────────────────────────── */}
      {attachment && (
        <div
          className="flex items-center gap-3 mb-2 p-2.5 rounded-xl"
          style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.18)" }}
        >
          {attachment.preview ? (
            <img src={attachment.preview} alt="preview" className="w-12 h-12 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 text-xl" style={{ background: "rgba(63,176,108,0.12)" }}>
              {attachment.type === "audio" ? "🎵" : attachment.type === "video" ? "🎬" : <FileText className="w-6 h-6 text-agro-green" />}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-agro-text font-medium truncate">{attachment.file.name}</p>
            <p className="text-xs text-agro-muted">{formatBytes(attachment.file.size)}</p>
          </div>
          <button
            onClick={() => setAttachment(null)}
            className="w-6 h-6 rounded-full flex items-center justify-center text-agro-muted hover:text-red-400 transition-colors shrink-0"
            style={{ background: "rgba(0,0,0,0.25)" }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Error banner ───────────────────────────────────── */}
      {error && (
        <div
          className="flex items-center justify-between gap-2 mb-2 px-3 py-1.5 rounded-lg"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}
        >
          <p className="text-xs text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Textarea ───────────────────────────────────────── */}
      <textarea
        ref={textareaRef}
        value={text}
        rows={1}
        disabled={sending}
        placeholder={
          isNote
            ? "Escreva uma nota interna (visível só para a equipe)..."
            : attachment
            ? "Legenda (opcional)..."
            : "Digite uma mensagem..."
        }
        onChange={(e) => { setText(e.target.value); autoResize(); }}
        onKeyDown={handleKeyDown}
        onFocus={(e) => {
          e.target.style.borderColor = accentColor;
          e.target.style.boxShadow   = `0 0 0 3px ${accentAlpha},0.12)`;
        }}
        onBlur={(e) => {
          e.target.style.borderColor = `${accentAlpha},0.12)`;
          e.target.style.boxShadow   = "none";
        }}
        className="w-full resize-none scrollbar-thin text-sm text-agro-text placeholder:text-agro-muted-2 focus:outline-none disabled:opacity-50"
        style={{
          background:   isNote ? "rgba(30,20,0,0.4)" : "rgba(13,26,17,0.6)",
          border:       `1px solid ${accentAlpha},0.12)`,
          borderRadius: "0.75rem",
          padding:      "0.5rem 0.875rem",
          lineHeight:   "1.5",
          maxHeight:    120,
          overflowY:    "auto",
          transition:   "border-color 0.2s, box-shadow 0.2s, background 0.2s",
        }}
      />

      {/* ── Signature preview (when enabled and has message text) ── */}
      {signatureEnabled && !isNote && signatureText.trim() && text.trim() && !editingSignature && (
        <p className="text-[11px] text-agro-muted-2 ml-3 mt-0.5 italic select-none whitespace-pre-wrap">
          {signatureText}
        </p>
      )}

      {/* ── Toolbar + send ─────────────────────────────────── */}
      <div className="flex items-center gap-1 mt-2">
        {/* Attach (hidden in note mode) */}
        {!isNote && (
          <>
            <ToolButton
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title="Anexar arquivo"
            >
              <Paperclip className="w-4 h-4" />
            </ToolButton>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
              onChange={handleFileChange}
            />
          </>
        )}

        {/* Quick replies */}
        <ToolButton
          onClick={() => { setShowQR((v) => !v); setShowAddQR(false); }}
          active={showQR}
          title="Respostas rápidas"
        >
          <Zap className="w-4 h-4" />
        </ToolButton>

        {/* Grammar correction (text only) */}
        {!isNote && (
          <ToolButton
            onClick={handleCorrect}
            disabled={!text.trim() || correcting}
            title="Corrigir gramática"
          >
            {correcting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Sparkles className="w-4 h-4" />
            }
          </ToolButton>
        )}

        <div className="flex-1" />

        {/* Signature toggle + edit (message mode only) */}
        {!isNote && (
          <div className="flex items-center gap-1">
            <button
              onClick={toggleSignature}
              title={signatureEnabled ? "Desativar assinatura" : "Ativar assinatura"}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all"
              style={signatureEnabled ? {
                background: "rgba(63,176,108,0.12)",
                color:      "#3fb06c",
                border:     "1px solid rgba(63,176,108,0.25)",
              } : {
                background: "transparent",
                color:      "#6b8a75",
                border:     "1px solid rgba(63,176,108,0.08)",
              }}
            >
              <PenLine className="w-3 h-3" />
              Assinatura
            </button>
            {signatureEnabled && (
              <button
                onClick={() => setEditingSignature((v) => !v)}
                className="text-[10px] font-medium px-2 py-1 rounded-lg transition-all"
                style={editingSignature ? {
                  background: "rgba(63,176,108,0.15)",
                  color:      "#3fb06c",
                  border:     "1px solid rgba(63,176,108,0.3)",
                } : {
                  color:  "#6b8a75",
                  border: "1px solid rgba(63,176,108,0.08)",
                }}
              >
                {editingSignature ? "Fechar" : "Editar"}
              </button>
            )}
          </div>
        )}

        {/* Send — circular, proeminente */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          title={isNote ? "Salvar nota (Enter)" : "Enviar (Enter)"}
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed ml-1"
          style={canSend
            ? {
                background: isNote
                  ? "linear-gradient(135deg, #f59e0b, #d97706)"
                  : "linear-gradient(135deg, #3fb06c, #16A34A)",
                boxShadow: isNote
                  ? "0 2px 10px rgba(245,158,11,0.4)"
                  : "0 2px 10px rgba(63,176,108,0.4)",
              }
            : {
                background: "rgba(13,26,17,0.6)",
                border:     `1px solid ${accentAlpha},0.12)`,
              }
          }
        >
          {sending
            ? <Loader2 className="w-4 h-4 text-white animate-spin" />
            : <Send className="w-4 h-4 text-white" />
          }
        </button>
      </div>

      {/* ── Signature editor ───────────────────────────────── */}
      {editingSignature && signatureEnabled && !isNote && (
        <div
          className="mt-2 rounded-xl overflow-hidden"
          style={{ border: "1px solid rgba(63,176,108,0.2)", background: "rgba(13,26,17,0.7)" }}
        >
          {/* Format toolbar */}
          <div
            className="flex items-center gap-1 px-2.5 py-1.5"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-agro-muted-2 mr-1">
              Assinatura
            </span>
            {[
              { label: "B",  marker: "*",  style: { fontWeight: 700 } },
              { label: "I",  marker: "_",  style: { fontStyle: "italic" } },
              { label: "S",  marker: "~",  style: { textDecoration: "line-through" } },
            ].map(({ label, marker, style }) => (
              <button
                key={marker}
                onMouseDown={(e) => { e.preventDefault(); wrapSignatureSelection(marker); }}
                className="w-6 h-6 rounded flex items-center justify-center text-xs text-agro-muted hover:text-agro-text hover:bg-white/10 transition-colors"
                title={`Formatar como ${label === "B" ? "negrito (*texto*)" : label === "I" ? "itálico (_texto_)" : "tachado (~texto~)"}`}
              >
                <span style={style}>{label}</span>
              </button>
            ))}
            <span
              className="text-[9px] text-agro-muted-2 ml-1"
              title="Selecione o texto e clique para formatar"
            >
              Selecione e clique · WhatsApp aceita *negrito* _itálico_ ~tachado~
            </span>
          </div>
          {/* Signature textarea */}
          <textarea
            ref={sigEditorRef}
            value={signatureText}
            onChange={(e) => saveSignatureText(e.target.value)}
            rows={2}
            placeholder={`— ${senderName}`}
            className="w-full resize-none text-xs text-agro-muted-2 placeholder:text-agro-muted-2/50 focus:outline-none bg-transparent px-3 py-2"
          />
        </div>
      )}

      <p className="text-[10px] text-agro-muted-2 mt-1.5 text-right pr-1 select-none opacity-60">
        {isNote
          ? "Nota interna · visível apenas para a equipe"
          : "Enter para enviar · Shift+Enter nova linha"
        }
      </p>
    </div>
  );
}

// ── Small icon button ──────────────────────────────────────
function ToolButton({
  children, onClick, disabled, title, active,
}: {
  children: React.ReactNode;
  onClick:  () => void;
  disabled?: boolean;
  title?:   string;
  active?:  boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      style={active ? {
        background: "rgba(63,176,108,0.15)",
        color:      "#3fb06c",
        border:     "1px solid rgba(63,176,108,0.3)",
      } : {
        color:      "#6b8a75",
        border:     "1px solid rgba(63,176,108,0.1)",
      }}
    >
      {children}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
