// Roteiros das demonstrações.
//
// O /agents/demo tem 878 linhas de animação escrita à mão para UM assunto
// (roteamento). Repetir aquilo por funcionalidade custaria milhares de linhas
// de JSX quase igual, e cada ajuste visual teria que ser feito sete vezes.
//
// Aqui a demo é DADO: uma lista de passos que um único player sabe tocar.
// Escrever uma demo nova passa a ser escrever um roteiro, não um componente.
// Mesma decisão de setup.ts e docs.ts.

export type Lado = "cliente" | "empresa";

export type Passo =
  /** Balão no chat. */
  | { t: "msg"; de: Lado; texto: string; hora?: string }
  /** "digitando…" antes da próxima mensagem. Dá ritmo de conversa real. */
  | { t: "digitando"; de: Lado; ms?: number }
  /** Evento do sistema na coluna lateral: o que aconteceu por baixo. */
  | { t: "sistema"; icone: string; texto: string; detalhe?: string; cor?: string }
  /** Número que muda — saldo, contador. É o que prova o custo. */
  | { t: "metrica"; rotulo: string; valor: string; delta?: string; cor?: string }
  /** Explicação para quem assiste. Some do fluxo, aparece como nota. */
  | { t: "nota"; texto: string }
  /** Marca o fim de um trecho, para o apresentador respirar. */
  | { t: "pausa"; rotulo: string };

export interface Demo {
  id: string;
  titulo: string;
  /** Uma linha: o que esta demo prova. */
  resumo: string;
  icone: string;
  cor: string;
  /** A pergunta de cliente que esta demo responde. */
  pergunta: string;
  /** Rota externa, quando a demo já existe em tela própria. */
  rotaExterna?: string;
  passos?: Passo[];
}

// ─────────────────────────────────────────────────────────────────────

