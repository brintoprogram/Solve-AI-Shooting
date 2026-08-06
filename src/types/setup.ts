// Definição dos passos de configuração do workspace.
//
// O conteúdo de tutorial vive aqui (não espalhado nos componentes) para que
// adicionar um passo novo seja acrescentar um objeto nesta lista — e para que
// o texto possa ser revisto sem tocar em React.

export type StepStatus =
  | "done"      // detectado como concluído
  | "pending"   // ainda não feito
  | "waiting"   // depende de terceiro (ex.: Meta aprovar template)
  | "attention"; // feito, mas com problema (ex.: token expirado)

/** Quanto o passo pesa para o workspace ser operável. */
export type StepWeight = "blocker" | "important" | "optional";

export interface SetupStep {
  id:        string;
  title:     string;
  /** Uma linha: o que este passo entrega. */
  summary:   string;
  weight:    StepWeight;
  /** Ícone lucide-react (nome). */
  icon:      string;
  /** Para onde o botão principal leva. */
  route?:    string;
  routeLabel?: string;
  /** Link externo quando a ação acontece fora do app (painel da Meta, Z-API…). */
  external?: { url: string; label: string };

  // ── Conteúdo do tutorial ──────────────────────────────────────
  /** Por que isto existe — em linguagem de negócio, não técnica. */
  why:       string;
  /** O que ter em mãos ANTES de começar. Evita começar e travar no meio. */
  requires:  string[];
  /** Passo a passo. */
  how:       string[];
  /** Armadilhas reais que fazem a pessoa perder tempo. */
  gotchas?:  string[];
  /** Quanto tempo leva, incluindo espera de terceiros. */
  eta?:      string;
}

export interface StepState {
  status: StepStatus;
  /** Texto curto ao lado do item: "250 contatos", "há 2 dias", "token expirado". */
  detail?: string;
}

