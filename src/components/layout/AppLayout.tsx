import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { Toaster } from "@/components/ui/toaster";

export function AppLayout() {
  const { pathname } = useLocation();
  const isInbox = pathname.startsWith("/inbox");

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      {!isInbox && (
        <div className="hidden md:block">
          <Sidebar />
        </div>
      )}
      <div className={!isInbox ? "md:pl-60" : undefined}>
        <main className="min-h-screen">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
      <Toaster />
    </div>
  );
}
