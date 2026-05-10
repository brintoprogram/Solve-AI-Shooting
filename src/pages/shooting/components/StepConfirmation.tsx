import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Users, MessageSquare, Wifi, Calendar, Gauge, Rocket, Clock,
} from "lucide-react";
import { estimateDuration } from "@/lib/utils";
import type { WizardState, MetaTemplate, MetaConnection } from "@/types/shooting";
import type { ZApiTemplate } from "@/types/database";
import type { ZApiConnection } from "@/hooks/useZApiConnections";
import { cn } from "@/lib/utils";

interface StepConfirmationProps {
  state: WizardState;
  template: MetaTemplate | undefined;
  connection: MetaConnection | undefined;
  zApiConnection?: ZApiConnection;
  zApiTemplate?: ZApiTemplate;
  onSubmit: () => void;
  submitting: boolean;
}

function formatDurationFromSeconds(totalSeconds: number): string {
  const m = Math.ceil(totalSeconds / 60);
  if (m < 60) return `~${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `~${h}h ${rem > 0 ? ` ${rem}min` : ""}`.trim();
}

export function StepConfirmation({ state, template, connection, zApiConnection, zApiTemplate, onSubmit, submitting }: StepConfirmationProps) {
  const [consented, setConsented] = useState(false);
  const isZApi = state.channel === "z_api";
  const isRandomMode = isZApi && state.sendingSpeedMode === "random";

  const randomMinTime = isRandomMode ? formatDurationFromSeconds(state.totalRecipients * state.minDelaySeconds) : "";
  const randomMaxTime = isRandomMode ? formatDurationFromSeconds(state.totalRecipients * state.maxDelaySeconds) : "";

  const summaryCards = [
    {
      icon: MessageSquare,
      label: "Template",
      value: isZApi
        ? (zApiTemplate?.name ?? "Texto livre")
        : (template?.template_name ?? "—"),
      sub: isZApi
        ? (zApiTemplate ? (zApiTemplate.message_type === "button_list" ? "Z-API · Botões" : "Z-API · Texto") : "Z-API")
        : (template ? `${template.category} · ${template.language}` : ""),
    },
    {
      icon: Users,
      label: "Destinatários",
      value: state.totalRecipients.toLocaleString("pt-BR"),
      sub: state.dataSource === "contacts" ? "Contatos cadastrados" : "Planilha XLSX",
    },
    {
      icon: Wifi,
      label: "Conexão",
      value: isZApi
        ? (zApiConnection?.phone ?? zApiConnection?.name ?? "—")
        : (connection?.display_phone ?? "—"),
      sub: isZApi
        ? (zApiConnection?.name ?? "")
        : (connection?.business_name ?? ""),
    },
    {
      icon: Calendar,
      label: "Agendamento",
      value:
        state.scheduleMode === "now"
          ? "Envio imediato"
          : state.scheduledAt
          ? format(state.scheduledAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
          : "—",
      sub: "",
    },
    {
      icon: Gauge,
      label: "Velocidade",
      value: isRandomMode ? "Aleatório" : `${state.sendingSpeed} msg/min`,
      sub: isRandomMode
        ? `${state.minDelaySeconds}s – ${state.maxDelaySeconds}s por mensagem`
        : `Duração: ${estimateDuration(state.totalRecipients, state.sendingSpeed)}`,
    },
    {
      icon: Clock,
      label: "Tempo estimado",
      value: isRandomMode
        ? `${randomMinTime} – ${randomMaxTime}`
        : estimateDuration(state.totalRecipients, state.sendingSpeed),
      sub: `Para ${state.totalRecipients.toLocaleString("pt-BR")} msgs`,
    },
  ];

  const canSubmit = consented && !submitting && state.totalRecipients > 0;

  return (
    <div className="space-y-6">
      {/* Summary grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {summaryCards.map((card) => (
          <div key={card.label} className="p-4 rounded-xl"
            style={{
              background: "rgba(13,26,17,0.6)",
              border: "1px solid rgba(63,176,108,0.1)",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <card.icon className="w-4 h-4 text-agro-green" />
              <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">
                {card.label}
              </p>
            </div>
            <p className="font-semibold text-agro-text text-sm leading-snug">{card.value}</p>
            {card.sub && <p className="text-xs text-agro-muted mt-0.5">{card.sub}</p>}
          </div>
        ))}
      </div>


      {/* Consent */}
      <div
        className="flex items-start gap-4 p-4 rounded-xl cursor-pointer transition-all duration-300"
        style={consented ? {
          background: "rgba(63,176,108,0.08)",
          border: "1px solid rgba(63,176,108,0.25)",
        } : {
          background: "rgba(13,26,17,0.5)",
          border: "1px solid rgba(63,176,108,0.1)",
        }}
        onClick={() => setConsented(!consented)}
      >
        <div
          className={cn(
            "w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-all duration-300",
            consented ? "glow-green-sm" : "",
          )}
          style={consented ? {
            background: "linear-gradient(135deg, #3fb06c, #16A34A)",
          } : {
            border: "2px solid rgba(63,176,108,0.3)",
          }}
        >
          {consented && <span className="text-white text-xs leading-none">✓</span>}
        </div>
        <p className="text-sm text-agro-muted leading-relaxed cursor-pointer">
          Confirmo que os destinatários consentiram em receber mensagens via WhatsApp e que estou em conformidade
          com os Termos de Serviço da Meta e a legislação vigente (LGPD).
        </p>
      </div>

      {/* Submit */}
      <button
        disabled={!canSubmit}
        onClick={onSubmit}
        className={cn(
          "w-full flex items-center justify-center gap-3 py-4 rounded-xl text-sm font-bold text-white transition-all duration-300",
          canSubmit ? "btn-agro" : "opacity-30 cursor-not-allowed",
        )}
        style={!canSubmit ? {
          background: "rgba(63,176,108,0.15)",
          border: "1px solid rgba(63,176,108,0.1)",
        } : undefined}
      >
        {submitting ? (
          <>
            <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            Processando...
          </>
        ) : state.scheduleMode === "now" ? (
          <>
            <Rocket className="w-5 h-5" />
            Iniciar Disparo · {state.totalRecipients.toLocaleString("pt-BR")} mensagens
          </>
        ) : (
          <>
            <Calendar className="w-5 h-5" />
            Agendar Disparo
          </>
        )}
      </button>

      {state.totalRecipients === 0 && (
        <p className="text-center text-xs text-red-400">
          Nenhum destinatário selecionado. Volte ao passo anterior.
        </p>
      )}
    </div>
  );
}
