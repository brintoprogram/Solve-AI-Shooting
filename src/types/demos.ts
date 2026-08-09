// Roteiros das demonstrações.
//
// Escritos para quem nunca ouviu falar de WhatsApp Business. A regra de
// linguagem: primeiro o efeito prático, depois o nome do produto. "Passado um
// dia sem resposta, a Meta só deixa enviar uma mensagem pré-aprovada, o que
// chamamos de template." A pessoa entende, e só então aprende o termo que vai
// ver na tela.
//
// Cada demo escolhe seu PALCO. Disparo em massa não é uma conversa: mostrar um
// chat vazio ao lado de "2.847 contatos" foi exatamente o que quebrou a
// primeira versão. Quem mostra lista usa grade; quem mostra página usa portal.

export type Lado = "cliente" | "empresa";

/** Onde a demo acontece. A ordem define o layout da esquerda para a direita. */
export type Palco = "chat" | "grade" | "portal" | "agenda";

export type EstadoEnvio = "fila" | "enviada" | "entregue" | "lida" | "respondeu" | "saiu";

export type Passo =
  // ── Conversa ───────────────────────────────────────────────────
  /** Troca de interlocutor: limpa o chat e passa a identificar quem fala.
   *  Sem isto, duas pessoas diferentes apareciam no mesmo fio e a demo dava a
   *  entender que era um diálogo só. */
  | { t: "conversa"; com: string; sub?: string }
  | { t: "msg"; de: Lado; texto: string; hora?: string }
  | { t: "digitando"; de: Lado; ms?: number }

  // ── Lista de envio ─────────────────────────────────────────────
  | { t: "lista"; itens: { nome: string; sub?: string }[] }
  | { t: "status"; nome: string; estado: EstadoEnvio }

  // ── Página do cliente ──────────────────────────────────────────
  | { t: "tela"; titulo: string; linhas?: { rotulo: string; valor: string; forte?: boolean }[];
      aviso?: string; acao?: string }

  // ── Calendário ─────────────────────────────────────────────────
  | { t: "agenda"; dias: { rotulo: string; sub?: string; ativo?: boolean; cor?: string }[] }

  // ── Sempre disponíveis ─────────────────────────────────────────
  | { t: "sistema"; icone: string; texto: string; detalhe?: string; cor?: string }
  | { t: "metrica"; rotulo: string; valor: string; delta?: string; cor?: string }
  /** Fala do apresentador. É o que a pessoa lê enquanto você explica. */
  | { t: "nota"; texto: string }
  | { t: "pausa"; rotulo: string };

export interface Demo {
  id: string;
  titulo: string;
  resumo: string;
  icone: string;
  cor: string;
  /** A pergunta de cliente que esta demo responde. */
  pergunta: string;
  palco: Palco[];
  rotaExterna?: string;
  passos?: Passo[];
}

// ─────────────────────────────────────────────────────────────────────

