import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// ── Permission keys ───────────────────────────────────────
export type PermissionKey =
  | "can_shoot"
  | "can_manage_campaigns"
  | "can_manage_contacts"
  | "can_import"
  | "can_inbox"
  | "can_manage_team"
  | "can_settings";

export interface UserProfile {
  id: string;
  full_name: string | null;
  role: "admin" | "manager" | "agent";
  permissions: Partial<Record<PermissionKey, boolean>>;
  created_at: string;
  updated_at: string;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProfile(userId: string): Promise<void> {
    const { data } = await db
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) setProfile(data as UserProfile);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

// ── Default permissions per role ──────────────────────────
export const DEFAULT_PERMISSIONS: Record<UserProfile["role"], Record<PermissionKey, boolean>> = {
  admin: {
    can_shoot:            true,
    can_manage_campaigns: true,
    can_manage_contacts:  true,
    can_import:           true,
    can_inbox:            true,
    can_manage_team:      true,
    can_settings:         true,
  },
  manager: {
    can_shoot:            true,
    can_manage_campaigns: true,
    can_manage_contacts:  true,
    can_import:           true,
    can_inbox:            true,
    can_manage_team:      false,
    can_settings:         false,
  },
  agent: {
    can_shoot:            false,
    can_manage_campaigns: false,
    can_manage_contacts:  false,
    can_import:           false,
    can_inbox:            true,
    can_manage_team:      false,
    can_settings:         false,
  },
};

/** Check if a profile has a given permission. Admins always pass. */
export function hasPermission(profile: UserProfile | null, key: PermissionKey): boolean {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  const override = profile.permissions?.[key];
  if (override !== undefined) return override;
  return DEFAULT_PERMISSIONS[profile.role][key] ?? false;
}

// ── Role helpers ──────────────────────────────────────────
export const ROLE_LABELS: Record<UserProfile["role"], string> = {
  admin:   "Admin",
  manager: "Gerente",
  agent:   "Agente",
};

export const ROLE_STYLE: Record<
  UserProfile["role"],
  { color: string; bg: string; border: string }
> = {
  admin:   { color: "#60a5fa", bg: "rgba(59,130,246,0.12)",  border: "rgba(59,130,246,0.3)"  },
  manager: { color: "#3fb06c", bg: "rgba(63,176,108,0.12)",  border: "rgba(63,176,108,0.3)"  },
  agent:   { color: "#9ca3af", bg: "rgba(107,114,128,0.12)", border: "rgba(107,114,128,0.3)" },
};

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
