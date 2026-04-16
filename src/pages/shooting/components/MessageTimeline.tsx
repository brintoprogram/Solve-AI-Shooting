import { format } from "date-fns";
import { Send, CheckCheck, Eye, MessageCircle, XCircle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ShootingMessage } from "@/types/shooting";

interface MessageTimelineProps {
  message: ShootingMessage;
  onRetry?: (id: string) => void;
}

interface TimelineEvent {
  label: string;
  timestamp: string | null;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  done: boolean;
}

export function MessageTimeline({ message, onRetry }: MessageTimelineProps) {
  const events: TimelineEvent[] = [
    {
      label: "Na fila",
      timestamp: message.created_at,
      icon: Clock,
      color: "text-gray-500",
      done: true,
    },
    {
      label: "Enviado",
      timestamp: message.sent_at,
      icon: Send,
      color: "text-blue-600",
      done: !!message.sent_at,
    },
    {
      label: "Entregue",
      timestamp: message.delivered_at,
      icon: CheckCheck,
      color: "text-green-600",
      done: !!message.delivered_at,
    },
    {
      label: "Lido",
      timestamp: message.read_at,
      icon: Eye,
      color: "text-green-700",
      done: !!message.read_at,
    },
    {
      label: "Respondido",
      timestamp: message.replied_at,
      icon: MessageCircle,
      color: "text-purple-600",
      done: !!message.replied_at,
    },
  ];

  const hasFailed = message.status === "failed" || message.status === "undeliverable";

  return (
    <div className="mt-4 space-y-6">
      {/* Recipient info */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Destinatário</p>
        <div className="rounded-xl border border-gray-200 p-3 space-y-1">
          <p className="font-semibold text-gray-900">{message.recipient_name ?? "—"}</p>
          <p className="text-sm text-gray-500 font-mono">{message.recipient_phone}</p>
        </div>
      </div>

      {/* WAMID */}
      {message.wamid && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">WAMID</p>
          <p className="text-xs font-mono bg-gray-100 rounded-lg p-2 text-gray-600 break-all">
            {message.wamid}
          </p>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Timeline</p>
        <div className="relative space-y-0">
          {events.map((ev, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                    ev.done
                      ? "border-green-500 bg-green-50"
                      : "border-gray-200 bg-gray-50"
                  }`}
                >
                  <ev.icon
                    className={`w-3.5 h-3.5 ${ev.done ? ev.color : "text-gray-300"}`}
                  />
                </div>
                {i < events.length - 1 && (
                  <div
                    className={`w-0.5 h-6 ${
                      ev.done ? "bg-green-300" : "bg-gray-200"
                    }`}
                  />
                )}
              </div>
              <div className="pb-1 pt-1.5">
                <p className={`text-sm font-medium ${ev.done ? "text-gray-900" : "text-gray-400"}`}>
                  {ev.label}
                </p>
                {ev.timestamp && (
                  <p className="text-xs text-gray-400">
                    {format(new Date(ev.timestamp), "dd/MM/yyyy HH:mm:ss")}
                  </p>
                )}
              </div>
            </div>
          ))}

          {hasFailed && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center border-2 border-red-300 bg-red-50">
                <XCircle className="w-3.5 h-3.5 text-red-600" />
              </div>
              <div className="pb-1 pt-1.5">
                <p className="text-sm font-medium text-red-700">
                  {message.status === "undeliverable" ? "Não entregável" : "Falhou"}
                </p>
                {message.failed_at && (
                  <p className="text-xs text-gray-400">
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
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Erro</p>
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-1">
            {message.error_code && (
              <div className="flex items-center gap-2">
                <Badge variant="destructive">#{message.error_code}</Badge>
              </div>
            )}
            <p className="text-sm text-red-700">{message.error_message}</p>
          </div>
        </div>
      )}

      {/* Retry button */}
      {hasFailed && onRetry && message.retry_count < message.max_retries && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => onRetry(message.id)}
        >
          Tentar novamente ({message.retry_count}/{message.max_retries} tentativas)
        </Button>
      )}

      {/* Raw recipient data */}
      {message.recipient_data && Object.keys(message.recipient_data as object).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Dados do destinatário</p>
          <pre className="text-xs font-mono bg-gray-100 rounded-lg p-3 overflow-x-auto text-gray-600">
            {JSON.stringify(message.recipient_data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
