import { useState } from "react";
import { Search, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WhatsAppPreview } from "./WhatsAppPreview";
import type { MetaTemplate } from "@/types/shooting";

const CATEGORY_BADGE: Record<string, "blue" | "green" | "amber"> = {
  MARKETING: "blue",
  UTILITY: "green",
  AUTHENTICATION: "amber",
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
      const matches = text.match(/\{\{\d+\}\}/g) ?? [];
      count += matches.length;
      if (comp.buttons) {
        for (const btn of comp.buttons) {
          const bmatches = (btn.url ?? "").match(/\{\{\d+\}\}/g) ?? [];
          count += bmatches.length;
        }
      }
    }
    return count;
  }

  return (
    <>
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Buscar template..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">Nenhum template encontrado.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin pr-1">
            {filtered.map((t) => {
              const isSelected = t.id === value;
              return (
                <div
                  key={t.id}
                  onClick={() => onChange(t.id)}
                  className={`flex items-start justify-between p-3 rounded-xl border cursor-pointer transition-colors ${
                    isSelected
                      ? "border-green-500 bg-green-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {t.template_name}
                      </p>
                      <Badge variant={CATEGORY_BADGE[t.category] ?? "secondary"}>
                        {CATEGORY_LABEL[t.category] ?? t.category}
                      </Badge>
                      <Badge variant="secondary">{t.language}</Badge>
                    </div>
                    {t.components.find((c) => c.type === "BODY")?.text && (
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {t.components.find((c) => c.type === "BODY")?.text}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {countVariables(t)} variáveis
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-2 shrink-0 h-7 w-7"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreview(t);
                    }}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
            Template selecionado: <span className="font-semibold">{selected.template_name}</span>
          </div>
        )}
      </div>

      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Preview — {preview?.template_name}</DialogTitle>
          </DialogHeader>
          {preview && (
            <WhatsAppPreview template={preview} variables={{}} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
