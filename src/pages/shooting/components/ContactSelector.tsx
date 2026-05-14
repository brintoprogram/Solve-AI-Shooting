import { useState, useEffect, useCallback } from "react";
import { Search, Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

const PENDING_STATUSES = ["pendente", "vencido", "aberto", "em_aberto"];
const TODAY = new Date().toISOString().slice(0, 10);

interface Invoice {
  id:         string;
  valor:      number;
  vencimento: string | null;
  status:     string;
}

interface Contact {
  id:               string;
  name:             string;
  phone:            string;
  tags?:            string[] | null;
  contact_invoices?: Invoice[];
}

interface ContactSelectorProps {
  selected: string[];
  onChange: (ids: string[]) => void;
}

const PAGE_SIZE = 25;

// Returns pending invoices sorted by vencimento asc
function pendingInvoices(contact: Contact): Invoice[] {
  return (contact.contact_invoices ?? [])
    .filter((inv) => PENDING_STATUSES.includes((inv.status ?? "").toLowerCase()))
    .sort((a, b) => {
      if (!a.vencimento) return 1;
      if (!b.vencimento) return -1;
      return new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime();
    });
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function ContactSelector({ selected, onChange }: ContactSelectorProps) {
  const { workspaceId } = useAuth();
  const [search,   setSearch]   = useState("");
  const [page,     setPage]     = useState(0);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from("inbox_contacts")
      .select(
        "id, name, phone, tags, contact_invoices(id, valor, vencimento, status)",
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

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
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
          onClick={() => onChange([])}
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
      <div className="rounded-xl overflow-hidden"
        style={{ border: "1px solid rgba(63,176,108,0.12)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
              <th className="w-10 px-4 py-3">
                <div
                  onClick={() => {
                    if (allPageSelected) {
                      onChange(selected.filter((s) => !contacts.find((c) => c.id === s)));
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
              <th className="px-4 py-3 text-right text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Valor pendente</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Próx. vencimento</th>
            </tr>
          </thead>
          <tbody>
            {loading && contacts.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.06)" }}>
                  <td className="px-4 py-3"><div className="w-4 h-4 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.1)" }} /></td>
                  <td className="px-4 py-3"><div className="h-3.5 w-32 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.08)" }} /></td>
                  <td className="px-4 py-3"><div className="h-3.5 w-28 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.08)" }} /></td>
                  <td className="px-4 py-3"><div className="h-3.5 w-20 rounded animate-pulse ml-auto" style={{ background: "rgba(63,176,108,0.08)" }} /></td>
                  <td className="px-4 py-3"><div className="h-3.5 w-20 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.08)" }} /></td>
                </tr>
              ))
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-agro-muted">
                  Nenhum contato encontrado
                </td>
              </tr>
            ) : (
              contacts.map((contact, i) => {
                const isSelected = selected.includes(contact.id);
                const pending    = pendingInvoices(contact);
                const total      = pending.reduce((s, inv) => s + (Number(inv.valor) || 0), 0);
                const mostUrgent = pending[0] ?? null;
                const isOverdue  = mostUrgent?.vencimento ? mostUrgent.vencimento < TODAY : false;

                return (
                  <tr
                    key={contact.id}
                    className="cursor-pointer transition-all duration-200"
                    style={{
                      borderBottom: i < contacts.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none",
                      background: isSelected ? "rgba(63,176,108,0.06)" : "transparent",
                    }}
                    onClick={() => toggle(contact.id)}
                  >
                    <td className="px-4 py-3">
                      <div
                        className={cn(
                          "w-4 h-4 rounded flex items-center justify-center transition-all",
                          isSelected ? "glow-green-sm" : "border border-agro-muted/40",
                        )}
                        style={isSelected ? { background: "linear-gradient(135deg, #3fb06c, #16A34A)" } : { background: "transparent" }}
                        onClick={(e) => { e.stopPropagation(); toggle(contact.id); }}
                      >
                        {isSelected && <span className="text-white text-[10px] leading-none">✓</span>}
                      </div>
                    </td>

                    <td className={cn(
                      "px-4 py-3 font-medium text-sm transition-colors",
                      isSelected ? "text-agro-text" : "text-agro-text-2",
                    )}>
                      {contact.name}
                    </td>

                    <td className="px-4 py-3 text-agro-muted font-mono text-xs">
                      {contact.phone}
                    </td>

                    {/* Valor pendente */}
                    <td className="px-4 py-3 text-right">
                      {pending.length > 0 ? (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: isOverdue ? "#f87171" : "#3fb06c" }}>
                            {formatBRL(total)}
                          </span>
                          {pending.length > 1 && (
                            <span className="ml-1 text-[10px] text-agro-muted-2">
                              ({pending.length} bol.)
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-agro-muted-2">—</span>
                      )}
                    </td>

                    {/* Próx. vencimento */}
                    <td className="px-4 py-3">
                      {mostUrgent?.vencimento ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={isOverdue
                            ? { background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }
                            : { background: "rgba(63,176,108,0.08)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.2)" }
                          }
                        >
                          {isOverdue ? "vencido · " : ""}{formatDate(mostUrgent.vencimento)}
                        </span>
                      ) : (
                        <span className="text-xs text-agro-muted-2">—</span>
                      )}
                    </td>
                  </tr>
                );
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
