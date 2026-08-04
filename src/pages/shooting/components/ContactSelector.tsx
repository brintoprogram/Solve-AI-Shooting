import { useState, useEffect, useCallback } from "react";
import { Search, Users, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { formatBRL } from "@/lib/format";

const PENDING_STATUSES = ["pendente", "vencido", "aberto", "em_aberto"];
const TODAY = new Date().toISOString().slice(0, 10);

interface Invoice {
  id:         string;
  valor:      number;
  vencimento: string | null;
  status:     string;
  numero_nf?: string | null;
}

interface Contact {
  id:               string;
  name:             string;
  phone:            string;
  tags?:            string[] | null;
  contact_invoices?: Invoice[];
}

interface ContactSelectorProps {
  selected:         string[];
  selectedInvoices: Record<string, string[]>;  // contactId → invoiceIds (same vencimento)
  onChange:         (ids: string[]) => void;
  onInvoiceChange:  (inv: Record<string, string[]>) => void;
}

const PAGE_SIZE = 25;

function pendingInvoices(contact: Contact): Invoice[] {
  return (contact.contact_invoices ?? [])
    .filter((inv) => PENDING_STATUSES.includes((inv.status ?? "").toLowerCase()))
    .sort((a, b) => {
      if (!a.vencimento) return 1;
      if (!b.vencimento) return -1;
      return new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime();
    });
}


function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function ContactSelector({ selected, selectedInvoices, onChange, onInvoiceChange }: ContactSelectorProps) {
  const { workspaceId } = useAuth();
  const [search,       setSearch]       = useState("");
  const [page,         setPage]         = useState(0);
  const [contacts,     setContacts]     = useState<Contact[]>([]);
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(false);
  const [expanded,     setExpanded]     = useState<string | null>(null);
  // contactId → error message when vencimento conflict is detected
  const [vencConflict, setVencConflict] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = supabase
      .from("inbox_contacts")
      .select(
        "id, name, phone, tags, contact_invoices(id, valor, vencimento, status, numero_nf)",
        { count: "exact" },
      )
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .range(from, to);

    if (search.trim()) {
      const s = search.trim();
      q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
    }

    const { data, count } = await q;
    setContacts((data ?? []) as Contact[]);
    setTotal(count ?? 0);
    setLoading(false);
  }, [workspaceId, page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search]);

  function toggleContact(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
      const next = { ...selectedInvoices };
      delete next[id];
      onInvoiceChange(next);
    } else {
      onChange([...selected, id]);
    }
  }

  function toggleInvoice(contactId: string, invoiceId: string, invoiceVencimento: string | null) {
    const current = selectedInvoices[contactId] ?? [];

    if (current.includes(invoiceId)) {
      // Deselect
      const newArr = current.filter((id) => id !== invoiceId);
      const next   = { ...selectedInvoices };
      if (newArr.length === 0) delete next[contactId];
      else next[contactId] = newArr;
      onInvoiceChange(next);
      setVencConflict((prev) => { const p = { ...prev }; delete p[contactId]; return p; });
    } else {
      // Select — validate vencimento constraint
      if (current.length > 0) {
        const pending    = pendingInvoices(contacts.find((c) => c.id === contactId) ?? { id: "", name: "", phone: "" });
        const firstInv   = pending.find((inv) => inv.id === current[0]);
        if (firstInv?.vencimento !== invoiceVencimento) {
          const locked = firstInv?.vencimento ? formatDate(firstInv.vencimento) : "?";
          setVencConflict((prev) => ({
            ...prev,
            [contactId]: `Boletos com datas diferentes não podem ser combinados. Seleção atual: ${locked}.`,
          }));
          return;
        }
      }
      setVencConflict((prev) => { const p = { ...prev }; delete p[contactId]; return p; });
      onInvoiceChange({ ...selectedInvoices, [contactId]: [...current, invoiceId] });
    }
  }

  function clearInvoiceSelection(contactId: string) {
    const next = { ...selectedInvoices };
    delete next[contactId];
    onInvoiceChange(next);
    setVencConflict((prev) => { const p = { ...prev }; delete p[contactId]; return p; });
  }

  const totalPages      = Math.ceil(total / PAGE_SIZE);
  const allPageSelected = contacts.length > 0 && contacts.every((c) => selected.includes(c.id));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
          <input
            className="input-agro w-full pl-9"
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => onChange([...new Set([...selected, ...contacts.map((c) => c.id)])])}
          className="px-4 py-2 rounded-xl text-xs font-semibold text-agro-green transition-all hover:bg-white/10"
          style={{ border: "1px solid rgba(63,176,108,0.25)" }}
        >
          Todos
        </button>
        <button
          onClick={() => { onChange([]); onInvoiceChange({}); }}
          className="px-4 py-2 rounded-xl text-xs font-semibold text-agro-muted hover:text-agro-text transition-colors"
        >
          Limpar
        </button>
      </div>

      {/* Counter */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.1)" }}
      >
        <Users className="w-4 h-4 text-agro-green" />
        <span className="text-sm text-agro-muted">
          <span className="font-bold text-agro-text">{selected.length}</span> selecionados de{" "}
          <span className="font-bold text-agro-text">{total}</span> contatos
        </span>
        {loading && <Loader2 className="w-3.5 h-3.5 text-agro-muted-2 animate-spin ml-auto" />}
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.12)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
              <th className="w-10 px-4 py-3">
                <div
                  onClick={() => {
                    if (allPageSelected) {
                      const removed = contacts.map((c) => c.id);
                      onChange(selected.filter((s) => !removed.includes(s)));
                      const next = { ...selectedInvoices };
                      removed.forEach((id) => delete next[id]);
                      onInvoiceChange(next);
                    } else {
                      onChange([...new Set([...selected, ...contacts.map((c) => c.id)])]);
                    }
                  }}
                  className={cn(
                    "w-4 h-4 rounded cursor-pointer flex items-center justify-center transition-all",
                    allPageSelected ? "glow-green-sm" : "border border-agro-muted/40 hover:border-agro-green",
                  )}
                  style={allPageSelected ? { background: "linear-gradient(135deg, #3fb06c, #16A34A)" } : { background: "transparent" }}
                >
                  {allPageSelected && <span className="text-white text-[10px] leading-none">✓</span>}
                </div>
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Nome</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Telefone</th>
              <th className="px-4 py-3 text-right text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Valor</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Vencimento</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {loading && contacts.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.06)" }}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3.5 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.08)", width: j === 0 ? 16 : j === 5 ? 12 : "80%" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-agro-muted">
                  Nenhum contato encontrado
                </td>
              </tr>
            ) : (
              contacts.flatMap((contact, i) => {
                const isSelected     = selected.includes(contact.id);
                const isExpanded     = expanded === contact.id;
                const pending        = pendingInvoices(contact);
                const hasPending     = pending.length > 0;
                const pinnedIds      = selectedInvoices[contact.id] ?? [];
                const hasPinned      = pinnedIds.length > 0;
                const pinnedInvObjs  = hasPinned ? pending.filter((inv) => pinnedIds.includes(inv.id)) : [];

                // What to show in collapsed row
                const displayValor = hasPinned
                  ? pinnedInvObjs.reduce((s, inv) => s + (Number(inv.valor) || 0), 0)
                  : pending.reduce((s, inv) => s + (Number(inv.valor) || 0), 0);
                const displayInv   = hasPinned ? pinnedInvObjs[0] ?? null : pending[0] ?? null;
                const isOverdue    = displayInv?.vencimento ? displayInv.vencimento < TODAY : false;

                const rows = [
                  // ── Contact row ──────────────────────────────────
                  <tr
                    key={contact.id}
                    className="cursor-pointer transition-all duration-150"
                    style={{
                      borderBottom: isExpanded ? "none" : i < contacts.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none",
                      background: isSelected ? "rgba(63,176,108,0.06)" : "transparent",
                    }}
                    onClick={() => toggleContact(contact.id)}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div
                        className={cn("w-4 h-4 rounded flex items-center justify-center transition-all cursor-pointer",
                          isSelected ? "glow-green-sm" : "border border-agro-muted/40")}
                        style={isSelected ? { background: "linear-gradient(135deg, #3fb06c, #16A34A)" } : { background: "transparent" }}
                        onClick={() => toggleContact(contact.id)}
                      >
                        {isSelected && <span className="text-white text-[10px] leading-none">✓</span>}
                      </div>
                    </td>

                    {/* Name */}
                    <td className={cn("px-4 py-3 font-medium text-sm", isSelected ? "text-agro-text" : "text-agro-text-2")}>
                      {contact.name}
                      {hasPinned && (
                        <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                          style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}>
                          {pinnedIds.length === 1 ? "boleto fixado" : `${pinnedIds.length} boletos fixados`}
                        </span>
                      )}
                    </td>

                    {/* Phone */}
                    <td className="px-4 py-3 text-agro-muted font-mono text-xs">{contact.phone}</td>

                    {/* Valor */}
                    <td className="px-4 py-3 text-right">
                      {hasPending ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-xs font-semibold" style={{ color: isOverdue ? "#f87171" : "#3fb06c" }}>
                            {formatBRL(displayValor)}
                          </span>
                          {!hasPinned && pending.length > 1 && (
                            <span className="text-[10px] text-agro-muted-2">({pending.length})</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-agro-muted-2">—</span>
                      )}
                    </td>

                    {/* Vencimento */}
                    <td className="px-4 py-3">
                      {displayInv?.vencimento ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={isOverdue
                            ? { background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }
                            : { background: "rgba(63,176,108,0.08)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.2)" }
                          }
                        >
                          {isOverdue ? "vencido · " : ""}{formatDate(displayInv.vencimento)}
                        </span>
                      ) : (
                        <span className="text-xs text-agro-muted-2">—</span>
                      )}
                    </td>

                    {/* Expand toggle */}
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      {hasPending && (
                        <button
                          onClick={() => setExpanded((prev) => prev === contact.id ? null : contact.id)}
                          className="w-6 h-6 flex items-center justify-center rounded text-agro-muted-2 hover:text-agro-text transition-colors"
                          title={isExpanded ? "Fechar boletos" : "Ver boletos"}
                        >
                          {isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5" />
                            : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </td>
                  </tr>,
                ];

                // ── Invoice sub-rows (expanded) ──────────────────
                if (isExpanded && hasPending) {
                  const conflictMsg = vencConflict[contact.id];

                  rows.push(
                    <tr
                      key={`${contact.id}-invoices`}
                      style={{ borderBottom: i < contacts.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none" }}
                    >
                      <td colSpan={6} className="px-0 pb-2 pt-0">
                        <div className="mx-4 rounded-xl overflow-hidden"
                          style={{ background: "rgba(8,14,10,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}>

                          {/* Header row: hint + clear button */}
                          <div className="flex items-center justify-between px-4 py-2"
                            style={{ borderBottom: "1px solid rgba(63,176,108,0.07)" }}>
                            <p className="text-[10px] text-agro-muted-2">
                              {hasPinned
                                ? `${pinnedIds.length} boleto${pinnedIds.length > 1 ? "s" : ""} selecionado${pinnedIds.length > 1 ? "s" : ""} · soma ${formatBRL(displayValor)}`
                                : "Automático — usa todos os boletos pendentes"}
                            </p>
                            {hasPinned && (
                              <button
                                onClick={() => clearInvoiceSelection(contact.id)}
                                className="text-[10px] font-semibold transition-colors hover:opacity-80"
                                style={{ color: "#f59e0b" }}
                              >
                                Limpar seleção
                              </button>
                            )}
                          </div>

                          {/* Vencimento conflict error */}
                          {conflictMsg && (
                            <div className="px-4 py-2 text-[10px] font-medium"
                              style={{ color: "#f87171", background: "rgba(239,68,68,0.06)", borderBottom: "1px solid rgba(239,68,68,0.12)" }}>
                              ⚠ {conflictMsg}
                            </div>
                          )}

                          {/* Individual invoices with checkboxes */}
                          {pending.map((inv, j) => {
                            const isChecked  = pinnedIds.includes(inv.id);
                            const invOverdue = inv.vencimento ? inv.vencimento < TODAY : false;

                            // Determine if this invoice can be selected
                            // (must match vencimento of already-selected ones)
                            const lockedVenc = hasPinned && !isChecked
                              ? (pending.find((p) => pinnedIds.includes(p.id))?.vencimento ?? null)
                              : null;
                            const isBlocked  = lockedVenc !== null && inv.vencimento !== lockedVenc;

                            return (
                              <button
                                key={inv.id}
                                onClick={() => {
                                  if (isBlocked) {
                                    const locked = lockedVenc ? formatDate(lockedVenc) : "?";
                                    setVencConflict((prev) => ({
                                      ...prev,
                                      [contact.id]: `Boletos com datas diferentes não podem ser combinados. Seleção atual: ${locked}.`,
                                    }));
                                    return;
                                  }
                                  setVencConflict((prev) => { const p = { ...prev }; delete p[contact.id]; return p; });
                                  toggleInvoice(contact.id, inv.id, inv.vencimento);
                                }}
                                className={cn(
                                  "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                                  isBlocked ? "opacity-35 cursor-not-allowed" : "hover:bg-white/5",
                                )}
                                style={{ borderBottom: j < pending.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none" }}
                              >
                                {/* Checkbox */}
                                <span
                                  className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center border transition-colors"
                                  style={isChecked
                                    ? { background: "#f59e0b", borderColor: "#f59e0b" }
                                    : isBlocked
                                      ? { background: "transparent", borderColor: "rgba(255,255,255,0.1)" }
                                      : { background: "transparent", borderColor: "rgba(255,255,255,0.2)" }}
                                >
                                  {isChecked && <span className="w-1.5 h-1.5 rounded-sm bg-white block" />}
                                </span>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-semibold text-agro-text">
                                      {formatBRL(Number(inv.valor) || 0)}
                                    </span>
                                    {inv.vencimento && (
                                      <span
                                        className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                                        style={invOverdue
                                          ? { background: "rgba(239,68,68,0.1)", color: "#f87171" }
                                          : { background: "rgba(63,176,108,0.08)", color: "#3fb06c" }}
                                      >
                                        {invOverdue ? "vencido · " : ""}{formatDate(inv.vencimento)}
                                      </span>
                                    )}
                                    {inv.numero_nf && (
                                      <span className="text-[10px] text-agro-muted-2 font-mono">NF {inv.numero_nf}</span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                }

                return rows;
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-agro-muted">Página {page + 1} de {totalPages}</p>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-agro-muted disabled:opacity-40 hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}
            >
              Anterior
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-agro-muted disabled:opacity-40 hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
