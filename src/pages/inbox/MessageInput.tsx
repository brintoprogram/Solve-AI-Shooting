import {
  useState,
  useRef,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { Paperclip, Send, X, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Props {
  conversationId: string;
  workspaceId:    string;
  sentBy:         string;
}

type AttachType = "image" | "audio" | "video" | "document";

interface Attachment {
  file:    File;
  preview: string | null; // data URL for images, null otherwise
  type:    AttachType;
}

function mimeToType(mime: string): AttachType {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

export function MessageInput({ conversationId, workspaceId, sentBy }: Props) {
  const [text, setText]           = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [sending, setSending]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File selection ─────────────────────────────────────────────
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const type = mimeToType(file.type);

    if (type === "image") {
      const reader = new FileReader();
      reader.onload = () =>
        setAttachment({ file, preview: reader.result as string, type });
      reader.readAsDataURL(file);
    } else {
      setAttachment({ file, preview: null, type });
    }

    // Reset so same file can be picked again
    e.target.value = "";
  }

  // ── Send ───────────────────────────────────────────────────────
  async function handleSend() {
    if (sending) return;
    const trimmed = text.trim();
    if (!trimmed && !attachment) return;

    setSending(true);
    setError(null);

    try {
      let mediaUrl:      string | null = null;
      let mediaFilename: string | null = null;
      let messageType                  = "text";

      // 1. Upload attachment if present
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

      // 2. Invoke Edge Function
      const { error: fnErr } = await supabase.functions.invoke(
        "send-inbox-message",
        {
          body: {
            conversation_id: conversationId,
            workspace_id:    workspaceId,
            sent_by:         sentBy,
            type:            messageType,
            // text messages: body; media messages: caption
            ...(messageType === "text"
              ? { text: trimmed }
              : {
                  media_url:      mediaUrl,
                  media_filename: mediaFilename,
                  ...(trimmed ? { text: trimmed } : {}),
                }),
          },
        }
      );

      if (fnErr) {
        let msg = fnErr.message;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const body = await (fnErr as any).context?.json?.();
          msg = body?.error ?? msg;
        } catch { /* ignore */ }
        throw new Error(msg);
      }

      // 3. Reset state — the Realtime listener will add the bubble
      setText("");
      setAttachment(null);
      autoResize(true);
      textareaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  }

  // ── Keyboard ───────────────────────────────────────────────────
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Auto-resize textarea ───────────────────────────────────────
  function autoResize(reset = false) {
    const ta = textareaRef.current;
    if (!ta) return;
    if (reset) {
      ta.style.height = "auto";
      return;
    }
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }

  const canSend = !sending && (text.trim().length > 0 || attachment !== null);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div
      className="shrink-0 px-4 py-3"
      style={{
        borderTop: "1px solid rgba(63,176,108,0.1)",
        background: "rgba(10,17,14,0.9)",
      }}
    >
      {/* Attachment preview card */}
      {attachment && (
        <div
          className="flex items-center gap-3 mb-2 p-2.5 rounded-xl"
          style={{
            background: "rgba(13,26,17,0.8)",
            border: "1px solid rgba(63,176,108,0.18)",
          }}
        >
          {/* Thumbnail or icon */}
          {attachment.preview ? (
            <img
              src={attachment.preview}
              alt="preview"
              className="w-12 h-12 rounded-lg object-cover shrink-0"
            />
          ) : (
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 text-xl"
              style={{ background: "rgba(63,176,108,0.12)" }}
            >
              {attachment.type === "audio"
                ? "🎵"
                : attachment.type === "video"
                ? "🎬"
                : <FileText className="w-6 h-6 text-agro-green" />}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-sm text-agro-text font-medium truncate">
              {attachment.file.name}
            </p>
            <p className="text-xs text-agro-muted">
              {formatBytes(attachment.file.size)}
            </p>
          </div>

          <button
            onClick={() => setAttachment(null)}
            className="w-6 h-6 rounded-full flex items-center justify-center text-agro-muted hover:text-red-400 transition-colors shrink-0"
            style={{ background: "rgba(0,0,0,0.25)" }}
            title="Remover anexo"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          className="flex items-center justify-between gap-2 mb-2 px-3 py-1.5 rounded-lg"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}
        >
          <p className="text-xs text-red-400 flex-1">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-300 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        {/* Paperclip */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-green transition-colors shrink-0 disabled:opacity-40"
          style={{ border: "1px solid rgba(63,176,108,0.12)" }}
          title="Anexar arquivo"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
          onChange={handleFileChange}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          disabled={sending}
          placeholder={
            attachment ? "Legenda (opcional)..." : "Digite uma mensagem..."
          }
          onChange={(e) => {
            setText(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            e.target.style.borderColor = "#3fb06c";
            e.target.style.boxShadow   = "0 0 0 3px rgba(63,176,108,0.12)";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "rgba(63,176,108,0.12)";
            e.target.style.boxShadow   = "none";
          }}
          className="flex-1 resize-none scrollbar-thin text-sm text-agro-text placeholder:text-agro-muted-2 focus:outline-none disabled:opacity-50"
          style={{
            background:    "rgba(13,26,17,0.6)",
            border:        "1px solid rgba(63,176,108,0.12)",
            borderRadius:  "0.75rem",
            padding:       "0.5rem 0.875rem",
            lineHeight:    "1.5",
            maxHeight:     120,
            overflowY:     "auto",
            transition:    "border-color 0.2s, box-shadow 0.2s",
          }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          title="Enviar (Enter)"
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
          style={
            canSend
              ? {
                  background: "linear-gradient(135deg, #3fb06c, #16A34A)",
                  boxShadow:  "0 4px 14px rgba(63,176,108,0.35)",
                }
              : {
                  background: "rgba(13,26,17,0.6)",
                  border:     "1px solid rgba(63,176,108,0.1)",
                }
          }
        >
          {sending ? (
            <Loader2 className="w-4 h-4 text-white animate-spin" />
          ) : (
            <Send className="w-4 h-4 text-white" />
          )}
        </button>
      </div>

      <p className="text-[10px] text-agro-muted-2 mt-1.5 ml-1 select-none">
        Enter para enviar · Shift+Enter para nova linha
      </p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
