import { Wifi, Smartphone, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutomationWizardState, AutomationChannel, TemplateMode } from "@/types/automations";
import type { MetaConnection } from "@/types/shooting";
import type { ZApiConnection } from "@/hooks/useZApiConnections";

const AUTO_VARS = "{nome}  {valor}  {vencimento}  {dias}  {status_vencimento}  {boleto}";

interface Props {
  state:           AutomationWizardState;
  zApiConnections: ZApiConnection[];
  metaConnections: MetaConnection[];
  onChange:        (patch: Partial<AutomationWizardState>) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function padHour(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

export function StepIdentity({ state, zApiConnections, metaConnections, onChange }: Props) {
  const channels: { value: AutomationChannel; icon: typeof Wifi; title: string; sub: string }[] = [
    { value: "z_api", icon: Smartphone, title: "Z-API", sub: "Texto livre · número celular" },
    { value: "meta",  icon: Wifi,       title: "API Oficial Meta", sub: "Templates aprovados · alta entregabilidade" },
  ];

  const templateModes: { value: TemplateMode; title: string; sub: string }[] = [
    { value: "per_trigger", title: "Template por gatilho", sub: "Mensagem diferente para cada ponto da cadência" },
    { value: "unified",     title: "Mensagem única com {dias}", sub: `Uma única mensagem com variáveis dinâmicas: ${AUTO_VARS}` },
  ];

  return (
    <div className="space-y-7">

      {/* Nome */}
      <div>
        <label className="field-label">Nome da régua *</label>
        <input
          className="input-agro w-full"
          placeholder="Ex: Cobrança Mensal, Preventivo Vencimentos..."
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={120}
        />
      </div>

      {/* Canal */}
      <div>
        <p className="field-label">Canal de envio *</p>
        <div className="grid grid-cols-2 gap-3">
          {channels.map((opt) => {
            const active = state.channel === opt.value;
            return (
              <div
                key={opt.value}
                onClick={() => onChange({ channel: opt.value, z_api_connection_id: "", meta_connection_id: "" })}
                className={cn("relative flex items-start gap-3 p-4 rounded-xl cursor-pointer transition-all group", active ? "card-selected" : "hover:scale-[1.005]")}
                style={!active ? { background: "rgba(26,46,34,0.5)", border: "1px solid rgba(63,176,108,0.1)" } : undefined}
              >
                <div
                  className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all", active ? "glow-green-sm" : "group-hover:bg-white/10")}
                  style={{ background: active ? "linear-gradient(135deg, #3fb06c, #16A34A)" : "rgba(63,176,108,0.08)", border: active ? "none" : "1px solid rgba(63,176,108,0.15)" }}
                >
                  <opt.icon className={cn("w-4 h-4", active ? "text-white" : "text-agro-muted-2 group-hover:text-agro-green")} />
                </div>
                <div>
                  <p className={cn("font-semibold text-sm", active ? "text-agro-green" : "text-agro-text")}>{opt.title}</p>
                  <p className="text-xs text-agro-muted mt-0.5">{opt.sub}</p>
                </div>
                {active && <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-agro-green glow-green-sm" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Conexão */}
      <div>
        <label className="field-label">Conexão *</label>
        {state.channel === "z_api" ? (
          <select
            className="input-agro w-full"
            value={state.z_api_connection_id}
            onChange={(e) => onChange({ z_api_connection_id: e.target.value })}
          >
            <option value="">Selecione uma instância Z-API...</option>
            {zApiConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.phone ? ` · ${c.phone}` : ""} {c.status === "connected" ? "✓" : "⚠"}
              </option>
            ))}
          </select>
        ) : (
          <select
            className="input-agro w-full"
            value={state.meta_connection_id}
            onChange={(e) => onChange({ meta_connection_id: e.target.value })}
          >
            <option value="">Selecione uma conexão META...</option>
            {metaConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_phone}{c.business_name ? ` · ${c.business_name}` : ""}{c.quality_rating ? ` [${c.quality_rating}]` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Horário de disparo */}
      <div>
        <label className="field-label flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" /> Horário de disparo *
        </label>
        <select
          className="input-agro w-full"
          value={state.send_hour}
          onChange={(e) => onChange({ send_hour: Number(e.target.value) })}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>{padHour(h)}</option>
          ))}
        </select>
        <p className="text-[10px] text-agro-muted mt-1">
          O sistema verifica a cada hora e dispara quando a hora atual coincide com o horário configurado.
        </p>
      </div>

      {/* Modo de template */}
      <div>
        <p className="field-label">Modo de mensagem *</p>
        <div className="space-y-2">
          {templateModes.map((opt) => {
            const active = state.template_mode === opt.value;
            return (
              <div
                key={opt.value}
                onClick={() => onChange({ template_mode: opt.value })}
                className={cn("flex items-start gap-3 p-4 rounded-xl cursor-pointer transition-all", active ? "card-selected" : "hover:bg-white/5")}
                style={!active ? { border: "1px solid rgba(63,176,108,0.1)", background: "rgba(26,46,34,0.4)" } : undefined}
              >
                <div className={cn("w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 transition-all flex items-center justify-center",
                  active ? "border-agro-green glow-green-sm" : "border-agro-muted/40")}
                  style={active ? { background: "#3fb06c" } : {}}>
                  {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <div>
                  <p className={cn("text-sm font-semibold", active ? "text-agro-green" : "text-agro-text")}>{opt.title}</p>
                  <p className="text-xs text-agro-muted mt-0.5">{opt.sub}</p>
                </div>
              </div>
            );
          })}
        </div>

        {state.template_mode === "unified" && (
          <div className="mt-3">
            <label className="field-label">Mensagem unificada *</label>
            <textarea
              className="input-agro w-full resize-none"
              rows={5}
              placeholder={`Olá {nome}, seu boleto de {valor} vence em {vencimento}.\nFaltam {dias} dias para o vencimento. Código: {boleto}`}
              value={state.unified_message}
              onChange={(e) => onChange({ unified_message: e.target.value })}
              maxLength={1024}
            />
            <p className="text-[10px] text-agro-muted mt-1">
              Variáveis disponíveis: <span className="font-mono text-amber-400">{`{nome} {valor} {vencimento} {dias} {status_vencimento} {boleto}`}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
