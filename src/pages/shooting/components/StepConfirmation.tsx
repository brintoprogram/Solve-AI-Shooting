import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Users,
  MessageSquare,
  Wifi,
  Calendar,
  Gauge,
  AlertTriangle,
  Rocket,
  Clock,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { estimateDuration } from "@/lib/utils";
import type { WizardState, MetaTemplate, MetaConnection } from "@/types/shooting";

interface StepConfirmationProps {
  state: WizardState;
  template: MetaTemplate | undefined;
  connection: MetaConnection | undefined;
  onSubmit: () => void;
  submitting: boolean;
}

export function StepConfirmation({
  state,
  template,
  connection,
  onSubmit,
  submitting,
}: StepConfirmationProps) {
  const [consented, setConsented] = useState(false);

  const summaryCards = [
    {
      icon: MessageSquare,
      title: "Template",
      value: template?.template_name ?? "—",
      sub: template ? `${template.category} · ${template.language}` : "",
    },
    {
      icon: Users,
      title: "Destinatários",
      value: state.totalRecipients.toLocaleString("pt-BR"),
      sub: state.dataSource === "contacts" ? "Contatos cadastrados" : "Planilha XLSX",
    },
    {
      icon: Wifi,
      title: "Conexão",
      value: connection?.display_phone ?? "—",
      sub: connection?.business_name ?? "",
    },
    {
      icon: Calendar,
      title: "Agendamento",
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
      title: "Velocidade",
      value: `${state.sendingSpeed} msg/min`,
      sub: `Duração estimada: ${estimateDuration(state.totalRecipients, state.sendingSpeed)}`,
    },
    {
      icon: Clock,
      title: "Tempo estimado",
      value: estimateDuration(state.totalRecipients, state.sendingSpeed),
      sub: `Para ${state.totalRecipients.toLocaleString("pt-BR")} mensagens`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Summary grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {summaryCards.map((card) => (
          <div
            key={card.title}
            className="rounded-xl border border-gray-200 bg-white p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <card.icon className="w-4 h-4 text-green-600" />
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {card.title}
              </p>
            </div>
            <p className="font-semibold text-gray-900 text-sm">{card.value}</p>
            {card.sub && <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Warning */}
      <Alert variant="warning">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Atenção antes de continuar</AlertTitle>
        <AlertDescription className="space-y-1 mt-1">
          <p>Uma vez iniciado, o disparo pode ser pausado mas as mensagens já enviadas não podem ser revertidas.</p>
          <p>Certifique-se de que sua conta possui saldo suficiente e que o número está com quality rating GREEN.</p>
        </AlertDescription>
      </Alert>

      {/* Consent checkbox */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
        <Checkbox
          id="consent"
          checked={consented}
          onCheckedChange={(v) => setConsented(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor="consent" className="font-normal text-sm text-gray-700 cursor-pointer leading-relaxed">
          Confirmo que os destinatários consentiram em receber mensagens via WhatsApp e que estou em conformidade com os Termos de Serviço da Meta e a legislação vigente (LGPD).
        </Label>
      </div>

      {/* Submit button */}
      <Button
        size="xl"
        className="w-full"
        disabled={!consented || submitting || state.totalRecipients === 0}
        onClick={onSubmit}
      >
        {submitting ? (
          "Processando..."
        ) : state.scheduleMode === "now" ? (
          <>
            <Rocket className="w-5 h-5 mr-2" />
            Iniciar Disparo ({state.totalRecipients.toLocaleString("pt-BR")} mensagens)
          </>
        ) : (
          <>
            <Calendar className="w-5 h-5 mr-2" />
            Agendar Disparo
          </>
        )}
      </Button>

      {state.totalRecipients === 0 && (
        <p className="text-center text-xs text-red-500">
          Nenhum destinatário selecionado. Volte ao passo anterior.
        </p>
      )}
    </div>
  );
}
