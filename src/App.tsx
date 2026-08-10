import { Component, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Leaf, AlertTriangle } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider, useAuth, hasPermission } from "@/context/AuthContext";
import type { PermissionKey } from "@/context/AuthContext";
import { AccessDenied } from "@/components/AccessDenied";
import { log } from "@/lib/logger";
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
import { Support }     from "@/pages/Support";
import { Agents }      from "@/pages/Agents";
import { AgentRoutingDemo } from "@/pages/agents/AgentRoutingDemo";
import { AgentSandbox } from "@/pages/agents/AgentSandbox";
import { Credits } from "@/pages/Credits";
import { CreditsAdmin } from "@/pages/admin/CreditsAdmin";
import { WorkspacesAdmin } from "@/pages/admin/WorkspacesAdmin";
import { Automations } from "@/pages/Automations";
import { AutomationWizard } from "@/pages/automations/AutomationWizard";
import { AutomationDetail } from "@/pages/automations/AutomationDetail";
import { SetPassword } from "@/pages/SetPassword";
import { AcceptInvite } from "@/pages/AcceptInvite";
import { PrivacyPolicy } from "@/pages/PrivacyPolicy";
import { TermsOfUse } from "@/pages/TermsOfUse";
import { NegotiationPortal } from "@/pages/NegotiationPortal";
import { Negotiations } from "@/pages/Negotiations";
import { NegotiationDetail } from "@/pages/negotiations/NegotiationDetail";
import { NegotiationRulesPage } from "@/pages/negotiations/NegotiationRulesPage";
import { SetupGuide } from "@/pages/SetupGuide";
import { Tutorials } from "@/pages/Tutorials";
import { Relationship } from "@/pages/Relationship";
import { Activity } from "@/pages/Activity";
import { Demos } from "@/pages/Demos";

// ── Error boundary — shows error message instead of blank screen ──
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }

  // Antes o erro só era pintado na tela — ninguém ficava sabendo que a app
  // quebrou para um usuário real. Agora vai para o logger (e daí ao coletor,
  // quando um for plugado via setReporter).
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    log.fatal("react_error_boundary", {
      err:   error.message,
      stack: error.stack?.slice(0, 2000),
      component_stack: info.componentStack?.slice(0, 2000) ?? undefined,
      url:   window.location.pathname,
    });
  }
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

  // Public routes — accessible without authentication
  if (window.location.pathname === "/privacidade") return <PrivacyPolicy />;
  if (window.location.pathname === "/termos")      return <TermsOfUse />;

  // Public route: scanner-proof invite landing page (authenticated users go to dashboard)
  if (window.location.pathname === "/convite") {
    if (!user) return <AcceptInvite />;
    return <Navigate to="/" replace />;
  }

  // Public route: client negotiation portal — token-based, no Supabase Auth session at all.
  // Checked before the "!user" gate below so it works for anonymous WhatsApp contacts.
  const negMatch = window.location.pathname.match(/^\/negociacao\/([a-f0-9]{64})$/);
  if (negMatch) return <NegotiationPortal token={negMatch[1]} />;

  if (!user)      return <Login />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/"                       element={<Dashboard />} />
        <Route path="/shooting"               element={<PR permission={["can_shoot","can_manage_campaigns"]} feature="Shooting & Campanhas"><ShootingPage /></PR>} />
        <Route path="/shooting/new"           element={<PR permission="can_manage_campaigns" feature="Nova Campanha"><CampaignWizard /></PR>} />
        <Route path="/shooting/campaigns/:id" element={<PR permission={["can_shoot","can_manage_campaigns"]} feature="Detalhe da Campanha"><CampaignDetail /></PR>} />
        <Route path="/settings"               element={<PR permission="can_settings" feature="Configurações"><Settings /></PR>} />
        <Route path="/contacts"               element={<PR permission="can_manage_contacts" feature="Contatos"><Contacts /></PR>} />
        <Route path="/inbox"                  element={<PR permission="can_inbox" feature="Inbox"><Inbox /></PR>} />
        <Route path="/primeiros-passos"       element={<SetupGuide />} />
        <Route path="/tutoriais"              element={<Tutorials />} />
        <Route path="/relacionamento"         element={<Relationship />} />
        <Route path="/demos"                  element={<Demos />} />
        <Route path="/negotiations"           element={<PR permission="can_negotiations" feature="Negociações"><Negotiations /></PR>} />
        <Route path="/negotiations/rules"     element={<PR permission="can_settings" feature="Regras de Negociação"><NegotiationRulesPage /></PR>} />
        <Route path="/negotiations/:id"       element={<PR permission="can_negotiations" feature="Negociação"><NegotiationDetail /></PR>} />
        <Route path="/automations"             element={<Automations />} />
        <Route path="/automations/new"        element={<AutomationWizard />} />
        <Route path="/automations/:id/edit"   element={<AutomationWizard />} />
        <Route path="/automations/:id"        element={<AutomationDetail />} />
        <Route path="/team"                   element={<PR permission="can_manage_team" feature="Equipe"><Team /></PR>} />
        <Route path="/atividade"              element={<PR permission="can_settings" feature="Atividade"><Activity /></PR>} />
        <Route path="/templates"              element={<Templates />} />
        <Route path="/alerts"                 element={<Alerts />} />
        <Route path="/reports"                element={<Reports />} />
        <Route path="/support"                element={<Support />} />
        <Route path="/agents"                 element={<PR permission="can_settings" feature="Agentes de IA"><Agents /></PR>} />
        <Route path="/agents/demo"            element={<PR permission="can_settings" feature="Demo Roteamento"><AgentRoutingDemo /></PR>} />
        <Route path="/agents/testar"          element={<PR permission="can_settings" feature="Ambiente de teste"><AgentSandbox /></PR>} />
        {/* Sem gate de permissao: qualquer membro precisa poder ver por que o
            envio parou. Recarregar e outra coisa — quem decide e o servidor. */}
        <Route path="/creditos"               element={<Credits />} />
        {/* Administracao da plataforma. Fora do menu de proposito: quem tem
            acesso sabe o endereco, e quem nao tem recebe "area restrita" — a
            decisao vem do servidor, nao de um `if` no render. */}
        <Route path="/admin/creditos"         element={<CreditsAdmin />} />
        <Route path="/admin/workspaces"       element={<WorkspacesAdmin />} />
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

