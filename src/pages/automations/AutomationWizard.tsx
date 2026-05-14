import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Target, Zap, Users, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { StepIdentity } from "./components/StepIdentity";
import { StepTriggers } from "./components/StepTriggers";
import { StepRecipients } from "./components/StepRecipients";
import { StepReview } from "./components/StepReview";
import { useZApiConnections } from "@/hooks/useZApiConnections";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { useZApiTemplates } from "@/hooks/useZApiTemplates";
import { useMetaTemplates } from "@/hooks/useMetaTemplates";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AutomationWizardState, TriggerDraft } from "@/types/automations";

const STEPS = [
  { id: 1, label: "Identidade",    subtitle: "Canal & configuração", icon: Target      },
  { id: 2, label: "Gatilhos",      subtitle: "Cadência de envios",   icon: Zap         },
  { id: 3, label: "Destinatários", subtitle: "Selecionar contatos",  icon: Users       },
  { id: 4, label: "Revisão",       subtitle: "Confirmar & ativar",   icon: CheckCircle },
];

const INITIAL_TRIGGER: TriggerDraft = {
  key:                 crypto.randomUUID(),
  day_offset:          -1,
  label:               "1 dia antes",
  channel:             null,
  z_api_connection_id: null,
  z_api_template_id:   null,
  meta_connection_id:  null,
  meta_template_id:    null,
  column_mapping:      {},
  message_body:        "",
  enabled:             true,
};

const INITIAL_STATE: AutomationWizardState = {
  step:               1,
  name:               "",
  channel:            "z_api",
  z_api_connection_id: "",
  meta_connection_id:  "",
  send_hour:          9,
  template_mode:      "per_trigger",
  unified_message:    "",
  triggers:           [{ ...INITIAL_TRIGGER }],
  selectedRecipients: [],
};

