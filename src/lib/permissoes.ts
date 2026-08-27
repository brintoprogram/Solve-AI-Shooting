// A lista de permissões, num lugar só.
//
// Ela é usada na tela Equipe (editar quem já entrou) e no link de convite
// (decidir o que a pessoa recebe ao entrar). Duas cópias da mesma lista
// divergiriam na primeira permissão nova — e divergência numa lista de
// permissão não aparece como erro: aparece como alguém sem acesso que deveria
// ter, ou com acesso que não deveria.

import {
  Send, LayoutGrid, Users, Upload, MessageSquare, UserCog, Settings, Handshake,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PermissionKey } from "@/context/AuthContext";

export interface FeatureDef {
  key:   PermissionKey;
  label: string;
  desc:  string;
  icon:  LucideIcon;
}

export const FEATURE_DEFS: FeatureDef[] = [
  { key: "can_shoot",            label: "Iniciar Disparos",    desc: "Iniciar e retomar campanhas de disparo em massa",     icon: Send          },
  { key: "can_manage_campaigns", label: "Gerenciar Campanhas", desc: "Criar, pausar e cancelar campanhas",                  icon: LayoutGrid    },
  { key: "can_manage_contacts",  label: "Gerenciar Contatos",  desc: "Criar, editar e excluir contatos e boletos",          icon: Users         },
  { key: "can_import",           label: "Importar Planilhas",  desc: "Importar contatos em massa via CSV/Excel",            icon: Upload        },
  { key: "can_inbox",            label: "Acessar Inbox",       desc: "Ver e responder conversas no Inbox",                  icon: MessageSquare },
  { key: "can_negotiations",     label: "Negociações",         desc: "Ver e conduzir negociações de dívida",                icon: Handshake     },
  { key: "can_manage_team",      label: "Gerenciar Equipe",    desc: "Convidar membros e alterar cargos",                   icon: UserCog       },
  { key: "can_settings",         label: "Configurações",       desc: "Acessar e editar configurações do sistema",           icon: Settings      },
];