export const DEMOS: Demo[] = [
  {
    id: "roteamento",
    titulo: "Triagem por IA",
    resumo: "A IA lê a primeira mensagem e manda para o setor certo",
    icone: "GitBranch",
    cor: "#60a5fa",
    pergunta: "Como vocês sabem para quem mandar a conversa?",
    rotaExterna: "/agents/demo",
  },

  {
    id: "janela-24h",
    titulo: "Janela de 24h e crédito",
    resumo: "Por que responder de novo não custa, e por que template existe",
    icone: "Clock",
    cor: "#3fb06c",
    pergunta: "Como vocês cobram? É por mensagem?",
    passos: [
      { t: "nota", texto: "A conta não é por mensagem — é por conversa. Acompanhe o saldo à direita." },
      { t: "metrica", rotulo: "Saldo", valor: "2.000", cor: "#3fb06c" },

      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Oi, recebi um boleto e não reconheço a cobrança", hora: "09:12" },
      { t: "sistema", icone: "DoorOpen", texto: "Janela de 24h aberta", detalhe: "conta a partir da mensagem DO CLIENTE", cor: "#3fb06c" },
      { t: "metrica", rotulo: "Saldo", valor: "1.999", delta: "−1", cor: "#fbbf24" },

      { t: "digitando", de: "empresa" },
      { t: "msg", de: "empresa", texto: "Olá! Vou verificar agora mesmo, um instante.", hora: "09:12" },
      { t: "metrica", rotulo: "Saldo", valor: "1.999", delta: "0", cor: "#3fb06c" },
      { t: "nota", texto: "Aqui está a diferença: responder dentro da janela não custa crédito novo." },

      { t: "msg", de: "empresa", texto: "Achei: é a fatura de julho, vencida dia 10. Quer que eu envie a segunda via?", hora: "09:14" },
      { t: "msg", de: "cliente", texto: "Quero sim, obrigado", hora: "09:15" },
      { t: "msg", de: "empresa", texto: "Enviado! Qualquer coisa é só chamar.", hora: "09:15" },
      { t: "metrica", rotulo: "Saldo", valor: "1.999", delta: "0", cor: "#3fb06c" },

      { t: "pausa", rotulo: "Cinco mensagens, um crédito" },

      { t: "sistema", icone: "DoorClosed", texto: "24 horas sem resposta do cliente", detalhe: "a janela fechou", cor: "#f87171" },
      { t: "nota", texto: "Fechada a janela, a Meta recusa texto livre. Só template aprovado reabre a conversa — não é limitação nossa, é regra da Meta." },
      { t: "msg", de: "empresa", texto: "[template aprovado] Olá {{nome}}, sua fatura de julho segue em aberto. Podemos ajudar?", hora: "09:20" },
      { t: "metrica", rotulo: "Saldo", valor: "1.998", delta: "−1", cor: "#fbbf24" },
      { t: "sistema", icone: "DoorOpen", texto: "Cliente respondeu — janela aberta de novo", cor: "#3fb06c" },
    ],
  },

  {
    id: "negociacao",
    titulo: "Negociação de dívida",
    resumo: "A IA negocia dentro da régua e passa para humano quando sai dela",
    icone: "Handshake",
    cor: "#c084fc",
    pergunta: "A IA vai dar desconto sozinha? E se ela errar?",
    passos: [
      { t: "nota", texto: "Regras deste cliente: desconto até 20%, no máximo 6 parcelas, mínimo R$ 50 por parcela." },

      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Tô com uma dívida de R$ 1.200 aí. Consigo parcelar?", hora: "14:03" },
      { t: "sistema", icone: "Bot", texto: "Negociação aberta", detalhe: "fatura de R$ 1.200, vencida há 47 dias", cor: "#c084fc" },

      { t: "digitando", de: "empresa" },
      { t: "msg", de: "empresa", texto: "Consigo sim! Posso fazer em 6x de R$ 200,00, sem entrada. Fecha assim?", hora: "14:03" },
      { t: "sistema", icone: "ShieldCheck", texto: "Proposta conferida em código", detalhe: "0% de desconto, 6 parcelas de R$ 200 — dentro da régua", cor: "#3fb06c" },
      { t: "nota", texto: "A conta não é feita pela IA. Ela propõe, o sistema recalcula e confere contra os limites antes de qualquer coisa sair." },

      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Tá caro ainda. Faz por 600 à vista que eu pago hoje", hora: "14:05" },
      { t: "sistema", icone: "Ban", texto: "Recusado antes de virar mensagem", detalhe: "50% de desconto — o teto é 20%", cor: "#f87171" },
      { t: "nota", texto: "A IA não chega a oferecer. O limite é conferido em código, então não adianta o cliente insistir nem a IA errar a conta." },

      { t: "msg", de: "empresa", texto: "Não consigo chegar nesse valor. O melhor que posso fazer é R$ 960 à vista — 20% de desconto.", hora: "14:05" },
      { t: "metrica", rotulo: "Rodada", valor: "2 de 3", cor: "#fbbf24" },

      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Vou falar com meu advogado sobre isso", hora: "14:07" },
      { t: "sistema", icone: "UserCog", texto: "Escalado para humano na hora", detalhe: "palavra-chave: advogado → setor Jurídico", cor: "#fbbf24" },
      { t: "nota", texto: "Menção a advogado, Procon ou processo interrompe a IA imediatamente. Ela para de responder naquela conversa para não desfazer o que o humano combinar." },
      { t: "pausa", rotulo: "Do automático ao humano, sem ninguém perceber a troca" },
    ],
  },

  {
    id: "portal",
    titulo: "Portal do cliente",
    resumo: "Onde o acordo é formalizado, com verificação de documento",
    icone: "ExternalLink",
    cor: "#60a5fa",
    pergunta: "E se ele fechar acordo e depois disser que não fechou?",
    passos: [
      { t: "msg", de: "empresa", texto: "Fechado! Preparei um resumo pra você confirmar: solveai.link/n/a9f3…", hora: "15:20" },
      { t: "nota", texto: "Acordo fechado por mensagem é frágil. O link leva a uma página onde ele confirma formalmente." },

      { t: "sistema", icone: "Lock", texto: "Link aberto", detalhe: "pede os últimos dígitos do CPF antes de mostrar qualquer valor", cor: "#fbbf24" },
      { t: "nota", texto: "Sem isso, quem recebesse o link encaminhado veria a dívida de outra pessoa." },
      { t: "sistema", icone: "ShieldCheck", texto: "Documento confirmado", cor: "#3fb06c" },
      { t: "sistema", icone: "FileText", texto: "Resumo exibido", detalhe: "R$ 1.200 → R$ 960 à vista, vencimento em 3 dias", cor: "#60a5fa" },
      { t: "sistema", icone: "Check", texto: "Cliente aceitou", detalhe: "registrado com data, hora e IP", cor: "#3fb06c" },

      { t: "msg", de: "empresa", texto: "Acordo confirmado! O time financeiro vai gerar o boleto e te enviar.", hora: "15:24" },
      { t: "metrica", rotulo: "Validade do link", valor: "48h", cor: "#6b8f77" },
      { t: "nota", texto: "O sistema REGISTRA o acordo — gerar a cobrança continua com o financeiro. Errar os dígitos várias vezes bloqueia o link." },
    ],
  },

  {
    id: "automacao",
    titulo: "Cobrança automática",
    resumo: "A régua de vencimento dispara sozinha, todo dia",
    icone: "Zap",
    cor: "#fbbf24",
    pergunta: "Alguém precisa lembrar de mandar a cobrança?",
    passos: [
      { t: "nota", texto: "Uma regra configurada uma vez. O sistema roda de hora em hora e compara com o vencimento de cada fatura." },
      { t: "sistema", icone: "Calendar", texto: "3 dias antes do vencimento", detalhe: "412 faturas encontradas", cor: "#60a5fa" },
      { t: "msg", de: "empresa", texto: "[template] Olá Maria, sua fatura de R$ 340,00 vence em 3 dias. Segue o código de barras.", hora: "09:00" },
      { t: "metrica", rotulo: "Enviadas hoje", valor: "412", cor: "#60a5fa" },

      { t: "sistema", icone: "Calendar", texto: "No dia do vencimento", detalhe: "97 faturas ainda em aberto", cor: "#fbbf24" },
      { t: "msg", de: "empresa", texto: "[template] Maria, sua fatura vence hoje. Ainda dá tempo de pagar sem juros.", hora: "09:00" },

      { t: "sistema", icone: "Calendar", texto: "5 dias depois", detalhe: "38 faturas vencidas", cor: "#f87171" },
      { t: "msg", de: "empresa", texto: "[template] Maria, sua fatura venceu há 5 dias. Quer negociar? É só responder aqui.", hora: "09:00" },
      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Quero negociar sim", hora: "09:41" },
      { t: "sistema", icone: "Handshake", texto: "Vira negociação automaticamente", detalhe: "a IA assume dentro da régua", cor: "#c084fc" },
      { t: "nota", texto: "A cobrança que vira conversa, e a conversa que vira acordo — sem ninguém abrir uma planilha." },
    ],
  },

  {
    id: "relacionamento",
    titulo: "Mensagem de relacionamento",
    resumo: "Aniversário e dia da profissão, sem ninguém lembrar",
    icone: "Cake",
    cor: "#f472b6",
    pergunta: "Dá para falar com o cliente quando não é para cobrar?",
    passos: [
      { t: "nota", texto: "É a única mensagem do sistema que não pede nada — e por isso a que mais constrói crédito para as que pedem." },
      { t: "sistema", icone: "Cake", texto: "Hoje, 09:00", detalhe: "3 clientes fazem aniversário", cor: "#f472b6" },
      { t: "msg", de: "empresa", texto: "Parabéns, Maria! Todo o time deseja um ótimo dia. 🎉", hora: "09:00" },
      { t: "digitando", de: "cliente" },
      { t: "msg", de: "cliente", texto: "Nossa, que atenção! Muito obrigada 😊", hora: "09:34" },
      { t: "sistema", icone: "DoorOpen", texto: "Janela de 24h aberta pelo cliente", detalhe: "agora dá para falar de qualquer assunto", cor: "#3fb06c" },
      { t: "nota", texto: "Efeito colateral que vale ouro: a resposta dele abre a janela. Uma cobrança que sairia como template pode sair como conversa." },

      { t: "sistema", icone: "Briefcase", texto: "9 de setembro", detalhe: "Dia do Administrador — 14 clientes", cor: "#60a5fa" },
      { t: "msg", de: "empresa", texto: "João, hoje é o seu dia! Parabéns pela profissão. 👏", hora: "09:00" },
      { t: "metrica", rotulo: "Enviadas no mês", valor: "137", cor: "#f472b6" },
    ],
  },

  {
    id: "disparo",
    titulo: "Disparo em massa",
    resumo: "Milhares de mensagens em lote, sem derrubar o número",
    icone: "Send",
    cor: "#3fb06c",
    pergunta: "Quantas mensagens dá para mandar de uma vez?",
    passos: [
      { t: "nota", texto: "Disparar tudo de uma vez é o padrão que a Meta associa a spam. O envio sai em lote, com intervalo." },
      { t: "sistema", icone: "Users", texto: "Público selecionado", detalhe: "2.847 contatos com fatura em aberto", cor: "#60a5fa" },
      { t: "sistema", icone: "FileText", texto: "Template aprovado escolhido", detalhe: "categoria UTILITY — cobrança", cor: "#3fb06c" },
      { t: "sistema", icone: "Coins", texto: "Custo estimado antes de disparar", detalhe: "2.847 créditos — saldo suficiente", cor: "#fbbf24" },
      { t: "nota", texto: "O custo aparece antes, não depois. Sem saldo, a campanha não começa." },

      { t: "metrica", rotulo: "Enviadas", valor: "412 / 2.847", cor: "#60a5fa" },
      { t: "metrica", rotulo: "Entregues", valor: "1.930", cor: "#3fb06c" },
      { t: "metrica", rotulo: "Lidas", valor: "1.204", cor: "#3fb06c" },
      { t: "sistema", icone: "MessageSquare", texto: "97 respostas chegando", detalhe: "classificadas automaticamente", cor: "#c084fc" },
      { t: "sistema", icone: "Bell", texto: "12 pedidos de descadastro separados", detalhe: "atenção humana imediata", cor: "#f87171" },
      { t: "nota", texto: "Continuar disparando para quem pediu para sair é a forma mais rápida de derrubar a qualidade do número." },
      { t: "pausa", rotulo: "Campanha concluída" },
    ],
  },
];

export function demoPorId(id: string): Demo | undefined {
  return DEMOS.find((d) => d.id === id);
}
