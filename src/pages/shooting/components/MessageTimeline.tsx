import { format } from "date-fns";
import { Send, CheckCheck, Eye, MessageCircle, XCircle, Clock } from "lucide-react";
import type { ShootingMessage } from "@/types/shooting";

interface MessageTimelineProps {
  message: ShootingMessage;
  onRetry?: (id: string) => void;
}

interface TimelineEvent {
  label: string;
  timestamp: string | null;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  done: boolean;
}

export function MessageTimeline({ message, onRetry }: MessageTimelineProps) {
  const events: TimelineEvent[] = [
    { label: "Na fila",     timestamp: message.created_at,   icon: Clock,        iconColor: "#9ca3af", done: true                  },
    { label: "Enviado",     timestamp: message.sent_at,       icon: Send,         iconColor: "#60a5fa", done: !!message.sent_at      },
    { label: "Entregue",    timestamp: message.delivered_at,  icon: CheckCheck,   iconColor: "#3fb06c", done: !!message.delivered_at },
    { label: "Lido",        timestamp: message.read_at,       icon: Eye,          iconColor: "#34d399", done: !!message.read_at      },
    { label: "Respondido",  timestamp: message.replied_at,    icon: MessageCircle,iconColor: "#a78bfa", done: !!message.replied_at   },
  ];

  const hasFailed = message.status === "failed" || message.status === "undeliverable";

  return (
    <div className="mt-4 space-y-6">
      {/* Recipient */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Destinatário</p>
        <div className="p-3 rounded-xl"
          style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <p className="font-semibold text-agro-text text-sm">{message.recipient_name ?? "—"}</p>
          <p className="text-xs text-agro-muted font-mono mt-0.5">{message.recipient_phone}</p>
        </div>
      </div>

      {/* WAMID */}
      {message.wamid && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">WAMID</p>
          <p className="text-xs font-mono p-2 rounded-lg break-all text-agro-muted"
            style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.08)" }}
          >
            {message.wamid}
          </p>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Timeline</p>
        <div className="space-y-0">
          {events.map((ev, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300"
                  style={ev.done ? {
                    background: `${ev.iconColor}18`,
                    border: `2px solid ${ev.iconColor}50`,
                  } : {
                    background: "rgba(13,26,17,0.6)",
                    border: "2px solid rgba(63,176,108,0.1)",
                  }}
                >
                  <ev.icon className="w-3.5 h-3.5"
                    style={{ color: ev.done ? ev.iconColor : "#3d5246" }}
                  />
                </div>
                {i < events.length - 1 && (
                  <div className="w-0.5 h-6 transition-all duration-300"
                    style={{ background: ev.done ? "rgba(63,176,108,0.3)" : "rgba(63,176,108,0.06)" }}
                  />
                )}
              </div>
              <div className="pb-1 pt-1.5">
                <p className="text-sm font-medium transition-colors"
                  style={{ color: ev.done ? "#e8f0ea" : "#3d5246" }}
                >
                  {ev.label}
                </p>
                {ev.timestamp && (
                  <p className="text-xs text-agro-muted">
                    {format(new Date(ev.timestamp), "dd/MM/yyyy HH:mm:ss")}
                  </p>
                )}
              </div>
            </div>
          ))}

          {hasFailed && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "rgba(239,68,68,0.1)", border: "2px solid rgba(239,68,68,0.3)" }}
              >
                <XCircle className="w-3.5 h-3.5 text-red-400" />
              </div>
              <div className="pb-1 pt-1.5">
                <p className="text-sm font-medium text-red-400">
                  {message.status === "undeliverable" ? "Não entregável" : "Falhou"}
                </p>
                {message.failed_at && (
                  <p className="text-xs text-agro-muted">
                    {format(new Date(message.failed_at), "dd/MM/yyyy HH:mm:ss")}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error details */}
      {hasFailed && message.error_message && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Erro</p>
          <div className="p-3 rounded-xl space-y-2"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            {message.error_code && (
              <span className="inline-block px-2 py-0.5 rounded-md text-xs font-mono font-semibold text-red-400"
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                #{message.error_code}
              </span>
            )}
            <p className="text-sm text-red-400">{message.error_message}</p>
          </div>
        </div>
      )}

      {/* Retry */}
      {hasFailed && onRetry && message.retry_count < message.max_retries && (
        <button
          onClick={() => onRetry(message.id)}
          className="w-full py-2.5 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.15)" }}
        >
          Tentar novamente ({message.retry_count}/{message.max_retries} tentativas)
        </button>
      )}

      {/* Raw data */}
      {message.recipient_data && Object.keys(message.recipient_data as object).length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Dados do destinatário</p>
          <pre className="text-xs font-mono p-3 rounded-xl overflow-x-auto text-agro-muted scrollbar-thin"
            style={{ background: "rgba(8,16,10,0.9)", border: "1px solid rgba(63,176,108,0.08)" }}
          >
            {JSON.stringify(message.recipient_data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
