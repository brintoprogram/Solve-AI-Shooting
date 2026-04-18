import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, Target, Users, Braces, ChevronLeft, ChevronRight,
  Search, Check, Tag, Loader2, Eye, ArrowRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useMetaTemplates } from "@/hooks/useMetaTemplates";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { useToast } from "@/hooks/use-toast";
import { getWorkspaceId } from "@/lib/config";
import { cn } from "@/lib/utils";
import type { MetaTemplate } from "@/types/shooting";
import type { Contact } from "@/pages/contacts/ContactPanel";

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const WORKSPACE_ID = getWorkspaceId();
const PAGE = 40;

const CONTACT_FIELDS: { value: keyof Contact | string; label: string }[] = [
  { value: "name",                label: "Nome" },
  { value: "phone",               label: "Telefone" },
  { value: "cpf_cnpj",           label: "CPF / CNPJ" },
  { value: "empresa",             label: "Empresa" },
  { value: "email",               label: "E-mail" },
  { value: "nome_representante",  label: "Representante" },
  { value: "cidade",              label: "Cidade" },
  { value: "estado",              label: "Estado" },
];

const STEPS = [
  { id: 1, label: "Setup",       subtitle: "Nome & template", Icon: Target  },
  { id: 2, label: "Público",     subtitle: "Quem vai receber", Icon: Users  },
  { id: 3, label: "Variáveis",   subtitle: "Mapeamento & envio", Icon: Braces },
];

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function bodyVars(tpl: MetaTemplate): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: string = (tpl.components as any[]).find((c) => c.type === "BODY")?.text ?? "";
  const seen = new Set<string>();
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) seen.add(m[1]);
  return [...seen].sort((a, b) => Number(a) - Number(b));
}

function renderPreview(tpl: MetaTemplate, contact: Contact, map: Record<string, string>): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let text: string = (tpl.components as any[]).find((c) => c.type === "BODY")?.text ?? "";
  for (const [idx, field] of Object.entries(map)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (contact as any)[field] ?? `{{${idx}}}`;
    text = text.replaceAll(`{{${idx}}}`, String(val));
  }
  return text;
}

