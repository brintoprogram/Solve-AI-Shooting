import { NavLink } from "react-router-dom";
import {
  Send,
  History,
  Settings,
  LayoutDashboard,
  Users,
  MessageSquare,
  Zap,
  Leaf,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  subtitle: string;
}

const navItems: NavItem[] = [
  { to: "/",             icon: LayoutDashboard, label: "Dashboard",   subtitle: "Visão geral"         },
  { to: "/shooting",     icon: Send,            label: "Shooting",    subtitle: "Disparos WhatsApp"   },
  { to: "/shooting/history", icon: History,     label: "Histórico",   subtitle: "Campanhas anteriores"},
  { to: "/contacts",     icon: Users,           label: "Contatos",    subtitle: "Base de clientes"    },
  { to: "/inbox",        icon: MessageSquare,   label: "Inbox",       subtitle: "Conversas ativas"    },
  { to: "/automations",  icon: Zap,             label: "Automações",  subtitle: "Fluxos inteligentes" },
  { to: "/settings",     icon: Settings,        label: "Configurações",subtitle: "Conta e integrações"},
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-60 flex flex-col z-30"
      style={{
        background: "linear-gradient(180deg, #0d1a11 0%, #0a110e 100%)",
        borderRight: "1px solid rgba(63,176,108,0.1)",
      }}
    >
      {/* Subtle grid pattern */}
      <div className="absolute inset-0 grid-pattern opacity-30 pointer-events-none" />

      {/* Logo */}
      <div className="relative px-5 py-6" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center glow-green-sm"
              style={{ background: "linear-gradient(135deg, #3fb06c 0%, #16A34A 100%)" }}
            >
              <Leaf className="w-4.5 h-4.5 text-white" />
            </div>
            {/* Pulse ring */}
            <div className="absolute inset-0 rounded-xl border border-agro-green opacity-40 animate-ping" />
          </div>
          <div>
            <p className="font-display text-sm font-bold tracking-widest text-agro-text uppercase">
              SOLVE <span className="text-agro-green">.AI</span>
            </p>
            <p className="text-[9px] text-agro-muted-2 leading-tight tracking-wide">
              A inteligência que cultiva resultados
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-thin relative">
        <p className="text-[9px] font-semibold tracking-widest text-agro-muted-2 uppercase px-3 mb-3">
          Menu principal
        </p>

        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={true}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 relative",
                isActive
                  ? "text-white"
                  : "text-agro-muted hover:text-agro-text"
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Active background */}
                {isActive && (
                  <div className="absolute inset-0 rounded-xl"
                    style={{
                      background: "linear-gradient(135deg, rgba(63,176,108,0.2) 0%, rgba(22,163,74,0.12) 100%)",
                      border: "1px solid rgba(63,176,108,0.3)",
                      boxShadow: "0 0 20px rgba(63,176,108,0.1), inset 0 0 20px rgba(63,176,108,0.05)",
                    }}
                  />
                )}

                {/* Hover background */}
                {!isActive && (
                  <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.08)" }}
                  />
                )}

                {/* Icon */}
                <div className={cn(
                  "relative w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200",
                  isActive
                    ? "bg-agro-green text-white"
                    : "bg-agro-surface text-agro-muted-2 group-hover:text-agro-green group-hover:bg-agro-surface-2"
                )}>
                  <item.icon className="w-3.5 h-3.5" />
                  {isActive && (
                    <div className="absolute inset-0 rounded-lg glow-green-sm opacity-60" />
                  )}
                </div>

                <div className="relative min-w-0">
                  <p className={cn(
                    "text-sm font-medium leading-none transition-colors duration-200",
                    isActive ? "text-agro-text" : "text-agro-text-2 group-hover:text-agro-text"
                  )}>
                    {item.label}
                  </p>
                  <p className={cn(
                    "text-[10px] mt-0.5 truncate transition-colors duration-200",
                    isActive ? "text-agro-green" : "text-agro-muted-2"
                  )}>
                    {item.subtitle}
                  </p>
                </div>

                {/* Active indicator dot */}
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-agro-green shrink-0 glow-green-sm" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="relative px-3 py-4" style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
          style={{ background: "rgba(63,176,108,0.04)", border: "1px solid rgba(63,176,108,0.08)" }}
        >
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
            style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
          >
            WS
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-agro-text truncate">Workspace</p>
            <div className="flex items-center gap-1 mt-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-agro-green" />
              <p className="text-[10px] text-agro-green">Plano Pro — Ativo</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
