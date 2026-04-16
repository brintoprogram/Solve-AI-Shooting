import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Topbar } from "@/components/layout/Topbar";
import { CampaignList } from "./components/CampaignList";
import { useCampaigns } from "@/hooks/useCampaign";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { useMetaTemplates } from "@/hooks/useMetaTemplates";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const WORKSPACE_ID = "demo-workspace-id";

export function ShootingPage() {
  const navigate = useNavigate();
  const { campaigns, loading, deleteCampaign, refetch } = useCampaigns(WORKSPACE_ID);
  const { connections } = useMetaConnections(WORKSPACE_ID);
  const { templates, syncing, syncTemplates } = useMetaTemplates(WORKSPACE_ID);

  const activeCampaigns = campaigns.filter(
    (c) => c.status === "sending" || c.status === "paused"
  );
  const historyCampaigns = campaigns.filter(
    (c) => c.status === "completed" || c.status === "cancelled" || c.status === "failed"
  );
  const draftCampaigns = campaigns.filter(
    (c) => c.status === "draft" || c.status === "scheduled"
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar breadcrumbs={[{ label: "Shooting" }]} />

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Page header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Solve AI Shooting</h1>
            <p className="text-gray-500 mt-1">
              Disparos em massa via API oficial do WhatsApp Business
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refetch}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Atualizar
            </Button>
            <Button
              onClick={() => navigate("/shooting/new")}
            >
              <Plus className="w-4 h-4 mr-2" />
              Nova Campanha
            </Button>
          </div>
        </div>

        {/* Connection status */}
        {connections.length > 0 && (
          <div className="flex items-center gap-3 mb-6 p-4 rounded-xl border border-gray-200 bg-white">
            {connections.map((conn) => (
              <div key={conn.id} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  conn.status === "active" ? "bg-green-500" : "bg-red-500"
                }`} />
                <span className="text-sm font-medium text-gray-700">{conn.display_phone}</span>
                {conn.business_name && (
                  <span className="text-xs text-gray-400">· {conn.business_name}</span>
                )}
                {conn.quality_rating && (
                  <Badge
                    variant={
                      conn.quality_rating === "GREEN"
                        ? "default"
                        : conn.quality_rating === "YELLOW"
                        ? "amber"
                        : "destructive"
                    }
                  >
                    {conn.quality_rating}
                  </Badge>
                )}
                {conn.messaging_limit && (
                  <Badge variant="secondary">{conn.messaging_limit}</Badge>
                )}
              </div>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-gray-400">{templates.length} templates</span>
              <Button
                variant="outline"
                size="sm"
                disabled={syncing || connections.length === 0}
                onClick={() => syncTemplates(connections[0])}
              >
                <RefreshCw className={`w-3 h-3 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Sincronizando..." : "Sincronizar templates"}
              </Button>
            </div>
          </div>
        )}

        {/* No connection warning */}
        {connections.length === 0 && !loading && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Send className="w-5 h-5 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Nenhuma conexão WhatsApp configurada</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Configure sua conta Meta Business em Configurações → Integrações
                </p>
              </div>
            </div>
            <Button variant="amber" size="sm" onClick={() => navigate("/settings")}>
              Configurar
            </Button>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="active">
          <TabsList className="mb-4">
            <TabsTrigger value="active">
              Em andamento
              {activeCampaigns.length > 0 && (
                <span className="ml-1.5 w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center">
                  {activeCampaigns.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="draft">Rascunhos</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
              </div>
            ) : activeCampaigns.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <Send className="w-7 h-7 text-gray-300" />
                </div>
                <p className="text-gray-500 font-medium">Nenhum disparo em andamento</p>
                <p className="text-sm text-gray-400 mt-1">Crie uma nova campanha para começar</p>
                <Button
                  className="mt-4"
                  onClick={() => navigate("/shooting/new")}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Nova Campanha
                </Button>
              </div>
            ) : (
              <CampaignList
                campaigns={activeCampaigns}
                loading={false}
                onDelete={deleteCampaign}
              />
            )}
          </TabsContent>

          <TabsContent value="draft">
            <CampaignList
              campaigns={draftCampaigns}
              loading={loading}
              onDelete={deleteCampaign}
            />
          </TabsContent>

          <TabsContent value="history">
            <CampaignList
              campaigns={historyCampaigns}
              loading={loading}
              onDelete={deleteCampaign}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
