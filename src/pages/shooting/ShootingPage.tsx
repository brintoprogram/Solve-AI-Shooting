import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw, Send, AlertTriangle, Zap, Mail, MessageSquare, Download } from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { Topbar } from "@/components/layout/Topbar";
import { CampaignList } from "./components/CampaignList";
import { CampaignBuilder } from "./CampaignBuilder";
import { EmailCampaignList } from "@/pages/email/EmailCampaignList";
import { EmailCampaignWizard } from "@/pages/email/EmailCampaignWizard";
import { useCampaigns } from "@/hooks/useCampaign";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { useMetaTemplates } from "@/hooks/useMetaTemplates";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

export function ShootingPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { workspaceId } = useAuth();
  const WORKSPACE_ID = workspaceId ?? "";
  const [channel, setChannel]         = useState<"whatsapp" | "email">("whatsapp");
  const [showBuilder, setShowBuilder] = useState(false);
  const [showEmailWizard, setShowEmailWizard] = useState(false);
  const [emailListKey, setEmailListKey]       = useState(0);
  const { campaigns, loading, deleteCampaign, refetch } = useCampaigns(WORKSPACE_ID);
  const { connections } = useMetaConnections(WORKSPACE_ID);
  const { templates, syncing, syncTemplates } = useMetaTemplates(WORKSPACE_ID);

  const activeCampaigns  = campaigns.filter((c) => c.status === "sending" || c.status === "paused");
  const historyCampaigns = campaigns.filter((c) => c.status === "completed" || c.status === "cancelled" || c.status === "failed");
  const draftCampaigns   = campaigns.filter((c) => c.status === "draft" || c.status === "scheduled");

  const STATUS_PT: Record<string, string> = {
    draft: "Rascunho", scheduled: "Agendado", sending: "Enviando",
    paused: "Pausado", completed: "Concluído", cancelled: "Cancelado", failed: "Falhou",
  };

  function exportCampaignsXlsx() {
    const rows = campaigns.map((c) => {
      const sent = c.sent_count ?? 0;
      const delivered = c.delivered_count ?? 0;
      return {
        "Nome":                c.name,
        "Template":            c.meta_templates?.template_name ?? "",
        "Status":              STATUS_PT[c.status] ?? c.status,
        "Destinatários":       c.total_recipients,
        "Enviadas":            sent,
        "Entregues":           delivered,
        "Lidas":               c.read_count ?? 0,
        "Respondidas":         c.replied_count ?? 0,
        "Falhas":              c.failed_count ?? 0,
        "Taxa de entrega (%)": sent > 0 ? Math.round((delivered / sent) * 100) : 0,
        "Criada em":           format(new Date(c.created_at), "dd/MM/yyyy"),
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Campanhas");
    XLSX.writeFile(wb, `campanhas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function handleCampaignAction(id: string, action: "start" | "pause" | "resume" | "cancel") {
    const LABELS = { start: "Iniciando", pause: "Pausando", resume: "Retomando", cancel: "Cancelando" };
    try {
      const { error } = await supabase.functions.invoke("campaign-engine", {
        body: { action, campaign_id: id },
      });
      if (error) {
        let msg = error.message;
        try { const b = await (error as unknown as { context: Response }).context?.json?.(); msg = b?.error ?? msg; } catch { /* ignore */ }
        toast({ title: `Erro ao ${action}`, description: msg, variant: "destructive" });
        return;
      }
      const OK = { start: "Campanha iniciada!", pause: "Campanha pausada.", resume: "Campanha retomada!", cancel: "Campanha cancelada." };
      toast({ title: OK[action], variant: "success" });
      refetch();
    } catch (err) {
      toast({ title: `Erro: ${LABELS[action]}`, description: String(err), variant: "destructive" });
    }
  }

  const tabs = [
    { id: "active",  label: "Em andamento", count: activeCampaigns.length,  data: activeCampaigns  },
    { id: "draft",   label: "Rascunhos",     count: draftCampaigns.length,   data: draftCampaigns   },
    { id: "history", label: "Histórico",     count: historyCampaigns.length, data: historyCampaigns },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Shooting" }]} />

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* ── Page header ───────────────────────── */}
        <div className="flex items-start justify-between mb-6 animate-fade-up">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center glow-green-sm"
                style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
              >
                <Send className="w-4 h-4 text-white" />
              </div>
              <h1 className="font-display text-2xl font-bold text-agro-text">Solve AI Shooting</h1>
            </div>
            <p className="text-sm text-agro-muted ml-12">
              Disparos em massa via WhatsApp e Email
            </p>
          </div>

          <div className="flex items-center gap-2">
            {channel === "whatsapp" ? (
              <>
                <button
                  onClick={exportCampaignsXlsx}
                  disabled={campaigns.length === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-agro-muted hover:text-agro-text transition-all hover:bg-white/5 disabled:opacity-40"
                  style={{ border: "1px solid rgba(63,176,108,0.12)" }}
                >
                  <Download className="w-3.5 h-3.5" />
                  Exportar XLSX
                </button>
                <button
                  onClick={refetch}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-agro-muted hover:text-agro-text transition-all hover:bg-white/5"
                  style={{ border: "1px solid rgba(63,176,108,0.12)" }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Atualizar
                </button>
                <button
                  onClick={() => setShowBuilder(true)}
                  className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white"
                >
                  <Plus className="w-4 h-4" />
                  Nova Campanha
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowEmailWizard(true)}
                className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white"
              >
                <Plus className="w-4 h-4" />
                Nova Campanha de Email
              </button>
            )}
          </div>
        </div>

        {/* ── Channel tabs ─────────────────────── */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit animate-fade-up"
          style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
          {([
            { id: "whatsapp", label: "WhatsApp", icon: MessageSquare },
            { id: "email",    label: "Email",     icon: Mail          },
          ] as const).map((ch) => {
            const isActive = channel === ch.id;
            return (
              <button key={ch.id} onClick={() => setChannel(ch.id)}
                className={cn(
                  "flex items-center gap-2 py-2 px-5 rounded-lg text-sm font-medium transition-all duration-200",
                  isActive ? "text-white" : "text-agro-muted hover:text-agro-text",
                )}
                style={isActive ? {
                  background: "linear-gradient(135deg, rgba(63,176,108,0.2), rgba(22,163,74,0.1))",
                  border: "1px solid rgba(63,176,108,0.3)",
                } : undefined}
              >
                <ch.icon className="w-4 h-4" />
                {ch.label}
              </button>
            );
          })}
        </div>

        {/* ── Email tab ────────────────────────── */}
        {channel === "email" && (
          <EmailCampaignList key={emailListKey} onNew={() => setShowEmailWizard(true)} />
        )}

        {/* ── WhatsApp tab ──────────────────────── */}
        {channel === "whatsapp" && <>

        {/* ── Connection status bar ─────────────── */}
        {connections.length > 0 && (
          <div className="flex items-center gap-4 mb-6 p-4 rounded-xl animate-fade-up-delay-1"
            style={{
              background: "rgba(13,26,17,0.7)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(63,176,108,0.12)",
            }}
          >
            {connections.map((conn) => {
              const qColor: Record<string, string> = { GREEN: "text-agro-green", YELLOW: "text-amber-400", RED: "text-red-400" };
              return (
                <div key={conn.id} className="flex items-center gap-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    conn.status === "active" ? "bg-agro-green glow-green-sm" : "bg-red-400",
                  )} />
                  <span className="text-sm font-semibold text-agro-text">{conn.display_phone}</span>
                  {conn.business_name && (
                    <span className="text-xs text-agro-muted">· {conn.business_name}</span>
                  )}
                  {conn.quality_rating && (
                    <span className={cn("text-xs font-medium", qColor[conn.quality_rating] ?? "text-agro-muted")}>
                      ● {conn.quality_rating}
                    </span>
                  )}
                  {conn.messaging_limit && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium text-agro-muted"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      {conn.messaging_limit}
                    </span>
                  )}
                </div>
              );
            })}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-agro-muted">{templates.length} templates</span>
              <button
                disabled={syncing || connections.length === 0}
                onClick={() => syncTemplates(connections[0])}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-agro-muted hover:text-agro-text transition-colors disabled:opacity-50"
                style={{ border: "1px solid rgba(63,176,108,0.15)" }}
              >
                <RefreshCw className={cn("w-3 h-3", syncing && "animate-spin")} />
                {syncing ? "Sincronizando..." : "Sincronizar templates"}
              </button>
            </div>
          </div>
        )}

        {/* ── No connection warning ─────────────── */}
        {connections.length === 0 && !loading && (
          <div className="flex items-center justify-between mb-6 p-4 rounded-xl"
            style={{
              background: "rgba(245,158,11,0.06)",
              border: "1px solid rgba(245,158,11,0.2)",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(245,158,11,0.12)" }}
              >
                <AlertTriangle className="w-4.5 h-4.5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-400">Nenhuma conexão WhatsApp configurada</p>
                <p className="text-xs text-agro-muted mt-0.5">
                  Configure sua conta Meta Business em Configurações → Integrações
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate("/settings")}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-400/10"
              style={{ border: "1px solid rgba(245,158,11,0.3)" }}
            >
              Configurar
            </button>
          </div>
        )}

        {/* ── Tabs ─────────────────────────────── */}
        <TabsView tabs={tabs} loading={loading} onDelete={deleteCampaign} onNew={() => setShowBuilder(true)} onAction={handleCampaignAction} />

        </> /* end WhatsApp tab */}
      </div>

      <CampaignBuilder
        open={showBuilder}
        onClose={() => setShowBuilder(false)}
        onCreated={refetch}
      />

      {/* ── Email Wizard (full-screen overlay) ── */}
      {showEmailWizard && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: "#0a110e" }}>
          <div className="sticky top-0 z-10 flex items-center px-6 py-4"
            style={{ background: "rgba(10,17,14,0.9)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(63,176,108,0.1)" }}
          >
            <button onClick={() => setShowEmailWizard(false)}
              className="flex items-center gap-2 text-sm text-agro-muted hover:text-agro-text transition-colors"
            >
              ← Voltar para Disparos
            </button>
            <span className="mx-3 text-agro-border">|</span>
            <span className="text-sm font-semibold text-agro-text">Nova Campanha de Email</span>
          </div>
          <EmailCampaignWizard
            onClose={() => setShowEmailWizard(false)}
            onCreated={() => { setEmailListKey((k) => k + 1); setChannel("email"); }}
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Internal tabs component
// ─────────────────────────────────────────
import type { CampaignWithTemplate } from "@/types/shooting";

function TabsView({
  tabs,
  loading,
  onDelete,
  onNew,
  onAction,
}: {
  tabs: { id: string; label: string; count: number; data: CampaignWithTemplate[] }[];
  loading: boolean;
  onDelete: (id: string) => void;
  onNew: () => void;
  onAction: (id: string, action: "start" | "pause" | "resume" | "cancel") => Promise<void>;
}) {
  const [active, setActive] = useState("active");
  const current = tabs.find((t) => t.id === active)!;

  return (
    <div className="animate-fade-up-delay-1">
      {/* Tab bar */}
      <div className="flex gap-1 mb-5 p-1 rounded-xl"
        style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200",
                isActive ? "text-white" : "text-agro-muted hover:text-agro-text",
              )}
              style={isActive ? {
                background: "linear-gradient(135deg, rgba(63,176,108,0.2), rgba(22,163,74,0.1))",
                border: "1px solid rgba(63,176,108,0.3)",
              } : undefined}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={isActive ? {
                    background: "#3fb06c",
                    color: "#fff",
                  } : {
                    background: "rgba(63,176,108,0.15)",
                    color: "#3fb06c",
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl animate-pulse"
              style={{ background: "rgba(63,176,108,0.05)" }}
            />
          ))}
        </div>
      ) : current.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <Zap className="w-7 h-7 text-agro-muted-2" />
          </div>
          <p className="text-agro-muted font-medium">Nenhum disparo em {current.label.toLowerCase()}</p>
          <p className="text-sm text-agro-muted-2 mt-1">Crie uma nova campanha para começar</p>
          {current.id === "active" && (
            <button
              onClick={onNew}
              className="btn-agro mt-5 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            >
              <Plus className="w-4 h-4" />
              Nova Campanha
            </button>
          )}
        </div>
      ) : (
        <CampaignList campaigns={current.data} loading={false} onDelete={onDelete} onAction={onAction} />
      )}
    </div>
  );
}
