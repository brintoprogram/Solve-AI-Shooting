import { useState, useEffect, useCallback } from "react";
import { Search, Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

interface Contact {
  id: string;
  name: string;
  phone: string;
  tags?: string[] | null;
}

interface ContactSelectorProps {
  selected: string[];
  onChange: (ids: string[]) => void;
}

const PAGE_SIZE = 25;

export function ContactSelector({ selected, onChange }: ContactSelectorProps) {
  const { workspaceId } = useAuth();
  const [search, setSearch]     = useState("");
  const [page, setPage]         = useState(0);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from("inbox_contacts")
      .select("id, name, phone, tags", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .range(from, to);

    if (search.trim()) {
      const s = search.trim();
      q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
    }

    const { data, count } = await q;
    setContacts(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [workspaceId, page, search]);

  useEffect(() => { load(); }, [load]);

  // Reset page when search changes
  useEffect(() => { setPage(0); }, [search]);

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  const totalPages     = Math.ceil(total / PAGE_SIZE);
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
                  style={allPageSelected ? {
                    background: "linear-gradient(135deg, #3fb06c, #16A34A)",
                  } : { background: "transparent" }}
                >
                  {allPageSelected && <span className="text-white text-[10px] leading-none">✓</span>}
                </div>
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Nome</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Telefone</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Tags</th>
            </tr>
          </thead>
          <tbody>
            {loading && contacts.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.06)" }}>
                  <td className="px-4 py-3"><div className="w-4 h-4 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.1)" }} /></td>
                  <td className="px-4 py-3"><div className="h-3.5 w-32 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.08)" }} /></td>
                  <td className="px-4 py-3"><div className="h-3.5 w-28 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.08)" }} /></td>
                  <td className="px-4 py-3"><div className="h-3.5 w-16 rounded animate-pulse" style={{ background: "rgba(63,176,108,0.08)" }} /></td>
                </tr>
              ))
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-agro-muted">
                  Nenhum contato encontrado
                </td>
              </tr>
            ) : (
              contacts.map((contact, i) => {
                const isSelected = selected.includes(contact.id);
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
                        style={isSelected ? {
                          background: "linear-gradient(135deg, #3fb06c, #16A34A)",
                        } : { background: "transparent" }}
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
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {contact.tags?.map((tag) => (
                          <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-medium text-agro-green"
                            style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
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
