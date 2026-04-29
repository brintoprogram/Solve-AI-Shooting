import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import type { UserProfile } from "@/context/AuthContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useTeamMembers(): UserProfile[] {
  const { workspaceId } = useAuth();
  const [members, setMembers] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    db.from("workspace_members")
      .select("role, user_profiles!inner(id, full_name)")
      .eq("workspace_id", workspaceId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: { data: any[] | null }) => {
        const profiles = (data ?? [])
          .map((m: any) => ({ ...m.user_profiles, role: m.role }))
          .sort((a: UserProfile, b: UserProfile) =>
            (a.full_name ?? "").localeCompare(b.full_name ?? "")
          );
        setMembers(profiles);
      });
  }, [workspaceId]);

  return members;
}
