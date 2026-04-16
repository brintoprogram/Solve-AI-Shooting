import { Users, FileSpreadsheet, Calendar, Gauge } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { WizardState } from "@/types/shooting";
import type { MetaConnection } from "@/types/shooting";

interface StepScopeProps {
  state: WizardState;
  connections: MetaConnection[];
  onChange: (patch: Partial<WizardState>) => void;
}

const QUALITY_COLOR: Record<string, string> = {
  GREEN: "text-green-600",
  YELLOW: "text-amber-500",
  RED: "text-red-500",
};

export function StepScope({ state, connections, onChange }: StepScopeProps) {
  return (
    <div className="space-y-8">
      {/* Data source selection */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-gray-700">Origem dos dados *</Label>
        <div className="grid grid-cols-2 gap-4">
          {[
            {
              value: "contacts" as const,
              icon: Users,
              title: "Contatos Cadastrados",
              subtitle: "Selecione da sua base com filtros avançados",
            },
            {
              value: "xlsx_upload" as const,
              icon: FileSpreadsheet,
              title: "Upload Planilha XLSX",
              subtitle: "Importe dados externos de uma planilha Excel",
            },
          ].map((opt) => (
            <div
              key={opt.value}
              onClick={() => onChange({ dataSource: opt.value })}
              className={cn(
                "flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all",
                state.dataSource === opt.value
                  ? "border-green-500 bg-green-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                  state.dataSource === opt.value ? "bg-green-500" : "bg-gray-100"
                )}
              >
                <opt.icon
                  className={cn(
                    "w-5 h-5",
                    state.dataSource === opt.value ? "text-white" : "text-gray-400"
                  )}
                />
              </div>
              <div>
                <p
                  className={cn(
                    "font-semibold text-sm",
                    state.dataSource === opt.value ? "text-green-700" : "text-gray-900"
                  )}
                >
                  {opt.title}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{opt.subtitle}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Campaign name */}
      <div className="space-y-2">
        <Label htmlFor="campaign-name">Nome da campanha</Label>
        <Input
          id="campaign-name"
          placeholder="Ex: Cobrança Safra 2025, Notificação Vencimento..."
          value={state.campaignName}
          onChange={(e) => onChange({ campaignName: e.target.value })}
        />
        <p className="text-xs text-gray-400">
          Se deixado em branco, será usado um nome automático baseado na data
        </p>
      </div>

      {/* WhatsApp connection */}
      {connections.length > 0 && (
        <div className="space-y-2">
          <Label>Conexão WhatsApp *</Label>
          <Select
            value={state.connectionId}
            onValueChange={(v) => onChange({ connectionId: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione um número..." />
            </SelectTrigger>
            <SelectContent>
              {connections.map((conn) => (
                <SelectItem key={conn.id} value={conn.id}>
                  <div className="flex items-center gap-2">
                    <span>{conn.display_phone}</span>
                    {conn.business_name && (
                      <span className="text-gray-400">· {conn.business_name}</span>
                    )}
                    {conn.quality_rating && (
                      <span className={`text-xs font-medium ${QUALITY_COLOR[conn.quality_rating] ?? ""}`}>
                        ● {conn.quality_rating}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Scheduling */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Agendamento
        </Label>
        <RadioGroup
          value={state.scheduleMode}
          onValueChange={(v) => onChange({ scheduleMode: v as "now" | "later" })}
          className="flex gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="now" id="now" />
            <Label htmlFor="now" className="cursor-pointer font-normal">Enviar agora</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="later" id="later" />
            <Label htmlFor="later" className="cursor-pointer font-normal">Agendar para depois</Label>
          </div>
        </RadioGroup>

        {state.scheduleMode === "later" && (
          <Input
            type="datetime-local"
            value={state.scheduledAt ? state.scheduledAt.toISOString().slice(0, 16) : ""}
            onChange={(e) =>
              onChange({ scheduledAt: e.target.value ? new Date(e.target.value) : null })
            }
            min={new Date().toISOString().slice(0, 16)}
          />
        )}
      </div>

      {/* Sending speed */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <Gauge className="w-4 h-4" />
          Velocidade de envio:{" "}
          <span className="font-semibold text-green-600">{state.sendingSpeed} msg/min</span>
        </Label>
        <Slider
          min={1}
          max={80}
          step={1}
          value={[state.sendingSpeed]}
          onValueChange={([v]) => onChange({ sendingSpeed: v })}
        />
        <p className="text-xs text-gray-400">
          Respeite os limites do seu tier. Tier 1K = máx. 1.000 conversas/dia (≈ 0,7 msg/min)
        </p>
      </div>
    </div>
  );
}
