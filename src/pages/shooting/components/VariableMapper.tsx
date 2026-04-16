import { ArrowRight } from "lucide-react";
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
      for (const m of [...comp.text.matchAll(/\{\{(\d+)\}\}/g)]) {
        entries.push({ component: "HEADER", index: m[1], label: `{{${m[1]}}}`, mappingPath: `header_variables.${m[1]}` });
      }
    }
    if (comp.type === "BODY" && comp.text) {
      for (const m of [...comp.text.matchAll(/\{\{(\d+)\}\}/g)]) {
        entries.push({ component: "BODY", index: m[1], label: `{{${m[1]}}}`, mappingPath: `body_variables.${m[1]}` });
      }
    }
    if (comp.type === "BUTTONS" && comp.buttons) {
      comp.buttons.forEach((btn, bi) => {
        if (btn.url) {
          for (const m of [...btn.url.matchAll(/\{\{(\d+)\}\}/g)]) {
            entries.push({ component: `BUTTON ${bi + 1} (${btn.text})`, index: m[1], label: `{{${m[1]}}}`, mappingPath: `button_variables.${bi}.${m[1]}` });
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
  for (const p of parts) cur = cur?.[p];
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

export function VariableMapper({ template, availableColumns, mapping, onChange }: VariableMapperProps) {
  const placeholders = extractPlaceholders(template);

  if (placeholders.length === 0) {
    return (
      <div className="p-4 rounded-xl text-sm text-agro-green"
        style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.2)" }}
      >
        Este template não possui variáveis para mapear.
      </div>
    );
  }

  const grouped = placeholders.reduce<Record<string, PlaceholderEntry[]>>(
    (acc, p) => { if (!acc[p.component]) acc[p.component] = []; acc[p.component].push(p); return acc; },
    {}
  );

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(63,176,108,0.12)" }}
    >
      {/* Header */}
      <div className="px-4 py-3"
        style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.1)" }}
      >
        <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">
          Mapeamento de Variáveis
        </p>
        <p className="text-xs text-agro-muted mt-0.5">
          {placeholders.length} {placeholders.length === 1 ? "variável" : "variáveis"} para configurar
        </p>
      </div>

      {/* Groups */}
      <div>
        {Object.entries(grouped).map(([component, entries], gi) => (
          <div key={component}
            style={{
              borderTop: gi > 0 ? "1px solid rgba(63,176,108,0.08)" : "none",
              padding: "16px",
            }}
          >
            <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest mb-3">
              {component}
            </p>

            <div className="space-y-3">
              {entries.map((entry) => {
                const current = getNestedValue(mapping, entry.mappingPath);
                const isMapped = !!current;
                return (
                  <div key={entry.mappingPath} className="flex items-center gap-3">
                    {/* Variable tag */}
                    <div className="w-20 shrink-0">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-semibold"
                        style={{
                          background: "rgba(245,158,11,0.12)",
                          border: "1px solid rgba(245,158,11,0.25)",
                          color: "#fbbf24",
                        }}
                      >
                        {entry.label}
                      </span>
                    </div>

                    <ArrowRight className="w-4 h-4 text-agro-muted-2 shrink-0" />

                    {/* Column selector */}
                    <div className="flex-1">
                      <select
                        value={current || "__none__"}
                        onChange={(e) => {
                          onChange(setNestedValue(mapping, entry.mappingPath, e.target.value === "__none__" ? "" : e.target.value));
                        }}
                        className="input-agro w-full text-sm"
                        style={!isMapped ? {
                          borderColor: "rgba(239,68,68,0.4)",
                        } : undefined}
                      >
                        <option value="__none__">— não mapeado —</option>
                        {availableColumns.map((col) => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>

                    {/* Status dot */}
                    <div className={`w-2 h-2 rounded-full shrink-0 ${isMapped ? "bg-agro-green glow-green-sm" : "bg-red-400"}`} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function buildVariablesFromRow(
  mapping: ColumnMapping,
  row: Record<string, unknown>
): Record<string, string> {
  const flat: Record<string, string> = {};
  if (mapping.body_variables) {
    for (const [k, col] of Object.entries(mapping.body_variables)) {
      flat[k] = String(row[col] ?? "");
    }
  }
  return flat;
}