export const SETUP_STEPS: SetupStep[] = [
  {
    id: "channel",
    title: "Conectar um canal de WhatsApp",
    summary: "Liga o número da empresa ao sistema",
    weight: "blocker",
    icon: "Smartphone",
    route: "/onboarding",
    routeLabel: "Conectar pela Meta",
    why:
      "É por este número que as mensagens entram e saem. Sem canal conectado não existe " +
      "Inbox, disparo nem negociação — o sistema fica sem porta de entrada.",
    requires: [
      "Uma conta no Facebook Business (Meta Business Suite)",
      "Um número de telefone que NÃO esteja em uso no app WhatsApp comum",
      "Cartão de crédito cadastrado na Meta (a Meta cobra por conversa)",
    ],
    how: [
      "Escolha a via oficial (Meta) sempre que possível: é a única homologada e não corre risco de bloqueio.",
      "Clique em 'Conectar pela Meta' e siga o popup do Facebook até o fim, sem fechar.",
      "Selecione (ou crie) a conta WhatsApp Business e o número.",
      "Ao voltar, o número aparece em Configurações → WhatsApp com status 'Ativo'.",
      "Alternativa não oficial: Z-API, em Configurações → WhatsApp → Z-API. Serve para testes e números pessoais, mas pode ser bloqueada pelo WhatsApp.",
    ],
    gotchas: [
      "Se o número já estiver registrado no app WhatsApp comum, é preciso apagá-lo de lá antes — a Meta recusa o registro.",
      "Contas Business recém-criadas costumam ter limite de 250 conversas/dia até passarem pela verificação.",
    ],
    eta: "10–20 min (mais a verificação da Meta, que pode levar dias)",
  },
  {
    id: "webhook",
    title: "Receber a primeira mensagem",
    summary: "Confirma que o webhook está entregando",
    weight: "blocker",
    icon: "Webhook",
    route: "/settings",
    routeLabel: "Ver URLs do webhook",
    why:
      "Conectar o número não basta: a Meta (ou a Z-API) precisa saber para ONDE mandar as " +
      "mensagens recebidas. Sem o webhook configurado, o cliente escreve e nada chega no Inbox.",
    requires: [
      "Canal já conectado (passo anterior)",
      "Acesso ao painel onde o canal foi criado",
    ],
    how: [
      "Abra Configurações → WhatsApp e copie a URL de webhook mostrada lá.",
      "Na via Meta: o Embedded Signup já configura o webhook automaticamente — normalmente não há nada a fazer.",
      "Na via Z-API: cole a MESMA URL nos três campos do painel (Ao Enviar, Ao Receber, Ao Receber Status).",
      "Mande uma mensagem de outro celular para o número da empresa.",
      "Clique em 'Testar agora' aqui embaixo: se a mensagem chegou, o passo fica verde.",
    ],
    gotchas: [
      "Na Z-API a URL precisa incluir o parâmetro de segurança (?s=...). Sem ele o endpoint aceita qualquer origem; com ele errado, rejeita tudo.",
      "Se a mensagem não chegar em 1 minuto, quase sempre é URL colada errada ou faltando um dos três campos da Z-API.",
    ],
    eta: "5 min",
  },
  {
    id: "contacts",
    title: "Importar a base de contatos",
    summary: "Quem vai receber as mensagens",
    weight: "blocker",
    icon: "Users",
    route: "/contacts",
    routeLabel: "Importar contatos",
    why:
      "Campanhas e cobranças precisam de uma base. Além do telefone, é aqui que entram " +
      "CPF/CNPJ e faturas — sem eles a negociação de dívida e o portal do cliente não funcionam.",
    requires: [
      "Planilha (.xlsx ou .csv) com pelo menos nome e telefone",
      "Se for cobrar: CPF/CNPJ, valor e vencimento de cada fatura",
    ],
    how: [
      "Vá em Contatos → Importar.",
      "Suba a planilha e faça o de-para das colunas na tela seguinte.",
      "Telefones podem vir em qualquer formato — o sistema normaliza para o padrão internacional.",
      "Confira o resumo (quantos entram, quantos são duplicados) antes de confirmar.",
    ],
    gotchas: [
      "Contato sem CPF/CNPJ não consegue usar o portal de negociação: a verificação pede os últimos dígitos do documento.",
      "A importação junta contatos repetidos pelo telefone. Se a mesma pessoa aparece com dois números, viram dois contatos.",
    ],
    eta: "10 min",
  },
  {
    id: "departments",
    title: "Criar os setores",
    summary: "Como as conversas são distribuídas",
    weight: "important",
    icon: "GitBranch",
    route: "/settings",
    routeLabel: "Criar setores",
    why:
      "Setores organizam quem atende o quê (Cobrança, Jurídico, Suporte…). São a base do " +
      "roteamento automático e de para onde uma negociação escala quando sai da régua da IA.",
    requires: ["Saber como o atendimento da empresa é dividido hoje"],
    how: [
      "Configurações → Setores → Novo setor.",
      "Crie um por área real de atendimento. Comece simples: 2 a 4 setores bastam.",
      "Se quiser que o cliente escolha o setor sozinho no primeiro contato, ative o menu de roteamento na mesma tela.",
    ],
    gotchas: [
      "O nome do setor aparece para o cliente no menu do WhatsApp e tem limite de 24 caracteres.",
    ],
    eta: "5 min",
  },
  {
    id: "templates",
    title: "Aprovar um template na Meta",
    summary: "Obrigatório para iniciar conversa",
    weight: "important",
    icon: "FileText",
    route: "/templates",
    routeLabel: "Criar template",
    why:
      "A Meta só deixa você iniciar conversa (ou responder depois de 24h de silêncio) usando " +
      "um template pré-aprovado. Sem template aprovado, o disparo em massa simplesmente não sai.",
    requires: ["Canal Meta conectado", "O texto da mensagem que quer enviar"],
    how: [
      "Vá em Templates → Novo template.",
      "Escolha a categoria certa: UTILITY para cobrança/aviso, MARKETING para promoção. Categoria errada é o motivo nº 1 de recusa.",
      "Use variáveis {{1}}, {{2}} para nome, valor, vencimento.",
      "Envie para aprovação e aguarde. O status atualiza sozinho nesta tela.",
    ],
    gotchas: [
      "A aprovação leva de minutos a 48h — comece por aqui, não deixe para o fim.",
      "Template recusado pode ser editado e reenviado; não precisa criar outro.",
      "Para o portal de negociação, crie um template com uma variável para o link, senão não dá para reengajar quem sumiu por mais de 24h.",
    ],
    eta: "15 min + até 48h de aprovação da Meta",
  },
  {
    id: "ai",
    title: "Ligar a inteligência artificial",
    summary: "Respostas e triagem automáticas",
    weight: "important",
    icon: "Zap",
    route: "/agents",
    routeLabel: "Configurar agentes",
    why:
      "A IA faz a triagem do primeiro contato, responde dúvidas e conduz a negociação de " +
      "dívida dentro das regras que você define. Sem ela, tudo depende de atendente humano.",
    requires: [
      "Uma chave de API da Anthropic (Claude) ou da OpenAI",
      "Setores já criados, se quiser triagem automática",
    ],
    how: [
      "Cole a chave em Configurações → IA e salve. Ela é guardada criptografada.",
      "Clique em 'Testar agora' aqui embaixo para confirmar que a chave funciona de verdade.",
      "Em Agentes, crie um agente por setor com a instrução de como ele deve responder.",
      "Crie também um agente de Triagem — ele lê a primeira mensagem e manda para o setor certo.",
      "O agente de triagem nasce desativado de propósito. Ligue só quando estiver satisfeito com as respostas.",
    ],
    gotchas: [
      "A chave é cobrada por uso pela Anthropic/OpenAI, não por nós.",
      "Teste com o agente desligado antes de soltar para clientes reais: ele responde de verdade no WhatsApp.",
    ],
    eta: "20 min",
  },
  {
    id: "negotiation",
    title: "Definir as regras de negociação",
    summary: "Limites que a IA nunca ultrapassa",
    weight: "important",
    icon: "Handshake",
    route: "/negotiations/rules",
    routeLabel: "Definir regras",
    why:
      "Antes de deixar a IA negociar dívida, é preciso dizer até onde ela pode ir: desconto " +
      "máximo, número de parcelas e valor mínimo por parcela. Esses limites são conferidos " +
      "em código a cada proposta — a IA não consegue ultrapassá-los mesmo se o cliente insistir.",
    requires: ["Definição comercial de até quanto a empresa aceita negociar"],
    how: [
      "Vá em Negociações → Regras.",
      "Preencha desconto máximo, parcelas máximas e valor mínimo de parcela.",
      "Defina em quantas rodadas sem acordo a conversa vai para um humano.",
      "Configure as palavras que escalam na hora (advogado, Procon…) e o setor de destino.",
      "Se preferir só acompanhar no começo, desligue 'IA pode negociar automaticamente': tudo cai para atendente.",
    ],
    gotchas: [
      "Contato sem CPF/CNPJ cadastrado não recebe o link do portal — a verificação depende do documento.",
      "O sistema apenas REGISTRA o acordo. Gerar o novo boleto continua sendo trabalho do financeiro.",
    ],
    eta: "10 min",
  },
  {
    id: "team",
    title: "Convidar a equipe",
    summary: "Quem mais vai atender",
    weight: "optional",
    icon: "UserPlus",
    route: "/team",
    routeLabel: "Convidar",
    why:
      "Cada atendente com login próprio permite atribuir conversas, medir atendimento e " +
      "manter registro de quem fez o quê.",
    requires: ["E-mail de cada pessoa"],
    how: [
      "Equipe → Convidar. A pessoa recebe um e-mail para criar a senha.",
      "Escolha o papel: Admin (tudo), Gerente (opera e gere equipe) ou Agente (só atende).",
    ],
    gotchas: ["O convite expira em 7 dias."],
    eta: "5 min",
  },
  {
    id: "email",
    title: "Conectar o e-mail",
    summary: "Para campanhas por e-mail",
    weight: "optional",
    icon: "Mail",
    route: "/settings",
    routeLabel: "Conectar e-mail",
    why: "Só necessário se for disparar campanhas por e-mail além do WhatsApp.",
    requires: ["Dados SMTP ou uma conta Microsoft 365"],
    how: [
      "Configurações → Email → Nova conexão.",
      "SMTP: informe host, porta, usuário e senha.",
      "Microsoft 365: use OAuth, que é mais estável e não exige senha de aplicativo.",
      "Use 'Testar conexão' antes de salvar.",
    ],
    eta: "10 min",
  },
];

export const STEP_WEIGHT_LABEL: Record<StepWeight, string> = {
  blocker:   "Essencial",
  important: "Recomendado",
  optional:  "Opcional",
};
