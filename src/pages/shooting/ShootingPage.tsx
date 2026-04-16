import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw, Send, AlertTriangle, Zap } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { CampaignList } from "./components/CampaignList";
import { useCampaigns } from "@/hooks/useCampaign";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { useMetaTemplates } from "@/hooks/useMetaTemplates";
import { cn } from "@/lib/utils";

const WORKSPACE_ID = "demo-workspace-id";

export function ShootingPage() {
  const navigate = useNavigate();
  const { campaigns, loading, deleteCampaign, refetch } = useCampaigns(WORKSPACE_ID);
  const { connections } = useMetaConnections(WORKSPACE_ID);
  const { templates, syncing, syncTemplates } = useMetaTemplates(WORKSPACE_ID);

  const activeCampaigns  = campaigns.filter((c) => c.status === "sending" || c.status === "paused");
  const historyCampaigns = campaigns.filter((c) => c.status === "completed" || c.status === "cancelled" || c.status === "failed");
  const draftCampaigns   = campaigns.filter((c) => c.status === "draft" || c.status === "scheduled");

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
        <div className="flex items-start justify-between mb-8 animate-fade-up">
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
              Disparos em massa via API oficial do WhatsApp Business
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refetch}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-agro-muted hover:text-agro-text transition-all hover:bg-white/5"
              style={{ border: "1px solid rgba(63,176,108,0.12)" }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Atualizar
            </button>
            <button
              onClick={() => navigate("/shooting/new")}
              className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white"
            >
              <Plus className="w-4 h-4" />
              Nova Campanha
            </button>
          </div>
        </div>

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
        <TabsView tabs={tabs} loading={loading} onDelete={deleteCampaign} onNew={() => navigate("/shooting/new")} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Internal tabs component
// ─────────────────────────────────────────
import { useState } from "react";
import type { CampaignWithTemplate } from "@/types/shooting";

function TabsView({
  tabs,
  loading,
  onDelete,
  onNew,
}: {
  tabs: { id: string; label: string; count: number; data: CampaignWithTemplate[] }[];
  loading: boolean;
  onDelete: (id: string) => void;
  onNew: () => void;
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
        <CampaignList campaigns={current.data} loading={false} onDelete={onDelete} />
      )}
    </div>
  );
}
