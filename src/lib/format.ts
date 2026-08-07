// Formatadores canônicos do projeto.
//
// Antes desta consolidação existiam 8 implementações de formatação de moeda e
// 5 de `initials()` espalhadas pelas páginas — com comportamentos sutilmente
// diferentes entre si. As variações reais estão preservadas em funções
// separadas e nomeadas, em vez de unificadas à força, para não mudar o que
// cada tela já exibe hoje.

const BRL          = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const BRL_NO_CENTS = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** "R$ 1.234,56". Formata sempre, inclusive zero ("R$ 0,00"). */
export function formatBRL(v: number): string {
  return BRL.format(v);
}

/**
 * Igual a formatBRL, mas devolve um placeholder para valores ausentes.
 * Atenção: zero também vira placeholder — é o comportamento `if (!v)` que as
 * telas de automação já usavam. O separador é parametrizável porque parte do
 * código usa travessão ("—") e parte usa hífen ("-").
 */
export function formatBRLOrDash(v: number | null | undefined, empty = "—"): string {
  if (!v) return empty;
  return BRL.format(v);
}

/** "R$ 1.235" — sem centavos. Usado nos cartões do Dashboard. */
export function formatBRLCompact(v: number): string {
  return BRL_NO_CENTS.format(v);
}

/**
 * "31/07/2026" a partir de uma data ISO (YYYY-MM-DD).
 * O sufixo "T00:00:00" força interpretação no fuso local: sem ele o JS lê
 * "2026-07-31" como UTC e exibe o dia anterior em fusos negativos como o Brasil.
 */
export function formatDate(iso: string | null | undefined, empty = "—"): string {
  if (!iso) return empty;
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("pt-BR");
}

/** "31/07/2026 14:32" a partir de um timestamp ISO completo. */
export function formatDateTime(iso: string | null | undefined, empty = "—"): string {
  if (!iso) return empty;
  return new Date(iso).toLocaleString("pt-BR");
}

/**
 * Iniciais para avatar: "Bruno Araújo" → "BA", "Bruno" → "BR".
 *
 * Nota: a versão que existia em AuthContext devolvia apenas 1 letra para nomes
 * de palavra única ("Bruno" → "B"), divergindo das outras 4 cópias. Adotamos a
 * versão de 2 letras, que era a maioria e preenche melhor o avatar.
 */
export function initials(name: string | null | undefined): string {
  if (!name?.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Telefone BR legível: "5511998887777" → "+55 (11) 99888-7777".
 *
 * Trata os 4 comprimentos que aparecem na base (13/12 com DDI, 11/10 sem) e
 * devolve a string original quando não reconhece o formato — melhor mostrar o
 * número cru do que esconder o dado. A versão anterior em lib/utils.ts só
 * cobria 13 dígitos e não tratava null; foi descartada.
 */
export function formatPhone(raw: string | null | undefined, empty = "—"): string {
  if (!raw) return empty;
  const d = raw.replace(/\D/g, "");

  // O mesmo telefone chega gravado com e sem o código do país — depende da
  // planilha que originou o contato. Exibir "+55 (62) 9967-9017" para um e
  // "(62) 9967-9017" para outro fazia a coluna parecer ter dois formatos e
  // estourava a largura no primeiro caso. Aqui o 55 é retirado quando sobra um
  // número brasileiro válido, então os dois viram a mesma coisa na tela.
  const br = d.startsWith("55") && (d.length === 12 || d.length === 13)
    ? d.slice(2)
    : d;

  if (br.length === 11) return `(${br.slice(0, 2)}) ${br.slice(2, 7)}-${br.slice(7)}`;
  if (br.length === 10) return `(${br.slice(0, 2)}) ${br.slice(2, 6)}-${br.slice(6)}`;

  // Número estrangeiro (ou fora do padrão): mantém o formato internacional,
  // porque aí o código do país é informação, não ruído.
  if (d.length > 11) return `+${d}`;
  return raw;
}

/**
 * Chave canônica de telefone, para comparar dois registros.
 *
 * Existe porque `cleanPhone` só tira pontuação: "5515997721491" e
 * "15997721491" são o MESMO telefone e viravam chaves diferentes, then a
 * importação criava dois contatos para a mesma pessoa. Isso é visível na base:
 * o mesmo cliente aparece duplicado, um registro com código do país e outro
 * sem.
 *
 * Não serve para exibir nem para enviar mensagem — só para comparar.
 */
export function phoneKey(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.startsWith("55") && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
}

/**
 * Dias de atraso de um vencimento. Negativo = ainda vai vencer.
 *
 * Compara data-calendário, não instante: ambos os lados são normalizados para
 * meia-noite local. Sem isso, um boleto que vence hoje apareceria como
 * "vencido" ou "a vencer" dependendo da hora em que a tela foi aberta.
 */
export function diasDeAtraso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const venc = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(venc.getTime())) return null;
  venc.setHours(0, 0, 0, 0);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((hoje.getTime() - venc.getTime()) / 86_400_000);
}
