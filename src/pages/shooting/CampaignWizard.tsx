import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Target, Users, MessageSquare, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Topbar } from "@/components/layout/Topbar";
import { StepScope } from "./components/StepScope";
import { StepRecipients } from "./components/StepRecipients";
import { StepMessage } from "./components/StepMessage";
import { StepConfirmation } from "./components/StepConfirmation";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { useMetaTemplates } from "@/hooks/useMetaTemplates";
import { useCampaigns } from "@/hooks/useCampaign";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { initialWizardState } from "@/types/shooting";
import type { WizardState, XlsxValidationResult } from "@/types/shooting";
import { cn } from "@/lib/utils";

// Demo workspace ID — replace with real auth context
const WORKSPACE_ID = "demo-workspace-id";

const STEPS = [
  { id: 1, label: "Escopo", subtitle: "Origem & configurações", icon: Target },
  { id: 2, label: "Destinatários", subtitle: "Quem vai receber", icon: Users },
  { id: 3, label: "Mensagem", subtitle: "Template & variáveis", icon: MessageSquare },
  { id: 4, label: "Confirmação", subtitle: "Revisar & disparar", icon: CheckCircle },
];

export function CampaignWizard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [state, setState] = useState<WizardState>(initialWizardState);
  const [xlsxResult, setXlsxResult] = useState<XlsxValidationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { connections } = useMetaConnections(WORKSPACE_ID);
  const { approvedTemplates } = useMetaTemplates(WORKSPACE_ID, state.connectionId || undefined);
  const { createCampaign } = useCampaigns(WORKSPACE_ID);

  function patch(p: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...p }));
  }

  const step = state.step;

  function canProceed(): boolean {
    if (step === 1) return !!state.dataSource && !!state.connectionId;
    if (step === 2) return state.totalRecipients > 0;
    if (step === 3) {
      if (!state.templateId) return false;
      const tpl = approvedTemplates.find((t) => t.id === state.templateId);
      if (!tpl) return false;
      // Check all body variables are mapped
      const bodyVars = (tpl.components.find((c) => c.type === "BODY")?.text?.match(/\{\{\d+\}\}/g) ?? []);
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
      const name =
        state.campaignName ||
        `Campanha ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

      const campaign = await createCampaign({
        workspace_id: WORKSPACE_ID,
        meta_connection_id: state.connectionId,
        name,
        template_id: state.templateId,
        data_source: state.dataSource!,
        column_mapping: state.columnMapping,
        filters: {},
        total_recipients: state.totalRecipients,
        status: state.scheduleMode === "later" ? "scheduled" : "draft",
        scheduled_at: state.scheduledAt?.toISOString() ?? null,
        started_at: null,
        completed_at: null,
        sending_speed: state.sendingSpeed,
        created_by: null,
        error_summary: {},
      });

      // If xlsx, upload the data to shooting_messages
      if (state.dataSource === "xlsx_upload" && xlsxResult) {
        const phoneCol = xlsxResult.phoneColumn ?? state.columnMapping.phone_column;
        const messages = xlsxResult.validRows.map((row) => ({
          campaign_id: campaign.id,
          workspace_id: WORKSPACE_ID,
          recipient_phone: String(row[phoneCol] ?? ""),
          recipient_name: String(row["nome"] ?? row["name"] ?? ""),
          recipient_data: row,
          status: "pending" as const,
          retry_count: 0,
          max_retries: 3,
        }));

        // Insert in batches of 500
        for (let i = 0; i < messages.length; i += 500) {
          await supabase.from("shooting_messages").insert(messages.slice(i, i + 500));
        }
      }

      // Start immediately if "now"
      if (state.scheduleMode === "now") {
        await supabase
          .from("shooting_campaigns")
          .update({ status: "sending", started_at: new Date().toISOString() })
          .eq("id", campaign.id);

        // Trigger edge function
        await supabase.functions.invoke("campaign-engine", {
          body: { action: "start", campaign_id: campaign.id },
        });
      }

      toast({
        title: state.scheduleMode === "now" ? "Disparo iniciado!" : "Campanha agendada!",
        description: `"${name}" foi ${state.scheduleMode === "now" ? "iniciada" : "agendada"} com sucesso.`,
        variant: "success",
      });

      navigate(`/shooting/campaigns/${campaign.id}`);
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao criar campanha",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const selectedTemplate = approvedTemplates.find((t) => t.id === state.templateId);
  const selectedConnection = connections.find((c) => c.id === state.connectionId);

  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar breadcrumbs={[{ label: "Shooting" }, { label: "Nova Campanha" }]} />

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Step progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center border-2 transition-all",
                      step > s.id
                        ? "bg-green-500 border-green-500 text-white"
                        : step === s.id
                        ? "border-green-500 bg-green-50 text-green-600"
                        : "border-gray-200 bg-white text-gray-300"
                    )}
                  >
                    <s.icon className="w-4.5 h-4.5" />
                  </div>
                  <div className="mt-2 text-center">
                    <p className={cn("text-xs font-semibold", step >= s.id ? "text-gray-900" : "text-gray-400")}>
                      {s.label}
                    </p>
                    <p className="text-[10px] text-gray-400 hidden sm:block">{s.subtitle}</p>
                  </div>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="flex-1 mx-3 mb-8">
                    <Progress value={step > s.id ? 100 : step === s.id ? 50 : 0} className="h-1" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step content card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          {/* Card header */}
          <div className="px-8 py-6 border-b border-gray-100">
            <div className="flex items-center gap-3">
              {(() => {
                const s = STEPS[step - 1];
                return (
                  <>
                    <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                      <s.icon className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">
                        {step === 1
                          ? "O que vamos enviar hoje?"
                          : step === 2
                          ? "Para quem vamos enviar?"
                          : step === 3
                          ? "Monte sua mensagem"
                          : "Revisão final antes do disparo"}
                      </h2>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {step === 1
                          ? "Defina a origem dos dados e o escopo da campanha"
                          : step === 2
                          ? "Selecione ou importe seus destinatários"
                          : step === 3
                          ? "Escolha o template e mapeie as variáveis"
                          : "Revise tudo antes de iniciar o disparo"}
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Step body */}
          <div className="px-8 py-6">
            {step === 1 && (
              <StepScope
                state={state}
                connections={connections}
                onChange={patch}
              />
            )}
            {step === 2 && (
              <StepRecipients
                state={state}
                xlsxResult={xlsxResult}
                onChange={patch}
                onXlsxResult={(result, _file) => setXlsxResult(result)}
                onXlsxClear={() => setXlsxResult(null)}
              />
            )}
            {step === 3 && (
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
                onSubmit={handleSubmit}
                submitting={submitting}
              />
            )}
          </div>

          {/* Navigation footer */}
          <div className="px-8 py-4 border-t border-gray-100 flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => {
                if (step === 1) navigate("/shooting");
                else patch({ step: (step - 1) as 1 | 2 | 3 | 4 });
              }}
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              {step === 1 ? "Cancelar" : "Voltar"}
            </Button>

            {step < 4 && (
              <Button
                disabled={!canProceed()}
                onClick={() => patch({ step: (step + 1) as 1 | 2 | 3 | 4 })}
              >
                Próximo
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
