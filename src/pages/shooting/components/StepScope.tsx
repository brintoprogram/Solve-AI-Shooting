import { Users, FileSpreadsheet, Calendar, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WizardState } from "@/types/shooting";
import type { MetaConnection } from "@/types/shooting";

interface StepScopeProps {
  state: WizardState;
  connections: MetaConnection[];
  onChange: (patch: Partial<WizardState>) => void;
}

const QUALITY_COLOR: Record<string, string> = {
  GREEN:  "text-agro-green",
  YELLOW: "text-amber-400",
  RED:    "text-red-400",
};

export function StepScope({ state, connections, onChange }: StepScopeProps) {
  return (
    <div className="space-y-8">

      {/* ── Data source cards ────────────────────── */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
          Origem dos dados *
        </p>
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
          ].map((opt) => {
            const selected = state.dataSource === opt.value;
            return (
              <div
                key={opt.value}
                onClick={() => onChange({ dataSource: opt.value })}
                className={cn(
                  "relative flex items-start gap-4 p-5 rounded-xl cursor-pointer transition-all duration-300 group",
                  selected ? "card-selected" : "hover:scale-[1.01]",
                )}
                style={!selected ? {
                  background: "rgba(26,46,34,0.5)",
                  border: "1px solid rgba(63,176,108,0.1)",
                } : undefined}
              >
                {!selected && (
                  <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    style={{
                      boxShadow: "0 0 20px rgba(63,176,108,0.08)",
                      border: "1px solid rgba(63,176,108,0.2)",
                      borderRadius: "inherit",
                    }}
                  />
                )}

                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300",
                  selected
                    ? "glow-green-sm"
                    : "group-hover:bg-white/10",
                )}
                  style={{
                    background: selected
                      ? "linear-gradient(135deg, #3fb06c, #16A34A)"
                      : "rgba(63,176,108,0.08)",
                    border: selected ? "none" : "1px solid rgba(63,176,108,0.15)",
                  }}
                >
                  <opt.icon className={cn(
                    "w-5 h-5 transition-colors duration-300",
                    selected ? "text-white" : "text-agro-muted-2 group-hover:text-agro-green",
                  )} />
                </div>

                <div>
                  <p className={cn(
                    "font-semibold text-sm transition-colors duration-300",
                    selected ? "text-agro-green" : "text-agro-text group-hover:text-agro-text",
                  )}>
                    {opt.title}
                  </p>
                  <p className="text-xs text-agro-muted mt-0.5">{opt.subtitle}</p>
                </div>

                {/* Selected dot */}
                {selected && (
                  <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-agro-green glow-green-sm" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Campaign name ────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
          Nome da campanha
        </p>
        <input
          className="input-agro w-full"
          placeholder="Ex: Cobrança Safra 2025, Notificação Vencimento..."
          value={state.campaignName}
          onChange={(e) => onChange({ campaignName: e.target.value })}
        />
        <p className="text-xs text-agro-muted">
          Se deixado em branco, será usado um nome automático baseado na data
        </p>
      </div>

      {/* ── WhatsApp connection ──────────────────── */}
      {connections.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
            Conexão WhatsApp *
          </p>
          <select
            className="input-agro w-full"
            value={state.connectionId}
            onChange={(e) => onChange({ connectionId: e.target.value })}
          >
            <option value="">Selecione um número...</option>
            {connections.map((conn) => (
              <option key={conn.id} value={conn.id}>
                {conn.display_phone}
                {conn.business_name ? ` · ${conn.business_name}` : ""}
                {conn.quality_rating ? ` [${conn.quality_rating}]` : ""}
              </option>
            ))}
          </select>
          {state.connectionId && (() => {
            const conn = connections.find((c) => c.id === state.connectionId);
            return conn ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.12)" }}
              >
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  conn.status === "active" ? "bg-agro-green" : "bg-red-400",
                )} />
                <span className="text-xs text-agro-text">{conn.display_phone}</span>
                {conn.quality_rating && (
                  <span className={cn("text-xs font-medium", QUALITY_COLOR[conn.quality_rating] ?? "text-agro-muted")}>
                    ● {conn.quality_rating}
                  </span>
                )}
                {conn.messaging_limit && (
                  <span className="ml-auto text-xs text-agro-muted">{conn.messaging_limit}</span>
                )}
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* ── Scheduling ───────────────────────────── */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5" />
          Agendamento
        </p>

        <div className="flex gap-3">
          {[
            { value: "now",   label: "Enviar agora",        sub: "Disparo imediato" },
            { value: "later", label: "Agendar para depois", sub: "Escolha data e hora" },
          ].map((opt) => {
            const sel = state.scheduleMode === opt.value;
            return (
              <div
                key={opt.value}
                onClick={() => onChange({ scheduleMode: opt.value as "now" | "later" })}
                className="flex items-center gap-3 flex-1 p-4 rounded-xl cursor-pointer transition-all duration-300"
                style={sel ? {
                  background: "rgba(63,176,108,0.1)",
                  border: "1px solid rgba(63,176,108,0.3)",
                } : {
                  background: "rgba(26,46,34,0.5)",
                  border: "1px solid rgba(63,176,108,0.08)",
                }}
              >
                {/* Radio circle */}
                <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-all duration-300"
                  style={{
                    border: sel ? "none" : "2px solid rgba(63,176,108,0.3)",
                    background: sel ? "linear-gradient(135deg, #3fb06c, #16A34A)" : "transparent",
                  }}
                >
                  {sel && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <div>
                  <p className={cn("text-sm font-medium", sel ? "text-agro-text" : "text-agro-muted")}>
                    {opt.label}
                  </p>
                  <p className={cn("text-[10px]", sel ? "text-agro-green" : "text-agro-muted-2")}>
                    {opt.sub}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {state.scheduleMode === "later" && (
          <input
            type="datetime-local"
            className="input-agro w-full"
            value={state.scheduledAt ? state.scheduledAt.toISOString().slice(0, 16) : ""}
            onChange={(e) =>
              onChange({ scheduledAt: e.target.value ? new Date(e.target.value) : null })
            }
            min={new Date().toISOString().slice(0, 16)}
          />
        )}
      </div>

      {/* ── Sending speed ────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5" />
            Velocidade de envio
          </p>
          <span className="text-sm font-bold text-agro-green glow-green-sm px-2 py-0.5 rounded-md"
            style={{ background: "rgba(63,176,108,0.1)" }}
          >
            {state.sendingSpeed} msg/min
          </span>
        </div>

        {/* Custom slider */}
        <div className="relative py-2">
          <div className="relative h-2 rounded-full overflow-hidden"
            style={{ background: "rgba(63,176,108,0.12)" }}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-200"
              style={{
                width: `${(state.sendingSpeed / 80) * 100}%`,
                background: "linear-gradient(90deg, #3fb06c, #16A34A)",
                boxShadow: "0 0 8px rgba(63,176,108,0.5)",
              }}
            />
          </div>
          <input
            type="range"
            min={1}
            max={80}
            step={1}
            value={state.sendingSpeed}
            onChange={(e) => onChange({ sendingSpeed: Number(e.target.value) })}
            className="absolute inset-0 w-full opacity-0 cursor-pointer h-6 -top-2"
          />
          {/* Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full border-2 border-agro-green transition-all duration-200 pointer-events-none glow-green-sm"
            style={{
              left: `${(state.sendingSpeed / 80) * 100}%`,
              background: "linear-gradient(135deg, #3fb06c, #16A34A)",
            }}
          />
        </div>

        <div className="flex justify-between text-[10px] text-agro-muted-2">
          <span>1 msg/min</span>
          <span className="text-agro-muted">Respeite o tier da sua conta Meta</span>
          <span>80 msg/min</span>
        </div>
      </div>
    </div>
  );
}
