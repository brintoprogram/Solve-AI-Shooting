import { useState } from "react";
import { Label } from "@/components/ui/label";
import { TemplatePicker } from "./TemplatePicker";
import { VariableMapper, buildVariablesFromRow } from "./VariableMapper";
import { PhonePreviewFrame } from "./PhonePreviewFrame";
import type { WizardState, XlsxValidationResult } from "@/types/shooting";
import type { MetaTemplate } from "@/types/shooting";

interface StepMessageProps {
  state: WizardState;
  templates: MetaTemplate[];
  xlsxResult: XlsxValidationResult | null;
  onChange: (patch: Partial<WizardState>) => void;
}

export function StepMessage({
  state,
  templates,
  xlsxResult,
  onChange,
}: StepMessageProps) {
  const [previewIndex, setPreviewIndex] = useState(0);

  const selectedTemplate = templates.find((t) => t.id === state.templateId);

  const availableColumns =
    xlsxResult?.headers ??
    ["nome", "telefone", "valor", "data_vencimento", "link"];

  const previewRows = xlsxResult?.validRows ?? [
    { nome: "João Silva", valor: "R$ 1.200,00", data_vencimento: "30/01/2025", link: "https://pay.example.com/abc" },
  ];

  const currentRow = previewRows[previewIndex] ?? {};
  const previewVars = selectedTemplate
    ? buildVariablesFromRow(state.columnMapping, currentRow as Record<string, unknown>)
    : {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left: Template selection + Variable mapping */}
      <div className="space-y-6">
        <div className="space-y-2">
          <Label className="text-sm font-semibold text-gray-700">Template *</Label>
          <TemplatePicker
            templates={templates}
            value={state.templateId}
            onChange={(id) =>
              onChange({ templateId: id, columnMapping: { phone_column: "" } })
            }
          />
        </div>

        {selectedTemplate && (
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-gray-700">Mapeamento de variáveis *</Label>
            <p className="text-xs text-gray-500">
              Conecte cada <span className="font-mono bg-amber-100 text-amber-700 px-1 rounded">{"{{variável}}"}</span> do template a uma coluna dos seus dados
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

      {/* Right: Phone preview */}
      <div className="flex flex-col items-center">
        {selectedTemplate ? (
          <div className="space-y-4 w-full flex flex-col items-center">
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-700">Preview em tempo real</p>
              <p className="text-xs text-gray-400 mt-0.5">
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
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <span className="text-3xl">📱</span>
            </div>
            <p className="text-gray-500 font-medium">Selecione um template</p>
            <p className="text-sm text-gray-400 mt-1">O preview aparecerá aqui</p>
          </div>
        )}
      </div>
    </div>
  );
}
