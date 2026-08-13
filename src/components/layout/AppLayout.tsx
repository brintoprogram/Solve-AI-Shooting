import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { DemoBanner } from "./DemoBanner";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@/context/AuthContext";

export function AppLayout() {
  const { pathname } = useLocation();
  const { workspaces, workspaceId } = useAuth();
  const isInbox = pathname.startsWith("/inbox");

  const current = workspaces.find((w) => w.id === workspaceId);
  const isDemo = current?.name.toLowerCase().includes("demo") ?? false;

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <DemoBanner />
      {!isInbox && (
        <div className="hidden md:block">
          <Sidebar />
        </div>
      )}
      {/* pb-16 no celular: a barra de navegação é fixed e fica POR CIMA do
          conteúdo. Sem a folga, a última linha de toda lista — o último
          contato, o último membro da equipe, o botão de salvar no fim de um
          formulário — nasce inalcançável, e o sintoma parece bug da página. */}
      <div
        className={`pb-16 md:pb-0 ${!isInbox ? "md:pl-60" : ""}`}
        style={isDemo ? { paddingTop: 37 } : undefined}
      >
        <main className="min-h-screen">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
      <Toaster />
    </div>
  );
}

