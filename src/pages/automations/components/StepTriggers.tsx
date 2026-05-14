import { Plus, Trash2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutomationWizardState, TriggerDraft, AutomationChannel } from "@/types/automations";
import { AUTOMATION_VAR_OPTIONS } from "@/types/automations";
import type { ZApiTemplate } from "@/types/database";
import type { ZApiConnection } from "@/hooks/useZApiConnections";
import type { MetaConnection } from "@/types/shooting";

interface MetaTemplate { id: string; template_name: string; language: string; status: string; }

interface Props {
  state:           AutomationWizardState;
  zApiConnections: ZApiConnection[];
  metaConnections: MetaConnection[];
  zApiTemplates:   ZApiTemplate[];
  metaTemplates:   MetaTemplate[];
  onChange:        (patch: Partial<AutomationWizardState>) => void;
}

function makeTriggerLabel(dayOffset: number): string {
  if (dayOffset === 0) return "No dia do vencimento";
  if (dayOffset < 0)  return `${Math.abs(dayOffset)} dia${Math.abs(dayOffset) > 1 ? "s" : ""} antes`;
  return `${dayOffset} dia${dayOffset > 1 ? "s" : ""} depois`;
}

function newTrigger(defaults: Partial<TriggerDraft> = {}): TriggerDraft {
  return {
    key:                  crypto.randomUUID(),
    day_offset:           -1,
    label:                "1 dia antes",
    channel:              null,
    z_api_connection_id:  null,
    z_api_template_id:    null,
    meta_connection_id:   null,
    meta_template_id:     null,
    column_mapping:       {},
    message_body:         "",
    enabled:              true,
    ...defaults,
  };
}

function extractTemplateVarIndices(body: string): string[] {
  const matches = body.match(/\{\{(\d+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "")))].sort((a, b) => Number(a) - Number(b));
}

interface TriggerCardProps {
  trig:            TriggerDraft;
  ruleChannel:     AutomationChannel;
  ruleConnId:      string;
  templateMode:    AutomationWizardState["template_mode"];
  zApiConnections: ZApiConnection[];
  metaConnections: MetaConnection[];
  zApiTemplates:   ZApiTemplate[];
  metaTemplates:   MetaTemplate[];
  onUpdate:        (patch: Partial<TriggerDraft>) => void;
  onRemove:        () => void;
  canRemove:       boolean;
}

