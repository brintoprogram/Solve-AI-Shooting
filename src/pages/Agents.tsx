import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/context/AuthContext";
import { SettingsAIAgents } from "@/pages/settings/SettingsAIAgents";

export function Agents() {
  const { workspaceId } = useAuth();
  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Agentes de IA" }]} />
      <div className="max-w-2xl mx-auto px-6 py-8">
        <SettingsAIAgents workspaceId={workspaceId ?? ""} />
      </div>
    </div>
  );
}
