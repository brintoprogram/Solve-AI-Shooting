import { format } from "date-fns";
import type { MetaTemplate } from "@/types/shooting";
import type { XlsxRow } from "@/types/shooting";

interface WhatsAppPreviewProps {
  template: MetaTemplate;
  variables: Record<string, string>; // placeholder key -> value
  recipientData?: XlsxRow;
  recipientName?: string;
}

function interpolate(text: string, vars: Record<string, string>): JSX.Element {
  const parts = text.split(/(\{\{\d+\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/\{\{(\d+)\}\}/);
        if (match) {
          const val = vars[match[1]];
          return (
            <span
              key={i}
              className={val ? "text-gray-900 font-medium" : "bg-amber-200 text-amber-800 px-0.5 rounded text-xs"}
            >
              {val || `{{${match[1]}}}`}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function WhatsAppPreview({ template, variables, recipientName }: WhatsAppPreviewProps) {
  const header = template.components.find((c) => c.type === "HEADER");
  const body = template.components.find((c) => c.type === "BODY");
  const footer = template.components.find((c) => c.type === "FOOTER");
  const buttons = template.components.find((c) => c.type === "BUTTONS");

  const now = format(new Date(), "HH:mm");

  return (
    <div className="space-y-2">
      {recipientName && (
        <p className="text-xs text-gray-500 text-center">
          Visualizando para: <span className="font-medium text-gray-700">{recipientName}</span>
        </p>
      )}

      {/* Message bubble */}
      <div className="bg-[#E7FFDB] rounded-2xl rounded-tl-none px-3.5 py-2.5 shadow-sm max-w-xs ml-2">
        {/* Header */}
        {header?.text && (
          <p className="font-semibold text-gray-900 text-sm mb-1.5">
            {interpolate(header.text, variables)}
          </p>
        )}

        {/* Body */}
        {body?.text && (
          <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed">
            {interpolate(body.text, variables)}
          </p>
        )}

        {/* Footer */}
        {footer?.text && (
          <p className="text-xs text-gray-500 mt-1.5">{footer.text}</p>
        )}

        {/* Timestamp */}
        <div className="flex justify-end mt-1">
          <span className="text-[10px] text-gray-400">{now} ✓✓</span>
        </div>
      </div>

      {/* Buttons */}
      {buttons?.buttons && buttons.buttons.length > 0 && (
        <div className="space-y-1 ml-2">
          {buttons.buttons.map((btn, i) => (
            <div
              key={i}
              className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-center text-sm text-[#00a5f4] font-medium shadow-sm"
            >
              {btn.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
