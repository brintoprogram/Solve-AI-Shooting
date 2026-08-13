// O mapa de navegação, em um lugar só.
//
// Existia duas vezes: uma lista completa dentro da Sidebar e uma lista curta,
// escrita à mão, dentro do MobileBottomNav. A segunda não sabia de permissões
// e não sabia quando a primeira crescia — então Relacionamento, Negociações,
// Créditos, Atividade e, principalmente, EQUIPE nasceram invisíveis no
// celular. Quem abria pelo telefone não tinha como convidar ninguém.
//
// Duplicar um menu não falha na hora em que é duplicado. Falha meses depois,
// no dia em que alguém adiciona uma tela e só metade do sistema fica sabendo.
// Por isso o mapa mora aqui e ninguém mais declara destino.

import {
  Coins, Send, Settings, LayoutDashboard, Users, MessageSquare, Zap, UserCog,
  LayoutTemplate, Bell, BarChart2, LifeBuoy, History, Bot, Rocket, Handshake,
  BookOpen, Cake, Presentation,
} from "lucide-react";
import { hasPermission } from "@/context/AuthContext";
import type { PermissionKey, UserProfile } from "@/context/AuthContext";

export interface NavItem {
  to: string;
  /* style entra no tipo porque a barra do celular aplica brilho no item
     ativo. Sem ele o icone nao aceita a prop e o realce nao compila. */
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  subtitle: string;
  permission?: PermissionKey | PermissionKey[]; // undefined = acessível a todos
}

/* Os 15 destinos numa lista unica exigiam ler todos para achar um. Agrupados
   por TAREFA — o que a pessoa esta fazendo — em vez de por tipo tecnico. */
export interface NavGroup {
  id:    string;
  label: string;
  itens: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "inicio",
    label: "Visão geral",
    itens: [
      { to: "/primeiros-passos",  icon: Rocket,          label: "Primeiros passos", subtitle: "Configuração do workspace" },
      { to: "/tutoriais",         icon: BookOpen,        label: "Tutoriais",    subtitle: "Como configurar cada parte" },
      { to: "/",                  icon: LayoutDashboard, label: "Dashboard",    subtitle: "Visão geral"            },
      { to: "/contacts",          icon: Users,           label: "Contatos",     subtitle: "Base de clientes",      permission: "can_manage_contacts" },
    ],
  },
  {
    id: "atendimento",
    label: "Atendimento",
    itens: [
      { to: "/inbox",             icon: MessageSquare,   label: "Inbox",        subtitle: "Conversas ativas",      permission: "can_inbox" },
      { to: "/alerts",            icon: Bell,            label: "Alertas",      subtitle: "Respostas dos clientes" },
      { to: "/negotiations",      icon: Handshake,       label: "Negociações",  subtitle: "Renegociação de dívidas", permission: "can_negotiations" },
      { to: "/agents",            icon: Bot,             label: "Agentes",      subtitle: "IA por conversa",       permission: "can_settings" },
    ],
  },
  {
    id: "campanhas",
    label: "Campanhas",
    itens: [
      { to: "/shooting",          icon: Send,            label: "Shooting",     subtitle: "Disparos WhatsApp",     permission: ["can_shoot", "can_manage_campaigns"] },
      { to: "/templates",         icon: LayoutTemplate,  label: "Templates",    subtitle: "Templates WhatsApp"     },
      { to: "/automations",       icon: Zap,             label: "Automações",   subtitle: "Fluxos inteligentes"    },
      { to: "/relacionamento",    icon: Cake,            label: "Relacionamento", subtitle: "Aniversário e datas"  },
      { to: "/reports",           icon: BarChart2,       label: "Relatórios",   subtitle: "Campanhas & auditoria"  },
    ],
  },
  {
    id: "conta",
    label: "Conta",
    itens: [
      { to: "/creditos",          icon: Coins,           label: "Créditos",     subtitle: "Saldo e consumo"        },
      { to: "/team",              icon: UserCog,         label: "Equipe",       subtitle: "Agentes & convites",    permission: "can_manage_team" },
      { to: "/settings",          icon: Settings,        label: "Configurações",subtitle: "Conta e integrações",   permission: "can_settings" },
      { to: "/atividade",         icon: History,         label: "Atividade",    subtitle: "Quem mudou o quê",      permission: "can_settings" },
      { to: "/support",           icon: LifeBuoy,        label: "Suporte",      subtitle: "Tickets e ajuda"        },
    ],
  },
];

/* Fora do NAV_GROUPS porque é condicional — só aparece no workspace de demo. */
export const DEMO_ITEM: NavItem = {
  to: "/demos", icon: Presentation, label: "Demonstrações", subtitle: "Para mostrar em reunião",
};

export function isAllowed(profile: UserProfile | null, item: NavItem): boolean {
  if (!item.permission) return true;
  const perms = Array.isArray(item.permission) ? item.permission : [item.permission];
  return perms.some((p) => hasPermission(profile, p));
}

/** Os grupos com o item de demonstração inserido e o que a pessoa não pode
 *  acessar removido. Um grupo que fica vazio some — no celular não há espaço
 *  para cabeçalho de seção sem nada embaixo. */
export function gruposVisiveis(profile: UserProfile | null, incluirDemo: boolean): NavGroup[] {
  return NAV_GROUPS
    .map((g) => {
      const itens = g.id === "inicio" && incluirDemo
        ? [...g.itens.slice(0, 2), DEMO_ITEM, ...g.itens.slice(2)]
        : g.itens;
      return { ...g, itens: itens.filter((i) => isAllowed(profile, i)) };
    })
    .filter((g) => g.itens.length > 0);
}
