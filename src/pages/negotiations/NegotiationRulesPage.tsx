import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/context/AuthContext";
import { SettingsNegotiationRules } from "@/pages/settings/SettingsNegotiationRules";

export function NegotiationRulesPage() {
  const { workspaceId } = useAuth();
  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Negociações", href: "/negotiations" }, { label: "Regras" }]} />
      <div className="max-w-2xl mx-auto px-6 py-8">
        <SettingsNegotiationRules workspaceId={workspaceId ?? ""} />
      </div>
    </div>
  );
}
