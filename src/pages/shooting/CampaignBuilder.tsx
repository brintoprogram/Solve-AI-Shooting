import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, Target, Users, Sliders, ChevronLeft, ChevronRight,
  Search, Check, Tag, Loader2, Eye, ArrowRight,
  Upload, FileSpreadsheet, Database, Gauge, AlertCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useMetaTemplates } from "@/hooks/useMetaTemplates";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import type { MetaTemplate } from "@/types/shooting";
import type { Contact } from "@/pages/contacts/ContactPanel";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface InvoiceRaw {
  valor:         number;
  vencimento:    string | null;
  status:        string;
  numero_nf:     string | null;
  codigo_barras: string | null;
}

// Contact fetched from DB with nested invoices + computed virtual columns
interface ContactWithInvoices extends Contact {
  contact_invoices?:      InvoiceRaw[];
  // Virtual columns (injected by aggregateInvoices)
  valor_total_pendente?:  string;
  proximo_vencimento?:    string;
  boleto_nf?:             string;
  boleto_codigo_barras?:  string;
}

interface FieldGroup {
  label:  string;
  fields: { value: string; label: string }[];
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const PAGE = 50;

const CONTACT_FIELD_GROUP: FieldGroup = {
  label: "Dados do Contato",
  fields: [
    { value: "name",               label: "Nome" },
    { value: "phone",              label: "Telefone" },
    { value: "cpf_cnpj",          label: "CPF / CNPJ" },
    { value: "empresa",            label: "Empresa" },
    { value: "email",              label: "E-mail" },
    { value: "nome_representante", label: "Representante" },
    { value: "cidade",             label: "Cidade" },
    { value: "estado",             label: "Estado" },
  ],
};

const FINANCIAL_FIELD_GROUP: FieldGroup = {
  label: "Dados Financeiros (boletos pendentes)",
  fields: [
    { value: "valor_total_pendente", label: "Valor Total Pendente  (ex: R$ 1.250,00)" },
    { value: "proximo_vencimento",   label: "Próximo Vencimento  (ex: 30/04/2025)" },
    { value: "boleto_nf",            label: "Número da NF / Boleto" },
    { value: "boleto_codigo_barras", label: "Código de Barras" },
  ],
};

// Groups used by the contacts source in Step 3
const CONTACTS_FIELD_GROUPS: FieldGroup[] = [
  CONTACT_FIELD_GROUP,
  FINANCIAL_FIELD_GROUP,
];

const SPEED_OPTIONS = [
  { value: 30,  label: "30/min",  desc: "Conservador" },
  { value: 60,  label: "60/min",  desc: "Moderado" },
  { value: 80,  label: "80/min",  desc: "Padrão" },
  { value: 120, label: "120/min", desc: "Rápido" },
  { value: 200, label: "200/min", desc: "Máximo" },
];

const STEPS = [
  { id: 1, label: "Configuração",   subtitle: "Nome & template",       Icon: Target  },
  { id: 2, label: "Público",        subtitle: "Quem vai receber",      Icon: Users   },
  { id: 3, label: "Personalização", subtitle: "Variáveis & velocidade", Icon: Sliders },
];

// Pending statuses to aggregate
const PENDING_STATUSES = ["pendente", "vencido", "aberto", "em_aberto"];

// ─────────────────────────────────────────────────────────
// Financial aggregation
// ─────────────────────────────────────────────────────────

function aggregateInvoices(contact: ContactWithInvoices): ContactWithInvoices {
  const invoices = (contact.contact_invoices ?? []).filter((inv) =>
    PENDING_STATUSES.includes((inv.status ?? "").toLowerCase())
  );

  if (invoices.length === 0) {
    return {
      ...contact,
      valor_total_pendente:  "R$ 0,00",
      proximo_vencimento:    "",
      boleto_nf:             "",
      boleto_codigo_barras:  "",
    };
  }

  // Sort ascending by vencimento → most urgent first
  const sorted = [...invoices].sort((a, b) => {
    if (!a.vencimento) return 1;
    if (!b.vencimento) return -1;
    return new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime();
  });

  const total      = invoices.reduce((sum, inv) => sum + (Number(inv.valor) || 0), 0);
  const mostUrgent = sorted[0];

  // Format currency pt-BR
  const valorFormatado = total.toLocaleString("pt-BR", {
    style: "currency", currency: "BRL",
  });

  // Format date dd/mm/aaaa (force UTC to avoid timezone shifts)
  let vencimentoFormatado = "";
  if (mostUrgent.vencimento) {
    const [y, m, d] = mostUrgent.vencimento.split("-");
    if (y && m && d) vencimentoFormatado = `${d}/${m}/${y}`;
  }

  return {
    ...contact,
    valor_total_pendente:  valorFormatado,
    proximo_vencimento:    vencimentoFormatado,
    boleto_nf:             mostUrgent.numero_nf     ?? "",
    boleto_codigo_barras:  mostUrgent.codigo_barras ?? "",
  };
}

// ─────────────────────────────────────────────────────────
// CSV helpers
// ─────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const delim = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const vals = line.split(delim).map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

// ─────────────────────────────────────────────────────────
// Template helpers
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

function renderPreview(
  tpl: MetaTemplate,
  data: Record<string, unknown>,
  map: Record<string, string>,
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let text: string = (tpl.components as any[]).find((c) => c.type === "BODY")?.text ?? "";
  for (const [idx, field] of Object.entries(map)) {
    const val = data[field] ?? `{{${idx}}}`;
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
  const { toast }       = useToast();
  const { workspaceId } = useAuth();
  const WORKSPACE_ID = workspaceId ?? "";
  const { connections } = useMetaConnections(WORKSPACE_ID);
  const [connId, setConnId] = useState("");

  const effectiveConnId =
    connId ||
    connections.find((c) => c.status === "active")?.id ||
    connections[0]?.id ||
    "";

  const { approvedTemplates } = useMetaTemplates(WORKSPACE_ID, effectiveConnId || undefined);

  // ── Wizard state ──────────────────────────────────────
  const [step,       setStep]       = useState<1 | 2 | 3>(1);
  const [name,       setName]       = useState("");
  const [templateId, setTemplateId] = useState("");

  // Audience
  const [source,    setSource]   = useState<"contacts" | "csv">("contacts");
  // contacts mode
  const [selTags,   setSelTags]  = useState<string[]>([]);
  const [search,    setSearch]   = useState("");
  const [selected,  setSelected] = useState<Set<string>>(new Set());
  const [contacts,  setContacts] = useState<ContactWithInvoices[]>([]);
  const [allTags,   setAllTags]  = useState<string[]>([]);
  const [totalCount, setTotal]   = useState(0);
  const [loadingC,   setLoadingC] = useState(false);
  // csv mode
  const [csvFile,    setCsvFile]    = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows,    setCsvRows]    = useState<Record<string, string>[]>([]);
  const [csvPhone,   setCsvPhone]   = useState("");
  const [csvError,   setCsvError]   = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Variables & speed
  const [varMap,       setVarMap]       = useState<Record<string, string>>({});
  const [sendingSpeed, setSendingSpeed] = useState(80);
  const [submitting,   setSubmitting]   = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedTpl = approvedTemplates.find((t) => t.id === templateId);
  const vars        = selectedTpl ? bodyVars(selectedTpl) : [];

  // Field groups passed to Step3 (depends on source)
  const fieldGroups: FieldGroup[] =
    source === "contacts"
      ? CONTACTS_FIELD_GROUPS
      : [{ label: "Colunas da planilha", fields: csvHeaders.map((h) => ({ value: h, label: h })) }];

  // First selected item for preview
  const previewData: Record<string, unknown> | null =
    source === "contacts"
      ? (contacts.find((c) => selected.has(c.id)) as Record<string, unknown> | undefined) ?? null
      : csvRows[0] ?? null;

  const totalRecipients =
    source === "contacts" ? selected.size : csvRows.length;

  // ── Reset on open ─────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep(1); setName(""); setTemplateId(""); setConnId("");
    setSource("contacts");
    setSelTags([]); setSearch(""); setSelected(new Set());
    setContacts([]); setAllTags([]); setVarMap({}); setSendingSpeed(80);
    setCsvFile(null); setCsvHeaders([]); setCsvRows([]); setCsvPhone(""); setCsvError("");
  }, [open]);

  // ── Load unique tags ──────────────────────────────────
  useEffect(() => {
    if (step !== 2 || source !== "contacts") return;
    db.from("inbox_contacts")
      .select("tags")
      .eq("workspace_id", WORKSPACE_ID)
      .then(({ data }: { data: { tags: string[] }[] | null }) => {
        const flat = (data ?? []).flatMap((r) => r.tags ?? []);
        setAllTags([...new Set(flat)].sort());
      });
  }, [step, source]);

  // ── Load contacts + invoices (debounced) ──────────────
  const loadContacts = useCallback(async () => {
    setLoadingC(true);
    let q = db
      .from("inbox_contacts")
      // Traz boletos junto para calcular colunas virtuais financeiras
      .select("*, contact_invoices(valor, vencimento, status, numero_nf, codigo_barras)", { count: "exact" })
      .eq("workspace_id", WORKSPACE_ID)
      .order("name")
      .limit(PAGE);

    if (search.trim()) {
      const s = search.trim();
      q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,empresa.ilike.%${s}%`);
    }
    if (selTags.length > 0) q = q.overlaps("tags", selTags);

    const { data, count } = await q;
    // Inject aggregated financial virtual columns into each contact
    const enriched = ((data ?? []) as ContactWithInvoices[]).map(aggregateInvoices);
    setContacts(enriched);
    setTotal(count ?? 0);
    setLoadingC(false);
  }, [search, selTags]);

  useEffect(() => {
    if (step !== 2 || source !== "contacts") return;
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(loadContacts, 250);
  }, [step, source, loadContacts]);

  // ── CSV file processing ───────────────────────────────
  function processFile(file: File) {
    setCsvError("");
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setCsvError("Formato inválido. Use um arquivo .csv (salve o Excel como CSV).");
      return;
    }
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);
      if (headers.length === 0) {
        setCsvError("Arquivo vazio ou formato inválido.");
        return;
      }
      setCsvHeaders(headers);
      setCsvRows(rows);
      setCsvPhone("");
      const phoneCol = headers.find((h) =>
        /phone|telefone|celular|whatsapp|fone|contato/i.test(h)
      );
      if (phoneCol) setCsvPhone(phoneCol);
    };
    reader.readAsText(file, "UTF-8");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  // ── canNext ───────────────────────────────────────────
  function canNext(): boolean {
    if (step === 1) return name.trim().length > 0 && !!templateId;
    if (step === 2) {
      if (source === "contacts") return selected.size > 0;
      return csvRows.length > 0 && !!csvPhone;
    }
    if (step === 3) return vars.every((v) => !!varMap[v]);
    return false;
  }

  // ── Submit ────────────────────────────────────────────
  async function handleSubmit() {
    if (!selectedTpl || !effectiveConnId) return;
    setSubmitting(true);
    try {
      let messages: {
        workspace_id:    string;
        recipient_phone: string;
        recipient_name:  string;
        recipient_data:  Record<string, unknown>;
        status:          string;
        retry_count:     number;
        max_retries:     number;
      }[] = [];

      if (source === "contacts") {
        // Fetch full contact data WITH invoices so virtual columns can be computed
        const { data: selContacts, error: selErr } = await db
          .from("inbox_contacts")
          .select("*, contact_invoices(valor, vencimento, status, numero_nf, codigo_barras)")
          .in("id", [...selected]);

        if (selErr) throw new Error(selErr.message);

        // Aggregate financial virtual columns before saving to recipient_data
        const enriched = ((selContacts ?? []) as ContactWithInvoices[]).map(aggregateInvoices);

        messages = enriched.map((c) => ({
          workspace_id:    WORKSPACE_ID,
          recipient_phone: c.phone ?? "",
          recipient_name:  c.name  ?? "",
          recipient_data:  c as unknown as Record<string, unknown>,
          status:          "pending",
          retry_count:     0,
          max_retries:     3,
        }));
      } else {
        messages = csvRows.map((row) => ({
          workspace_id:    WORKSPACE_ID,
          recipient_phone: (row[csvPhone] ?? "").replace(/\D/g, ""),
          recipient_name:  row["nome"] ?? row["name"] ?? row[csvHeaders[0]] ?? "",
          recipient_data:  row as Record<string, unknown>,
          status:          "pending",
          retry_count:     0,
          max_retries:     3,
        }));
      }

      const { data: campaign, error: campErr } = await db
        .from("shooting_campaigns")
        .insert({
          workspace_id:       WORKSPACE_ID,
          meta_connection_id: effectiveConnId,
          name:               name.trim(),
          template_id:        templateId,
          data_source:        source,
          column_mapping:     {
            phone_column:    source === "contacts" ? "phone" : csvPhone,
            body_variables:  varMap,
          },
          filters:            source === "contacts" ? { tags: selTags } : {},
          total_recipients:   messages.length,
          status:             "draft",
          sending_speed:      sendingSpeed,
          error_summary:      {},
          created_by:         null,
          started_at:         null,
          completed_at:       null,
          scheduled_at:       null,
        })
        .select()
        .single();

      if (campErr) throw new Error(campErr.message);

      for (let i = 0; i < messages.length; i += 500) {
        const chunk = messages.slice(i, i + 500).map((m) => ({ ...m, campaign_id: campaign.id }));
        const { error: msgErr } = await db.from("shooting_messages").insert(chunk);
        if (msgErr) throw new Error(msgErr.message);
      }

      toast({
        title: "Campanha criada!",
        description: `${messages.length} destinatários · ${sendingSpeed} msg/min`,
        variant: "success",
      });
      onCreated();
      onClose();
    } catch (err) {
      toast({
        title: "Erro ao criar campanha",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="relative w-full flex flex-col rounded-2xl overflow-hidden"
        style={{
          maxWidth: "960px",
          height: "min(90vh, 780px)",
          background: "#0a110e",
          border: "1px solid rgba(63,176,108,0.2)",
          boxShadow: "0 32px 100px rgba(0,0,0,0.7), 0 4px 24px rgba(0,0,0,0.5)",
        }}
      >
        {/* Top accent */}
        <div className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(63,176,108,0.6), transparent)" }}
        />

        {/* ── Header ──────────────────────────────────── */}
        <div className="flex items-center justify-between px-8 py-5 shrink-0"
          style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}
        >
          <div>
            <h2 className="font-display text-xl font-bold text-agro-text">Nova Campanha</h2>
            <p className="text-xs text-agro-muted mt-0.5">Disparo em massa via WhatsApp Business API</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar */}
          <div className="w-52 shrink-0 flex flex-col gap-1 px-4 py-6"
            style={{ borderRight: "1px solid rgba(63,176,108,0.08)", background: "rgba(13,26,17,0.4)" }}
          >
            {STEPS.map((s) => {
              const done   = step > s.id;
              const active = step === s.id;
              return (
                <div key={s.id} className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-xl transition-all",
                  active && "bg-agro-green/10",
                )}>
                  <div className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all",
                    done   ? "bg-agro-green"
                    : active ? "border-2 border-agro-green"
                    : "border border-white/10",
                  )}
                    style={active ? { background: "rgba(63,176,108,0.12)" } : done ? {} : { background: "rgba(255,255,255,0.03)" }}
                  >
                    {done
                      ? <Check className="w-4 h-4 text-white" />
                      : <s.Icon className={cn("w-4 h-4", active ? "text-agro-green" : "text-agro-muted-2")} />
                    }
                  </div>
                  <div className={cn(!active && !done && "opacity-40")}>
                    <p className={cn("text-sm font-semibold leading-none", active || done ? "text-agro-text" : "text-agro-muted")}>
                      {s.label}
                    </p>
                    <p className="text-[11px] text-agro-muted-2 mt-0.5">{s.subtitle}</p>
                  </div>
                </div>
              );
            })}

            {/* Recipients counter */}
            {totalRecipients > 0 && (
              <div className="mt-auto mx-1 p-3 rounded-xl text-center"
                style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.15)" }}
              >
                <p className="text-2xl font-bold text-agro-green">{totalRecipients.toLocaleString("pt-BR")}</p>
                <p className="text-[11px] text-agro-muted mt-0.5">destinatários</p>
              </div>
            )}
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto px-8 py-7">
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
                source={source} setSource={setSource}
                allTags={allTags} selTags={selTags}
                toggleTag={(tag) => {
                  setSelTags((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]);
                  setSelected(new Set());
                }}
                contacts={contacts} totalCount={totalCount}
                selected={selected}
                toggleContact={(id) => setSelected((p) => {
                  const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
                })}
                toggleAll={() => {
                  const allSel = contacts.every((c) => selected.has(c.id));
                  setSelected((p) => {
                    const n = new Set(p);
                    contacts.forEach((c) => allSel ? n.delete(c.id) : n.add(c.id));
                    return n;
                  });
                }}
                search={search} setSearch={setSearch}
                loading={loadingC}
                csvFile={csvFile} csvHeaders={csvHeaders} csvRows={csvRows}
                csvPhone={csvPhone} setCsvPhone={setCsvPhone}
                csvError={csvError}
                isDragging={isDragging} setIsDragging={setIsDragging}
                onDrop={handleDrop}
                onFileChange={(f) => { if (f) processFile(f); }}
                fileInputRef={fileInputRef as React.RefObject<HTMLInputElement>}
              />
            )}
            {step === 3 && selectedTpl && (
              <Step3Variables
                template={selectedTpl}
                vars={vars}
                varMap={varMap} setVarMap={setVarMap}
                fieldGroups={fieldGroups}
                previewData={previewData}
                sendingSpeed={sendingSpeed} setSendingSpeed={setSendingSpeed}
              />
            )}
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────── */}
        <div className="flex items-center justify-between px-8 py-5 shrink-0"
          style={{ borderTop: "1px solid rgba(63,176,108,0.08)", background: "rgba(10,17,14,0.7)" }}
        >
          <button
            onClick={() => step === 1 ? onClose() : setStep((s) => (s - 1) as 1 | 2 | 3)}
            className="flex items-center gap-1.5 text-sm text-agro-muted hover:text-agro-text transition-colors px-4 py-2 rounded-lg hover:bg-white/5"
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 1 ? "Cancelar" : "Voltar"}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              {STEPS.map((s) => (
                <div key={s.id} className={cn(
                  "rounded-full transition-all",
                  step === s.id ? "w-5 h-1.5 bg-agro-green" : step > s.id ? "w-1.5 h-1.5 bg-agro-green/50" : "w-1.5 h-1.5 bg-white/10",
                )} />
              ))}
            </div>
            {step < 3 ? (
              <button
                disabled={!canNext()}
                onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
                className={cn(
                  "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all",
                  canNext() ? "btn-agro" : "opacity-30 cursor-not-allowed",
                )}
                style={!canNext() ? { background: "rgba(63,176,108,0.15)", border: "1px solid rgba(63,176,108,0.1)" } : undefined}
              >
                Próximo <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                disabled={!canNext() || submitting}
                onClick={handleSubmit}
                className={cn(
                  "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all",
                  canNext() && !submitting ? "btn-agro" : "opacity-30 cursor-not-allowed",
                )}
                style={(!canNext() || submitting) ? { background: "rgba(63,176,108,0.15)", border: "1px solid rgba(63,176,108,0.1)" } : undefined}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {submitting ? "Criando campanha..." : "Criar campanha"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Step 1 — Configuração
// ─────────────────────────────────────────────────────────

function Step1Setup({
  name, setName, templateId, setTemplateId, templates, connections, connId, onConnChange,
}: {
  name: string; setName: (v: string) => void;
  templateId: string; setTemplateId: (v: string) => void;
  templates: MetaTemplate[];
  connections: { id: string; display_phone: string; business_name: string | null; status: string }[];
  connId: string; onConnChange: (id: string) => void;
}) {
  return (
    <div className="space-y-7">
      <div>
        <h3 className="text-base font-bold text-agro-text mb-1">Configuração inicial</h3>
        <p className="text-sm text-agro-muted">Defina o nome da campanha e o template aprovado que será disparado.</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
          Nome da campanha *
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Cobrança abril — clientes PJ"
          className="w-full px-4 py-3 rounded-xl text-sm text-agro-text placeholder:text-agro-muted-2 focus:outline-none transition-all"
          style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.15)" }}
          onFocus={(e) => { e.target.style.borderColor = "#3fb06c"; }}
          onBlur={(e) =>  { e.target.style.borderColor = "rgba(63,176,108,0.15)"; }}
          autoFocus
        />
      </div>

      {connections.length > 1 && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
            Número WhatsApp
          </label>
          <div className="grid grid-cols-2 gap-2">
            {connections.map((c) => (
              <button key={c.id} onClick={() => onConnChange(c.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-left transition-all",
                  connId === c.id ? "text-agro-text" : "text-agro-muted hover:text-agro-text",
                )}
                style={{
                  background: connId === c.id ? "rgba(63,176,108,0.1)" : "rgba(13,26,17,0.5)",
                  border:     connId === c.id ? "1px solid rgba(63,176,108,0.35)" : "1px solid rgba(63,176,108,0.1)",
                }}
              >
                <div className={cn("w-2 h-2 rounded-full shrink-0", c.status === "active" ? "bg-agro-green" : "bg-red-400")} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{c.display_phone}</p>
                  {c.business_name && <p className="text-agro-muted-2 text-xs truncate">{c.business_name}</p>}
                </div>
                {connId === c.id && <Check className="w-4 h-4 text-agro-green shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
          Template aprovado *
        </label>
        {templates.length === 0 ? (
          <div className="px-5 py-8 rounded-xl text-center"
            style={{ background: "rgba(13,26,17,0.4)", border: "1px solid rgba(63,176,108,0.08)" }}
          >
            <p className="text-sm text-agro-muted">Nenhum template aprovado encontrado.</p>
            <p className="text-xs text-agro-muted-2 mt-1">Sincronize em Templates → Sincronizar Meta.</p>
          </div>
        ) : (
          <div className="grid gap-2 max-h-72 overflow-y-auto pr-1">
            {templates.map((tpl) => {
              const sel = templateId === tpl.id;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const bodyText = (tpl.components as any[]).find((c) => c.type === "BODY")?.text ?? "";
              return (
                <button key={tpl.id} onClick={() => setTemplateId(tpl.id)}
                  className={cn(
                    "flex items-start gap-4 px-5 py-4 rounded-xl text-left transition-all",
                    sel ? "text-agro-text" : "text-agro-muted hover:text-agro-text",
                  )}
                  style={{
                    background: sel ? "rgba(63,176,108,0.08)" : "rgba(13,26,17,0.5)",
                    border:     sel ? "1px solid rgba(63,176,108,0.35)" : "1px solid rgba(63,176,108,0.08)",
                  }}
                >
                  <div className={cn(
                    "w-5 h-5 rounded-md shrink-0 mt-0.5 flex items-center justify-center border transition-all",
                    sel ? "bg-agro-green border-agro-green" : "border-white/20",
                  )}>
                    {sel && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-agro-text">{tpl.template_name}</p>
                    <p className="text-xs text-agro-muted mt-1 line-clamp-2 leading-relaxed">{bodyText}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: "rgba(63,176,108,0.12)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.2)" }}>
                        {tpl.language}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
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
// Step 2 — Público
// ─────────────────────────────────────────────────────────

function Step2Audience({
  source, setSource,
  allTags, selTags, toggleTag,
  contacts, totalCount, selected, toggleContact, toggleAll,
  search, setSearch, loading,
  csvFile, csvHeaders, csvRows, csvPhone, setCsvPhone, csvError,
  isDragging, setIsDragging, onDrop, onFileChange, fileInputRef,
}: {
  source: "contacts" | "csv"; setSource: (s: "contacts" | "csv") => void;
  allTags: string[]; selTags: string[]; toggleTag: (t: string) => void;
  contacts: ContactWithInvoices[]; totalCount: number; selected: Set<string>;
  toggleContact: (id: string) => void; toggleAll: () => void;
  search: string; setSearch: (s: string) => void; loading: boolean;
  csvFile: File | null; csvHeaders: string[]; csvRows: Record<string, string>[];
  csvPhone: string; setCsvPhone: (v: string) => void; csvError: string;
  isDragging: boolean; setIsDragging: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileChange: (f: File | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}) {
  const allOnPage = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-agro-text mb-1">Público-alvo</h3>
        <p className="text-sm text-agro-muted">Selecione quem vai receber esta campanha.</p>
      </div>

      {/* Source tabs */}
      <div className="flex gap-2 p-1 rounded-xl"
        style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}
      >
        <button
          onClick={() => setSource("contacts")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all",
            source === "contacts" ? "text-white" : "text-agro-muted hover:text-agro-text",
          )}
          style={source === "contacts" ? {
            background: "linear-gradient(135deg, rgba(63,176,108,0.2), rgba(22,163,74,0.1))",
            border: "1px solid rgba(63,176,108,0.3)",
          } : undefined}
        >
          <Database className="w-4 h-4" /> Contatos da base
        </button>
        <button
          onClick={() => setSource("csv")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all",
            source === "csv" ? "text-white" : "text-agro-muted hover:text-agro-text",
          )}
          style={source === "csv" ? {
            background: "linear-gradient(135deg, rgba(63,176,108,0.2), rgba(22,163,74,0.1))",
            border: "1px solid rgba(63,176,108,0.3)",
          } : undefined}
        >
          <FileSpreadsheet className="w-4 h-4" /> Importar planilha
        </button>
      </div>

      {/* ── Contacts mode ── */}
      {source === "contacts" && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-agro-muted-2 uppercase tracking-widest font-semibold">Destinatários</span>
            <span className={cn("text-sm font-bold px-3 py-1 rounded-full transition-colors", selected.size > 0 ? "text-agro-green" : "text-agro-muted-2")}
              style={{
                background: selected.size > 0 ? "rgba(63,176,108,0.12)" : "rgba(255,255,255,0.04)",
                border:     selected.size > 0 ? "1px solid rgba(63,176,108,0.25)" : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {selected.size > 0 ? `${selected.size} selecionado${selected.size !== 1 ? "s" : ""}` : "Nenhum selecionado"}
            </span>
          </div>

          {allTags.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-agro-muted flex items-center gap-1.5">
                <Tag className="w-3 h-3" /> Filtrar por tag
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tag) => {
                  const active = selTags.includes(tag);
                  return (
                    <button key={tag} onClick={() => toggleTag(tag)}
                      className="px-3 py-1 rounded-full text-xs font-medium transition-all"
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

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-agro-muted-2" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, telefone ou empresa..."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-agro-text placeholder:text-agro-muted-2 focus:outline-none transition-all"
              style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.12)" }}
              onFocus={(e) => { e.target.style.borderColor = "#3fb06c"; }}
              onBlur={(e) =>  { e.target.style.borderColor = "rgba(63,176,108,0.12)"; }}
            />
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
            <div className="flex items-center gap-3 px-4 py-3"
              style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}
            >
              <button onClick={toggleAll} className={cn(
                "w-4 h-4 rounded flex items-center justify-center border transition-all shrink-0",
                allOnPage ? "bg-agro-green border-agro-green" : "border-agro-muted-2 hover:border-agro-green",
              )}>
                {allOnPage && <Check className="w-2.5 h-2.5 text-white" />}
              </button>
              <span className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest flex-1">Nome</span>
              <span className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest w-32 hidden sm:block">Telefone</span>
              <span className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest w-28 text-right hidden md:block">Pendente</span>
            </div>
            <div className="max-h-52 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 text-agro-green animate-spin" />
                </div>
              ) : contacts.length === 0 ? (
                <div className="py-10 text-center text-sm text-agro-muted">Nenhum contato encontrado</div>
              ) : (
                contacts.map((c) => {
                  const sel = selected.has(c.id);
                  const hasPending = c.valor_total_pendente && c.valor_total_pendente !== "R$ 0,00";
                  return (
                    <div key={c.id} onClick={() => toggleContact(c.id)}
                      className={cn("flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors", sel ? "bg-agro-green/5" : "hover:bg-white/[0.03]")}
                      style={{ borderBottom: "1px solid rgba(63,176,108,0.04)" }}
                    >
                      <div className={cn("w-4 h-4 rounded flex items-center justify-center border transition-all shrink-0",
                        sel ? "bg-agro-green border-agro-green" : "border-agro-muted-2")}>
                        {sel && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      <span className="text-sm text-agro-text flex-1 truncate">{c.name ?? "—"}</span>
                      <span className="text-xs text-agro-muted w-32 hidden sm:block truncate">{c.phone ?? "—"}</span>
                      <span className={cn("text-xs w-28 text-right hidden md:block font-medium", hasPending ? "text-amber-400" : "text-agro-muted-2")}>
                        {hasPending ? c.valor_total_pendente : "—"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
            <div className="px-4 py-2 text-xs text-agro-muted-2"
              style={{ background: "rgba(13,26,17,0.7)", borderTop: "1px solid rgba(63,176,108,0.06)" }}
            >
              {selTags.length > 0 || search ? `${totalCount} contatos encontrados` : `${totalCount} contatos na base`}
              {totalCount > PAGE && ` · exibindo ${PAGE}`}
            </div>
          </div>
        </>
      )}

      {/* ── CSV mode ── */}
      {source === "csv" && (
        <div className="space-y-5">
          {!csvFile ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn("flex flex-col items-center justify-center py-16 rounded-2xl cursor-pointer transition-all", isDragging ? "scale-[1.01]" : "hover:scale-[1.005]")}
              style={{
                border: `2px dashed ${isDragging ? "#3fb06c" : "rgba(63,176,108,0.25)"}`,
                background: isDragging ? "rgba(63,176,108,0.06)" : "rgba(13,26,17,0.4)",
              }}
            >
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}
              >
                <Upload className="w-7 h-7 text-agro-green" />
              </div>
              <p className="text-sm font-semibold text-agro-text">Arraste seu arquivo ou clique para selecionar</p>
              <p className="text-xs text-agro-muted mt-1">Formato CSV · Use "Salvar como CSV" no Excel</p>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
                onChange={(e) => onFileChange(e.target.files?.[0] ?? null)} />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-xl"
                style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.2)" }}
              >
                <FileSpreadsheet className="w-5 h-5 text-agro-green shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-agro-text truncate">{csvFile.name}</p>
                  <p className="text-xs text-agro-muted mt-0.5">{csvRows.length.toLocaleString("pt-BR")} linhas · {csvHeaders.length} colunas</p>
                </div>
                <button onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-agro-muted hover:text-agro-text transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
                  style={{ border: "1px solid rgba(63,176,108,0.15)" }}
                >
                  Trocar arquivo
                </button>
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
                  onChange={(e) => onFileChange(e.target.files?.[0] ?? null)} />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
                  Coluna do telefone / WhatsApp *
                </label>
                <select value={csvPhone} onChange={(e) => setCsvPhone(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-agro-text focus:outline-none appearance-none cursor-pointer"
                  style={{
                    background: "rgba(13,26,17,0.7)",
                    border: csvPhone ? "1px solid rgba(63,176,108,0.35)" : "1px solid rgba(63,176,108,0.15)",
                    color: csvPhone ? "#e2e8f0" : "#6b7280",
                  }}
                >
                  <option value="">— Selecione a coluna com o número de telefone —</option>
                  {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-agro-muted-2 uppercase tracking-widest font-semibold">Pré-visualização (primeiras 5 linhas)</p>
                <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
                        {csvHeaders.map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-agro-muted-2 whitespace-nowrap">
                            {h}{h === csvPhone && <span className="ml-1 text-agro-green">📱</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.slice(0, 5).map((row, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.04)" }}>
                          {csvHeaders.map((h) => (
                            <td key={h} className="px-3 py-2 text-agro-muted max-w-[160px] truncate">{row[h] || "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {csvError && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-sm text-red-400"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />{csvError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Step 3 — Variáveis & Velocidade
// ─────────────────────────────────────────────────────────

function Step3Variables({
  template, vars, varMap, setVarMap,
  fieldGroups, previewData,
  sendingSpeed, setSendingSpeed,
}: {
  template: MetaTemplate;
  vars: string[];
  varMap: Record<string, string>;
  setVarMap: (m: Record<string, string>) => void;
  fieldGroups: FieldGroup[];
  previewData: Record<string, unknown> | null;
  sendingSpeed: number;
  setSendingSpeed: (v: number) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyText: string = (template.components as any[]).find((c) => c.type === "BODY")?.text ?? "";
  const preview = previewData ? renderPreview(template, previewData, varMap) : null;

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-bold text-agro-text mb-1">Personalização & Velocidade</h3>
        <p className="text-sm text-agro-muted">Mapeie as variáveis e defina a frequência de envio.</p>
      </div>

      {/* Variable mapping */}
      {vars.length === 0 ? (
        <div className="px-6 py-8 rounded-xl text-center"
          style={{ background: "rgba(63,176,108,0.04)", border: "1px solid rgba(63,176,108,0.12)" }}
        >
          <Check className="w-10 h-10 text-agro-green mx-auto mb-3" />
          <p className="text-sm font-semibold text-agro-text">Template sem variáveis</p>
          <p className="text-xs text-agro-muted mt-1">A mensagem será enviada exatamente como está no template.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">Mapeamento de variáveis</p>
          <p className="text-xs text-agro-muted">
            Cada{" "}
            <span className="font-mono px-1.5 py-0.5 rounded text-amber-400 text-[11px]"
              style={{ background: "rgba(245,158,11,0.12)" }}>{"{{variável}}"}</span>
            {" "}será substituída pelo dado do contato selecionado.
          </p>
          <div className="space-y-2.5">
            {vars.map((idx) => (
              <div key={idx} className="flex items-center gap-3 p-4 rounded-xl"
                style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}
              >
                <div className="px-3 py-1.5 rounded-lg font-mono text-sm font-bold text-amber-400 shrink-0 min-w-[56px] text-center"
                  style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}
                >
                  {`{{${idx}}}`}
                </div>
                <ArrowRight className="w-4 h-4 text-agro-muted-2 shrink-0" />
                <select
                  value={varMap[idx] ?? ""}
                  onChange={(e) => setVarMap({ ...varMap, [idx]: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-lg text-sm text-agro-text focus:outline-none appearance-none cursor-pointer"
                  style={{
                    background: "rgba(13,26,17,0.8)",
                    border: varMap[idx] ? "1px solid rgba(63,176,108,0.3)" : "1px solid rgba(63,176,108,0.15)",
                    color: varMap[idx] ? "#e2e8f0" : "#6b7280",
                  }}
                >
                  <option value="">— Selecione uma coluna —</option>
                  {fieldGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.fields.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sending speed */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-agro-muted-2" />
          <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">Velocidade de envio</p>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {SPEED_OPTIONS.map((opt) => {
            const sel = sendingSpeed === opt.value;
            return (
              <button key={opt.value} onClick={() => setSendingSpeed(opt.value)}
                className={cn("flex flex-col items-center py-3 px-2 rounded-xl transition-all", sel ? "text-white" : "text-agro-muted hover:text-agro-text")}
                style={{
                  background: sel ? "linear-gradient(135deg, rgba(63,176,108,0.2), rgba(22,163,74,0.1))" : "rgba(13,26,17,0.5)",
                  border:     sel ? "1px solid rgba(63,176,108,0.4)" : "1px solid rgba(63,176,108,0.1)",
                }}
              >
                <span className={cn("text-base font-bold", sel ? "text-agro-green" : "")}>{opt.label}</span>
                <span className="text-[10px] text-agro-muted-2 mt-0.5">{opt.desc}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-agro-muted">
          A Meta permite ~80 msg/min de forma segura. Velocidades acima podem ativar rate limit.
        </p>
      </div>

      {/* Template preview */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest flex items-center gap-1.5">
            <Eye className="w-3 h-3" /> Template original
          </p>
          <div className="px-4 py-3 rounded-xl text-sm text-agro-muted leading-relaxed"
            style={{ background: "rgba(13,26,17,0.5)", border: "1px solid rgba(63,176,108,0.08)", whiteSpace: "pre-wrap", minHeight: "80px" }}
          >
            {bodyText || "—"}
          </div>
        </div>
        {preview && previewData && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest flex items-center gap-1.5">
              <Eye className="w-3 h-3" /> Preview — 1º contato
            </p>
            <div className="px-4 py-3 rounded-xl text-sm text-agro-text leading-relaxed"
              style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.18)", whiteSpace: "pre-wrap", minHeight: "80px" }}
            >
              {preview}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
