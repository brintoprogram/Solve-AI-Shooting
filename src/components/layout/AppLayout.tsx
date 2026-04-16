import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Toaster } from "@/components/ui/toaster";

export function AppLayout() {
  return (
    <div className="min-h-screen bg-gray-50">
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
