import { createContext, useContext, useEffect, useRef, useState } from "react";
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
  description: string | null;
  avatar_url: string | null;
  role: "admin" | "manager" | "agent";
  permissions: Partial<Record<PermissionKey, boolean>>;
  created_at: string;
  updated_at: string;
}

// Read hash once at module load, before Supabase clears it asynchronously
const INITIAL_HASH = typeof window !== "undefined" ? window.location.hash : "";

function detectSetupType(): "invite" | "recovery" | null {
  if (INITIAL_HASH.includes("type=invite"))   return "invite";
  if (INITIAL_HASH.includes("type=recovery")) return "recovery";
  return null;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  workspaceId: string | null;
  loading: boolean;
  setupType: "invite" | "recovery" | null;
  clearSetupType: () => void;
  updateProfile: (patch: Partial<Pick<UserProfile, "full_name" | "description" | "avatar_url">>) => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]               = useState<User | null>(null);
  const [profile, setProfile]         = useState<UserProfile | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [setupType, setSetupType]     = useState<"invite" | "recovery" | null>(detectSetupType);
  const fetchingRef                   = useRef(false); // mutex — prevents concurrent fetchProfile calls

  function updateProfile(patch: Partial<Pick<UserProfile, "full_name" | "description" | "avatar_url">>) {
    setProfile((prev) => prev ? { ...prev, ...patch } : prev);
  }

  function clearSetupType() {
    setSetupType(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function fetchProfile(userId: string): Promise<void> {
    // Prevent concurrent execution (onAuthStateChange + getSession both fire on startup)
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const [profileRes, wsRes] = await Promise.all([
        db.from("user_profiles").select("*").eq("id", userId).single(),
        // INNER JOIN with workspaces skips orphaned entries whose workspace was deleted.
        // ORDER BY created_at ensures deterministic result when user has multiple memberships.
        db.from("workspace_members")
          .select("workspace_id, workspaces!inner(id)")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      if (profileRes.data) setProfile(profileRes.data as UserProfile);

      if (wsRes.data?.workspace_id) {
        setWorkspaceId(wsRes.data.workspace_id as string);
        return;
      }

      // No valid workspace membership — check for a pending invite
      const userEmail = (await supabase.auth.getUser()).data.user?.email ?? "";
      const { data: invite } = await db
        .from("workspace_invites")
        .select("workspace_id, role, token")
        .eq("email", userEmail.toLowerCase())
        .is("accepted_at", null)
        .gte("expires_at", new Date().toISOString())
        .maybeSingle();

      if (invite?.workspace_id) {
        // Verify the target workspace actually exists before accepting
        const { data: wsExists } = await db
          .from("workspaces")
          .select("id")
          .eq("id", invite.workspace_id)
          .maybeSingle();

        if (!wsExists) {
          console.warn("[auth] invite workspace does not exist — access denied, signing out");
          await supabase.auth.signOut();
          return;
        }

        await db.from("workspace_members").insert({
          workspace_id: invite.workspace_id,
          user_id:      userId,
          role:         invite.role ?? "agent",
        });
        await db
          .from("workspace_invites")
          .update({ accepted_at: new Date().toISOString() })
          .eq("token", invite.token);
        setWorkspaceId(invite.workspace_id as string);
      } else {
        console.warn("[auth] no workspace and no valid invite — access denied, signing out");
        await supabase.auth.signOut();
      }
    } finally {
      fetchingRef.current = false;
    }
  }

  useEffect(() => {
    // getSession only controls the initial loading state.
    // fetchProfile is driven exclusively by onAuthStateChange to avoid concurrent calls.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id).finally(() => setLoading(false));
        } else {
          setProfile(null);
          setWorkspaceId(null);
          setLoading(false);
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
    setWorkspaceId(null);
  }

  return (
    <AuthContext.Provider value={{ user, profile, workspaceId, loading, setupType, clearSetupType, updateProfile, signIn, signOut }}>
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
