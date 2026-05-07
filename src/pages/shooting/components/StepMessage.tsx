import { useState } from "react";
import { TemplatePicker } from "./TemplatePicker";
import { VariableMapper, buildVariablesFromRow } from "./VariableMapper";
import { PhonePreviewFrame } from "./PhonePreviewFrame";
import type { WizardState, XlsxValidationResult } from "@/types/shooting";
import type { MetaTemplate } from "@/types/shooting";
import { useContactFields } from "@/hooks/useContactFields";
import { useAuth } from "@/context/AuthContext";

interface StepMessageProps {
  state: WizardState;
  templates: MetaTemplate[];
  xlsxResult: XlsxValidationResult | null;
  onChange: (patch: Partial<WizardState>) => void;
}

export function StepMessage({ state, templates, xlsxResult, onChange }: StepMessageProps) {
  const [previewIndex, setPreviewIndex] = useState(0);
  const { workspaceId } = useAuth();
  const { visibleFields } = useContactFields(workspaceId ?? "");

  const selectedTemplate = templates.find((t) => t.id === state.templateId);

  const CONTACT_SAMPLE = {
    name: "João Silva", phone: "5511999999999", empresa: "Empresa Exemplo",
    email: "joao@empresa.com", cidade: "São Paulo", estado: "SP",
    valor_total_pendente: "R$ 1.250,00", proximo_vencimento: "30/04/2025", boleto_nf: "NF-0042",
  };

  const availableColumns = state.dataSource === "contacts"
    ? visibleFields
    : (xlsxResult?.headers ?? ["nome", "telefone", "valor", "data_vencimento", "link"]);

  const previewRows = state.dataSource === "contacts"
    ? [CONTACT_SAMPLE]
    : (xlsxResult?.validRows ?? [
      { nome: "João Silva", valor: "R$ 1.200,00", data_vencimento: "30/01/2025", link: "https://pay.example.com/abc" },
    ]);

  const currentRow = previewRows[previewIndex] ?? {};
  const previewVars = selectedTemplate
    ? buildVariablesFromRow(state.columnMapping, currentRow as Record<string, unknown>)
    : {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left: template + mapping */}
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
            Template *
          </p>
          <TemplatePicker
            templates={templates}
            value={state.templateId}
            onChange={(id) => onChange({ templateId: id, columnMapping: { phone_column: "" } })}
          />
        </div>

        {selectedTemplate && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
              Mapeamento de variáveis *
            </p>
            <p className="text-xs text-agro-muted">
              Conecte cada{" "}
              <span className="font-mono px-1 rounded text-amber-400"
                style={{ background: "rgba(245,158,11,0.1)" }}
              >
                {"{{variável}}"}
              </span>{" "}
              do template a uma coluna dos seus dados
            </p>
            <VariableMapper
              template={selectedTemplate}
              availableColumns={availableColumns}
              mapping={state.columnMapping}
              onChange={(mapping) => onChange({ columnMapping: mapping })}
            />
          </div>
        )}
      </div>

      {/* Right: phone preview */}
      <div className="flex flex-col items-center">
        {selectedTemplate ? (
          <div className="space-y-3 w-full flex flex-col items-center">
            <div className="text-center">
              <p className="text-sm font-semibold text-agro-text">Preview em tempo real</p>
              <p className="text-xs text-agro-muted mt-0.5">
                Dados da linha {previewIndex + 1} dos destinatários
              </p>
            </div>
            <PhonePreviewFrame
              template={selectedTemplate}
              variables={previewVars}
              recipientName={String(currentRow["nome"] ?? currentRow["name"] ?? "Contato")}
              currentIndex={previewIndex}
              totalRows={previewRows.length}
              onPrev={() => setPreviewIndex((i) => Math.max(0, i - 1))}
              onNext={() => setPreviewIndex((i) => Math.min(previewRows.length - 1, i + 1))}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-16 w-full">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.12)" }}
            >
              <span className="text-3xl">📱</span>
            </div>
            <p className="text-agro-muted font-medium text-sm">Selecione um template</p>
            <p className="text-xs text-agro-muted-2 mt-1">O preview aparecerá aqui</p>
          </div>
        )}
      </div>
    </div>
  );
}
