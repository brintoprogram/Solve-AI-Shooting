// Modelos de IA disponíveis para os agentes.
//
// Fonte única: a tela de agentes, os defaults das edge functions e o custo em
// créditos leem daqui. Antes a lista vivia só na tela, e um dos IDs
// ("claude-sonnet-4-6") não existia — quem o selecionasse teria o agente
// falhando em silêncio na chamada à Anthropic.
//
// O roteamento entre provedores é por prefixo: `model.startsWith("gpt")` vai
// para a OpenAI, o resto para a Anthropic. Ao adicionar modelo novo, respeite
// isso ou ajuste o `callAI` das functions junto.

export type NivelModelo = "economico" | "equilibrado" | "maximo";

export interface ModeloIA {
  value:  string;
  label:  string;
  nivel:  NivelModelo;
  /** Para que serve, em uma linha — aparece na tela ao escolher. */
  quando: string;
  /** Multiplicador de crédito. Opus custa muito mais que Haiku por chamada;
   *  cobrar o mesmo pelos dois faria o plano perder dinheiro exatamente nos
   *  workspaces que mais usam o modelo caro. */
  multiplicador: number;
}

export const MODELOS: ModeloIA[] = [
  {
    value: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    nivel: "economico",
    quando: "Volume alto e decisão simples — triagem, classificação de resposta",
    multiplicador: 1,
  },
  {
    value: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    nivel: "equilibrado",
    quando: "Conversa com o cliente — entende contexto sem custar como o Opus",
    multiplicador: 3,
  },
  {
    value: "claude-opus-5",
    label: "Claude Opus 5",
    nivel: "maximo",
    quando: "Quando errar custa dinheiro — negociação de dívida, regra complexa",
    multiplicador: 8,
  },
  {
    value: "gpt-4o-mini",
    label: "GPT-4o Mini",
    nivel: "economico",
    quando: "Alternativa econômica, se seu workspace usa OpenAI",
    multiplicador: 1,
  },
];

export const MODELO_PADRAO = MODELOS[0].value;

export function modeloPorId(id: string | null | undefined): ModeloIA | undefined {
  return MODELOS.find((m) => m.value === id);
}

/** Multiplicador de crédito do modelo; 1 quando desconhecido (não penaliza
 *  agente configurado antes desta lista existir). */
export function multiplicadorDoModelo(id: string | null | undefined): number {
  return modeloPorId(id)?.multiplicador ?? 1;
}

/**
 * Modelo sugerido por tipo de agente.
 *
 * A triagem roda em TODA mensagem que chega e só precisa escolher um setor —
 * é o pior lugar para gastar com o modelo caro. Já a negociação decide valor
 * de desconto e parcela: ali um erro sai mais caro que a diferença de preço
 * entre os modelos.
 */
export const SUGESTAO: Record<"triagem" | "setor" | "negociacao", string> = {
  triagem:    "claude-haiku-4-5-20251001",
  setor:      "claude-sonnet-5",
  negociacao: "claude-opus-5",
};

export const NIVEL_ESTILO: Record<NivelModelo, { cor: string; fundo: string; rotulo: string }> = {
  economico:   { cor: "#3fb06c", fundo: "rgba(63,176,108,0.12)", rotulo: "Econômico"   },
  equilibrado: { cor: "#60a5fa", fundo: "rgba(59,130,246,0.12)", rotulo: "Equilibrado" },
  maximo:      { cor: "#c084fc", fundo: "rgba(168,85,247,0.12)", rotulo: "Máximo"      },
};
