import { NavLink } from "react-router-dom";
import { LayoutDashboard, Zap, MessageSquare, Users, Settings } from "lucide-react";

const NAV_ITEMS = [
  { to: "/",         icon: LayoutDashboard, label: "Home"      },
  { to: "/shooting", icon: Zap,             label: "Disparos"  },
  { to: "/inbox",    icon: MessageSquare,   label: "Inbox"     },
  { to: "/contacts", icon: Users,           label: "Contatos"  },
  { to: "/settings", icon: Settings,        label: "Config"    },
];

export function MobileBottomNav() {
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around"
      style={{
        height: "64px",
        background: "#0d1a11",
        borderTop: "1px solid rgba(63,176,108,0.1)",
        backdropFilter: "blur(12px)",
      }}
    >
      {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-4 py-1 rounded-xl transition-colors ${
              isActive ? "text-[#3fb06c]" : "text-[#6b8a75]"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="w-5 h-5" style={isActive ? { filter: "drop-shadow(0 0 6px rgba(63,176,108,0.5))" } : {}} />
              <span className="text-[10px] font-medium">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
