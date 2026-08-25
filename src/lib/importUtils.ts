// ─────────────────────────────────────────────────────────────────
//  importUtils.ts — Parsing, limpeza e upsert de planilhas
//  Suporta .csv (PapaParse) e .xlsx (SheetJS)
// ─────────────────────────────────────────────────────────────────

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";
import { phoneKey } from "./format";

// ── Tipos públicos ────────────────────────────────────────────────

export type RawRow = (string | number | null | undefined)[];

export interface ParsedFile {
  headers: string[];
  rows:    RawRow[];
}

/** Campos mapeáveis — prefix "inv_" = pertence a contact_invoices */
export const MAPPABLE_FIELDS = [
  // ── Contato ─────────────────────────────────────────────────────
  { key: "name",                label: "Nome / Razão Social",     category: "contact" as const },
  { key: "phone",               label: "Telefone / WhatsApp",     category: "contact" as const },
  { key: "cpf_cnpj",            label: "CPF / CNPJ",              category: "contact" as const },
  { key: "empresa",             label: "Nome Fantasia / Empresa",  category: "contact" as const },
  { key: "email",               label: "E-mail",                  category: "contact" as const },
  { key: "email2",              label: "E-mail 2",                category: "contact" as const },
  { key: "nome_representante",  label: "Nome do Representante",   category: "contact" as const },
  { key: "email_representante", label: "E-mail do Representante", category: "contact" as const },
  { key: "gerente1_nome",       label: "Nome do Gerente 1",        category: "contact" as const },
  { key: "gerente1_email",      label: "E-mail do Gerente 1",      category: "contact" as const },
  { key: "gerente2_nome",       label: "Nome do Gerente 2",        category: "contact" as const },
  { key: "gerente2_email",      label: "E-mail do Gerente 2",      category: "contact" as const },
  { key: "cep",                 label: "CEP",                     category: "contact" as const },
  { key: "logradouro",          label: "Logradouro / Rua",        category: "contact" as const },
  { key: "numero",              label: "Número",                  category: "contact" as const },
  { key: "complemento",         label: "Complemento",             category: "contact" as const },
  { key: "bairro",              label: "Bairro",                  category: "contact" as const },
  { key: "cidade",              label: "Cidade",                  category: "contact" as const },
  { key: "estado",              label: "Estado / UF",             category: "contact" as const },
  { key: "tags",                label: "Tags (separadas por ;)",  category: "contact" as const },
  // ── Boleto ──────────────────────────────────────────────────────
  { key: "inv_valor",           label: "Valor do Boleto",         category: "invoice" as const },
  { key: "inv_vencimento",      label: "Data de Vencimento",      category: "invoice" as const },
  { key: "inv_numero_nf",       label: "Número NF / Boleto",      category: "invoice" as const },
  { key: "inv_codigo_barras",   label: "Código de Barras",        category: "invoice" as const },
  { key: "inv_status",          label: "Status do Boleto",        category: "invoice" as const },
] as const;

export type FieldKey = typeof MAPPABLE_FIELDS[number]["key"];

/** fileCol → fieldKey (ou "" para ignorar) */
export type Mapping = Record<string, FieldKey | "">;

export interface MappedRow {
  // contact
  name?:                string;
  phone?:               string;
  cpf_cnpj?:            string;
  empresa?:             string;
  email?:               string;
  email2?:              string;
  nome_representante?:  string;
  email_representante?: string;
  gerente1_nome?:       string;
  gerente1_email?:      string;
  gerente2_nome?:       string;
  gerente2_email?:      string;
  cep?:                 string;
  logradouro?:          string;
  numero?:              string;
  complemento?:         string;
  bairro?:              string;
  cidade?:              string;
  estado?:              string;
  tags?:                string[];
  // invoice
  inv_valor?:           number;
  inv_vencimento?:      string;   // "YYYY-MM-DD"
  inv_numero_nf?:       string;
  inv_codigo_barras?:   string;
  inv_status?:          string;
}

export interface ImportStats {
  contactsInserted: number;
  contactsUpdated:  number;
  invoicesCreated:  number;
  /** Boletos ignorados por já existirem (reimportação da mesma planilha). */
  invoicesSkipped:  number;
  skipped:          number;
  errors:           string[];

  /* ── Contabilidade do que NÃO entrou ──────────────────────────────
     Antes existia um caminho pelo qual um boleto sumia sem aparecer em
     contador nenhum: quando o contato dele não era encontrado, a linha virava
     null e era filtrada fora. Não entrava em criados, nem em ignorados, nem em
     erros. A pessoa via "12 boletos criados" numa planilha de 40 e não tinha
     como saber que 28 evaporaram, nem por quê. */

  /** Boletos descartados por não ter dono no sistema. */
  invoicesSemDono:  number;
  /** Linhas sem telefone e sem CPF: não há como identificar a pessoa. */
  semChave:         number;
  /** Linhas só com CPF, cujo CPF não existe na base. Não criam contato. */
  cpfNaoEncontrado: number;
}

