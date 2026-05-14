import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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

// ── Trigger config panel (shown below timeline when a trigger is selected) ─────
interface TriggerConfigProps {
  trig:            TriggerDraft;
  ruleChannel:     AutomationChannel;
  templateMode:    AutomationWizardState["template_mode"];
  zApiConnections: ZApiConnection[];
  metaConnections: MetaConnection[];
  zApiTemplates:   ZApiTemplate[];
  metaTemplates:   MetaTemplate[];
  onUpdate:        (patch: Partial<TriggerDraft>) => void;
  onRemove:        () => void;
  canRemove:       boolean;
}

function TriggerConfig({ trig, ruleChannel, templateMode, zApiConnections: _zc, metaConnections: _mc, zApiTemplates, metaTemplates, onUpdate, onRemove, canRemove }: TriggerConfigProps) {
  const effectiveChannel = (trig.channel ?? ruleChannel) as AutomationChannel;
  const isZApi = effectiveChannel === "z_api";
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
    <div className="rounded-2xl overflow-hidden animate-scale-in"
      style={{ background: "rgba(13,26,17,0.9)", border: "1px solid rgba(63,176,108,0.22)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>

      {/* Config header */}
      <div className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(63,176,108,0.1)", background: "rgba(63,176,108,0.04)" }}>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full" style={{ background: trig.enabled ? "#3fb06c" : "#6b8a75" }} />
          <span className="text-sm font-semibold text-agro-text">{trig.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* toggle */}
          <button type="button" onClick={() => onUpdate({ enabled: !trig.enabled })}
            className="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200"
            style={{ background: trig.enabled ? "#3fb06c" : "rgba(255,255,255,0.1)" }}>
            <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
              style={{ transform: trig.enabled ? "translateX(16px)" : "translateX(0)" }} />
          </button>
          {canRemove && (
            <button type="button" onClick={onRemove}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-red-400 hover:bg-red-400/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Day offset picker */}
        <div>
          <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-2">Quando disparar</label>
          <div className="flex items-center gap-2">
            <input
              type="number" min={0} max={365}
              className="input-agro w-16 text-center text-sm"
              value={direction === "same" ? 0 : absDays}
              disabled={direction === "same"}
              onChange={(e) => setDayOffset(e.target.value, direction)}
            />
            <select className="input-agro text-sm flex-1" value={direction}
              onChange={(e) => setDayOffset(String(absDays), e.target.value as "before" | "same" | "after")}>
              <option value="before">dias antes do vencimento</option>
              <option value="same">no dia do vencimento</option>
              <option value="after">dias depois do vencimento</option>
            </select>
          </div>
        </div>

        {templateMode === "per_trigger" && trig.enabled && (
          <>
            {/* Channel override */}
            <div>
              <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Canal</label>
              <select className="input-agro w-full text-sm" value={trig.channel ?? ""}
                onChange={(e) => onUpdate({ channel: (e.target.value || null) as AutomationChannel | null })}>
                <option value="">Usar padrão da régua ({ruleChannel === "z_api" ? "Z-API" : "Meta"})</option>
                <option value="z_api">Z-API</option>
                <option value="meta">Meta API</option>
              </select>
            </div>

            {isZApi ? (
              <>
                <div>
                  <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Template Z-API</label>
                  <select className="input-agro w-full text-sm" value={trig.z_api_template_id ?? ""}
                    onChange={(e) => onUpdate({ z_api_template_id: e.target.value || null, message_body: "" })}>
                    <option value="">— Texto livre (sem template) —</option>
                    {zApiTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                {!trig.z_api_template_id && (
                  <div>
                    <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Mensagem *</label>
                    <textarea className="input-agro w-full resize-none text-sm" rows={3}
                      placeholder={`Olá {nome}, seu boleto de {valor} vence em {vencimento}...`}
                      value={trig.message_body}
                      onChange={(e) => onUpdate({ message_body: e.target.value })}
                      maxLength={1024} />
                    <p className="text-[10px] text-agro-muted mt-1">
                      Vars: <span className="font-mono text-amber-400">{`{nome} {valor} {vencimento} {dias} {boleto}`}</span>
                    </p>
                  </div>
                )}
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
                        <select className="input-agro flex-1 text-sm"
                          value={trig.column_mapping[idx] ?? ""}
                          onChange={(e) => onUpdate({ column_mapping: { ...trig.column_mapping, [idx]: e.target.value } })}>
                          <option value="">Selecione...</option>
                          {AUTOMATION_VAR_OPTIONS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Template Meta (aprovado)</label>
                  <select className="input-agro w-full text-sm" value={trig.meta_template_id ?? ""}
                    onChange={(e) => onUpdate({ meta_template_id: e.target.value || null })}>
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
          </>
        )}
      </div>
    </div>
  );
}

// ── Timeline dot ────────────────────────────────────────────────────────────────
interface TimelineDotProps {
  trig:      TriggerDraft;
  position:  number;  // 0–100%
  isActive:  boolean;
  onClick:   () => void;
}

function TimelineDot({ trig, position, isActive, onClick }: TimelineDotProps) {
  const isCenter = trig.day_offset === 0;
  return (
    <div
      className="absolute flex flex-col items-center"
      style={{ left: `${position}%`, transform: "translateX(-50%)", top: -8 }}
    >
      <button
        type="button"
        onClick={onClick}
        className="relative flex items-center justify-center transition-all duration-200"
        style={{ width: isCenter ? 20 : 16, height: isCenter ? 20 : 16 }}
      >
        {isActive && (
          <span className="absolute inset-0 rounded-full animate-ping opacity-40"
            style={{ background: "#3fb06c" }} />
        )}
        <span
          className="relative rounded-full border-2 transition-all duration-200"
          style={{
            width:  isCenter ? 20 : 16,
            height: isCenter ? 20 : 16,
            background: !trig.enabled
              ? "rgba(107,114,128,0.3)"
              : isActive
              ? "#3fb06c"
              : isCenter
              ? "rgba(63,176,108,0.25)"
              : "rgba(63,176,108,0.15)",
            borderColor: !trig.enabled
              ? "rgba(107,114,128,0.4)"
              : isActive
              ? "#3fb06c"
              : "#3fb06c",
            boxShadow: isActive ? "0 0 12px rgba(63,176,108,0.6)" : "none",
          }}
        />
      </button>
      {/* Label below dot */}
      <div
        className={cn(
          "mt-2 px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap transition-all duration-200 text-center max-w-[64px] leading-tight",
          !trig.enabled ? "text-gray-500" : isActive ? "text-agro-green" : "text-agro-muted-2"
        )}
      >
        {isCenter ? "Vence" : trig.label}
      </div>
    </div>
  );
}

// ── Main step ───────────────────────────────────────────────────────────────────
export function StepTriggers({ state, zApiConnections, metaConnections, zApiTemplates, metaTemplates, onChange }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(
    state.triggers[0]?.key ?? null
  );

  function updateTrigger(key: string, patch: Partial<TriggerDraft>) {
    onChange({
      triggers: state.triggers.map((t) =>
        t.key === key
          ? { ...t, ...patch, label: patch.day_offset !== undefined ? makeTriggerLabel(patch.day_offset) : t.label }
          : t
      ),
    });
  }

  function removeTrigger(key: string) {
    const remaining = state.triggers.filter((t) => t.key !== key);
    onChange({ triggers: remaining });
    if (selectedKey === key) setSelectedKey(remaining[0]?.key ?? null);
  }

  function addTrigger() {
    const sorted = [...state.triggers].sort((a, b) => a.day_offset - b.day_offset);
    const lastOffset = sorted[sorted.length - 1]?.day_offset ?? -1;
    const nextOffset = lastOffset < 0 ? lastOffset - 1 : lastOffset + 1;
    const t = newTrigger({ day_offset: nextOffset, label: makeTriggerLabel(nextOffset) });
    onChange({ triggers: [...state.triggers, t] });
    setSelectedKey(t.key);
  }

  // ── Compute timeline positions ──
  const sorted = [...state.triggers].sort((a, b) => a.day_offset - b.day_offset);
  const offsets = sorted.map((t) => t.day_offset);
  // Always include 0 (vencimento) as an anchor point even if no trigger is on it
  const allOffsets = [...new Set([...offsets, 0])].sort((a, b) => a - b);
  const minOff = allOffsets[0];
  const maxOff = allOffsets[allOffsets.length - 1];
  const range  = maxOff - minOff || 1;

  function toPercent(off: number) {
    // Add 10% padding on each side
    return 10 + ((off - minOff) / range) * 80;
  }

  const vencimentoPercent = toPercent(0);

  const selectedTrig = state.triggers.find((t) => t.key === selectedKey) ?? null;

  return (
    <div className="space-y-6">
      <p className="text-xs text-agro-muted">
        Clique num ponto da linha do tempo para configurar o disparo.
        {state.template_mode === "unified" && " Como a mensagem é unificada, só precisa definir quando disparar."}
      </p>

      {/* ── Visual Timeline ─────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-visible py-10 px-4 relative"
        style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.12)" }}>

        {/* Axis line */}
        <div className="relative h-0.5 rounded-full mx-4"
          style={{ background: "linear-gradient(90deg, rgba(63,176,108,0.08), rgba(63,176,108,0.25), rgba(63,176,108,0.08))" }}>

          {/* Before/after labels */}
          <span className="absolute -top-5 left-0 text-[9px] text-agro-muted tracking-widest uppercase">Antes</span>
          <span className="absolute -top-5 right-0 text-[9px] text-agro-muted tracking-widest uppercase">Depois</span>

          {/* Vencimento anchor */}
          <div className="absolute flex flex-col items-center" style={{ left: `${vencimentoPercent}%`, transform: "translateX(-50%)", top: -28 }}>
            <div className="px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase mb-1"
              style={{ background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }}>
              Vencimento
            </div>
            <div className="w-px h-8" style={{ background: "linear-gradient(180deg, rgba(63,176,108,0.5), transparent)" }} />
          </div>

          {/* Trigger dots */}
          {sorted.map((trig) => (
            <TimelineDot
              key={trig.key}
              trig={trig}
              position={toPercent(trig.day_offset)}
              isActive={selectedKey === trig.key}
              onClick={() => setSelectedKey(trig.key === selectedKey ? null : trig.key)}
            />
          ))}
        </div>

        {/* Add button row */}
        <div className="flex justify-center mt-12">
          {state.triggers.length < 10 && (
            <button type="button" onClick={addTrigger}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:bg-agro-green/10"
              style={{ color: "#3fb06c", border: "1px dashed rgba(63,176,108,0.35)" }}>
              <Plus className="w-3.5 h-3.5" /> Adicionar gatilho
            </button>
          )}
        </div>
      </div>

      {/* Trigger list pills */}
      <div className="flex flex-wrap gap-2">
        {sorted.map((trig) => (
          <button
            key={trig.key}
            type="button"
            onClick={() => setSelectedKey(trig.key === selectedKey ? null : trig.key)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150",
              selectedKey === trig.key ? "text-white" : "hover:opacity-80"
            )}
            style={{
              background: selectedKey === trig.key
                ? "linear-gradient(135deg, #3fb06c, #16A34A)"
                : trig.enabled
                ? "rgba(63,176,108,0.1)"
                : "rgba(107,114,128,0.1)",
              border: `1px solid ${selectedKey === trig.key ? "transparent" : trig.enabled ? "rgba(63,176,108,0.2)" : "rgba(107,114,128,0.2)"}`,
              color: selectedKey === trig.key ? "#fff" : trig.enabled ? "#3fb06c" : "#6b8a75",
            }}
          >
            {trig.label}
          </button>
        ))}
      </div>

      {/* Selected trigger config */}
      {selectedTrig && (
        <TriggerConfig
          trig={selectedTrig}
          ruleChannel={state.channel}
          templateMode={state.template_mode}
          zApiConnections={zApiConnections}
          metaConnections={metaConnections}
          zApiTemplates={zApiTemplates}
          metaTemplates={metaTemplates}
          onUpdate={(patch) => updateTrigger(selectedTrig.key, patch)}
          onRemove={() => removeTrigger(selectedTrig.key)}
          canRemove={state.triggers.length > 1}
        />
      )}

      {state.triggers.length === 0 && (
        <p className="text-center text-sm text-agro-muted py-4">Nenhum gatilho adicionado</p>
      )}
    </div>
  );
}
