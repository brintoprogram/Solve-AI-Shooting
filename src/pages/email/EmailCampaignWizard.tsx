import { useState, useEffect, useRef } from "react";
import {
  Settings2, Users, FileText, CheckCircle,
  ChevronLeft, ChevronRight, Search, Mail, X, Plus,
  AlertCircle, Info,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

// ── Types ────────────────────────────────────────────────────────

interface EmailConn { id: string; name: string; from_email: string; from_name: string; provider?: string; }

interface Contact {
  id: string;
  name: string;
  email: string;
  phone?: string;
  email_representante?: string;
  gerente1_nome?: string;
  gerente1_email?: string;
  gerente2_nome?: string;
  gerente2_email?: string;
  [key: string]: unknown;
}

interface WizardState {
  step: 1 | 2 | 3 | 4;
  name: string;
  emailConnectionId: string;
  sendingSpeed: number;
  dataSource: "contacts";
  selectedContactIds: string[];
  contacts: Contact[];           // full contact objects for selected contacts
  subject: string;
  bodyHtml: string;
  ccList: string;                // comma-separated
  ccRepresentante: boolean;
  ccGerentes: boolean;
  totalRecipients: number;
}

const INITIAL: WizardState = {
  step: 1,
  name: "",
  emailConnectionId: "",
  sendingSpeed: 60,
  dataSource: "contacts",
  selectedContactIds: [],
  contacts: [],
  subject: "",
  bodyHtml: "",
  ccList: "",
  ccRepresentante: false,
  ccGerentes: false,
  totalRecipients: 0,
};

const STEPS = [
  { id: 1, label: "Configuração",   subtitle: "Nome & SMTP",      icon: Settings2  },
  { id: 2, label: "Destinatários",  subtitle: "Quem vai receber", icon: Users      },
  { id: 3, label: "Conteúdo",       subtitle: "Assunto & corpo",  icon: FileText   },
  { id: 4, label: "Confirmação",    subtitle: "Revisar & enviar", icon: CheckCircle},
];

// ── Available template variables ─────────────────────────────────
const BASE_VARS = [
  { key: "nome",                label: "Nome" },
  { key: "email",               label: "Email" },
  { key: "telefone",            label: "Telefone" },
  { key: "empresa",             label: "Empresa" },
  { key: "email_representante", label: "Email Representante" },
];

// ── Helper: replace {{variavel}} with contact data ────────────────
function interpolate(template: string, contact: Record<string, unknown> | null): string {
  if (!contact) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(contact[key] ?? `{{${key}}}`));
}

// ── Main Wizard ──────────────────────────────────────────────────

interface EmailCampaignWizardProps {
  onClose: () => void;
  onCreated: () => void;
}