function TriggerCard({ trig, ruleChannel, templateMode, zApiConnections, metaConnections, zApiTemplates, metaTemplates, onUpdate, onRemove, canRemove }: TriggerCardProps) {
  const effectiveChannel = (trig.channel ?? ruleChannel) as AutomationChannel;
  const isZApi = effectiveChannel === "z_api";

  // For per_trigger mode: find template body to extract vars
  const selectedZApiTpl = zApiTemplates.find((t) => t.id === trig.z_api_template_id);
  const varIndices = selectedZApiTpl ? extractTemplateVarIndices(selectedZApiTpl.body) : [];

  function setDayOffset(raw: string, dir: "before" | "same" | "after") {
    const n = Math.max(0, parseInt(raw) || 0);
    const offset = dir === "before" ? -n : dir === "after" ? n : 0;
    onUpdate({ day_offset: offset, label: makeTriggerLabel(offset) });
  }

  const absDays = Math.abs(trig.day_offset);
  const direction = trig.day_offset < 0 ? "before" : trig.day_offset === 0 ? "same" : "after";

  return (
    <div className="p-4 rounded-xl space-y-4"
      style={{ background: "rgba(13,26,17,0.7)", border: `1px solid ${trig.enabled ? "rgba(63,176,108,0.18)" : "rgba(63,176,108,0.07)"}` }}>

      {/* Header row */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          {/* Days input */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={365}
              className="input-agro w-16 text-center text-sm"
              value={direction === "same" ? 0 : absDays}
              disabled={direction === "same"}
              onChange={(e) => setDayOffset(e.target.value, direction)}
            />
            <select
              className="input-agro text-sm"
              value={direction}
              onChange={(e) => {
                const d = e.target.value as "before" | "same" | "after";
                setDayOffset(String(absDays), d);
              }}
            >
              <option value="before">dias antes</option>
              <option value="same">no dia</option>
              <option value="after">dias depois</option>
            </select>
          </div>
          <span className="text-xs text-agro-muted-2 hidden sm:block">{trig.label}</span>
        </div>

        {/* Toggle enabled */}
        <button
          type="button"
          onClick={() => onUpdate({ enabled: !trig.enabled })}
          className="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200"
          style={{ background: trig.enabled ? "#3fb06c" : "rgba(255,255,255,0.1)" }}
        >
          <span
            className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
            style={{ transform: trig.enabled ? "translateX(16px)" : "translateX(0)" }}
          />
        </button>

        {canRemove && (
          <button type="button" onClick={onRemove}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Template section (only for per_trigger mode) */}
      {templateMode === "per_trigger" && trig.enabled && (
        <div className="space-y-3 pt-1 border-t" style={{ borderColor: "rgba(63,176,108,0.08)" }}>

          {/* Channel override */}
          <div>
            <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Canal</label>
            <select
              className="input-agro w-full text-sm"
              value={trig.channel ?? ""}
              onChange={(e) => onUpdate({ channel: (e.target.value || null) as AutomationChannel | null })}
            >
              <option value="">Usar padrão da régua ({ruleChannel === "z_api" ? "Z-API" : "Meta"})</option>
              <option value="z_api">Z-API</option>
              <option value="meta">Meta API</option>
            </select>
          </div>

          {isZApi ? (
            <>
              <div>
                <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Template Z-API</label>
                <select
                  className="input-agro w-full text-sm"
                  value={trig.z_api_template_id ?? ""}
                  onChange={(e) => onUpdate({ z_api_template_id: e.target.value || null, message_body: "" })}
                >
                  <option value="">— Texto livre (sem template) —</option>
                  {zApiTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              {!trig.z_api_template_id && (
                <div>
                  <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Mensagem *</label>
                  <textarea
                    className="input-agro w-full resize-none text-sm"
                    rows={3}
                    placeholder={`Olá {nome}, seu boleto de {valor} vence em {vencimento}...`}
                    value={trig.message_body}
                    onChange={(e) => onUpdate({ message_body: e.target.value })}
                    maxLength={1024}
                  />
                  <p className="text-[10px] text-agro-muted mt-1">
                    Vars: <span className="font-mono text-amber-400">{`{nome} {valor} {vencimento} {dias} {boleto}`}</span>
                  </p>
                </div>
              )}

              {/* Column mapping for Z-API template vars */}
              {selectedZApiTpl && varIndices.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider">Mapear variáveis do template</p>
                  {varIndices.map((idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2 py-1 rounded shrink-0"
                        style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.25)" }}>
                        {`{{${idx}}}`}
                      </span>
                      <span className="text-agro-muted-2 text-xs shrink-0">→</span>
                      <select
                        className="input-agro flex-1 text-sm"
                        value={trig.column_mapping[idx] ?? ""}
                        onChange={(e) => onUpdate({ column_mapping: { ...trig.column_mapping, [idx]: e.target.value } })}
                      >
                        <option value="">Selecione...</option>
                        {AUTOMATION_VAR_OPTIONS.map((v) => (
                          <option key={v.key} value={v.key}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* META */
            <>
              <div>
                <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Template Meta (aprovado)</label>
                <select
                  className="input-agro w-full text-sm"
                  value={trig.meta_template_id ?? ""}
                  onChange={(e) => onUpdate({ meta_template_id: e.target.value || null })}
                >
                  <option value="">Selecione um template aprovado...</option>
                  {metaTemplates.filter((t) => t.status === "APPROVED").map((t) => (
                    <option key={t.id} value={t.id}>{t.template_name} · {t.language}</option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] text-agro-muted">
                As variáveis do template serão mapeadas automaticamente para os dados do boleto.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function StepTriggers({ state, zApiConnections, metaConnections, zApiTemplates, metaTemplates, onChange }: Props) {
  function updateTrigger(key: string, patch: Partial<TriggerDraft>) {
    onChange({
      triggers: state.triggers.map((t) => t.key === key ? { ...t, ...patch, label: patch.day_offset !== undefined ? makeTriggerLabel(patch.day_offset) : t.label } : t),
    });
  }

  function removeTrigger(key: string) {
    onChange({ triggers: state.triggers.filter((t) => t.key !== key) });
  }

  function addTrigger() {
    const newOffset = (state.triggers[state.triggers.length - 1]?.day_offset ?? -1) + 1;
    onChange({ triggers: [...state.triggers, newTrigger({ day_offset: newOffset, label: makeTriggerLabel(newOffset) })] });
  }

  const sorted = [...state.triggers].sort((a, b) => a.day_offset - b.day_offset);

  return (
    <div className="space-y-4">
      <p className="text-xs text-agro-muted">
        Defina quando os disparos acontecem em relação à data de vencimento do boleto.
        {state.template_mode === "unified" && " Como a mensagem é unificada, só configure o horário de cada gatilho."}
      </p>

      {sorted.map((trig) => (
        <TriggerCard
          key={trig.key}
          trig={trig}
          ruleChannel={state.channel}
          ruleConnId={state.channel === "z_api" ? state.z_api_connection_id : state.meta_connection_id}
          templateMode={state.template_mode}
          zApiConnections={zApiConnections}
          metaConnections={metaConnections}
          zApiTemplates={zApiTemplates}
          metaTemplates={metaTemplates}
          onUpdate={(patch) => updateTrigger(trig.key, patch)}
          onRemove={() => removeTrigger(trig.key)}
          canRemove={state.triggers.length > 1}
        />
      ))}

      {state.triggers.length < 10 && (
        <button
          type="button"
          onClick={addTrigger}
          className="flex items-center gap-1.5 w-full justify-center px-4 py-3 rounded-xl text-sm font-semibold transition-colors hover:bg-agro-green/10"
          style={{ color: "#3fb06c", border: "1px dashed rgba(63,176,108,0.35)" }}
        >
          <Plus className="w-4 h-4" /> Adicionar gatilho
        </button>
      )}

      {state.triggers.length === 0 && (
        <p className="text-center text-sm text-agro-muted py-4">Nenhum gatilho adicionado</p>
      )}
    </div>
  );
}