// ─────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CampaignBuilder({ open, onClose, onCreated }: Props) {
  const { toast }  = useToast();
  const { connections } = useMetaConnections(WORKSPACE_ID);
  const [connId, setConnId]  = useState("");

  // Derive connection id: use selected or first active
  const effectiveConnId = connId || connections.find((c) => c.status === "active")?.id || connections[0]?.id || "";

  const { approvedTemplates } = useMetaTemplates(WORKSPACE_ID, effectiveConnId || undefined);

  // ── Wizard state ──────────────────────────────────────
  const [step,       setStep]       = useState<1|2|3>(1);
  const [name,       setName]       = useState("");
  const [templateId, setTemplateId] = useState("");
  const [selTags,    setSelTags]    = useState<string[]>([]);
  const [search,     setSearch]     = useState("");
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [contacts,   setContacts]   = useState<Contact[]>([]);
  const [allTags,    setAllTags]    = useState<string[]>([]);
  const [totalContacts, setTotal]   = useState(0);
  const [loadingC,   setLoadingC]   = useState(false);
  const [varMap,     setVarMap]     = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedTpl = approvedTemplates.find((t) => t.id === templateId);
  const vars        = selectedTpl ? bodyVars(selectedTpl) : [];
  const firstSel    = contacts.find((c) => selected.has(c.id));

  // ── Reset on open ─────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep(1); setName(""); setTemplateId(""); setConnId("");
    setSelTags([]); setSearch(""); setSelected(new Set());
    setContacts([]); setAllTags([]); setVarMap({});
  }, [open]);

  // ── Load unique tags ──────────────────────────────────
  useEffect(() => {
    if (step !== 2) return;
    db.from("inbox_contacts")
      .select("tags")
      .eq("workspace_id", WORKSPACE_ID)
      .then(({ data }: { data: { tags: string[] }[] | null }) => {
        const flat = (data ?? []).flatMap((r) => r.tags ?? []);
        setAllTags([...new Set(flat)].sort());
      });
  }, [step]);

  // ── Load contacts (debounced) ─────────────────────────
  const loadContacts = useCallback(async () => {
    setLoadingC(true);
    let q = db
      .from("inbox_contacts")
      .select("*", { count: "exact" })
      .eq("workspace_id", WORKSPACE_ID)
      .order("name")
      .limit(PAGE);

    if (search.trim()) {
      const s = search.trim();
      q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,empresa.ilike.%${s}%`);
    }
    if (selTags.length > 0) {
      q = q.overlaps("tags", selTags);
    }

    const { data, count } = await q;
    setContacts(data ?? []);
    setTotal(count ?? 0);
    setLoadingC(false);
  }, [search, selTags]);

  useEffect(() => {
    if (step !== 2) return;
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(loadContacts, 250);
  }, [step, loadContacts]);

  // ── Derived canProceed ────────────────────────────────
  function canNext(): boolean {
    if (step === 1) return name.trim().length > 0 && !!templateId;
    if (step === 2) return selected.size > 0;
    if (step === 3) return vars.every((v) => !!varMap[v]);
    return false;
  }

  // ── Tag toggle ────────────────────────────────────────
  function toggleTag(tag: string) {
    setSelTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
    setSelected(new Set()); // reset selection when filter changes
  }

  // ── Contact toggle ────────────────────────────────────
  function toggleContact(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (contacts.every((c) => selected.has(c.id))) {
      // deselect page
      setSelected((prev) => {
        const next = new Set(prev);
        contacts.forEach((c) => next.delete(c.id));
        return next;
      });
    } else {
      // select page
      setSelected((prev) => {
        const next = new Set(prev);
        contacts.forEach((c) => next.add(c.id));
        return next;
      });
    }
  }

  // ── Submit ────────────────────────────────────────────
  async function handleSubmit() {
    if (!selectedTpl || !effectiveConnId) return;
    setSubmitting(true);
    try {
      // 1. Fetch full data of selected contacts
      const { data: selContacts, error: selErr } = await db
        .from("inbox_contacts")
        .select("*")
        .in("id", [...selected]);

      if (selErr) throw new Error(selErr.message);

      // 2. Create campaign
      const { data: campaign, error: campErr } = await db
        .from("shooting_campaigns")
        .insert({
          workspace_id:       WORKSPACE_ID,
          meta_connection_id: effectiveConnId,
          name:               name.trim(),
          template_id:        templateId,
          data_source:        "contacts",
          column_mapping:     { phone_column: "phone", body_variables: varMap },
          filters:            { tags: selTags },
          total_recipients:   selected.size,
          status:             "draft",
          sending_speed:      80,
          error_summary:      {},
          created_by:         null,
          started_at:         null,
          completed_at:       null,
          scheduled_at:       null,
        })
        .select()
        .single();

      if (campErr) throw new Error(campErr.message);

      // 3. Insert shooting_messages in chunks
      const messages = (selContacts as Contact[]).map((c) => ({
        campaign_id:     campaign.id,
        workspace_id:    WORKSPACE_ID,
        recipient_phone: c.phone ?? "",
        recipient_name:  c.name ?? "",
        recipient_data:  c,
        status:          "pending",
        retry_count:     0,
        max_retries:     3,
      }));

      for (let i = 0; i < messages.length; i += 500) {
        const { error: msgErr } = await db
          .from("shooting_messages")
          .insert(messages.slice(i, i + 500));
        if (msgErr) throw new Error(msgErr.message);
      }

      toast({ title: "Campanha criada!", description: `${selected.size} destinatários prontos para disparo.`, variant: "success" });
      onCreated();
      onClose();
    } catch (err) {
      toast({ title: "Erro ao criar campanha", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  // ─────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
        style={{
          background: "#0d1a11",
          border: "1px solid rgba(63,176,108,0.18)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 4px 20px rgba(0,0,0,0.4)",
        }}
      >
        {/* Top accent */}
        <div className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(63,176,108,0.5), transparent)" }}
        />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
        >
          <div>
            <h2 className="font-display text-lg font-bold text-agro-text">Nova Campanha</h2>
            <p className="text-xs text-agro-muted">Disparo via WhatsApp Business API</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-red-400 hover:bg-red-400/10 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 px-6 py-4"
          style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
        >
          {STEPS.map((s, i) => {
            const done   = step > s.id;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex items-center flex-1">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-all",
                    done   ? "bg-agro-green text-white"
                    : active ? "text-agro-green"
                    : "text-agro-muted-2"
                  )}
                    style={active ? { background: "rgba(63,176,108,0.15)", border: "1.5px solid #3fb06c" }
                      : done ? {} : { background: "rgba(255,255,255,0.04)", border: "1.5px solid rgba(63,176,108,0.12)" }}
                  >
                    {done ? <Check className="w-3.5 h-3.5" /> : <s.Icon className="w-3.5 h-3.5" />}
                  </div>
                  <div className={cn("hidden sm:block", !active && !done && "opacity-40")}>
                    <p className={cn("text-xs font-semibold leading-none", active ? "text-agro-text" : "text-agro-muted")}>{s.label}</p>
                    <p className="text-[10px] text-agro-muted-2 mt-0.5">{s.subtitle}</p>
                  </div>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="flex-1 mx-3 h-px rounded-full"
                    style={{ background: step > s.id ? "#3fb06c" : "rgba(63,176,108,0.12)" }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Step body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {step === 1 && (
            <Step1Setup
              name={name} setName={setName}
              templateId={templateId} setTemplateId={setTemplateId}
              templates={approvedTemplates}
              connections={connections}
              connId={effectiveConnId}
              onConnChange={setConnId}
            />
          )}
          {step === 2 && (
            <Step2Audience
              allTags={allTags}
              selTags={selTags} toggleTag={toggleTag}
              contacts={contacts}
              totalContacts={totalContacts}
              selected={selected}
              toggleContact={toggleContact}
              toggleAll={toggleAll}
              search={search} setSearch={setSearch}
              loading={loadingC}
            />
          )}
          {step === 3 && selectedTpl && (
            <Step3Variables
              template={selectedTpl}
              vars={vars}
              varMap={varMap}
              setVarMap={setVarMap}
              previewContact={firstSel ?? null}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderTop: "1px solid rgba(63,176,108,0.08)", background: "rgba(10,17,14,0.6)" }}
        >
          <button
            onClick={() => step === 1 ? onClose() : setStep((s) => (s - 1) as 1 | 2 | 3)}
            className="flex items-center gap-1.5 text-sm text-agro-muted hover:text-agro-text transition-colors px-3 py-2 rounded-lg hover:bg-white/5"
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 1 ? "Cancelar" : "Voltar"}
          </button>

          {step < 3 ? (
            <button
              disabled={!canNext()}
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              className={cn(
                "flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all",
                canNext() ? "btn-agro" : "opacity-30 cursor-not-allowed"
              )}
              style={!canNext() ? { background: "rgba(63,176,108,0.15)", border: "1px solid rgba(63,176,108,0.1)" } : undefined}
            >
              Próximo
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              disabled={!canNext() || submitting}
              onClick={handleSubmit}
              className={cn(
                "flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all",
                canNext() && !submitting ? "btn-agro" : "opacity-30 cursor-not-allowed"
              )}
              style={(!canNext() || submitting) ? { background: "rgba(63,176,108,0.15)", border: "1px solid rgba(63,176,108,0.1)" } : undefined}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {submitting ? "Criando..." : "Criar campanha"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Step 1 — Setup: name + connection + template
// ─────────────────────────────────────────────────────────

function Step1Setup({
  name, setName, templateId, setTemplateId, templates, connections, connId, onConnChange,
}: {
  name: string; setName: (v: string) => void;
  templateId: string; setTemplateId: (v: string) => void;
  templates: MetaTemplate[];
  connections: { id: string; display_phone: string; business_name: string | null; status: string }[];
  connId: string;
  onConnChange: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Campaign name */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
          Nome da campanha *
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Cobrança abril — clientes PJ"
          className="w-full px-4 py-2.5 rounded-xl text-sm text-agro-text placeholder:text-agro-muted-2 focus:outline-none transition-all"
          style={{
            background: "rgba(13,26,17,0.6)",
            border: "1px solid rgba(63,176,108,0.15)",
          }}
          onFocus={(e) => { e.target.style.borderColor = "#3fb06c"; }}
          onBlur={(e)  => { e.target.style.borderColor = "rgba(63,176,108,0.15)"; }}
        />
      </div>

      {/* Connection (if multiple) */}
      {connections.length > 1 && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
            Número WhatsApp
          </label>
          <div className="flex flex-col gap-2">
            {connections.map((c) => (
              <button
                key={c.id}
                onClick={() => onConnChange(c.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-left transition-all",
                  connId === c.id ? "text-agro-text" : "text-agro-muted hover:text-agro-text"
                )}
                style={{
                  background: connId === c.id ? "rgba(63,176,108,0.1)" : "rgba(13,26,17,0.4)",
                  border: connId === c.id ? "1px solid rgba(63,176,108,0.3)" : "1px solid rgba(63,176,108,0.08)",
                }}
              >
                <div className={cn("w-2 h-2 rounded-full shrink-0", c.status === "active" ? "bg-agro-green" : "bg-red-400")} />
                <span className="font-medium">{c.display_phone}</span>
                {c.business_name && <span className="text-agro-muted-2 text-xs">· {c.business_name}</span>}
                {connId === c.id && <Check className="w-3.5 h-3.5 ml-auto text-agro-green shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Template picker */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
          Template aprovado *
        </label>
        {templates.length === 0 ? (
          <div className="px-4 py-6 rounded-xl text-center"
            style={{ background: "rgba(13,26,17,0.4)", border: "1px solid rgba(63,176,108,0.08)" }}
          >
            <p className="text-sm text-agro-muted">Nenhum template aprovado encontrado.</p>
            <p className="text-xs text-agro-muted-2 mt-1">Sincronize os templates em Templates → Sincronizar Meta.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
            {templates.map((tpl) => {
              const sel = templateId === tpl.id;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const bodyText = (tpl.components as any[]).find((c) => c.type === "BODY")?.text ?? "";
              return (
                <button
                  key={tpl.id}
                  onClick={() => setTemplateId(tpl.id)}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 rounded-xl text-left transition-all",
                    sel ? "text-agro-text" : "text-agro-muted hover:text-agro-text"
                  )}
                  style={{
                    background: sel ? "rgba(63,176,108,0.1)" : "rgba(13,26,17,0.4)",
                    border: sel ? "1px solid rgba(63,176,108,0.3)" : "1px solid rgba(63,176,108,0.08)",
                  }}
                >
                  <div className={cn("w-4 h-4 rounded shrink-0 mt-0.5 flex items-center justify-center border transition-all",
                    sel ? "bg-agro-green border-agro-green" : "border-agro-muted-2"
                  )}>
                    {sel && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-agro-text leading-none">{tpl.template_name}</p>
                    <p className="text-xs text-agro-muted mt-1 line-clamp-2 leading-relaxed">{bodyText}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ background: "rgba(63,176,108,0.1)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.2)" }}>
                        {tpl.language}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ background: "rgba(255,255,255,0.05)", color: "#9ca3af", border: "1px solid rgba(255,255,255,0.08)" }}>
                        {tpl.category}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Step 2 — Audience: tags + contacts
// ─────────────────────────────────────────────────────────

function Step2Audience({
  allTags, selTags, toggleTag,
  contacts, totalContacts, selected, toggleContact, toggleAll,
  search, setSearch, loading,
}: {
  allTags: string[]; selTags: string[]; toggleTag: (t: string) => void;
  contacts: Contact[]; totalContacts: number; selected: Set<string>;
  toggleContact: (id: string) => void; toggleAll: () => void;
  search: string; setSearch: (s: string) => void; loading: boolean;
}) {
  const allOnPage = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  return (
    <div className="space-y-5">
      {/* Counter badge */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">Destinatários</p>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold"
          style={{
            background: selected.size > 0 ? "rgba(63,176,108,0.15)" : "rgba(255,255,255,0.05)",
            border:     selected.size > 0 ? "1px solid rgba(63,176,108,0.3)" : "1px solid rgba(255,255,255,0.08)",
            color:      selected.size > 0 ? "#3fb06c" : "#6b7280",
          }}
        >
          {selected.size > 0 ? `${selected.size} selecionado${selected.size !== 1 ? "s" : ""}` : "Nenhum selecionado"}
        </div>
      </div>

      {/* Tag filters */}
      {allTags.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-agro-muted flex items-center gap-1.5">
            <Tag className="w-3 h-3" /> Filtrar por tag
          </p>
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((tag) => {
              const active = selTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className="px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                  style={{
                    background: active ? "rgba(63,176,108,0.18)" : "rgba(255,255,255,0.04)",
                    border:     active ? "1px solid rgba(63,176,108,0.4)" : "1px solid rgba(255,255,255,0.08)",
                    color:      active ? "#3fb06c" : "#9ca3af",
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-agro-muted-2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, telefone ou empresa..."
          className="w-full pl-9 pr-4 py-2 rounded-xl text-sm text-agro-text placeholder:text-agro-muted-2 focus:outline-none transition-all"
          style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.12)" }}
          onFocus={(e) => { e.target.style.borderColor = "#3fb06c"; }}
          onBlur={(e)  => { e.target.style.borderColor = "rgba(63,176,108,0.12)"; }}
        />
      </div>

      {/* Contact table */}
      <div className="rounded-xl overflow-hidden"
        style={{ border: "1px solid rgba(63,176,108,0.1)" }}
      >
        {/* Table header */}
        <div className="flex items-center gap-3 px-4 py-2.5"
          style={{ background: "rgba(13,26,17,0.8)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}
        >
          <button onClick={toggleAll} className={cn(
            "w-4 h-4 rounded flex items-center justify-center border transition-all shrink-0",
            allOnPage ? "bg-agro-green border-agro-green" : "border-agro-muted-2 hover:border-agro-green"
          )}>
            {allOnPage && <Check className="w-2.5 h-2.5 text-white" />}
          </button>
          <span className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest flex-1">
            Nome
          </span>
          <span className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest w-32 hidden sm:block">
            Telefone
          </span>
          <span className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest w-28 hidden md:block">
            Tags
          </span>
        </div>

        {/* Rows */}
        <div className="max-h-56 overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-agro-green animate-spin" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="py-10 text-center text-sm text-agro-muted">
              Nenhum contato encontrado
            </div>
          ) : (
            contacts.map((c) => {
              const sel = selected.has(c.id);
              return (
                <div
                  key={c.id}
                  onClick={() => toggleContact(c.id)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors",
                    sel ? "bg-agro-green/5" : "hover:bg-white/3"
                  )}
                  style={{ borderBottom: "1px solid rgba(63,176,108,0.05)" }}
                >
                  <div className={cn(
                    "w-4 h-4 rounded flex items-center justify-center border transition-all shrink-0",
                    sel ? "bg-agro-green border-agro-green" : "border-agro-muted-2"
                  )}>
                    {sel && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <span className="text-sm text-agro-text flex-1 truncate">{c.name ?? "—"}</span>
                  <span className="text-xs text-agro-muted w-32 hidden sm:block truncate">{c.phone ?? "—"}</span>
                  <div className="w-28 hidden md:flex flex-wrap gap-1">
                    {(c.tags ?? []).slice(0, 2).map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ background: "rgba(63,176,108,0.1)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.2)" }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer count */}
        <div className="px-4 py-2 text-xs text-agro-muted-2"
          style={{ background: "rgba(13,26,17,0.6)", borderTop: "1px solid rgba(63,176,108,0.06)" }}
        >
          {selTags.length > 0 || search
            ? `${totalContacts} contatos encontrados`
            : `${totalContacts} contatos na base`}
          {totalContacts > PAGE && ` · mostrando ${PAGE}`}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Step 3 — Variables: map {{n}} → contact field + preview
// ─────────────────────────────────────────────────────────

function Step3Variables({
  template, vars, varMap, setVarMap, previewContact,
}: {
  template: MetaTemplate;
  vars: string[];
  varMap: Record<string, string>;
  setVarMap: (m: Record<string, string>) => void;
  previewContact: Contact | null;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyText: string = (template.components as any[]).find((c) => c.type === "BODY")?.text ?? "";

  function setVar(idx: string, field: string) {
    setVarMap({ ...varMap, [idx]: field });
  }

  const preview = previewContact ? renderPreview(template, previewContact, varMap) : null;

  return (
    <div className="space-y-6">
      {vars.length === 0 ? (
        <div className="px-5 py-8 rounded-xl text-center"
          style={{ background: "rgba(63,176,108,0.04)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <Check className="w-8 h-8 text-agro-green mx-auto mb-3" />
          <p className="text-sm font-semibold text-agro-text">Template sem variáveis</p>
          <p className="text-xs text-agro-muted mt-1">A mensagem será enviada exatamente como está no template.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
            Mapeamento de variáveis
          </p>
          <p className="text-xs text-agro-muted">
            Cada <span className="font-mono px-1 rounded text-amber-400" style={{ background: "rgba(245,158,11,0.1)" }}>{"{{variável}}"}</span> será preenchida com o campo do contato correspondente.
          </p>
          <div className="flex flex-col gap-2.5">
            {vars.map((idx) => (
              <div key={idx} className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}
              >
                <div className="px-2.5 py-1.5 rounded-lg font-mono text-sm font-bold text-amber-400 shrink-0"
                  style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}
                >
                  {`{{${idx}}}`}
                </div>
                <ArrowRight className="w-4 h-4 text-agro-muted-2 shrink-0" />
                <select
                  value={varMap[idx] ?? ""}
                  onChange={(e) => setVar(idx, e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg text-sm text-agro-text focus:outline-none transition-all appearance-none cursor-pointer"
                  style={{
                    background: "rgba(13,26,17,0.8)",
                    border: varMap[idx] ? "1px solid rgba(63,176,108,0.3)" : "1px solid rgba(63,176,108,0.15)",
                    color: varMap[idx] ? "#e2e8f0" : "#6b7280",
                  }}
                >
                  <option value="">— Selecione um campo —</option>
                  {CONTACT_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Template body reference */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest flex items-center gap-1.5">
          <Eye className="w-3 h-3" /> Template original
        </p>
        <div className="px-4 py-3 rounded-xl text-sm text-agro-muted leading-relaxed"
          style={{ background: "rgba(13,26,17,0.4)", border: "1px solid rgba(63,176,108,0.08)", whiteSpace: "pre-wrap" }}
        >
          {bodyText || "—"}
        </div>
      </div>

      {/* Preview with first contact */}
      {preview && previewContact && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest flex items-center gap-1.5">
            <Eye className="w-3 h-3" /> Preview — {previewContact.name ?? previewContact.phone}
          </p>
          <div className="px-4 py-3 rounded-xl text-sm text-agro-text leading-relaxed"
            style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.15)", whiteSpace: "pre-wrap" }}
          >
            {preview}
          </div>
        </div>
      )}
    </div>
  );
}