export function EmailCampaignWizard({ onClose, onCreated }: EmailCampaignWizardProps) {
  const { toast } = useToast();
  const { workspaceId } = useAuth();
  const WORKSPACE_ID = workspaceId ?? "";
  const [state, setState]       = useState<WizardState>(INITIAL);
  const [emailConns, setEmailConns] = useState<EmailConn[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase
      .from("email_connections")
      .select("id,name,from_email,from_name,provider")
      .eq("workspace_id", WORKSPACE_ID)
      .then(({ data }) => { if (data) setEmailConns(data as EmailConn[]); });
  }, []);

  function patch(p: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...p }));
  }

  const step = state.step;

  function canProceed(): boolean {
    if (step === 1) return !!state.name.trim() && !!state.emailConnectionId;
    if (step === 2) return state.totalRecipients > 0;
    if (step === 3) return !!state.subject.trim() && !!state.bodyHtml.trim();
    return true;
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const ccParsed = state.ccList
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      const { data: campaign, error: camErr } = await supabase
        .from("email_campaigns")
        .insert({
          workspace_id:         WORKSPACE_ID,
          email_connection_id:  state.emailConnectionId,
          name:                 state.name,
          subject:              state.subject,
          body_html:            state.bodyHtml,
          data_source:          "contacts",
          column_mapping:       {},
          filters:              {},
          cc_list:              ccParsed,
          cc_representante:     state.ccRepresentante,
          total_recipients:     state.totalRecipients,
          status:               "draft",
          sending_speed:        state.sendingSpeed,
          created_by:           null,
        })
        .select("id")
        .single();

      if (camErr) throw new Error(camErr.message);

      // Insert email_messages for each selected contact
      const messages = state.contacts.map((c) => {
        const ccEmails = [...ccParsed];
        if (state.ccRepresentante && c.email_representante) {
          ccEmails.push(c.email_representante);
        }
        if (state.ccGerentes) {
          if (c.gerente1_email) ccEmails.push(c.gerente1_email);
          if (c.gerente2_email) ccEmails.push(c.gerente2_email);
        }
        return {
          campaign_id:     campaign.id,
          workspace_id:    WORKSPACE_ID,
          recipient_email: c.email,
          recipient_name:  c.name ?? null,
          recipient_data:  c,
          cc_emails:       ccEmails,
          status:          "pending" as const,
          retry_count:     0,
          max_retries:     2,
        };
      });

      for (let i = 0; i < messages.length; i += 500) {
        const { error } = await supabase.from("email_messages").insert(messages.slice(i, i + 500));
        if (error) throw new Error(error.message);
      }

      toast({ title: "Campanha criada!", description: "Clique em Iniciar para começar o disparo.", variant: "success" });
      onCreated();
      onClose();
    } catch (err) {
      toast({ title: "Erro ao criar campanha", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* ── Stepper ─────────────────────────────── */}
        <div className="mb-10 animate-fade-up">
          <div className="flex items-center">
            {STEPS.map((s, i) => {
              const isDone   = step > s.id;
              const isActive = step === s.id;
              const isFuture = step < s.id;
              return (
                <div key={s.id} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div className="relative">
                      {isActive && (
                        <div className="absolute -inset-2 rounded-full animate-glow-pulse"
                          style={{ background: "rgba(63,176,108,0.15)" }}
                        />
                      )}
                      <div className={cn(
                        "relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-500",
                        isDone && "glow-green-sm",
                        isActive && "glow-green",
                      )}
                        style={{
                          background: isDone
                            ? "linear-gradient(135deg, #3fb06c, #16A34A)"
                            : isActive
                            ? "linear-gradient(135deg, rgba(63,176,108,0.2), rgba(22,163,74,0.1))"
                            : "rgba(26,46,34,0.6)",
                          border: isDone ? "none" : isActive ? "2px solid #3fb06c" : "2px solid rgba(63,176,108,0.15)",
                          opacity: isFuture ? 0.4 : 1,
                        }}
                      >
                        <s.icon className={cn(
                          "w-4.5 h-4.5 transition-all duration-300",
                          isDone ? "text-white" : isActive ? "text-agro-green" : "text-agro-muted-2",
                        )} />
                      </div>
                    </div>
                    <div className={cn("mt-2.5 text-center transition-all duration-300", isFuture && "opacity-40")}>
                      <p className={cn("text-xs font-semibold leading-none", isDone || isActive ? "text-agro-text" : "text-agro-muted-2")}>{s.label}</p>
                      <p className={cn("text-[10px] mt-0.5", isActive ? "text-agro-green" : "text-agro-muted-2")}>{s.subtitle}</p>
                    </div>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="flex-1 mx-3 mb-7 relative h-0.5 rounded-full overflow-hidden"
                      style={{ background: "rgba(63,176,108,0.12)" }}
                    >
                      {step > s.id && <div className="absolute inset-0 connector-fill" />}
                      {step === s.id && (
                        <div className="absolute inset-0 w-1/2"
                          style={{ background: "linear-gradient(90deg, #3fb06c, transparent)" }}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Main card ────────────────────────────── */}
        <div className="animate-fade-up-delay-1 rounded-2xl overflow-hidden"
          style={{
            background: "rgba(13,26,17,0.8)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(63,176,108,0.12)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.4), inset 0 0 60px rgba(63,176,108,0.02)",
          }}
        >
          {/* Card header */}
          <div className="px-8 py-6 relative" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
            <div className="absolute top-0 left-8 right-8 h-px"
              style={{ background: "linear-gradient(90deg, transparent, rgba(63,176,108,0.4), transparent)" }}
            />
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}
              >
                {(() => { const S = STEPS[step - 1]; return <S.icon className="w-5 h-5 text-agro-green" />; })()}
              </div>
              <div>
                <h2 className="font-display text-xl font-semibold text-agro-text">
                  {step === 1 ? "Configure sua campanha de email"
                    : step === 2 ? "Selecione os destinatários"
                    : step === 3 ? "Escreva o conteúdo do email"
                    : "Revisão final antes do disparo"}
                </h2>
                <p className="text-sm text-agro-muted mt-0.5">
                  {step === 1 ? "Defina o nome, conta SMTP e velocidade de envio"
                    : step === 2 ? "Contatos com email preenchido"
                    : step === 3 ? "Assunto, corpo HTML e configurações de CC"
                    : "Revise todos os detalhes antes de criar a campanha"}
                </p>
              </div>
              <div className="ml-auto shrink-0 px-3 py-1 rounded-full text-xs font-semibold"
                style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)", color: "#3fb06c" }}
              >
                {step} / {STEPS.length}
              </div>
            </div>
          </div>

          {/* Step body */}
          <div className="px-8 py-8">
            <div key={step} className="animate-scale-in">
              {step === 1 && <Step1 state={state} emailConns={emailConns} onChange={patch} />}
              {step === 2 && <Step2 state={state} onChange={patch} />}
              {step === 3 && <Step3 state={state} onChange={patch} />}
              {step === 4 && <Step4 state={state} emailConns={emailConns} onSubmit={handleSubmit} submitting={submitting} />}
            </div>
          </div>

          {/* Footer nav */}
          <div className="px-8 py-5 flex items-center justify-between"
            style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}
          >
            <button
              onClick={() => { if (step === 1) onClose(); else patch({ step: (step - 1) as WizardState["step"] }); }}
              className="flex items-center gap-2 text-sm text-agro-muted hover:text-agro-text transition-colors duration-200 px-4 py-2 rounded-xl hover:bg-white/5"
            >
              <ChevronLeft className="w-4 h-4" />
              {step === 1 ? "Cancelar" : "Voltar"}
            </button>
            {step < 4 && (
              <button
                disabled={!canProceed()}
                onClick={() => patch({ step: (step + 1) as WizardState["step"] })}
                className={cn(
                  "group relative flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200",
                  canProceed() ? "btn-agro cursor-pointer" : "opacity-30 cursor-not-allowed",
                )}
                style={canProceed() ? {} : { background: "rgba(63,176,108,0.15)", border: "1px solid rgba(63,176,108,0.1)" }}
              >
                Próximo
                <ChevronRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 1 — Configuração ────────────────────────────────────────

function Step1({ state, emailConns, onChange }: {
  state: WizardState;
  emailConns: EmailConn[];
  onChange: (p: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-1.5">Nome da campanha *</p>
        <input
          className="input-agro w-full"
          placeholder="Ex: Cobrança Março 2025"
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      <div>
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-1.5">Conta de email (SMTP) *</p>
        {emailConns.length === 0 ? (
          <div className="flex items-center gap-3 p-4 rounded-xl"
            style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-sm text-amber-400">
              Nenhuma conexão SMTP configurada. Adicione uma em{" "}
              <strong>Configurações → Conexões de Email</strong>.
            </p>
          </div>
        ) : (
          <select
            className="input-agro w-full"
            value={state.emailConnectionId}
            onChange={(e) => onChange({ emailConnectionId: e.target.value })}
          >
            <option value="">Selecionar conta...</option>
            {emailConns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.provider === "graph" ? "[M365] " : "[SMTP] "}{c.name} · {c.from_email}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-1.5">
          Velocidade de envio — <span className="text-agro-green">{state.sendingSpeed} emails/min</span>
        </p>
        <input
          type="range" min={10} max={300} step={10}
          value={state.sendingSpeed}
          onChange={(e) => onChange({ sendingSpeed: Number(e.target.value) })}
          className="w-full accent-agro-green"
        />
        <div className="flex justify-between text-[11px] text-agro-muted-2 mt-1">
          <span>10/min (cuidadoso)</span>
          <span>300/min (máximo)</span>
        </div>
        <p className="text-xs text-agro-muted mt-2">
          Gmail recomenda até 100/min. Para SMTP próprio, depende do servidor.
        </p>
      </div>
    </div>
  );
}

// ── Step 2 — Destinatários ───────────────────────────────────────

function Step2({ state, onChange }: {
  state: WizardState;
  onChange: (p: Partial<WizardState>) => void;
}) {
  const { workspaceId } = useAuth();
  const [allContacts, setAllContacts]   = useState<Contact[]>([]);
  const [search, setSearch]             = useState("");
  const [loading, setLoading]           = useState(true);
  const [page, setPage]                 = useState(0);
  const PAGE_SIZE = 10;

  useEffect(() => {
    supabase
      .from("inbox_contacts")
      .select("id,name,email,phone,email_representante,gerente1_nome,gerente1_email,gerente2_nome,gerente2_email")
      .eq("workspace_id", workspaceId ?? "")
      .not("email", "is", null)
      .neq("email", "")
      .order("name", { ascending: true })
      .then(({ data }) => {
        setAllContacts((data ?? []) as Contact[]);
        setLoading(false);
      });
  }, [workspaceId]);

  const filtered = allContacts.filter(
    (c) =>
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const selectedIds = state.selectedContactIds;

  function toggle(contact: Contact) {
    const isSelected = selectedIds.includes(contact.id);
    let nextIds: string[];
    let nextContacts: Contact[];
    if (isSelected) {
      nextIds      = selectedIds.filter((id) => id !== contact.id);
      nextContacts = state.contacts.filter((c) => c.id !== contact.id);
    } else {
      nextIds      = [...selectedIds, contact.id];
      nextContacts = [...state.contacts, contact];
    }
    onChange({ selectedContactIds: nextIds, contacts: nextContacts, totalRecipients: nextIds.length });
  }

  function selectAll() {
    const newIds      = [...new Set([...selectedIds, ...filtered.map((c) => c.id)])];
    const newContacts = [
      ...state.contacts,
      ...filtered.filter((c) => !selectedIds.includes(c.id)),
    ];
    onChange({ selectedContactIds: newIds, contacts: newContacts, totalRecipients: newIds.length });
  }

  function clearAll() {
    onChange({ selectedContactIds: [], contacts: [], totalRecipients: 0 });
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 rounded-xl animate-pulse" style={{ background: "rgba(63,176,108,0.04)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Counter */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.1)" }}
      >
        <Mail className="w-4 h-4 text-agro-green" />
        <span className="text-sm text-agro-muted">
          <span className="font-bold text-agro-text">{selectedIds.length}</span> selecionados
          {" · "}
          <span className="font-bold text-agro-text">{allContacts.length}</span> contatos com email cadastrado
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
          <input
            className="input-agro w-full pl-9"
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <button onClick={selectAll}
          className="px-4 py-2 rounded-xl text-xs font-semibold text-agro-green transition-all hover:bg-white/10"
          style={{ border: "1px solid rgba(63,176,108,0.25)" }}
        >
          Todos
        </button>
        <button onClick={clearAll}
          className="px-4 py-2 rounded-xl text-xs font-semibold text-agro-muted hover:text-agro-text transition-colors"
        >
          Limpar
        </button>
      </div>

      {allContacts.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-xl"
          style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)" }}
        >
          <Info className="w-4 h-4 text-blue-400 shrink-0" />
          <p className="text-sm text-blue-400">
            Nenhum contato com email cadastrado. Adicione emails aos contatos no CRM para poder usar essa função.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.12)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
                  <th className="w-10 px-4 py-3">
                    <div
                      onClick={() => {
                        const allPageSelected = paginated.every((c) => selectedIds.includes(c.id));
                        if (allPageSelected) {
                          const nextIds = selectedIds.filter((id) => !paginated.find((c) => c.id === id));
                          onChange({ selectedContactIds: nextIds, contacts: state.contacts.filter((c) => nextIds.includes(c.id)), totalRecipients: nextIds.length });
                        } else {
                          const newIds      = [...new Set([...selectedIds, ...paginated.map((c) => c.id)])];
                          const newContacts = [...state.contacts, ...paginated.filter((c) => !selectedIds.includes(c.id))];
                          onChange({ selectedContactIds: newIds, contacts: newContacts, totalRecipients: newIds.length });
                        }
                      }}
                      className={cn(
                        "w-4 h-4 rounded cursor-pointer flex items-center justify-center transition-all",
                        paginated.every((c) => selectedIds.includes(c.id)) ? "glow-green-sm" : "border border-agro-muted/40 hover:border-agro-green",
                      )}
                      style={paginated.every((c) => selectedIds.includes(c.id))
                        ? { background: "linear-gradient(135deg, #3fb06c, #16A34A)" }
                        : { background: "transparent" }}
                    >
                      {paginated.every((c) => selectedIds.includes(c.id)) && (
                        <span className="text-white text-[10px] leading-none">✓</span>
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Nome</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Email</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Representante</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Gerente 1</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Gerente 2</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((c, i) => {
                  const isSelected = selectedIds.includes(c.id);
                  return (
                    <tr key={c.id}
                      className="cursor-pointer transition-all duration-200"
                      style={{
                        borderBottom: i < paginated.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none",
                        background: isSelected ? "rgba(63,176,108,0.06)" : "transparent",
                      }}
                      onClick={() => toggle(c)}
                    >
                      <td className="px-4 py-3">
                        <div
                          className={cn("w-4 h-4 rounded flex items-center justify-center transition-all",
                            isSelected ? "glow-green-sm" : "border border-agro-muted/40")}
                          style={isSelected ? { background: "linear-gradient(135deg, #3fb06c, #16A34A)" } : { background: "transparent" }}
                        >
                          {isSelected && <span className="text-white text-[10px] leading-none">✓</span>}
                        </div>
                      </td>
                      <td className={cn("px-4 py-3 font-medium text-sm transition-colors", isSelected ? "text-agro-text" : "text-agro-text-2")}>
                        {c.name}
                      </td>
                      <td className="px-4 py-3 text-agro-muted text-xs font-mono">{c.email}</td>
                      <td className="px-4 py-3 text-agro-muted-2 text-xs">{c.email_representante ?? "—"}</td>
                      <td className="px-4 py-3 text-agro-muted-2 text-xs">{c.gerente1_email ?? "—"}</td>
                      <td className="px-4 py-3 text-agro-muted-2 text-xs">{c.gerente2_email ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-agro-muted">Página {page + 1} de {totalPages}</p>
              <div className="flex gap-2">
                <button disabled={page === 0} onClick={() => setPage(page - 1)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-agro-muted disabled:opacity-40 hover:text-agro-text transition-colors"
                  style={{ border: "1px solid rgba(63,176,108,0.15)" }}
                >
                  Anterior
                </button>
                <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-agro-muted disabled:opacity-40 hover:text-agro-text transition-colors"
                  style={{ border: "1px solid rgba(63,176,108,0.15)" }}
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Step 3 — Conteúdo ────────────────────────────────────────────

function Step3({ state, onChange }: {
  state: WizardState;
  onChange: (p: Partial<WizardState>) => void;
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef    = useRef<HTMLTextAreaElement>(null);
  const [focusedField, setFocusedField] = useState<"subject" | "body" | null>(null);

  function insertVar(key: string) {
    const tag = `{{${key}}}`;
    if (focusedField === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd   ?? el.value.length;
      const next  = el.value.slice(0, start) + tag + el.value.slice(end);
      onChange({ subject: next });
      setTimeout(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); }, 0);
    } else if (bodyRef.current) {
      const el = bodyRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd   ?? el.value.length;
      const next  = el.value.slice(0, start) + tag + el.value.slice(end);
      onChange({ bodyHtml: next });
      setTimeout(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); }, 0);
    }
  }

  const previewContact = state.contacts[0] as Record<string, unknown> | undefined ?? null;
  const previewSubject = interpolate(state.subject, previewContact);
  const previewBody    = interpolate(state.bodyHtml, previewContact);

  return (
    <div className="space-y-6">
      {/* Variable inserter */}
      <div>
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-2">Inserir variável</p>
        <div className="flex flex-wrap gap-2">
          {BASE_VARS.map((v) => (
            <button key={v.key} onClick={() => insertVar(v.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-agro-green transition-all hover:bg-white/10"
              style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.2)" }}
            >
              <Plus className="w-3 h-3" />
              {`{{${v.key}}}`}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-agro-muted-2 mt-1.5">
          Clique em um campo de texto abaixo, posicione o cursor onde quer inserir a variável, depois clique no botão.
        </p>
      </div>

      {/* Subject */}
      <div>
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-1.5">Assunto *</p>
        <input
          ref={subjectRef}
          className="input-agro w-full"
          placeholder="Ex: Olá {{nome}}, sua fatura vence em breve"
          value={state.subject}
          onFocus={() => setFocusedField("subject")}
          onChange={(e) => onChange({ subject: e.target.value })}
        />
        {state.subject && previewContact && (
          <p className="text-[11px] text-agro-muted mt-1.5">Preview: <span className="text-agro-text">{previewSubject}</span></p>
        )}
      </div>

      {/* Body */}
      <div>
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-1.5">Corpo do email (HTML) *</p>
        <textarea
          ref={bodyRef}
          className="input-agro w-full font-mono text-xs"
          rows={10}
          placeholder={`<p>Olá {{nome}},</p>\n<p>Sua fatura no valor de R$ {{valor}} vence em {{vencimento}}.</p>`}
          value={state.bodyHtml}
          onFocus={() => setFocusedField("body")}
          onChange={(e) => onChange({ bodyHtml: e.target.value })}
          style={{ resize: "vertical" }}
        />
      </div>

      {/* CC fixo */}
      <div>
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-1.5">CC fixo (opcional)</p>
        <input
          className="input-agro w-full"
          placeholder="email1@empresa.com, email2@empresa.com"
          value={state.ccList}
          onChange={(e) => onChange({ ccList: e.target.value })}
        />
        <p className="text-[11px] text-agro-muted-2 mt-1">Separe múltiplos emails por vírgula. Todos os envios incluirão estes endereços em cópia.</p>
      </div>

      {/* CC representante */}
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <div
          onClick={() => onChange({ ccRepresentante: !state.ccRepresentante })}
          className={cn("w-10 h-6 rounded-full transition-colors relative shrink-0", state.ccRepresentante ? "bg-agro-green" : "bg-agro-border")}
        >
          <span className={cn(
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
            state.ccRepresentante && "translate-x-4",
          )} />
        </div>
        <div>
          <p className="text-sm text-agro-text">CC automático para representante</p>
          <p className="text-[11px] text-agro-muted-2">Se o contato tiver email_representante cadastrado, ele será incluído em cópia.</p>
        </div>
      </label>

      {/* CC gerentes */}
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <div
          onClick={() => onChange({ ccGerentes: !state.ccGerentes })}
          className={cn("w-10 h-6 rounded-full transition-colors relative shrink-0", state.ccGerentes ? "bg-agro-green" : "bg-agro-border")}
        >
          <span className={cn(
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
            state.ccGerentes && "translate-x-4",
          )} />
        </div>
        <div>
          <p className="text-sm text-agro-text">CC automático para gerentes</p>
          <p className="text-[11px] text-agro-muted-2">Se o contato tiver gerente1_email e/ou gerente2_email cadastrados, ambos serão incluídos em cópia.</p>
        </div>
      </label>

      {/* Live preview */}
      {state.bodyHtml && (
        <div>
          <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-2">Preview (primeiro contato selecionado)</p>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
            <div className="px-4 py-3 text-xs text-agro-muted font-medium" style={{ background: "rgba(13,26,17,0.8)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              <span className="text-agro-muted-2">Assunto: </span>{previewSubject || "—"}
            </div>
            <div
              className="p-4 text-agro-text text-sm bg-white/5"
              dangerouslySetInnerHTML={{ __html: previewBody || "<p class='text-agro-muted-2'>Corpo do email aparecerá aqui...</p>" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 4 — Confirmação ─────────────────────────────────────────

function Step4({ state, emailConns, onSubmit, submitting }: {
  state: WizardState;
  emailConns: EmailConn[];
  onSubmit: () => void;
  submitting: boolean;
}) {
  const conn       = emailConns.find((c) => c.id === state.emailConnectionId);
  const ccParsed   = state.ccList.split(",").map((e) => e.trim()).filter(Boolean);
  const previewContact = state.contacts[0] as Record<string, unknown> | undefined ?? null;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Destinatários", value: String(state.totalRecipients), sub: "contatos com email" },
          { label: "Velocidade",    value: `${state.sendingSpeed}/min`,   sub: "emails por minuto"  },
          { label: "Conta SMTP",    value: conn?.name ?? "—",             sub: conn?.from_email ?? "" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="p-4 rounded-xl text-center"
            style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <p className="text-xs text-agro-muted-2 uppercase tracking-widest mb-1">{label}</p>
            <p className="text-xl font-bold text-agro-green font-display">{value}</p>
            <p className="text-[11px] text-agro-muted mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Details */}
      <div className="space-y-3 text-sm">
        <div className="flex gap-3 p-3 rounded-xl" style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.08)" }}>
          <span className="text-agro-muted-2 shrink-0 w-24">Assunto:</span>
          <span className="text-agro-text">{state.subject}</span>
        </div>
        {ccParsed.length > 0 && (
          <div className="flex gap-3 p-3 rounded-xl" style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.08)" }}>
            <span className="text-agro-muted-2 shrink-0 w-24">CC fixo:</span>
            <span className="text-agro-text">{ccParsed.join(", ")}</span>
          </div>
        )}
        {state.ccRepresentante && (
          <div className="flex gap-3 p-3 rounded-xl" style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.08)" }}>
            <span className="text-agro-muted-2 shrink-0 w-24">CC auto:</span>
            <span className="text-agro-text">email_representante de cada contato</span>
          </div>
        )}
        {state.ccGerentes && (
          <div className="flex gap-3 p-3 rounded-xl" style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.08)" }}>
            <span className="text-agro-muted-2 shrink-0 w-24">CC gerentes:</span>
            <span className="text-agro-text">gerente1_email e gerente2_email de cada contato</span>
          </div>
        )}
      </div>

      {/* Email preview */}
      <div>
        <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-2">Preview do email</p>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
          <div className="px-4 py-3 text-xs text-agro-muted" style={{ background: "rgba(13,26,17,0.8)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
            <p><span className="text-agro-muted-2">De: </span>{conn ? `${conn.from_name} <${conn.from_email}>` : "—"}</p>
            <p className="mt-0.5"><span className="text-agro-muted-2">Assunto: </span>{interpolate(state.subject, previewContact)}</p>
          </div>
          <div className="p-4 bg-white/5 text-sm text-agro-text"
            dangerouslySetInnerHTML={{ __html: interpolate(state.bodyHtml, previewContact) }}
          />
        </div>
        {previewContact && (
          <p className="text-[11px] text-agro-muted-2 mt-1.5">Mostrando preview com dados de: {String(previewContact.name ?? previewContact.email)}</p>
        )}
      </div>

      {/* CTA */}
      <button
        onClick={onSubmit}
        disabled={submitting}
        className="btn-agro w-full flex items-center justify-center gap-3 py-3.5 rounded-xl text-base font-semibold text-white disabled:opacity-60"
      >
        <Mail className="w-5 h-5" />
        {submitting ? "Criando campanha…" : "Criar campanha (rascunho)"}
      </button>
      <p className="text-xs text-agro-muted-2 text-center -mt-3">
        A campanha será criada como rascunho. Clique em <strong className="text-agro-text">Iniciar</strong> na lista para começar o disparo.
      </p>
    </div>
  );
}
