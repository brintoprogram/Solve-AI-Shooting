import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface CampaignAlert {
  id:              string;
  workspace_id:    string;
  campaign_id:     string;
  message_id:      string;
  conversation_id: string | null;
  recipient_phone: string;
  recipient_name:  string | null;
  reply_text:      string;
  severity:        "info" | "warning" | "critical";
  category:        string;
  summary:         string;
  read_at:         string | null;
  created_at:      string;
}

export function useCampaignAlerts() {
  const { workspaceId } = useAuth();
  const [alerts,  setAlerts]  = useState<CampaignAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await db
      .from("campaign_alerts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    setAlerts((data as CampaignAlert[]) ?? []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel("campaign_alerts_rt")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on("postgres_changes" as any, {
        event:  "*",
        schema: "public",
        table:  "campaign_alerts",
        filter: `workspace_id=eq.${workspaceId}`,
      }, () => { fetchAlerts(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [workspaceId, fetchAlerts]);

  const markAsRead = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    await db.from("campaign_alerts").update({ read_at: now }).eq("id", id);
    setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, read_at: now } : a));
  }, []);

  const markAllRead = useCallback(async () => {
    if (!workspaceId) return;
    const now = new Date().toISOString();
    await db
      .from("campaign_alerts")
      .update({ read_at: now })
      .eq("workspace_id", workspaceId)
      .is("read_at", null);
    setAlerts((prev) => prev.map((a) => ({ ...a, read_at: a.read_at ?? now })));
  }, [workspaceId]);

  const unreadCount = alerts.filter((a) => !a.read_at).length;

  return { alerts, loading, unreadCount, markAsRead, markAllRead };
}
