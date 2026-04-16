import { ArrowRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MetaTemplate, ColumnMapping } from "@/types/shooting";

interface VariableMapperProps {
  template: MetaTemplate;
  availableColumns: string[];
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
}

interface PlaceholderEntry {
  component: string;
  index: string;
  label: string;
  mappingPath: string;
}

function extractPlaceholders(template: MetaTemplate): PlaceholderEntry[] {
  const entries: PlaceholderEntry[] = [];

  for (const comp of template.components) {
    if (comp.type === "HEADER" && comp.text) {
      const matches = [...comp.text.matchAll(/\{\{(\d+)\}\}/g)];
      for (const m of matches) {
        entries.push({
          component: "HEADER",
          index: m[1],
          label: `{{${m[1]}}}`,
          mappingPath: `header_variables.${m[1]}`,
        });
      }
    }
    if (comp.type === "BODY" && comp.text) {
      const matches = [...comp.text.matchAll(/\{\{(\d+)\}\}/g)];
      for (const m of matches) {
        entries.push({
          component: "BODY",
          index: m[1],
          label: `{{${m[1]}}}`,
          mappingPath: `body_variables.${m[1]}`,
        });
      }
    }
    if (comp.type === "BUTTONS" && comp.buttons) {
      comp.buttons.forEach((btn, bi) => {
        if (btn.url) {
          const matches = [...btn.url.matchAll(/\{\{(\d+)\}\}/g)];
          for (const m of matches) {
            entries.push({
              component: `BUTTON ${bi + 1} (${btn.text})`,
              index: m[1],
              label: `{{${m[1]}}}`,
              mappingPath: `button_variables.${bi}.${m[1]}`,
            });
          }
        }
      });
    }
  }

  return entries;
}

function getNestedValue(mapping: ColumnMapping, path: string): string {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = mapping;
  for (const p of parts) {
    cur = cur?.[p];
  }
  return cur ?? "";
}

function setNestedValue(mapping: ColumnMapping, path: string, value: string): ColumnMapping {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const next = JSON.parse(JSON.stringify(mapping)) as any;
  let cur = next;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return next as ColumnMapping;
}

export function VariableMapper({
  template,
  availableColumns,
  mapping,
  onChange,
}: VariableMapperProps) {
  const placeholders = extractPlaceholders(template);

  if (placeholders.length === 0) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
        Este template não possui variáveis para mapear.
      </div>
    );
  }

  const grouped = placeholders.reduce<Record<string, PlaceholderEntry[]>>(
    (acc, p) => {
      if (!acc[p.component]) acc[p.component] = [];
      acc[p.component].push(p);
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-5">
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Mapeamento de Variáveis
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            O template possui {placeholders.length}{" "}
            {placeholders.length === 1 ? "variável" : "variáveis"} para preencher
          </p>
        </div>

        <div className="divide-y divide-gray-100">
          {Object.entries(grouped).map(([component, entries]) => (
            <div key={component} className="p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {component}
              </p>
              {entries.map((entry) => {
                const current = getNestedValue(mapping, entry.mappingPath);
                return (
                  <div key={entry.mappingPath} className="flex items-center gap-3">
                    <div className="w-24 shrink-0">
                      <span className="inline-flex items-center rounded-lg bg-amber-100 border border-amber-200 px-2.5 py-1 text-xs font-mono font-semibold text-amber-800">
                        {entry.label}
                      </span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
                    <div className="flex-1">
                      <Select
                        value={current || "__none__"}
                        onValueChange={(val) => {
                          onChange(
                            setNestedValue(
                              mapping,
                              entry.mappingPath,
                              val === "__none__" ? "" : val
                            )
                          );
                        }}
                      >
                        <SelectTrigger
                          className={!current ? "border-red-300 focus:ring-red-400" : ""}
                        >
                          <SelectValue placeholder="Selecione uma coluna..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            <span className="text-gray-400">— não mapeado —</span>
                          </SelectItem>
                          {availableColumns.map((col) => (
                            <SelectItem key={col} value={col}>
                              {col}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function buildVariablesFromRow(
  mapping: ColumnMapping,
  row: Record<string, unknown>
): Record<string, string> {
  const vars: Record<string, string> = {};

  const extract = (
    section: Record<string, string> | undefined,
    prefix: string
  ) => {
    if (!section) return;
    for (const [k, col] of Object.entries(section)) {
      vars[`${prefix}_${k}`] = String(row[col] ?? "");
    }
  };

  extract(mapping.header_variables, "header");
  extract(mapping.body_variables, "body");
  if (mapping.button_variables) {
    for (const [bi, btnVars] of Object.entries(mapping.button_variables)) {
      extract(btnVars, `button_${bi}`);
    }
  }

  // For WhatsAppPreview, just use the index as key
  const flat: Record<string, string> = {};
  if (mapping.body_variables) {
    for (const [k, col] of Object.entries(mapping.body_variables)) {
      flat[k] = String(row[col] ?? "");
    }
  }

  return flat;
}
