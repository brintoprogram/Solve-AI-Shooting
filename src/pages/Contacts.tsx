import { useCallback, useEffect, useState } from "react";
import {
  Users, Upload, Search, ChevronLeft, ChevronRight, Loader2, UserCircle2, Plus, Download, Sparkles,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { ImportModal } from "./contacts/ImportModal";
import { ContactPanel, Contact, tagColor, formatBRL, formatDate } from "./contacts/ContactPanel";
import { ContactFormModal } from "./contacts/ContactFormModal";
import { BaseCleanup } from "./contacts/BaseCleanup";

// ── Constants ──────────────────────────────────────────────────────

const PAGE_SIZE = 25;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Hook ───────────────────────────────────────────────────────────

function useContacts(search: string, page: number) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(false);
  const workspaceId = useAuth().workspaceId ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    let q = db
      .from("inbox_contacts")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .range(from, to);

    if (search.trim()) {
      const s = search.trim();
      q = q.or(`name.ilike.%${s}%,cpf_cnpj.ilike.%${s}%,phone.ilike.%${s}%,empresa.ilike.%${s}%`);
    }

    const { data, count, error } = await q;
    if (!error) {
      setContacts(data ?? []);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [search, page, workspaceId]);

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
  // 1. Fetch ALL contacts (no pagination)
  const { data: allContacts } = await db
    .from("inbox_contacts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });

  const contacts: Contact[] = allContacts ?? [];

  // 2. Fetch ALL invoices for this workspace
  const { data: allInvoices } = await db
    .from("contact_invoices")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("vencimento", { ascending: true });

  const invoices: Array<Record<string, unknown>> = allInvoices ?? [];

  // 3. Fetch ALL contact notes for this workspace
  const { data: allNotes } = await db
    .from("contact_notes")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  const notes: Array<Record<string, unknown>> = allNotes ?? [];

  // 3. Build contacts sheet
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

  // 4. Build invoices sheet (with contact name for cross-reference)
  const contactMap = new Map(contacts.map((c) => [c.id, c.name ?? c.phone ?? c.id]));
  const invoiceRows = invoices.map((inv) => ({
    "Contato":        contactMap.get(inv.contact_id as string) ?? "",
    "Número NF":      inv.numero_nf ?? "",
    "Valor":          typeof inv.valor === "number" ? inv.valor : "",
    "Vencimento":     formatDate(inv.vencimento as string | null),
    "Status":         inv.status ?? "",
    "Código de Barras": inv.codigo_barras ?? "",
  }));

  // Build notes sheet
  const TYPE_LABELS: Record<string, string> = {
    nota: "Nota", ligacao: "Ligação", email: "E-mail",
    reuniao: "Reunião", follow_up: "Follow-up", acao: "Ação urgente",
  };
  const noteRows = notes.map((n) => ({
    "Contato":          n.contact_name ?? "",
    "Telefone":         n.contact_phone ?? "",
    "Tipo":             TYPE_LABELS[n.type as string] ?? (n.type as string),
    "Conteúdo":         n.content ?? "",
    "Registrado por":   n.created_by_name ?? "",
    "Data follow-up":   n.follow_up_date ? formatDate(n.follow_up_date as string) : "",
    "Follow-up feito":  n.follow_up_done ? "Sim" : "Não",
    "Data registro":    n.created_at ? new Date(n.created_at as string).toLocaleString("pt-BR") : "",
  }));

  // 5. Create workbook with 3 sheets
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

function EmptyState({ search, onImport }: { search: string; onImport: () => void }) {
  if (search) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Search className="w-8 h-8 text-[#6b7f6e] mb-3" />
        <p className="text-sm font-medium text-white">Nenhum resultado para "{search}"</p>
        <p className="text-xs text-[#6b7f6e] mt-1">Tente outro nome, CPF ou telefone.</p>
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

function TH({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

// ── Main page ──────────────────────────────────────────────────────

export function Contacts() {
  const [search,   setSearch]   = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page,     setPage]     = useState(1);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showNewContact, setShowNewContact] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [mainTab, setMainTab]   = useState<"lista" | "limpeza">("lista");
  const workspaceId = useAuth().workspaceId ?? "";

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { contacts, total, loading, refresh } = useContacts(debouncedSearch, page);
  const pages = Math.ceil(total / PAGE_SIZE);

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
              {loading ? "Carregando…" : `${total} contato${total !== 1 ? "s" : ""} cadastrado${total !== 1 ? "s" : ""}`}
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
          { id: "lista"  as const, label: "Contatos", icon: Users     },
          { id: "limpeza"as const, label: "Limpeza de Base", icon: Sparkles },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMainTab(id)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px"
            style={mainTab === id
              ? { color: "#3fb06c", borderColor: "#3fb06c", background: "rgba(63,176,108,0.04)" }
              : { color: "#6b7f6e", borderColor: "transparent" }
            }
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

      {/* ── Search (only on lista tab) ────────────────── */}
      {mainTab === "lista" && (
      <div className="px-6 py-3 shrink-0" style={{ borderBottom: "1px solid #1e2e22" }}>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b7f6e]" />
          <input
            type="text"
            placeholder="Buscar por nome, CPF, telefone ou empresa…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#111a14] border border-[#2a3d30] rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-[#6b7f6e] focus:outline-none focus:border-[#3fb06c] transition-colors"
          />
        </div>
      </div>
      )}

      {/* ── Table (only on lista tab) ─────────────────── */}
      {mainTab === "lista" && (<>
      <div className="flex-1 overflow-auto">
        {loading && contacts.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-[#3fb06c] animate-spin" />
          </div>
        ) : contacts.length === 0 ? (
          <EmptyState search={debouncedSearch} onImport={() => setShowImport(true)} />
        ) : (
          <table className="w-full text-sm" style={{ minWidth: 1100 }}>
            <thead className="sticky top-0 z-10" style={{ background: "#0d1710", borderBottom: "1px solid #1e2e22" }}>
              <tr>
                <TH className="pl-5 w-[220px]">Nome / Empresa</TH>
                <TH className="w-[140px]">Telefone</TH>
                <TH className="w-[140px]">CPF / CNPJ</TH>
                <TH className="w-[190px]">Email</TH>
                <TH className="w-[170px]">Representante</TH>
                <TH className="w-[160px]">Cidade / UF</TH>
                <TH>Tags</TH>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact, i) => (
                <tr
                  key={contact.id}
                  onClick={() => setSelected(contact)}
                  className="cursor-pointer transition-colors hover:bg-[#111a14] group"
                  style={{ borderBottom: i < contacts.length - 1 ? "1px solid #1a2a1e" : undefined }}
                >
                  {/* Name + company */}
                  <td className="px-5 py-3">
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

                  {/* Phone */}
                  <td className="px-4 py-3 text-xs text-[#6b7f6e] font-mono">
                    {contact.phone ?? "—"}
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
                  <td className="px-4 py-3 text-xs max-w-[170px]">
                    {contact.nome_representante ? (
                      <>
                        <p className="text-[#b0c4b8] truncate" title={contact.nome_representante}>{contact.nome_representante}</p>
                        {contact.email_representante && (
                          <p className="text-[#4a6b50] truncate mt-0.5" title={contact.email_representante}>{contact.email_representante}</p>
                        )}
                      </>
                    ) : "—"}
                  </td>

                  {/* Cidade / UF */}
                  <td className="px-4 py-3 text-xs text-[#6b7f6e]">
                    {contact.cidade || contact.estado ? (
                      <span>
                        {[contact.cidade, contact.estado].filter(Boolean).join(" / ")}
                      </span>
                    ) : "—"}
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
              ))}
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
          onUpdated={(updated) => {
            setSelected(updated);
            refresh();
          }}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onSuccess={() => { setShowImport(false); refresh(); }}
        />
      )}

      {showNewContact && (
        <ContactFormModal
          onClose={() => setShowNewContact(false)}
          onSaved={(c) => {
            setShowNewContact(false);
            refresh();
            setSelected(c);
          }}
        />
      )}
    </div>
  );
}
