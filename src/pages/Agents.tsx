import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/context/AuthContext";
import { SettingsAIAgents } from "@/pages/settings/SettingsAIAgents";

export function Agents() {
  const { workspaceId } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Agentes de IA" }]} />
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* Demo CTA */}
        <button
          onClick={() => navigate("/agents/demo")}
          className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl text-left transition-all hover:brightness-110 group"
          style={{
            background:  "linear-gradient(135deg, rgba(63,176,108,0.12) 0%, rgba(22,163,74,0.06) 100%)",
            border:      "1px solid rgba(63,176,108,0.3)",
            boxShadow:   "0 0 30px rgba(63,176,108,0.06)",
          }}
        >
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)", boxShadow: "0 0 20px rgba(63,176,108,0.35)" }}
          >
            <Sparkles className="w-5 h-5 text-black" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">Demo: Roteamento Inteligente</p>
            <p className="text-xs text-agro-muted mt-0.5 leading-relaxed">
              Veja em tempo real como a IA lê o contexto da conversa e roteia para o setor certo — perfeito para apresentações a clientes.
            </p>
          </div>
          <div
            className="text-xs font-semibold px-3 py-1.5 rounded-xl shrink-0 transition-all group-hover:bg-agro-green group-hover:text-black"
            style={{ background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.35)" }}
          >
            Ver demo →
          </div>
        </button>

        <SettingsAIAgents workspaceId={workspaceId ?? ""} />
      </div>
    </div>
  );
}
