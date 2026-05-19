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
      <div
        className={!isInbox ? "md:pl-60" : undefined}
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

