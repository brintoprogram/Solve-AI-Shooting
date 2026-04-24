import { useState } from "react";
import { X, Loader2, Check, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import type { Contact } from "./ContactPanel";
import { tagColor } from "./ContactPanel";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Props {
  contact?: Contact | null;
  onClose:  () => void;
  onSaved:  (c: Contact) => void;
}

// ── Reusable field wrapper ─────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = [
  "w-full bg-[#0a110e] border border-[#2a3d30] rounded-xl px-3 py-2",
  "text-sm text-white placeholder-[#6b7f6e]",
  "focus:outline-none focus:border-[#3fb06c] transition-colors",
].join(" ");

// ── Component ──────────────────────────────────────────
export function ContactFormModal({ contact, onClose, onSaved }: Props) {
  const workspaceId = useAuth().workspaceId ?? "";
  const isNew = !contact;

  const [name,                setName]               = useState(contact?.name                ?? "");
  const [phone,               setPhone]              = useState(contact?.phone               ?? "");
  const [cpf_cnpj,            setCpfCnpj]           = useState(contact?.cpf_cnpj            ?? "");
  const [empresa,             setEmpresa]            = useState(contact?.empresa             ?? "");
  const [email,               setEmail]              = useState(contact?.email               ?? "");
  const [email2,              setEmail2]             = useState(contact?.email2              ?? "");
  const [nome_representante,  setNomeRep]            = useState(contact?.nome_representante  ?? "");
  const [email_representante, setEmailRep]           = useState(contact?.email_representante ?? "");
  const [cep,                 setCep]                = useState(contact?.cep                 ?? "");
  const [logradouro,          setLogradouro]         = useState(contact?.logradouro          ?? "");
  const [numero,              setNumero]             = useState(contact?.numero              ?? "");
  const [complemento,         setComplemento]        = useState(contact?.complemento         ?? "");
  const [bairro,              setBairro]             = useState(contact?.bairro              ?? "");
  const [cidade,              setCidade]             = useState(contact?.cidade              ?? "");
  const [estado,              setEstado]             = useState(contact?.estado              ?? "");
  const [tags,                setTags]               = useState<string[]>(contact?.tags      ?? []);
  const [tagInput,            setTagInput]           = useState("");
  const [saving,              setSaving]             = useState(false);
  const [error,               setError]              = useState("");

  function addTag() {
    const t = tagInput.trim().replace(/,/g, "");
    if (!t || tags.includes(t)) { setTagInput(""); return; }
    setTags([...tags, t]);
    setTagInput("");
  }

  async function handleSave() {
    if (!phone.trim() && !name.trim()) {
      setError("Informe ao menos o Nome ou o Telefone.");
      return;
    }
    setSaving(true);
    setError("");

    const payload = {
      workspace_id:        workspaceId,
      name:                name.trim()                || null,
      phone:               phone.trim()               || null,
      cpf_cnpj:            cpf_cnpj.trim()            || null,
      empresa:             empresa.trim()             || null,
      email:               email.trim()               || null,
      email2:              email2.trim()              || null,
      nome_representante:  nome_representante.trim()  || null,
      email_representante: email_representante.trim() || null,
      cep:                 cep.trim()                 || null,
      logradouro:          logradouro.trim()          || null,
      numero:              numero.trim()              || null,
      complemento:         complemento.trim()         || null,
      bairro:              bairro.trim()              || null,
      cidade:              cidade.trim()              || null,
      estado:              estado.trim()              || null,
      tags,
    };

    const q = isNew
      ? db.from("inbox_contacts").insert(payload).select().single()
      : db.from("inbox_contacts").update(payload).eq("id", contact!.id).select().single();

    const { data, error: err } = await q;

    setSaving(false);

    if (err) { setError(err.message); return; }

    onSaved(data as Contact);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: "#0d1710", border: "1px solid #2a3d30", boxShadow: "0 32px 100px rgba(0,0,0,0.7)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid #1e2e22" }}>
          <h2 className="text-base font-bold text-white">
            {isNew ? "Novo Contato" : `Editar — ${contact?.name ?? contact?.phone ?? "Contato"}`}
          </h2>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[#6b7f6e] hover:text-white hover:bg-[#1e2e22] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {error && (
            <div className="px-4 py-3 rounded-xl text-sm text-red-400"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
            </div>
          )}

          {/* Identificação */}
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] mb-3 border-b border-[#1e2e22] pb-2">
              Identificação
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome / Razão Social">
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="João da Silva" />
              </Field>
              <Field label="Telefone / WhatsApp" required>
                <input
                  className={inputCls}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 13))}
                  placeholder="5511999999999"
                  inputMode="numeric"
                  maxLength={13}
                />
              </Field>
              <Field label="CPF / CNPJ">
                <input
                  className={inputCls}
                  value={cpf_cnpj}
                  onChange={(e) => {
                    const d = e.target.value.replace(/\D/g, "").slice(0, 14);
                    if (d.length <= 11) {
                      setCpfCnpj(
                        d.replace(/(\d{3})(\d)/, "$1.$2")
                         .replace(/(\d{3})(\d)/, "$1.$2")
                         .replace(/(\d{3})(\d{1,2})$/, "$1-$2")
                      );
                    } else {
                      setCpfCnpj(
                        d.replace(/(\d{2})(\d)/, "$1.$2")
                         .replace(/(\d{3})(\d)/, "$1.$2")
                         .replace(/(\d{3})(\d)/, "$1/$2")
                         .replace(/(\d{4})(\d{1,2})$/, "$1-$2")
                      );
                    }
                  }}
                  placeholder="000.000.000-00"
                  inputMode="numeric"
                  maxLength={18}
                />
              </Field>
              <Field label="Empresa / Nome Fantasia">
                <input className={inputCls} value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Empresa Ltda." />
              </Field>
              <Field label="E-mail principal">
                <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@empresa.com" />
              </Field>
              <Field label="E-mail secundário">
                <input className={inputCls} type="email" value={email2} onChange={(e) => setEmail2(e.target.value)} placeholder="outro@empresa.com" />
              </Field>
            </div>
          </section>

          {/* Representante */}
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] mb-3 border-b border-[#1e2e22] pb-2">
              Representante / Responsável
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome">
                <input className={inputCls} value={nome_representante} onChange={(e) => setNomeRep(e.target.value)} placeholder="Nome do responsável" />
              </Field>
              <Field label="E-mail">
                <input className={inputCls} type="email" value={email_representante} onChange={(e) => setEmailRep(e.target.value)} placeholder="resp@empresa.com" />
              </Field>
            </div>
          </section>

          {/* Endereço */}
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] mb-3 border-b border-[#1e2e22] pb-2">
              Endereço
            </p>
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-2">
                <Field label="CEP">
                  <input className={inputCls} value={cep} onChange={(e) => setCep(e.target.value)} placeholder="00000-000" />
                </Field>
              </div>
              <div className="col-span-4">
                <Field label="Logradouro">
                  <input className={inputCls} value={logradouro} onChange={(e) => setLogradouro(e.target.value)} placeholder="Rua, Av., Praça..." />
                </Field>
              </div>
              <div className="col-span-1">
                <Field label="Número">
                  <input className={inputCls} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="123" />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Complemento">
                  <input className={inputCls} value={complemento} onChange={(e) => setComplemento(e.target.value)} placeholder="Apto, Sala..." />
                </Field>
              </div>
              <div className="col-span-3">
                <Field label="Bairro">
                  <input className={inputCls} value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Bairro" />
                </Field>
              </div>
              <div className="col-span-4">
                <Field label="Cidade">
                  <input className={inputCls} value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="São Paulo" />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="UF">
                  <input className={inputCls} value={estado} onChange={(e) => setEstado(e.target.value.toUpperCase())} placeholder="SP" maxLength={2} />
                </Field>
              </div>
            </div>
          </section>

          {/* Tags */}
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e] mb-3 border-b border-[#1e2e22] pb-2">
              Tags
            </p>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((t) => {
                  const c = tagColor(t);
                  return (
                    <button key={t} onClick={() => setTags(tags.filter((x) => x !== t))}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium hover:opacity-70 transition-opacity"
                      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                      {t}
                      <X className="w-2.5 h-2.5 ml-0.5" />
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
                placeholder="Nova tag (Enter para adicionar)"
              />
              <button onClick={addTag}
                className="px-3 py-2 rounded-xl text-[#3fb06c] hover:bg-[#1e2e22] transition-colors shrink-0"
                style={{ border: "1px solid rgba(63,176,108,0.25)" }}>
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 shrink-0"
          style={{ borderTop: "1px solid #1e2e22", background: "rgba(10,17,14,0.6)" }}>
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#6b7f6e] hover:text-white transition-colors rounded-xl hover:bg-[#1e2e22]">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white btn-agro disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? "Salvando..." : (isNew ? "Criar contato" : "Salvar alterações")}
          </button>
        </div>
      </div>
    </div>
  );
}
