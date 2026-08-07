import { useCallback, useEffect, useState } from "react";
import {
  Users, Upload, Search, ChevronLeft, ChevronRight, Loader2, UserCircle2,
  Plus, Download, Sparkles, ArrowUpAZ, ArrowDownAZ, X, Filter, Trash2,
  AlertTriangle,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { OPEN_INVOICE_STATUSES } from "@/lib/invoiceStatus";
import { safeFilterTerm } from "@/lib/utils";
import { formatPhone, diasDeAtraso } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ImportModal } from "./contacts/ImportModal";
import { ContactPanel, Contact, tagColor, formatBRL, formatDate } from "./contacts/ContactPanel";
import { Presence } from "@/components/ui/Presence";
import { ContactFormModal } from "./contacts/ContactFormModal";
import { BaseCleanup } from "./contacts/BaseCleanup";
import { log } from "@/lib/logger";

// ── Constants ──────────────────────────────────────────────────────

const PAGE_SIZE = 25;

// ── Helpers ────────────────────────────────────────────────────────


type SortOrder = "name_asc" | "name_desc";

// ── Hook ───────────────────────────────────────────────────────────

function useContacts(
  search: string,
  page: number,
  sortOrder: SortOrder,
  contactIds: string[] | null,   // null = no invoice filter; [] = filter active but no results
) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(false);
  const workspaceId = useAuth().workspaceId ?? "";

  const load = useCallback(async () => {
    // If filter is active with 0 results, short-circuit
    if (contactIds !== null && contactIds.length === 0) {
      setContacts([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;
    const asc  = sortOrder === "name_asc";

    let q = supabase
      .from("inbox_contacts")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: asc })
      .range(from, to);

    const s = safeFilterTerm(search);
    if (s) {
      q = q.or(`name.ilike.%${s}%,cpf_cnpj.ilike.%${s}%,phone.ilike.%${s}%,empresa.ilike.%${s}%`);
    }

    if (contactIds !== null) {
      q = q.in("id", contactIds);
    }

    const { data, count, error } = await q;
    if (error) {
      // Antes o erro era descartado: a tela mostrava lista vazia e o usuário
      // concluía que não havia contatos.
      log.error("contacts_load_failed", { err: error.message, workspace_id: workspaceId });
    } else {
      setContacts(data ?? []);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [search, page, workspaceId, sortOrder, contactIds]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel("contacts-list-rt")
      .on("postgres_changes", {
        event: "*", schema: "public", table: "inbox_contacts",
        filter: `workspace_id=eq.${workspaceId}`,
      }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [workspaceId, load]);

  return { contacts, total, loading, refresh: load };
}

// ── XLSX Export ────────────────────────────────────────────────────

async function exportXlsx(workspaceId: string) {
  const { data: allContacts } = await supabase
    .from("inbox_contacts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });

  const contacts: Contact[] = allContacts ?? [];

  const { data: allInvoices } = await supabase
    .from("contact_invoices")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("vencimento", { ascending: true });

  const invoices: Array<Record<string, unknown>> = allInvoices ?? [];

  const { data: allNotes } = await supabase
    .from("contact_notes")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  const notes: Array<Record<string, unknown>> = allNotes ?? [];

  const contactRows = contacts.map((c) => ({
    "Nome":               c.name ?? "",
    "Empresa":            c.empresa ?? "",
    "Telefone":           c.phone ?? "",
    "CPF / CNPJ":         c.cpf_cnpj ?? "",
    "Email":              c.email ?? "",
    "Email 2":            c.email2 ?? "",
    "Representante":      c.nome_representante ?? "",
    "Email Representante": c.email_representante ?? "",
    "CEP":                c.cep ?? "",
    "Logradouro":         c.logradouro ?? "",
    "Número":             c.numero ?? "",
    "Complemento":        c.complemento ?? "",
    "Bairro":             c.bairro ?? "",
    "Cidade":             c.cidade ?? "",
    "Estado":             c.estado ?? "",
    "Tags":               (c.tags ?? []).join(", "),
    "Cadastrado em":      c.created_at ? new Date(c.created_at).toLocaleDateString("pt-BR") : "",
  }));

  const contactMap = new Map(contacts.map((c) => [c.id, c.name ?? c.phone ?? c.id]));
  const invoiceRows = invoices.map((inv) => ({
    "Contato":          contactMap.get(inv.contact_id as string) ?? "",
    "Número NF":        inv.numero_nf ?? "",
    "Valor":            typeof inv.valor === "number" ? inv.valor : "",
    "Vencimento":       formatDate(inv.vencimento as string | null),
    "Status":           inv.status ?? "",
    "Código de Barras": inv.codigo_barras ?? "",
  }));

  const TYPE_LABELS: Record<string, string> = {
    nota: "Nota", ligacao: "Ligação", email: "E-mail",
    reuniao: "Reunião", follow_up: "Follow-up", acao: "Ação urgente",
  };
  const noteRows = notes.map((n) => ({
    "Contato":         n.contact_name ?? "",
    "Telefone":        n.contact_phone ?? "",
    "Tipo":            TYPE_LABELS[n.type as string] ?? (n.type as string),
    "Conteúdo":        n.content ?? "",
    "Registrado por":  n.created_by_name ?? "",
    "Data follow-up":  n.follow_up_date ? formatDate(n.follow_up_date as string) : "",
    "Follow-up feito": n.follow_up_done ? "Sim" : "Não",
    "Data registro":   n.created_at ? new Date(n.created_at as string).toLocaleString("pt-BR") : "",
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRows),  "Contatos");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invoiceRows),  "Boletos");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(noteRows),     "Histórico");

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `contatos_${date}.xlsx`);
}

// ── Tag chips ──────────────────────────────────────────────────────

function TagChips({ tags }: { tags: string[] }) {
  const visible = tags.slice(0, 2);
  const rest    = tags.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tag) => {
        const c = tagColor(tag);
        return (
          <span
            key={tag}
            className="px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
            style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
          >
            {tag}
          </span>
        );
      })}
      {rest > 0 && (
        <span className="px-2 py-0.5 rounded-full text-[11px] text-[#6b7f6e] bg-[#1e2e22]">
          +{rest}
        </span>
      )}
    </div>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────

