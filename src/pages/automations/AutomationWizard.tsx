import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Zap, Users, ClipboardList, CheckCircle2, ChevronLeft, ChevronRight,
  Plus, Trash2, Loader2, Search, X, ArrowUpDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useZApiConnections } from "@/hooks/useZApiConnections";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { Topbar } from "@/components/layout/Topbar";
import type { AutomationChannel, TemplateMode, TriggerDraft, RecipientDraft } from "@/types/automations";

// ── Constants ─────────────────────────────────────────────────────────────────

const PENDING_STATUSES = ["pendente", "vencido", "aberto", "em_aberto"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const VAR_HINTS = [
  { key: "{nome}",              label: "Nome"       },
  { key: "{valor}",             label: "Valor"      },
  { key: "{vencimento}",        label: "Vencimento" },
  { key: "{dias}",              label: "Dias"       },
  { key: "{status_vencimento}", label: "Status"     },
  { key: "{boleto}",            label: "Codigo"     },
];

const STEP_META = [
  { id: 1, label: "Identidade",    subtitle: "Nome & canal",         icon: Zap          },
  { id: 2, label: "Gatilhos",      subtitle: "Cadencia de disparos", icon: ClipboardList },
  { id: 3, label: "Destinatarios", subtitle: "Selecionar contatos",  icon: Users        },
  { id: 4, label: "Revisao",       subtitle: "Revisar & ativar",     icon: CheckCircle2 },
] as const;

// ── Local state ────────────────────────────────────────────────────────────────

interface WState {
  step:                1 | 2 | 3 | 4;
  name:                string;
  channel:             AutomationChannel;
  z_api_connection_id: string;
  meta_connection_id:  string;
  send_hour:           number;
  template_mode:       TemplateMode;
  unified_message:     string;
  triggers:            TriggerDraft[];
  selectedRecipients:  RecipientDraft[];
}

const INIT: WState = {
  step: 1, name: "", channel: "z_api",
  z_api_connection_id: "", meta_connection_id: "",
  send_hour: 9, template_mode: "per_trigger", unified_message: "",
  triggers: [], selectedRecipients: [],
};

function makeTrigger(dayOffset: number): TriggerDraft {
  return {
    key: crypto.randomUUID(), day_offset: dayOffset, label: trigLabel(dayOffset),
    channel: null, z_api_connection_id: null, z_api_template_id: null,
    meta_connection_id: null, meta_template_id: null,
    column_mapping: {}, message_body: "", enabled: true,
  };
}

function trigLabel(offset: number): string {
  if (offset < 0) return `${Math.abs(offset)} dias antes`;
  if (offset === 0) return "No dia do vencimento";
  return `${offset} dias depois`;
}

function fmtBRL(v: number | null) {
  if (!v) return "-";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ── Step bar ──────────────────────────────────────────────────────────────────

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-0 px-6 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
      {STEP_META.map((s, i) => {
        const done    = step > s.id;
        const current = step === s.id;
        return (
          <div key={s.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all shrink-0"
                style={{
                  background: done ? "rgba(63,176,108,0.2)" : current ? "#3fb06c" : "rgba(63,176,108,0.06)",
                  border:     done ? "1px solid rgba(63,176,108,0.4)" : current ? "none" : "1px solid rgba(63,176,108,0.15)",
                  color:      done ? "#3fb06c" : current ? "#000" : "#5a7a66",
                }}>
                {done ? "+" : s.id}
              </div>
              <div className="hidden sm:block text-center">
                <p className="text-[10px] font-semibold" style={{ color: current ? "#3fb06c" : done ? "#7fc49a" : "#5a7a66" }}>{s.label}</p>
              </div>
            </div>
            {i < STEP_META.length - 1 && (
              <div className="flex-1 h-px mx-2" style={{ background: done ? "rgba(63,176,108,0.35)" : "rgba(63,176,108,0.1)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1 — Identity ─────────────────────────────────────────────────────────

function Step1({ s, patch, zApiConns, metaConns }: {
  s: WState;
  patch: (p: Partial<WState>) => void;
  zApiConns: { id: string; name: string; phone: string | null }[];
  metaConns: { id: string; display_phone?: string; phone_number_id?: string }[];
}) {
  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <label className="block text-xs text-agro-muted uppercase tracking-widest mb-1.5">Nome da regua *</label>
        <input className="input-agro w-full" placeholder="Ex: Cobranca Safra Junho 2026"
          value={s.name} onChange={(e) => patch({ name: e.target.value })} />
      </div>

      <div>
        <label className="block text-xs text-agro-muted uppercase tracking-widest mb-1.5">Canal</label>
        <div className="flex gap-2">
          {(["z_api", "meta"] as AutomationChannel[]).map((ch) => (
            <button key={ch} onClick={() => patch({ channel: ch })}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={s.channel === ch
                ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.4)" }
                : { background: "rgba(0,0,0,0.2)", color: "#5a7a66", border: "1px solid rgba(63,176,108,0.1)" }}>
              {ch === "z_api" ? "Z-API" : "Meta (Cloud API)"}
            </button>
          ))}
        </div>
      </div>

      {s.channel === "z_api" && (
        <div>
          <label className="block text-xs text-agro-muted uppercase tracking-widest mb-1.5">Conexao Z-API</label>
          <select className="input-agro w-full" value={s.z_api_connection_id}
            onChange={(e) => patch({ z_api_connection_id: e.target.value })}>
            <option value="">Selecione uma conexao</option>
            {zApiConns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` . ${c.phone}` : ""}</option>)}
          </select>
          {zApiConns.length === 0 && <p className="text-[11px] text-agro-muted mt-1">Nenhuma conexao configurada em Configuracoes.</p>}
        </div>
      )}

      {s.channel === "meta" && (
        <div>
          <label className="block text-xs text-agro-muted uppercase tracking-widest mb-1.5">Conexao Meta</label>
          <select className="input-agro w-full" value={s.meta_connection_id}
            onChange={(e) => patch({ meta_connection_id: e.target.value })}>
            <option value="">Selecione uma conexao</option>
            {metaConns.map((c) => <option key={c.id} value={c.id}>{c.display_phone ?? c.phone_number_id}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs text-agro-muted uppercase tracking-widest mb-1.5">Horario de disparo (UTC-3)</label>
        <select className="input-agro w-full" value={s.send_hour}
          onChange={(e) => patch({ send_hour: Number(e.target.value) })}>
          {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
        </select>
        <p className="text-[11px] text-agro-muted mt-1">O sistema verifica e dispara uma vez por hora no horario configurado.</p>
      </div>

      <div>
        <label className="block text-xs text-agro-muted uppercase tracking-widest mb-1.5">Modo de mensagem</label>
        <div className="flex gap-2">
          {(["per_trigger", "unified"] as TemplateMode[]).map((m) => (
            <button key={m} onClick={() => patch({ template_mode: m })}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
              style={s.template_mode === m
                ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.4)" }
                : { background: "rgba(0,0,0,0.2)", color: "#5a7a66", border: "1px solid rgba(63,176,108,0.1)" }}>
              {m === "per_trigger" ? "Mensagem por gatilho" : "Mensagem unica com {dias}"}
            </button>
          ))}
        </div>

        {s.template_mode === "unified" && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1">
              {VAR_HINTS.map((v) => (
                <button key={v.key} type="button"
                  onClick={() => patch({ unified_message: s.unified_message + v.key })}
                  className="text-[10px] px-2 py-0.5 rounded-md transition-colors hover:bg-white/10"
                  style={{ background: "rgba(63,176,108,0.08)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.2)" }}>
                  {v.key} <span className="opacity-60">({v.label})</span>
                </button>
              ))}
            </div>
            <textarea className="input-agro w-full resize-none" rows={4}
              placeholder="Ex: Ola {nome}! Seu boleto de {valor} vence em {dias} dias ({vencimento})."
              value={s.unified_message} onChange={(e) => patch({ unified_message: e.target.value })} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step 2 — Triggers ─────────────────────────────────────────────────────────

function TriggerEditor({ t, templateMode, onChange, onRemove }: {
  t: TriggerDraft;
  templateMode: TemplateMode;
  onChange: (u: Partial<TriggerDraft>) => void;
  onRemove: () => void;
}) {
  const absVal = Math.abs(t.day_offset);
  const dir    = t.day_offset < 0 ? "before" : t.day_offset === 0 ? "same" : "after";
  const C      = { before: "#60a5fa", same: "#3fb06c", after: "#f87171" };

  function handleDir(v: string) {
    const abs = absVal === 0 ? 1 : absVal;
    onChange({ day_offset: v === "before" ? -abs : v === "same" ? 0 : abs });
  }
  function handleAbs(v: string) {
    const n = Math.max(0, parseInt(v) || 0);
    onChange({ day_offset: dir === "before" ? -n : dir === "same" ? 0 : n });
  }

  return (
    <div className="rounded-2xl p-4 space-y-3"
      style={{ background: "rgba(13,26,17,0.7)", border: `1px solid ${C[dir]}25` }}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <select className="input-agro text-xs" value={dir} onChange={(e) => handleDir(e.target.value)} style={{ width: 120 }}>
            <option value="before">Antes</option>
            <option value="same">No dia</option>
            <option value="after">Depois</option>
          </select>
          {dir !== "same" && (
            <>
              <input type="number" min={1} max={60} className="input-agro text-xs w-16 text-center"
                value={absVal || ""} onChange={(e) => handleAbs(e.target.value)} />
              <span className="text-xs text-agro-muted">dias</span>
            </>
          )}
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: `${C[dir]}18`, color: C[dir], border: `1px solid ${C[dir]}40` }}>
            {t.label}
          </span>
        </div>
        <button onClick={() => onChange({ enabled: !t.enabled })}
          className="relative w-9 h-5 rounded-full transition-colors shrink-0"
          style={{ background: t.enabled ? "#1B5E20" : "rgba(107,138,117,0.2)" }}>
          <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
            style={{ left: t.enabled ? "17px" : "2px" }} />
        </button>
        <button onClick={onRemove} className="p-1.5 rounded-lg text-agro-muted hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {templateMode === "per_trigger" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {VAR_HINTS.map((v) => (
              <button key={v.key} type="button"
                onClick={() => onChange({ message_body: t.message_body + v.key })}
                className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/10"
                style={{ background: "rgba(63,176,108,0.06)", color: "#5a7a66", border: "1px solid rgba(63,176,108,0.12)" }}>
                {v.key}
              </button>
            ))}
          </div>
          <textarea className="input-agro w-full resize-none text-xs" rows={3}
            placeholder={`Mensagem para "${t.label}". Use {nome}, {valor}, {vencimento}, {dias}...`}
            value={t.message_body} onChange={(e) => onChange({ message_body: e.target.value })} />
        </div>
      )}
    </div>
  );
}

function Step2({ s, patch }: { s: WState; patch: (p: Partial<WState>) => void }) {
  const sorted = [...s.triggers].sort((a, b) => a.day_offset - b.day_offset);

  function patchTrig(key: string, upd: Partial<TriggerDraft>) {
    patch({
      triggers: s.triggers.map((t) =>
        t.key === key ? { ...t, ...upd, label: upd.day_offset !== undefined ? trigLabel(upd.day_offset) : t.label } : t
      ),
    });
  }

  function addTrigger() {
    const existing = s.triggers.map((t) => t.day_offset);
    const candidates = [-7, -3, 0, 1, 3, 5, 7, 10, -1, -5, 2, 14];
    const next = candidates.find((c) => !existing.includes(c)) ?? (Math.max(...existing, 0) + 1);
    patch({ triggers: [...s.triggers, makeTrigger(next)] });
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-xs text-agro-muted">Configure quando disparar em relacao ao vencimento. Negativo = antes, positivo = depois.</p>
      {sorted.length === 0 && (
        <div className="rounded-xl py-8 text-center" style={{ border: "1px dashed rgba(63,176,108,0.2)" }}>
          <p className="text-sm text-agro-muted">Nenhum gatilho. Adicione ao menos um para continuar.</p>
        </div>
      )}
      {sorted.map((t) => (
        <TriggerEditor key={t.key} t={t} templateMode={s.template_mode}
          onChange={(upd) => patchTrig(t.key, upd)}
          onRemove={() => patch({ triggers: s.triggers.filter((x) => x.key !== t.key) })} />
      ))}
      <button onClick={addTrigger}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
        style={{ color: "#3fb06c", border: "1px dashed rgba(63,176,108,0.35)", background: "rgba(63,176,108,0.04)" }}>
        <Plus className="w-4 h-4" /> Adicionar gatilho
      </button>
    </div>
  );
}

// ── Step 3 — Recipients ───────────────────────────────────────────────────────

interface InvRow {
  invoiceId: string; contactId: string; contactName: string; contactPhone: string;
  vencimento: string; valor: number | null; numeroNf: string | null; codigoBarras: string | null; status: string;
}

function Step3({ s, patch, workspaceId }: { s: WState; patch: (p: Partial<WState>) => void; workspaceId: string }) {
  const [rows,      setRows]      = useState<InvRow[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [search,    setSearch]    = useState("");
  const [sortDir,   setSortDir]   = useState<"asc"|"desc">("asc");
  const [sortField, setSortField] = useState<"vencimento"|"valor"|"name">("vencimento");
  const [selected,  setSelected]  = useState<Set<string>>(
    () => new Set(s.selectedRecipients.map((r) => r.invoice_id ?? r.contact_id))
  );
  const db = supabase as any;

  const fetchRows = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const { data } = await db
      .from("inbox_contacts")
      .select("id, name, phone, contact_invoices(id, valor, vencimento, status, numero_nf, codigo_barras)")
      .eq("workspace_id", workspaceId)
      .order("name")
      .limit(500);
    const built: InvRow[] = [];
    for (const c of (data ?? [])) {
      for (const inv of (c.contact_invoices ?? [])) {
        if (!PENDING_STATUSES.includes(inv.status ?? "")) continue;
        built.push({ invoiceId: inv.id, contactId: c.id, contactName: c.name ?? c.phone ?? "-",
          contactPhone: c.phone ?? "-", vencimento: inv.vencimento, valor: inv.valor,
          numeroNf: inv.numero_nf ?? null, codigoBarras: inv.codigo_barras ?? null, status: inv.status });
      }
    }
    setRows(built);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Sync to wizard state
  useEffect(() => {
    const sel = rows.filter((r) => selected.has(r.invoiceId)).map((r): RecipientDraft => ({
      contact_id: r.contactId, invoice_id: r.invoiceId, contact_name: r.contactName,
      contact_phone: r.contactPhone, vencimento: r.vencimento, valor: r.valor,
      numero_nf: r.numeroNf, codigo_barras: r.codigoBarras,
    }));
    patch({ selectedRecipients: sel });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const q        = search.toLowerCase();
  const filtered = rows.filter((r) => !q || r.contactName.toLowerCase().includes(q) || r.contactPhone.includes(q));
  const sorted   = [...filtered].sort((a, b) => {
    const cmp = sortField === "vencimento" ? a.vencimento.localeCompare(b.vencimento)
      : sortField === "valor" ? (a.valor ?? 0) - (b.valor ?? 0)
      : a.contactName.localeCompare(b.contactName);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const allChecked = sorted.length > 0 && sorted.every((r) => selected.has(r.invoiceId));

  function toggleAll() {
    const next = new Set(selected);
    if (allChecked) sorted.forEach((r) => next.delete(r.invoiceId));
    else            sorted.forEach((r) => next.add(r.invoiceId));
    setSelected(next);
  }

  function toggleRow(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  function handleSort(f: typeof sortField) {
    if (sortField === f) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(f); setSortDir("asc"); }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-agro-muted-2" />
          <input className="input-agro w-full pl-9 text-sm" placeholder="Buscar nome ou telefone..."
            value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-agro-muted hover:text-white"><X className="w-3.5 h-3.5" /></button>}
        </div>
        <span className="text-xs text-agro-muted shrink-0">{selected.size} selecionados de {filtered.length}</span>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.12)" }}>
        <div className="grid px-4 py-2.5 text-[10px] font-bold text-agro-muted uppercase tracking-widest"
          style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.1)",
            gridTemplateColumns: "28px 1fr 120px 100px 80px" }}>
          <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-agro-green cursor-pointer" />
          <button className="flex items-center gap-1 text-left hover:text-white" onClick={() => handleSort("name")}>Nome <ArrowUpDown className="w-2.5 h-2.5" /></button>
          <button className="flex items-center gap-1 hover:text-white" onClick={() => handleSort("vencimento")}>Vencimento <ArrowUpDown className="w-2.5 h-2.5" /></button>
          <button className="flex items-center gap-1 justify-end hover:text-white w-full" onClick={() => handleSort("valor")}>Valor <ArrowUpDown className="w-2.5 h-2.5" /></button>
          <span className="text-right">Status</span>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
          {loading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-agro-green" /></div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <p className="text-sm text-agro-muted">Nenhum boleto pendente encontrado</p>
              <p className="text-xs text-agro-muted/60">Status: {PENDING_STATUSES.join(", ")}</p>
            </div>
          ) : sorted.map((r, i) => {
            const chk    = selected.has(r.invoiceId);
            const isVenc = r.vencimento < today;
            return (
              <div key={r.invoiceId} onClick={() => toggleRow(r.invoiceId)}
                className="grid items-center px-4 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
                style={{ gridTemplateColumns: "28px 1fr 120px 100px 80px",
                  borderBottom: i < sorted.length - 1 ? "1px solid rgba(63,176,108,0.05)" : "none",
                  background: chk ? "rgba(63,176,108,0.04)" : undefined }}>
                <input type="checkbox" checked={chk} onChange={() => toggleRow(r.invoiceId)} className="accent-agro-green cursor-pointer" onClick={(e) => e.stopPropagation()} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-agro-text truncate">{r.contactName}</p>
                  <p className="text-[10px] text-agro-muted-2 truncate">{r.contactPhone}</p>
                </div>
                <p className="text-xs" style={{ color: isVenc ? "#f87171" : "#7fc49a" }}>
                  {r.vencimento.slice(8,10)}/{r.vencimento.slice(5,7)}/{r.vencimento.slice(0,4)}
                </p>
                <p className="text-xs font-semibold text-agro-text text-right">{fmtBRL(r.valor)}</p>
                <p className="text-[10px] text-right" style={{ color: isVenc ? "#f87171" : "#fbbf24" }}>{r.status}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Step 4 — Review ───────────────────────────────────────────────────────────

function Step4({ s, onSave, saving }: { s: WState; onSave: (st: "draft"|"active") => void; saving: boolean }) {
  const triggers = [...s.triggers].filter((t) => t.enabled).sort((a, b) => a.day_offset - b.day_offset);
  const C        = { before: "#60a5fa", same: "#3fb06c", after: "#f87171" };
  return (
    <div className="space-y-5 max-w-2xl">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Canal",           value: s.channel === "z_api" ? "Z-API" : "Meta" },
          { label: "Horario",         value: `${String(s.send_hour).padStart(2,"0")}:00` },
          { label: "Gatilhos ativos", value: String(triggers.length) },
          { label: "Destinatarios",   value: String(s.selectedRecipients.length) },
        ].map(({ label, value }) => (
          <div key={label} className="p-3 rounded-xl text-center"
            style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.12)" }}>
            <p className="text-lg font-bold text-agro-green">{value}</p>
            <p className="text-[10px] text-agro-muted mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-[10px] font-bold text-agro-muted uppercase tracking-widest mb-2">Gatilhos</p>
        <div className="space-y-1.5">
          {triggers.map((t) => {
            const dir = t.day_offset < 0 ? "before" : t.day_offset === 0 ? "same" : "after";
            return (
              <div key={t.key} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(63,176,108,0.08)" }}>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: `${C[dir]}18`, color: C[dir], border: `1px solid ${C[dir]}35` }}>
                  {t.label}
                </span>
                <p className="text-xs text-agro-muted truncate flex-1">
                  {s.template_mode === "unified" ? "(mensagem unica da etapa 1)" : t.message_body || "(sem mensagem)"}
                </p>
              </div>
            );
          })}
          {triggers.length === 0 && <p className="text-xs text-red-400">Nenhum gatilho ativo.</p>}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold text-agro-muted uppercase tracking-widest mb-2">Destinatarios ({s.selectedRecipients.length})</p>
        {s.selectedRecipients.length === 0 ? (
          <p className="text-xs text-red-400">Nenhum destinatario selecionado.</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {s.selectedRecipients.slice(0, 50).map((r) => (
              <div key={r.invoice_id ?? r.contact_id}
                className="flex items-center gap-3 text-xs px-3 py-1.5 rounded-lg"
                style={{ background: "rgba(0,0,0,0.15)", border: "1px solid rgba(63,176,108,0.06)" }}>
                <span className="font-semibold text-agro-text truncate flex-1">{r.contact_name}</span>
                <span className="text-agro-muted-2 shrink-0">{r.vencimento.slice(8,10)}/{r.vencimento.slice(5,7)}</span>
                <span className="text-agro-text shrink-0">{fmtBRL(r.valor)}</span>
              </div>
            ))}
            {s.selectedRecipients.length > 50 && (
              <p className="text-[11px] text-agro-muted px-3">+ {s.selectedRecipients.length - 50} mais...</p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button onClick={() => onSave("draft")} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
          style={{ color: "#7fc49a", border: "1px solid rgba(63,176,108,0.3)", background: "rgba(63,176,108,0.06)" }}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar rascunho
        </button>
        <button onClick={() => onSave("active")}
          disabled={saving || triggers.length === 0 || s.selectedRecipients.length === 0}
          className="btn-agro flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Ativar regua
        </button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function AutomationWizard() {
  const navigate        = useNavigate();
  const { id: ruleId }  = useParams<{ id?: string }>();
  const { toast }       = useToast();
  const { workspaceId } = useAuth();
  const wsId            = workspaceId ?? "";
  const db              = supabase as any;

  const [s,       setS]       = useState<WState>(INIT);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(!!ruleId);

  const { connections: zApiConns } = useZApiConnections(wsId);
  const { connections: metaConns } = useMetaConnections(wsId);

  function patch(p: Partial<WState>) { setS((prev) => ({ ...prev, ...p })); }

  // Load for edit mode
  useEffect(() => {
    if (!ruleId || !wsId) { setLoading(false); return; }
    Promise.all([
      db.from("automation_rules").select("*").eq("id", ruleId).single(),
      db.from("automation_triggers").select("*").eq("rule_id", ruleId).order("day_offset"),
      db.from("automation_recipients").select("*").eq("rule_id", ruleId).eq("removed", false),
    ]).then(([ruleRes, trigRes, recRes]: any[]) => {
      if (ruleRes.error || !ruleRes.data) { navigate("/automations"); return; }
      const rule = ruleRes.data;
      setS({
        step: 1, name: rule.name, channel: rule.channel,
        z_api_connection_id: rule.z_api_connection_id ?? "", meta_connection_id: rule.meta_connection_id ?? "",
        send_hour: rule.send_hour, template_mode: rule.template_mode, unified_message: rule.unified_message ?? "",
        triggers: (trigRes.data ?? []).map((t: any): TriggerDraft => ({
          key: crypto.randomUUID(), day_offset: t.day_offset, label: t.label ?? trigLabel(t.day_offset),
          channel: t.channel ?? null, z_api_connection_id: t.z_api_connection_id ?? null,
          z_api_template_id: t.z_api_template_id ?? null, meta_connection_id: t.meta_connection_id ?? null,
          meta_template_id: t.meta_template_id ?? null, column_mapping: t.column_mapping ?? {},
          message_body: t.message_body ?? "", enabled: t.enabled,
        })),
        selectedRecipients: (recRes.data ?? []).map((r: any): RecipientDraft => ({
          contact_id: r.contact_id, invoice_id: r.invoice_id, contact_name: r.contact_name,
          contact_phone: r.contact_phone, vencimento: r.vencimento, valor: r.valor,
          numero_nf: r.numero_nf, codigo_barras: r.codigo_barras,
        })),
      });
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleId, wsId]);

  function canProceed(): boolean {
    if (s.step === 1) return s.name.trim().length > 0 && (s.channel === "z_api" ? !!s.z_api_connection_id : !!s.meta_connection_id);
    if (s.step === 2) return s.triggers.filter((t) => t.enabled).length > 0;
    if (s.step === 3) return s.selectedRecipients.length > 0;
    return true;
  }

  async function handleSave(status: "draft" | "active") {
    setSaving(true);
    try {
      const basePayload = {
        workspace_id:        wsId,
        name:                s.name.trim(),
        status,
        send_hour:           s.send_hour,
        channel:             s.channel,
        z_api_connection_id: s.channel === "z_api" ? s.z_api_connection_id || null : null,
        meta_connection_id:  s.channel === "meta"  ? s.meta_connection_id  || null : null,
        template_mode:       s.template_mode,
        unified_message:     s.template_mode === "unified" ? s.unified_message || null : null,
        total_recipients:    s.selectedRecipients.length,
        updated_at:          new Date().toISOString(),
      };

      let savedId = ruleId;

      if (ruleId) {
        // Edit mode: preserve sent_count (it reflects real dispatch history)
        const { error } = await db.from("automation_rules").update(basePayload).eq("id", ruleId);
        if (error) throw error;
        await db.from("automation_triggers").delete().eq("rule_id", ruleId);
        await db.from("automation_recipients").delete().eq("rule_id", ruleId);
      } else {
        const { data, error } = await db.from("automation_rules").insert({ ...basePayload, sent_count: 0 }).select("id").single();
        if (error || !data) throw error ?? new Error("Erro ao criar regua");
        savedId = data.id;
      }

      if (s.triggers.length > 0) {
        const { error } = await db.from("automation_triggers").insert(
          s.triggers.map((t) => ({
            rule_id: savedId, workspace_id: wsId, day_offset: t.day_offset, label: t.label,
            channel: t.channel, z_api_connection_id: t.z_api_connection_id || null,
            z_api_template_id: t.z_api_template_id || null, meta_connection_id: t.meta_connection_id || null,
            meta_template_id: t.meta_template_id || null, column_mapping: t.column_mapping,
            message_body: t.message_body || null, enabled: t.enabled,
          }))
        );
        if (error) throw error;
      }

      for (let i = 0; i < s.selectedRecipients.length; i += 100) {
        const { error } = await db.from("automation_recipients").insert(
          s.selectedRecipients.slice(i, i + 100).map((r) => ({
            rule_id: savedId, workspace_id: wsId, contact_id: r.contact_id, invoice_id: r.invoice_id,
            contact_name: r.contact_name, contact_phone: r.contact_phone, vencimento: r.vencimento,
            valor: r.valor, numero_nf: r.numero_nf, codigo_barras: r.codigo_barras, removed: false,
          }))
        );
        if (error) throw error;
      }

      await db.from("automation_rules").update({ total_recipients: s.selectedRecipients.length }).eq("id", savedId);
      toast({ title: status === "active" ? "Regua ativada!" : "Rascunho salvo", variant: "success" });
      navigate(`/automations/${savedId}`);
    } catch (err) {
      toast({ title: "Erro ao salvar", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const isEdit = !!ruleId;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a110e" }}>
        <Loader2 className="w-6 h-6 animate-spin text-agro-green" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[
        { label: "Automacoes", href: "/automations" },
        { label: isEdit ? "Editar Regua" : "Nova Regua" },
      ]} />
      <StepBar step={s.step} />

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl mx-auto">
          {s.step === 1 && <Step1 s={s} patch={patch} zApiConns={zApiConns} metaConns={metaConns} />}
          {s.step === 2 && <Step2 s={s} patch={patch} />}
          {s.step === 3 && <Step3 s={s} patch={patch} workspaceId={wsId} />}
          {s.step === 4 && <Step4 s={s} onSave={handleSave} saving={saving} />}
        </div>
      </div>

      <div className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderTop: "1px solid rgba(63,176,108,0.1)", background: "rgba(10,17,14,0.8)" }}>
        <button
          onClick={() => s.step > 1 ? patch({ step: (s.step - 1) as WState["step"] }) : navigate("/automations")}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-agro-muted hover:text-white transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
          <ChevronLeft className="w-4 h-4" />
          {s.step === 1 ? "Cancelar" : "Voltar"}
        </button>
        <span className="text-xs text-agro-muted">Etapa {s.step} de 4</span>
        {s.step < 4 ? (
          <button onClick={() => patch({ step: (s.step + 1) as WState["step"] })}
            disabled={!canProceed()}
            className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40">
            Proximo <ChevronRight className="w-4 h-4" />
          </button>
        ) : <span />}
      </div>
    </div>
  );
}
