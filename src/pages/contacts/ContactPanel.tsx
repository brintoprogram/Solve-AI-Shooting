import { useEffect, useState } from "react";
import {
  X, Mail, Phone, Building2, Hash, MapPin,
  User, CreditCard, Loader2, Pencil, Plus, ClipboardList, FileText,
} from "lucide-react";
import jsPDF from "jspdf";
import { drawPdfHeader, drawSection, drawKVRows, drawTable, drawFooter } from "@/lib/exportPdf";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { ContactFormModal } from "./ContactFormModal";
import { InvoiceFormModal } from "./InvoiceFormModal";
import { ContactHistory } from "./ContactHistory";
import type { Invoice } from "./InvoiceFormModal";

// ── Types ──────────────────────────────────────────────────────────

export interface Contact {
  id:                  string;
  name:                string | null;
  phone:               string | null;
  cpf_cnpj:            string | null;
  empresa:             string | null;
  email:               string | null;
  email2:              string | null;
  nome_representante:  string | null;
  email_representante: string | null;
  cep:                 string | null;
  logradouro:          string | null;
  numero:              string | null;
  complemento:         string | null;
  bairro:              string | null;
  cidade:              string | null;
  estado:              string | null;
  tags:                string[];
  created_at:          string;
}

// ── Helpers ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const TAG_PALETTE = [
  { bg: "rgba(63,176,108,0.12)",  text: "#3fb06c", border: "rgba(63,176,108,0.3)"  },
  { bg: "rgba(59,130,246,0.12)",  text: "#60a5fa", border: "rgba(59,130,246,0.3)"  },
  { bg: "rgba(168,85,247,0.12)",  text: "#c084fc", border: "rgba(168,85,247,0.3)"  },
  { bg: "rgba(245,158,11,0.12)",  text: "#fbbf24", border: "rgba(245,158,11,0.3)"  },
  { bg: "rgba(239,68,68,0.12)",   text: "#f87171", border: "rgba(239,68,68,0.3)"   },
  { bg: "rgba(20,184,166,0.12)",  text: "#2dd4bf", border: "rgba(20,184,166,0.3)"  },
];

export function tagColor(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = tag.charCodeAt(i) + ((h << 5) - h);
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

function initials(name: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export const formatDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const INVOICE_STATUS: Record<string, { label: string; bg: string; text: string; border: string }> = {
  pendente:  { label: "Pendente",  bg: "rgba(245,158,11,0.12)", text: "#fbbf24", border: "rgba(245,158,11,0.3)"  },
  pago:      { label: "Pago",      bg: "rgba(63,176,108,0.12)", text: "#3fb06c", border: "rgba(63,176,108,0.3)"  },
  vencido:   { label: "Vencido",   bg: "rgba(239,68,68,0.12)",  text: "#f87171", border: "rgba(239,68,68,0.3)"   },
  cancelado: { label: "Cancelado", bg: "rgba(107,127,110,0.12)",text: "#6b7f6e", border: "rgba(107,127,110,0.3)" },
};

// ── Sub-components ─────────────────────────────────────────────────

export function StatusBadge({ status }: { status: string }) {
  const cfg = INVOICE_STATUS[status] ?? INVOICE_STATUS.pendente;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}
    >
      {cfg.label}
    </span>
  );
}

