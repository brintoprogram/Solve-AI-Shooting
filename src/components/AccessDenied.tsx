import { Lock } from "lucide-react";
import { useAuth, ROLE_LABELS } from "@/context/AuthContext";
import type { PermissionKey } from "@/context/AuthContext";

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  can_shoot:            "Iniciar Disparos",
  can_manage_campaigns: "Gerenciar Campanhas",
  can_manage_contacts:  "Gerenciar Contatos",
  can_import:           "Importar Planilhas",
  can_inbox:            "Acessar Inbox",
  can_manage_team:      "Gerenciar Equipe",
  can_settings:         "Configurações",
  can_negotiations:     "Negociações",
};

interface AccessDeniedProps {
  feature: string;
  permission: PermissionKey | PermissionKey[];
}

export function AccessDenied({ feature, permission }: AccessDeniedProps) {
  const { profile } = useAuth();
  const perms = Array.isArray(permission) ? permission : [permission];
  const permLabels = perms.map((p) => PERMISSION_LABELS[p]).join(" ou ");
  const roleLabel = profile ? ROLE_LABELS[profile.role] : "—";

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[420px] text-center p-8">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
      >
        <Lock className="w-7 h-7 text-red-400" />
      </div>

      <h2 className="text-lg font-semibold text-white mb-2">Acesso restrito</h2>

      <p className="text-sm text-[#6b7f6e] max-w-sm leading-relaxed mb-4">
        Você não tem permissão para acessar{" "}
        <span className="text-white font-medium">{feature}</span>.
      </p>

      <div
        className="px-4 py-3 rounded-xl text-left max-w-sm w-full mb-6"
        style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}
      >
        <p className="text-[10px] font-semibold text-[#6b7f6e] uppercase tracking-widest mb-2">Detalhes</p>
        <div className="space-y-1.5 text-xs text-[#6b7f6e]">
          <div className="flex justify-between">
            <span>Seu cargo</span>
            <span className="text-white font-medium">{roleLabel}</span>
          </div>
          <div className="flex justify-between">
            <span>Permissão necessária</span>
            <span className="text-amber-400 font-medium">{permLabels}</span>
          </div>
        </div>
      </div>

      <p className="text-xs text-[#6b7f6e] max-w-xs">
        Peça a um <span className="text-white">Administrador</span> para ativar essa permissão no seu perfil em{" "}
        <strong className="text-[#3fb06c]">Equipe → Permissões</strong>.
      </p>
    </div>
  );
}
