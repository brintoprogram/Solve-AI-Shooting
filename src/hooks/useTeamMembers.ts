import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import type { UserProfile } from "@/context/AuthContext";


export function useTeamMembers(): UserProfile[] {
  const { workspaceId } = useAuth();
  const [members, setMembers] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!workspaceId) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function load() {
      const { data: wm } = await supabase
        .from("workspace_members")
        .select("user_id, role")
        .eq("workspace_id", workspaceId);

      if (!wm?.length) return;

      const userIds = (wm as any[]).map((m: any) => m.user_id);
      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("id, full_name")
        .in("id", userIds);

      const result = (profiles ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any) => ({
          ...p,
          // Use the workspace-specific role, not the global profile role
          role: (wm as any[]).find((m: any) => m.user_id === p.id)?.role ?? "agent",
        }))
        .sort((a: UserProfile, b: UserProfile) =>
          (a.full_name ?? "").localeCompare(b.full_name ?? "")
        );

      setMembers(result as UserProfile[]);
    }

    load();
  }, [workspaceId]);

  return members;
}
