import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase: SupabaseClient<Database> = createClient<Database>(
  url,
  key,
  {
    auth: { detectSessionInUrl: true },
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