// ── Palavras-chave para auto-detecção ─────────────────────────────

// Cada campo lista os termos em português E em inglês. Planilha de cliente vem
// do sistema que ele usa, e sistema financeiro costuma vir em inglês — "Due
// Date", "Amount", "Outstanding Balance". Sem esses termos o mapeamento vinha
// vazio e a pessoa preenchia 25 combos à mão, que é onde ela desiste.
const DETECT: Partial<Record<FieldKey, string[]>> = {
  name:                ["nome", "nome completo", "devedor", "cliente", "razão social", "razao social", "sacado", "favorecido", "beneficiario",
                        "name", "full name", "customer", "customer name", "client", "client name", "debtor", "payer", "contact name"],
  phone:               ["telefone", "fone", "celular", "cel", "whatsapp", "zap", "tel",
                        "phone", "phone number", "mobile", "mobile number", "cell", "cellphone"],
  cpf_cnpj:            ["cpf", "cnpj", "cpf_cnpj", "documento", "doc", "cadastro", "inscricao",
                        "document", "tax id", "taxid", "tax number", "national id", "vat"],
  empresa:             ["empresa", "fantasia", "nome fantasia", "razão",
                        "company", "company name", "organization", "organisation", "business", "account name"],
  email:               ["email", "e-mail", "correio", "email address", "e-mail address", "mail"],
  email2:              ["email2", "e-mail 2", "segundo email", "email 2", "secondary email", "alternate email"],
  nome_representante:  ["representante", "responsável", "responsavel", "contato",
                        "representative", "contact person", "attention"],
  email_representante: ["email representante", "e-mail representante", "email_representante", "representative email"],
  gerente1_nome:       ["gerente1 nome", "nome gerente 1", "gerente1_nome", "gerente 1", "manager 1", "manager name"],
  gerente1_email:      ["gerente1 email", "email gerente 1", "gerente1_email", "e-mail gerente 1", "manager 1 email"],
  gerente2_nome:       ["gerente2 nome", "nome gerente 2", "gerente2_nome", "gerente 2", "manager 2"],
  gerente2_email:      ["gerente2 email", "email gerente 2", "gerente2_email", "e-mail gerente 2", "manager 2 email"],
  cep:                 ["cep", "zip", "zip code", "zipcode", "postal", "postal code", "postcode"],
  logradouro:          ["logradouro", "endereço", "endereco", "rua", "avenida",
                        "address", "street", "street address", "address line 1", "address1"],
  numero:              ["número", "numero", "nº", "n°", "num", "street number", "house number"],
  complemento:         ["complemento", "comp", "apto", "apartamento", "address line 2", "address2", "suite", "unit"],
  bairro:              ["bairro", "district", "neighborhood", "neighbourhood"],
  cidade:              ["cidade", "municipio", "município", "city", "town"],
  estado:              ["estado", "uf", "state", "province", "region"],
  tags:                ["tags", "tag", "categoria", "grupo", "classificação", "category", "group", "segment", "label"],
  inv_valor:           ["valor", "quantia", "montante", "dívida", "divida", "saldo", "valor boleto", "vlr", "valor total",
                        "value", "amount", "total", "total amount", "balance", "outstanding", "outstanding balance",
                        "debt", "due amount", "amount due", "price"],
  inv_vencimento:      ["vencimento", "venc", "data vencimento", "data de vencimento", "prazo",
                        "due", "due date", "duedate", "expiry", "expiration", "expiration date", "maturity", "payment date", "date"],
  inv_numero_nf:       ["nf", "nota fiscal", "número boleto", "num boleto", "ref", "referência", "referencia", "boleto",
                        "invoice", "invoice number", "invoice no", "invoice id", "reference", "document number", "order id"],
  inv_codigo_barras:   ["código de barras", "codigo barras", "linha digitável", "barcode", "bar code", "digitable line"],
  inv_status:          ["status", "situação", "situacao", "status boleto", "payment status", "paid"],
};

const semAcento = (t: string): string =>
  t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

/** Quão bem um cabeçalho casa com um termo. Maior é melhor; 0 é não casa.
 *
 *  A versão anterior usava `includes` e ficava com a PRIMEIRA que casasse, na
 *  ordem em que os campos estavam escritos no arquivo. Isso fazia "Company
 *  Name" virar Nome, porque contém "name" e Nome vem antes de Empresa, e
 *  deixava "Preferência" virar Número do Boleto, por conter "ref". Casar por
 *  palavra inteira e pontuar resolve os dois: termo específico ganha de termo
 *  curto, independente da ordem em que foram escritos. */
