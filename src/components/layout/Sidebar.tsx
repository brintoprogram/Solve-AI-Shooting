import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
import {
  ChevronRight,
  Coins,
  Send,
  Settings,
  LayoutDashboard,
  Users,
  MessageSquare,
  Zap,
  UserCog,
  LogOut,
  LayoutTemplate,
  Bell,
  BarChart2,
  Lock,
  LifeBuoy,
  Bot,
  ChevronsUpDown,
  Rocket,
  Check,
  Sparkles,
  Handshake,
  BookOpen,
  Cake,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, hasPermission, ROLE_LABELS, ROLE_STYLE, initials } from "@/context/AuthContext";
import type { PermissionKey } from "@/context/AuthContext";
import { useCampaignAlerts } from "@/hooks/useCampaignAlerts";
import { useSetupChecklist } from "@/hooks/useSetupChecklist";

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  subtitle: string;
  permission?: PermissionKey | PermissionKey[]; // undefined = accessible by all
}

/* Os 15 destinos numa lista unica exigiam ler todos para achar um. Agrupados
   por TAREFA — o que a pessoa esta fazendo — em vez de por tipo tecnico.

   Todos colapsam, inclusive o primeiro: um grupo que se comporta diferente
   dos outros faz a pessoa clicar e nao entender por que nada acontece. O
   grupo da rota ATIVA continua sempre aberto, entao ninguem consegue esconder
   a propria pagina. */
interface NavGroup {
  id:    string;
  label: string;
  itens: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "inicio",
    label: "Visão geral",
    itens: [
      { to: "/primeiros-passos",  icon: Rocket,          label: "Primeiros passos", subtitle: "Configuração do workspace" },
      { to: "/tutoriais",         icon: BookOpen,        label: "Tutoriais",    subtitle: "Como configurar cada parte" },
      { to: "/",                  icon: LayoutDashboard, label: "Dashboard",    subtitle: "Visão geral"            },
      { to: "/contacts",          icon: Users,           label: "Contatos",     subtitle: "Base de clientes",      permission: "can_manage_contacts" },
    ],
  },
  {
    id: "atendimento",
    label: "Atendimento",
    itens: [
      { to: "/inbox",             icon: MessageSquare,   label: "Inbox",        subtitle: "Conversas ativas",      permission: "can_inbox" },
      { to: "/alerts",            icon: Bell,            label: "Alertas",      subtitle: "Respostas dos clientes" },
      { to: "/negotiations",      icon: Handshake,       label: "Negociações",  subtitle: "Renegociação de dívidas", permission: "can_negotiations" },
      { to: "/agents",            icon: Bot,             label: "Agentes",      subtitle: "IA por conversa",       permission: "can_settings" },
    ],
  },
  {
    id: "campanhas",
    label: "Campanhas",
    itens: [
      { to: "/shooting",          icon: Send,            label: "Shooting",     subtitle: "Disparos WhatsApp",     permission: ["can_shoot", "can_manage_campaigns"] },
      { to: "/templates",         icon: LayoutTemplate,  label: "Templates",    subtitle: "Templates WhatsApp"     },
      { to: "/automations",       icon: Zap,             label: "Automações",   subtitle: "Fluxos inteligentes"    },
      { to: "/relacionamento",    icon: Cake,            label: "Relacionamento", subtitle: "Aniversário e datas"  },
      { to: "/reports",           icon: BarChart2,       label: "Relatórios",   subtitle: "Campanhas & auditoria"  },
    ],
  },
  {
    id: "conta",
    label: "Conta",
    itens: [
      { to: "/creditos",          icon: Coins,           label: "Créditos",     subtitle: "Saldo e consumo"        },
      { to: "/team",              icon: UserCog,         label: "Equipe",       subtitle: "Agentes & convites",    permission: "can_manage_team" },
      { to: "/settings",          icon: Settings,        label: "Configurações",subtitle: "Conta e integrações",   permission: "can_settings" },
      { to: "/support",           icon: LifeBuoy,        label: "Suporte",      subtitle: "Tickets e ajuda"        },
    ],
  },
];

const CHAVE_GRUPOS = "sidebar:grupos-fechados";

function lerFechados(): string[] {
  try {
    const cru = localStorage.getItem(CHAVE_GRUPOS);
    return cru ? (JSON.parse(cru) as string[]) : [];
  } catch { return []; }   /* localStorage bloqueado nao pode derrubar o menu */
}

