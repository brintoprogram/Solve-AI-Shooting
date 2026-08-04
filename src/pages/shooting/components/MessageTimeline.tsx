import { format } from "date-fns";
import { Send, CheckCheck, Eye, MessageCircle, XCircle, Clock } from "lucide-react";
import type { ShootingMessage } from "@/types/shooting";
import { formatBRL } from "@/lib/format";

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

      {/* Boletos enviados (campaigns with financial data) */}
      {(() => {
        const rd = message.recipient_data as Record<string, unknown> | null;
        if (!rd?._financial_campaign || !rd?._invoice_ids) return null;
        const invIds   = rd._invoice_ids as string[];
        const allInvs  = (rd.contact_invoices as Array<{
          id: string; valor: number; vencimento: string | null; numero_nf: string | null;
        }> | null) ?? [];
        const usedInvs = allInvs.filter((inv) => invIds.includes(inv.id));
        if (usedInvs.length === 0) return null;
        return (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">
              Boletos enviados ({usedInvs.length})
            </p>
            <div className="rounded-xl overflow-hidden"
              style={{ border: "1px solid rgba(63,176,108,0.12)" }}
            >
              {/* Column headers */}
              <div className="flex items-center gap-2 px-3 py-1.5"
                style={{ background: "rgba(13,26,17,0.7)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}
              >
                <span className="text-[10px] text-agro-muted-2 uppercase tracking-wider flex-1">NF / Boleto</span>
                <span className="text-[10px] text-agro-muted-2 uppercase tracking-wider w-20 text-center">Vencimento</span>
                <span className="text-[10px] text-agro-muted-2 uppercase tracking-wider w-20 text-right">Valor</span>
              </div>
              {usedInvs.map((inv, i) => {
                const dueStr = inv.vencimento
                  ? (() => { const [y,m,d] = inv.vencimento!.split("-"); return `${d}/${m}/${y}`; })()
                  : "—";
                const valor = formatBRL(Number(inv.valor));
                return (
                  <div key={i}
                    className="flex items-center gap-2 px-3 py-2"
                    style={i < usedInvs.length - 1 ? { borderBottom: "1px solid rgba(63,176,108,0.05)" } : undefined}
                  >
                    <span className="text-xs text-agro-muted flex-1 truncate">
                      {inv.numero_nf ? `NF ${inv.numero_nf}` : `Boleto ${i + 1}`}
                    </span>
                    <span className="text-xs text-agro-muted-2 w-20 text-center">{dueStr}</span>
                    <span className="text-xs font-semibold text-amber-400 w-20 text-right">{valor}</span>
                  </div>
                );
              })}
              <div className="px-3 py-1.5 flex items-center justify-between"
                style={{ background: "rgba(63,176,108,0.05)", borderTop: "1px solid rgba(63,176,108,0.08)" }}
              >
                <span className="text-[10px] text-agro-muted-2 uppercase tracking-wider">Total enviado</span>
                <span className="text-sm font-bold text-agro-green">
                  {rd.valor_total_pendente as string ?? "—"}
                </span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
