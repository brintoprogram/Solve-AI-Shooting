import { useState } from "react";
import { format } from "date-fns";
import { Download, MapPin, FileText, Check, CheckCheck, Clock, AlertCircle, Image, FileVideo, RefreshCw } from "lucide-react";
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

function TemplateCard({ preview }: { preview: TemplatePreview }) {
  const headerFormat = preview.header?.format?.toUpperCase() ?? "TEXT";
  const headerIsMedia = ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat);

  return (
    <div className="space-y-0 overflow-hidden rounded-xl" style={{ border: "1px solid rgba(63,176,108,0.2)", minWidth: 220, maxWidth: 300 }}>
      {/* Header */}
      {preview.header && (
        headerIsMedia ? (
          <div
            className="flex items-center justify-center gap-2 px-4 py-3"
            style={{ background: "rgba(0,0,0,0.25)", borderBottom: "1px solid rgba(63,176,108,0.12)" }}
          >
            {headerFormat === "IMAGE"    && <Image    className="w-6 h-6 text-agro-muted-2" />}
            {headerFormat === "VIDEO"    && <FileVideo className="w-6 h-6 text-agro-muted-2" />}
            {headerFormat === "DOCUMENT" && <FileText  className="w-6 h-6 text-agro-muted-2" />}
            <span className="text-xs text-agro-muted-2 capitalize">{headerFormat.toLowerCase()}</span>
          </div>
        ) : preview.header.text ? (
          <div className="px-3 pt-3 pb-1">
            <p className="text-sm font-bold text-agro-text leading-snug">{preview.header.text}</p>
          </div>
        ) : null
      )}

      {/* Body */}
      {preview.body && (
        <div className="px-3 py-2">
          <p className="text-sm text-agro-text whitespace-pre-wrap leading-relaxed">{preview.body}</p>
        </div>
      )}

      {/* Footer */}
      {preview.footer && (
        <div className="px-3 pb-2">
          <p className="text-[11px] text-agro-muted-2 leading-snug">{preview.footer}</p>
        </div>
      )}

      {/* Buttons */}
      {preview.buttons && preview.buttons.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(63,176,108,0.12)" }}>
          {preview.buttons.map((btn, i) => (
            <div
              key={i}
              className="flex items-center justify-center px-3 py-2 text-xs font-semibold"
              style={{
                color: "#3fb06c",
                borderTop: i > 0 ? "1px solid rgba(63,176,108,0.1)" : undefined,
              }}
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
  message:       InboxMessage;
  teamMembers?:  { id: string; full_name: string | null; avatar_url?: string | null }[];
  currentUserId?: string;
}

export function MessageBubble({ message, teamMembers, currentUserId }: Props) {
  const isInbound  = message.direction === "inbound";
  const isTemplate = message.message_type === "template";
  const time       = format(new Date(message.created_at), "HH:mm");

  const senderLabel = !isInbound && message.sent_by
    ? message.sent_by === currentUserId
      ? "Você"
      : (teamMembers?.find((m) => m.id === message.sent_by)?.full_name?.split(" ")[0] ?? "Agente")
    : null;

  return (
    <div className={`flex flex-col ${isInbound ? "items-start" : "items-end"} mb-1`}>
      {senderLabel && (
        <span className="text-[10px] text-agro-muted-2 mb-0.5 px-1 select-none">
          {senderLabel}
        </span>
      )}
      <div
        className={`max-w-[72%] rounded-2xl ${isInbound ? "rounded-tl-sm" : "rounded-tr-sm"} ${isTemplate ? "" : "px-3 py-2"}`}
        style={isTemplate ? { background: "transparent" } : (
          isInbound
            ? { background: "rgba(13,26,17,0.95)", border: "1px solid rgba(63,176,108,0.12)" }
            : { background: "rgba(22,101,52,0.55)", border: "1px solid rgba(63,176,108,0.28)" }
        )}
      >
        <MessageContent message={message} />
        <div className={`flex items-center justify-end gap-1 mt-1 select-none ${isTemplate ? "px-1" : ""}`}>
          <span className="text-[10px] text-agro-muted-2 leading-none">{time}</span>
          {!isInbound && <StatusTicks message={message} />}
        </div>
      </div>
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

function MessageContent({ message }: { message: InboxMessage }) {
  switch (message.message_type) {
    case "text":
      return (
        <p className="text-sm text-agro-text whitespace-pre-wrap break-words leading-relaxed">
          {message.body}
        </p>
      );

    case "image":
    case "sticker":
      return (
        <div className="space-y-1">
          {message.media_url ? (
            <div className="relative group">
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
                className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
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
            <video
              controls
              src={message.media_url}
              className="rounded-xl"
              style={{ maxWidth: 240, maxHeight: 200 }}
            />
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
          style={{
            background: "rgba(0,0,0,0.2)",
            border: "1px solid rgba(63,176,108,0.1)",
            minWidth: 180,
          }}
        >
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "rgba(63,176,108,0.15)" }}
          >
            <FileText className="w-5 h-5 text-agro-green" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-agro-text truncate">
              {message.media_filename ?? "Documento"}
            </p>
            {message.media_size && (
              <p className="text-xs text-agro-muted">{formatBytes(message.media_size)}</p>
            )}
          </div>
          {message.media_url ? (
            <a
              href={message.media_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-agro-green hover:text-agro-text transition-colors shrink-0"
              title="Baixar documento"
            >
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
            {message.location_name && (
              <p className="text-sm font-medium text-agro-text">{message.location_name}</p>
            )}
            {message.location_address && (
              <p className="text-xs text-agro-muted">{message.location_address}</p>
            )}
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
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.25)" }}
        >
          <span className="text-base leading-none">🔘</span>
          <p className="text-sm font-medium" style={{ color: "#3fb06c" }}>
            {message.body ?? "Botão clicado"}
          </p>
        </div>
      );

    case "template": {
      const preview = parseTemplateBody(message.body);
      if (preview) return <TemplateCard preview={preview} />;
      return (
        <div className="flex items-start gap-2.5">
          <span className="text-base leading-none mt-0.5">📋</span>
          <p className="text-sm text-agro-text">{message.body ?? "Template enviado"}</p>
        </div>
      );
    }

    default:
      return (
        <p className="text-xs text-agro-muted italic">
          Tipo de mensagem não suportado
        </p>
      );
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
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-media`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ message_id: messageId }),
        },
      );
      setDone(true); // realtime will update the message; show "aguardando"
    } catch {
      // silent — user can retry
    }
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
        <p className="text-[10px] text-agro-muted-2">
          {done ? "Carregando…" : "Mídia pendente"}
        </p>
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
