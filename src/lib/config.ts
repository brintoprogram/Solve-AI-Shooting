// Config salva em localStorage — fallback para quando as variáveis VITE_* não
// estão definidas no build.
//
// Nota: as funções de escrita (saveConfig/clearConfig/isConfigured/
// getWorkspaceId/generateWorkspaceId) foram removidas junto com a tela
// Setup.tsx, que era a única consumidora. O fluxo de configuração inicial hoje
// é o Onboarding.tsx. Restou apenas a leitura, usada por Templates.tsx e
// TemplateBuilder.tsx para montar a URL das edge functions.

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
