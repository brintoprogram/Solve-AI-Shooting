import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getConfig } from "./config";

function resolveCredentials() {
  // 1. Tenta variáveis de ambiente (Vercel)
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (envUrl && envKey && envUrl !== "https://placeholder.supabase.co") {
    return { url: envUrl, key: envKey };
  }
  // 2. Tenta localStorage (Setup Wizard)
  const cfg = getConfig();
  if (cfg) {
    return { url: cfg.supabaseUrl, key: cfg.supabaseAnonKey };
  }
  // 3. Placeholder — app carrega mas sem funcionalidade de banco
  return {
    url: "https://placeholder.supabase.co",
    key: "placeholder",
  };
}

const { url, key } = resolveCredentials();

export const supabase: SupabaseClient<Database> = createClient<Database>(
  url,
  key,
  {
    realtime: { params: { eventsPerSecond: 10 } },
  }
);

/** Cria um cliente temporário com credenciais específicas (usado no Setup) */
export function createTempClient(supabaseUrl: string, supabaseAnonKey: string) {
  return createClient(supabaseUrl, supabaseAnonKey);
}

export async function getCurrentWorkspaceId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Usuário não autenticado");

  const { data, error: wsError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (wsError || !data) throw new Error("Workspace não encontrado");
  return data.workspace_id;
}
