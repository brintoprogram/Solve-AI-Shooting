import { useState, useRef, useEffect, useCallback } from "react";
import { Bell, ChevronRight, Settings, LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, ROLE_LABELS, initials } from "@/context/AuthContext";
import { useCampaignAlerts } from "@/hooks/useCampaignAlerts";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { supabase } from "@/lib/supabase";

type PresenceStatus = "online" | "busy" | "offline";

const PRESENCE: Record<PresenceStatus, { label: string; color: string; dot: string }> = {
  online:  { label: "Disponível", color: "#3fb06c", dot: "#3fb06c" },
  busy:    { label: "Ocupado",    color: "#fbbf24", dot: "#fbbf24" },
  offline: { label: "Ausente",    color: "#6b7f6e", dot: "#6b7f6e" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface TopbarProps {
  breadcrumbs: Array<{ label: string; href?: string }>;
}

export function Topbar({ breadcrumbs }: TopbarProps) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [presence, setPresence] = useState<PresenceStatus>("offline");
  const [savingPresence, setSavingPresence] = useState(false);

  const avatarText = initials(profile?.full_name);
  const roleLabel  = profile ? ROLE_LABELS[profile.role] : null;
  const { unreadCount } = useCampaignAlerts();

  const loadPresence = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await db.from("user_profiles").select("presence_status").eq("id", profile.id).single();
    if (data?.presence_status) setPresence(data.presence_status as PresenceStatus);
  }, [profile?.id]);

  useEffect(() => { loadPresence(); }, [loadPresence]);

  async function handlePresence(status: PresenceStatus) {
    if (!profile?.id || savingPresence) return;
    setSavingPresence(true);
    setPresence(status);
    await db.from("user_profiles").update({ presence_status: status }).eq("id", profile.id);
    setSavingPresence(false);
  }

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
        {/* Workspace switcher — only visible when user belongs to 2+ workspaces */}
        <WorkspaceSwitcher />

        {/* Bell */}
        <button
          onClick={() => navigate("/alerts")}
          className="relative w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors duration-200"
          style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {/* Avatar + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white transition-all duration-200 overflow-visible"
            style={{
              background: profile?.avatar_url ? "transparent" : "linear-gradient(135deg, #3fb06c, #16A34A)",
              outline: open ? "2px solid rgba(63,176,108,0.5)" : "2px solid transparent",
              outlineOffset: 2,
            }}
          >
            <span className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden"
              style={{ background: profile?.avatar_url ? "transparent" : "linear-gradient(135deg,#3fb06c,#16A34A)" }}>
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={profile?.full_name ?? "Avatar"} className="w-full h-full object-cover" />
              ) : avatarText}
            </span>
            {/* Presence dot */}
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
              style={{ background: PRESENCE[presence].dot, borderColor: "#0a110e" }} />
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
              <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
                <p className="text-sm font-semibold text-agro-text truncate">{profile?.full_name ?? "Usuário"}</p>
                {roleLabel && <p className="text-[11px] text-agro-muted-2 mt-0.5">{roleLabel}</p>}

                {/* Presence selector */}
                <div className="flex items-center gap-1 mt-2">
                  {(Object.entries(PRESENCE) as [PresenceStatus, typeof PRESENCE[PresenceStatus]][]).map(([key, val]) => (
                    <button key={key} onClick={() => handlePresence(key)} disabled={savingPresence}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all disabled:opacity-50"
                      style={presence === key
                        ? { background: val.color + "20", color: val.color, border: `1px solid ${val.color}50` }
                        : { background: "rgba(0,0,0,0.2)", color: "#6b7f6e", border: "1px solid rgba(63,176,108,0.08)" }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: val.color }} />
                      {val.label}
                    </button>
                  ))}
                </div>
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
