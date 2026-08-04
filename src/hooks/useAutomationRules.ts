import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { AutomationRule } from "@/types/automations";

export function useAutomationRules(workspaceId: string) {
  const [rules,   setRules]   = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const { data } = await supabase
      .from("automation_rules")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    setRules((data as AutomationRule[]) ?? []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id: string, status: AutomationRule["status"]): Promise<string | null> {
    const { error } = await supabase
      .from("automation_rules")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return error.message;
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
    return null;
  }

  async function deleteRule(id: string): Promise<string | null> {
    const { data, error } = await supabase
      .from("automation_rules")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return error.message;
    if (!data?.length) return "Régua não encontrada ou sem permissão para excluir.";
    setRules((prev) => prev.filter((r) => r.id !== id));
    return null;
  }

  return { rules, loading, refetch: load, updateStatus, deleteRule };
}
