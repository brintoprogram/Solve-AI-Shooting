import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, Target, Users, Sliders, ChevronLeft, ChevronRight,
  Search, Check, Tag, Loader2, Eye, ArrowRight,
  Upload, FileSpreadsheet, Database, Gauge, AlertCircle,
  ChevronDown, AlertTriangle, Mail, Zap,
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
  id:            string;
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

const N8N_WEBHOOK = "https://n8n.solveai.consulting/webhook/f03bd652-7164-483f-80cf-b871ff671ae6";

async function dispatchToN8N(
  campaignId: string,
  workspaceId: string,
  campaignName: string,
  messages: { id: string; recipient_name: string | null; recipient_phone: string; recipient_data: unknown }[],
) {
  const callbackUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-campaign-status`;
  await fetch(N8N_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campaign_id:     campaignId,
      workspace_id:    workspaceId,
      campaign_name:   campaignName,
      dispatched_at:   new Date().toISOString(),
      callback_url:    callbackUrl,
      callback_apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      recipients: messages.map((m) => ({
        message_id:     m.id,
        name:           m.recipient_name,
        phone:          m.recipient_phone,
        recipient_data: m.recipient_data,
      })),
    }),
  });
}

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

function aggregateInvoices(
  contact: ContactWithInvoices,
  filterDate?: string,
  selectedIds?: Set<string>,
): ContactWithInvoices {
  let invoices = (contact.contact_invoices ?? []).filter((inv) =>
    PENDING_STATUSES.includes((inv.status ?? "").toLowerCase())
  );

  if (filterDate) {
    invoices = invoices.filter((inv) => inv.vencimento === filterDate);
  }

  // Non-empty selectedIds → restrict to chosen invoices
  if (selectedIds && selectedIds.size > 0) {
    invoices = invoices.filter((inv) => selectedIds.has(inv.id));
  }

  if (invoices.length === 0) {
    return {
      ...contact,
      valor_total_pendente:  "R$ 0,00",
      proximo_vencimento:    filterDate ? (() => { const [y,m,d] = filterDate.split("-"); return `${d}/${m}/${y}`; })() : "",
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

  const valorFormatado = total.toLocaleString("pt-BR", {
    style: "currency", currency: "BRL",
  });

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

function hasMultipleDueDates(contact: ContactWithInvoices): boolean {
  const pending = (contact.contact_invoices ?? []).filter((inv) =>
    PENDING_STATUSES.includes((inv.status ?? "").toLowerCase())
  );
  const dates = new Set(pending.map((inv) => inv.vencimento).filter(Boolean));
  return dates.size > 1;
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
  const [step,            setStep]            = useState<1 | 2 | 3>(1);
  const [name,            setName]            = useState("");
  const [templateId,      setTemplateId]      = useState("");
  const [dispatchChannel, setDispatchChannel] = useState<"whatsapp" | "n8n_email">("whatsapp");

  // Audience
  const [source,    setSource]   = useState<"contacts" | "csv">("contacts");
  // contacts mode
  const [selTags,           setSelTags]           = useState<string[]>([]);
  const [search,            setSearch]            = useState("");
  const [selected,          setSelected]          = useState<Set<string>>(new Set());
  const [contacts,          setContacts]          = useState<ContactWithInvoices[]>([]);
  const [allTags,           setAllTags]           = useState<string[]>([]);
  const [totalCount,        setTotal]             = useState(0);
  const [loadingC,          setLoadingC]          = useState(false);
  const [filterDate,        setFilterDate]        = useState<string>("");
  const [invoiceSelections, setInvoiceSelections] = useState<Map<string, Set<string>>>(new Map());
  const [expandedContacts,  setExpandedContacts]  = useState<Set<string>>(new Set());
  const [sortDir,           setSortDir]           = useState<"asc" | "desc">("asc");
  const [sendFilter,        setSendFilter]        = useState<"all" | "never" | "not_today">("all");
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

  // First selected item for preview — aggregate inline so virtual columns reflect
  // the current filterDate + invoiceSelections without storing duplicated state.
  const rawPreviewContact = source === "contacts" ? contacts.find((c) => selected.has(c.id)) : null;
  const previewData: Record<string, unknown> | null = rawPreviewContact
    ? aggregateInvoices(
        rawPreviewContact,
        filterDate || undefined,
        invoiceSelections.get(rawPreviewContact.id),
      ) as Record<string, unknown>
    : source === "csv" ? csvRows[0] ?? null : null;

  const totalRecipients =
    source === "contacts" ? selected.size : csvRows.length;

  // ── Reset on open ─────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep(1); setName(""); setTemplateId(""); setConnId(""); setDispatchChannel("whatsapp");
    setSource("contacts");
    setSelTags([]); setSearch(""); setSelected(new Set());
    setContacts([]); setAllTags([]); setVarMap({}); setSendingSpeed(80);
    setFilterDate(""); setInvoiceSelections(new Map()); setExpandedContacts(new Set());
    setSortDir("asc"); setSendFilter("all");
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

    const invoiceSelect = filterDate
      ? "*, contact_invoices!inner(id, valor, vencimento, status, numero_nf, codigo_barras)"
      : "*, contact_invoices(id, valor, vencimento, status, numero_nf, codigo_barras)";

    let q = db
      .from("inbox_contacts")
      .select(invoiceSelect, { count: "exact" })
      .eq("workspace_id", WORKSPACE_ID)
      .order("name", { ascending: sortDir === "asc" })
      .limit(PAGE);

    if (filterDate) {
      q = q
        .eq("contact_invoices.vencimento", filterDate)
        .in("contact_invoices.status", PENDING_STATUSES);
    }
    if (search.trim()) {
      const s = search.trim();
      q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,empresa.ilike.%${s}%`);
    }
    if (selTags.length > 0) q = q.overlaps("tags", selTags);

    // Send-date filter: pre-fetch phones that were already sent and exclude them
    if (sendFilter !== "all") {
      const today = new Date().toISOString().split("T")[0];
      let sentQ = db
        .from("shooting_messages")
        .select("recipient_phone")
        .eq("workspace_id", WORKSPACE_ID)
        .not("sent_at", "is", null);
      if (sendFilter === "not_today") {
        sentQ = sentQ.gte("sent_at", `${today}T00:00:00Z`);
      }
      const { data: sentData } = await sentQ;
      const sentPhones = [
        ...new Set(((sentData ?? []) as { recipient_phone: string }[]).map((m) => m.recipient_phone)),
      ];
      if (sentPhones.length > 0) {
        q = q.not("phone", "in", `(${sentPhones.join(",")})`);
      }
    }

    const { data, count } = await q;
    setContacts((data ?? []) as ContactWithInvoices[]);
    setTotal(count ?? 0);
    setLoadingC(false);
  }, [search, selTags, filterDate, sortDir, sendFilter]);

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

  // ── Invoice selection handlers ────────────────────────
  function toggleInvoice(contactId: string, invoiceId: string, allInvoiceIds: string[]) {
    setInvoiceSelections((prev) => {
      const next = new Map(prev);
      const prevSel = next.get(contactId);
      // undefined / missing = all selected; build an explicit set to toggle from
      const current = prevSel !== undefined ? new Set(prevSel) : new Set(allInvoiceIds);
      if (current.has(invoiceId)) current.delete(invoiceId);
      else current.add(invoiceId);
      // If everything is selected again, reset to undefined (default = all)
      if (current.size === allInvoiceIds.length) next.delete(contactId);
      else next.set(contactId, current);
      return next;
    });
  }

  function toggleExpand(contactId: string) {
    setExpandedContacts((prev) => {
      const next = new Set(prev);
      next.has(contactId) ? next.delete(contactId) : next.add(contactId);
      return next;
    });
  }

  function expandAll(expand: boolean) {
    if (!expand) {
      setExpandedContacts(new Set());
    } else {
      const ids = contacts
        .filter((c) =>
          (c.contact_invoices ?? []).some((inv) =>
            PENDING_STATUSES.includes((inv.status ?? "").toLowerCase())
          )
        )
        .map((c) => c.id);
      setExpandedContacts(new Set(ids));
    }
  }

  // ── canNext ───────────────────────────────────────────
  function canNext(): boolean {
    if (step === 1) {
      if (dispatchChannel === "n8n_email") return name.trim().length > 0;
      return name.trim().length > 0 && !!templateId;
    }
    if (step === 2) {
      if (source === "contacts") return selected.size > 0;
      return csvRows.length > 0 && !!csvPhone;
    }
    if (step === 3) {
      if (dispatchChannel === "n8n_email") return true;
      return vars.every((v) => !!varMap[v]);
    }
    return false;
  }

  // ── Submit ────────────────────────────────────────────
  async function handleSubmit() {
    if (dispatchChannel === "whatsapp" && (!selectedTpl || !effectiveConnId)) return;
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

      const FINANCIAL_FIELDS = new Set(["valor_total_pendente", "proximo_vencimento", "boleto_nf", "boleto_codigo_barras"]);

      if (source === "contacts") {
        const { data: selContacts, error: selErr } = await db
          .from("inbox_contacts")
          .select("*, contact_invoices(id, valor, vencimento, status, numero_nf, codigo_barras)")
          .in("id", [...selected]);

        if (selErr) throw new Error(selErr.message);

        messages = ((selContacts ?? []) as ContactWithInvoices[]).map((c) => {
          const selIds = invoiceSelections.get(c.id);
          const enriched = aggregateInvoices(c, filterDate || undefined, selIds);

          const pendingOnDate = (c.contact_invoices ?? []).filter((inv) =>
            PENDING_STATUSES.includes((inv.status ?? "").toLowerCase()) &&
            (!filterDate || inv.vencimento === filterDate)
          );
          const usedIds =
            selIds && selIds.size > 0
              ? pendingOnDate.filter((inv) => selIds.has(inv.id)).map((inv) => inv.id)
              : pendingOnDate.map((inv) => inv.id);

          const isFinancialCampaign =
            dispatchChannel === "n8n_email"
              ? usedIds.length > 0
              : Object.values(varMap).some((v) => FINANCIAL_FIELDS.has(v));

          const recipientData: Record<string, unknown> = {
            ...(enriched as unknown as Record<string, unknown>),
            _vencimento_filtro:  filterDate || null,
            _invoice_ids:        usedIds,
            _invoice_count:      usedIds.length,
            _financial_campaign: isFinancialCampaign,
          };

          return {
            workspace_id:    WORKSPACE_ID,
            recipient_phone: c.phone ?? "",
            recipient_name:  c.name  ?? "",
            recipient_data:  recipientData,
            status:          "pending",
            retry_count:     0,
            max_retries:     3,
          };
        });
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
          meta_connection_id: dispatchChannel === "n8n_email" ? null : effectiveConnId,
          name:               name.trim(),
          template_id:        dispatchChannel === "n8n_email" ? null : templateId,
          dispatch_channel:   dispatchChannel,
          data_source:        source,
          column_mapping:     {
            phone_column:    source === "contacts" ? "phone" : csvPhone,
            ...(dispatchChannel === "whatsapp" ? { body_variables: varMap } : {}),
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

      if (dispatchChannel === "n8n_email") {
        const { data: inserted } = await db
          .from("shooting_messages")
          .select("id, recipient_name, recipient_phone, recipient_data")
          .eq("campaign_id", campaign.id);

        await dispatchToN8N(campaign.id, WORKSPACE_ID, name.trim(), inserted ?? []);

        await db
          .from("shooting_campaigns")
          .update({ status: "sending", started_at: new Date().toISOString() })
          .eq("id", campaign.id);
      }

      toast({
        title: dispatchChannel === "n8n_email" ? "Campanha disparada!" : "Campanha criada!",
        description: dispatchChannel === "n8n_email"
          ? `${messages.length} emails enviados ao N8N`
          : `${messages.length} destinatários · ${sendingSpeed} msg/min`,
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
          maxWidth: "min(95vw, 1400px)",
          height: "95vh",
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
            <p className="text-xs text-agro-muted mt-0.5">
              {dispatchChannel === "n8n_email" ? "Disparo em massa via Email (N8N)" : "Disparo em massa via WhatsApp Business API"}
            </p>
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
                dispatchChannel={dispatchChannel}
                setDispatchChannel={setDispatchChannel}
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
                filterDate={filterDate} setFilterDate={(v) => { setFilterDate(v); setSelected(new Set()); setInvoiceSelections(new Map()); setExpandedContacts(new Set()); }}
                invoiceSelections={invoiceSelections}
                onToggleInvoice={toggleInvoice}
                expandedContacts={expandedContacts}
                onToggleExpand={toggleExpand}
                onExpandAll={expandAll}
                sortDir={sortDir} setSortDir={setSortDir}
                sendFilter={sendFilter} setSendFilter={setSendFilter}
                csvFile={csvFile} csvHeaders={csvHeaders} csvRows={csvRows}
                csvPhone={csvPhone} setCsvPhone={setCsvPhone}
                csvError={csvError}
                isDragging={isDragging} setIsDragging={setIsDragging}
                onDrop={handleDrop}
                onFileChange={(f) => { if (f) processFile(f); }}
                fileInputRef={fileInputRef as React.RefObject<HTMLInputElement>}
              />
            )}
            {step === 3 && dispatchChannel === "n8n_email" && (
              <Step3N8NConfirmation
                totalRecipients={totalRecipients}
                campaignName={name.trim()}
              />
            )}
            {step === 3 && dispatchChannel === "whatsapp" && selectedTpl && (
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
                {submitting
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : dispatchChannel === "n8n_email" ? <Zap className="w-4 h-4" /> : <Check className="w-4 h-4" />
                }
                {submitting
                  ? (dispatchChannel === "n8n_email" ? "Disparando..." : "Criando campanha...")
                  : dispatchChannel === "n8n_email" ? "Disparar via Email" : "Criar campanha"
                }
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
  dispatchChannel, setDispatchChannel,
}: {
  name: string; setName: (v: string) => void;
  templateId: string; setTemplateId: (v: string) => void;
  templates: MetaTemplate[];
  connections: { id: string; display_phone: string; business_name: string | null; status: string }[];
  connId: string; onConnChange: (id: string) => void;
  dispatchChannel: "whatsapp" | "n8n_email";
  setDispatchChannel: (v: "whatsapp" | "n8n_email") => void;
}) {
  return (
    <div className="space-y-7">
      <div>
        <h3 className="text-base font-bold text-agro-text mb-1">Configuração inicial</h3>
        <p className="text-sm text-agro-muted">Defina o canal de envio e o nome da campanha.</p>
      </div>

      {/* ── Canal de envio ── */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
          Canal de envio *
        </label>
        <div className="grid grid-cols-2 gap-3">
          {(["whatsapp", "n8n_email"] as const).map((ch) => {
            const sel = dispatchChannel === ch;
            const icon = ch === "whatsapp"
              ? <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              : <Mail className="w-5 h-5" />;
            const label = ch === "whatsapp" ? "WhatsApp" : "Email via N8N";
            const desc  = ch === "whatsapp" ? "Conta conectada no app" : "Webhook externo";
            return (
              <button
                key={ch}
                onClick={() => setDispatchChannel(ch)}
                className={cn(
                  "flex items-center gap-3 px-4 py-4 rounded-xl text-left transition-all",
                  sel ? "text-agro-text" : "text-agro-muted hover:text-agro-text",
                )}
                style={{
                  background: sel ? "rgba(63,176,108,0.1)" : "rgba(13,26,17,0.5)",
                  border:     sel ? "1px solid rgba(63,176,108,0.35)" : "1px solid rgba(63,176,108,0.1)",
                }}
              >
                <div className={cn("shrink-0 transition-colors", sel ? "text-agro-green" : "text-agro-muted-2")}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{label}</p>
                  <p className="text-agro-muted-2 text-xs mt-0.5">{desc}</p>
                </div>
                {sel && <Check className="w-4 h-4 text-agro-green shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
          Nome da campanha *
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={dispatchChannel === "n8n_email" ? "Ex: Cobrança abril — email clientes PJ" : "Ex: Cobrança abril — clientes PJ"}
          className="w-full px-4 py-3 rounded-xl text-sm text-agro-text placeholder:text-agro-muted-2 focus:outline-none transition-all"
          style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.15)" }}
          onFocus={(e) => { e.target.style.borderColor = "#3fb06c"; }}
          onBlur={(e) =>  { e.target.style.borderColor = "rgba(63,176,108,0.15)"; }}
          autoFocus
        />
      </div>

      {/* WhatsApp-only: connection + template selectors */}
      {dispatchChannel === "whatsapp" && (
        <>
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
              <div className="grid gap-2 pr-1">
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
        </>
      )}

      {/* N8N email: info banner */}
      {dispatchChannel === "n8n_email" && (
        <div className="flex items-start gap-3 px-4 py-4 rounded-xl"
          style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.2)" }}
        >
          <Mail className="w-4 h-4 text-agro-green shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-agro-text">Template gerenciado pelo N8N</p>
            <p className="text-xs text-agro-muted mt-1 leading-relaxed">
              O Solve AI enviará os dados dos destinatários para o webhook do N8N.
              O N8N irá processar, aplicar o template de email e retornar os status individualmente.
            </p>
          </div>
        </div>
      )}
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
  filterDate, setFilterDate,
  invoiceSelections, onToggleInvoice, expandedContacts, onToggleExpand, onExpandAll,
  sortDir, setSortDir, sendFilter, setSendFilter,
  csvFile, csvHeaders, csvRows, csvPhone, setCsvPhone, csvError,
  isDragging, setIsDragging, onDrop, onFileChange, fileInputRef,
}: {
  source: "contacts" | "csv"; setSource: (s: "contacts" | "csv") => void;
  allTags: string[]; selTags: string[]; toggleTag: (t: string) => void;
  contacts: ContactWithInvoices[]; totalCount: number; selected: Set<string>;
  toggleContact: (id: string) => void; toggleAll: () => void;
  search: string; setSearch: (s: string) => void; loading: boolean;
  filterDate: string; setFilterDate: (v: string) => void;
  invoiceSelections: Map<string, Set<string>>;
  onToggleInvoice: (contactId: string, invoiceId: string, allIds: string[]) => void;
  expandedContacts: Set<string>;
  onToggleExpand: (contactId: string) => void;
  onExpandAll: (expand: boolean) => void;
  sortDir: "asc" | "desc"; setSortDir: (v: "asc" | "desc") => void;
  sendFilter: "all" | "never" | "not_today"; setSendFilter: (v: "all" | "never" | "not_today") => void;
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

          {/* Date filter */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none transition-all appearance-none"
                style={{
                  background: filterDate ? "rgba(63,176,108,0.08)" : "rgba(13,26,17,0.6)",
                  border: filterDate ? "1px solid rgba(63,176,108,0.4)" : "1px solid rgba(63,176,108,0.12)",
                  color: filterDate ? "#3fb06c" : "#6b7280",
                  colorScheme: "dark",
                }}
              />
            </div>
            {filterDate && (
              <button
                onClick={() => setFilterDate("")}
                className="px-3 py-2.5 rounded-xl text-xs text-agro-muted hover:text-red-400 transition-colors shrink-0"
                style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {filterDate && (
            <p className="text-xs text-agro-green -mt-3">
              Exibindo apenas contatos com boleto pendente em{" "}
              {(() => { const [y,m,d] = filterDate.split("-"); return `${d}/${m}/${y}`; })()}
            </p>
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

          {/* Toolbar: sort + send filter + expand all */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Alphabetical sort */}
            <button
              onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-agro-muted hover:text-agro-text"
              style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.12)" }}
            >
              {sortDir === "asc" ? "A → Z" : "Z → A"}
            </button>

            {/* Send date filter */}
            <select
              value={sendFilter}
              onChange={(e) => setSendFilter(e.target.value as "all" | "never" | "not_today")}
              className="flex-1 px-3 py-2 rounded-lg text-xs focus:outline-none appearance-none cursor-pointer"
              style={{
                background: sendFilter !== "all" ? "rgba(63,176,108,0.08)" : "rgba(13,26,17,0.6)",
                border: sendFilter !== "all" ? "1px solid rgba(63,176,108,0.35)" : "1px solid rgba(63,176,108,0.12)",
                color: sendFilter !== "all" ? "#3fb06c" : "#9ca3af",
                colorScheme: "dark",
              }}
            >
              <option value="all">Todos os contatos</option>
              <option value="never">Nunca enviados</option>
              <option value="not_today">Não enviados hoje</option>
            </select>

            {/* Expand / collapse all */}
            {contacts.some((c) => (c.contact_invoices ?? []).some((inv) => PENDING_STATUSES.includes((inv.status ?? "").toLowerCase()))) && (
              <button
                onClick={() => {
                  const hasAll = contacts
                    .filter((c) => (c.contact_invoices ?? []).some((inv) => PENDING_STATUSES.includes((inv.status ?? "").toLowerCase())))
                    .every((c) => expandedContacts.has(c.id));
                  onExpandAll(!hasAll);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-agro-muted hover:text-agro-text shrink-0"
                style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.12)" }}
              >
                <ChevronDown className={cn("w-3 h-3 transition-transform",
                  contacts.filter((c) => (c.contact_invoices ?? []).some((inv) => PENDING_STATUSES.includes((inv.status ?? "").toLowerCase()))).every((c) => expandedContacts.has(c.id))
                    ? "rotate-180" : ""
                )} />
                {contacts.filter((c) => (c.contact_invoices ?? []).some((inv) => PENDING_STATUSES.includes((inv.status ?? "").toLowerCase()))).every((c) => expandedContacts.has(c.id))
                  ? "Colapsar todos" : "Expandir todos"}
              </button>
            )}
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
              <span className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest w-32 text-right hidden md:block">
                {filterDate ? "Valor (data filtrada)" : "Pendente"}
              </span>
              <span className="w-5 shrink-0" />
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 text-agro-green animate-spin" />
                </div>
              ) : contacts.length === 0 ? (
                <div className="py-10 text-center text-sm text-agro-muted">Nenhum contato encontrado</div>
              ) : (
                contacts.map((c) => {
                  const sel      = selected.has(c.id);
                  const selIds   = invoiceSelections.get(c.id);
                  const enriched = aggregateInvoices(c, filterDate || undefined, selIds);
                  const hasPending   = enriched.valor_total_pendente && enriched.valor_total_pendente !== "R$ 0,00";
                  const hasMultDates = !filterDate && hasMultipleDueDates(c);

                  // Sub-panel invoices: all pending (or filtered by date when active)
                  const allPending = (c.contact_invoices ?? []).filter((inv) =>
                    PENDING_STATUSES.includes((inv.status ?? "").toLowerCase())
                  );
                  const dateInvoices = filterDate
                    ? allPending.filter((inv) => inv.vencimento === filterDate)
                    : allPending;
                  const showSubPanel = dateInvoices.length > 0;
                  const isExpanded   = expandedContacts.has(c.id);
                  const allInvIds    = dateInvoices.map((inv) => inv.id);
                  const isInvChecked = (invId: string) =>
                    !selIds || selIds.size === 0 || selIds.has(invId);

                  return (
                    <div key={c.id} style={{ borderBottom: "1px solid rgba(63,176,108,0.04)" }}>
                      <div
                        onClick={() => toggleContact(c.id)}
                        className={cn("flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors", sel ? "bg-agro-green/5" : "hover:bg-white/[0.03]")}
                      >
                        <div className={cn("w-4 h-4 rounded flex items-center justify-center border transition-all shrink-0",
                          sel ? "bg-agro-green border-agro-green" : "border-agro-muted-2")}>
                          {sel && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <span className="text-sm text-agro-text flex-1 truncate">{c.name ?? "—"}</span>
                        <span className="text-xs text-agro-muted w-32 hidden sm:block truncate">{c.phone ?? "—"}</span>
                        <span className={cn("text-xs w-32 text-right hidden md:flex items-center justify-end gap-1 font-medium",
                          hasPending ? "text-amber-400" : "text-agro-muted-2")}
                        >
                          {hasMultDates && (
                            <AlertTriangle
                              className="w-3 h-3 text-amber-500 shrink-0"
                              title="Boletos em datas diferentes. Use o filtro de vencimento para escolher uma data específica."
                            />
                          )}
                          {hasPending ? enriched.valor_total_pendente : "—"}
                        </span>
                        {showSubPanel && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onToggleExpand(c.id); }}
                            className="ml-1 w-5 h-5 flex items-center justify-center text-agro-muted hover:text-agro-green transition-colors shrink-0"
                          >
                            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isExpanded && "rotate-180")} />
                          </button>
                        )}
                      </div>

                      {showSubPanel && isExpanded && (
                        <div
                          className="mx-4 mb-2 rounded-lg overflow-hidden"
                          style={{ background: "rgba(10,18,13,0.8)", border: "1px solid rgba(63,176,108,0.15)" }}
                        >
                          {/* Column header */}
                          <div className="flex items-center gap-2 px-3 py-1.5"
                            style={{ borderBottom: "1px solid rgba(63,176,108,0.08)", background: "rgba(13,26,17,0.6)" }}
                          >
                            {filterDate && <span className="w-3.5 shrink-0" />}
                            <span className="text-[10px] text-agro-muted-2 uppercase tracking-wider flex-1">NF / Boleto</span>
                            <span className="text-[10px] text-agro-muted-2 uppercase tracking-wider w-20 text-center">Vencimento</span>
                            <span className="text-[10px] text-agro-muted-2 uppercase tracking-wider w-20 text-right">Valor</span>
                            {!filterDate && <span className="text-[10px] text-agro-muted-2 uppercase tracking-wider w-16 text-right">Status</span>}
                          </div>

                          {dateInvoices.map((inv, idx) => {
                            const dueStr  = inv.vencimento
                              ? (() => { const [y,m,d] = inv.vencimento!.split("-"); return `${d}/${m}/${y}`; })()
                              : "—";
                            const valor   = Number(inv.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                            const status  = (inv.status ?? "").toLowerCase();
                            const overdue = status === "vencido";
                            const isLast  = idx === dateInvoices.length - 1;

                            if (filterDate) {
                              const checked = isInvChecked(inv.id);
                              return (
                                <div
                                  key={inv.id}
                                  onClick={(e) => { e.stopPropagation(); onToggleInvoice(c.id, inv.id, allInvIds); }}
                                  className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
                                  style={!isLast ? { borderBottom: "1px solid rgba(63,176,108,0.05)" } : undefined}
                                >
                                  <div className={cn("w-3.5 h-3.5 rounded flex items-center justify-center border shrink-0 transition-all",
                                    checked ? "bg-agro-green border-agro-green" : "border-agro-muted-2")}>
                                    {checked && <Check className="w-2 h-2 text-white" />}
                                  </div>
                                  <span className="text-xs text-agro-muted flex-1 truncate">
                                    {inv.numero_nf ? `NF ${inv.numero_nf}` : "Boleto"}
                                  </span>
                                  <span className="text-xs text-agro-muted-2 w-20 text-center">{dueStr}</span>
                                  <span className="text-xs font-semibold text-amber-400 w-20 text-right">{valor}</span>
                                </div>
                              );
                            }

                            return (
                              <div
                                key={inv.id}
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-2 px-3 py-1.5"
                                style={!isLast ? { borderBottom: "1px solid rgba(63,176,108,0.05)" } : undefined}
                              >
                                <span className="text-xs text-agro-muted flex-1 truncate">
                                  {inv.numero_nf ? `NF ${inv.numero_nf}` : "Boleto"}
                                </span>
                                <span className={cn("text-xs w-20 text-center", overdue ? "text-red-400" : "text-agro-muted-2")}>
                                  {dueStr}
                                </span>
                                <span className="text-xs font-semibold text-amber-400 w-20 text-right">{valor}</span>
                                <span className={cn(
                                  "text-[10px] px-1.5 py-0.5 rounded-full font-semibold w-16 text-center shrink-0",
                                  overdue ? "text-red-400 bg-red-400/10" : "text-agro-green bg-agro-green/10"
                                )}>
                                  {overdue ? "vencido" : "pendente"}
                                </span>
                              </div>
                            );
                          })}

                          {/* Footer: total + count */}
                          <div className="px-3 py-1.5 flex items-center justify-between"
                            style={{ background: "rgba(63,176,108,0.05)", borderTop: "1px solid rgba(63,176,108,0.08)" }}
                          >
                            <span className="text-[10px] text-agro-muted-2 uppercase tracking-wider">
                              {filterDate
                                ? `${dateInvoices.length} boleto${dateInvoices.length !== 1 ? "s" : ""} · total selecionado`
                                : `${allPending.length} boleto${allPending.length !== 1 ? "s" : ""} pendente${allPending.length !== 1 ? "s" : ""}`}
                            </span>
                            <span className="text-xs font-bold text-agro-green">{enriched.valor_total_pendente}</span>
                          </div>
                        </div>
                      )}
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
// Full template preview card (header + body + footer + buttons)
// ─────────────────────────────────────────────────────────

function TemplateDisplay({
  template, varMap, data, isPreview = false,
}: {
  template: MetaTemplate;
  varMap?: Record<string, string>;
  data?: Record<string, unknown> | null;
  isPreview?: boolean;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comps   = template.components as any[];
  const header  = comps.find((c) => c.type === "HEADER");
  const body    = comps.find((c) => c.type === "BODY");
  const footer  = comps.find((c) => c.type === "FOOTER");
  const buttons = comps.find((c) => c.type === "BUTTONS");

  function sub(text: string): string {
    if (!varMap || !data) return text;
    let t = text;
    for (const [idx, field] of Object.entries(varMap)) {
      const val = data[field] ?? `{{${idx}}}`;
      t = t.replaceAll(`{{${idx}}}`, String(val));
    }
    return t;
  }

  const containerStyle = isPreview
    ? { background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.18)" }
    : { background: "rgba(13,26,17,0.5)", border: "1px solid rgba(63,176,108,0.08)" };

  const mediaLabel =
    header?.format === "IMAGE"    ? "📷  Imagem"   :
    header?.format === "VIDEO"    ? "🎥  Vídeo"    :
    header?.format === "DOCUMENT" ? "📄  Documento" : null;

  return (
    <div className="rounded-xl overflow-hidden text-sm" style={containerStyle}>
      {/* HEADER */}
      {header && (
        <div className="px-4 pt-3 pb-2.5" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
          {header.format === "TEXT" && header.text ? (
            <p className={cn("font-bold leading-snug", isPreview ? "text-agro-text" : "text-agro-muted")}>
              {sub(header.text)}
            </p>
          ) : mediaLabel ? (
            <div className="w-full h-12 rounded-lg flex items-center justify-center text-xs text-agro-muted-2 gap-1.5"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(63,176,108,0.2)" }}
            >
              {mediaLabel}
            </div>
          ) : null}
        </div>
      )}

      {/* BODY */}
      {body?.text && (
        <p className={cn("px-4 py-3 leading-relaxed", isPreview ? "text-agro-text" : "text-agro-muted")}
          style={{ whiteSpace: "pre-wrap" }}
        >
          {sub(body.text)}
        </p>
      )}

      {/* FOOTER */}
      {footer?.text && (
        <p className="px-4 pt-1 pb-2.5 text-xs text-agro-muted-2"
          style={{ borderTop: "1px solid rgba(63,176,108,0.06)" }}
        >
          {footer.text}
        </p>
      )}

      {/* BUTTONS */}
      {buttons?.buttons?.length > 0 && (
        <div className="px-3 pb-3 pt-1.5 flex flex-col gap-1"
          style={{ borderTop: "1px solid rgba(63,176,108,0.1)" }}
        >
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {(buttons.buttons as any[]).map((btn, i: number) => (
            <div key={i}
              className="text-center text-xs text-agro-green font-semibold py-1.5 rounded-lg"
              style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.15)" }}
            >
              {btn.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Step 3 — N8N Email Confirmation
// ─────────────────────────────────────────────────────────

function Step3N8NConfirmation({
  totalRecipients,
  campaignName,
}: {
  totalRecipients: number;
  campaignName: string;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-bold text-agro-text mb-1">Confirmar disparo</h3>
        <p className="text-sm text-agro-muted">Revise os detalhes antes de enviar ao N8N.</p>
      </div>

      {/* Summary card */}
      <div className="p-6 rounded-2xl space-y-4"
        style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.2)" }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.2)" }}
          >
            <Mail className="w-5 h-5 text-agro-green" />
          </div>
          <div>
            <p className="text-sm font-bold text-agro-text">{campaignName || "Campanha"}</p>
            <p className="text-xs text-agro-muted">Disparo via Email · N8N</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="px-4 py-3 rounded-xl text-center"
            style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.12)" }}
          >
            <p className="text-2xl font-bold text-agro-green">{totalRecipients.toLocaleString("pt-BR")}</p>
            <p className="text-xs text-agro-muted mt-0.5">destinatários</p>
          </div>
          <div className="px-4 py-3 rounded-xl text-center"
            style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.12)" }}
          >
            <p className="text-2xl font-bold text-blue-400">N8N</p>
            <p className="text-xs text-agro-muted mt-0.5">processamento externo</p>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">Como funciona</p>
        <div className="space-y-2">
          {[
            { step: "1", text: "Solve AI envia os dados de todos os destinatários para o webhook N8N" },
            { step: "2", text: "N8N aplica o template de email e envia para cada destinatário" },
            { step: "3", text: "N8N retorna o status individual (enviado, falha, etc.) para o Supabase" },
            { step: "4", text: "O detalhamento do disparo é atualizado em tempo real" },
          ].map((item) => (
            <div key={item.step} className="flex items-start gap-3 px-4 py-3 rounded-xl"
              style={{ background: "rgba(13,26,17,0.5)", border: "1px solid rgba(63,176,108,0.08)" }}
            >
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
                style={{ background: "rgba(63,176,108,0.3)" }}
              >
                {item.step}
              </span>
              <p className="text-sm text-agro-muted">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
        style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}
      >
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300 leading-relaxed">
          Ao clicar em <strong>Disparar via Email</strong>, o payload será enviado imediatamente ao N8N.
          A campanha ficará com status <em>Enviando</em> até que todos os retornos sejam recebidos.
        </p>
      </div>
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
          <TemplateDisplay template={template} />
        </div>
        {previewData && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest flex items-center gap-1.5">
              <Eye className="w-3 h-3" /> Preview — 1º contato
            </p>
            <TemplateDisplay template={template} varMap={varMap} data={previewData} isPreview />
          </div>
        )}
      </div>
    </div>
  );
}
