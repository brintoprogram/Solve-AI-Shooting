import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { ShootingPage } from "@/pages/shooting/ShootingPage";
import { CampaignWizard } from "@/pages/shooting/CampaignWizard";
import { CampaignDetail } from "@/pages/shooting/CampaignDetail";
import { Settings } from "@/pages/Settings";
import { Setup } from "@/pages/Setup";
import { Inbox } from "@/pages/Inbox";
import { isConfigured } from "@/lib/config";

export function App() {
  // Se não houver credenciais configuradas, mostra o Setup Wizard
  if (!isConfigured()) {
    return <Setup />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/shooting" element={<ShootingPage />} />
          <Route path="/shooting/history" element={<ShootingPage />} />
          <Route path="/shooting/new" element={<CampaignWizard />} />
          <Route path="/shooting/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/contacts" element={<PlaceholderPage title="Contatos" />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/automations" element={<PlaceholderPage title="Automações" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-3xl font-bold text-gray-200">{title}</p>
        <p className="text-sm text-gray-400 mt-2">Em desenvolvimento</p>
      </div>
    </div>
  );
}
