import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Target, Users, MessageSquare, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { StepScope } from "./components/StepScope";
import { StepRecipients } from "./components/StepRecipients";
import { StepMessage } from "./components/StepMessage";
import { StepZApiMessage } from "./components/StepZApiMessage";
import { StepConfirmation } from "./components/StepConfirmation";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { useZApiConnections } from "@/hooks/useZApiConnections";
import { useMetaTemplates } from "@/hooks/useMetaTemplates";
import { useZApiTemplates } from "@/hooks/useZApiTemplates";
import { useCampaigns } from "@/hooks/useCampaign";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { initialWizardState } from "@/types/shooting";
import type { WizardState, XlsxValidationResult } from "@/types/shooting";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

const STEPS = [
  { id: 1, label: "Escopo",       subtitle: "Origem & configs",   icon: Target       },
  { id: 2, label: "Destinatários",subtitle: "Quem vai receber",   icon: Users        },
  { id: 3, label: "Mensagem",     subtitle: "Template & vars",    icon: MessageSquare},
  { id: 4, label: "Confirmação",  subtitle: "Revisar & disparar", icon: CheckCircle  },
];

export function CampaignWizard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { workspaceId } = useAuth();
  const WORKSPACE_ID = workspaceId ?? "";
  const [state, setState]         = useState<WizardState>(initialWizardState);
  const [xlsxResult, setXlsxResult] = useState<XlsxValidationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { connections } = useMetaConnections(WORKSPACE_ID);
  const { connections: zApiConnections } = useZApiConnections(WORKSPACE_ID);
  const { approvedTemplates } = useMetaTemplates(WORKSPACE_ID, state.channel === "meta" ? state.connectionId || undefined : undefined);
  const { templates: zApiTemplates } = useZApiTemplates(WORKSPACE_ID);
  const { createCampaign } = useCampaigns(WORKSPACE_ID);

  function patch(p: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...p }));
  }

  const step = state.step;

  function canProceed(): boolean {
    if (step === 1) {
      if (!state.dataSource) return false;
      if (!state.connectionId) return false;
      return true;
    }
    if (step === 2) return state.totalRecipients > 0;
    if (step === 3) {
      if (state.channel === "z_api") {
        if (!state.messageBody.trim()) return false;
        if (!state.columnMapping.phone_column) return false;
        const varIndices = [...new Set((state.messageBody.match(/\{\{(\d+)\}\}/g) ?? []).map((m) => m.replace(/\{\{|\}\}/g, "")))];
        return varIndices.every((i) => !!state.columnMapping.body_variables?.[i]);
      }
      // Meta
      if (!state.templateId) return false;
      const tpl = approvedTemplates.find((t) => t.id === state.templateId);
      if (!tpl) return false;
      const bodyVars = tpl.components.find((c) => c.type === "BODY")?.text?.match(/\{\{\d+\}\}/g) ?? [];
      return bodyVars.every((v) => {
        const idx = v.replace(/\{\{|\}\}/g, "");
        return !!state.columnMapping.body_variables?.[idx];
      });
    }
    return true;
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const name = state.campaignName ||
        `Campanha ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

      const isZApi = state.channel === "z_api";
      const campaign = await createCampaign({
        workspace_id:        WORKSPACE_ID,
        meta_connection_id:  isZApi ? null : state.connectionId,
        z_api_connection_id: isZApi ? state.connectionId : null,
        z_api_template_id:   isZApi ? (state.zApiTemplateId ?? null) : null,
        name,
        template_id:         isZApi ? null : state.templateId,
        message_body:        isZApi ? state.messageBody : null,
        dispatch_channel:    isZApi ? "z_api" : "whatsapp",
        data_source:         state.dataSource!,
        column_mapping:      state.columnMapping,
        filters:             {},
        total_recipients:    state.totalRecipients,
        status:              state.scheduleMode === "later" ? "scheduled" : "draft",
        scheduled_at:        state.scheduledAt?.toISOString() ?? null,
        started_at:          null,
        completed_at:        null,
        sending_speed:       state.sendingSpeed,
        sending_speed_mode:  isZApi ? state.sendingSpeedMode : "fixed",
        min_delay_seconds:   isZApi && state.sendingSpeedMode === "random" ? state.minDelaySeconds : null,
        max_delay_seconds:   isZApi && state.sendingSpeedMode === "random" ? state.maxDelaySeconds : null,
        created_by:          null,
        error_summary:       {},
      });

      if (state.dataSource === "contacts" && state.selectedContacts.length > 0) {
        const { data: contactRows } = await supabase
          .from("inbox_contacts")
          .select("id, name, phone")
          .in("id", state.selectedContacts);

        const messages = (contactRows ?? []).map((c: { id: string; name: string | null; phone: string | null }) => ({
          campaign_id:     campaign.id,
          workspace_id:    WORKSPACE_ID,
          recipient_phone: c.phone ?? "",
          recipient_name:  c.name ?? "",
          recipient_data:  {},
          status:          "pending" as const,
          retry_count:     0,
          max_retries:     3,
        }));

        for (let i = 0; i < messages.length; i += 500) {
          await supabase.from("shooting_messages").insert(messages.slice(i, i + 500));
        }
      }

      if (state.dataSource === "xlsx_upload" && xlsxResult) {
        const phoneCol = xlsxResult.phoneColumn ?? state.columnMapping.phone_column;
        const messages = xlsxResult.validRows.map((row) => ({
          campaign_id:    campaign.id,
          workspace_id:   WORKSPACE_ID,
          recipient_phone: String(row[phoneCol] ?? ""),
          recipient_name:  String(row["nome"] ?? row["name"] ?? ""),
          recipient_data:  row,
          status:          "pending" as const,
          retry_count:     0,
          max_retries:     3,
        }));
        for (let i = 0; i < messages.length; i += 500) {
          await supabase.from("shooting_messages").insert(messages.slice(i, i + 500));
        }
      }

      if (state.scheduleMode === "now") {
        await supabase
          .from("shooting_campaigns")
          .update({ status: "sending", started_at: new Date().toISOString() })
          .eq("id", campaign.id);
        await supabase.functions.invoke("campaign-engine", {
          body: { action: "start", campaign_id: campaign.id },
        });
      }

      toast({ title: state.scheduleMode === "now" ? "Disparo iniciado!" : "Campanha agendada!", variant: "success" });
      navigate(`/shooting/campaigns/${campaign.id}`);
    } catch (err) {
      toast({ title: "Erro ao criar campanha", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const selectedTemplate       = approvedTemplates.find((t) => t.id === state.templateId);
  const selectedConnection     = connections.find((c) => c.id === state.connectionId);
  const selectedZApiConnection = zApiConnections.find((c) => c.id === state.connectionId);
  const selectedZApiTemplate   = state.zApiTemplateId ? zApiTemplates.find((t) => t.id === state.zApiTemplateId) : undefined;

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Shooting" }, { label: "Nova Campanha" }]} />

      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* ── Premium Stepper ────────────────────────────── */}
        <div className="mb-10 animate-fade-up">
          <div className="flex items-center">
            {STEPS.map((s, i) => {
              const isDone   = step > s.id;
              const isActive = step === s.id;
              const isFuture = step < s.id;

              return (
                <div key={s.id} className="flex items-center flex-1">
                  {/* Step node */}
                  <div className="flex flex-col items-center">
                    {/* Icon + glow in a tight wrapper so absolute coords are icon-relative */}
                    <div className="relative">
                      {isActive && (
                        <div className="absolute -inset-2 rounded-full animate-glow-pulse"
                          style={{ background: "rgba(63,176,108,0.15)" }}
                        />
                      )}

                    <div className={cn(
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
                        isDone   ? "text-white"      : "",
                        isActive ? "text-agro-green" : "",
                        isFuture ? "text-agro-muted-2" : "",
                      )} />
                    </div>
                    </div>{/* end icon wrapper */}

                    <div className={cn("mt-2.5 text-center transition-all duration-300", isFuture && "opacity-40")}>
                      <p className={cn(
                        "text-xs font-semibold leading-none",
                        isDone || isActive ? "text-agro-text" : "text-agro-muted-2"
                      )}>
                        {s.label}
                      </p>
                      <p className={cn(
                        "text-[10px] mt-0.5",
                        isActive ? "text-agro-green" : "text-agro-muted-2"
                      )}>
                        {s.subtitle}
                      </p>
                    </div>
                  </div>

                  {/* Connector */}
                  {i < STEPS.length - 1 && (
                    <div className="flex-1 mx-3 mb-7 relative h-0.5 rounded-full overflow-hidden"
                      style={{ background: "rgba(63,176,108,0.12)" }}
                    >
                      {step > s.id && (
                        <div className="absolute inset-0 connector-fill" />
                      )}
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

        {/* ── Main card ─────────────────────────────────── */}
        <div className="animate-fade-up-delay-1 rounded-2xl overflow-hidden"
          style={{
            background: "rgba(13,26,17,0.8)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(63,176,108,0.12)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.4), inset 0 0 60px rgba(63,176,108,0.02)",
          }}
        >
          {/* Card header */}
          <div className="px-8 py-6 relative"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
          >
            {/* Top accent line */}
            <div className="absolute top-0 left-8 right-8 h-px"
              style={{ background: "linear-gradient(90deg, transparent, rgba(63,176,108,0.4), transparent)" }}
            />

            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{
                  background: "rgba(63,176,108,0.1)",
                  border: "1px solid rgba(63,176,108,0.2)",
                }}
              >
                {(() => { const S = STEPS[step - 1]; return <S.icon className="w-5 h-5 text-agro-green" />; })()}
              </div>
              <div>
                <h2 className="font-display text-xl font-semibold text-agro-text">
                  {step === 1 ? "O que vamos enviar hoje?"
                    : step === 2 ? "Para quem vamos enviar?"
                    : step === 3 ? "Monte sua mensagem"
                    : "Revisão final antes do disparo"}
                </h2>
                <p className="text-sm text-agro-muted mt-0.5">
                  {step === 1 ? "Defina a origem dos dados e o escopo da campanha"
                    : step === 2 ? "Selecione ou importe seus destinatários"
                    : step === 3 ? "Escolha o template e mapeie as variáveis"
                    : "Revise tudo antes de iniciar o disparo"}
                </p>
              </div>

              {/* Step badge */}
              <div className="ml-auto shrink-0 px-3 py-1 rounded-full text-xs font-semibold"
                style={{
                  background: "rgba(63,176,108,0.1)",
                  border: "1px solid rgba(63,176,108,0.2)",
                  color: "#3fb06c",
                }}
              >
                {step} / {STEPS.length}
              </div>
            </div>
          </div>

          {/* Step body */}
          <div className="px-8 py-8">
            <div key={step} className="animate-scale-in">
              {step === 1 && <StepScope state={state} connections={connections} zApiConnections={zApiConnections} onChange={patch} />}
              {step === 2 && (
                <StepRecipients
                  state={state}
                  xlsxResult={xlsxResult}
                  onChange={patch}
                  onXlsxResult={(result) => setXlsxResult(result)}
                  onXlsxClear={() => setXlsxResult(null)}
                />
              )}
              {step === 3 && state.channel === "z_api" && (
                <StepZApiMessage
                  state={state}
                  xlsxResult={xlsxResult}
                  templates={zApiTemplates}
                  onChange={patch}
                />
              )}
              {step === 3 && state.channel !== "z_api" && (
                <StepMessage
                  state={state}
                  templates={approvedTemplates}
                  xlsxResult={xlsxResult}
                  onChange={patch}
                />
              )}
              {step === 4 && (
                <StepConfirmation
                  state={state}
                  template={selectedTemplate}
                  connection={selectedConnection}
                  zApiConnection={selectedZApiConnection}
                  zApiTemplate={selectedZApiTemplate}
                  onSubmit={handleSubmit}
                  submitting={submitting}
                />
              )}
            </div>
          </div>

          {/* Navigation footer */}
          <div className="px-8 py-5 flex items-center justify-between"
            style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}
          >
            <button
              onClick={() => {
                if (step === 1) navigate("/shooting");
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
                  canProceed()
                    ? "btn-agro cursor-pointer"
                    : "opacity-30 cursor-not-allowed"
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
