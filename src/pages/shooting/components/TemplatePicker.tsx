import { useState } from "react";
import { Search, Eye, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WhatsAppPreview } from "./WhatsAppPreview";
import type { MetaTemplate } from "@/types/shooting";

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  MARKETING:      { bg: "rgba(59,130,246,0.12)", text: "#60a5fa", border: "rgba(59,130,246,0.25)" },
  UTILITY:        { bg: "rgba(63,176,108,0.12)", text: "#3fb06c", border: "rgba(63,176,108,0.25)" },
  AUTHENTICATION: { bg: "rgba(245,158,11,0.12)", text: "#fbbf24", border: "rgba(245,158,11,0.25)" },
};

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilitário",
  AUTHENTICATION: "Autenticação",
};

interface TemplatePickerProps {
  templates: MetaTemplate[];
  value: string;
  onChange: (id: string) => void;
}

export function TemplatePicker({ templates, value, onChange }: TemplatePickerProps) {
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<MetaTemplate | null>(null);

  const filtered = templates.filter((t) =>
    t.template_name.toLowerCase().includes(search.toLowerCase())
  );
  const selected = templates.find((t) => t.id === value);

  function countVariables(t: MetaTemplate) {
    let count = 0;
    for (const comp of t.components) {
      const text = comp.text ?? "";
      count += (text.match(/\{\{\d+\}\}/g) ?? []).length;
      if (comp.buttons) {
        for (const btn of comp.buttons) {
          count += ((btn.url ?? "").match(/\{\{\d+\}\}/g) ?? []).length;
        }
      }
    }
    return count;
  }

  return (
    <>
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
          <input
            className="input-agro w-full pl-9"
            placeholder="Buscar template..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-agro-muted text-sm">Nenhum template encontrado</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin pr-1">
            {filtered.map((t) => {
              const isSelected = t.id === value;
              const catColors = CATEGORY_COLORS[t.category] ?? CATEGORY_COLORS.UTILITY;
              const varCount = countVariables(t);
              const bodyText = t.components.find((c) => c.type === "BODY")?.text;

              return (
                <div
                  key={t.id}
                  onClick={() => onChange(t.id)}
                  className={cn(
                    "flex items-start justify-between p-3.5 rounded-xl cursor-pointer transition-all duration-200 group",
                    isSelected ? "card-selected" : "",
                  )}
                  style={!isSelected ? {
                    background: "rgba(13,26,17,0.6)",
                    border: "1px solid rgba(63,176,108,0.1)",
                  } : undefined}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className={cn(
                        "text-sm font-semibold truncate transition-colors",
                        isSelected ? "text-agro-text" : "text-agro-text-2 group-hover:text-agro-text",
                      )}>
                        {t.template_name}
                      </p>

                      {/* Category badge */}
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: catColors.bg, color: catColors.text, border: `1px solid ${catColors.border}` }}
                      >
                        {CATEGORY_LABEL[t.category] ?? t.category}
                      </span>

                      {/* Language badge */}
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium text-agro-muted"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        {t.language}
                      </span>
                    </div>

                    {bodyText && (
                      <p className="text-xs text-agro-muted truncate">{bodyText}</p>
                    )}

                    <p className="text-[10px] text-agro-muted-2 mt-0.5">
                      {varCount} {varCount === 1 ? "variável" : "variáveis"}
                    </p>
                  </div>

                  <button
                    className="ml-3 shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-green transition-colors hover:bg-white/10"
                    onClick={(e) => { e.stopPropagation(); setPreview(t); }}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Selected indicator */}
        {selected && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.2)" }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-agro-green glow-green-sm" />
            <p className="text-xs text-agro-muted">
              Selecionado: <span className="font-semibold text-agro-green">{selected.template_name}</span>
            </p>
          </div>
        )}
      </div>

      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="max-w-sm"
          style={{ background: "rgba(13,26,17,0.98)", border: "1px solid rgba(63,176,108,0.2)" }}
        >
          <DialogHeader>
            <DialogTitle className="text-agro-text text-sm font-semibold">
              Preview — {preview?.template_name}
            </DialogTitle>
          </DialogHeader>
          {preview && <WhatsAppPreview template={preview} variables={{}} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
