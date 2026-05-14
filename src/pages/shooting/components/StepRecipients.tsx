import { ContactSelector } from "./ContactSelector";
import { XlsxUploader } from "./XlsxUploader";
import type { WizardState, XlsxValidationResult } from "@/types/shooting";

interface StepRecipientsProps {
  state: WizardState;
  xlsxResult: XlsxValidationResult | null;
  onChange: (patch: Partial<WizardState>) => void;
  onXlsxResult: (result: XlsxValidationResult, file: File) => void;
  onXlsxClear: () => void;
}

export function StepRecipients({
  state,
  xlsxResult,
  onChange,
  onXlsxResult,
  onXlsxClear,
}: StepRecipientsProps) {
  if (state.dataSource === "contacts") {
    return (
      <ContactSelector
        selected={state.selectedContacts}
        selectedInvoices={state.selectedInvoices}
        onChange={(ids) => onChange({ selectedContacts: ids, totalRecipients: ids.length })}
        onInvoiceChange={(inv) => onChange({ selectedInvoices: inv })}
      />
    );
  }

  return (
    <XlsxUploader
      result={xlsxResult}
      onResult={(result, file) => {
        onXlsxResult(result, file);
        onChange({ totalRecipients: result.validRows.length });
      }}
      onClear={() => {
        onXlsxClear();
        onChange({ totalRecipients: 0, uploadId: null });
      }}
    />
  );
}
