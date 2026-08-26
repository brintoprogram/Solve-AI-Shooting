// ─────────────────────────────────────────────────────────────────
//  importUtils.ts — Parsing, limpeza e upsert de planilhas
//  Suporta .csv (PapaParse) e .xlsx (SheetJS)
// ─────────────────────────────────────────────────────────────────

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneKey } from "./format";
import { registrarEvento } from "./perfisDeImportacao";

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
  /** Boletos que já existiam e foram CORRIGIDOS (mesma NF, vencimento novo). */
  invoicesSkipped:  number;
  skipped:          number;
  errors:           string[];

  /* ── Contabilidade do que NÃO entrou ──────────────────────────────
     Antes existia um caminho pelo qual um boleto sumia sem aparecer em
     contador nenhum: quando o contato dele não era encontrado, a linha virava
     null e era filtrada fora. Não entrava em criados, nem em ignorados, nem em
     erros. A pessoa via "12 boletos criados" numa planilha de 40 e não tinha
     como saber que 28 evaporaram, nem por quê. */

  /** Boletos que já existiam e tiveram valor ou vencimento corrigidos. */
  invoicesUpdated:  number;
  /** Boletos descartados por não ter dono no sistema. */
  invoicesSemDono:  number;
  /** Linhas sem telefone e sem CPF: não há como identificar a pessoa. */
  semChave:         number;
  /** Linhas só com CPF, cujo CPF não existe na base. Não criam contato. */
  cpfNaoEncontrado: number;

  /** O lote desta importação. Com ele dá para desfazer tudo depois. */
  runId?: string | null;
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

/**
 * Telefone em formato único: só dígitos, sempre com o 55.
 *
 * A versão anterior tinha um comentário dizendo "garante que números
 * brasileiros sem DDI ficam com 55" — e o código só removia pontuação. O
 * comentário descrevia a intenção; a intenção não chega ao banco.
 *
 * O custo disso não era cosmético. O contato é identificado por
 * workspace_id + phone comparando o TEXTO gravado, então "18997254812" e
 * "5518997254812" eram duas pessoas diferentes. O mesmo cliente virava dois
 * cadastros conforme o formato da planilha do mês, com a dívida partida entre
 * os dois: a cobrança via metade, e a IA negociava sobre metade.
 *
 * Número que não tem cara de brasileiro passa como está — inventar o 55 em
 * cima de um número estrangeiro seria estragar um dado bom.
 */
export function cleanPhone(raw: unknown): string {
  let digitos = String(raw ?? "").replace(/\D/g, "");
  if (!digitos) return "";

  /* Zero à esquerda do DDD: "066 99608-3382". Sobrou da época em que se
     discava 0 antes do código da operadora, e continua sendo como muita gente
     escreve — e como muito sistema exporta. Sem tirar, o número fica com 12
     dígitos, não casa com nenhuma regra, e um celular perfeitamente válido é
     recusado como "não parece um telefone". Foi o que aconteceu com várias
     linhas de uma planilha real. */
  // Todos os zeros da frente, sem exceção: nenhum número brasileiro começa
  // com zero. "066" é DDD com o zero antigo, "0055" é o prefixo
  // internacional. Os dois viram lixo se ficarem.
  digitos = digitos.replace(/^0+/, "");
  if (!digitos) return "";

  // Já vem com o código do país.
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) return digitos;

  // Nacional: 10 (fixo) ou 11 (celular) dígitos, com DDD.
  //
  // Conferir só o tamanho não basta: um número americano como
  // +1 415 555 2671 tem 11 dígitos e começa em "14", que é um DDD válido no
  // Brasil — e virava 5514155552671, um número que não existe. O que separa é
  // a FORMA: celular brasileiro tem 9 logo depois do DDD desde 2016, e fixo
  // começa entre 2 e 5.
  const ddd = Number(digitos.slice(0, 2));
  const apos = digitos.charAt(2);
  if (ddd >= 11 && ddd <= 99) {
    if (digitos.length === 11 && apos === "9") return `55${digitos}`;
    if (digitos.length === 10 && apos >= "2" && apos <= "5") return `55${digitos}`;
  }

  return digitos;
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

