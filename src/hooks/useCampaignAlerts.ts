import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";


// Supabase Realtime garante INSERT mas pode perder UPDATE events.
// Polling de 30s garante que alertas atualizados apareçam mesmo sem o evento realtime.
const POLL_INTERVAL_MS = 30_000;

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
  const channelName = useRef(`campaign_alerts_${Math.random().toString(36).slice(2)}`);

  const fetchAlerts = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from("campaign_alerts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    setAlerts((data as CampaignAlert[]) ?? []);
    setLoading(false);
  }, [workspaceId]);

  // Fetch inicial
  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Realtime — captura INSERTs e UPDATEs instantaneamente quando o evento chega
  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel(channelName.current)
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

  // Polling de fallback — garante sincronização mesmo que o evento UPDATE
  // do Realtime não chegue (ex: alerta com conteúdo novo mas sem escalada de severidade)
  useEffect(() => {
    if (!workspaceId) return;
    const timer = setInterval(fetchAlerts, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [workspaceId, fetchAlerts]);

  const markAsRead = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    await supabase.from("campaign_alerts").update({ read_at: now }).eq("id", id);
    setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, read_at: now } : a));
  }, []);

  const markAllRead = useCallback(async () => {
    if (!workspaceId) return;
    const now = new Date().toISOString();
    await supabase
      .from("campaign_alerts")
      .update({ read_at: now })
      .eq("workspace_id", workspaceId)
      .is("read_at", null);
    setAlerts((prev) => prev.map((a) => ({ ...a, read_at: a.read_at ?? now })));
  }, [workspaceId]);

  const unreadCount = alerts.filter((a) => !a.read_at).length;

  return { alerts, loading, unreadCount, markAsRead, markAllRead };
}
