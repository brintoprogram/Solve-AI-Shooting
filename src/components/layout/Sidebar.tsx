import { NavLink } from "react-router-dom";
import {
  Send,
  History,
  Settings,
  LayoutDashboard,
  Users,
  MessageSquare,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  subtitle: string;
}

const navItems: NavItem[] = [
  {
    to: "/",
    icon: LayoutDashboard,
    label: "Dashboard",
    subtitle: "Visão geral",
  },
  {
    to: "/shooting",
    icon: Send,
    label: "Shooting",
    subtitle: "Disparos WhatsApp",
  },
  {
    to: "/shooting/history",
    icon: History,
    label: "Histórico",
    subtitle: "Campanhas anteriores",
  },
  {
    to: "/contacts",
    icon: Users,
    label: "Contatos",
    subtitle: "Base de clientes",
  },
  {
    to: "/inbox",
    icon: MessageSquare,
    label: "Inbox",
    subtitle: "Conversas ativas",
  },
  {
    to: "/automations",
    icon: Zap,
    label: "Automações",
    subtitle: "Fluxos inteligentes",
  },
  {
    to: "/settings",
    icon: Settings,
    label: "Configurações",
    subtitle: "Conta e integrações",
  },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-white border-r border-gray-200 flex flex-col z-30">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
            <Send className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 tracking-wide">SOLVE .AI</p>
            <p className="text-[10px] text-gray-400 leading-tight">A inteligência que cultiva resultados</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-thin">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group",
                isActive
                  ? "bg-green-500 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn(
                    "w-4 h-4 shrink-0",
                    isActive ? "text-white" : "text-gray-400 group-hover:text-gray-600"
                  )}
                />
                <div className="min-w-0">
                  <p className={cn("text-sm font-medium leading-none", isActive ? "text-white" : "text-gray-900")}>
                    {item.label}
                  </p>
                  <p className={cn("text-xs mt-0.5 truncate", isActive ? "text-green-100" : "text-gray-400")}>
                    {item.subtitle}
                  </p>
                </div>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
            <span className="text-xs font-semibold text-green-700">WS</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-900 truncate">Workspace</p>
            <p className="text-xs text-gray-400 truncate">Plano Pro</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
