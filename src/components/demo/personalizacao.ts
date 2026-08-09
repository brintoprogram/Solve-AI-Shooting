// Personalização das demonstrações para a reunião.
//
// "2.847 pessoas" é um número de brochura. "os 8.400 clientes da Fazenda Bom
// Retiro" é o negócio da pessoa que está do outro lado da mesa. A demo passa de
// apresentação a simulação, e é a diferença entre "entendi o produto" e "isso
// é pra mim".
//
// Fica no navegador de propósito: é preparação de reunião, não configuração do
// produto. Não deve virar dado de workspace nem aparecer para o cliente depois.

const CHAVE = "demo:personalizacao";

export interface Contexto {
  /** Nome da empresa do prospect. Vazio = usa o genérico. */
  empresa: string;
  /** Tamanho da base dele. Todos os números da demo escalam a partir daqui. */
  base: number;
}

export const PADRAO: Contexto = { empresa: "", base: 2847 };

export function ler(): Contexto {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return PADRAO;
    const p = JSON.parse(cru) as Partial<Contexto>;
    return {
      empresa: typeof p.empresa === "string" ? p.empresa : PADRAO.empresa,
      base: Number.isFinite(p.base) && (p.base as number) > 0 ? Math.floor(p.base as number) : PADRAO.base,
    };
  } catch { return PADRAO; }
}

export function salvar(c: Contexto): void {
  try { localStorage.setItem(CHAVE, JSON.stringify(c)); } catch { /* modo anônimo */ }
}

const nf = new Intl.NumberFormat("pt-BR");

/**
 * Troca os marcadores do roteiro.
 *
 *   {empresa}   nome da empresa, ou "a empresa" quando não preenchido
 *   {base}      tamanho da base
 *   {pct:14}    14% da base, arredondado — é assim que os números da demo
 *               acompanham a escala do prospect em vez de ficarem fixos
 *
 * Percentual e não valor absoluto porque a proporção entre entregue, lido e
 * respondido precisa continuar coerente em qualquer tamanho de base. Com
 * números fixos, uma base de 300 mostraria "1.930 entregues".
 */
export function aplicar(texto: string, c: Contexto): string {
  return texto
    .replace(/\{empresa\}/g, c.empresa.trim() || "a empresa")
    .replace(/\{base\}/g, nf.format(c.base))
    .replace(/\{pct:(\d+(?:\.\d+)?)\}/g, (_, p: string) =>
      nf.format(Math.max(1, Math.round((c.base * Number(p)) / 100))));
}

/** Aplica em todo campo de texto de um passo, sem o player precisar saber
 *  quais campos existem em cada tipo. */
export function aplicarEm<T>(passo: T, c: Contexto): T {
  const CAMPOS = ["texto", "detalhe", "valor", "rotulo", "sub", "titulo", "aviso", "acao", "com", "nome"];
  const anda = (v: unknown): unknown => {
    if (typeof v === "string") return aplicar(v, c);
    if (Array.isArray(v)) return v.map(anda);
    if (v && typeof v === "object") {
      const saida: Record<string, unknown> = { ...(v as Record<string, unknown>) };
      for (const k of Object.keys(saida)) {
        if (CAMPOS.includes(k) || typeof saida[k] === "object") saida[k] = anda(saida[k]);
      }
      return saida;
    }
    return v;
  };
  return anda(passo) as T;
}
