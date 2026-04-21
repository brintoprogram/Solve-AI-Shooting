import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Leaf } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { ShootingPage } from "@/pages/shooting/ShootingPage";
import { CampaignWizard } from "@/pages/shooting/CampaignWizard";
import { CampaignDetail } from "@/pages/shooting/CampaignDetail";
import { Settings } from "@/pages/Settings";
import { Onboarding } from "@/pages/Onboarding";
import { Inbox } from "@/pages/Inbox";
import { Team } from "@/pages/Team";
import { Templates } from "@/pages/Templates";
import { Contacts } from "@/pages/Contacts";
import { Alerts }      from "@/pages/Alerts";
import { SetPassword } from "@/pages/SetPassword";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

function AppRoutes() {
  const { user, loading, setupType } = useAuth();

  if (loading)    return <FullScreenLoader />;
  if (setupType)  return <SetPassword />;
  if (!user)      return <Login />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/"                         element={<Dashboard />} />
        <Route path="/shooting"                 element={<ShootingPage />} />
        <Route path="/shooting/history"         element={<ShootingPage />} />
        <Route path="/shooting/new"             element={<CampaignWizard />} />
        <Route path="/shooting/campaigns/:id"   element={<CampaignDetail />} />
        <Route path="/settings"                 element={<Settings />} />
        <Route path="/contacts"                 element={<Contacts />} />
        <Route path="/inbox"                    element={<Inbox />} />
        <Route path="/automations"              element={<PlaceholderPage title="Automações" />} />
        <Route path="/team"                     element={<Team />} />
        <Route path="/templates"               element={<Templates />} />
        <Route path="/alerts"                   element={<Alerts />} />
        <Route path="*"                         element={<Navigate to="/" replace />} />
      </Route>
      {/* Full-screen flow — no sidebar */}
      <Route path="/onboarding" element={<Onboarding />} />
    </Routes>
  );
}

function FullScreenLoader() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "#0a110e" }}
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #3fb06c 0%, #16A34A 100%)" }}
        >
          <Leaf className="w-6 h-6 text-white animate-pulse" />
        </div>
        <p className="text-sm text-agro-muted">Verificando sessão...</p>
      </div>
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a110e" }}>
      <div className="text-center">
        <p className="text-3xl font-bold text-agro-muted-2">{title}</p>
        <p className="text-sm text-agro-muted mt-2">Em desenvolvimento</p>
      </div>
    </div>
  );
}
