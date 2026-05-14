import { Users } from "lucide-react";
import type { AutomationWizardState, RecipientDraft } from "@/types/automations";
import { InvoiceSelector } from "./InvoiceSelector";

interface Props {
  state:    AutomationWizardState;
  onChange: (patch: Partial<AutomationWizardState>) => void;
}

export function StepRecipients({ state, onChange }: Props) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-agro-muted">
        Selecione os contatos cujos boletos entrarão nesta régua de cobrança.
        Apenas contatos com boletos pendentes são listados.
      </p>

      <InvoiceSelector
        selected={state.selectedRecipients}
        onChange={(items: RecipientDraft[]) => onChange({ selectedRecipients: items })}
      />

      {state.selectedRecipients.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
          style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.2)" }}>
          <Users className="w-4 h-4 text-agro-green shrink-0" />
          <p className="text-sm font-semibold text-agro-green">
            {state.selectedRecipients.length} contato{state.selectedRecipients.length !== 1 ? "s" : ""} selecionado{state.selectedRecipients.length !== 1 ? "s" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
