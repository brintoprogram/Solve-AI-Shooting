import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw, Send, AlertTriangle, Zap, Mail, MessageSquare, Download, LayoutTemplate, XCircle, Check, Loader2, Pencil, Trash2, Smartphone } from "lucide-react";
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
import { useZApiTemplates } from "@/hooks/useZApiTemplates";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import type { ZApiTemplate, ZApiTemplateButton } from "@/types/database";
import type { MetaTemplate } from "@/types/shooting";

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
  const { templates: zApiTemplates, refetch: refetchZApiTemplates } = useZApiTemplates(WORKSPACE_ID);
  const [showZApiTplModal, setShowZApiTplModal] = useState(false);
  const [zApiTplEdit,      setZApiTplEdit]      = useState<ZApiTemplate | null>(null);

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
    { id: "active",    label: "Em andamento", count: activeCampaigns.length,  data: activeCampaigns  },
    { id: "draft",     label: "Rascunhos",     count: draftCampaigns.length,   data: draftCampaigns   },
    { id: "history",   label: "Histórico",     count: historyCampaigns.length, data: historyCampaigns },
    { id: "templates", label: "Templates",     count: 0,                       data: []               },
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

          <div className="flex items-center gap-2" id="shooting-header-actions">
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
        <TabsView
          tabs={tabs}
          loading={loading}
          onDelete={deleteCampaign}
          onNew={() => setShowBuilder(true)}
          onAction={handleCampaignAction}
          metaTemplates={templates}
          metaSyncing={syncing}
          onMetaSync={() => connections[0] && syncTemplates(connections[0])}
          zApiTemplates={zApiTemplates}
          onZApiTplCreate={() => { setZApiTplEdit(null); setShowZApiTplModal(true); }}
          onZApiTplEdit={(tpl) => { setZApiTplEdit(tpl); setShowZApiTplModal(true); }}
          onZApiTplDelete={async (id) => {
            await supabase.from("z_api_templates").delete().eq("id", id);
            refetchZApiTemplates();
            toast({ title: "Template removido" });
          }}
        />

        </> /* end WhatsApp tab */}
      </div>

      <CampaignBuilder
        open={showBuilder}
        onClose={() => setShowBuilder(false)}
        onCreated={refetch}
      />

      {showZApiTplModal && (
        <ZApiTemplateModal
          workspaceId={WORKSPACE_ID}
          editTemplate={zApiTplEdit}
          onClose={() => { setShowZApiTplModal(false); setZApiTplEdit(null); }}
          onSaved={() => { refetchZApiTemplates(); setShowZApiTplModal(false); setZApiTplEdit(null); }}
        />
      )}

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
  tabs, loading, onDelete, onNew, onAction,
  metaTemplates, metaSyncing, onMetaSync,
  zApiTemplates, onZApiTplCreate, onZApiTplEdit, onZApiTplDelete,
}: {
  tabs: { id: string; label: string; count: number; data: CampaignWithTemplate[] }[];
  loading: boolean;
  onDelete: (id: string) => void;
  onNew: () => void;
  onAction: (id: string, action: "start" | "pause" | "resume" | "cancel") => Promise<void>;
  metaTemplates: MetaTemplate[];
  metaSyncing: boolean;
  onMetaSync: () => void;
  zApiTemplates: ZApiTemplate[];
  onZApiTplCreate: () => void;
  onZApiTplEdit: (tpl: ZApiTemplate) => void;
  onZApiTplDelete: (id: string) => void;
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
      {active === "templates" ? (
        <TemplatesView
          metaTemplates={metaTemplates}
          metaSyncing={metaSyncing}
          onMetaSync={onMetaSync}
          zApiTemplates={zApiTemplates}
          onZApiTplCreate={onZApiTplCreate}
          onZApiTplEdit={onZApiTplEdit}
          onZApiTplDelete={onZApiTplDelete}
        />
      ) : loading ? (
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

// ─────────────────────────────────────────
// Templates view (Meta API + Z-API sub-tabs)
// ─────────────────────────────────────────

function TemplatesView({
  metaTemplates, metaSyncing, onMetaSync,
  zApiTemplates, onZApiTplCreate, onZApiTplEdit, onZApiTplDelete,
}: {
  metaTemplates: MetaTemplate[];
  metaSyncing: boolean;
  onMetaSync: () => void;
  zApiTemplates: ZApiTemplate[];
  onZApiTplCreate: () => void;
  onZApiTplEdit: (tpl: ZApiTemplate) => void;
  onZApiTplDelete: (id: string) => void;
}) {
  const [sub, setSub] = useState<"meta" | "zapi">("meta");

  const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    MARKETING:      { bg: "rgba(59,130,246,0.12)",  text: "#60a5fa", border: "rgba(59,130,246,0.25)" },
    UTILITY:        { bg: "rgba(63,176,108,0.12)",  text: "#3fb06c", border: "rgba(63,176,108,0.25)" },
    AUTHENTICATION: { bg: "rgba(245,158,11,0.12)",  text: "#fbbf24", border: "rgba(245,158,11,0.25)" },
  };
  const CATEGORY_LABEL: Record<string, string> = {
    MARKETING: "Marketing", UTILITY: "Utilitário", AUTHENTICATION: "Autenticação",
  };

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 p-1 rounded-xl w-fit"
        style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}
      >
        {([
          { id: "meta", label: "Meta API", color: "#60a5fa" },
          { id: "zapi", label: "Z-API",    color: "#a78bfa" },
        ] as const).map((s) => {
          const isActive = sub === s.id;
          return (
            <button key={s.id} onClick={() => setSub(s.id)}
              className={cn("py-1.5 px-4 rounded-lg text-xs font-semibold transition-all duration-200",
                isActive ? "text-white" : "text-agro-muted hover:text-agro-text")}
              style={isActive ? { background: `${s.color}22`, border: `1px solid ${s.color}55`, color: s.color } : undefined}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ── Meta API ── */}
      {sub === "meta" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-agro-muted">{metaTemplates.length} templates sincronizados</p>
            <button onClick={onMetaSync} disabled={metaSyncing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-agro-muted hover:text-agro-text transition-colors disabled:opacity-50"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}
            >
              <RefreshCw className={cn("w-3 h-3", metaSyncing && "animate-spin")} />
              {metaSyncing ? "Sincronizando…" : "Sincronizar"}
            </button>
          </div>
          {metaTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)" }}
              >
                <MessageSquare className="w-5 h-5 text-agro-muted-2" />
              </div>
              <p className="text-sm text-agro-muted">Nenhum template Meta sincronizado</p>
              <p className="text-xs text-agro-muted-2 mt-1">Clique em Sincronizar para buscar da API</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {metaTemplates.map((tpl) => {
                const cat = CATEGORY_COLORS[tpl.category] ?? CATEGORY_COLORS.UTILITY;
                const body = tpl.components.find((c) => c.type === "BODY")?.text ?? "";
                return (
                  <div key={tpl.id} className="p-3.5 rounded-xl"
                    style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-sm font-semibold text-agro-text">{tpl.template_name}</p>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0"
                        style={{ background: cat.bg, color: cat.text, border: `1px solid ${cat.border}` }}
                      >
                        {CATEGORY_LABEL[tpl.category] ?? tpl.category}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] text-agro-muted shrink-0"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        {tpl.language}
                      </span>
                    </div>
                    {body && <p className="text-xs text-agro-muted truncate">{body}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Z-API ── */}
      {sub === "zapi" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-agro-muted">{zApiTemplates.length} templates Z-API</p>
            <button onClick={onZApiTplCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{ color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.08)" }}
            >
              <Plus className="w-3 h-3" />
              Criar template
            </button>
          </div>
          {zApiTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.12)" }}
              >
                <Smartphone className="w-5 h-5 text-agro-muted-2" />
              </div>
              <p className="text-sm text-agro-muted">Nenhum template Z-API criado</p>
              <button onClick={onZApiTplCreate}
                className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors"
                style={{ color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.08)" }}
              >
                <Plus className="w-3.5 h-3.5" />
                Criar primeiro template
              </button>
            </div>
          ) : (
            <div className="grid gap-2">
              {zApiTemplates.map((tpl) => (
                <div key={tpl.id} className="flex items-start gap-3 p-3.5 rounded-xl"
                  style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(139,92,246,0.12)" }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)" }}
                  >
                    <LayoutTemplate className="w-4 h-4" style={{ color: "#a78bfa" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-agro-text truncate">{tpl.name}</p>
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)" }}
                      >
                        {tpl.message_type === "button_list" ? `Botões (${tpl.buttons.length})` : "Texto"}
                      </span>
                    </div>
                    <p className="text-xs text-agro-muted truncate">{tpl.body}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => onZApiTplEdit(tpl)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-green hover:bg-agro-green/10 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => onZApiTplDelete(tpl.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Z-API Template Modal
// ─────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-1.5">{children}</p>;
}

function ZApiTemplateModal({ workspaceId, editTemplate, onClose, onSaved }: {
  workspaceId:  string;
  editTemplate: ZApiTemplate | null;
  onClose:      () => void;
  onSaved:      () => void;
}) {
  const { toast } = useToast();
  const isEdit    = !!editTemplate;

  const [name,       setName]       = useState(editTemplate?.name        ?? "");
  const [msgType,    setMsgType]    = useState<"text" | "button_list">(editTemplate?.message_type ?? "text");
  const [headerText, setHeaderText] = useState(editTemplate?.header_text ?? "");
  const [body,       setBody]       = useState(editTemplate?.body        ?? "");
  const [footer,     setFooter]     = useState(editTemplate?.footer      ?? "");
  const [buttons,    setButtons]    = useState<ZApiTemplateButton[]>(
    editTemplate?.buttons?.length ? editTemplate.buttons : [{ id: "btn1", label: "" }],
  );
  const [saving,     setSaving]     = useState(false);

  function addButton() {
    if (buttons.length >= 3) return;
    setButtons((prev) => [...prev, { id: `btn${prev.length + 1}`, label: "" }]);
  }
  function removeButton(i: number) {
    setButtons((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateButtonLabel(i: number, label: string) {
    setButtons((prev) => prev.map((b, idx) => idx === i ? { ...b, label } : b));
  }
  function insertVar() {
    const matches = body.match(/\{\{(\d+)\}\}/g) ?? [];
    const indices = matches.map((m) => Number(m.replace(/\{\{|\}\}/g, "")));
    const nextIdx = indices.length > 0 ? String(Math.max(...indices) + 1) : "1";
    const ta = document.getElementById("ztpl-body") as HTMLTextAreaElement | null;
    if (ta) {
      const s = ta.selectionStart ?? body.length;
      const e = ta.selectionEnd   ?? body.length;
      setBody(body.slice(0, s) + `{{${nextIdx}}}` + body.slice(e));
    } else {
      setBody(body + `{{${nextIdx}}}`);
    }
  }

  async function handleSave() {
    if (!name.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const payload = {
        workspace_id: workspaceId,
        name:         name.trim(),
        message_type: msgType,
        header_text:  headerText.trim() || null,
        body:         body.trim(),
        footer:       footer.trim() || null,
        buttons:      msgType === "button_list"
          ? buttons.filter((b) => b.label.trim()).map((b, i) => ({ id: `btn${i + 1}`, label: b.label.trim() }))
          : [],
      };
      if (isEdit) {
        const { error } = await supabase.from("z_api_templates").update(payload).eq("id", editTemplate!.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("z_api_templates").insert(payload);
        if (error) throw error;
      }
      toast({ title: isEdit ? "Template atualizado!" : "Template criado!", variant: "success" });
      onSaved();
    } catch (err) {
      toast({ title: "Erro ao salvar", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const canSave = name.trim() && body.trim() &&
    (msgType !== "button_list" || buttons.some((b) => b.label.trim()));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-8"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl p-6 space-y-5 my-auto"
        style={{ background: "#0d1710", border: "1px solid rgba(139,92,246,0.25)", boxShadow: "0 32px 80px rgba(0,0,0,0.7)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.2)" }}
            >
              <LayoutTemplate className="w-4 h-4" style={{ color: "#a78bfa" }} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-agro-text">{isEdit ? "Editar" : "Criar"} Template Z-API</h2>
              <p className="text-[11px] text-agro-muted-2">Configure header, corpo, footer e botões</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div>
          <FieldLabel>Nome do template *</FieldLabel>
          <input className="input-agro w-full" placeholder="Ex: Cobrança Mensal, Boas-vindas…"
            value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <FieldLabel>Tipo de mensagem *</FieldLabel>
          <div className="grid grid-cols-2 gap-3">
            {([
              { value: "text",        label: "Texto simples",    sub: "Somente texto, sem botões"       },
              { value: "button_list", label: "Com botões",       sub: "Até 3 botões de resposta rápida" },
            ] as const).map((opt) => {
              const sel = msgType === opt.value;
              return (
                <div key={opt.value} onClick={() => setMsgType(opt.value)}
                  className="p-3 rounded-xl cursor-pointer transition-all duration-200"
                  style={sel
                    ? { background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.35)" }
                    : { background: "rgba(26,46,34,0.4)",   border: "1px solid rgba(63,176,108,0.1)"  }}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="w-3 h-3 rounded-full flex items-center justify-center shrink-0"
                      style={{ border: sel ? "none" : "2px solid rgba(139,92,246,0.4)",
                        background: sel ? "linear-gradient(135deg, #a78bfa, #7c3aed)" : "transparent" }}
                    >
                      {sel && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <p className="text-xs font-semibold text-agro-text">{opt.label}</p>
                  </div>
                  <p className="text-[10px] text-agro-muted ml-5">{opt.sub}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel>Header <span className="font-normal text-agro-muted-2 normal-case">(opcional)</span></FieldLabel>
          <input className="input-agro w-full" placeholder="Ex: Aviso importante…"
            value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={60} />
          <p className="text-[10px] text-agro-muted mt-1">{headerText.length}/60</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <FieldLabel>Corpo da mensagem *</FieldLabel>
            <button type="button" onClick={insertVar}
              className="text-[11px] font-semibold px-2 py-0.5 rounded-md text-agro-green hover:bg-agro-green/10 transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.25)" }}
            >
              + Inserir variável
            </button>
          </div>
          <textarea id="ztpl-body" className="input-agro w-full resize-none" rows={5}
            placeholder={"Olá {{1}}, sua fatura de {{2}} vence em {{3}}."}
            value={body} onChange={(e) => setBody(e.target.value)}
          />
          <p className="text-[10px] text-agro-muted mt-1">
            Use <span className="font-mono text-amber-400">{"{{1}}, {{2}}, ..."}</span> — mapeadas no wizard de campanha
          </p>
        </div>

        <div>
          <FieldLabel>Footer <span className="font-normal text-agro-muted-2 normal-case">(opcional)</span></FieldLabel>
          <input className="input-agro w-full" placeholder="Ex: Ignore se já pagou"
            value={footer} onChange={(e) => setFooter(e.target.value)} />
        </div>

        {msgType === "button_list" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <FieldLabel>Botões de resposta *</FieldLabel>
              {buttons.length < 3 && (
                <button type="button" onClick={addButton}
                  className="flex items-center gap-1 text-[11px] font-semibold text-agro-green hover:text-white px-2 py-0.5 rounded-md hover:bg-agro-green/15 transition-colors"
                  style={{ border: "1px solid rgba(63,176,108,0.25)" }}
                >
                  <Plus className="w-3 h-3" /> Adicionar
                </button>
              )}
            </div>
            <div className="space-y-2">
              {buttons.map((btn, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-agro-muted-2 shrink-0 w-4">{i + 1}.</span>
                  <input className="input-agro flex-1 text-sm" placeholder={`Texto do botão ${i + 1}`}
                    value={btn.label} onChange={(e) => updateButtonLabel(i, e.target.value)} maxLength={20} />
                  {buttons.length > 1 && (
                    <button type="button" onClick={() => removeButton(i)}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-agro-muted-2 hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-agro-muted mt-1.5">Máx. 3 botões · até 20 chars cada</p>
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
            style={{ border: "1px solid rgba(63,176,108,0.15)" }}
          >
            Cancelar
          </button>
          <button onClick={handleSave} disabled={!canSave || saving}
            className="flex-1 btn-agro flex items-center justify-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? "Salvando…" : isEdit ? "Atualizar" : "Criar template"}
          </button>
        </div>
      </div>
    </div>
  );
}