export function AutomationWizard() {
  const navigate      = useNavigate();
  const { toast }     = useToast();
  const { workspaceId } = useAuth();
  const wsId          = workspaceId ?? "";

  const [state,   setState]   = useState<AutomationWizardState>(INITIAL_STATE);
  const [saving,  setSaving]  = useState(false);

  const { connections: zApiConnections } = useZApiConnections(wsId);
  const { connections: metaConnections } = useMetaConnections(wsId);
  const { templates: zApiTemplates }     = useZApiTemplates(wsId);
  const { approvedTemplates: metaTemplates } = useMetaTemplates(wsId);

  function patch(p: Partial<AutomationWizardState>) {
    setState((prev) => ({ ...prev, ...p }));
  }

  const step = state.step;

  function canProceed(): boolean {
    if (step === 1) {
      if (!state.name.trim()) return false;
      if (state.channel === "z_api" && !state.z_api_connection_id) return false;
      if (state.channel === "meta"  && !state.meta_connection_id)  return false;
      if (state.template_mode === "unified" && !state.unified_message.trim()) return false;
      return true;
    }
    if (step === 2) return state.triggers.some((t) => t.enabled);
    if (step === 3) return state.selectedRecipients.length > 0;
    return true;
  }

  async function save(targetStatus: "draft" | "active") {
    setSaving(true);
    try {
      const { data: rule, error: ruleErr } = await supabase
        .from("automation_rules")
        .insert({
          workspace_id:        wsId,
          name:                state.name.trim(),
          status:              targetStatus,
          send_hour:           state.send_hour,
          channel:             state.channel,
          z_api_connection_id: state.z_api_connection_id || null,
          meta_connection_id:  state.meta_connection_id  || null,
          template_mode:       state.template_mode,
          unified_message:     state.template_mode === "unified" ? state.unified_message : null,
          total_recipients:    state.selectedRecipients.length,
        })
        .select("id")
        .single();

      if (ruleErr || !rule) throw ruleErr ?? new Error("Falha ao criar régua");

      const ruleId = rule.id;

      // Insert triggers
      const triggersPayload = state.triggers.map((t) => ({
        rule_id:             ruleId,
        workspace_id:        wsId,
        day_offset:          t.day_offset,
        label:               t.label,
        channel:             t.channel,
        z_api_connection_id: t.z_api_connection_id,
        z_api_template_id:   t.z_api_template_id,
        meta_connection_id:  t.meta_connection_id,
        meta_template_id:    t.meta_template_id,
        column_mapping:      t.column_mapping,
        message_body:        t.message_body || null,
        enabled:             t.enabled,
      }));

      const { error: trigErr } = await supabase
        .from("automation_triggers")
        .insert(triggersPayload);

      if (trigErr) throw trigErr;

      // Insert recipients in batches of 500
      const recipientsPayload = state.selectedRecipients.map((r) => ({
        rule_id:       ruleId,
        workspace_id:  wsId,
        contact_id:    r.contact_id,
        invoice_id:    r.invoice_id,
        contact_name:  r.contact_name,
        contact_phone: r.contact_phone,
        vencimento:    r.vencimento,
        valor:         r.valor,
        numero_nf:     r.numero_nf,
        codigo_barras: r.codigo_barras,
      }));

      for (let i = 0; i < recipientsPayload.length; i += 500) {
        const { error: recErr } = await supabase
          .from("automation_recipients")
          .insert(recipientsPayload.slice(i, i + 500));
        if (recErr) throw recErr;
      }

      toast({
        title:   targetStatus === "active" ? "Régua ativada!" : "Rascunho salvo",
        description: targetStatus === "active"
          ? "Os disparos serão feitos automaticamente no horário configurado."
          : "A régua foi salva como rascunho.",
        variant: "success",
      });

      navigate(`/automations/${ruleId}`);
    } catch (err) {
      toast({
        title:       "Erro ao salvar",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant:     "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const stepTitles = [
    "Configure a régua",
    "Defina os gatilhos",
    "Selecione os destinatários",
    "Revise antes de ativar",
  ];
  const stepSubs = [
    "Nome, canal, conexão e horário de disparo",
    "Quando enviar em relação ao vencimento do boleto",
    "Contatos com boletos pendentes que entrarão na régua",
    "Confira todas as configurações e ative a cobrança",
  ];

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Automações", href: "/automations" }, { label: "Nova Régua" }]} />

      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* Stepper */}
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
                      <div
                        className={cn(
                          "relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-500",
                          isDone   && "glow-green-sm",
                          isActive && "glow-green",
                        )}
                        style={{
                          background: isDone
                            ? "linear-gradient(135deg, #3fb06c, #16A34A)"
                            : isActive
                            ? "linear-gradient(135deg, rgba(63,176,108,0.2), rgba(22,163,74,0.1))"
                            : "rgba(26,46,34,0.6)",
                          border: isDone
                            ? "none"
                            : isActive
                            ? "2px solid #3fb06c"
                            : "2px solid rgba(63,176,108,0.15)",
                          opacity: isFuture ? 0.4 : 1,
                        }}
                      >
                        <s.icon className={cn(
                          "w-4.5 h-4.5 transition-all duration-300",
                          isDone   ? "text-white"         : "",
                          isActive ? "text-agro-green"    : "",
                          isFuture ? "text-agro-muted-2"  : "",
                        )} />
                      </div>
                    </div>

                    <div className={cn("mt-2.5 text-center transition-all duration-300", isFuture && "opacity-40")}>
                      <p className={cn("text-xs font-semibold leading-none",
                        isDone || isActive ? "text-agro-text" : "text-agro-muted-2")}>
                        {s.label}
                      </p>
                      <p className={cn("text-[10px] mt-0.5",
                        isActive ? "text-agro-green" : "text-agro-muted-2")}>
                        {s.subtitle}
                      </p>
                    </div>
                  </div>

                  {i < STEPS.length - 1 && (
                    <div className="flex-1 mx-3 mb-7 relative h-0.5 rounded-full overflow-hidden"
                      style={{ background: "rgba(63,176,108,0.12)" }}>
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

        {/* Card */}
        <div className="animate-fade-up-delay-1 rounded-3xl overflow-hidden"
          style={{
            background:    "rgba(13,26,17,0.8)",
            backdropFilter:"blur(20px)",
            border:        "1px solid rgba(63,176,108,0.12)",
            boxShadow:     "0 32px 80px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.45), inset 0 0 80px rgba(63,176,108,0.02)",
          }}
        >
          {/* Card header */}
          <div className="px-8 py-8 relative" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
            <div className="absolute top-0 left-8 right-8 h-px"
              style={{ background: "linear-gradient(90deg, transparent, rgba(63,176,108,0.4), transparent)" }}
            />
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}>
                {(() => { const S = STEPS[step - 1]; return <S.icon className="w-5 h-5 text-agro-green" />; })()}
              </div>
              <div>
                <h2 className="font-display text-xl font-semibold text-agro-text">{stepTitles[step - 1]}</h2>
                <p className="text-sm text-agro-muted mt-0.5">{stepSubs[step - 1]}</p>
              </div>
              <div className="ml-auto shrink-0 px-3 py-1 rounded-full text-xs font-semibold"
                style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)", color: "#3fb06c" }}>
                {step} / {STEPS.length}
              </div>
            </div>
          </div>

          {/* Step body */}
          <div className="px-8 py-8">
            <div key={step} className="animate-scale-in">
              {step === 1 && (
                <StepIdentity
                  state={state}
                  zApiConnections={zApiConnections}
                  metaConnections={metaConnections}
                  onChange={patch}
                />
              )}
              {step === 2 && (
                <StepTriggers
                  state={state}
                  zApiConnections={zApiConnections}
                  metaConnections={metaConnections}
                  zApiTemplates={zApiTemplates}
                  metaTemplates={metaTemplates}
                  onChange={patch}
                />
              )}
              {step === 3 && (
                <StepRecipients state={state} onChange={patch} />
              )}
              {step === 4 && (
                <StepReview
                  state={state}
                  zApiConnections={zApiConnections}
                  metaConnections={metaConnections}
                  saving={saving}
                  onSaveDraft={() => save("draft")}
                  onActivate={() => save("active")}
                />
              )}
            </div>
          </div>

          {/* Navigation footer */}
          <div className="px-8 py-5 flex items-center justify-between"
            style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
            <button
              onClick={() => {
                if (step === 1) navigate("/automations");
                else patch({ step: (step - 1) as 1 | 2 | 3 | 4 });
              }}
              className="flex items-center gap-2 text-sm text-agro-muted hover:text-agro-text transition-colors duration-200 px-5 py-2.5 rounded-xl hover:bg-white/5"
            >
              <ChevronLeft className="w-4 h-4" />
              {step === 1 ? "Cancelar" : "Voltar"}
            </button>

            {step < 4 && (
              <button
                disabled={!canProceed()}
                onClick={() => patch({ step: (step + 1) as 1 | 2 | 3 | 4 })}
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
