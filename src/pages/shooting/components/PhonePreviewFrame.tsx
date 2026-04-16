import { ChevronLeft, Phone, Video, MoreVertical, Smile, Paperclip, Mic } from "lucide-react";
import type { MetaTemplate } from "@/types/shooting";
import type { XlsxRow } from "@/types/shooting";
import { WhatsAppPreview } from "./WhatsAppPreview";

interface PhonePreviewFrameProps {
  template: MetaTemplate;
  variables: Record<string, string>;
  recipientData?: XlsxRow;
  recipientName?: string;
  currentIndex?: number;
  totalRows?: number;
  onPrev?: () => void;
  onNext?: () => void;
}

export function PhonePreviewFrame({
  template,
  variables,
  recipientName,
  recipientData,
  currentIndex,
  totalRows,
  onPrev,
  onNext,
}: PhonePreviewFrameProps) {
  return (
    <div className="flex flex-col items-center">
      {/* Phone frame */}
      <div className="relative w-[280px] h-[560px] bg-gray-900 rounded-[36px] shadow-2xl overflow-hidden"
        style={{ border: "6px solid #111827", boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)" }}
      >
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-gray-900 rounded-b-2xl z-10" />

        {/* Screen */}
        <div className="h-full bg-[#ECE5DD] flex flex-col">
          {/* Status bar */}
          <div className="h-7 bg-[#075E54] flex items-center justify-between px-4 pt-1">
            <span className="text-[10px] text-white font-medium">9:41</span>
            <div className="flex items-center gap-1">
              <div className="flex gap-0.5">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="w-0.5 rounded-sm bg-white" style={{ height: `${(i + 1) * 3}px` }} />
                ))}
              </div>
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M1.5 8.5a13 13 0 0 1 21 0M5.25 12.25a8 8 0 0 1 13.5 0M9 16a3 3 0 0 1 6 0" />
              </svg>
              <div className="w-5 h-2.5 rounded-sm border border-white relative">
                <div className="absolute right-0 top-0 bottom-0 my-auto w-0.5 h-1.5 bg-white rounded-r-sm -mr-0.5" />
                <div className="h-full w-4/5 bg-white rounded-sm" />
              </div>
            </div>
          </div>

          {/* Chat header */}
          <div className="bg-[#075E54] px-2 py-2 flex items-center gap-2">
            <ChevronLeft className="w-5 h-5 text-white" />
            <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-gray-600">
                {(recipientName ?? "C")[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">{recipientName ?? "Contato"}</p>
              <p className="text-[9px] text-green-200">online</p>
            </div>
            <div className="flex items-center gap-2.5">
              <Video className="w-4 h-4 text-white" />
              <Phone className="w-4 h-4 text-white" />
              <MoreVertical className="w-4 h-4 text-white" />
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-hidden px-2 py-3 flex flex-col justify-end">
            <WhatsAppPreview
              template={template}
              variables={variables}
              recipientData={recipientData}
              recipientName={undefined}
            />
          </div>

          {/* Input bar */}
          <div className="bg-[#ECE5DD] px-2 py-2 flex items-center gap-2">
            <div className="flex-1 bg-white rounded-full px-3 py-1.5 flex items-center gap-2">
              <Smile className="w-4 h-4 text-gray-400" />
              <span className="text-[10px] text-gray-400 flex-1">Mensagem</span>
              <Paperclip className="w-3.5 h-3.5 text-gray-400" />
            </div>
            <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center">
              <Mic className="w-4 h-4 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      {totalRows !== undefined && totalRows > 1 && (
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={onPrev}
            disabled={currentIndex === 0}
            className="text-xs text-agro-muted hover:text-agro-text disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors"
            style={{ border: "1px solid rgba(63,176,108,0.15)" }}
          >
            ← Anterior
          </button>
          <span className="text-xs text-agro-muted-2">
            {(currentIndex ?? 0) + 1} / {totalRows}
          </span>
          <button
            onClick={onNext}
            disabled={(currentIndex ?? 0) >= totalRows - 1}
            className="text-xs text-agro-muted hover:text-agro-text disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors"
            style={{ border: "1px solid rgba(63,176,108,0.15)" }}
          >
            Próximo →
          </button>
        </div>
      )}
    </div>
  );
}
