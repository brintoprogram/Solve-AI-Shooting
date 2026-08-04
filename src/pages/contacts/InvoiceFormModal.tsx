import { useState } from "react";
import { X, Loader2, Check, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";


export interface Invoice {
  id:            string;
  valor:         number;
  vencimento:    string | null;
  status:        string;
  numero_nf:     string | null;
  codigo_barras: string | null;
  created_at:    string;
}

const STATUSES = [
  { value: "pendente",  label: "Pendente"  },
  { value: "pago",      label: "Pago"      },
  { value: "vencido",   label: "Vencido"   },
  { value: "cancelado", label: "Cancelado" },
];

// ── Currency helpers ───────────────────────────────────
// Parses Brazilian currency string to float for NUMERIC(15,2) storage.
// "1.250,00" → 1250.00 | "1250,50" → 1250.50 | "1250.50" → treated as EN format
function parseBRL(str: string): number {
  const s = str.trim();
  if (!s) return 0;
  // If the string has both dot and comma, assume pt-BR (dot = thousands, comma = decimal)
  if (s.includes(".") && s.includes(",")) {
    return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  }
  // Only comma → decimal separator
  if (s.includes(",") && !s.includes(".")) {
    return parseFloat(s.replace(",", ".")) || 0;
  }
  // Only dot or pure digits → standard float
  return parseFloat(s) || 0;
}

function initialValorStr(valor: number | undefined): string {
  if (!valor) return "";
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const inputCls = [
  "w-full bg-[#0a110e] border border-[#2a3d30] rounded-xl px-3 py-2",
  "text-sm text-white placeholder-[#6b7f6e]",
  "focus:outline-none focus:border-[#3fb06c] transition-colors",
].join(" ");

interface Props {
  invoice?:   Invoice | null;
  contactId:  string;
  onClose:    () => void;
  onSaved:    () => void;
  onDeleted?: () => void;
}

export function InvoiceFormModal({ invoice, contactId, onClose, onSaved, onDeleted }: Props) {
  const isNew = !invoice;
  const workspaceId = useAuth().workspaceId ?? "";

  const [valorStr,      setValorStr]     = useState(initialValorStr(invoice?.valor));
  const [vencimento,    setVencimento]   = useState(invoice?.vencimento    ?? "");
  const [status,        setStatus]       = useState(invoice?.status        ?? "pendente");
  const [numero_nf,     setNumeroNf]     = useState(invoice?.numero_nf     ?? "");
  const [codigo_barras, setCodigoBarras] = useState(invoice?.codigo_barras ?? "");
  const [saving,        setSaving]       = useState(false);
  const [deleting,      setDeleting]     = useState(false);
  const [error,         setError]        = useState("");

  async function handleSave() {
    const valor = parseBRL(valorStr);

    if (valor <= 0) {
      setError("Informe um valor válido maior que zero.");
      return;
    }
    if (!vencimento) {
      setError("Informe a data de vencimento.");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      workspace_id:  workspaceId,
      contact_id:    contactId,
      valor,
      vencimento,
      status,
      numero_nf:     numero_nf.trim()     || null,
      codigo_barras: codigo_barras.trim() || null,
    };

    const q = isNew
      ? supabase.from("contact_invoices").insert(payload)
      : supabase.from("contact_invoices").update(payload).eq("id", invoice!.id);

    const { error: err } = await q;
    setSaving(false);

    if (err) { setError(err.message); return; }

    onSaved();
    onClose();
  }

  async function handleDelete() {
    if (!invoice) return;
    if (!confirm("Excluir este boleto? Esta ação não pode ser desfeita.")) return;
    setDeleting(true);
    const { error: err } = await supabase.from("contact_invoices").delete().eq("id", invoice.id);
    setDeleting(false);
    if (err) { setError(err.message); return; }
    onDeleted?.();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-md flex flex-col rounded-2xl overflow-hidden"
        style={{ background: "#0d1710", border: "1px solid #2a3d30", boxShadow: "0 24px 80px rgba(0,0,0,0.7)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid #1e2e22" }}>
          <h2 className="text-sm font-bold text-white">
            {isNew ? "Adicionar Boleto" : "Editar Boleto"}
          </h2>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[#6b7f6e] hover:text-white hover:bg-[#1e2e22] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">

          {error && (
            <div className="px-3 py-2 rounded-lg text-xs text-red-400"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
            </div>
          )}

          {/* Valor */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] mb-1.5">
              Valor <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6b7f6e] select-none pointer-events-none">
                R$
              </span>
              <input
                className={inputCls + " pl-9 text-right font-mono"}
                value={valorStr}
                onChange={(e) => setValorStr(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={() => {
                  const n = parseBRL(valorStr);
                  if (n > 0) setValorStr(n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                }}
                placeholder="0,00"
                inputMode="decimal"
              />
            </div>
            <p className="text-[10px] text-[#6b7f6e] mt-1">
              Use vírgula para centavos: <span className="font-mono text-[#9ca3af]">1.250,00</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Vencimento */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] mb-1.5">
                Vencimento <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                className={inputCls}
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                style={{ colorScheme: "dark" }}
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] mb-1.5">
                Status
              </label>
              <select
                className={inputCls + " cursor-pointer appearance-none"}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Número NF */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] mb-1.5">
                Número NF / Referência
              </label>
              <input
                className={inputCls}
                value={numero_nf}
                onChange={(e) => setNumeroNf(e.target.value)}
                placeholder="NF-12345"
              />
            </div>

            {/* Código de barras */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] mb-1.5">
                Código de Barras
              </label>
              <input
                className={inputCls}
                value={codigo_barras}
                onChange={(e) => setCodigoBarras(e.target.value)}
                placeholder="00000.00000..."
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderTop: "1px solid #1e2e22", background: "rgba(10,17,14,0.6)" }}>
          {!isNew ? (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Excluir
            </button>
          ) : <div />}

          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="px-4 py-2 text-sm text-[#6b7f6e] hover:text-white transition-colors rounded-xl hover:bg-[#1e2e22]">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white btn-agro disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
