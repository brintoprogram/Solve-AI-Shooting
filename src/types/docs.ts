// Dossiê de configuração e operação.
//
// Mesma decisão de src/types/setup.ts: o texto vive aqui, como dado, para que
// revisar um tutorial não exija tocar em React — e para que a busca consiga
// varrer o conteúdo inteiro sem raspar JSX.
//
// Relação com SETUP_STEPS: os 9 passos de "Primeiros passos" NÃO são copiados
// para cá. São importados e adaptados por `artigosDeSetup()`. Texto duplicado
// vira texto divergente na primeira revisão que esquece o outro lugar.
//
// LIMITE DELIBERADO: este conteúdo é lido por qualquer membro de qualquer
// workspace cliente. Nada de nome de secret, de edge function, de job agendado
// ou de infraestrutura entra aqui. Isso é runbook do dono da plataforma e vive
// fora do frontend.

import type { PermissionKey } from "@/context/AuthContext";
import { SETUP_STEPS } from "./setup";

export type DocCategoria =
  | "comecar" | "canais" | "atendimento" | "campanhas"
  | "contatos" | "negociacao" | "conta";

export const CATEGORIAS: { id: DocCategoria; label: string; icon: string }[] = [
  { id: "comecar",     label: "Começar aqui", icon: "Rocket"        },
  { id: "canais",      label: "Canais",       icon: "Smartphone"    },
  { id: "atendimento", label: "Atendimento",  icon: "MessageSquare" },
  { id: "campanhas",   label: "Campanhas",    icon: "Send"          },
  { id: "contatos",    label: "Contatos",     icon: "Users"         },
  { id: "negociacao",  label: "Negociação",   icon: "Handshake"     },
  { id: "conta",       label: "Conta",        icon: "Settings"      },
];

/** Uma linha da tabela de referência: o que cada campo da tela faz. */
export interface DocCampo {
  /** Exatamente como aparece na interface. */
  label:   string;
  what:    string;
  /** Como vem de fábrica. Omitir quando não há padrão. */
  padrao?: string;
  /** O que muda no comportamento se você mexer. */
  efeito?: string;
}

/**
 * O contrato que <ArticleBody> sabe renderizar.
 * `SetupStep` satisfaz este shape — é o que permite os dois lados usarem o
 * mesmo componente sem adaptador de apresentação.
 */
export interface ArtigoRenderizavel {
  why:         string;
  requires?:   string[];
  how?:        string[];
  gotchas?:    string[];
  campos?:     DocCampo[];
  eta?:        string;
  route?:      string;
  routeLabel?: string;
  external?:   { url: string; label: string };
  /** Sem esta permissão o botão de abrir a tela aparece travado. */
  routePerm?:  PermissionKey;
}

export interface DocArtigo extends ArtigoRenderizavel {
  id:        string;
  title:     string;
  /** Uma linha, mostrada fechado e nos resultados de busca. */
  summary:   string;
  categoria: DocCategoria;
  icon:      string;
  /** Sinônimos que a pessoa digitaria e que não estão no título. */
  busca?:    string[];
  /** Id de um passo de SETUP_STEPS cujo estado verificado descreve este artigo. */
  sinal?:    string;
  related?:  string[];
}

// ─────────────────────────────────────────────────────────────────────
// Os 9 passos de configuração, reaproveitados sem cópia de texto.
// ─────────────────────────────────────────────────────────────────────

export function artigosDeSetup(): DocArtigo[] {
  return SETUP_STEPS.map((s) => ({
    ...s,
    categoria: "comecar" as const,
    summary:   s.summary,
    sinal:     s.id,
    busca:     ["configurar", "primeiros passos", "setup"],
  }));
}

// ─────────────────────────────────────────────────────────────────────
// Operação — o que o "Primeiros passos" não cobre.
// ─────────────────────────────────────────────────────────────────────

