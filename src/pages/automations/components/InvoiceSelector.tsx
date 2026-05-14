import { useState, useEffect, useCallback } from "react";
import { Search, FileText, Loader2, ArrowUpDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import type { RecipientDraft } from "@/types/automations";

interface RawRow {
  contact_id:    string;
  contact_name:  string;
  contact_phone: string;
  invoice_id:    string;
  vencimento:    string;
  valor:         number | null;
  numero_nf:     string | null;
  codigo_barras: string | null;
  status:        string;
}

const PENDING = ["pendente", "vencido", "aberto", "em_aberto"];
const PAGE_SIZE = 25;
const TODAY = new Date().toISOString().slice(0, 10);

type SortField = "name_asc" | "name_desc" | "valor_asc" | "valor_desc" | "venc_asc" | "venc_desc";

interface Props {
  selected: RecipientDraft[];
  onChange: (items: RecipientDraft[]) => void;
}

function formatBRL(v: number | null): string {
  if (v === null || isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function InvoiceSelector({ selected, onChange }: Props) {
  const { workspaceId } = useAuth();

  const [rows,    setRows]    = useState<RawRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page,    setPage]    = useState(0);

  const [search,    setSearch]    = useState("");
  const [minValor,  setMinValor]  = useState("");
  const [maxValor,  setMaxValor]  = useState("");
  const [dateFrom,  setDateFrom]  = useState("");
  const [dateTo,    setDateTo]    = useState("");
  const [sortBy,    setSortBy]    = useState<SortField>("venc_asc");
  const [showFilts, setShowFilts] = useState(false);

  // Key by invoice_id — each invoice is independent
  const selectedIds = new Set(selected.map((r) => r.invoice_id));

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from("contact_invoices")
      .select("id, contact_id, valor, vencimento, status, numero_nf, codigo_barras, inbox_contacts!inner(id, name, phone)")
      .eq("workspace_id", workspaceId)
      .in("status", PENDING);

    if (minValor) q = q.gte("valor", Number(minValor.replace(",", ".")));
    if (maxValor) q = q.lte("valor", Number(maxValor.replace(",", ".")));
    if (dateFrom) q = q.gte("vencimento", dateFrom);
    if (dateTo)   q = q.lte("vencimento", dateTo);

    const { data } = await q;

    const result: RawRow[] = [];
    for (const inv of (data ?? [])) {
      const contact = inv.inbox_contacts as { id: string; name: string; phone: string } | null;
      if (!contact) continue;

      const name  = (contact.name  ?? "").toLowerCase();
      const phone = (contact.phone ?? "");

      if (search.trim()) {
        const s = search.trim().toLowerCase();
        if (!name.includes(s) && !phone.includes(s)) continue;
      }

      result.push({
        contact_id:    contact.id,
        contact_name:  contact.name,
        contact_phone: phone,
        invoice_id:    inv.id,
        vencimento:    inv.vencimento ?? "",
        valor:         inv.valor,
        status:        inv.status,
        numero_nf:     inv.numero_nf    ?? null,
        codigo_barras: inv.codigo_barras ?? null,
      });
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case "name_asc":   return a.contact_name.localeCompare(b.contact_name);
        case "name_desc":  return b.contact_name.localeCompare(a.contact_name);
        case "valor_asc":  return (a.valor ?? 0) - (b.valor ?? 0);
        case "valor_desc": return (b.valor ?? 0) - (a.valor ?? 0);
        case "venc_asc":   return a.vencimento.localeCompare(b.vencimento);
        case "venc_desc":  return b.vencimento.localeCompare(a.vencimento);
        default: return 0;
      }
    });

    setRows(result);
    setPage(0);
    setLoading(false);
  }, [workspaceId, search, minValor, maxValor, dateFrom, dateTo, sortBy]);

  useEffect(() => { load(); }, [load]);

  const totalPages  = Math.ceil(rows.length / PAGE_SIZE);
  const pageItems   = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const allSelected = pageItems.length > 0 && pageItems.every((r) => selectedIds.has(r.invoice_id));

  function toggle(row: RawRow) {
    if (selectedIds.has(row.invoice_id)) {
      onChange(selected.filter((s) => s.invoice_id !== row.invoice_id));
    } else {
      onChange([...selected, toDraft(row)]);
    }
  }

  function selectAllPage() {
    if (allSelected) {
      onChange(selected.filter((s) => !pageItems.find((r) => r.invoice_id === s.invoice_id)));
    } else {
      const toAdd = pageItems.filter((r) => !selectedIds.has(r.invoice_id)).map(toDraft);
      onChange([...selected, ...toAdd]);
    }
  }

  function selectAll() {
    onChange(rows.map(toDraft));
  }

  function toDraft(r: RawRow): RecipientDraft {
    return {
      contact_id:    r.contact_id,
      invoice_id:    r.invoice_id,
      contact_name:  r.contact_name,
      contact_phone: r.contact_phone,
      vencimento:    r.vencimento,
      valor:         r.valor,
      numero_nf:     r.numero_nf,
      codigo_barras: r.codigo_barras,
    };
  }

  // Group count: how many distinct contacts are selected
  const selectedContacts = new Set(selected.map((r) => r.contact_id)).size;

  return (
    <div className="space-y-4">
      {/* Search + filter row */}
      <div className="flex items-center gap-2">
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
          onClick={() => setShowFilts((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors",
            showFilts ? "text-agro-green" : "text-agro-muted-2 hover:text-agro-text",
          )}
          style={{ border: `1px solid ${showFilts ? "rgba(63,176,108,0.4)" : "rgba(63,176,108,0.15)"}`, background: showFilts ? "rgba(63,176,108,0.08)" : "transparent" }}
        >
          <SlidersHorizontal className="w-3 h-3" /> Filtros
        </button>
        <button
          onClick={selectAll}
          className="px-3 py-2 rounded-xl text-xs font-semibold text-agro-green transition-all hover:bg-agro-green/10"
          style={{ border: "1px solid rgba(63,176,108,0.25)" }}
        >
          Todos ({rows.length})
        </button>
        <button
          onClick={() => onChange([])}
          className="px-3 py-2 rounded-xl text-xs font-semibold text-agro-muted hover:text-agro-text transition-colors"
        >
          Limpar
        </button>
      </div>

      {/* Filter panel */}
      {showFilts && (
        <div className="p-4 rounded-xl space-y-3"
          style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Valor mín.</label>
              <input className="input-agro w-full text-sm" placeholder="0,00" value={minValor} onChange={(e) => setMinValor(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Valor máx.</label>
              <input className="input-agro w-full text-sm" placeholder="99999,00" value={maxValor} onChange={(e) => setMaxValor(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Vencimento de</label>
              <input type="date" className="input-agro w-full text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider mb-1">Vencimento até</label>
              <input type="date" className="input-agro w-full text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-3.5 h-3.5 text-agro-muted-2" />
            <select className="input-agro text-xs" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortField)}>
              <option value="venc_asc">Vencimento ↑</option>
              <option value="venc_desc">Vencimento ↓</option>
              <option value="name_asc">Nome A-Z</option>
              <option value="name_desc">Nome Z-A</option>
              <option value="valor_asc">Valor ↑</option>
              <option value="valor_desc">Valor ↓</option>
            </select>
          </div>
        </div>
      )}

      {/* Counter */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.1)" }}>
        <FileText className="w-4 h-4 text-agro-green shrink-0" />
        <span className="text-sm text-agro-muted">
          <span className="font-bold text-agro-text">{selected.length}</span> boleto{selected.length !== 1 ? "s" : ""} selecionado{selected.length !== 1 ? "s" : ""}
          {selectedContacts > 0 && (
            <span className="text-agro-muted-2"> · {selectedContacts} cliente{selectedContacts !== 1 ? "s" : ""}</span>
          )}
          <span className="text-agro-muted-2"> de {rows.length} boletos pendentes</span>
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
                  onClick={selectAllPage}
                  className={cn("w-4 h-4 rounded cursor-pointer flex items-center justify-center transition-all",
                    allSelected ? "glow-green-sm" : "border border-agro-muted/40 hover:border-agro-green")}
                  style={allSelected ? { background: "linear-gradient(135deg, #3fb06c, #16A34A)" } : { background: "transparent" }}
                >
                  {allSelected && <span className="text-white text-[10px] leading-none">✓</span>}
                </div>
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Nome</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Telefone</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Vencimento</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Status</th>
              <th className="px-4 py-3 text-right text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Valor</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.06)" }}>
                  {[10, 32, 24, 16, 12, 16].map((w, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className={`h-3.5 w-${w} rounded animate-pulse`} style={{ background: "rgba(63,176,108,0.08)" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : pageItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-agro-muted">
                  {loading ? "Carregando..." : "Nenhum boleto pendente encontrado"}
                </td>
              </tr>
            ) : (
              pageItems.map((row, i) => {
                const isSel      = selectedIds.has(row.invoice_id);
                const isOverdue  = row.vencimento < TODAY;
                return (
                  <tr
                    key={row.invoice_id}
                    className="cursor-pointer transition-all duration-150"
                    style={{
                      borderBottom: i < pageItems.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none",
                      background: isSel ? "rgba(63,176,108,0.06)" : "transparent",
                    }}
                    onClick={() => toggle(row)}
                  >
                    <td className="px-4 py-3">
                      <div
                        className={cn("w-4 h-4 rounded flex items-center justify-center transition-all",
                          isSel ? "glow-green-sm" : "border border-agro-muted/40")}
                        style={isSel ? { background: "linear-gradient(135deg, #3fb06c, #16A34A)" } : { background: "transparent" }}
                      >
                        {isSel && <span className="text-white text-[10px] leading-none">✓</span>}
                      </div>
                    </td>
                    <td className={cn("px-4 py-3 font-medium text-sm", isSel ? "text-agro-text" : "text-agro-text-2")}>
                      {row.contact_name}
                    </td>
                    <td className="px-4 py-3 text-agro-muted font-mono text-xs">{row.contact_phone}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={isOverdue ? "text-red-400 font-semibold" : "text-agro-muted"}>
                        {formatDate(row.vencimento)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                        isOverdue
                          ? "text-red-400"
                          : "text-amber-400",
                      )}
                        style={{ background: isOverdue ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)" }}>
                        {isOverdue ? "vencido" : "pendente"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-agro-text">{formatBRL(row.valor)}</td>
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
            <button disabled={page === 0} onClick={() => setPage(page - 1)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-agro-muted disabled:opacity-40 hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
              Anterior
            </button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-agro-muted disabled:opacity-40 hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
