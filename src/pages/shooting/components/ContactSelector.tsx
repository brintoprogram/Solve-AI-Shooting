import { useState } from "react";
import { Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

// Mock contacts for demonstration — in production these come from Supabase
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

  function selectAll() {
    onChange(filtered.map((c) => c.id));
  }

  function clearAll() {
    onChange([]);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={selectAll}>
          Selecionar todos
        </Button>
        <Button variant="ghost" size="sm" onClick={clearAll}>
          Limpar
        </Button>
      </div>

      {/* Counter */}
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{selected.length}</span> selecionados de{" "}
          <span className="font-semibold text-gray-900">{filtered.length}</span> contatos
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="w-10 px-4 py-2.5">
                <Checkbox
                  checked={paginated.every((c) => selected.includes(c.id))}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onChange([...new Set([...selected, ...paginated.map((c) => c.id)])]);
                    } else {
                      onChange(selected.filter((s) => !paginated.find((c) => c.id === s)));
                    }
                  }}
                />
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Telefone</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Tags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginated.map((contact) => (
              <tr
                key={contact.id}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => toggle(contact.id)}
              >
                <td className="px-4 py-3">
                  <Checkbox
                    checked={selected.includes(contact.id)}
                    onCheckedChange={() => toggle(contact.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">{contact.name}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{contact.phone}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {contact.tags?.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px] px-2 py-0">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Página {page + 1} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
