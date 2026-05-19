import { Sparkles, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export function DemoBanner() {
  const { workspaces, workspaceId, switchWorkspace } = useAuth();

  const current = workspaces.find((w) => w.id === workspaceId);
  if (!current?.name.toLowerCase().includes("demo")) return null;

  const nonDemo = workspaces.find((w) => !w.name.toLowerCase().includes("demo"));

  function exit() {
    if (nonDemo) switchWorkspace(nonDemo.id);
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 px-4 py-2"
      style={{ background: "linear-gradient(90deg, #1a3a2a 0%, #0d2219 50%, #1a3a2a 100%)", borderBottom: "1px solid rgba(63,176,108,0.3)" }}
    >
      <Sparkles className="w-4 h-4 shrink-0" style={{ color: "#3fb06c" }} />
      <p className="text-sm font-semibold" style={{ color: "#7fc49a" }}>
        Ambiente de Demonstração — os dados exibidos são fictícios para fins de apresentação
      </p>
      {nonDemo && (
        <button
          onClick={exit}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all hover:bg-white/10"
          style={{ color: "#3fb06c", border: "1px solid rgba(63,176,108,0.35)" }}
        >
          <X className="w-3.5 h-3.5" />
          Sair do Demo
        </button>
      )}
    </div>
  );
}
