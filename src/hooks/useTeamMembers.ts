import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { UserProfile } from "@/context/AuthContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Fetches all user_profiles ordered by name.
 * Admin/manager see everyone (RLS allows it).
 * Agents see only themselves — the dropdown simply won't render for them.
 */
export function useTeamMembers(): UserProfile[] {
  const [members, setMembers] = useState<UserProfile[]>([]);

  useEffect(() => {
    db.from("user_profiles")
      .select("id, full_name, role")
      .order("full_name", { ascending: true })
      .then(({ data }: { data: UserProfile[] | null }) => {
        setMembers(data ?? []);
      });
  }, []);

  return members;
}
