import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export interface ZApiConnection {
  id: string;
  workspace_id: string;
  name: string;
  instance_id: string;
  token: string;
  client_token: string;
  status: "connected" | "disconnected" | "banned";
  phone: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export function useZApiConnections(workspaceId: string) {
  const [connections, setConnections] = useState<ZApiConnection[]>([]);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("z_api_connections")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    setConnections((data as ZApiConnection[]) ?? []);
    setLoading(false);
  }

  async function deleteConnection(id: string) {
    await supabase.from("z_api_connections").delete().eq("id", id);
    setConnections((prev) => prev.filter((c) => c.id !== id));
  }

  return { connections, loading, deleteConnection, refetch: load };
}