function InfoRow({
  icon: Icon, label, value,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[#1e2e22] last:border-0">
      <div className="w-7 h-7 rounded-lg bg-[#0a110e] flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-3.5 h-3.5 text-[#3fb06c]" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-[#6b7f6e] uppercase tracking-wider mb-0.5">{label}</p>
        <p className="text-sm text-white break-words">{value}</p>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: "amber" | "red" | "green" }) {
  const c = {
    amber: { bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.2)",  text: "#fbbf24" },
    red:   { bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.2)",   text: "#f87171" },
    green: { bg: "rgba(63,176,108,0.08)",  border: "rgba(63,176,108,0.2)",  text: "#3fb06c" },
  }[color];
  return (
    <div className="rounded-xl p-3" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <p className="text-[10px] text-[#6b7f6e] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-lg font-bold" style={{ color: c.text }}>{value}</p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

interface ContactPanelProps {
  contact:    Contact;
  onClose:    () => void;
  onUpdated?: (c: Contact) => void;
}

export function ContactPanel({ contact: initialContact, onClose, onUpdated }: ContactPanelProps) {
  const { workspaceId } = useAuth();
  const [contact,    setContact]    = useState<Contact>(initialContact);
  const [tab,        setTab]        = useState<"cadastro" | "financeiro" | "historico">("cadastro");
  const [invoices,   setInvoices]   = useState<Invoice[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [visible,    setVisible]    = useState(false);

  // Modals
  const [showEdit,        setShowEdit]        = useState(false);
  const [editingInvoice,  setEditingInvoice]  = useState<Invoice | null | undefined>(undefined); // undefined = closed
  const isInvoiceModalOpen = editingInvoice !== undefined;

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  const loadInvoices = () => {
    setInvLoading(true);
    db.from("contact_invoices")
      .select("*")
      .eq("contact_id", contact.id)
      .order("vencimento", { ascending: false })
      .then(({ data }: { data: Invoice[] | null }) => {
        setInvoices(data ?? []);
        setInvLoading(false);
      });
  };

  useEffect(() => {
    if (tab !== "financeiro") return;
    loadInvoices();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, contact.id]);

  useEffect(() => {
    if (tab !== "financeiro") return;
    const ch = supabase
      .channel(`inv-panel-${contact.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "contact_invoices",
        filter: `contact_id=eq.${contact.id}`,
      }, loadInvoices)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, contact.id]);

  const address = [
    contact.logradouro,
    contact.numero     && `nº ${contact.numero}`,
    contact.complemento,
    contact.bairro,
    contact.cidade,
    contact.estado,
    contact.cep        && `CEP ${contact.cep}`,
  ].filter(Boolean).join(", ");

  const totalPendente = invoices.filter((i) => i.status === "pendente").reduce((s, i) => s + i.valor, 0);
  const totalVencido  = invoices.filter((i) => i.status === "vencido").reduce((s, i) => s + i.valor, 0);
  const totalPago     = invoices.filter((i) => i.status === "pago").reduce((s, i) => s + i.valor, 0);

  function handleContactSaved(updated: Contact) {
    setContact(updated);
    onUpdated?.(updated);
  }

  function exportExtratoPdf() {
    const doc = new jsPDF();
    let y = drawPdfHeader(doc, `Extrato Financeiro — ${contact.name ?? "Sem nome"}`, contact.empresa ?? "");

    y = drawSection(doc, "Dados do Contato", y);
    const infoRows: [string, string][] = [];
    if (contact.phone)   infoRows.push(["Telefone",  contact.phone]);
    if (contact.cpf_cnpj) infoRows.push(["CPF / CNPJ", contact.cpf_cnpj]);
    if (contact.empresa) infoRows.push(["Empresa",   contact.empresa]);
    if (contact.email)   infoRows.push(["E-mail",    contact.email]);
    if (contact.cidade || contact.estado)
      infoRows.push(["Cidade / UF", [contact.cidade, contact.estado].filter(Boolean).join(" / ")]);
    if (infoRows.length === 0) infoRows.push(["", "Dados não preenchidos"]);
    y = drawKVRows(doc, infoRows, y);

    y = drawSection(doc, "Boletos", y);
    if (invoices.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(150, 170, 155);
      doc.text("Nenhum boleto cadastrado.", 14, y);
      y += 8;
    } else {
      const STATUS_PT: Record<string, string> = {
        pendente: "Pendente", pago: "Pago", vencido: "Vencido", cancelado: "Cancelado",
      };
      y = drawTable(doc,
        ["Valor (R$)", "Vencimento", "NF / Ref.", "Status"],
        invoices.map((inv) => [
          new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(inv.valor),
          formatDate(inv.vencimento),
          inv.numero_nf ?? "—",
          STATUS_PT[inv.status] ?? inv.status,
        ]),
        y,
      );

      // Totals
      const totalPend = invoices.filter((i) => i.status === "pendente").reduce((s, i) => s + i.valor, 0);
      const totalVenc = invoices.filter((i) => i.status === "vencido").reduce((s,  i) => s + i.valor, 0);
      const totalPago = invoices.filter((i) => i.status === "pago").reduce((s,    i) => s + i.valor, 0);
      const fmt = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
      y = drawSection(doc, "Resumo", y);
      y = drawKVRows(doc, [
        ["A receber",  fmt(totalPend)],
        ["Em atraso",  fmt(totalVenc)],
        ["Recebido",   fmt(totalPago)],
      ], y);
    }

    drawFooter(doc);
    const fileName = (contact.name ?? "extrato").replace(/\s+/g, "_");
    doc.save(`${fileName}_extrato.pdf`);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed inset-y-0 right-0 z-50 flex flex-col w-full max-w-[580px] shadow-2xl transition-transform duration-300"
        style={{
          background: "#0d1710",
          borderLeft: "1px solid #2a3d30",
          transform: visible ? "translateX(0)" : "translateX(100%)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-5 py-4 shrink-0" style={{ borderBottom: "1px solid #1e2e22" }}>
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-sm shrink-0"
            style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
          >
            {initials(contact.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-white truncate">{contact.name ?? "Sem nome"}</p>
            <p className="text-xs text-[#6b7f6e] truncate">
              {[contact.phone, contact.empresa].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <button
            onClick={exportExtratoPdf}
            title="Exportar extrato PDF"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6b7f6e] hover:text-[#3fb06c] hover:bg-[#1e2e22] transition-colors shrink-0"
          >
            <FileText className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowEdit(true)}
            title="Editar contato"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6b7f6e] hover:text-[#3fb06c] hover:bg-[#1e2e22] transition-colors shrink-0"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6b7f6e] hover:text-white hover:bg-[#1e2e22] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 px-5 pt-3" style={{ borderBottom: "1px solid #1e2e22" }}>
          {(["cadastro", "financeiro", "historico"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative px-4 pb-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? "text-[#3fb06c] border-[#3fb06c]"
                  : "text-[#6b7f6e] border-transparent hover:text-white"
              }`}
            >
              {t === "cadastro" ? "Cadastro" : t === "financeiro" ? "Financeiro" : (
                <span className="flex items-center gap-1">
                  <ClipboardList className="w-3.5 h-3.5" />
                  Histórico
                </span>
              )}
              {t === "financeiro" && invoices.length > 0 && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[#3fb06c]/20 text-[#3fb06c]">
                  {invoices.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">

          {/* ── Cadastro ──────────────────────────────── */}
          {tab === "cadastro" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#2a3d30] bg-[#111a14] px-4 py-1">
                <InfoRow icon={Phone}     label="Telefone / WhatsApp"  value={contact.phone} />
                <InfoRow icon={Hash}      label="CPF / CNPJ"           value={contact.cpf_cnpj} />
                <InfoRow icon={Building2} label="Empresa"              value={contact.empresa} />
                <InfoRow icon={Mail}      label="E-mail"               value={contact.email} />
                <InfoRow icon={Mail}      label="E-mail secundário"    value={contact.email2} />
              </div>

              {(contact.nome_representante || contact.email_representante) && (
                <div>
                  <p className="text-[10px] text-[#6b7f6e] uppercase tracking-wider mb-2 ml-1">Representante</p>
                  <div className="rounded-xl border border-[#2a3d30] bg-[#111a14] px-4 py-1">
                    <InfoRow icon={User} label="Nome"   value={contact.nome_representante} />
                    <InfoRow icon={Mail} label="E-mail" value={contact.email_representante} />
                  </div>
                </div>
              )}

              {address && (
                <div>
                  <p className="text-[10px] text-[#6b7f6e] uppercase tracking-wider mb-2 ml-1">Endereço</p>
                  <div className="rounded-xl border border-[#2a3d30] bg-[#111a14] px-4 py-1">
                    <InfoRow icon={MapPin} label="Endereço completo" value={address} />
                  </div>
                </div>
              )}

              {contact.tags?.length > 0 && (
                <div>
                  <p className="text-[10px] text-[#6b7f6e] uppercase tracking-wider mb-2 ml-1">Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {contact.tags.map((tag) => {
                      const c = tagColor(tag);
                      return (
                        <span key={tag} className="px-2.5 py-1 rounded-full text-xs font-medium"
                          style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                          {tag}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Edit shortcut when panel has no data */}
              {!contact.phone && !contact.email && !contact.empresa && (
                <button
                  onClick={() => setShowEdit(true)}
                  className="w-full py-3 rounded-xl text-sm text-[#3fb06c] hover:bg-[#1e2e22] transition-colors"
                  style={{ border: "1px dashed rgba(63,176,108,0.3)" }}
                >
                  <Pencil className="w-4 h-4 inline mr-2" />
                  Preencher dados do contato
                </button>
              )}
            </div>
          )}

          {/* ── Histórico ─────────────────────────────── */}
          {tab === "historico" && contact.phone && (
            <ContactHistory
              phone={contact.phone}
              contactName={contact.name ?? undefined}
              workspaceId={workspaceId ?? ""}
            />
          )}

          {/* ── Financeiro ────────────────────────────── */}
          {tab === "financeiro" && (
            <div className="space-y-4">
              {/* Summary cards */}
              {invoices.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  <SummaryCard label="A receber" value={formatBRL(totalPendente)} color="amber" />
                  <SummaryCard label="Em atraso" value={formatBRL(totalVencido)}  color="red"   />
                  <SummaryCard label="Recebido"  value={formatBRL(totalPago)}     color="green" />
                </div>
              )}

              {/* Add invoice button */}
              <div className="flex justify-end">
                <button
                  onClick={() => setEditingInvoice(null)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#3fb06c] hover:bg-[#1e2e22] transition-colors"
                  style={{ border: "1px solid rgba(63,176,108,0.25)" }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar boleto
                </button>
              </div>

              {invLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 text-[#3fb06c] animate-spin" />
                </div>
              ) : invoices.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CreditCard className="w-8 h-8 text-[#6b7f6e] mb-3" />
                  <p className="text-sm text-white">Sem boletos cadastrados</p>
                  <p className="text-xs text-[#6b7f6e] mt-1 mb-4">
                    Adicione manualmente ou importe via planilha
                  </p>
                  <button
                    onClick={() => setEditingInvoice(null)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-[#3fb06c] hover:bg-[#1e2e22] transition-colors"
                    style={{ border: "1px solid rgba(63,176,108,0.25)" }}
                  >
                    <Plus className="w-3.5 h-3.5" /> Adicionar primeiro boleto
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-[#2a3d30] overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[#111a14]" style={{ borderBottom: "1px solid #2a3d30" }}>
                        <th className="px-3 py-2.5 text-left text-[#6b7f6e] font-medium">Valor</th>
                        <th className="px-3 py-2.5 text-left text-[#6b7f6e] font-medium">Vencimento</th>
                        <th className="px-3 py-2.5 text-left text-[#6b7f6e] font-medium">NF / Ref.</th>
                        <th className="px-3 py-2.5 text-left text-[#6b7f6e] font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv, i) => (
                        <tr
                          key={inv.id}
                          onClick={() => setEditingInvoice(inv)}
                          className="cursor-pointer transition-colors hover:bg-[#1e2e22]/60"
                          style={{ borderBottom: i < invoices.length - 1 ? "1px solid #1e2e22" : undefined }}
                          title="Clique para editar"
                        >
                          <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">
                            {formatBRL(inv.valor)}
                          </td>
                          <td className="px-3 py-2.5 text-[#6b7f6e] font-mono">
                            {formatDate(inv.vencimento)}
                          </td>
                          <td className="px-3 py-2.5 text-[#6b7f6e] font-mono max-w-[120px] truncate">
                            {inv.numero_nf ?? "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge status={inv.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Contact edit modal ─────────────────────────── */}
      {showEdit && (
        <ContactFormModal
          contact={contact}
          onClose={() => setShowEdit(false)}
          onSaved={handleContactSaved}
        />
      )}

      {/* ── Invoice add / edit modal ───────────────────── */}
      {isInvoiceModalOpen && (
        <InvoiceFormModal
          invoice={editingInvoice ?? undefined}
          contactId={contact.id}
          onClose={() => setEditingInvoice(undefined)}
          onSaved={loadInvoices}
          onDeleted={loadInvoices}
        />
      )}
    </>
  );
}
