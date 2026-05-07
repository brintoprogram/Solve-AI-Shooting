import { useMemo } from "react";
import { LayoutTemplate, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WizardState, XlsxValidationResult } from "@/types/shooting";
import type { ZApiTemplate } from "@/types/database";
import { useContactFields } from "@/hooks/useContactFields";
import { useAuth } from "@/context/AuthContext";

interface StepZApiMessageProps {
  state:      WizardState;
  xlsxResult: XlsxValidationResult | null;
  templates:  ZApiTemplate[];
  onChange:   (patch: Partial<WizardState>) => void;
}

function extractVarIndices(text: string): string[] {
  const matches = text.match(/\{\{(\d+)\}\}/g) ?? [];
  const indices = [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "")))];
  return indices.sort((a, b) => Number(a) - Number(b));
}

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

export function StepZApiMessage({ state, xlsxResult, templates, onChange }: StepZApiMessageProps) {
  const { workspaceId } = useAuth();
  const { visibleFields } = useContactFields(workspaceId ?? "");

  const CONTACT_SAMPLE = {
    name: "João Silva", phone: "5511999999999", empresa: "Empresa Exemplo",
    email: "joao@empresa.com", cidade: "São Paulo", estado: "SP",
    valor_total_pendente: "R$ 1.250,00", proximo_vencimento: "30/04/2025", boleto_nf: "NF-0042",
  };

  const availableColumns = state.dataSource === "contacts"
    ? visibleFields
    : (xlsxResult?.headers ?? ["nome", "telefone", "valor", "data_vencimento", "link"]);

  const sampleRow = state.dataSource === "contacts"
    ? CONTACT_SAMPLE
    : (xlsxResult?.validRows?.[0] ?? { nome: "João Silva", valor: "R$ 1.200,00", data_vencimento: "30/04/2025" });

  const selectedTemplate = templates.find((t) => t.id === state.zApiTemplateId) ?? null;

  const varIndices = useMemo(() => extractVarIndices(state.messageBody), [state.messageBody]);
  const bodyVars   = state.columnMapping.body_variables ?? {};

  const bodyPreview   = buildPreview(state.messageBody, bodyVars, sampleRow as Record<string, unknown>);
  const charCount     = state.messageBody.length;

  function selectTemplate(tpl: ZApiTemplate | null) {
    if (!tpl) {
      onChange({ zApiTemplateId: null, messageBody: "", columnMapping: { ...state.columnMapping, body_variables: {} } });
      return;
    }
    const newIndices = new Set(extractVarIndices(tpl.body));
    const pruned: Record<string, string> = {};
    for (const [k, v] of Object.entries(bodyVars)) {
      if (newIndices.has(k)) pruned[k] = v;
    }
    onChange({
      zApiTemplateId: tpl.id,
      messageBody: tpl.body,
      columnMapping: { ...state.columnMapping, body_variables: pruned },
    });
  }

  function handleBodyChange(text: string) {
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
      const start   = textarea.selectionStart ?? state.messageBody.length;
      const end     = textarea.selectionEnd   ?? state.messageBody.length;
      const newText = state.messageBody.slice(0, start) + `{{${nextIdx}}}` + state.messageBody.slice(end);
      handleBodyChange(newText);
    } else {
      handleBodyChange(state.messageBody + `{{${nextIdx}}}`);
    }
  }

  const allVarsMapped = varIndices.every((i) => !!bodyVars[i]);
  const phoneColSet   = !!state.columnMapping.phone_column;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

      {/* ── Left: compose ─────────────────────── */}
      <div className="space-y-6">

        {/* Template picker */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-agro-muted-2 uppercase tracking-[0.1em] leading-none">
            Template Z-API
          </p>
          {templates.length === 0 ? (
            <p className="text-xs text-agro-muted">
              Nenhum template criado ainda. Crie em <strong className="text-agro-text">Configurações → Templates Z-API</strong>.
            </p>
          ) : (
            <div className="space-y-2">
              <select
                className="input-agro w-full"
                value={state.zApiTemplateId ?? ""}
                onChange={(e) => {
                  const tpl = templates.find((t) => t.id === e.target.value) ?? null;
                  selectTemplate(tpl);
                }}
              >
                <option value="">— Texto livre (sem template) —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.message_type === "button_list" ? "Com botões" : "Texto simples"}
                  </option>
                ))}
              </select>

              {selectedTemplate && (
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-xl"
                  style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)" }}
                >
                  <LayoutTemplate className="w-3 h-3 shrink-0" style={{ color: "#a78bfa" }} />
                  {selectedTemplate.header_text && (
                    <span className="text-[10px] px-2 py-1 rounded font-medium"
                      style={{ background: "rgba(139,92,246,0.15)", color: "#c4b5fd" }}
                    >
                      Header: {selectedTemplate.header_text}
                    </span>
                  )}
                  {selectedTemplate.footer && (
                    <span className="text-[10px] px-2 py-1 rounded font-medium"
                      style={{ background: "rgba(139,92,246,0.15)", color: "#c4b5fd" }}
                    >
                      Footer
                    </span>
                  )}
                  {selectedTemplate.message_type === "button_list" && (
                    <span className="text-[10px] px-2 py-1 rounded font-medium"
                      style={{ background: "rgba(139,92,246,0.15)", color: "#c4b5fd" }}
                    >
                      {selectedTemplate.buttons.length} botão{selectedTemplate.buttons.length !== 1 ? "es" : ""}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => selectTemplate(null)}
                    className="ml-auto p-1 -mr-1 text-agro-muted-2 hover:text-red-400 transition-colors rounded"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Phone column — only needed for XLSX uploads; contacts already have phone */}
        {state.dataSource !== "contacts" && (
          <div className="space-y-2">
            <p className="text-[10px] font-medium text-agro-muted-2 uppercase tracking-[0.06em] leading-none">
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
        )}

        {/* Message body */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-bold text-agro-muted-2 uppercase tracking-[0.1em] leading-none">
              Mensagem *
            </p>
            <div className="flex items-baseline gap-2.5">
              <span className="text-[9px] font-light text-agro-muted-2">{charCount} caracteres</span>
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
            <p className="text-xs font-bold text-agro-muted-2 uppercase tracking-[0.1em] leading-none">
              Mapeamento de variáveis *
            </p>
            <div className="space-y-3">
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

        {/* Validation hints */}
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
          <div className="space-y-4 w-full flex flex-col items-center">
            <div className="text-center">
              <p className="text-sm font-semibold text-agro-text">Preview em tempo real</p>
              <p className="text-xs text-agro-muted mt-0.5">Dados da linha 1 dos destinatários</p>
            </div>

            {/* Phone mockup */}
            <div
              className="w-[268px] rounded-[32px] p-3.5"
              style={{
                background: "#111b21",
                border: "2px solid rgba(255,255,255,0.08)",
                boxShadow: "0 36px 72px rgba(0,0,0,0.65), 0 12px 28px rgba(0,0,0,0.45), 0 4px 8px rgba(0,0,0,0.3)",
              }}
            >
              {/* Status bar */}
              <div className="flex justify-between items-center mb-2.5 px-2">
                <span className="text-[9px] text-gray-500">9:41</span>
                <div className="flex gap-1">
                  <div className="w-3 h-1.5 rounded-sm bg-gray-600" />
                  <div className="w-3 h-1.5 rounded-sm bg-gray-600" />
                </div>
              </div>

              {/* Chat area */}
              <div className="rounded-2xl min-h-[180px] p-3.5 flex flex-col gap-2"
                style={{ background: "#0b141a" }}>

                {/* Message bubble */}
                <div className="max-w-[90%] self-end">
                  <div className="rounded-2xl rounded-br-sm shadow-sm overflow-hidden"
                    style={{ background: "#005c4b" }}>

                    {/* Header */}
                    {selectedTemplate?.header_text && (
                      <div className="px-4 pt-3 pb-1">
                        <p className="text-[11px] font-bold text-white">{selectedTemplate.header_text}</p>
                      </div>
                    )}

                    {/* Body */}
                    <div className={cn("px-4 py-3", selectedTemplate?.header_text && "pt-0")}>
                      <p className="text-[11px] text-white leading-relaxed whitespace-pre-wrap break-words">
                        {bodyPreview || "Sua mensagem aparecerá aqui..."}
                      </p>
                    </div>

                    {/* Footer */}
                    {selectedTemplate?.footer && (
                      <div className="px-4 pb-3">
                        <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.45)" }}>
                          {selectedTemplate.footer}
                        </p>
                      </div>
                    )}

                    {/* Timestamp */}
                    <div className="flex items-center justify-end gap-1 px-4 pb-2">
                      <span className="text-[8px]" style={{ color: "rgba(255,255,255,0.5)" }}>Agora</span>
                      <svg viewBox="0 0 16 11" className="w-3 h-2" fill="none">
                        <path d="M11 1L6 9 1 5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M15 1l-5 8-2-2" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </div>
                  </div>

                  {/* Buttons (outside bubble, below) */}
                  {selectedTemplate?.message_type === "button_list" && selectedTemplate.buttons.length > 0 && (
                    <div className="mt-1.5 space-y-1.5">
                      {selectedTemplate.buttons.map((btn) => (
                        <div key={btn.id}
                          className="flex items-center justify-center py-2 rounded-lg text-[10px] font-semibold"
                          style={{ background: "rgba(0,92,75,0.7)", border: "1px solid rgba(0,92,75,0.9)", color: "#53bdeb" }}
                        >
                          {btn.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Mapping status */}
            <div className={cn(
              "flex items-center gap-2 text-xs px-3 py-1.5 rounded-full",
              allVarsMapped && phoneColSet ? "text-agro-green" : "text-amber-400",
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
