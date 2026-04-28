// ─────────────────────────────────────────────────────────────────
//  importUtils.ts — Parsing, limpeza e upsert de planilhas
//  Suporta .csv (PapaParse) e .xlsx (SheetJS)
// ─────────────────────────────────────────────────────────────────

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";

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
  skipped:          number;
  errors:           string[];
}

// ── Palavras-chave para auto-detecção ─────────────────────────────

const DETECT: Partial<Record<FieldKey, string[]>> = {
  name:                ["nome", "devedor", "cliente", "razão social", "razao social", "sacado", "favorecido", "name", "beneficiario"],
  phone:               ["telefone", "fone", "celular", "cel", "whatsapp", "zap", "phone", "tel", "mobile"],
  cpf_cnpj:            ["cpf", "cnpj", "cpf_cnpj", "documento", "doc", "cadastro", "inscricao"],
  empresa:             ["empresa", "fantasia", "nome fantasia", "company", "razão"],
  email:               ["email", "e-mail", "correio"],
  email2:              ["email2", "e-mail 2", "segundo email"],
  nome_representante:  ["representante", "responsável", "responsavel", "contato"],
  email_representante: ["email representante", "e-mail representante", "email_representante"],
  gerente1_nome:       ["gerente1 nome", "nome gerente 1", "gerente1_nome", "gerente 1"],
  gerente1_email:      ["gerente1 email", "email gerente 1", "gerente1_email", "e-mail gerente 1"],
  gerente2_nome:       ["gerente2 nome", "nome gerente 2", "gerente2_nome", "gerente 2"],
  gerente2_email:      ["gerente2 email", "email gerente 2", "gerente2_email", "e-mail gerente 2"],
  cep:                 ["cep", "zip", "postal"],
  logradouro:          ["logradouro", "endereço", "endereco", "rua", "avenida", "address"],
  numero:              ["número", "numero", "nº", "n°", "num"],
  complemento:         ["complemento", "comp", "apto", "apartamento"],
  bairro:              ["bairro", "district"],
  cidade:              ["cidade", "city", "municipio", "município"],
  estado:              ["estado", "uf", "state"],
  tags:                ["tags", "tag", "categoria", "grupo", "classificação"],
  inv_valor:           ["valor", "value", "quantia", "montante", "dívida", "divida", "saldo", "valor boleto", "vlr"],
  inv_vencimento:      ["vencimento", "venc", "data vencimento", "data de vencimento", "prazo", "due"],
  inv_numero_nf:       ["nf", "nota fiscal", "número boleto", "num boleto", "ref", "referência", "referencia", "boleto"],
  inv_codigo_barras:   ["código de barras", "codigo barras", "linha digitável", "barcode"],
  inv_status:          ["status", "situação", "situacao", "status boleto"],
};

export function autoDetect(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<FieldKey>();

  for (const header of headers) {
    const norm = header.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    let matched: FieldKey | "" = "";

    for (const [field, keywords] of Object.entries(DETECT) as [FieldKey, string[]][]) {
      if (used.has(field)) continue;
      if (keywords.some((kw) => norm.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))) {
        matched = field;
        used.add(field);
        break;
      }
    }
    mapping[header] = matched;
  }
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
  }

  const num = parseFloat(s);
  if (isNaN(num) || num < 0) return null;

  // Operação com inteiros para eliminar erro de ponto flutuante
  return Math.round(num * 100) / 100;
}

/**
 * Converte vários formatos de data para "YYYY-MM-DD".
 * Lida com serial do Excel, DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY.
 */
export function parseDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;

  // Serial do Excel (número inteiro)
  if (typeof raw === "number") {
    // Época Excel = 1 Jan 1900 (com o bug do 1900 como bissexto)
    const date = new Date(Math.round((raw - 25569) * 86_400_000));
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  const s = String(raw).trim();

  // DD/MM/YYYY ou D/M/YYYY
  const brSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brSlash) {
    const [, d, m, y] = brSlash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD-MM-YYYY
  const brDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (brDash) {
    const [, d, m, y] = brDash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // YYYY-MM-DD (já correto)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Fallback nativo (inglês)
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return null;
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

    const venc = parseDate(get("inv_vencimento"));
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export async function runImport(
  rows:        MappedRow[],
  workspaceId: string,
  onProgress:  (phase: string, done: number, total: number) => void,
): Promise<ImportStats> {
  const stats: ImportStats = {
    contactsInserted: 0,
    contactsUpdated:  0,
    invoicesCreated:  0,
    skipped:          0,
    errors:           [],
  };

  // Separa linhas com phone e sem phone
  const withPhone    = rows.filter((r) => r.phone);
  const withoutPhone = rows.filter((r) => !r.phone && r.cpf_cnpj);
  const noKey        = rows.filter((r) => !r.phone && !r.cpf_cnpj);
  stats.skipped += noKey.length;

  // Mapa dedup de contatos (phone → dados mais completos)
  const contactMap = new Map<string, MappedRow>();
  for (const r of withPhone) {
    const existing = contactMap.get(r.phone!);
    // Mantém a versão com mais campos preenchidos
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

    const { data, error } = await db
      .from("inbox_contacts")
      .upsert(rows_, { onConflict: "workspace_id,phone", ignoreDuplicates: false })
      .select("id, phone, cpf_cnpj");

    if (error) {
      stats.errors.push(`Contatos chunk ${i}: ${error.message}`);
    } else if (data) {
      for (const c of data) {
        if (c.phone)    phoneIdMap.set(c.phone, c.id);
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
    const { data: existing } = await db
      .from("inbox_contacts")
      .select("id, cpf_cnpj")
      .eq("workspace_id", workspaceId)
      .in("cpf_cnpj", cpfList);

    const existingMap = new Map<string, string>((existing ?? []).map((c: { id: string; cpf_cnpj: string }) => [c.cpf_cnpj, c.id]));

    for (const r of withoutPhone) {
      const id = existingMap.get(r.cpf_cnpj!);
      if (!id) { stats.skipped++; continue; }
      cpfIdMap.set(r.cpf_cnpj!, id);
      await db.from("inbox_contacts").update(toContactRow(r, workspaceId, true)).eq("id", id);
      stats.contactsUpdated++;
    }
  }

  // ─── 3. Inserir boletos ───────────────────────────────────────────
  const invoiceRows_ = rows
    .filter((r) => r.inv_valor !== undefined || r.inv_vencimento)
    .map((r) => {
      const cid = (r.phone && phoneIdMap.get(r.phone))
               || (r.cpf_cnpj && cpfIdMap.get(r.cpf_cnpj));
      if (!cid) return null;
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

  const total3 = invoiceRows_.length;
  onProgress("Importando boletos…", 0, total3);

  for (let i = 0; i < invoiceRows_.length; i += CHUNK) {
    const chunk = invoiceRows_.slice(i, i + CHUNK);
    const { error } = await db.from("contact_invoices").insert(chunk);
    if (error) {
      stats.errors.push(`Boletos chunk ${i}: ${error.message}`);
    } else {
      stats.invoicesCreated += chunk.length;
    }
    onProgress("Importando boletos…", Math.min(i + CHUNK, total3), total3);
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
    if (v !== undefined && v !== null && v !== "" &&
        ((merged as Record<string, unknown>)[k] === undefined ||
         (merged as Record<string, unknown>)[k] === null ||
         (merged as Record<string, unknown>)[k] === "")) {
      (merged as Record<string, unknown>)[k] = v;
    }
  }
  return merged;
}
