// Config salva em localStorage — sem .env necessário

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  workspaceId: string;
}

const KEY = "solve_ai_config";

export function getConfig(): AppConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppConfig;
    if (!parsed.supabaseUrl || !parsed.supabaseAnonKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(KEY, JSON.stringify(config));
}

export function clearConfig(): void {
  localStorage.removeItem(KEY);
}

export function isConfigured(): boolean {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (envUrl && envUrl !== "https://placeholder.supabase.co") return true;
  return getConfig() !== null;
}

/** Lê workspace_id: env var primeiro, depois localStorage */
export function getWorkspaceId(): string {
  const envWs = import.meta.env.VITE_WORKSPACE_ID as string | undefined;
  if (envWs) return envWs;
  return getConfig()?.workspaceId ?? "demo-workspace-id";
}

export function generateWorkspaceId(): string {
  return crypto.randomUUID();
}