/* UM formatador, criado uma vez. `valor.toLocaleString(...)` constroi um
   Intl.NumberFormat NOVO a cada chamada, e a tela de leitura chama isto para
   toda celula de toda coluna. Numa planilha de 5 mil linhas por 20 colunas sao
   100 mil construcoes por render: medido em 3,5 s no Node, pior no navegador —
   a aba congela e o clique em Importar nao chega a acontecer. */
const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

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
        : { lido: MOEDA.format(n), ok: true };
    }
    case "data": {
      const iso = parseDate(bruto, ordem);
      if (!iso) return { lido: "não reconheci como data", ok: false };
      const [a, m, d] = iso.split("-");
      return { lido: `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`, ok: true };
    }
    case "telefone": {
      const d = cleanPhone(bruto).replace(/\D/g, "");
      /* Eu tinha exigido 12 dígitos aqui, o que só aceita número que JÁ venha
         com o 55. Celular brasileiro escrito como a pessoa escreve —
         (18) 99725-4812 — tem 11, e a tela marcou 519 de 528 linhas válidas
         como "curto demais". O erro era meu, não da planilha. */
      const nacional = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
      if (nacional.length < 10 || nacional.length > 11) {
        return { lido: `${String(bruto)} — não parece um telefone`, ok: false };
      }
      // Mostra COM o 55, que é a forma que o WhatsApp exige. Ver o número já
      // completo é o que responde "e o código do país, entra sozinho?".
      const completo = `55${nacional}`;
      return { lido: completo, ok: true };
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

/**
 * A coluna parece conter telefones?
 *
 * Existe porque o cabeçalho engana e o CONTEÚDO não. "NUMERO CLIENTE" foi lido
 * como número de endereço — casou a palavra "número" — enquanto carregava
 * "(18) 99725-4812" em todas as linhas. O sistema identifica contato pelo
 * telefone, então uma planilha inteira de 528 linhas foi importada como zero.
 *
 * Olhar o dado desfaz o engano do nome: telefone brasileiro tem 10 a 13
 * dígitos e DDD entre 11 e 99. Exige maioria clara, não uma linha solta, para
 * não sugerir bobagem em cima de uma coincidência.
 */
export function pareceTelefone(valores: unknown[]): boolean {
  let comConteudo = 0;
  let telefones = 0;
  for (const v of valores) {
    if (v === null || v === undefined || String(v).trim() === "") continue;
    comConteudo++;
    const d = String(v).replace(/\D/g, "");
    if (d.length < 10 || d.length > 13) continue;
    const semPais = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
    const ddd = Number(semPais.slice(0, 2));
    if (ddd < 11 || ddd > 99) continue;
    // CPF tambem tem 11 digitos, entao contar so o tamanho classificaria uma
    // coluna de documento como telefone. O que separa os dois e a forma do
    // numero: celular tem 9 logo depois do DDD, fixo comeca entre 2 e 5.
    const primeiro = semPais.charAt(2);
    if (semPais.length === 11 && primeiro === "9") telefones++;
    else if (semPais.length === 10 && primeiro >= "2" && primeiro <= "5") telefones++;
  }
  return comConteudo >= 3 && telefones / comConteudo >= 0.7;
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

/* importar_contatos e nova e ainda nao esta em src/types/database.ts.
   Regenerar aquele arquivo hoje quebra 105 outros pontos — tarefa
   separada. So a chamada da funcao passa sem tipo. */
const dbSemTipo = supabase as unknown as SupabaseClient;

const CHUNK = 80; // seguro abaixo do limite do PostgREST


/** O que fazer com um telefone disputado por vários nomes.
 *
 *  Chave: o telefone normalizado. `nome` é o nome que o cadastro vai carregar;
 *  `importar` decide se os boletos das linhas em conflito entram nele.
 *
 *  Antes disso o importador decidia sozinho: mantinha o primeiro nome e
 *  DESCARTAVA os boletos dos demais, em silêncio. Numa planilha real isso
 *  tirou 37 linhas e R$ 1,36 milhão. A regra existia por um bom motivo — não
 *  pendurar dívida no cliente errado — mas a decisão é de quem conhece a base,
 *  não do código. */
export type AcaoConflito =
  /** Entra no cadastro principal do telefone. */
  | "juntar"
  /** Vira cadastro proprio, com telefone provisorio. */
  | "separar"
  /** Nao importa. */
  | "fora";

export type ResolucaoConflito = Record<string, {
  /** Nome que o cadastro do telefone real vai carregar. */
  nome: string;
  /** O que fazer com cada um dos outros nomes do mesmo telefone. */
  acoes: Record<string, AcaoConflito>;
}>;

/**
 * Telefone provisório para um cliente que não tem número próprio na planilha.
 *
 * O telefone é a identidade do contato — coluna NOT NULL e única por
 * workspace. Sem um valor, o cliente simplesmente não pode existir, e era isso
 * que empurrava para as duas saídas ruins: juntar gente diferente no mesmo
 * cadastro, ou perder o boleto.
 *
 * Deliberadamente NÃO parece um telefone: nada disca, nada envia, e quem olhar
 * a base entende na hora que falta o número. Derivado do nome, então
 * reimportar a mesma planilha cai no mesmo contato em vez de criar outro.
 */
export function telefoneProvisorio(nome: string): string {
  const slug = nome
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `sem-telefone-${slug || "sem-nome"}`;
}

export const TAG_SEM_TELEFONE = "sem telefone";

/** Chave de busca do contato.
 *
 *  phoneKey() só guarda dígitos, então todo telefone provisório viraria string
 *  vazia — e os boletos de TODOS eles cairiam no último contato criado. O
 *  fallback para o valor cru é o que mantém cada um com identidade própria. */
function chaveDoContato(telefone: string): string {
  return phoneKey(telefone) || telefone;
}

export async function runImport(
  rows:        MappedRow[],
  workspaceId: string,
  onProgress:  (phase: string, done: number, total: number) => void,
  arquivo?:    string,
  resolucoes?: ResolucaoConflito,
): Promise<ImportStats> {
  const stats: ImportStats = {
    contactsInserted: 0,
    contactsUpdated:  0,
    invoicesCreated:  0,
    invoicesSkipped:  0,
    skipped:          0,
    errors:           [],
    invoicesUpdated:  0,
    invoicesSemDono:  0,
    semChave:         0,
    cpfNaoEncontrado: 0,
  };

  /* Abre o lote ANTES de escrever qualquer coisa. Sem ele a importação
     acontece e não há a que voltar — e o caso que dói é justamente o meio
     termo: 200 linhas entraram, 200 falharam, e apagar as 200 na mão antes de
     tentar de novo e algo que ninguem faz. Reimporta por cima, duplica o que
     der, e a base piora a cada tentativa. */
  let runId: string | null = null;
  try {
    const { data: run } = await dbSemTipo
      .from("import_runs")
      .insert({ workspace_id: workspaceId, arquivo: arquivo ?? null, linhas: rows.length })
      .select("id")
      .single();
    runId = (run as { id?: string } | null)?.id ?? null;
  } catch {
    // Sem lote a importação segue: poder desfazer é bom, mas não poder
    // importar é pior.
    runId = null;
  }
  stats.runId = runId;
  registrarEvento(workspaceId, runId, "inicio", "info",
    `Importação iniciada com ${rows.length} linhas`,
    {
      arquivo: arquivo ?? null,
      linhas: rows.length,
      conflitos_resolvidos: resolucoes ? Object.keys(resolucoes).length : 0,
    });

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

  /* Antes de agrupar: quem foi marcado como "separar" ganha telefone próprio.
     Feito aqui, e não na tela, porque a partir deste ponto o telefone JÁ É a
     identidade — e trocar depois faria o boleto procurar um contato que não
     existe. */
  for (const r of withPhone) {
    const decisao = resolucoes?.[r.phone!];
    if (!decisao || !r.name || r.name === decisao.nome) continue;
    if (decisao.acoes?.[r.name] === "separar") {
      r.phone = telefoneProvisorio(r.name);
      r.tags  = [...new Set([...(r.tags ?? []), TAG_SEM_TELEFONE])];
    }
  }

  for (const r of withPhone) {
    const existing = contactMap.get(r.phone!);
    const decisao  = resolucoes?.[r.phone!];
    const acao     = decisao && r.name && r.name !== decisao.nome
      ? (decisao.acoes?.[r.name] ?? "separar")
      : undefined;

    if (existing && existing.name && r.name && existing.name !== r.name) {
      if (acao === "fora") {
        stats.errors.push(
          `Telefone ${r.phone}: "${r.name}" ficou de fora por decisão na conferência`
        );
        skippedRows.add(r);   // boleto desta linha será pulado
      } else if (acao === "juntar") {
        stats.errors.push(
          `Telefone ${r.phone}: "${r.name}" foi unificado em "${decisao!.nome}" por decisão na conferência`
        );
      } else if (!decisao) {
        // Sem decisão nenhuma: comportamento antigo, que protege contra
        // pendurar dívida no cadastro errado.
        stats.errors.push(
          `Telefone ${r.phone} duplicado: "${existing.name}" mantido, "${r.name}" ignorado — verifique a planilha`
        );
        skippedRows.add(r);
      }
    }

    const juntos = mergeRow(existing, r);
    // O nome escolhido vale sobre o que a planilha traz: é a decisão explícita
    // de uma pessoa contra a ordem acidental das linhas do arquivo.
    if (decisao?.nome && !acao) juntos.name = decisao.nome;
    contactMap.set(r.phone!, juntos);
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

    /* Passa pela funcao do banco em vez do upsert direto.
    
       O upsert mandava TODOS os campos, e os ausentes iam como null: o
       ON CONFLICT DO UPDATE grava o que recebe, entao uma planilha de cobranca
       com telefone, valor e vencimento zerava e-mail, empresa, endereco e tags
       de todo cliente que ja existia. Provado em transacao desfeita.
       
       A regra certa e COALESCE campo a campo, e isso nao da para expressar
       daqui — o PostgREST monta o SET a partir das colunas que chegam. Por
       isso a decisao mora no banco. */
    const { data, error } = await dbSemTipo.rpc("importar_contatos", {
      p_workspace_id: workspaceId,
      p_linhas: rows_,
      p_run_id: runId,
    });

    if (error) {
      stats.errors.push(`Contatos chunk ${i}: ${error.message}`);
      registrarEvento(workspaceId, runId, "contatos", "erro",
        `Lote de contatos falhou na linha ${i + 1}`,
        { erro: error.message, codigo: (error as { code?: string }).code ?? null, tamanho: chunk.length });
    } else if (data) {
      for (const c of data as unknown as
           { id_contato: string; telefone: string | null; documento: string | null; nasceu_agora: boolean }[]) {
        // Chave canonica: o mesmo telefone chega com e sem o codigo do pais
        // dependendo da planilha. Sem normalizar, o boleto de uma linha nao
        // encontrava o contato criado por outra e ficava orfao.
        if (c.telefone)  phoneIdMap.set(chaveDoContato(c.telefone), c.id_contato);
        if (c.documento) cpfIdMap.set(c.documento, c.id_contato);

        /* Quem diz se a linha nasceu ou foi atualizada e o BANCO, por xmax = 0.
           Antes isto era `contactsInserted += chunk.length`, que contava o lote
           inteiro como insercao: uma importacao de 528 linhas reportou "235
           criados, 0 atualizados" quando a verdade era 205 e 30. O desfazer
           acertou, mas o numero na tela fez a conta nao fechar e levantou
           suspeita sobre uma operacao que estava correta. */
        if (c.nasceu_agora) stats.contactsInserted++;
        else                stats.contactsUpdated++;
      }
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
        r.phone    ? phoneIdMap.get(chaveDoContato(r.phone))
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

  /* Guarda o boleto existente inteiro, e não só a chave.
  
     Antes era um Set de chaves: dava para saber que a linha já existia, e não
     dava para comparar nem para corrigir. É isso que fazia um boleto reemitido
     — mesma nota, vencimento novo — ser descartado com o vencimento velho
     ficando na base. */
  type BoletoExistente = { id: string; valor: number | null; vencimento: string | null; status: string | null; numero_nf: string | null; codigo_barras: string | null };
  const jaExiste = new Map<string, BoletoExistente>();

  const contactIds = [...new Set(invoiceRows_.map((r) => r.contact_id))];
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("contact_invoices")
      .select("id, contact_id, numero_nf, codigo_barras, valor, vencimento, status")
      .eq("workspace_id", workspaceId)
      .in("contact_id", contactIds.slice(i, i + CHUNK));

    if (error) {
      // Sem a lista do que já existe não dá para decidir com segurança.
      // Abortar aqui é melhor que gravar duplicata silenciosamente.
      stats.errors.push(`Verificação de boletos existentes: ${error.message}`);
      return stats;
    }
    for (const inv of (data ?? []) as Array<BoletoExistente & { contact_id: string }>) {
      if (inv.codigo_barras?.trim()) jaExiste.set(chaveBarras(inv.codigo_barras), inv);
      if (inv.numero_nf?.trim())     jaExiste.set(chaveNf(inv.contact_id, inv.numero_nf), inv);
    }
  }

  const novos: typeof invoiceRows_ = [];
  const corrigir: { id: string; antes: BoletoExistente; depois: typeof invoiceRows_[number] }[] = [];

  for (const row of invoiceRows_) {
    const kb = row.codigo_barras?.trim() ? chaveBarras(row.codigo_barras) : null;
    const kn = row.numero_nf?.trim()     ? chaveNf(row.contact_id, row.numero_nf) : null;
    const existente = (kb && jaExiste.get(kb)) || (kn && jaExiste.get(kn)) || null;

    if (existente) {
      /* Já existe. Antes isso era o fim da linha e o boleto era descartado —
         inclusive quando o vencimento tinha mudado, que é o caso mais comum:
         boleto reemitido com a mesma nota. O saldo ficava certo e a data
         ficava velha, e a régua de cobrança passava a mirar um vencimento que
         já não existe.
         
         Agora corrige o que mudou. Se nada mudou, não gasta escrita. */
      const mudou =
        Number(existente.valor ?? 0) !== Number(row.valor ?? 0) ||
        (existente.vencimento ?? null) !== (row.vencimento ?? null) ||
        (existente.codigo_barras ?? null) !== (row.codigo_barras ?? null);
      if (mudou) corrigir.push({ id: existente.id, antes: existente, depois: row });
      stats.invoicesSkipped++;
      continue;
    }
    // Marca já: pega também a planilha que repete a mesma nota em duas linhas.
    const marcador: BoletoExistente = {
      id: "", valor: row.valor, vencimento: row.vencimento,
      status: row.status, numero_nf: row.numero_nf, codigo_barras: row.codigo_barras,
    };
    if (kb) jaExiste.set(kb, marcador);
    if (kn) jaExiste.set(kn, marcador);
    novos.push(row);
  }

  /* Corrige os reemitidos, um a um. São poucos por natureza — na planilha que
     motivou isto foram 6 em 528 — e cada um precisa do próprio UPDATE porque
     os valores diferem. Guarda o estado anterior antes de mexer, para o
     desfazer conseguir devolver. */
  if (corrigir.length > 0) {
    onProgress("Atualizando boletos reemitidos…", 0, corrigir.length);
    let feitos = 0;
    for (const c of corrigir) {
      if (!c.id) continue;
      try {
        if (runId) {
          await dbSemTipo.from("import_run_items").insert({
            run_id: runId, workspace_id: workspaceId,
            tipo: "boleto_atualizado", boleto_id: c.id, antes: c.antes,
          });
        }
        const { error } = await supabase.from("contact_invoices").update({
          valor:         c.depois.valor,
          vencimento:    c.depois.vencimento,
          codigo_barras: c.depois.codigo_barras,
        }).eq("id", c.id);
        if (error) stats.errors.push(`Boleto ${c.depois.numero_nf ?? c.id}: ${error.message}`);
        else stats.invoicesUpdated++;
      } catch { /* um boleto que nao corrige nao pode parar os outros */ }
      onProgress("Atualizando boletos reemitidos…", ++feitos, corrigir.length);
    }
  }

  const total3 = novos.length;
  onProgress("Importando boletos…", 0, total3);

  for (let i = 0; i < novos.length; i += CHUNK) {
    const chunk = novos.slice(i, i + CHUNK);
    const { data: criados, error } = await supabase
      .from("contact_invoices").insert(chunk).select("id");
    if (error) {
      stats.errors.push(`Boletos chunk ${i}: ${error.message}`);
      registrarEvento(workspaceId, runId, "boletos", "erro",
        `Lote de boletos falhou na posição ${i + 1}`,
        { erro: error.message, codigo: (error as { code?: string }).code ?? null, tamanho: chunk.length });
    } else {
      stats.invoicesCreated += chunk.length;
      // Anota quais boletos nasceram deste lote, para o desfazer saber
      // exatamente o que apagar — e, principalmente, o que NÃO apagar.
      if (runId && criados?.length) {
        try {
          await dbSemTipo.from("import_run_items").insert(
            criados.map((b: { id: string }) => ({
              run_id: runId, workspace_id: workspaceId,
              tipo: "boleto_criado", boleto_id: b.id,
            })),
          );
        } catch { /* o boleto entrou; perder o registro do lote nao o desfaz */ }
      }
    }
    onProgress("Importando boletos…", Math.min(i + CHUNK, total3), total3);
  }

  registrarEvento(workspaceId, runId, "fim",
    stats.errors.length ? "erro" : (stats.invoicesSemDono || stats.semChave ? "aviso" : "info"),
    stats.errors.length
      ? `Importação terminou com ${stats.errors.length} erro(s)`
      : `Importação concluída: ${stats.contactsInserted} criados, ${stats.contactsUpdated} atualizados, ${stats.invoicesCreated} boletos`,
    {
      contatos_criados:     stats.contactsInserted,
      contatos_atualizados: stats.contactsUpdated,
      boletos_criados:      stats.invoicesCreated,
      boletos_ja_existiam:  stats.invoicesSkipped,
      boletos_corrigidos:   stats.invoicesUpdated,
      boletos_sem_dono:     stats.invoicesSemDono,
      linhas_sem_chave:     stats.semChave,
      cpf_nao_encontrado:   stats.cpfNaoEncontrado,
      erros:                stats.errors.slice(0, 10),
    });

  if (runId) {
    try {
      await dbSemTipo.from("import_runs").update({
        contatos_criados:     stats.contactsInserted,
        contatos_atualizados: stats.contactsUpdated,
        boletos_criados:      stats.invoicesCreated,
      }).eq("id", runId);
    } catch { /* numeros do relatorio, nao do desfazer */ }
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
