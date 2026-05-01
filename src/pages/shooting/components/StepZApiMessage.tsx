import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { WizardState, XlsxValidationResult } from "@/types/shooting";

interface StepZApiMessageProps {
  state:      WizardState;
  xlsxResult: XlsxValidationResult | null;
  onChange:   (patch: Partial<WizardState>) => void;
}

// Extract {{N}} variable indices from message text
function extractVarIndices(text: string): string[] {
  const matches = text.match(/\{\{(\d+)\}\}/g) ?? [];
  const indices = [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "")))];
  return indices.sort((a, b) => Number(a) - Number(b));
}

// Build preview by replacing {{N}} with contact data
function buildPreview(
  text: string,
  bodyVars: Record<string, string>,
  sampleRow: Record<string, unknown>,
): string {
  let result = text;
  for (const [idx, col] of Object.entries(bodyVars)) {
    result = result.replace(new RegExp(`\\{\\{${idx}\\}\\}`, "g"), String(sampleRow[col] ?? `{{${idx}}}`));
  }
  return result;
}

export function StepZApiMessage({ state, xlsxResult, onChange }: StepZApiMessageProps) {
  const availableColumns = xlsxResult?.headers ?? ["nome", "telefone", "valor", "data_vencimento", "link"];
  const sampleRow        = xlsxResult?.validRows?.[0] ?? { nome: "João Silva", valor: "R$ 1.200,00", data_vencimento: "30/04/2025" };

  const varIndices = useMemo(() => extractVarIndices(state.messageBody), [state.messageBody]);
  const bodyVars   = state.columnMapping.body_variables ?? {};

  const preview = buildPreview(state.messageBody, bodyVars, sampleRow as Record<string, unknown>);
  const charCount = state.messageBody.length;

  function handleBodyChange(text: string) {
    // When text changes, remove mappings for variables no longer present
    const newIndices = new Set(extractVarIndices(text));
    const pruned: Record<string, string> = {};
    for (const [k, v] of Object.entries(bodyVars)) {
      if (newIndices.has(k)) pruned[k] = v;
    }
    onChange({
      messageBody: text,
      columnMapping: { ...state.columnMapping, body_variables: pruned },
    });
  }

  function handleVarMap(idx: string, col: string) {
    onChange({
      columnMapping: {
        ...state.columnMapping,
        body_variables: { ...bodyVars, [idx]: col },
      },
    });
  }

  function handlePhoneCol(col: string) {
    onChange({ columnMapping: { ...state.columnMapping, phone_column: col } });
  }

  function insertVar() {
    const nextIdx = varIndices.length > 0 ? String(Math.max(...varIndices.map(Number)) + 1) : "1";
    const textarea = document.getElementById("zapi-body") as HTMLTextAreaElement | null;
    if (textarea) {
      const start = textarea.selectionStart ?? state.messageBody.length;
      const end   = textarea.selectionEnd   ?? state.messageBody.length;
      const newText = state.messageBody.slice(0, start) + `{{${nextIdx}}}` + state.messageBody.slice(end);
      handleBodyChange(newText);
    } else {
      handleBodyChange(state.messageBody + `{{${nextIdx}}}`);
    }
  }

  const allVarsMapped = varIndices.every((i) => !!bodyVars[i]);
  const phoneColSet   = !!state.columnMapping.phone_column;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

      {/* ── Left: compose ─────────────────────── */}
      <div className="space-y-6">

        {/* Phone column */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
            Coluna do telefone *
          </p>
          <select
            className="input-agro w-full"
            value={state.columnMapping.phone_column}
            onChange={(e) => handlePhoneCol(e.target.value)}
          >
            <option value="">Selecione a coluna...</option>
            {availableColumns.map((col) => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
        </div>

        {/* Message body */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
              Mensagem *
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-agro-muted">{charCount} caracteres</span>
              <button
                type="button"
                onClick={insertVar}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-md text-agro-green hover:bg-agro-green/10 transition-colors"
                style={{ border: "1px solid rgba(63,176,108,0.25)" }}
              >
                + Inserir variável
              </button>
            </div>
          </div>
          <textarea
            id="zapi-body"
            className="input-agro w-full resize-none"
            rows={6}
            placeholder={"Olá {{1}}, sua fatura de {{2}} vence em {{3}}.\n\nAcesse o link para pagar: {{4}}"}
            value={state.messageBody}
            onChange={(e) => handleBodyChange(e.target.value)}
          />
          <p className="text-xs text-agro-muted">
            Use{" "}
            <span className="font-mono text-amber-400 px-1 rounded" style={{ background: "rgba(245,158,11,0.1)" }}>
              {"{{1}}, {{2}}, ..."}
            </span>{" "}
            para inserir dados dinâmicos de cada destinatário.
          </p>
        </div>

        {/* Variable mapping */}
        {varIndices.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
              Mapeamento de variáveis *
            </p>
            <div className="space-y-2">
              {varIndices.map((idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span
                    className="font-mono text-xs font-bold px-2 py-1 rounded-md shrink-0"
                    style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.25)" }}
                  >
                    {`{{${idx}}}`}
                  </span>
                  <span className="text-agro-muted-2 text-xs shrink-0">→</span>
                  <select
                    className="input-agro flex-1 text-sm"
                    value={bodyVars[idx] ?? ""}
                    onChange={(e) => handleVarMap(idx, e.target.value)}
                  >
                    <option value="">Selecione a coluna...</option>
                    {availableColumns.map((col) => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Validation hint */}
        {!phoneColSet && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#fbbf24" }}>
            ⚠ Selecione a coluna do telefone para continuar
          </div>
        )}
        {phoneColSet && !state.messageBody.trim() && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#fbbf24" }}>
            ⚠ Digite a mensagem para continuar
          </div>
        )}
        {phoneColSet && state.messageBody.trim() && !allVarsMapped && varIndices.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#fbbf24" }}>
            ⚠ Mapeie todas as variáveis para continuar
          </div>
        )}
      </div>

      {/* ── Right: preview ────────────────────── */}
      <div className="flex flex-col items-center">
        {state.messageBody.trim() ? (
          <div className="space-y-3 w-full flex flex-col items-center">
            <div className="text-center">
              <p className="text-sm font-semibold text-agro-text">Preview em tempo real</p>
              <p className="text-xs text-agro-muted mt-0.5">Dados da linha 1 dos destinatários</p>
            </div>

            {/* Phone mockup */}
            <div className="w-[240px] rounded-3xl p-3 shadow-2xl"
              style={{ background: "#111b21", border: "2px solid rgba(255,255,255,0.08)" }}>
              {/* Status bar */}
              <div className="flex justify-between items-center mb-2 px-2">
                <span className="text-[9px] text-gray-500">9:41</span>
                <div className="flex gap-1">
                  <div className="w-3 h-1.5 rounded-sm bg-gray-600" />
                  <div className="w-3 h-1.5 rounded-sm bg-gray-600" />
                </div>
              </div>

              {/* Chat area */}
              <div className="rounded-2xl min-h-[180px] p-3 flex flex-col gap-2"
                style={{ background: "#0b141a", backgroundImage: "radial-gradient(circle at 50% 50%, rgba(63,176,108,0.03) 0%, transparent 70%)" }}>

                {/* Message bubble */}
                <div className="max-w-[85%] self-end">
                  <div className="rounded-2xl rounded-br-sm px-3 py-2 shadow-sm"
                    style={{ background: "#005c4b" }}>
                    <p className="text-[11px] text-white leading-relaxed whitespace-pre-wrap break-words">{preview || "Sua mensagem aparecerá aqui..."}</p>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="text-[8px]" style={{ color: "rgba(255,255,255,0.5)" }}>Agora</span>
                      <svg viewBox="0 0 16 11" className="w-3 h-2" fill="none">
                        <path d="M11 1L6 9 1 5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M15 1l-5 8-2-2" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mapping status */}
            <div className={cn(
              "flex items-center gap-2 text-xs px-3 py-1.5 rounded-full",
              allVarsMapped && phoneColSet
                ? "text-agro-green"
                : "text-amber-400"
            )} style={{ background: allVarsMapped && phoneColSet ? "rgba(63,176,108,0.1)" : "rgba(245,158,11,0.1)" }}>
              <div className={cn("w-1.5 h-1.5 rounded-full", allVarsMapped && phoneColSet ? "bg-agro-green" : "bg-amber-400")} />
              {allVarsMapped && phoneColSet ? "Mensagem pronta para envio" : "Complete o mapeamento"}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-16 w-full">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.12)" }}>
              <span className="text-3xl">💬</span>
            </div>
            <p className="text-agro-muted font-medium text-sm">Escreva a mensagem</p>
            <p className="text-xs text-agro-muted-2 mt-1">O preview aparecerá aqui</p>
          </div>
        )}
      </div>
    </div>
  );
}