function pontuar(cabecalho: string, termo: string): number {
  if (cabecalho === termo) return 1000;
  const compacto = (t: string) => t.replace(/[\s_\-.]/g, "");
  if (compacto(cabecalho) === compacto(termo)) return 900;

  const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(^|[^a-z0-9])${escapado}($|[^a-z0-9])`).test(cabecalho)) {
    return 500 + termo.length;   // palavra inteira: "Due Date" acha "due"
  }
  if (cabecalho.includes(termo)) {
    return 100 + termo.length;   // pedaço solto: fraco de propósito
  }
  return 0;
}

export type Confianca = "exata" | "forte" | "fraca" | "nenhuma";

export interface Deteccao {
  campo: FieldKey | "";
  confianca: Confianca;
  /** O termo que fez casar. É o "porquê" que a tela mostra ao usuário. */
  termo: string | null;
}

/**
 * Reconhece as colunas e diz POR QUE reconheceu cada uma.
 *
 * A atribuição é global e gulosa, não coluna a coluna: todos os pares
 * (cabeçalho, campo) são pontuados e os melhores casam primeiro. Sem isso,
 * uma planilha com "Nome" e "Nome Fantasia" dependia de qual coluna vinha
 * antes — a primeira levava o campo Nome e a segunda ficava sem nada.
 */
export function autoDetectDetalhado(headers: string[]): Record<string, Deteccao> {
  const candidatos: { header: string; campo: FieldKey; termo: string; pts: number }[] = [];

  for (const header of headers) {
    const norm = semAcento(header);
    if (!norm) continue;
    for (const [campo, termos] of Object.entries(DETECT) as [FieldKey, string[]][]) {
      let melhor = 0;
      let melhorTermo = "";
      for (const t of termos) {
        const p = pontuar(norm, semAcento(t));
        if (p > melhor) { melhor = p; melhorTermo = t; }
      }
      if (melhor > 0) candidatos.push({ header, campo, termo: melhorTermo, pts: melhor });
    }
  }

  candidatos.sort((a, b) => b.pts - a.pts);

  const saida: Record<string, Deteccao> = {};
  for (const h of headers) saida[h] = { campo: "", confianca: "nenhuma", termo: null };
  const camposUsados = new Set<FieldKey>();

  for (const c of candidatos) {
    if (saida[c.header].campo || camposUsados.has(c.campo)) continue;
    saida[c.header] = {
      campo: c.campo,
      confianca: c.pts >= 900 ? "exata" : c.pts >= 500 ? "forte" : "fraca",
      termo: c.termo,
    };
    camposUsados.add(c.campo);
  }
  return saida;
}

export function autoDetect(headers: string[]): Mapping {
  const detalhado = autoDetectDetalhado(headers);
  const mapping: Mapping = {};
  for (const h of headers) mapping[h] = detalhado[h]?.campo ?? "";
  return mapping;
}

// ── Limpeza / parsing de tipos ────────────────────────────────────

/** Remove tudo exceto dígitos (e + inicial para E.164) */
export function cleanPhone(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const cleaned = s.replace(/[^\d+]/g, "");
  // Garante que números brasileiros sem DDD internacional ficam com 55
  // mas não força se já começar com + ou 55
  return cleaned;
}

/** Remove pontos, traços, barras — só dígitos */
export function cleanDocument(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "").trim();
}

/**
 * Parsing de valor monetário com precisão correta.
 * Suporta: "R$ 1.250,90" | "1250.90" | "1250,90" | "1,250.90" | 1250.9 (number)
 * Retorna número com 2 casas decimais usando inteiros internamente.
 */
export function parseValor(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;

  if (typeof raw === "number") {
    // Vem do XLSX já como número — arredonda para 2 casas via inteiros
    return Math.round(raw * 100) / 100;
  }

  let s = String(raw)
    .trim()
    .replace(/R\$\s*/gi, "")   // remove "R$"
    .replace(/\s/g, "")        // remove espaços internos
    .replace(/['"]/g, "");     // remove aspas

  if (!s) return null;

  const hasDot   = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    const lastDot   = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastComma > lastDot) {
      // Formato BR: 1.250,90  → remove pontos, substitui vírgula por ponto
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // Formato US: 1,250.90  → remove vírgulas
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      // Decimal BR: 1250,90
      s = s.replace(",", ".");
    } else {
      // Milhares: 1,250  → remove vírgula
      s = s.replace(/,/g, "");
    }
  } else if (hasDot) {
    // Só ponto, e aqui morava o pior erro do importador: "1.250" caía direto
    // no parseFloat e virava 1,25 — mil vezes menor. "1.234.567" virava 1,23.
    // Valor SEM centavos é o formato mais comum de planilha de cobrança, então
    // não era um caso de canto.
    //
    // Desempate pelo tamanho do último grupo: em pt-BR o separador de milhar
    // sempre agrupa de três em três. "1.250" é mil duzentos e cinquenta;
    // "1.25" é um e vinte e cinco.
    const grupos = s.split(".");
    const ultimo = grupos[grupos.length - 1];
    const parteInteira = grupos[0];
    // "0.500" é meio, não quinhentos: ninguém escreve zero milhar.
    if (parteInteira !== "0" && (grupos.length > 2 || ultimo.length === 3)) {
      s = s.replace(/\./g, "");
    }
  }

  const num = parseFloat(s);
  if (isNaN(num) || num < 0) return null;

  // Operação com inteiros para eliminar erro de ponto flutuante
  return Math.round(num * 100) / 100;
}

/** Ordem dos dois primeiros números numa data escrita com barras.
 *  "dmy" = 03/04 é 3 de abril (Brasil). "mdy" = 03/04 é 4 de março (EUA). */
export type OrdemData = "dmy" | "mdy";

/** Monta a data só se ela existir de verdade. 31/02 e mês 25 param aqui.
 *  Antes, "12/25/2026" produzia a string "2026-25-12" — um mês 25 que seguia
 *  adiante no sistema em vez de ser recusado na entrada. */
function montarData(dia: number, mes: number, ano: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 1900 || ano > 2200) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Converte vários formatos de data para "YYYY-MM-DD".
 *
 * O parâmetro `ordem` existe porque 03/04/2026 é genuinamente ambíguo: não há
 * como olhar para esse valor sozinho e saber se é 3 de abril ou 4 de março.
 * Antes o sistema assumia DD/MM em silêncio — numa planilha em inglês isso
 * errava o mês em TODA linha cujo dia fosse menor ou igual a 12, e acertava no
 * resto. Metade certa é o pior resultado possível: a conferência por
 * amostragem passa e o erro só aparece na cobrança.
 *
 * Quando os próprios dados provam a ordem (um 25 na primeira posição, ou um 13
 * na segunda), a prova ganha do parâmetro.
 */
export function parseDate(raw: unknown, ordem: OrdemData = "dmy"): string | null {
  if (raw === null || raw === undefined || raw === "") return null;

  // Serial do Excel (número inteiro)
  if (typeof raw === "number") {
    // Época Excel = 1 Jan 1900 (com o bug do 1900 como bissexto)
    const date = new Date(Math.round((raw - 25569) * 86_400_000));
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  const s = String(raw).trim();

  // a/b/yyyy ou a-b-yyyy — o formato ambíguo.
  const dois = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dois) {
    const a = Number(dois[1]), b = Number(dois[2]), ano = Number(dois[3]);
    // Um valor acima de 12 só pode ser dia: os dados decidem sozinhos.
    if (a > 12 && b <= 12) return montarData(a, b, ano);
    if (b > 12 && a <= 12) return montarData(b, a, ano);
    // Ambíguo de verdade: vale o que foi escolhido.
    return ordem === "dmy" ? montarData(a, b, ano) : montarData(b, a, ano);
  }

  // YYYY-MM-DD (ISO, não ambíguo)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return montarData(Number(iso[3]), Number(iso[2]), Number(iso[1]));

  // Texto por extenso em inglês ("Apr 3, 2026"): aqui não há ambiguidade,
  // o mês vem escrito.
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return null;
}

// ── Leitura transparente de uma coluna ────────────────────────────
// O importador não pode se limitar a acertar: ele precisa CONSEGUIR MOSTRAR
// como leu. Estas funções produzem o laudo que a tela exibe antes de importar.

export interface LaudoDeData {
  /** Ordem que será usada de fato. */
  ordem: OrdemData;
  /** A coluna tem algum valor cujo significado muda conforme a ordem. */
  ambigua: boolean;
  /** O valor que provou a ordem, quando os dados a provam sozinhos. */
  prova: string | null;
  /** Quantos valores não são data nenhuma. */
  invalidos: number;
  /** Quantos mudariam de significado se a ordem fosse a outra. */
  afetados: number;
}

/**
 * Descobre como uma coluna de datas deve ser lida e o quanto isso é incerto.
 *
 * A prova é o que torna isto confiável: basta UM valor com dia acima de 12 na
 * primeira posição para a coluna inteira estar decidida, sem depender de
 * palpite. Só quando nenhuma linha prova nada é que a escolha vira pergunta
 * para o usuário — e aí a tela precisa avisar, porque é o caso em que o
 * sistema pode estar errando tudo sem nenhum sinal.
 */
export function analisarColunaDeData(valores: unknown[], ordemEscolhida?: OrdemData): LaudoDeData {
  let provaDmy: string | null = null;
  let provaMdy: string | null = null;
  let afetados = 0;
  let invalidos = 0;
  let comData = 0;

  for (const v of valores) {
    if (v === null || v === undefined || v === "") continue;
    comData++;
    if (typeof v === "number") continue;   // serial do Excel não é ambíguo
    const m = String(v).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!m) {
      if (parseDate(v) === null) invalidos++;
      continue;
    }
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) provaDmy ??= String(v);
    else if (b > 12 && a <= 12) provaMdy ??= String(v);
    else if (a <= 12 && b <= 12 && a !== b) afetados++;
    else if (a > 12 && b > 12) invalidos++;
  }

  // Prova contraditória: a coluna mistura os dois formatos e nenhuma escolha
  // salva todas as linhas. Vale mais avisar do que fingir que decidiu.
  const contraditoria = Boolean(provaDmy && provaMdy);
  const ordem: OrdemData = contraditoria
    ? (ordemEscolhida ?? "dmy")
    : provaDmy ? "dmy" : provaMdy ? "mdy" : (ordemEscolhida ?? "dmy");

  return {
    ordem,
    ambigua: contraditoria || (!provaDmy && !provaMdy && afetados > 0),
    prova: contraditoria ? null : (provaDmy ?? provaMdy),
    invalidos,
    afetados: comData === 0 ? 0 : afetados,
  };
}

// ── Como o sistema leu cada célula ────────────────────────────────
// A prévia mostrava o valor BRUTO, que é o que a pessoa já sabe. O que ela
// precisa ver é a interpretação: "1.250" virou quanto? "03/04/2026" virou que
// dia? É aí que um erro de leitura aparece antes de virar cobrança errada.

export type TipoDeLeitura = "texto" | "dinheiro" | "data" | "telefone" | "documento" | "lista";

export function tipoDoCampo(campo: FieldKey): TipoDeLeitura {
  if (campo === "inv_valor") return "dinheiro";
  if (campo === "inv_vencimento") return "data";
  if (campo === "phone") return "telefone";
  if (campo === "cpf_cnpj") return "documento";
  if (campo === "tags") return "lista";
  return "texto";
}

export interface Interpretacao {
  /** Como o sistema entendeu o valor, pronto para exibir. */
  lido: string;
  /** false quando o valor existe mas o sistema não conseguiu entender. */
  ok: boolean;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
               "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/**
 * Traduz uma célula para o que o sistema entendeu dela.
 *
 * A data sai por extenso de propósito. "2026-04-03" e "03/04/2026" são as duas
 * formas que a pessoa já não sabe distinguir — é exatamente a confusão que
 * estamos tentando resolver. "3 de abril de 2026" não tem como ser lido errado.
 */
export function interpretar(campo: FieldKey, bruto: unknown, ordem: OrdemData = "dmy"): Interpretacao {
  const vazio = bruto === null || bruto === undefined || String(bruto).trim() === "";
  if (vazio) return { lido: "—", ok: true };

  switch (tipoDoCampo(campo)) {
    case "dinheiro": {
      const n = parseValor(bruto);
      return n === null
        ? { lido: "não reconheci como valor", ok: false }
        : { lido: n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), ok: true };
    }
    case "data": {
      const iso = parseDate(bruto, ordem);
      if (!iso) return { lido: "não reconheci como data", ok: false };
      const [a, m, d] = iso.split("-");
      return { lido: `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`, ok: true };
    }
    case "telefone": {
      const t = cleanPhone(bruto);
      // Telefone curto demais não é erro de formato, é linha que não vai
      // receber nada. Melhor dizer agora do que na hora do disparo.
      if (t.replace(/\D/g, "").length < 12) return { lido: `${t || String(bruto)} — curto demais`, ok: false };
      return { lido: t, ok: true };
    }
    case "documento": {
      const d = cleanDocument(bruto);
      if (d.length === 11) return { lido: `CPF ${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`, ok: true };
      if (d.length === 14) return { lido: `CNPJ ${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`, ok: true };
      return { lido: `${d || String(bruto)} — não é CPF nem CNPJ`, ok: false };
    }
    case "lista": {
      const itens = String(bruto).split(";").map((s) => s.trim()).filter(Boolean);
      return { lido: itens.length ? itens.join(" · ") : "—", ok: true };
    }
    default:
      return { lido: String(bruto).trim(), ok: true };
  }
}

const VALID_STATUSES = new Set(["pendente", "pago", "vencido", "cancelado"]);

function parseStatus(raw: unknown): string {
  const s = String(raw ?? "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (VALID_STATUSES.has(s)) return s;
  if (s.includes("pag")) return "pago";
  if (s.includes("venc")) return "vencido";
  if (s.includes("canc")) return "cancelado";
  return "pendente";
}

// ── Leitura de arquivo ────────────────────────────────────────────

export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    return parseCsv(await file.text());
  }
  return parseXlsx(await file.arrayBuffer());
}

function parseCsv(text: string): ParsedFile {
  const result = Papa.parse<string[]>(text, {
    header:          false,
    skipEmptyLines:  true,
    encoding:        "UTF-8",
  });

  const [headerRow = [], ...dataRows] = result.data;
  return {
    headers: headerRow.map((h) => String(h).trim()),
    rows:    dataRows,
  };
}

function parseXlsx(buffer: ArrayBuffer): ParsedFile {
  const wb   = XLSX.read(buffer, { type: "array", raw: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data  = XLSX.utils.sheet_to_json<RawRow>(sheet, {
    header:  1,
    defval:  "",
    raw:     true,
    blankrows: false,
  });

  if (data.length === 0) return { headers: [], rows: [] };

  const [headerRow, ...dataRows] = data;
  const headers = (headerRow as unknown[]).map((h) => String(h ?? "").trim());

  return {
    headers,
    rows: dataRows.filter((row) =>
      (row as unknown[]).some((c) => c !== "" && c !== null && c !== undefined)
    ),
  };
}

// ── Aplicar mapeamento ────────────────────────────────────────────

export function applyMapping(
  headers: string[],
  rows:    RawRow[],
  mapping: Mapping,
  /* A ordem escolhida na tela de leitura precisa chegar ATE AQUI. Sem isso a
     tela mostraria "3 de abril" e o banco receberia 4 de marco — uma prévia
     que mente é pior do que prévia nenhuma, porque autoriza o erro. */
  ordemData: OrdemData = "dmy",
): MappedRow[] {
  const colIndex = Object.fromEntries(headers.map((h, i) => [h, i]));

  return rows.map((row) => {
    const get = (field: FieldKey): unknown => {
      const col = Object.entries(mapping).find(([, v]) => v === field)?.[0];
      if (!col) return undefined;
      return row[colIndex[col]];
    };

    const mapped: MappedRow = {};

    const name    = String(get("name") ?? "").trim();
    const phone   = cleanPhone(get("phone"));
    const cpfCnpj = cleanDocument(get("cpf_cnpj"));

    if (name)    mapped.name    = name;
    if (phone)   mapped.phone   = phone;
    if (cpfCnpj) mapped.cpf_cnpj = cpfCnpj;

    const strFields = [
      "empresa", "email", "email2", "nome_representante", "email_representante",
      "gerente1_nome", "gerente1_email", "gerente2_nome", "gerente2_email",
      "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "estado",
    ] as const;
    for (const f of strFields) {
      const v = String(get(f as FieldKey) ?? "").trim();
      if (v) (mapped as Record<string, unknown>)[f] = v;
    }

    const rawTags = String(get("tags") ?? "").trim();
    if (rawTags) mapped.tags = rawTags.split(/[;,|]/).map((t) => t.trim()).filter(Boolean);

    const valor = parseValor(get("inv_valor"));
    if (valor !== null) mapped.inv_valor = valor;

    const venc = parseDate(get("inv_vencimento"), ordemData);
    if (venc) mapped.inv_vencimento = venc;

    const nf = String(get("inv_numero_nf") ?? "").trim();
    if (nf) mapped.inv_numero_nf = nf;

    const cb = String(get("inv_codigo_barras") ?? "").trim();
    if (cb) mapped.inv_codigo_barras = cb;

    const st = get("inv_status");
    if (st) mapped.inv_status = parseStatus(st);

    return mapped;
  });
}

// ── Import principal (Upsert inteligente) ─────────────────────────

const CHUNK = 80; // seguro abaixo do limite do PostgREST


export async function runImport(
  rows:        MappedRow[],
  workspaceId: string,
  onProgress:  (phase: string, done: number, total: number) => void,
): Promise<ImportStats> {
  const stats: ImportStats = {
    contactsInserted: 0,
    contactsUpdated:  0,
    invoicesCreated:  0,
    invoicesSkipped:  0,
    skipped:          0,
    errors:           [],
    invoicesSemDono:  0,
    semChave:         0,
    cpfNaoEncontrado: 0,
  };

  // Separa linhas com phone e sem phone
  const withPhone    = rows.filter((r) => r.phone);
  const withoutPhone = rows.filter((r) => !r.phone && r.cpf_cnpj);
  const noKey        = rows.filter((r) => !r.phone && !r.cpf_cnpj);
  stats.skipped  += noKey.length;
  stats.semChave += noKey.length;

  // Mapa dedup de contatos (phone → dados mais completos)
  // skippedRows: linhas "perdedoras" do dedup com nome diferente —
  // o boleto delas NÃO deve ser criado (evita boleto no contato errado).
  const contactMap  = new Map<string, MappedRow>();
  const skippedRows = new Set<MappedRow>();

  for (const r of withPhone) {
    const existing = contactMap.get(r.phone!);
    if (existing) {
      if (existing.name && r.name && existing.name !== r.name) {
        stats.errors.push(
          `Telefone ${r.phone} duplicado: "${existing.name}" mantido, "${r.name}" ignorado — verifique a planilha`
        );
        skippedRows.add(r); // boleto desta linha será pulado
      }
    }
    contactMap.set(r.phone!, mergeRow(existing, r));
  }

  // ─── 1. Upsert contatos com phone ────────────────────────────────
  const contactsWithPhone = [...contactMap.values()];
  const total1 = contactsWithPhone.length;
  onProgress("Importando contatos…", 0, total1);

  // Mapa phone → contact_id (preenchido após upsert)
  const phoneIdMap  = new Map<string, string>();
  const cpfIdMap    = new Map<string, string>();

  for (let i = 0; i < contactsWithPhone.length; i += CHUNK) {
    const chunk = contactsWithPhone.slice(i, i + CHUNK);
    const rows_ = chunk.map((r) => toContactRow(r, workspaceId));

    const { data, error } = await supabase
      .from("inbox_contacts")
      .upsert(rows_, { onConflict: "workspace_id,phone", ignoreDuplicates: false })
      .select("id, phone, cpf_cnpj");

    if (error) {
      stats.errors.push(`Contatos chunk ${i}: ${error.message}`);
    } else if (data) {
      for (const c of data) {
        // Chave canonica: o mesmo telefone chega com e sem o codigo do pais
        // dependendo da planilha. Sem normalizar, o boleto de uma linha nao
        // encontrava o contato criado por outra e ficava orfao.
        if (c.phone)    phoneIdMap.set(phoneKey(c.phone), c.id);
        if (c.cpf_cnpj) cpfIdMap.set(c.cpf_cnpj, c.id);
      }
      // Conta inseridos vs atualizados (Supabase não diferencia, estimamos)
      stats.contactsInserted += chunk.length;
    }
    onProgress("Importando contatos…", Math.min(i + CHUNK, total1), total1);
  }

  // ─── 2. Atualizar contatos SEM phone (busca por cpf_cnpj) ────────
  if (withoutPhone.length > 0) {
    onProgress("Atualizando contatos por CPF/CNPJ…", 0, withoutPhone.length);
    const cpfList = [...new Set(withoutPhone.map((r) => r.cpf_cnpj!))];
    const { data: existing } = await supabase
      .from("inbox_contacts")
      .select("id, cpf_cnpj")
      .eq("workspace_id", workspaceId)
      .in("cpf_cnpj", cpfList);

    const existingMap = new Map<string, string>((existing ?? []).map((c: { id: string; cpf_cnpj: string }) => [c.cpf_cnpj, c.id]));

    for (const r of withoutPhone) {
      const id = existingMap.get(r.cpf_cnpj!);
      if (!id) { stats.skipped++; stats.cpfNaoEncontrado++; continue; }
      cpfIdMap.set(r.cpf_cnpj!, id);
      await supabase.from("inbox_contacts").update(toContactRow(r, workspaceId, true)).eq("id", id);
      stats.contactsUpdated++;
    }
  }

  // ─── 3. Inserir boletos ───────────────────────────────────────────
  const invoiceRows_ = rows
    .filter((r) => !skippedRows.has(r))                            // pula perdedores do dedup
    .filter((r) => r.inv_valor !== undefined || r.inv_vencimento)
    .map((r) => {
      // Lookup estrito: se a linha tem telefone, usa SÓ telefone.
      // Não faz fallback para CPF — evita atribuir boleto ao contato errado
      // caso o upsert do contato tenha falhado ou o telefone não esteja no mapa.
      const cid: string | undefined =
        r.phone    ? phoneIdMap.get(phoneKey(r.phone))
        : r.cpf_cnpj ? cpfIdMap.get(r.cpf_cnpj)
        : undefined;
      if (!cid) { stats.invoicesSemDono++; return null; }
      return {
        workspace_id:   workspaceId,
        contact_id:     cid,
        valor:          r.inv_valor ?? 0,
        vencimento:     r.inv_vencimento ?? null,
        status:         r.inv_status ?? "pendente",
        numero_nf:      r.inv_numero_nf ?? null,
        codigo_barras:  r.inv_codigo_barras ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // ─── 3b. Não recriar boleto que já existe ─────────────────────────
  //
  // Antes daqui a importação fazia INSERT puro. Subir a mesma planilha duas
  // vezes recriava todos os boletos e a dívida do cliente dobrava — e o
  // agente de IA passava a negociar em cima de um valor que não existe.
  //
  // A identidade de um boleto é o código de barras (a linha digitável é única
  // no país) ou, na falta dele, o número da nota dentro daquele contato.
  // Linha sem os dois não tem como ser identificada: passa direto, porque
  // recusar boleto legítimo é pior que aceitar uma duplicata eventual.
  //
  // Isto é a rede de baixo. A garantia dura são os índices únicos em
  // 20260807_invoice_dedup_and_totals.sql: esta checagem tem janela de corrida
  // (duas importações simultâneas leem "não existe" antes de qualquer uma
  // gravar), o índice não tem.

  const chaveBarras = (cb: string) => `b:${cb.trim()}`;
  const chaveNf     = (cid: string, nf: string) => `n:${cid}:${nf.trim()}`;

  const jaExiste = new Set<string>();

  const contactIds = [...new Set(invoiceRows_.map((r) => r.contact_id))];
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("contact_invoices")
      .select("contact_id, numero_nf, codigo_barras")
      .eq("workspace_id", workspaceId)
      .in("contact_id", contactIds.slice(i, i + CHUNK));

    if (error) {
      // Sem a lista do que já existe não dá para decidir com segurança.
      // Abortar aqui é melhor que gravar duplicata silenciosamente.
      stats.errors.push(`Verificação de boletos existentes: ${error.message}`);
      return stats;
    }
    for (const inv of (data ?? []) as Array<{ contact_id: string; numero_nf: string | null; codigo_barras: string | null }>) {
      if (inv.codigo_barras?.trim()) jaExiste.add(chaveBarras(inv.codigo_barras));
      if (inv.numero_nf?.trim())     jaExiste.add(chaveNf(inv.contact_id, inv.numero_nf));
    }
  }

  const novos: typeof invoiceRows_ = [];
  for (const row of invoiceRows_) {
    const kb = row.codigo_barras?.trim() ? chaveBarras(row.codigo_barras) : null;
    const kn = row.numero_nf?.trim()     ? chaveNf(row.contact_id, row.numero_nf) : null;

    if ((kb && jaExiste.has(kb)) || (kn && jaExiste.has(kn))) {
      stats.invoicesSkipped++;
      continue;
    }
    // Marca já: pega também a planilha que repete a mesma nota em duas linhas.
    if (kb) jaExiste.add(kb);
    if (kn) jaExiste.add(kn);
    novos.push(row);
  }

  const total3 = novos.length;
  onProgress("Importando boletos…", 0, total3);

  for (let i = 0; i < novos.length; i += CHUNK) {
    const chunk = novos.slice(i, i + CHUNK);
    const { error } = await supabase.from("contact_invoices").insert(chunk);
    if (error) {
      stats.errors.push(`Boletos chunk ${i}: ${error.message}`);
    } else {
      stats.invoicesCreated += chunk.length;
    }
    onProgress("Importando boletos…", Math.min(i + CHUNK, total3), total3);
  }

  /* ── A conta tem que fechar ────────────────────────────────────────
     Toda linha que trazia boleto precisa ter terminado em um destes três
     lugares: gravada, ignorada por já existir, ou sem dono. Se a soma não
     bate, existe um caminho de perda que ninguém mapeou — e é exatamente
     assim que a falha silenciosa nasce de novo, num refactor futuro.

     Contabilidade que fecha é mais forte que contador: ela pega o erro que
     ainda não foi cometido. */
  const comBoleto = rows
    .filter((r) => !skippedRows.has(r))
    .filter((r) => r.inv_valor !== undefined || r.inv_vencimento).length;
  const contabilizados = stats.invoicesCreated + stats.invoicesSkipped + stats.invoicesSemDono;

  if (contabilizados !== comBoleto && stats.errors.length === 0) {
    stats.errors.push(
      `A planilha trazia ${comBoleto} boletos e só ${contabilizados} foram explicados. ` +
      `${comBoleto - contabilizados} desapareceram sem motivo registrado — avise o suporte.`
    );
  }

  return stats;
}

// ── Helpers internos ──────────────────────────────────────────────

function toContactRow(r: MappedRow, workspaceId: string, skipRequired = false) {
  const base: Record<string, unknown> = {
    workspace_id:        workspaceId,
    name:                r.name               ?? null,
    cpf_cnpj:            r.cpf_cnpj            ?? null,
    empresa:             r.empresa             ?? null,
    email:               r.email               ?? null,
    email2:              r.email2              ?? null,
    nome_representante:  r.nome_representante  ?? null,
    email_representante: r.email_representante ?? null,
    gerente1_nome:       r.gerente1_nome       ?? null,
    gerente1_email:      r.gerente1_email      ?? null,
    gerente2_nome:       r.gerente2_nome       ?? null,
    gerente2_email:      r.gerente2_email      ?? null,
    cep:                 r.cep                 ?? null,
    logradouro:          r.logradouro          ?? null,
    numero:              r.numero              ?? null,
    complemento:         r.complemento         ?? null,
    bairro:              r.bairro              ?? null,
    cidade:              r.cidade              ?? null,
    estado:              r.estado              ?? null,
    tags:                r.tags                ?? [],
  };
  if (!skipRequired && r.phone) base.phone = r.phone;
  return base;
}

function mergeRow(a: MappedRow | undefined, b: MappedRow): MappedRow {
  if (!a) return b;
  const merged: MappedRow = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k.startsWith("inv_")) continue; // boletos são por linha, não por contato
    if (v !== undefined && v !== null && v !== "" &&
        ((merged as Record<string, unknown>)[k] === undefined ||
         (merged as Record<string, unknown>)[k] === null ||
         (merged as Record<string, unknown>)[k] === "")) {
      (merged as Record<string, unknown>)[k] = v;
    }
  }
  return merged;
}
