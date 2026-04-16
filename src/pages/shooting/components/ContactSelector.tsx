import { useState } from "react";
import { Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface Contact {
  id: string;
  name: string;
  phone: string;
  tags?: string[];
}

interface ContactSelectorProps {
  workspaceId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}

const MOCK_CONTACTS: Contact[] = Array.from({ length: 20 }, (_, i) => ({
  id: `contact-${i + 1}`,
  name: `Contato ${i + 1}`,
  phone: `+5511${String(90000000 + i).padStart(9, "0")}`,
  tags: i % 3 === 0 ? ["produtor", "soja"] : i % 3 === 1 ? ["cliente", "ativo"] : ["cliente"],
}));

export function ContactSelector({ selected, onChange }: ContactSelectorProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;

  const filtered = MOCK_CONTACTS.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
  );
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  const allPageSelected = paginated.every((c) => selected.includes(c.id));

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
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <button
          onClick={() => onChange(filtered.map((c) => c.id))}
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
          <span className="font-bold text-agro-text">{filtered.length}</span> contatos
        </span>
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
                      onChange(selected.filter((s) => !paginated.find((c) => c.id === s)));
                    } else {
                      onChange([...new Set([...selected, ...paginated.map((c) => c.id)])]);
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
            {paginated.map((contact, i) => {
              const isSelected = selected.includes(contact.id);
              return (
                <tr
                  key={contact.id}
                  className="cursor-pointer transition-all duration-200"
                  style={{
                    borderBottom: i < paginated.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none",
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
            })}
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