export const DOC_ARTIGOS: DocArtigo[] = [

  // ── Canais ───────────────────────────────────────────────────────
  {
    id: "janela-24h",
    title: "A janela de 24 horas",
    summary: "A regra que governa custo, template e reengajamento",
    categoria: "canais",
    icon: "Clock",
    busca: ["24h", "janela", "sessao", "cobranca", "por que preciso de template"],
    why:
      "É a regra mais importante do WhatsApp e a origem de quase toda dúvida de custo. " +
      "Quando o cliente te manda uma mensagem, abre uma janela de 24 horas. Dentro dela " +
      "você responde o que quiser, em texto livre, quantas vezes quiser. Passadas as 24h " +
      "de silêncio dele, a janela fecha: a partir daí só dá para falar usando um template " +
      "aprovado pela Meta. Não é limitação do sistema, é regra da Meta.",
    how: [
      "Cliente escreve → janela abre por 24h → você responde livremente.",
      "Cliente responde de novo → a janela reinicia, contando 24h a partir da última mensagem dele.",
      "Passou 24h sem ele falar → a janela fecha e texto livre é recusado pela Meta.",
      "Para reabrir, envie um template aprovado. Se ele responder, a janela abre de novo.",
    ],
    gotchas: [
      "A janela conta a partir da última mensagem DO CLIENTE, não da sua. Você responder não estende nada.",
      "Uma conversa que parece viva no Inbox pode estar com a janela fechada. Se o envio falhar por isso, é sinal de que precisa de template.",
      "No crédito, a janela é por contato e por canal: WhatsApp e e-mail contam separado para a mesma pessoa.",
    ],
    related: ["creditos", "templates-aprovacao", "negociacao-portal"],
  },
  {
    id: "meta-vs-zapi",
    title: "Meta oficial ou Z-API: qual usar",
    summary: "A escolha que define risco de bloqueio",
    categoria: "canais",
    icon: "GitCompare",
    busca: ["zapi", "z-api", "qr code", "oficial", "nao oficial", "bloqueio"],
    route: "/settings?tab=whatsapp",
    routeLabel: "Abrir Configurações → WhatsApp",
    routePerm: "can_settings",
    sinal: "channel",
    why:
      "O sistema fala WhatsApp por duas vias e elas não são equivalentes. A via Meta é a " +
      "API oficial: homologada, com template aprovado e sem risco de o número cair. A Z-API " +
      "é um intermediário não oficial que conecta lendo QR code, como o WhatsApp Web — " +
      "funciona, é mais rápida de ligar, e pode ser bloqueada pelo WhatsApp a qualquer momento.",
    how: [
      "Vai operar de verdade, com volume e número da empresa: use a via Meta. Sempre.",
      "Precisa testar hoje, ou usar um número pessoal que não pode passar pela Meta: Z-API resolve.",
      "Dá para ter as duas conectadas ao mesmo tempo, em números diferentes.",
    ],
    campos: [
      { label: "Via Meta (oficial)", what: "API oficial da Meta, conectada pelo popup do Facebook", efeito: "Exige template aprovado para iniciar conversa. Número não corre risco de bloqueio." },
      { label: "Via Z-API", what: "Intermediário não oficial, conecta por QR code", efeito: "Não exige template para iniciar. O número pode ser bloqueado pelo WhatsApp sem aviso." },
    ],
    gotchas: [
      "Migrar de Z-API para Meta depois exige apagar o número do app WhatsApp comum antes — a Meta recusa número já registrado.",
      "A Z-API cobra a assinatura dela por fora, além dos créditos daqui.",
    ],
    related: ["janela-24h", "templates-aprovacao"],
  },
  {
    id: "qualidade-numero",
    title: "Qualidade e limite do número",
    summary: "Por que a Meta pode reduzir seu envio",
    categoria: "canais",
    icon: "Gauge",
    busca: ["limite", "qualidade", "bloqueado", "250", "1000 conversas", "reduzido"],
    route: "/settings?tab=whatsapp",
    routeLabel: "Ver status do número",
    routePerm: "can_settings",
    sinal: "channel",
    why:
      "A Meta dá nota de qualidade ao seu número com base em quantas pessoas bloqueiam ou " +
      "denunciam suas mensagens. Nota baixa reduz o limite diário de conversas; nota baixa " +
      "por tempo demais derruba o número. Isso é decidido pela Meta, não pelo sistema — o " +
      "que dá para fazer é não provocar.",
    campos: [
      { label: "Qualidade", what: "Nota da Meta: Alta, Média ou Baixa", efeito: "Cai quando as pessoas bloqueiam ou denunciam. Sobe sozinha com o tempo se você parar de provocar." },
      { label: "Limite de mensagens", what: "Quantas conversas novas por dia a Meta permite", padrao: "250/dia em número novo", efeito: "Sobe para 1.000, 10.000 e ilimitado conforme o uso saudável e a verificação do negócio." },
    ],
    gotchas: [
      "Número novo começa em 250 conversas por dia até a Meta verificar a empresa. Planeje o primeiro disparo em massa contando com isso.",
      "Disparo em massa de MARKETING para base fria é a forma mais rápida de derrubar a qualidade. Prefira UTILITY quando a mensagem for cobrança ou aviso.",
      "Se a qualidade cair para Baixa, pare os disparos e deixe o número descansar. Insistir acelera o bloqueio.",
    ],
    related: ["templates-aprovacao", "disparo"],
  },

  // ── Atendimento ──────────────────────────────────────────────────
  {
    id: "inbox",
    title: "Operar o Inbox",
    summary: "Atribuir, responder e não pisar no pé do colega",
    categoria: "atendimento",
    icon: "MessageSquare",
    busca: ["conversa", "atender", "responder", "assumir", "atribuir"],
    route: "/inbox",
    routeLabel: "Abrir Inbox",
    routePerm: "can_inbox",
    why:
      "O Inbox é onde as conversas vivas ficam. Cada conversa pertence a um setor e pode " +
      "estar atribuída a uma pessoa. Enquanto ninguém assume, qualquer um pode responder — " +
      "o que em equipe grande vira duas pessoas respondendo a mesma coisa.",
    how: [
      "Assuma a conversa antes de responder. Isso a tira da fila dos outros.",
      "Se for assunto de outro setor, mova a conversa em vez de responder por fora.",
      "Anexos: o cliente pode mandar foto, áudio e documento; tudo fica guardado na conversa.",
      "Ao terminar, devolva a conversa para a fila ou feche — conversa parada atribuída a você some do radar dos outros.",
    ],
    gotchas: [
      "Se um agente de IA está ativo no setor, ele responde sozinho. Assumir a conversa é o jeito de calar a IA e atender na mão.",
      "Janela fechada (24h) faz o envio falhar mesmo com a conversa aberta na tela.",
    ],
    related: ["janela-24h", "agentes", "roteamento"],
  },
  {
    id: "agentes",
    title: "Agentes de IA: triagem e setor",
    summary: "Os dois tipos e para que serve cada um",
    categoria: "atendimento",
    icon: "Bot",
    busca: ["ia", "inteligencia artificial", "bot", "robo", "triagem", "prompt"],
    route: "/agents",
    routeLabel: "Configurar agentes",
    routePerm: "can_settings",
    sinal: "ai",
    why:
      "Existem dois papéis e confundi-los é o erro mais comum. O agente de TRIAGEM lê a " +
      "primeira mensagem e decide para qual setor a conversa vai — ele não conversa, ele " +
      "roteia. O agente de SETOR é o que efetivamente responde o cliente dentro daquele " +
      "assunto. Um workspace precisa de uma triagem e de um agente por setor que deva " +
      "responder sozinho.",
    campos: [
      { label: "É triagem", what: "Marca este agente como o roteador de primeiro contato", padrao: "Desmarcado", efeito: "Só um agente por workspace deve ter isto ligado." },
      { label: "Ativo", what: "Se o agente responde de verdade", padrao: "Desligado", efeito: "O agente que vem de fábrica nasce DESLIGADO de propósito: revise o texto antes de soltar em cliente real." },
      { label: "Setor", what: "A qual setor este agente atende", efeito: "Conversas roteadas para este setor passam a ser respondidas por ele." },
      { label: "Instruções", what: "O texto que define como o agente responde", efeito: "É o que mais muda o resultado. Seja específico sobre o que ele NÃO pode prometer." },
    ],
    gotchas: [
      "O agente que já vem criado se chama \"Triagem (rascunho)\" e está desligado. Ele não faz nada até você revisar o texto e ativar.",
      "Agente ativo responde cliente real no WhatsApp. Teste no ambiente de teste antes.",
      "Cada resposta de IA consome crédito, inclusive dentro de uma janela de 24h já aberta.",
    ],
    related: ["agentes-modelo", "agentes-testar", "roteamento", "creditos"],
  },
  {
    id: "agentes-modelo",
    title: "Escolher o modelo de IA",
    summary: "Quanto cada modelo custa em crédito",
    categoria: "atendimento",
    icon: "Cpu",
    busca: ["modelo", "claude", "opus", "sonnet", "haiku", "gpt", "caro", "barato", "multiplicador"],
    route: "/agents",
    routeLabel: "Escolher modelo",
    routePerm: "can_settings",
    sinal: "ai",
    why:
      "Cada agente escolhe o próprio modelo, e modelo mais caro consome mais crédito por " +
      "resposta — na mesma proporção do que custa de verdade. A escolha certa não é o mais " +
      "forte em tudo: é o mais barato que dá conta daquela tarefa.",
    campos: [
      { label: "Claude Haiku 4.5", what: "Econômico. Decisão simples e volume alto", padrao: "1x o crédito de IA", efeito: "É o padrão. Certo para triagem, que roda em toda mensagem que chega." },
      { label: "Claude Sonnet 5", what: "Equilibrado. Entende contexto de conversa", padrao: "3x o crédito de IA", efeito: "Certo para agente de setor que conversa com o cliente." },
      { label: "Claude Opus 5", what: "Máximo. Para quando errar custa dinheiro", padrao: "5x o crédito de IA", efeito: "Certo para negociação de dívida e regra complexa." },
      { label: "GPT-4o Mini", what: "Alternativa econômica, se o workspace usa OpenAI", padrao: "1x o crédito de IA" },
    ],
    gotchas: [
      "Colocar Opus na triagem é o desperdício mais caro possível: ela roda em TODA mensagem que chega e só precisa escolher um setor.",
      "A tela sugere o modelo certo para o tipo de agente. O botão \"Usar o sugerido\" aplica em um clique.",
    ],
    related: ["agentes", "creditos"],
  },
  {
    id: "agentes-testar",
    title: "Testar um agente sem falar com cliente",
    summary: "Ambiente de teste com o roteamento real",
    categoria: "atendimento",
    icon: "FlaskConical",
    busca: ["testar", "sandbox", "simular", "ensaio", "sem enviar"],
    route: "/agents/testar",
    routeLabel: "Abrir ambiente de teste",
    routePerm: "can_settings",
    why:
      "Agente ativo responde cliente de verdade. O ambiente de teste conversa com os mesmos " +
      "agentes, passando pelo mesmo roteamento, mas sem que nada saia no WhatsApp. É onde " +
      "você descobre que a triagem manda tudo para o setor errado — antes do cliente descobrir.",
    how: [
      "Abra Agentes → Testar.",
      "Escreva como se fosse o cliente e envie.",
      "Acompanhe qual setor a triagem escolheu e por quê.",
      "Ajuste as instruções do agente e reinicie a conversa para testar de novo.",
    ],
    gotchas: [
      "O teste consome crédito de IA igual a uma conversa real — é a mesma chamada de modelo.",
    ],
    related: ["agentes", "agentes-modelo"],
  },
  {
    id: "roteamento",
    title: "Menu de roteamento por setor",
    summary: "Deixar o cliente escolher com quem falar",
    categoria: "atendimento",
    icon: "GitBranch",
    busca: ["menu", "opcoes", "escolher setor", "distribuir", "primeiro contato"],
    route: "/settings?tab=setores",
    routeLabel: "Configurar roteamento",
    routePerm: "can_settings",
    sinal: "departments",
    why:
      "Alternativa à triagem por IA: em vez de a IA adivinhar o assunto, o próprio cliente " +
      "escolhe o setor num menu na primeira mensagem. Mais previsível e não consome crédito " +
      "de IA; em compensação, obriga o cliente a um passo a mais.",
    campos: [
      { label: "Ativar menu de roteamento", what: "Manda o menu de setores no primeiro contato", padrao: "Desligado" },
      { label: "Cabeçalho", what: "A saudação que abre o menu", padrao: "Vem preenchido com o nome de um cliente antigo", efeito: "TROQUE ANTES DE ATIVAR. Do contrário seus clientes são saudados com o nome de outra empresa." },
      { label: "Corpo", what: "O texto acima da lista de setores" },
    ],
    gotchas: [
      "O cabeçalho padrão traz o nome de outra empresa. É o primeiro campo a revisar antes de ligar o menu.",
      "O nome do setor aparece para o cliente e tem limite de 24 caracteres.",
      "Menu de roteamento e triagem por IA fazem a mesma coisa. Use um ou outro, não os dois.",
    ],
    related: ["agentes", "inbox"],
  },
  {
    id: "alertas",
    title: "Alertas de resposta",
    summary: "Quando o cliente responde algo que precisa de gente",
    categoria: "atendimento",
    icon: "Bell",
    busca: ["alerta", "resposta", "descadastro", "reclamacao", "urgente"],
    route: "/alerts",
    routeLabel: "Ver alertas",
    why:
      "Depois de um disparo, as respostas chegam todas juntas. O sistema lê cada uma e " +
      "separa o que precisa de atenção humana — pedido de descadastro, reclamação, alguém " +
      "dizendo que já pagou — do que é ruído. Sem isso, resposta importante se perde no meio.",
    gotchas: [
      "A classificação usa IA e consome crédito por resposta analisada.",
      "Pedido de descadastro merece ação imediata: continuar disparando para quem pediu para sair derruba a qualidade do número.",
    ],
    related: ["disparo", "qualidade-numero"],
  },

  // ── Campanhas ────────────────────────────────────────────────────
  {
    id: "templates-aprovacao",
    title: "Templates: categoria, variáveis e aprovação",
    summary: "O motivo nº 1 de recusa é a categoria errada",
    categoria: "campanhas",
    icon: "FileText",
    busca: ["template", "aprovar", "recusado", "utility", "marketing", "variavel"],
    route: "/templates",
    routeLabel: "Abrir Templates",
    sinal: "templates",
    why:
      "Template é a mensagem pré-aprovada pela Meta que te deixa iniciar conversa — ou " +
      "responder alguém que sumiu há mais de 24h. Sem template aprovado, disparo em massa " +
      "simplesmente não sai.",
    campos: [
      { label: "UTILITY", what: "Cobrança, aviso, confirmação, atualização de pedido", efeito: "Mais barato na Meta e muito mais fácil de aprovar. Use sempre que a mensagem for informativa." },
      { label: "MARKETING", what: "Promoção, oferta, reengajamento comercial", efeito: "Mais caro e mais fiscalizado. Derruba a qualidade do número se disparado para base fria." },
      { label: "AUTHENTICATION", what: "Código de verificação", efeito: "Só para senha e código de acesso." },
      { label: "Variáveis {{1}}, {{2}}", what: "Lacunas preenchidas no disparo com nome, valor, vencimento", efeito: "A Meta recusa template que começa ou termina com variável, e recusa duas variáveis coladas." },
    ],
    how: [
      "Templates → Novo template.",
      "Escolha a categoria pelo conteúdo real da mensagem, não pela que aprova mais fácil — a Meta reclassifica e pode recusar.",
      "Escreva o texto e marque as lacunas com {{1}}, {{2}}.",
      "Envie para aprovação. O status atualiza sozinho nesta tela.",
    ],
    gotchas: [
      "Aprovação leva de minutos a 48h. É o primeiro item a fazer, não o último.",
      "Template recusado pode ser editado e reenviado — não precisa criar outro.",
      "Classificar promoção como UTILITY para aprovar mais fácil é o caminho mais curto para a Meta rebaixar o número.",
    ],
    related: ["janela-24h", "disparo", "qualidade-numero"],
  },
  {
    id: "disparo",
    title: "Disparar uma campanha",
    summary: "Do público ao envio, sem derrubar o número",
    categoria: "campanhas",
    icon: "Send",
    busca: ["campanha", "disparo", "shooting", "enviar em massa", "lote"],
    route: "/shooting",
    routeLabel: "Abrir Shooting",
    routePerm: "can_shoot",
    why:
      "Campanha é o envio da mesma mensagem para muita gente. O sistema envia em lotes com " +
      "intervalo, de propósito: disparar tudo de uma vez é o padrão que a Meta associa a spam.",
    how: [
      "Shooting → Nova campanha.",
      "Escolha o público: base inteira, um filtro de contatos ou uma planilha avulsa.",
      "Escolha o template aprovado e ligue as variáveis às colunas ({{1}} → nome, {{2}} → valor).",
      "Confira o resumo: quantos contatos, quanto de crédito, qual número envia.",
      "Dispare. Dá para pausar, retomar e cancelar com a campanha rodando.",
    ],
    gotchas: [
      "Sem saldo de crédito a campanha não sai. Confira o saldo antes de agendar algo grande.",
      "Número novo tem limite de 250 conversas por dia — uma campanha maior que isso vai ser cortada pela Meta.",
      "Revise a ligação das variáveis no resumo. Variável trocada manda o valor da dívida no lugar do nome, para todo mundo.",
    ],
    related: ["templates-aprovacao", "creditos", "qualidade-numero", "alertas"],
  },
  {
    id: "campanha-email",
    title: "Campanhas por e-mail",
    summary: "Quando o WhatsApp não é o canal certo",
    categoria: "campanhas",
    icon: "Mail",
    busca: ["email", "smtp", "microsoft", "outlook", "boleto por email"],
    route: "/settings?tab=email",
    routeLabel: "Conectar e-mail",
    routePerm: "can_settings",
    sinal: "email",
    why:
      "E-mail não tem janela de 24h nem template aprovado: dá para escrever o que quiser, " +
      "quando quiser. Em compensação tem taxa de abertura muito menor. Serve bem para anexo, " +
      "segunda via e comunicado formal.",
    campos: [
      { label: "SMTP", what: "Servidor de e-mail comum (host, porta, usuário, senha)", efeito: "Funciona com qualquer provedor. Gmail e Outlook pessoais exigem senha de aplicativo." },
      { label: "Microsoft 365 (App)", what: "Conexão de servidor, sem usuário", efeito: "Exige um app registrado no Entra ID pelo TI da empresa. Mais estável para volume." },
      { label: "Microsoft (Login)", what: "Conexão pela conta, com login", efeito: "Mais simples de ligar, sem depender do TI." },
    ],
    gotchas: [
      "Use \"Testar conexão\" antes de salvar. Credencial errada só aparece na hora do disparo, com a campanha já rodando.",
      "E-mail consome crédito igual ao WhatsApp, e a janela de 24h conta separado por canal.",
    ],
    related: ["creditos", "janela-24h"],
  },
  {
    id: "automacoes",
    title: "Automações por vencimento",
    summary: "Cobrança que dispara sozinha",
    categoria: "campanhas",
    icon: "Zap",
    busca: ["automacao", "regra", "vencimento", "lembrete", "automatico", "boleto"],
    route: "/automations",
    routeLabel: "Abrir Automações",
    why:
      "Em vez de você lembrar de disparar a cobrança, a regra dispara sozinha em relação ao " +
      "vencimento da fatura: três dias antes, no dia, cinco dias depois. Uma vez configurada, " +
      "roda todo dia sem ninguém tocar.",
    how: [
      "Automações → Nova automação.",
      "Escolha o gatilho em relação ao vencimento (antes, no dia, depois) e quantos dias.",
      "Escolha o template que será enviado.",
      "Defina a hora do dia em que a regra roda.",
      "Ative. Deixe rodando um dia e confira o resultado antes de criar mais regras.",
    ],
    gotchas: [
      "A regra usa a data de vencimento da fatura do contato. Contato sem fatura cadastrada nunca entra.",
      "Regras sobrepostas mandam duas mensagens para a mesma pessoa no mesmo dia. Confira o intervalo entre elas.",
      "Automação também consome crédito. Regra ampla em base grande esvazia saldo rápido.",
    ],
    related: ["faturas", "templates-aprovacao", "creditos"],
  },
  {
    id: "relatorios",
    title: "Relatórios",
    summary: "O que saiu, o que chegou, o que foi lido",
    categoria: "campanhas",
    icon: "BarChart2",
    busca: ["relatorio", "metrica", "entrega", "lido", "exportar", "resultado"],
    route: "/reports",
    routeLabel: "Abrir Relatórios",
    why:
      "Mostra o desempenho por campanha: enviados, entregues, lidos e respondidos. Serve " +
      "para comparar template e horário — e para provar o que foi enviado, quando o cliente " +
      "diz que não recebeu.",
    gotchas: [
      "\"Entregue\" e \"lido\" dependem do WhatsApp devolver o status. Quem desliga a confirmação de leitura nunca aparece como lido.",
    ],
    related: ["disparo", "alertas"],
  },

  // ── Contatos ─────────────────────────────────────────────────────
  {
    id: "faturas",
    title: "Faturas e vencimentos",
    summary: "O que destrava cobrança e negociação",
    categoria: "contatos",
    icon: "Receipt",
    busca: ["fatura", "divida", "boleto", "vencimento", "valor", "atraso"],
    route: "/contacts",
    routeLabel: "Abrir Contatos",
    routePerm: "can_manage_contacts",
    sinal: "contacts",
    why:
      "Contato com fatura cadastrada é o que permite cobrar por valor e por vencimento, " +
      "disparar automação e abrir negociação de dívida. Sem fatura, o contato só recebe " +
      "mensagem genérica.",
    campos: [
      { label: "Valor", what: "Quanto está em aberto", efeito: "É a base do desconto na negociação." },
      { label: "Vencimento", what: "A data de vencimento", efeito: "É o que as automações usam como gatilho." },
      { label: "Situação", what: "Em aberto, pago, cancelado", efeito: "Só fatura em aberto entra em cobrança e negociação." },
      { label: "CPF/CNPJ do contato", what: "Documento de quem deve", efeito: "Sem ele o cliente não consegue entrar no portal de negociação — a verificação pede os últimos dígitos." },
    ],
    gotchas: [
      "Contato sem CPF/CNPJ não usa o portal de negociação. Se for cobrar, traga o documento na planilha desde a importação.",
      "Mesma pessoa com dois telefones vira dois contatos, cada um com suas faturas.",
    ],
    related: ["negociacao-portal", "automacoes", "limpeza"],
  },
  {
    id: "limpeza",
    title: "Limpeza de base",
    summary: "Tirar número inválido antes de queimar crédito",
    categoria: "contatos",
    icon: "Eraser",
    busca: ["limpeza", "duplicado", "invalido", "numero errado", "validar", "higienizar"],
    route: "/contacts",
    routeLabel: "Abrir Contatos",
    routePerm: "can_manage_contacts",
    why:
      "Base importada de sistema antigo vem com número desligado, número que nunca teve " +
      "WhatsApp e a mesma pessoa repetida. Cada um deles é crédito gasto sem entregar nada — " +
      "e envio para número inexistente em volume é sinal ruim para a Meta.",
    how: [
      "Rode a validação de WhatsApp antes do primeiro disparo grande.",
      "Revise os duplicados que o sistema apontou.",
      "Só então dispare.",
    ],
    gotchas: [
      "O sistema junta contatos repetidos pelo telefone. Se o mesmo CPF aparece com dois números, continuam dois contatos — a checagem por telefone não vê o documento.",
    ],
    related: ["faturas", "disparo", "creditos"],
  },
  {
    id: "lgpd",
    title: "LGPD: exportar e apagar dados",
    summary: "Quando o titular exerce o direito dele",
    categoria: "contatos",
    icon: "ShieldCheck",
    busca: ["lgpd", "privacidade", "apagar", "esquecimento", "exportar dados", "titular"],
    route: "/contacts",
    routeLabel: "Abrir Contatos",
    routePerm: "can_manage_contacts",
    why:
      "A LGPD dá ao titular o direito de pedir cópia dos dados dele e o de pedir exclusão. " +
      "O sistema atende os dois pelo próprio cadastro do contato, sem depender de suporte.",
    how: [
      "Abra o contato.",
      "Exportar: gera um arquivo com tudo que o sistema guarda daquela pessoa, incluindo o histórico de conversa.",
      "Apagar: remove ou anonimiza os dados pessoais mantendo o registro contábil do que foi enviado.",
    ],
    gotchas: [
      "Apagar é irreversível. O histórico de mensagens daquela pessoa vai junto.",
      "Pedido de descadastro em campanha não é a mesma coisa que exclusão de dados. Descadastro para de enviar; exclusão apaga o cadastro.",
    ],
    related: ["alertas"],
  },

  // ── Negociação ───────────────────────────────────────────────────
  {
    id: "negociacao-portal",
    title: "O portal do cliente",
    summary: "Como o devedor formaliza o acordo",
    categoria: "negociacao",
    icon: "ExternalLink",
    busca: ["portal", "link", "aceitar", "contraproposta", "cpf", "acordo"],
    sinal: "negotiation",
    why:
      "A proposta vai e volta no WhatsApp, mas fechar acordo por mensagem é frágil. O portal " +
      "é uma página com link próprio onde o cliente vê o resumo formatado e aceita ou " +
      "contrapropõe formalmente. Antes de mostrar qualquer valor, ele confirma os últimos " +
      "dígitos do CPF/CNPJ — sem isso, quem recebesse o link encaminhado veria a dívida alheia.",
    how: [
      "A IA envia o link junto com a primeira proposta, automaticamente.",
      "O cliente abre, confirma os dígitos do documento e vê o resumo.",
      "Ele aceita ou contrapropõe. Contraproposta volta para a IA responder.",
      "Aceito, o acordo fica registrado e a negociação encerra.",
    ],
    campos: [
      { label: "Validade do link", what: "Por quanto tempo o link funciona", padrao: "48 horas", efeito: "Expirado, o cliente precisa de um link novo." },
    ],
    gotchas: [
      "Contato sem CPF/CNPJ cadastrado não recebe link: a verificação depende do documento.",
      "O sistema apenas REGISTRA o acordo. Gerar o boleto novo continua sendo trabalho do financeiro.",
      "Errar os dígitos várias vezes bloqueia o link — é proteção contra tentativa e erro.",
    ],
    related: ["negociacao-regras", "faturas", "negociacao-escalada"],
  },
  {
    id: "negociacao-regras",
    title: "Até onde a IA pode negociar",
    summary: "Limites conferidos em código, não sugeridos",
    categoria: "negociacao",
    icon: "Handshake",
    busca: ["desconto", "parcela", "regra", "limite", "negociar", "autonomia"],
    route: "/negotiations/rules",
    routeLabel: "Definir regras",
    routePerm: "can_settings",
    sinal: "negotiation",
    why:
      "Antes de deixar a IA falar de dinheiro, é preciso dizer até onde ela pode ir. Esses " +
      "limites não são sugestão no texto do prompt: cada proposta é recalculada e conferida " +
      "em código antes de sair. A IA não consegue ultrapassá-los nem se o cliente insistir, " +
      "nem se errar a conta.",
    campos: [
      { label: "IA pode negociar automaticamente", what: "Liga a negociação autônoma", padrao: "LIGADO", efeito: "Vem ligado de fábrica com autonomia de 20% de desconto. Revise antes de conectar o canal." },
      { label: "Desconto máximo", what: "Maior desconto percentual que a IA pode oferecer", padrao: "20%" },
      { label: "Parcelas máximas", what: "Em quantas vezes ela pode dividir", padrao: "6" },
      { label: "Valor mínimo da parcela", what: "Piso de cada parcela", padrao: "R$ 50,00", efeito: "Impede parcelamento que não vale a cobrança." },
      { label: "Rodadas até escalar", what: "Quantas idas e vindas sem acordo antes de chamar humano", padrao: "3" },
      { label: "Palavras que escalam na hora", what: "Termos que interrompem a IA imediatamente", padrao: "advogado, procon, fraude, processo" },
      { label: "Setor de escalada", what: "Para onde a conversa vai quando escala", padrao: "Nenhum", efeito: "Sem setor definido, a conversa escala sem destino claro. Defina antes de ativar." },
    ],
    gotchas: [
      "A negociação automática vem LIGADA com 20% de autonomia. Se isso for além do que a empresa aceita, ajuste antes de conectar o WhatsApp.",
      "Prefira começar desligado: tudo cai para atendente e você observa o que a IA teria proposto.",
    ],
    related: ["negociacao-portal", "negociacao-escalada", "agentes-modelo"],
  },
  {
    id: "negociacao-escalada",
    title: "Quando a conversa vira humana",
    summary: "O que faz a IA parar e chamar gente",
    categoria: "negociacao",
    icon: "UserCog",
    busca: ["escalar", "humano", "atendente", "assumir", "parar ia"],
    route: "/negotiations",
    routeLabel: "Ver negociações",
    routePerm: "can_negotiations",
    why:
      "Nem toda negociação deve terminar com a IA. Quando o cliente pede algo fora da régua, " +
      "insiste depois de várias rodadas, menciona advogado ou pede atendimento humano, a " +
      "conversa escala: a IA para de responder e um atendente assume.",
    how: [
      "A escalada acontece sozinha nos casos configurados nas regras.",
      "A conversa vai para o setor de escalada e aparece em Negociações.",
      "O atendente assume e negocia no chat normal.",
      "Fechado o acordo, ele registra os termos manualmente.",
    ],
    gotchas: [
      "Depois de escalar, a IA fica calada naquela conversa de propósito — para não desfazer o que o humano combinou.",
      "Sem setor de escalada configurado, a conversa escala mas não tem destino. Configure nas regras.",
    ],
    related: ["negociacao-regras", "inbox"],
  },

  // ── Conta ────────────────────────────────────────────────────────
  {
    id: "creditos",
    title: "Como o crédito é cobrado",
    summary: "O que consome, o que não consome e o que trava",
    categoria: "conta",
    icon: "Coins",
    busca: ["credito", "saldo", "custo", "cobranca", "acabou", "recarga", "preco"],
    route: "/creditos",
    routeLabel: "Ver saldo e extrato",
    why:
      "Crédito é a unidade de consumo do workspace. Duas coisas gastam: falar com um contato " +
      "e a IA responder. A regra que mais confunde é a janela: falar com o MESMO contato " +
      "de novo dentro de 24h não custa crédito novo — você paga pela conversa, não por " +
      "mensagem.",
    campos: [
      { label: "Custo por conversa", what: "Cobrado ao falar com um contato pela primeira vez em 24h", padrao: "1 crédito", efeito: "Conta por contato e por canal: WhatsApp e e-mail para a mesma pessoa são duas conversas." },
      { label: "Custo por resposta de IA", what: "Cobrado a cada resposta gerada por agente", padrao: "3 créditos", efeito: "É multiplicado pelo modelo do agente: Haiku 1x, Sonnet 3x, Opus 5x." },
      { label: "Cobrança ativa", what: "Se este workspace consome crédito", padrao: "Ligada", efeito: "Desligada, nada é debitado e nada trava por saldo." },
      { label: "Saldo", what: "Quanto resta", padrao: "0 em workspace novo", efeito: "Zerado, TUDO para de enviar." },
    ],
    gotchas: [
      "Resposta de IA consome crédito toda vez, inclusive dentro de uma janela de 24h já aberta. A janela isenta a mensagem, não o raciocínio.",
      "Com saldo zero nada sai: campanha pausa, IA para de responder e envio manual falha. Workspace novo começa em zero.",
      "A conta de crédito é do sistema. A Meta cobra as conversas dela por fora, direto no cartão cadastrado lá.",
    ],
    related: ["janela-24h", "agentes-modelo", "disparo"],
  },
  {
    id: "equipe-papeis",
    title: "Papéis e permissões",
    summary: "Quem enxerga e faz o quê",
    categoria: "conta",
    icon: "UserCog",
    busca: ["papel", "permissao", "admin", "gerente", "agente", "acesso", "convidar"],
    route: "/team",
    routeLabel: "Abrir Equipe",
    routePerm: "can_manage_team",
    sinal: "team",
    why:
      "Cada pessoa entra com login próprio e um papel. O papel define o que ela alcança — " +
      "e é o que impede um atendente de disparar campanha para a base inteira ou mexer nas " +
      "credenciais do WhatsApp.",
    campos: [
      { label: "Admin", what: "Tudo, inclusive Configurações, integrações e equipe", efeito: "Dê a quem realmente administra. É quem pode trocar as credenciais do canal." },
      { label: "Gerente", what: "Opera tudo e gere equipe, MENOS Configurações", efeito: "Dispara campanha, atende, negocia e convida gente — mas não mexe em integração." },
      { label: "Agente", what: "Só atende: Inbox, contatos e alertas", efeito: "Não dispara campanha, não gere equipe, não vê Configurações nem Negociações." },
    ],
    gotchas: [
      "O convite expira em 7 dias.",
      "Itens sem permissão continuam visíveis no menu, com cadeado — para a pessoa saber que existem e pedir acesso, em vez de achar que o sistema está quebrado.",
    ],
    related: ["chaves-api"],
  },
  {
    id: "chaves-api",
    title: "Chaves de API",
    summary: "Integrar o sistema com o seu ERP",
    categoria: "conta",
    icon: "KeyRound",
    busca: ["api", "chave", "token", "integracao", "erp", "webhook", "externo"],
    route: "/settings?tab=api",
    routeLabel: "Abrir Configurações → API",
    routePerm: "can_settings",
    why:
      "A chave permite que outro sistema seu — ERP, CRM, portal do cliente — consulte e " +
      "escreva dados aqui sem passar pela tela. Cada chave tem escopo próprio: dá para " +
      "criar uma que só lê contatos e outra que também cria faturas.",
    how: [
      "Configurações → API → Nova chave.",
      "Marque só os escopos que aquela integração precisa.",
      "Copie a chave na hora: ela é mostrada uma única vez.",
      "Revogue a chave assim que a integração for desativada.",
    ],
    gotchas: [
      "A chave aparece uma vez só. Perdeu, tem que gerar outra — o sistema guarda apenas o resumo criptografado dela.",
      "Chave com escopo amplo demais é o risco mais comum. Comece pelo mínimo e amplie se faltar.",
    ],
    related: ["equipe-papeis"],
  },
  {
    id: "perfil-workspace",
    title: "Perfil e dados do workspace",
    summary: "Nome, contato de suporte e identificação",
    categoria: "conta",
    icon: "Building2",
    busca: ["perfil", "nome da empresa", "workspace", "suporte", "dados"],
    route: "/settings?tab=perfil",
    routeLabel: "Abrir Configurações → Perfil",
    routePerm: "can_settings",
    why:
      "O nome do workspace aparece no seletor no topo e nos e-mails que o sistema envia. " +
      "O e-mail de suporte é para onde vão as notificações de chamado aberto pela equipe.",
    campos: [
      { label: "E-mail de suporte", what: "Destino das notificações de chamado", padrao: "Vazio", efeito: "Vazio, ninguém é avisado quando alguém abre chamado." },
    ],
    related: ["equipe-papeis"],
  },
];

/** Tudo, na ordem de exibição: começar aqui primeiro. */
export function todosOsArtigos(): DocArtigo[] {
  return [...artigosDeSetup(), ...DOC_ARTIGOS];
}