function isAllowed(profile: ReturnType<typeof useAuth>["profile"], item: NavItem): boolean {
  if (!item.permission) return true;
  const perms = Array.isArray(item.permission) ? item.permission : [item.permission];
  return perms.some((p) => hasPermission(profile, p));
}

export function Sidebar() {
  const { profile, signOut, workspaces, workspaceId, switchWorkspace } = useAuth();
  const { unreadCount } = useCampaignAlerts();
  const { blockersLeft, doneCount, totalCount } = useSetupChecklist(workspaceId ?? undefined);
  const navigate = useNavigate();
  const [wsOpen, setWsOpen] = useState(false);

  const current = workspaces.find((w) => w.id === workspaceId);
  const isDemo = current?.name.toLowerCase().includes("demo") ?? false;

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  const { pathname } = useLocation();
  const [fechados, setFechados] = useState<string[]>(lerFechados);

  /* O grupo da rota ATIVA fica sempre aberto: um item selecionado escondido
     dentro de um grupo fechado faz o menu parecer que perdeu a pagina. */
  const grupoAtivo = NAV_GROUPS.find((g) =>
    g.itens.some((i) => i.to === "/" ? pathname === "/" : pathname.startsWith(i.to)),
  )?.id;

  function alternarGrupo(id: string) {
    setFechados((atuais) => {
      const proximos = atuais.includes(id) ? atuais.filter((g) => g !== id) : [...atuais, id];
      try { localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(proximos)); } catch { /* idem */ }
      return proximos;
    });
  }

  const rs           = profile ? ROLE_STYLE[profile.role] : null;
  const roleLabel    = profile ? ROLE_LABELS[profile.role]  : null;
  const avatarText   = initials(profile?.full_name);

  return (
    <aside
      className="fixed left-0 h-screen w-60 flex flex-col z-30"
      style={{
        top: isDemo ? 37 : 0,
        background: "linear-gradient(180deg, #0d1a11 0%, #0a110e 100%)",
        borderRight: "1px solid rgba(63,176,108,0.1)",
      }}
    >
      {/* Subtle grid pattern */}
      <div className="absolute inset-0 grid-pattern opacity-30 pointer-events-none" />

      {/* Logo */}
      <div
        className="relative px-4 py-5 flex flex-col items-center"
        style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
      >
        <img
          src="/logo.png"
          alt="Solve AI"
          className="h-11 w-auto object-contain mb-2"
          style={{ filter: "drop-shadow(0 0 10px rgba(63,176,108,0.3))" }}
        />
        <p className="font-display text-sm font-bold tracking-widest text-agro-text uppercase">
          SOLVE <span className="text-agro-green">.AI</span>
        </p>
        <p className="text-[9px] text-agro-muted-2 leading-tight tracking-wide">
          A inteligência que cultiva resultados
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-thin relative">
        {NAV_GROUPS.map((grupo) => {
          /* Itens que este usuario pode ver. Grupo que ficaria vazio some
             inteiro — cabecalho sozinho e ruido. */
          const visiveis = grupo.itens;
          if (visiveis.length === 0) return null;

          const fechado = fechados.includes(grupo.id) && grupoAtivo !== grupo.id;
          const temAtivo = grupoAtivo === grupo.id;

          /* Alertas nao lidos deste grupo. Sem isto, fechar "Atendimento"
             esconderia o contador vermelho — e a pessoa deixaria de ver que
             ha resposta de cliente esperando. O aviso tem que sobreviver ao
             colapso, senao o colapso vira um jeito de perder trabalho. */
          const alertasNoGrupo = visiveis.some((i) => i.to === "/alerts") ? unreadCount : 0;
          const pendenciasNoGrupo = visiveis.some((i) => i.to === "/primeiros-passos")
            ? (blockersLeft > 0 ? blockersLeft : totalCount - doneCount) : 0;

          return (
            <div key={grupo.id} className="pt-2 first:pt-0">
              <button
                onClick={() => alternarGrupo(grupo.id)}
                className="w-full flex items-center gap-2 pl-2 pr-3 py-2 rounded-lg transition-colors hover:bg-[#131f18]"
                aria-expanded={!fechado}
              >
                <ChevronRight
                  className="w-3 h-3 shrink-0 transition-transform duration-200"
                  style={{
                    color: temAtivo ? "#3fb06c" : "#4a6b50",
                    transform: fechado ? undefined : "rotate(90deg)",
                  }}
                />
                <span
                  className="text-[9px] font-bold tracking-[0.14em] uppercase transition-colors"
                  style={{ color: temAtivo ? "#3fb06c" : "#6b7f6e" }}
                >
                  {grupo.label}
                </span>

                {/* Contadores sobem para o cabecalho quando o grupo fecha */}
                {fechado && alertasNoGrupo > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1 shrink-0">
                    {alertasNoGrupo > 99 ? "99+" : alertasNoGrupo}
                  </span>
                )}
                {fechado && pendenciasNoGrupo > 0 && alertasNoGrupo === 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] rounded-full bg-agro-green text-black text-[9px] font-bold flex items-center justify-center px-1 shrink-0">
                    {pendenciasNoGrupo}
                  </span>
                )}
                {/* Quantos itens estao escondidos ali dentro */}
                {fechado && alertasNoGrupo === 0 && pendenciasNoGrupo === 0 && (
                  <span className="ml-auto text-[9px] tabular-nums" style={{ color: "#3a4d3e" }}>
                    {visiveis.length}
                  </span>
                )}
              </button>

              {/* Trilho a esquerda: liga visualmente os itens ao cabecalho e
                  deixa claro o que pertence a que. Sem ele, grupo aberto e
                  lista solta de novo. */}
              {!fechado && (
                <div
                  className="space-y-0.5 mt-0.5 ml-[13px] pl-2"
                  style={{ borderLeft: `1px solid ${temAtivo ? "rgba(63,176,108,0.25)" : "rgba(63,176,108,0.09)"}` }}
                >
                  {visiveis.map((item) => {
            const allowed = isAllowed(profile, item);

            // ── Locked item (no permission) ───────────────────────────
            if (!allowed) {
              return (
                <div
                  key={item.to}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl relative select-none"
                  style={{ opacity: 0.35, cursor: "not-allowed" }}
                  title={`Você não tem permissão para acessar ${item.label}`}
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-agro-surface text-agro-muted-2">
                    <item.icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-none text-agro-text-2">{item.label}</p>
                    <p className="text-[10px] mt-0.5 truncate text-agro-muted-2">{item.subtitle}</p>
                  </div>
                  <Lock className="w-3 h-3 text-agro-muted-2 shrink-0" />
                </div>
              );
            }

            // ── Normal item ───────────────────────────────────────────
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/" || item.to === "/shooting"}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 relative",
                    isActive ? "text-white" : "text-agro-muted hover:text-agro-text"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <div
                        className="absolute inset-0 rounded-xl"
                        style={{
                          background: "linear-gradient(135deg, rgba(63,176,108,0.2) 0%, rgba(22,163,74,0.12) 100%)",
                          border: "1px solid rgba(63,176,108,0.3)",
                          boxShadow: "0 0 20px rgba(63,176,108,0.1), inset 0 0 20px rgba(63,176,108,0.05)",
                        }}
                      />
                    )}
                    {!isActive && (
                      <div
                        className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                        style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.08)" }}
                      />
                    )}
                    <div
                      className={cn(
                        "relative w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200",
                        isActive
                          ? "bg-agro-green text-white"
                          : "bg-agro-surface text-agro-muted-2 group-hover:text-agro-green group-hover:bg-agro-surface-2"
                      )}
                    >
                      <item.icon className="w-3.5 h-3.5" />
                      {isActive && <div className="absolute inset-0 rounded-lg glow-green-sm opacity-60" />}
                    </div>
                    <div className="relative min-w-0">
                      <p className={cn("text-sm font-medium leading-none transition-colors duration-200", isActive ? "text-agro-text" : "text-agro-text-2 group-hover:text-agro-text")}>
                        {item.label}
                      </p>
                      <p className={cn("text-[10px] mt-0.5 truncate transition-colors duration-200", isActive ? "text-agro-green" : "text-agro-muted-2")}>
                        {item.subtitle}
                      </p>
                    </div>
                    {isActive && item.to !== "/alerts" && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-agro-green shrink-0 glow-green-sm" />
                    )}
                    {item.to === "/primeiros-passos" && doneCount < totalCount && (
                      <span
                        className="ml-auto min-w-[18px] h-[18px] rounded-full text-white text-[9px] font-bold flex items-center justify-center px-1 shrink-0"
                        style={{ background: blockersLeft > 0 ? "#ef4444" : "rgba(63,176,108,0.8)" }}
                        title={blockersLeft > 0
                          ? `${blockersLeft} item essencial pendente`
                          : `${totalCount - doneCount} item opcional pendente`}
                      >
                        {blockersLeft > 0 ? blockersLeft : totalCount - doneCount}
                      </span>
                    )}
                    {item.to === "/alerts" && unreadCount > 0 && (
                      <span className="ml-auto min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1 shrink-0">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Atalho da demo — só no workspace de demonstração. Antes aparecia em
          todos, inclusive nos dos clientes, onde não faz sentido nenhum.
          Usa o mesmo `isDemo` que já controla a tarja "Ambiente de
          Demonstração" no topo, para os dois nunca divergirem. */}
      {isDemo && (
      <div className="px-3 pb-2">
        <NavLink
          to="/agents/demo"
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl w-full transition-all group/demo"
          style={({ isActive }) => ({
            background:  isActive ? "rgba(63,176,108,0.18)" : "rgba(63,176,108,0.07)",
            border:      `1px solid ${isActive ? "rgba(63,176,108,0.45)" : "rgba(63,176,108,0.2)"}`,
            boxShadow:   isActive ? "0 0 16px rgba(63,176,108,0.12)" : "none",
          })}
        >
          <div className="relative w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}>
            <Sparkles className="w-3.5 h-3.5 text-black" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-agro-green animate-ping opacity-70" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-agro-green leading-none">Demo ao Vivo</p>
            <p className="text-[9px] text-agro-muted leading-tight mt-0.5">Roteamento de IA</p>
          </div>
          <span className="text-[8px] font-black px-1.5 py-0.5 rounded shrink-0"
            style={{ background: "#3fb06c", color: "#000", letterSpacing: "0.05em" }}>
            DEMO
          </span>
        </NavLink>
      </div>
      )}

      {/* Workspace switcher — only when user belongs to multiple workspaces */}
      {workspaces.length > 1 && (
        <div className="relative px-3 pb-2">
          <button
            onClick={() => setWsOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all hover:bg-white/5"
            style={{ border: "1px solid rgba(63,176,108,0.12)", color: isDemo ? "#3fb06c" : "#6b8a75" }}
          >
            <span className="flex-1 text-left truncate font-medium">{current?.name ?? "Workspace"}</span>
            <ChevronsUpDown className="w-3 h-3 shrink-0" />
          </button>
          {wsOpen && (
            <div
              className="absolute bottom-full left-3 right-3 mb-1 rounded-xl overflow-hidden z-50"
              style={{ background: "#0d1a11", border: "1px solid rgba(63,176,108,0.2)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
            >
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => { switchWorkspace(ws.id); setWsOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left transition-all hover:bg-white/5"
                  style={{ color: ws.id === workspaceId ? "#3fb06c" : "#7a9e83" }}
                >
                  {ws.id === workspaceId && <Check className="w-3 h-3 shrink-0" />}
                  {ws.id !== workspaceId && <span className="w-3 shrink-0" />}
                  <span className="truncate font-medium">{ws.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer — user info + logout */}
      <div
        className="relative px-3 py-4"
        style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}
      >
        <div
          className="flex items-center gap-3 rounded-xl overflow-hidden"
          style={{
            background: "rgba(63,176,108,0.04)",
            border: "1px solid rgba(63,176,108,0.08)",
          }}
        >
          {/* Clickable profile area → /settings */}
          <NavLink
            to="/settings"
            className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5 hover:bg-white/5 transition-colors duration-200"
          >
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.full_name ?? "Avatar"}
                className="w-8 h-8 rounded-full object-cover shrink-0"
                style={{ border: "1px solid rgba(63,176,108,0.3)" }}
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
              >
                {avatarText}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-agro-text truncate">
                {profile?.full_name ?? "…"}
              </p>
              {rs && roleLabel && (
                <span
                  className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded mt-0.5"
                  style={{ background: rs.bg, color: rs.color, border: `1px solid ${rs.border}` }}
                >
                  {roleLabel}
                </span>
              )}
            </div>
          </NavLink>

          {/* Logout */}
          <button
            onClick={handleSignOut}
            title="Sair"
            className="w-10 h-full flex items-center justify-center text-agro-muted-2 hover:text-red-400 hover:bg-red-400/10 transition-all duration-200 shrink-0 self-stretch"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
