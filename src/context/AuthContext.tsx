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

export interface WorkspaceInfo {
  id:   string;
  name: string;
  role: "admin" | "manager" | "agent";
}

// localStorage key — workspace preference per browser
const WS_STORAGE_KEY = "solve_ai_active_workspace";

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
  workspaces: WorkspaceInfo[];
  switchWorkspace: (id: string) => void;
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
  const [workspaces, setWorkspaces]   = useState<WorkspaceInfo[]>([]);
  const [loading, setLoading]         = useState(true);
  const [setupType, setSetupType]     = useState<"invite" | "recovery" | null>(detectSetupType);
  const fetchingRef                   = useRef(false); // mutex — prevents concurrent fetchProfile calls
  const setupTypeRef                  = useRef<"invite" | "recovery" | null>(detectSetupType());

  function setSetupTypeWithRef(type: "invite" | "recovery" | null) {
    setupTypeRef.current = type;
    setSetupType(type);
  }

  function updateProfile(patch: Partial<Pick<UserProfile, "full_name" | "description" | "avatar_url">>) {
    setProfile((prev) => prev ? { ...prev, ...patch } : prev);
  }

  function clearSetupType() {
    setupTypeRef.current = null;
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
        // Fetch ALL workspaces the user belongs to (INNER JOIN skips deleted workspaces).
        // No LIMIT — a user may legitimately belong to multiple workspaces.
        db.from("workspace_members")
          .select("workspace_id, role, workspaces!inner(id, name)")
          .eq("user_id", userId)
          .order("created_at", { ascending: true }),
      ]);
      if (profileRes.data) setProfile(profileRes.data as UserProfile);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wsList: WorkspaceInfo[] = ((wsRes.data ?? []) as any[]).map((m) => ({
        id:   m.workspace_id as string,
        name: (m.workspaces as { name: string }).name,
        role: m.role as WorkspaceInfo["role"],
      }));
      setWorkspaces(wsList);

      if (wsList.length > 0) {
        // Validate the stored workspace preference against the DB-sourced list.
        // This is the security gate — arbitrary values from localStorage are ignored
        // if they don't correspond to an actual membership in the database.
        const stored = localStorage.getItem(WS_STORAGE_KEY);
        const valid  = wsList.find((w) => w.id === stored);
        setWorkspaceId((valid ?? wsList[0]).id);
        return;
      }

      // No valid workspace membership — check for a pending invite.
      // Accept NULL expires_at (no explicit expiry set) OR a future expiry date.
      const userEmail = (await supabase.auth.getUser()).data.user?.email ?? "";
      const now = new Date().toISOString();
      const { data: invite } = await db
        .from("workspace_invites")
        .select("workspace_id, role, token")
        .eq("email", userEmail.toLowerCase())
        .is("accepted_at", null)
        .or(`expires_at.is.null,expires_at.gte.${now}`)
        .maybeSingle();

      if (invite?.workspace_id) {
        // Insert into workspace_members FIRST — the RLS on the workspaces table
        // requires membership to read, so we must become a member before querying.
        const { error: memberErr } = await db.from("workspace_members").insert({
          workspace_id: invite.workspace_id,
          user_id:      userId,
          role:         invite.role ?? "agent",
        });

        const alreadyMember = memberErr?.code === "23505"; // duplicate key = already a member
        if (memberErr && !alreadyMember) {
          // A real error (e.g. FK violation = workspace deleted) — abort
          console.warn("[auth] failed to accept workspace invite:", memberErr.message);
          await supabase.auth.signOut();
          return;
        }

        await db
          .from("workspace_invites")
          .update({ accepted_at: new Date().toISOString() })
          .eq("token", invite.token);

        // Now that user is a member, RLS allows reading the workspace name
        const { data: wsData } = await db
          .from("workspaces")
          .select("id, name")
          .eq("id", invite.workspace_id)
          .maybeSingle();

        const accepted: WorkspaceInfo = {
          id:   invite.workspace_id as string,
          name: wsData?.name ?? "Workspace",
          role: (invite.role ?? "agent") as WorkspaceInfo["role"],
        };
        setWorkspaces([accepted]);
        setWorkspaceId(accepted.id);
      } else {
        // If we're in an invite/recovery password-setup flow, don't sign out —
        // the user needs their session active to call updateUser({ password }).
        // After they set the password, clearSetupType() triggers a re-render and
        // fetchProfile runs again to pick up the workspace membership.
        if (setupTypeRef.current !== null) {
          console.warn("[auth] setup flow — keeping session alive for password setup");
          return;
        }
        console.warn("[auth] no workspace and no valid invite — access denied, signing out");
        await supabase.auth.signOut();
      }
    } finally {
      fetchingRef.current = false;
    }
  }

  function switchWorkspace(id: string) {
    // Only allows switching to a workspace that was returned by the DB query.
    // Any ID injected via browser console that isn't in this list is silently rejected.
    // Even if bypassed, the Supabase RLS function is_workspace_member() blocks all queries
    // to workspaces the authenticated user is not a member of at the database level.
    const target = workspaces.find((w) => w.id === id);
    if (!target) return;
    localStorage.setItem(WS_STORAGE_KEY, id);
    setWorkspaceId(id);
    // Full reload clears all in-memory caches (React state, query results, etc.)
    window.location.reload();
  }

  useEffect(() => {
    // For PKCE invite flows: the invite link contains ?code=xxx in the URL.
    // supabase-js exchanges the code automatically via detectSessionInUrl, but
    // server-initiated invites have no stored PKCE verifier in the browser.
    // Explicitly calling exchangeCodeForSession ensures the exchange is attempted
    // even without a stored verifier (Supabase accepts this for invite flows).
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).catch(() => {
        // Silently ignore — onAuthStateChange will fire (or not) based on the result
      });
    }

    // getSession only controls the initial loading state.
    // fetchProfile is driven exclusively by onAuthStateChange to avoid concurrent calls.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Detect setup flows via event — works for both PKCE and implicit
        if (event === "PASSWORD_RECOVERY") {
          setSetupTypeWithRef("recovery");
        } else if (
          event === "SIGNED_IN" &&
          session?.user?.user_metadata?.workspace_invite_token
        ) {
          setSetupTypeWithRef("invite");
        }

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
    <AuthContext.Provider value={{ user, profile, workspaceId, workspaces, switchWorkspace, loading, setupType, clearSetupType, updateProfile, signIn, signOut }}>
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
    can_shoot:            true,
    can_manage_campaigns: false,
    can_manage_contacts:  false,
    can_import:           false,
    can_inbox:            true,
    can_manage_team:      true,
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
