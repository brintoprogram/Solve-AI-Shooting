import { Component, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Leaf, AlertTriangle } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider, useAuth, hasPermission } from "@/context/AuthContext";
import type { PermissionKey } from "@/context/AuthContext";
import { AccessDenied } from "@/components/AccessDenied";
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
import { Reports }     from "@/pages/Reports";
import { SetPassword } from "@/pages/SetPassword";

// ── Error boundary — shows error message instead of blank screen ──
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div
          style={{ background: "#0a110e", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
        >
          <div
            style={{ maxWidth: 480, width: "100%", background: "rgba(13,26,17,0.9)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 16, padding: "32px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <AlertTriangle style={{ color: "#f87171", width: 24, height: 24, flexShrink: 0 }} />
              <p style={{ color: "#f87171", fontWeight: 700, fontSize: 16 }}>Erro na aplicação</p>
            </div>
            <p style={{ color: "#7a9e83", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
              Ocorreu um erro inesperado. Copie a mensagem abaixo e envie para o suporte:
            </p>
            <pre
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 8, padding: "12px 16px", fontSize: 11, color: "#fca5a5", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {err.message}{"\n\n"}{err.stack}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{ marginTop: 20, width: "100%", padding: "12px", background: "#3fb06c", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}
            >
              Recarregar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

// ── Permission-gated route wrapper ────────────────────────────────
// Safe to do conditional rendering here because this component itself
// calls no hooks beyond useAuth — the page component only mounts when allowed.
function PR({
  permission,
  feature,
  children,
}: {
  permission: PermissionKey | PermissionKey[];
  feature: string;
  children: ReactNode;
}) {
  const { profile } = useAuth();
  const perms = Array.isArray(permission) ? permission : [permission];
  if (!perms.some((p) => hasPermission(profile, p))) {
    return <AccessDenied feature={feature} permission={permission} />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading, setupType } = useAuth();

  if (loading)    return <FullScreenLoader />;
  if (setupType)  return <SetPassword />;
  if (!user)      return <Login />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/"                       element={<Dashboard />} />
        <Route path="/shooting"               element={<PR permission={["can_shoot","can_manage_campaigns"]} feature="Shooting & Campanhas"><ShootingPage /></PR>} />
        <Route path="/shooting/history"       element={<PR permission={["can_shoot","can_manage_campaigns"]} feature="Histórico de Campanhas"><ShootingPage /></PR>} />
        <Route path="/shooting/new"           element={<PR permission="can_manage_campaigns" feature="Nova Campanha"><CampaignWizard /></PR>} />
        <Route path="/shooting/campaigns/:id" element={<PR permission={["can_shoot","can_manage_campaigns"]} feature="Detalhe da Campanha"><CampaignDetail /></PR>} />
        <Route path="/settings"               element={<PR permission="can_settings" feature="Configurações"><Settings /></PR>} />
        <Route path="/contacts"               element={<PR permission="can_manage_contacts" feature="Contatos"><Contacts /></PR>} />
        <Route path="/inbox"                  element={<PR permission="can_inbox" feature="Inbox"><Inbox /></PR>} />
        <Route path="/automations"            element={<PlaceholderPage title="Automações" />} />
        <Route path="/team"                   element={<PR permission="can_manage_team" feature="Equipe"><Team /></PR>} />
        <Route path="/templates"              element={<Templates />} />
        <Route path="/alerts"                 element={<Alerts />} />
        <Route path="/reports"                element={<Reports />} />
        <Route path="*"                       element={<Navigate to="/" replace />} />
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
