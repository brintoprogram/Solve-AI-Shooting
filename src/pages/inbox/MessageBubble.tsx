import { format } from "date-fns";
import { Download, MapPin, FileText } from "lucide-react";
import type { InboxMessage } from "@/types/inbox";

interface Props {
  message: InboxMessage;
}

export function MessageBubble({ message }: Props) {
  const isInbound = message.direction === "inbound";
  const time = format(new Date(message.created_at), "HH:mm");

  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"} mb-1`}>
      <div
        className={`max-w-[72%] px-3 py-2 rounded-2xl ${isInbound ? "rounded-tl-sm" : "rounded-tr-sm"}`}
        style={
          isInbound
            ? {
                background: "rgba(13,26,17,0.95)",
                border: "1px solid rgba(63,176,108,0.12)",
              }
            : {
                background: "rgba(22,101,52,0.55)",
                border: "1px solid rgba(63,176,108,0.28)",
              }
        }
      >
        <MessageContent message={message} />
        <p className="text-[10px] text-agro-muted-2 text-right mt-1 select-none leading-none">
          {time}
        </p>
      </div>
    </div>
  );
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
            <img
              src={message.media_url}
              alt="Imagem"
              className="rounded-xl object-cover"
              style={{ maxWidth: 240, maxHeight: 320 }}
              loading="lazy"
            />
          ) : (
            <MediaPlaceholder icon="📷" label="Imagem" mediaId={message.media_id} />
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
        <MediaPlaceholder icon="🎵" label="Áudio" mediaId={message.media_id} />
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
            <MediaPlaceholder icon="🎬" label="Vídeo" mediaId={message.media_id} />
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
            >
              <Download className="w-4 h-4" />
            </a>
          ) : (
            <Download className="w-4 h-4 text-agro-muted-2 opacity-40 shrink-0" />
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

    default:
      return (
        <p className="text-xs text-agro-muted italic">
          Tipo de mensagem não suportado
        </p>
      );
  }
}

function MediaPlaceholder({
  icon,
  label,
  mediaId,
}: {
  icon: string;
  label: string;
  mediaId: string | null;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
      style={{
        background: "rgba(0,0,0,0.2)",
        border: "1px solid rgba(63,176,108,0.08)",
        minWidth: 160,
      }}
    >
      <span className="text-lg leading-none">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm text-agro-muted">{label}</p>
        {mediaId && (
          <p className="text-[10px] text-agro-muted-2 font-mono truncate" style={{ maxWidth: 130 }}>
            ID: {mediaId.slice(0, 14)}…
          </p>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
