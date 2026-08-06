import { useState, Fragment } from "react";
import { format } from "date-fns";
import {
  Download, MapPin, FileText, Check, CheckCheck, Clock, AlertCircle,
  Image, FileVideo, RefreshCw, Trash2, StickyNote,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { InboxMessage } from "@/types/inbox";

// ── Template preview types ────────────────────────────────
interface TemplatePreview {
  name:     string;
  header?:  { format: string; text?: string };
  body?:    string;
  footer?:  string;
  buttons?: string[];
}

function parseTemplateBody(body: string | null): TemplatePreview | null {
  if (!body) return null;
  try {
    if (body.trimStart().startsWith("{")) return JSON.parse(body) as TemplatePreview;
  } catch { /* fall through */ }
  return null;
}

// Renders template content INSIDE the bubble — no outer card wrapper
function TemplateContent({ preview }: { preview: TemplatePreview }) {
  const headerFormat  = preview.header?.format?.toUpperCase() ?? "TEXT";
  const headerIsMedia = ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat);

  return (
    <div>
      {preview.header && (
        headerIsMedia ? (
          <div
            className="flex items-center justify-center gap-2 px-3 py-2.5"
            style={{ background: "rgba(0,0,0,0.2)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
          >
            {headerFormat === "IMAGE"    && <Image    className="w-5 h-5 text-agro-muted-2" />}
            {headerFormat === "VIDEO"    && <FileVideo className="w-5 h-5 text-agro-muted-2" />}
            {headerFormat === "DOCUMENT" && <FileText  className="w-5 h-5 text-agro-muted-2" />}
            <span className="text-xs text-agro-muted-2 capitalize">{headerFormat.toLowerCase()}</span>
          </div>
        ) : preview.header.text ? (
          <div className="px-3 pt-3 pb-1">
            <p className="text-sm font-bold text-agro-text leading-snug break-words">{renderWhatsApp(preview.header.text)}</p>
          </div>
        ) : null
      )}
      {preview.body && (
        <div className="px-3 py-2">
          <p className="text-sm text-agro-text whitespace-pre-wrap leading-relaxed break-words">{renderWhatsApp(preview.body)}</p>
        </div>
      )}
      {preview.footer && (
        <div className="px-3 pb-1">
          <p className="text-[11px] text-agro-muted-2 leading-snug">{preview.footer}</p>
        </div>
      )}
      {preview.buttons && preview.buttons.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          {preview.buttons.map((btn, i) => (
            <div
              key={i}
              className="flex items-center justify-center px-3 py-2.5 text-xs font-semibold"
              style={{ color: "#3fb06c", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.06)" : undefined }}
            >
              {btn}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  message:        InboxMessage;
  teamMembers?:   { id: string; full_name: string | null; avatar_url?: string | null }[];
  currentUserId?: string;
  onDelete?:      (id: string) => void;
}

export function MessageBubble({ message, teamMembers, currentUserId, onDelete }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isInbound      = message.direction === "inbound";
  const isInternal     = message.is_internal === true;
  const isTemplate     = message.message_type === "template";
  const templatePreview = isTemplate ? parseTemplateBody(message.body) : null;
  const time           = format(new Date(message.created_at), "HH:mm");

  const senderLabel = !isInbound && message.sent_by
    ? message.sent_by === currentUserId
      ? "Você"
      : (teamMembers?.find((m) => m.id === message.sent_by)?.full_name?.split(" ")[0] ?? "Agente")
    : null;

  const bubbleStyle = isInbound
    ? { background: "rgba(13,26,17,0.95)", border: "1px solid rgba(63,176,108,0.12)", boxShadow: "0 1px 3px rgba(0,0,0,0.35)" }
    : { background: "rgba(22,101,52,0.55)", border: "1px solid rgba(63,176,108,0.28)", boxShadow: "0 1px 3px rgba(0,0,0,0.35)" };

  // ── Internal note ─────────────────────────────────────────
  if (isInternal) {
    return (
      <div className="flex flex-col items-end mb-1 group">
        {senderLabel && (
          <span className="text-[10px] text-agro-muted-2 mb-0.5 px-1 select-none">
            {senderLabel}
          </span>
        )}
        <div className="relative max-w-[72%]">
          {onDelete && (
            <DeleteButton
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
              onDelete={() => onDelete(message.id)}
              side="left"
            />
          )}
          <div
            className="rounded-2xl rounded-br-sm px-3 py-2"
            style={{ background: "rgba(30, 20, 0, 0.85)", border: "1px solid rgba(245,158,11,0.3)" }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <StickyNote className="w-3 h-3" style={{ color: "#f59e0b" }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#f59e0b" }}>
                Nota interna
              </span>
            </div>
            <p className="text-sm break-words leading-relaxed" style={{ color: "#fde68a" }}>
              {renderWhatsApp(message.body ?? "")}
            </p>
            <div className="flex items-center justify-end gap-1 mt-1 select-none">
              <span className="text-[10px] leading-none" style={{ color: "rgba(253,230,138,0.5)" }}>{time}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Normal message (including templates) ──────────────────
  return (
    <div className={`flex flex-col ${isInbound ? "items-start" : "items-end"} mb-1 group`}>
      {senderLabel && (
        <span className="text-[10px] text-agro-muted-2 mb-0.5 px-1 select-none">
          {senderLabel}
        </span>
      )}
      <div className={`relative min-w-[80px] ${isTemplate ? "max-w-[60%]" : "max-w-[72%]"}`}>
        {!isInbound && onDelete && (
          <DeleteButton
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
            onDelete={() => onDelete(message.id)}
            side="left"
          />
        )}
        <div
          className={`rounded-2xl ${isInbound ? "rounded-bl-sm" : "rounded-br-sm"} overflow-hidden`}
          style={bubbleStyle}
        >
          {/* Template with JSON preview: TemplateContent handles its own padding */}
          {isTemplate && templatePreview ? (
            <>
              <TemplateContent preview={templatePreview} />
              <div className="flex items-center justify-end gap-1 px-3 pb-2 pt-1 select-none opacity-65">
                <span className="text-[10px] text-agro-muted-2 leading-none">{time}</span>
                {!isInbound && <StatusTicks message={message} />}
              </div>
            </>
          ) : (
            /* All other messages: padded wrapper */
            <div className="px-3 py-2">
              <MessageContent message={message} />
              <div className="flex items-center justify-end gap-1 mt-1 select-none opacity-65">
                <span className="text-[10px] text-agro-muted-2 leading-none">{time}</span>
                {!isInbound && <StatusTicks message={message} />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Delete button (inline confirmation) ───────────────────

interface DeleteButtonProps {
  confirmDelete:    boolean;
  setConfirmDelete: (v: boolean) => void;
  onDelete:         () => void;
  side:             "left" | "right";
}

function DeleteButton({ confirmDelete, setConfirmDelete, onDelete, side }: DeleteButtonProps) {
  const pos = side === "left" ? "right-full mr-1.5" : "left-full ml-1.5";
  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 ${pos} flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}
    >
      {confirmDelete ? (
        <>
          <button
            onClick={() => { onDelete(); setConfirmDelete(false); }}
            className="text-[10px] font-semibold px-2 py-0.5 rounded-md text-white transition-colors"
            style={{ background: "#ef4444" }}
          >
            Sim
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="text-[10px] font-semibold px-2 py-0.5 rounded-md text-agro-muted transition-colors hover:text-agro-text"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}
          >
            Não
          </button>
        </>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          title="Apagar mensagem"
          className="w-6 h-6 flex items-center justify-center rounded-lg text-agro-muted-2 hover:text-red-400 hover:bg-red-400/10 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function StatusTicks({ message }: { message: InboxMessage }) {
  if (message.status === "failed")    return <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />;
  if (message.status === "read")      return <CheckCheck className="w-3.5 h-3.5 shrink-0" style={{ color: "#34d4fb" }} />;
  if (message.status === "delivered") return <CheckCheck className="w-3.5 h-3.5 text-agro-muted-2 shrink-0" />;
  if (message.status === "sent")      return <Check className="w-3 h-3 text-agro-muted-2 shrink-0" />;
  return <Clock className="w-3 h-3 text-agro-muted-2 shrink-0 opacity-60" />;
}

// ── WhatsApp markdown renderer ────────────────────────────
// Supports: *bold*, _italic_, ~strikethrough~, ```mono```
function parseInline(text: string): React.ReactNode[] {
  const pattern = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`\n]+```)/g;
  const result: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) result.push(text.slice(last, match.index));
    const m = match[0];
    const inner = m.startsWith("```") ? m.slice(3, -3) : m.slice(1, -1);
    const key = match.index;
    if (m.startsWith("*"))   result.push(<strong key={key} className="font-semibold">{inner}</strong>);
    else if (m.startsWith("_"))   result.push(<em key={key}>{inner}</em>);
    else if (m.startsWith("~"))   result.push(<s key={key}>{inner}</s>);
    else if (m.startsWith("```")) result.push(<code key={key} className="font-mono text-xs rounded px-1" style={{ background: "rgba(0,0,0,0.25)" }}>{inner}</code>);
    last = match.index + m.length;
  }
  if (last < text.length) result.push(text.slice(last));
  return result;
}

function renderWhatsApp(raw: string): React.ReactNode {
  return raw.split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {parseInline(line)}
    </Fragment>
  ));
}

function MessageContent({ message }: { message: InboxMessage }) {
  switch (message.message_type) {
    case "text":
      return (
        <p className="text-sm text-agro-text break-words leading-relaxed">
          {renderWhatsApp(message.body ?? "")}
        </p>
      );

    case "image":
    case "sticker":
      return (
        <div className="space-y-1">
          {message.media_url ? (
            <div className="relative group/img">
              <img
                src={message.media_url}
                alt="Imagem"
                className="rounded-xl object-cover block"
                style={{ maxWidth: 240, maxHeight: 320 }}
                loading="lazy"
              />
              <a
                href={message.media_url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
                title="Baixar imagem"
              >
                <Download className="w-3.5 h-3.5 text-white" />
              </a>
            </div>
          ) : (
            <MediaPlaceholder icon="📷" label="Imagem" mediaId={message.media_id} messageId={message.id} />
          )}
          {message.media_caption && (
            <p className="text-sm text-agro-text">{message.media_caption}</p>
          )}
        </div>
      );

    case "audio":
      return message.media_url ? (
        <audio controls src={message.media_url} style={{ maxWidth: 240 }} />
      ) : (
        <MediaPlaceholder icon="🎵" label="Áudio" mediaId={message.media_id} messageId={message.id} />
      );

    case "video":
      return (
        <div className="space-y-1">
          {message.media_url ? (
            <video controls src={message.media_url} className="rounded-xl" style={{ maxWidth: 240, maxHeight: 200 }} />
          ) : (
            <MediaPlaceholder icon="🎬" label="Vídeo" mediaId={message.media_id} messageId={message.id} />
          )}
          {message.media_caption && (
            <p className="text-sm text-agro-text">{message.media_caption}</p>
          )}
        </div>
      );

    case "document":
      return (
        <div
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(63,176,108,0.1)", minWidth: 180 }}
        >
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(63,176,108,0.15)" }}>
            <FileText className="w-5 h-5 text-agro-green" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-agro-text truncate">{message.media_filename ?? "Documento"}</p>
            {message.media_size && (
              <p className="text-xs text-agro-muted">{formatBytes(message.media_size)}</p>
            )}
          </div>
          {message.media_url ? (
            <a href={message.media_url} target="_blank" rel="noopener noreferrer" className="text-agro-green hover:text-agro-text transition-colors shrink-0" title="Baixar documento">
              <Download className="w-4 h-4" />
            </a>
          ) : (
            <MediaPlaceholder icon="" label="" mediaId={null} messageId={message.id} />
          )}
        </div>
      );

    case "location":
      return (
        <a
          href={`https://www.google.com/maps?q=${message.location_lat},${message.location_lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-2 hover:opacity-80 transition-opacity"
        >
          <MapPin className="w-4 h-4 text-agro-green mt-0.5 shrink-0" />
          <div>
            {message.location_name    && <p className="text-sm font-medium text-agro-text">{message.location_name}</p>}
            {message.location_address && <p className="text-xs text-agro-muted">{message.location_address}</p>}
            <p className="text-xs text-agro-muted font-mono mt-0.5">
              {message.location_lat?.toFixed(5)}, {message.location_lng?.toFixed(5)}
            </p>
          </div>
        </a>
      );

    case "reaction":
      return (
        <div className="flex items-center justify-center py-1">
          <span className="text-2xl leading-none">{message.reaction_emoji}</span>
        </div>
      );

    case "button_reply":
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.25)" }}>
          <span className="text-base leading-none">🔘</span>
          <p className="text-sm font-medium" style={{ color: "#3fb06c" }}>{message.body ?? "Botão clicado"}</p>
        </div>
      );

    case "template":
      return (
        <div className="flex items-start gap-2">
          <span className="text-base leading-none mt-0.5">📋</span>
          <p className="text-sm text-agro-text">{message.body ?? "Template enviado"}</p>
        </div>
      );

    default:
      return <p className="text-xs text-agro-muted italic">Tipo de mensagem não suportado</p>;
  }
}

function MediaPlaceholder({
  icon, label, mediaId, messageId,
}: {
  icon: string; label: string; mediaId: string | null; messageId?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);

  async function handleLoad() {
    if (!messageId || loading) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-media`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ message_id: messageId }),
        },
      );
      setDone(true);
    } catch { /* silent */ }
    setLoading(false);
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
      style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(63,176,108,0.08)", minWidth: 180 }}
    >
      <span className="text-lg leading-none">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-agro-muted">{label}</p>
        <p className="text-[10px] text-agro-muted-2">{done ? "Carregando…" : "Mídia pendente"}</p>
      </div>
      {messageId && !done && (
        <button
          onClick={handleLoad}
          disabled={loading}
          title="Carregar mídia"
          className="w-6 h-6 flex items-center justify-center rounded-lg transition-colors hover:bg-white/10 disabled:opacity-40 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-agro-green ${loading ? "animate-spin" : ""}`} />
        </button>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