function Avatar({ name }: { name: string | null }) {
  if (!name) return <UserCircle2 className="w-8 h-8 text-[#6b7f6e]" />;
  const parts = name.trim().split(/\s+/);
  const ini = parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (
    <div
      className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0"
      style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
    >
      {ini}
    </div>
  );
}

// ── Pagination ─────────────────────────────────────────────────────

function Pagination({
  page, total, onPrev, onNext,
}: { page: number; total: number; onPrev: () => void; onNext: () => void }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-[#1e2e22] shrink-0">
      <p className="text-xs text-[#6b7f6e]">
        {total} contato{total !== 1 ? "s" : ""} · página <span className="text-white">{page}</span> de {pages}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={page === 1}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#2a3d30] text-xs text-[#6b7f6e] disabled:opacity-40 hover:border-[#3fb06c]/50 hover:text-white transition-colors disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Anterior
        </button>
        <button
          onClick={onNext}
          disabled={page >= pages}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#2a3d30] text-xs text-[#6b7f6e] disabled:opacity-40 hover:border-[#3fb06c]/50 hover:text-white transition-colors disabled:cursor-not-allowed"
        >
          Próxima <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────

function EmptyState({ search, hasFilters, onImport }: { search: string; hasFilters: boolean; onImport: () => void }) {
  if (search || hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Search className="w-8 h-8 text-[#6b7f6e] mb-3" />
        <p className="text-sm font-medium text-white">Nenhum resultado encontrado</p>
        <p className="text-xs text-[#6b7f6e] mt-1">Ajuste os filtros ou a busca.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[#1e2e22] flex items-center justify-center mb-4">
        <Users className="w-8 h-8 text-[#3fb06c]/40" />
      </div>
      <p className="text-base font-semibold text-white mb-1">Nenhum contato ainda</p>
      <p className="text-sm text-[#6b7f6e] mb-5 max-w-xs">
        Importe uma planilha CSV ou XLSX para adicionar contatos e boletos em massa.
      </p>
      <button onClick={onImport} className="btn-agro flex items-center gap-2 px-5 py-2.5 text-sm mx-auto">
        <Upload className="w-4 h-4" /> Importar planilha
      </button>
    </div>
  );
}

// ── Column header helper ───────────────────────────────────────────

/** Fundo opaco das colunas fixas — acompanha o estado da linha.
 *  Precisa ser opaco: célula fixa translúcida deixa o conteúdo das colunas de
 *  trás aparecer por baixo durante o scroll horizontal. Os valores são a
 *  mistura já resolvida (a seleção é rgba(63,176,108,0.05) sobre #0d1710). */
const BG_LINHA          = "#0d1710";
const BG_LINHA_SELECIONADA = "#0f1f15";

function TH({
  children, className = "", style, sortKey, sortOrder, onSort,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  sortKey?: "name";
  sortOrder?: SortOrder;
  onSort?: () => void;
}) {
  const isSorted = sortKey && sortOrder?.startsWith(sortKey);
  return (
    <th
      className={`px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] whitespace-nowrap ${className} ${onSort ? "cursor-pointer select-none hover:text-white transition-colors" : ""}`}
      style={style}
      onClick={onSort}
    >
      <span className="flex items-center gap-1">
        {children}
        {onSort && (
          isSorted
            ? sortOrder === "name_asc"
              ? <ArrowUpAZ className="w-3 h-3 text-[#3fb06c]" />
              : <ArrowDownAZ className="w-3 h-3 text-[#3fb06c]" />
            : <ArrowUpAZ className="w-3 h-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

// ── Filter bar ─────────────────────────────────────────────────────

interface FilterState {
  sortOrder: SortOrder;
  hasInvoice: boolean;
  vencFrom: string;
  vencTo: string;
  tags: string[];
}

const FILTER_INITIAL: FilterState = {
  sortOrder:  "name_asc",
  hasInvoice: false,
  vencFrom:   "",
  vencTo:     "",
  tags:       [],
};

function FilterBar({
  filters,
  onChange,
  activeCount,
  onClear,
}: {
  filters: FilterState;
  onChange: (p: Partial<FilterState>) => void;
  activeCount: number;
  onClear: () => void;
}) {
  return (
    <div
      className="px-6 py-3 shrink-0 flex flex-wrap items-center gap-4"
      style={{ borderBottom: "1px solid #1e2e22", background: "rgba(13,26,17,0.6)" }}
    >
      {/* Sort */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-[#6b7f6e] uppercase tracking-widest">Ordem</span>
        <div className="flex rounded-lg overflow-hidden border border-[#2a3d30]">
          {(["name_asc", "name_desc"] as SortOrder[]).map((s) => (
            <button
              key={s}
              onClick={() => onChange({ sortOrder: s })}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors"
              style={filters.sortOrder === s
                ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c" }
                : { background: "transparent", color: "#6b7f6e" }}
            >
              {s === "name_asc" ? <><ArrowUpAZ className="w-3.5 h-3.5" /> A-Z</> : <><ArrowDownAZ className="w-3.5 h-3.5" /> Z-A</>}
            </button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-[#2a3d30]" />

      {/* Has invoice toggle */}
      <button
        onClick={() => onChange({ hasInvoice: !filters.hasInvoice })}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
        style={filters.hasInvoice
          ? { background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", color: "#f59e0b" }
          : { background: "transparent", border: "1px solid #2a3d30", color: "#6b7f6e" }}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: filters.hasInvoice ? "#f59e0b" : "#3a4d3e" }}
        />
        Com boleto
      </button>

      {/* Vencimento range */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-[#6b7f6e] uppercase tracking-widest">Venc.</span>
        <input
          type="date"
          value={filters.vencFrom}
          onChange={(e) => onChange({ hasInvoice: true, vencFrom: e.target.value })}
          className="bg-[#111a14] border border-[#2a3d30] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-[#3fb06c] transition-colors"
          style={{ width: 130 }}
        />
        <span className="text-[#6b7f6e] text-xs">até</span>
        <input
          type="date"
          value={filters.vencTo}
          onChange={(e) => onChange({ hasInvoice: true, vencTo: e.target.value })}
          className="bg-[#111a14] border border-[#2a3d30] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-[#3fb06c] transition-colors"
          style={{ width: 130 }}
        />
      </div>

      {/* Clear */}
      {activeCount > 0 && (
        <button
          onClick={onClear}
          className="flex items-center gap-1.5 text-xs text-[#6b7f6e] hover:text-white transition-colors ml-auto"
        >
          <X className="w-3.5 h-3.5" />
          Limpar filtros {activeCount > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: "rgba(63,176,108,0.15)", color: "#3fb06c" }}>{activeCount}</span>}
        </button>
      )}
    </div>
  );
}

// ── Bulk action bar ────────────────────────────────────────────────

function BulkActionBar({
  count,
  onDelete,
  onClear,
}: { count: number; onDelete: () => void; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-5 py-3 rounded-2xl shadow-2xl"
      style={{
        background: "#0d1a11",
        border: "1px solid rgba(63,176,108,0.3)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(63,176,108,0.1)",
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold text-white"
          style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
        >
          {count}
        </div>
        <span className="text-sm text-white font-medium">
          contato{count !== 1 ? "s" : ""} selecionado{count !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="h-4 w-px bg-[#2a3d30]" />

      <button
        onClick={onDelete}
        className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-sm font-medium transition-all"
        style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239,68,68,0.2)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(239,68,68,0.12)")}
      >
        <Trash2 className="w-3.5 h-3.5" />
        Excluir selecionados
      </button>

      <button
        onClick={onClear}
        className="text-[#6b7f6e] hover:text-white transition-colors"
        title="Cancelar seleção"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Delete confirm modal ───────────────────────────────────────────

function DeleteConfirmModal({
  count,
  onConfirm,
  onCancel,
  loading,
}: { count: number; onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div
        className="w-full max-w-md mx-4 rounded-2xl p-6"
        style={{ background: "#0d1a11", border: "1px solid rgba(239,68,68,0.3)" }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(239,68,68,0.12)" }}>
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="text-base font-semibold text-white">Excluir {count} contato{count !== 1 ? "s" : ""}?</p>
            <p className="text-xs text-[#6b7f6e] mt-0.5">Esta ação não pode ser desfeita.</p>
          </div>
        </div>

        <div className="p-3 rounded-xl mb-5 text-sm text-red-300" style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.15)" }}>
          Serão excluídos permanentemente:
          <ul className="mt-1.5 space-y-0.5 text-xs text-[#6b7f6e] list-disc list-inside">
            <li>{count} contato{count !== 1 ? "s" : ""}</li>
            <li>Todos os boletos vinculados</li>
            <li>Todo o histórico de notas</li>
          </ul>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-[#6b7f6e] hover:text-white transition-colors border border-[#2a3d30] hover:border-[#3a5040]"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white transition-all flex items-center justify-center gap-2"
            style={{ background: loading ? "rgba(239,68,68,0.3)" : "#dc2626", border: "1px solid rgba(239,68,68,0.5)" }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {loading ? "Excluindo…" : "Sim, excluir tudo"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────

export function Contacts() {
  const [search,          setSearch]         = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page,            setPage]           = useState(1);
  const [selected,        setSelected]       = useState<Contact | null>(null);
  const [showImport,      setShowImport]     = useState(false);
  const [showNewContact,  setShowNewContact] = useState(false);
  const [exporting,       setExporting]      = useState(false);
  const [mainTab,         setMainTab]        = useState<"lista" | "limpeza">("lista");
  const [filters,         setFilters]        = useState<FilterState>(FILTER_INITIAL);
  const [showFilters,     setShowFilters]    = useState(false);
  const [selectedIds,     setSelectedIds]    = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting,        setDeleting]       = useState(false);

  // Invoice filter: resolve contact IDs from contact_invoices
  const [contactIds,     setContactIds]     = useState<string[] | null>(null);
  const [filterLoading,  setFilterLoading]  = useState(false);

  // Invoice totals for current page contacts (per-row display)
  const [invoiceTotals, setInvoiceTotals] = useState<Record<string, { total: number; nextDue: string | null }>>({});

  // Aggregate total for ALL filtered contacts (not just current page)
  const [filteredTotal,        setFilteredTotal]        = useState<number | null>(null);
  const [filteredTotalLoading, setFilteredTotalLoading] = useState(false);

  // Grand total: soma de TODOS os boletos do workspace (ignora filtros)
  const [globalTotal,        setGlobalTotal]        = useState<number | null>(null);
  const [globalTotalLoading, setGlobalTotalLoading] = useState(false);

  const workspaceId = useAuth().workspaceId ?? "";
  const { toast } = useToast();

  // contacts must be declared before the selection helpers that reference it.
  // useContacts is a hook so it must be called unconditionally at the top level.
  const { contacts, total, loading, refresh } = useContacts(
    debouncedSearch, page, filters.sortOrder, contactIds,
  );
  const pages = Math.ceil(total / PAGE_SIZE);

  // Selection helpers
  const allPageSelected = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));
  const somePageSelected = contacts.some((c) => selectedIds.has(c.id));

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        contacts.forEach((c) => next.delete(c.id));
      } else {
        contacts.forEach((c) => next.add(c.id));
      }
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    setDeleting(true);
    try {
      const ids = [...selectedIds];

      const phones = contacts
        .filter((c) => ids.includes(c.id) && c.phone)
        .map((c) => c.phone as string);

      // 1. Get conversation IDs for these contacts (needed for campaign_alerts)
      const { data: convRows } = await supabase
        .from("inbox_conversations")
        .select("id")
        .in("contact_id", ids);
      const convIds = (convRows ?? []).map((r: { id: string }) => r.id);

      // 2. Delete campaign_alerts linked to these conversations (NO ACTION FK)
      if (convIds.length > 0) {
        const { error: alertsErr } = await supabase
          .from("campaign_alerts")
          .delete()
          .in("conversation_id", convIds);
        if (alertsErr) throw new Error(`campaign_alerts: ${alertsErr.message}`);
      }

      // 3. Delete conversations (inbox_messages cascade-delete automatically)
      if (convIds.length > 0) {
        const { error: convsErr } = await supabase
          .from("inbox_conversations")
          .delete()
          .in("id", convIds);
        if (convsErr) throw new Error(`inbox_conversations: ${convsErr.message}`);
      }

      // 4. Delete invoices
      const { error: invErr } = await supabase
        .from("contact_invoices")
        .delete()
        .in("contact_id", ids);
      if (invErr) throw new Error(`contact_invoices: ${invErr.message}`);

      // 5. Delete notes
      if (phones.length > 0) {
        const { error: notesErr } = await supabase
          .from("contact_notes")
          .delete()
          .eq("workspace_id", workspaceId)
          .in("contact_phone", phones);
        if (notesErr) throw new Error(`contact_notes: ${notesErr.message}`);
      }

      // 6. Delete contacts
      const { error: contactsErr } = await supabase
        .from("inbox_contacts")
        .delete()
        .eq("workspace_id", workspaceId)
        .in("id", ids);
      if (contactsErr) throw new Error(`inbox_contacts: ${contactsErr.message}`);

      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
      refresh();
      toast({ title: `${ids.length} contato${ids.length !== 1 ? "s" : ""} excluído${ids.length !== 1 ? "s" : ""}`, variant: "success" });
    } catch (err) {
      toast({ title: "Erro ao excluir contatos", description: (err as Error).message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  function patchFilters(p: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...p }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(FILTER_INITIAL);
    setContactIds(null);
    setPage(1);
  }

  const activeFilterCount = [
    filters.hasInvoice,
    !!filters.vencFrom,
    !!filters.vencTo,
  ].filter(Boolean).length;

  // Search debounce
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Resolve contact IDs when invoice filter is active
  useEffect(() => {
    if (!filters.hasInvoice && !filters.vencFrom && !filters.vencTo) {
      setContactIds(null);
      return;
    }
    let cancelled = false;
    setFilterLoading(true);
    let q = supabase
      .from("contact_invoices")
      .select("contact_id")
      .eq("workspace_id", workspaceId);
    if (filters.vencFrom) q = q.gte("vencimento", filters.vencFrom);
    if (filters.vencTo)   q = q.lte("vencimento", filters.vencTo);
    q.then(({ data }: { data: { contact_id: string }[] | null }) => {
      if (cancelled) return;
      const ids = [...new Set((data ?? []).map((r) => r.contact_id))];
      setContactIds(ids);
      setFilterLoading(false);
    });
    return () => { cancelled = true; };
  }, [filters.hasInvoice, filters.vencFrom, filters.vencTo, workspaceId]);

  // Compute aggregate invoice total for ALL contacts matching current filters
  useEffect(() => {
    let cancelled = false;
    setFilteredTotalLoading(true);

    async function compute() {
      // Start with contactIds from the invoice filter (null = whole workspace)
      let idsToSum: string[] | null = contactIds;

      // If search is active, intersect with search results
      const s = safeFilterTerm(debouncedSearch);
      if (s) {
        const { data } = await supabase
          .from("inbox_contacts")
          .select("id")
          .eq("workspace_id", workspaceId)
          .or(`name.ilike.%${s}%,cpf_cnpj.ilike.%${s}%,phone.ilike.%${s}%,empresa.ilike.%${s}%`);
        if (cancelled) return;
        const searchIds = (data ?? []).map((r: { id: string }) => r.id) as string[];
        if (idsToSum !== null) {
          const set = new Set(idsToSum);
          idsToSum = searchIds.filter((id) => set.has(id));
        } else {
          idsToSum = searchIds;
        }
      }

      if (idsToSum !== null && idsToSum.length === 0) {
        if (!cancelled) { setFilteredTotal(0); setFilteredTotalLoading(false); }
        return;
      }

      let q = supabase
        .from("contact_invoices")
        .select("valor")
        .eq("workspace_id", workspaceId)
        // Sem este filtro a soma incluía `pago` e `cancelado` — o rótulo diz
        // "em aberto", então tem que ser só o que ainda é devido.
        .in("status", OPEN_INVOICE_STATUSES as unknown as string[]);
      if (idsToSum !== null) q = q.in("contact_id", idsToSum);
      if (filters.vencFrom)  q = q.gte("vencimento", filters.vencFrom);
      if (filters.vencTo)    q = q.lte("vencimento", filters.vencTo);

      const { data } = await q;
      if (cancelled) return;

      const sum = (data ?? []).reduce(
        (s: number, r: { valor: number | null }) => s + (r.valor ?? 0), 0,
      );
      setFilteredTotal(sum);
      setFilteredTotalLoading(false);
    }

    compute();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, contactIds, filters.vencFrom, filters.vencTo, workspaceId]);

  // Grand total: soma de TODOS os boletos do workspace, sem filtro
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setGlobalTotalLoading(true);
    // Antes isto baixava TODA linha de contact_invoices do workspace para somar
    // no navegador. Além do tráfego, ficava silenciosamente errado se a
    // resposta fosse truncada pelo teto de linhas do PostgREST — o total
    // aparecia menor sem nenhum erro. A RPC soma no Postgres e devolve um
    // número; de quebra a soma é NUMERIC, sem erro de ponto flutuante.
    supabase
      .rpc("invoice_total_workspace", { p_workspace_id: workspaceId })
      .then(({ data, error }: { data: number | null; error: { message: string } | null }) => {
        if (cancelled) return;
        if (error) {
          log.error("Falha ao somar total de boletos do workspace", { err: error.message });
          setGlobalTotal(null);
        } else {
          setGlobalTotal(Number(data ?? 0));
        }
        setGlobalTotalLoading(false);
      });
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Fetch invoice totals for current page of contacts
  useEffect(() => {
    if (contacts.length === 0) { setInvoiceTotals({}); return; }
    const ids = contacts.map((c) => c.id);
    supabase
      // Agrupa no banco. A mesma regra de "em aberto" das outras somas vive
      // dentro da função, então a lista não pode divergir do rodapé nem da
      // variável usada nas mensagens de campanha.
      .rpc("invoice_totais_por_contato", { p_workspace_id: workspaceId, p_contact_ids: ids })
      .then(({ data, error }: {
        data: { contact_id: string; total: number | null; proximo_vencimento: string | null }[] | null;
        error: { message: string } | null;
      }) => {
        if (error) {
          log.error("Falha ao carregar totais por contato", { err: error.message });
          setInvoiceTotals({});
          return;
        }
        const map: Record<string, { total: number; nextDue: string | null }> = {};
        for (const row of (data ?? [])) {
          map[row.contact_id] = {
            total:   Number(row.total ?? 0),
            nextDue: row.proximo_vencimento,
          };
        }
        setInvoiceTotals(map);
      });
  }, [contacts, workspaceId]);

  async function handleExport() {
    setExporting(true);
    try { await exportXlsx(workspaceId); } finally { setExporting(false); }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#0a110e" }}>

      {/* ── Topbar ───────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid #1e2e22" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#1e2e22] flex items-center justify-center">
            <Users className="w-5 h-5 text-[#3fb06c]" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">Contatos</h1>
            <p className="text-xs text-[#6b7f6e]">
              {loading || filterLoading
                ? "Carregando…"
                : `${total} contato${total !== 1 ? "s" : ""} cadastrado${total !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting || total === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl text-[#6b7f6e] transition-colors hover:bg-[#1e2e22] hover:text-white disabled:opacity-40"
            style={{ border: "1px solid #2a3d30" }}
          >
            <Download className={`w-4 h-4 ${exporting ? "animate-pulse" : ""}`} />
            {exporting ? "Exportando…" : "Exportar XLSX"}
          </button>
          <button
            onClick={() => setShowNewContact(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl text-[#3fb06c] transition-colors hover:bg-[#1e2e22]"
            style={{ border: "1px solid rgba(63,176,108,0.3)" }}
          >
            <Plus className="w-4 h-4" /> Novo Contato
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="btn-agro flex items-center gap-2 px-4 py-2 text-sm"
          >
            <Upload className="w-4 h-4" /> Importar planilha
          </button>
        </div>
      </div>

      {/* ── Main tabs ────────────────────────────────── */}
      <div className="px-6 shrink-0 flex gap-1 pt-3" style={{ borderBottom: "1px solid #1e2e22" }}>
        {[
          { id: "lista"   as const, label: "Contatos",       icon: Users    },
          { id: "limpeza" as const, label: "Limpeza de Base", icon: Sparkles },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMainTab(id)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px"
            style={mainTab === id
              ? { color: "#3fb06c", borderColor: "#3fb06c", background: "rgba(63,176,108,0.04)" }
              : { color: "#6b7f6e", borderColor: "transparent" }}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Limpeza tab ──────────────────────────────── */}
      {mainTab === "limpeza" && (
        <div className="flex-1 overflow-auto">
          <BaseCleanup workspaceId={workspaceId} />
        </div>
      )}

      {/* ── Search + filter toggle ────────────────────── */}
      {mainTab === "lista" && (
        <div className="px-6 py-3 shrink-0 flex items-center gap-3" style={{ borderBottom: showFilters ? "none" : "1px solid #1e2e22" }}>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b7f6e]" />
            <input
              type="text"
              placeholder="Buscar por nome, CPF, telefone ou empresa…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#111a14] border border-[#2a3d30] rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-[#6b7f6e] focus:outline-none focus:border-[#3fb06c] transition-colors"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all border"
            style={showFilters || activeFilterCount > 0
              ? { background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.3)", color: "#3fb06c" }
              : { background: "transparent", border: "1px solid #2a3d30", color: "#6b7f6e" }}
          >
            <Filter className="w-4 h-4" />
            Filtros
            {activeFilterCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: "rgba(63,176,108,0.2)", color: "#3fb06c" }}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ── Filter bar ───────────────────────────────── */}
      {mainTab === "lista" && showFilters && (
        <FilterBar
          filters={filters}
          onChange={patchFilters}
          activeCount={activeFilterCount}
          onClear={clearFilters}
        />
      )}

      {/* ── Summary strip ────────────────────────────── */}
      {mainTab === "lista" && total > 0 && (
        <div
          className="px-6 py-2 shrink-0 flex items-center justify-between text-xs"
          style={{ borderBottom: "1px solid #1e2e22", background: "rgba(10,17,14,0.8)" }}
        >
          <span className="text-[#6b7f6e]">
            <span className="text-white font-semibold">{total}</span>{" "}
            contato{total !== 1 ? "s" : ""} encontrado{total !== 1 ? "s" : ""}
            {(activeFilterCount > 0 || debouncedSearch) ? " (filtrado)" : ""}
          </span>

          <span className="flex items-center gap-4">
            {/* Total filtrado — só aparece quando há filtro/busca ativo */}
            {(activeFilterCount > 0 || debouncedSearch) && (
              <span className="flex items-center gap-2">
                <span className="text-[#6b7f6e]">Saldo filtrado:</span>
                {filteredTotalLoading ? (
                  <Loader2 className="w-3 h-3 text-[#3fb06c] animate-spin" />
                ) : filteredTotal !== null && filteredTotal > 0 ? (
                  <span className="font-bold text-amber-400 text-sm tabular-nums">{formatBRL(filteredTotal)}</span>
                ) : (
                  <span className="text-[#3a4d3e]">—</span>
                )}
              </span>
            )}
            {/* Total geral — sempre visível */}
            <span className="flex items-center gap-2">
              <span className="text-[#6b7f6e]">Total geral em aberto:</span>
              {globalTotalLoading ? (
                <Loader2 className="w-3 h-3 text-[#3fb06c] animate-spin" />
              ) : globalTotal !== null && globalTotal > 0 ? (
                <span className="font-bold text-[#3fb06c] text-sm tabular-nums">{formatBRL(globalTotal)}</span>
              ) : (
                <span className="text-[#3a4d3e]">—</span>
              )}
            </span>
          </span>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────── */}
      {mainTab === "lista" && (<>
        <div className="flex-1 overflow-auto">
          {loading || filterLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-[#3fb06c] animate-spin" />
            </div>
          ) : contacts.length === 0 ? (
            <EmptyState search={debouncedSearch} hasFilters={activeFilterCount > 0} onImport={() => setShowImport(true)} />
          ) : (
            <table className="w-full text-sm" style={{ minWidth: 1200 }}>
              {/* z-20 no cabecalho porque as celulas fixas da esquerda usam z-10:
                  sem isso o nome da linha passaria por cima do cabecalho ao rolar. */}
              <thead className="sticky top-0 z-20" style={{ background: "#0d1710", borderBottom: "1px solid #1e2e22" }}>
                <tr>
                  {/* Bulk-select checkbox */}
                  <th className="w-10 px-3 py-3 sticky left-0 z-20" style={{ background: "#0d1710" }}>
                    <div
                      onClick={toggleAll}
                      className="w-4 h-4 rounded cursor-pointer flex items-center justify-center transition-all border"
                      style={allPageSelected
                        ? { background: "linear-gradient(135deg, #3fb06c, #16A34A)", border: "none" }
                        : somePageSelected
                        ? { background: "rgba(63,176,108,0.15)", borderColor: "#3fb06c" }
                        : { background: "transparent", borderColor: "#3a4d3e" }}
                    >
                      {allPageSelected && <span className="text-white text-[9px] leading-none font-bold">✓</span>}
                      {somePageSelected && !allPageSelected && <span className="text-[#3fb06c] text-[9px] leading-none font-bold">–</span>}
                    </div>
                  </th>
                  <TH
                    className="pl-2 w-[220px] sticky left-10 z-20"
                    style={{ background: "#0d1710" }}
                    sortKey="name"
                    sortOrder={filters.sortOrder}
                    onSort={() => patchFilters({ sortOrder: filters.sortOrder === "name_asc" ? "name_desc" : "name_asc" })}
                  >
                    Nome / Empresa
                  </TH>
                  <TH className="w-[150px]">Telefone</TH>
                  <TH className="w-[140px]">CPF / CNPJ</TH>
                  <TH className="w-[190px]">Email</TH>
                  <TH className="w-[150px]">Representante</TH>
                  <TH className="w-[130px]">Saldo em aberto</TH>
                  <TH className="w-[155px]">Próx. venc.</TH>
                  <TH className="w-[140px]">Cidade / UF</TH>
                  <TH>Tags</TH>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact, i) => {
                  const inv = invoiceTotals[contact.id];
                  return (
                    <tr
                      key={contact.id}
                      onClick={() => setSelected(contact)}
                      className="cursor-pointer transition-colors hover:bg-[#111a14] group"
                      style={{
                        borderBottom: i < contacts.length - 1 ? "1px solid #1a2a1e" : undefined,
                        background: selectedIds.has(contact.id) ? "rgba(63,176,108,0.05)" : undefined,
                      }}
                    >
                      {/* Checkbox — fixo na esquerda junto com o nome */}
                      <td
                        className="px-3 py-3 sticky left-0 z-10"
                        style={{ background: selectedIds.has(contact.id) ? BG_LINHA_SELECIONADA : BG_LINHA }}
                        onClick={(e) => { e.stopPropagation(); toggleOne(contact.id); }}
                      >
                        <div
                          className="w-4 h-4 rounded flex items-center justify-center transition-all border cursor-pointer"
                          style={selectedIds.has(contact.id)
                            ? { background: "linear-gradient(135deg, #3fb06c, #16A34A)", border: "none" }
                            : { background: "transparent", borderColor: "#3a4d3e" }}
                        >
                          {selectedIds.has(contact.id) && <span className="text-white text-[9px] leading-none font-bold">✓</span>}
                        </div>
                      </td>

                      {/* Nome — fica visível durante o scroll horizontal, senão você
                          rola até "saldo" e perde de vista de quem é a linha. */}
                      <td
                        className="pl-2 pr-4 py-3 sticky left-10 z-10"
                        style={{ background: selectedIds.has(contact.id) ? BG_LINHA_SELECIONADA : BG_LINHA }}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar name={contact.name} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate group-hover:text-[#3fb06c] transition-colors">
                              {contact.name ?? <span className="text-[#6b7f6e] italic">Sem nome</span>}
                            </p>
                            {contact.empresa && (
                              <p className="text-xs text-[#6b7f6e] truncate">{contact.empresa}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Phone — formatted */}
                      <td className="px-4 py-3 text-xs text-[#6b7f6e] font-mono">
                        {formatPhone(contact.phone)}
                      </td>

                      {/* CPF/CNPJ */}
                      <td className="px-4 py-3 text-xs text-[#6b7f6e] font-mono">
                        {(() => {
                          const raw = contact.cpf_cnpj;
                          if (!raw) return "—";
                          const d = raw.replace(/\D/g, "");
                          if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
                          if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
                          return raw;
                        })()}
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3 text-xs text-[#6b7f6e] max-w-[190px]">
                        {contact.email ? (
                          <span className="truncate block" title={contact.email}>{contact.email}</span>
                        ) : "—"}
                        {contact.email2 && (
                          <span className="truncate block text-[#4a6b50] mt-0.5" title={contact.email2}>{contact.email2}</span>
                        )}
                      </td>

                      {/* Representante */}
                      <td className="px-4 py-3 text-xs max-w-[150px]">
                        {contact.nome_representante ? (
                          <>
                            <p className="text-[#b0c4b8] truncate" title={contact.nome_representante}>{contact.nome_representante}</p>
                            {contact.email_representante && (
                              <p className="text-[#4a6b50] truncate mt-0.5" title={contact.email_representante}>{contact.email_representante}</p>
                            )}
                          </>
                        ) : "—"}
                      </td>

                      {/* Saldo em aberto — tabular-nums alinha os dígitos em coluna.
                          Sem isso a fonte é proporcional e "R$ 1.111,11" não fica
                          sob "R$ 9.999,99", que é justamente o que se compara aqui. */}
                      <td className="px-4 py-3 text-xs text-right tabular-nums">
                        {inv && inv.total > 0 ? (
                          <span className="font-semibold text-amber-400">{formatBRL(inv.total)}</span>
                        ) : (
                          <span className="text-[#3a4d3e]">—</span>
                        )}
                      </td>

                      {/* Próximo vencimento — o atraso era sinalizado SÓ pela cor
                          vermelha. Para quem tem deficiência de visão de cor (cerca
                          de 8% dos homens) a informação mais importante da tela
                          simplesmente não existia. Agora vem também o ícone e os
                          dias, que funcionam sem depender de enxergar o vermelho. */}
                      <td className="px-4 py-3 text-xs tabular-nums">
                        {inv?.nextDue ? (() => {
                          const atraso = diasDeAtraso(inv.nextDue);
                          const vencido = atraso !== null && atraso > 0;
                          return (
                            <span className={`flex items-center gap-1.5 ${vencido ? "text-red-400 font-medium" : "text-[#6b7f6e]"}`}>
                              {vencido && <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />}
                              <span>{formatDate(inv.nextDue)}</span>
                              {vencido && (
                                <span className="text-[10px] text-red-400/70 whitespace-nowrap">
                                  {atraso === 1 ? "1 dia" : `${atraso} dias`}
                                </span>
                              )}
                            </span>
                          );
                        })() : (
                          <span className="text-[#3a4d3e]">—</span>
                        )}
                      </td>

                      {/* Cidade / UF */}
                      <td className="px-4 py-3 text-xs text-[#6b7f6e]">
                        {contact.cidade || contact.estado
                          ? [contact.cidade, contact.estado].filter(Boolean).join(" / ")
                          : "—"}
                      </td>

                      {/* Tags */}
                      <td className="px-4 py-3">
                        {contact.tags?.length > 0 ? (
                          <TagChips tags={contact.tags} />
                        ) : (
                          <span className="text-xs text-[#3a4d3e]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ───────────────────────────────── */}
        <Pagination
          page={page}
          total={total}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(pages, p + 1))}
        />
      </>)}

      {/* ── Modals ───────────────────────────────────── */}
      {selected && (
        <ContactPanel
          contact={selected}
          onClose={() => setSelected(null)}
          onUpdated={(updated) => { setSelected(updated); refresh(); }}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onSuccess={() => { setShowImport(false); refresh(); }}
        />
      )}

      <Presence when={showNewContact}>
        {(visivel) => (
          <ContactFormModal
            open={visivel}
            onClose={() => setShowNewContact(false)}
            onSaved={(c) => { setShowNewContact(false); refresh(); setSelected(c); }}
          />
        )}
      </Presence>

      {/* ── Bulk action bar ──────────────────────────── */}
      <BulkActionBar
        count={selectedIds.size}
        onDelete={() => setShowDeleteConfirm(true)}
        onClear={() => setSelectedIds(new Set())}
      />

      {/* ── Delete confirm modal ─────────────────────── */}
      {showDeleteConfirm && (
        <DeleteConfirmModal
          count={selectedIds.size}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          loading={deleting}
        />
      )}
    </div>
  );
}
