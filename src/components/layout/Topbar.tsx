import { useState, useRef, useEffect } from "react";
import { Bell, ChevronRight, Settings, LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, ROLE_LABELS, initials } from "@/context/AuthContext";

interface TopbarProps {
  breadcrumbs: Array<{ label: string; href?: string }>;
}

export function Topbar({ breadcrumbs }: TopbarProps) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const avatarText = initials(profile?.full_name);
  const roleLabel  = profile ? ROLE_LABELS[profile.role] : null;

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    navigate("/login");
  }

  return (
    <header
      className="sticky top-0 z-40 h-14 flex items-center justify-between px-6"
      style={{
        background: "rgba(10,17,14,0.85)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(63,176,108,0.08)",
      }}
    >
      {/* Left: logo + breadcrumb */}
      <div className="flex items-center gap-3">
        <Link to="/" className="shrink-0 flex items-center">
          <img
            src="/logo.png"
            alt="Solve AI"
            className="h-9 w-auto object-contain"
            style={{ filter: "drop-shadow(0 0 8px rgba(63,176,108,0.3))" }}
          />
        </Link>

        <div
          className="h-5 w-px shrink-0"
          style={{ background: "rgba(63,176,108,0.15)" }}
        />

        <nav className="flex items-center gap-1.5">
          {breadcrumbs.map((crumb, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-agro-muted-2" />}
              <span className={
                i === breadcrumbs.length - 1
                  ? "text-sm font-semibold text-agro-text"
                  : "text-sm text-agro-muted-2"
              }>
                {crumb.label}
              </span>
            </div>
          ))}
        </nav>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        {/* Bell */}
        <button
          className="relative w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors duration-200"
          style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-agro-green glow-green-sm" />
        </button>

        {/* Avatar + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white transition-all duration-200"
            style={{
              background: "linear-gradient(135deg, #3fb06c, #16A34A)",
              outline: open ? "2px solid rgba(63,176,108,0.5)" : "2px solid transparent",
              outlineOffset: 2,
            }}
          >
            {avatarText}
          </button>

          {open && (
            <div
              className="absolute right-0 top-10 w-52 rounded-xl overflow-hidden z-50"
              style={{
                background: "#0d1a11",
                border: "1px solid rgba(63,176,108,0.2)",
                boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
              }}
            >
              {/* Header */}
              <div
                className="px-4 py-3"
                style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
              >
                <p className="text-sm font-semibold text-agro-text truncate">
                  {profile?.full_name ?? "Usuário"}
                </p>
                {roleLabel && (
                  <p className="text-[11px] text-agro-muted-2 mt-0.5">{roleLabel}</p>
                )}
              </div>

              {/* Menu items */}
              <div className="py-1.5">
                <Link
                  to="/settings"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-agro-muted hover:text-agro-text hover:bg-white/5 transition-colors duration-150"
                >
                  <Settings className="w-3.5 h-3.5 shrink-0" />
                  Meu Perfil
                </Link>

                <div style={{ borderTop: "1px solid rgba(63,176,108,0.06)" }} className="mt-1 pt-1">
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-400 hover:bg-red-400/10 transition-colors duration-150"
                  >
                    <LogOut className="w-3.5 h-3.5 shrink-0" />
                    Sair
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
