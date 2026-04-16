import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Toaster } from "@/components/ui/toaster";

export function AppLayout() {
  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Sidebar />
      <div className="pl-60">
        <main className="min-h-screen">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