export const DEMOS: Demo[] = [
  {
    id: "roteamento",
    titulo: "O robô que atende primeiro",
    resumo: "Lê o que a pessoa escreveu e chama a área certa da empresa",
    icone: "GitBranch",
    cor: "#60a5fa",
    pergunta: "Como vocês sabem para qual setor mandar cada cliente?",
    palco: ["chat"],
    passos: [
      { t: "nota", texto: "Quem escreve no WhatsApp da {empresa} não avisa qual é o assunto. Escreve do jeito que fala. O robô lê antes de qualquer pessoa e decide para onde mandar." },

      { t: "conversa", com: "Ana Paula", sub: "primeiro contato" },
      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "boa tarde, tenho 3 boleto vencido aqui e nao consigo pagar pelo aplicativo, da pra resolver?", hora: "14:22" },
      { t: "sistema", icone: "Bot", texto: "Robô leu a mensagem", cor: "#60a5fa" },
      { t: "sistema", icone: "FileText", texto: "Entendeu: boleto vencido e problema para pagar", detalhe: "assunto de cobrança", cor: "#fbbf24" },
      { t: "nota", texto: "Repare que ela escreveu errado, sem acento e sem pontuação, do jeito que a maioria escreve. O robô não precisa de palavra exata nem de menu de opções." },
      { t: "sistema", icone: "UserCog", texto: "Mandou para Cobrança", detalhe: "Priscila assumiu", cor: "#3fb06c" },
      { t: "digitando", de: "empresa" },
      { t: "msg", de: "empresa", texto: "Boa tarde, Ana! Aqui é a Priscila, do financeiro. Já estou vendo seus boletos.", hora: "14:22" },
      { t: "metrica", rotulo: "Tempo até responder", valor: "9 segundos", cor: "#3fb06c" },

      { t: "nota", texto: "Agora a mesma coisa com outro assunto, para ficar claro que não é um roteiro decorado." },
      { t: "conversa", com: "Roberto Almeida", sub: "primeiro contato" },
      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "queria saber o preço pra fazer um pedido maior, uns 200 sacos", hora: "14:26" },
      { t: "sistema", icone: "Bot", texto: "Robô leu a mensagem", cor: "#60a5fa" },
      { t: "sistema", icone: "FileText", texto: "Entendeu: interesse em comprar", detalhe: "nada a ver com cobrança", cor: "#c084fc" },
      { t: "sistema", icone: "UserCog", texto: "Mandou para Comercial", detalhe: "Eduardo assumiu", cor: "#3fb06c" },
      { t: "msg", de: "empresa", texto: "Oi Roberto! Aqui é o Eduardo, do comercial. Para 200 sacos consigo condição especial.", hora: "14:26" },

      { t: "nota", texto: "Duas pessoas, dois assuntos, dois setores. Ninguém da equipe leu nada para decidir isso, e nenhuma delas passou por menu de digite 1, digite 2." },

      { t: "conversa", com: "Carlos Eduardo", sub: "primeiro contato" },
      { t: "msg", de: "cliente", texto: "vou entrar com processo se isso não for resolvido hoje", hora: "14:31" },
      { t: "sistema", icone: "UserCog", texto: "Mandou direto para o Jurídico", detalhe: "e avisou o supervisor", cor: "#f87171" },
      { t: "nota", texto: "E quando o assunto é sério, ele não tenta responder. Passa na hora para quem tem que tratar, com aviso." },
      { t: "pausa", rotulo: "Toda conversa começa no lugar certo" },
    ],
  },

  {
    id: "janela-24h",
    titulo: "Quanto custa falar com um cliente",
    resumo: "A conta é por conversa, não por mensagem",
    icone: "Clock",
    cor: "#3fb06c",
    pergunta: "Vocês cobram por mensagem enviada?",
    palco: ["chat"],
    passos: [
      { t: "nota", texto: "A conta não é por mensagem. É por conversa. Olha o saldo na direita e acompanhe quando ele muda, e quando não muda." },
      { t: "metrica", rotulo: "Saldo", valor: "2.000", cor: "#3fb06c" },
      { t: "conversa", com: "Maria Aparecida", sub: "cliente desde 2023" },

      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Oi, recebi um boleto aqui e não reconheço essa cobrança", hora: "09:12" },
      { t: "sistema", icone: "DoorOpen", texto: "Conversa começou", detalhe: "a partir de agora vocês têm 24 horas", cor: "#3fb06c" },
      { t: "metrica", rotulo: "Saldo", valor: "1.999", delta: "−1", cor: "#fbbf24" },
      { t: "nota", texto: "Uma conversa começou, e ela custou 1. Guarde esse número: 1.999." },

      { t: "digitando", de: "empresa" },
      { t: "msg", de: "empresa", texto: "Olá! Vou verificar agora mesmo, um instante.", hora: "09:12" },
      { t: "metrica", rotulo: "Saldo", valor: "1.999", delta: "0", cor: "#3fb06c" },
      { t: "msg", de: "empresa", texto: "Achei: é a fatura de julho, que venceu dia 10. Quer que eu mande a segunda via?", hora: "09:14" },
      { t: "msg", de: "cliente", texto: "Quero sim, obrigado", hora: "09:15" },
      { t: "msg", de: "empresa", texto: "Enviado! Qualquer coisa é só chamar.", hora: "09:15" },
      { t: "metrica", rotulo: "Saldo", valor: "1.999", delta: "0", cor: "#3fb06c" },

      { t: "nota", texto: "Cinco mensagens depois, o saldo continua 1.999. Dentro dessas 24 horas vocês conversam à vontade, sem pagar de novo." },
      { t: "pausa", rotulo: "Cinco mensagens, um crédito" },

      { t: "sistema", icone: "DoorClosed", texto: "Passou um dia sem o cliente responder", detalhe: "a conversa se encerrou", cor: "#f87171" },
      { t: "nota", texto: "Aqui está a única regra chata, e ela é do WhatsApp, não nossa: passado um dia sem resposta, a empresa não pode mais escrever o que quiser. Só pode mandar uma mensagem que a Meta aprovou antes. No sistema, isso se chama template." },
      { t: "msg", de: "empresa", texto: "Olá Maria, sua fatura de julho continua em aberto. Podemos ajudar?", hora: "09:20" },
      { t: "sistema", icone: "FileText", texto: "Mensagem pré-aprovada", detalhe: "escrita uma vez, usada sempre", cor: "#60a5fa" },
      { t: "metrica", rotulo: "Saldo", valor: "1.998", delta: "−1", cor: "#fbbf24" },
      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Ah sim, esqueci. Consigo pagar semana que vem?", hora: "09:41" },
      { t: "sistema", icone: "DoorOpen", texto: "Ele respondeu, conversa aberta de novo", detalhe: "mais 24 horas livres", cor: "#3fb06c" },
      { t: "nota", texto: "Resumindo: você paga para começar uma conversa. Responder dentro dela é de graça." },
    ],
  },

  {
    id: "disparo",
    titulo: "Falar com milhares de uma vez",
    resumo: "O envio sai aos poucos, de propósito, para o número não cair",
    icone: "Send",
    cor: "#3fb06c",
    pergunta: "Dá para avisar minha base inteira de uma vez?",
    palco: ["grade"],
    passos: [
      { t: "nota", texto: "Vamos avisar {base} clientes da {empresa} que têm boleto em aberto. Acompanhe a lista: o envio acontece pessoa por pessoa." },
      { t: "sistema", icone: "Users", texto: "{base} pessoas selecionadas", detalhe: "todas com fatura em aberto", cor: "#60a5fa" },
      { t: "lista", itens: [
        { nome: "Maria Aparecida Santos", sub: "vence em 3 dias" },
        { nome: "João Carlos Oliveira",   sub: "venceu há 12 dias" },
        { nome: "Ana Paula Rodrigues",    sub: "vence hoje" },
        { nome: "Carlos Eduardo Lima",    sub: "venceu há 5 dias" },
        { nome: "Fernanda Souza",         sub: "vence em 8 dias" },
        { nome: "Roberto Almeida",        sub: "venceu há 31 dias" },
      ]},
      { t: "sistema", icone: "Coins", texto: "Custo calculado antes de começar", detalhe: "{base} créditos, saldo suficiente", cor: "#fbbf24" },
      { t: "nota", texto: "O custo aparece antes, não na fatura do mês seguinte. Sem saldo, o envio nem começa." },

      { t: "status", nome: "Maria Aparecida Santos", estado: "enviada" },
      { t: "status", nome: "João Carlos Oliveira",   estado: "enviada" },
      { t: "status", nome: "Maria Aparecida Santos", estado: "entregue" },
      { t: "status", nome: "Ana Paula Rodrigues",    estado: "enviada" },
      { t: "metrica", rotulo: "Enviadas", valor: "{pct:14}", cor: "#60a5fa" },
      { t: "nota", texto: "Repare que sai aos poucos, e não tudo de uma vez. Disparar {base} mensagens no mesmo segundo é o comportamento que o WhatsApp entende como spam, e derruba o número da empresa." },

      { t: "status", nome: "João Carlos Oliveira",   estado: "entregue" },
      { t: "status", nome: "Carlos Eduardo Lima",    estado: "enviada" },
      { t: "status", nome: "Maria Aparecida Santos", estado: "lida" },
      { t: "status", nome: "Ana Paula Rodrigues",    estado: "entregue" },
      { t: "status", nome: "Fernanda Souza",         estado: "enviada" },
      { t: "metrica", rotulo: "Entregues", valor: "{pct:68}", cor: "#3fb06c" },

      { t: "status", nome: "João Carlos Oliveira",   estado: "respondeu" },
      { t: "status", nome: "Ana Paula Rodrigues",    estado: "lida" },
      { t: "status", nome: "Roberto Almeida",        estado: "saiu" },
      { t: "metrica", rotulo: "Lidas", valor: "{pct:42}", cor: "#3fb06c" },
      { t: "sistema", icone: "MessageSquare", texto: "{pct:3.4} pessoas responderam", detalhe: "separadas por assunto automaticamente", cor: "#c084fc" },
      { t: "sistema", icone: "Bell", texto: "{pct:0.4} pediram para não receber mais", detalhe: "tiradas da lista na hora", cor: "#f87171" },
      { t: "nota", texto: "Quem pede para sair é retirado sozinho. Continuar mandando para essas pessoas é a forma mais rápida de o WhatsApp bloquear o número da empresa." },
      { t: "pausa", rotulo: "Envio concluído" },
    ],
  },

  {
    id: "negociacao",
    titulo: "O robô que negocia dívida",
    resumo: "Ele propõe sozinho, mas nunca passa do limite que você definiu",
    icone: "Handshake",
    cor: "#c084fc",
    pergunta: "Um robô vai dar desconto sozinho? E se ele errar?",
    palco: ["chat"],
    passos: [
      { t: "nota", texto: "Antes de ligar, a empresa define até onde pode ir. Aqui: no máximo 20% de desconto, no máximo 6 vezes, e cada parcela não pode ser menor que R$ 50." },
      { t: "sistema", icone: "ShieldCheck", texto: "Limites definidos pela empresa", detalhe: "20% de desconto · 6 parcelas · mínimo R$ 50", cor: "#3fb06c" },
      { t: "conversa", com: "Carlos Eduardo", sub: "dívida de R$ 1.200, vencida há 47 dias" },

      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Tô com uma dívida de R$ 1.200 aí. Consigo parcelar?", hora: "14:03" },
      { t: "sistema", icone: "Bot", texto: "Robô assumiu a conversa", cor: "#c084fc" },

      { t: "digitando", de: "empresa" },
      { t: "msg", de: "empresa", texto: "Consigo sim! Posso fazer em 6x de R$ 200,00, sem entrada. Fecha assim?", hora: "14:03" },
      { t: "sistema", icone: "Check", texto: "Proposta conferida antes de sair", detalhe: "6 parcelas de R$ 200, dentro do combinado", cor: "#3fb06c" },
      { t: "nota", texto: "Aqui está o ponto importante: quem faz a conta não é o robô. Ele sugere, o sistema recalcula e confere contra os limites. Só então a mensagem sai." },

      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Tá caro ainda. Faz por 600 à vista que eu pago hoje", hora: "14:05" },
      { t: "sistema", icone: "Ban", texto: "Recusado antes de virar mensagem", detalhe: "seria 50% de desconto, e o limite é 20%", cor: "#f87171" },
      { t: "nota", texto: "O cliente pediu metade do valor. O robô nem chega a oferecer isso: o limite é conferido no sistema, então não adianta o cliente insistir nem o robô se confundir." },

      { t: "msg", de: "empresa", texto: "Não consigo chegar nesse valor. O melhor que posso fazer é R$ 960 à vista, com 20% de desconto.", hora: "14:05" },
      { t: "metrica", rotulo: "Tentativas", valor: "2 de 3", cor: "#fbbf24" },

      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Vou falar com meu advogado sobre isso", hora: "14:07" },
      { t: "sistema", icone: "UserCog", texto: "Chamou uma pessoa da equipe", detalhe: "cliente falou em advogado", cor: "#fbbf24" },
      { t: "nota", texto: "Palavras como advogado, Procon ou processo param o robô na hora. Ele fica em silêncio nessa conversa a partir daí, para não desfazer o que a pessoa da equipe combinar." },
      { t: "pausa", rotulo: "Do automático para o humano, sem o cliente perceber a troca" },
    ],
  },

  {
    id: "portal",
    titulo: "Onde o acordo fica registrado",
    resumo: "Uma página só dele, protegida pelo documento",
    icone: "ExternalLink",
    cor: "#60a5fa",
    pergunta: "E se ele fechar acordo e depois disser que não fechou?",
    palco: ["chat", "portal"],
    passos: [
      { t: "nota", texto: "Acordo combinado por mensagem é frágil, some no meio da conversa. Por isso o cliente recebe um link com o resumo, e confirma lá." },
      { t: "conversa", com: "Carlos Eduardo", sub: "acordo de R$ 960 combinado" },
      { t: "msg", de: "empresa", texto: "Fechado! Preparei um resumo para você confirmar: solveai.link/n/a9f3", hora: "15:20" },
      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Abrindo aqui", hora: "15:22" },

      { t: "tela", titulo: "Confirme quem é você",
        aviso: "Digite os 3 últimos números do seu CPF",
        acao: "Continuar" },
      { t: "nota", texto: "Antes de mostrar qualquer valor, a página pede o documento. Sem isso, quem recebesse o link encaminhado veria a dívida de outra pessoa." },

      { t: "sistema", icone: "ShieldCheck", texto: "Documento confere", cor: "#3fb06c" },
      { t: "tela", titulo: "Sua proposta",
        linhas: [
          { rotulo: "Valor original", valor: "R$ 1.200,00" },
          { rotulo: "Desconto",       valor: "20%" },
          { rotulo: "Você paga",      valor: "R$ 960,00", forte: true },
          { rotulo: "Vencimento",     valor: "em 3 dias" },
        ],
        acao: "Aceitar proposta" },
      { t: "nota", texto: "Tudo escrito, sem letra miúda. Ele pode aceitar ou fazer outra proposta, que volta para o robô responder." },

      { t: "sistema", icone: "Check", texto: "Cliente aceitou", detalhe: "guardado com data, hora e origem do acesso", cor: "#3fb06c" },
      { t: "tela", titulo: "Acordo confirmado",
        linhas: [{ rotulo: "Confirmado em", valor: "hoje, 15:24" }],
        aviso: "O boleto novo chega no seu WhatsApp" },
      { t: "msg", de: "empresa", texto: "Acordo confirmado! O financeiro vai gerar o boleto e te enviar.", hora: "15:24" },
      { t: "nota", texto: "Se um dia ele disser que não fechou, existe registro de quando, de onde e com qual documento. O sistema guarda o acordo, e quem emite o boleto continua sendo o financeiro." },
    ],
  },

  {
    id: "automacao",
    titulo: "Cobrança que acontece sozinha",
    resumo: "Avisa antes, no dia e depois do vencimento, sem ninguém lembrar",
    icone: "Zap",
    cor: "#fbbf24",
    pergunta: "Alguém da minha equipe precisa lembrar de cobrar?",
    palco: ["agenda", "chat"],
    passos: [
      { t: "nota", texto: "Configura uma vez e nunca mais. Todo dia o sistema olha os vencimentos e decide sozinho quem precisa ser avisado." },
      { t: "agenda", dias: [
        { rotulo: "3 dias antes", sub: "lembrete",  cor: "#60a5fa" },
        { rotulo: "no dia",       sub: "vence hoje", cor: "#fbbf24" },
        { rotulo: "5 dias depois", sub: "atrasou",  cor: "#f87171" },
      ]},
      { t: "conversa", com: "Maria Aparecida", sub: "acompanhando uma pessoa da lista" },

      { t: "agenda", dias: [
        { rotulo: "3 dias antes", sub: "{pct:14} pessoas", ativo: true, cor: "#60a5fa" },
        { rotulo: "no dia",       sub: "aguardando",  cor: "#fbbf24" },
        { rotulo: "5 dias depois", sub: "aguardando", cor: "#f87171" },
      ]},
      { t: "msg", de: "empresa", texto: "Olá Maria, sua fatura de R$ 340,00 vence em 3 dias. Segue o código de barras.", hora: "09:00" },
      { t: "metrica", rotulo: "Avisadas hoje", valor: "{pct:14}", cor: "#60a5fa" },

      { t: "agenda", dias: [
        { rotulo: "3 dias antes", sub: "feito",      cor: "#60a5fa" },
        { rotulo: "no dia",       sub: "{pct:3.4} pessoas", ativo: true, cor: "#fbbf24" },
        { rotulo: "5 dias depois", sub: "aguardando", cor: "#f87171" },
      ]},
      { t: "msg", de: "empresa", texto: "Maria, sua fatura vence hoje. Ainda dá tempo de pagar sem juros.", hora: "09:00" },
      { t: "nota", texto: "As {pct:14} do primeiro aviso viraram {pct:3.4}, porque as outras já pagaram. O sistema só cobra quem ainda deve." },

      { t: "agenda", dias: [
        { rotulo: "3 dias antes", sub: "feito",      cor: "#60a5fa" },
        { rotulo: "no dia",       sub: "feito",      cor: "#fbbf24" },
        { rotulo: "5 dias depois", sub: "{pct:1.3} pessoas", ativo: true, cor: "#f87171" },
      ]},
      { t: "msg", de: "empresa", texto: "Maria, sua fatura venceu há 5 dias. Quer negociar? É só responder aqui.", hora: "09:00" },
      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Quero negociar sim", hora: "09:41" },
      { t: "sistema", icone: "Handshake", texto: "Virou negociação sozinho", detalhe: "o robô assume dentro dos limites", cor: "#c084fc" },
      { t: "nota", texto: "De {pct:14} avisos para {pct:1.3} cobranças, e a cobrança virou conversa. Ninguém abriu uma planilha em nenhum momento." },
    ],
  },

  {
    id: "relacionamento",
    titulo: "Lembrar do cliente quando não é para cobrar",
    resumo: "Aniversário e o dia da profissão dele, automático",
    icone: "Cake",
    cor: "#f472b6",
    pergunta: "Dá para falar com o cliente sem ser para pedir dinheiro?",
    palco: ["agenda", "chat"],
    passos: [
      { t: "nota", texto: "É a única mensagem do sistema que não pede nada. E, por isso, a que mais ajuda as outras." },
      { t: "agenda", dias: [
        { rotulo: "Hoje",     sub: "3 aniversários", ativo: true, cor: "#f472b6" },
        { rotulo: "Amanhã",   sub: "1 aniversário",  cor: "#f472b6" },
        { rotulo: "9 de set", sub: "Dia do Administrador, 14 pessoas", cor: "#60a5fa" },
      ]},
      { t: "sistema", icone: "Cake", texto: "9 da manhã, sem ninguém apertar nada", detalhe: "3 clientes fazem aniversário hoje", cor: "#f472b6" },

      { t: "conversa", com: "Maria Aparecida", sub: "faz aniversário hoje" },
      { t: "msg", de: "empresa", texto: "Parabéns, Maria! Todo o time da {empresa} deseja um ótimo dia. 🎉", hora: "09:00" },
      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Nossa, que atenção! Muito obrigada 😊", hora: "09:34" },
      { t: "sistema", icone: "DoorOpen", texto: "Ela respondeu, conversa aberta", detalhe: "24 horas livres para falar de qualquer assunto", cor: "#3fb06c" },
      { t: "nota", texto: "Repare no efeito colateral: a resposta dela abriu a conversa. Uma cobrança que sairia como mensagem pré-aprovada agora pode sair como papo normal, e é bem recebida, porque o último contato foi um parabéns." },

      { t: "agenda", dias: [
        { rotulo: "Hoje",     sub: "feito", cor: "#f472b6" },
        { rotulo: "Amanhã",   sub: "1 aniversário", cor: "#f472b6" },
        { rotulo: "9 de set", sub: "Dia do Administrador, 14 pessoas", ativo: true, cor: "#60a5fa" },
      ]},
      { t: "nota", texto: "Um mês depois, outra data e outra pessoa." },
      { t: "conversa", com: "João Carlos", sub: "administrador" },
      { t: "msg", de: "empresa", texto: "João, hoje é o Dia do Administrador. Parabéns pela profissão! 👏", hora: "09:00" },
      { t: "metrica", rotulo: "Lembranças no mês", valor: "137", cor: "#f472b6" },
      { t: "nota", texto: "Ninguém da equipe precisa lembrar de nenhuma dessas datas." },
    ],
  },
];

export function demoPorId(id: string): Demo | undefined {
  return DEMOS.find((d) => d.id === id);
}
