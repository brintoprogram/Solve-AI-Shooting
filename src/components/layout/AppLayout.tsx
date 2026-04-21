import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { Toaster } from "@/components/ui/toaster";

export function AppLayout() {
  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <div className="md:pl-60">
        <main className="min-h-screen">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
      <Toaster />
    </div>
  );
}
