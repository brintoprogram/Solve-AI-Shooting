// Relatório de um disparo, boleto a boleto.
//
// A exportação antiga tinha UMA linha por destinatário, com as notas
// concatenadas numa célula: "10067, 10059, 9974". Isso responde "quem recebeu"
// e não responde "o que foi cobrado de cada um" — que é a pergunta de quem
// confere a campanha contra o sistema financeiro. Ninguém soma valores dentro
// de uma célula de texto, e ninguém filtra por vencimento assim.
//
// Aqui cada boleto selecionado vira uma linha própria, com o cliente repetido
// ao lado. É mais verboso e é o formato que se usa: dá para somar, filtrar por
// vencimento, cruzar por número de nota e bater com o ERP.
//
// Três abas, porque são três perguntas diferentes:
//   Resumo        — quanto foi cobrado, de quantos, com que resultado
//   Boletos       — a linha a linha que o financeiro confere
//   Destinatários — um por pessoa, para conferir o envio em si

import * as XLSX from "xlsx";

export interface BoletoDoDisparo {
  id: string;
  valor: number | null;
  status: string | null;
  numero_nf: string | null;
  vencimento: string | null;
  codigo_barras: string | null;
}

export interface MensagemDoDisparo {
  recipient_name: string | null;
  recipient_phone: string | null;
  status: string | null;
  sent_at: string | null;
  error_code: string | null;
  error_message: string | null;
  recipient_data: Record<string, unknown> | null;
}

export interface DadosDoDisparo {
  campanhaNome: string;
  campanhaId: string;
  criadaEm?: string | null;
  isEmail: boolean;
  rotuloStatus: (s: string | null) => string;
}

/** Data como DATA. String "31/08/2026" o Excel guarda como texto e ordena pelo
 *  dia — o mesmo defeito que já corrigimos na exportação de contatos.
 *  Meio-dia UTC para nenhum fuso a oeste jogar para o dia anterior. */
function comoData(iso: string | null | undefined): Date | "" {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return "";
  return new Date(Date.UTC(a, m - 1, d, 12));
}

function comoDataHora(iso: string | null | undefined): Date | "" {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d;
}

/** Dias até o vencimento. Negativo = já venceu. É a coluna que responde
 *  "quanto disso está atrasado" sem obrigar ninguém a fazer conta. */
function diasAte(iso: string | null): number | "" {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!a) return "";
  const alvo = Date.UTC(a, m - 1, d);
  const hoje = new Date();
  const hj = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((alvo - hj) / 86_400_000);
}

const MOEDA = 'R$ #,##0.00';
const DATA  = "dd/mm/yyyy";
const DATAH = "dd/mm/yyyy hh:mm";

/** Aplica largura de coluna e formato numérico. É o que separa uma planilha
 *  legível de uma coluna de "####" com datas em número serial. */
function formatar(
  ws: XLSX.WorkSheet,
  larguras: number[],
  formatos: Record<number, string>,
) {
  ws["!cols"] = larguras.map((w) => ({ wch: w }));
  const ref = ws["!ref"];
  if (!ref) return;
  const faixa = XLSX.utils.decode_range(ref);
  for (let l = faixa.s.r + 1; l <= faixa.e.r; l++) {
    for (const [col, z] of Object.entries(formatos)) {
      const cel = ws[XLSX.utils.encode_cell({ r: l, c: Number(col) })];
      if (cel && cel.v !== "" && cel.v !== null && cel.v !== undefined) cel.z = z;
    }
  }
  // Filtro na primeira linha: quem abre isso vai querer filtrar por vencimento
  // ou por status antes de qualquer outra coisa.
  ws["!autofilter"] = { ref };
}

export function montarRelatorio(mensagens: MensagemDoDisparo[], info: DadosDoDisparo): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // ── Boletos: uma linha por boleto selecionado ────────────────────
  const linhasBoleto: Record<string, unknown>[] = [];
  let totalCobrado = 0;

  for (const m of mensagens) {
    const d = m.recipient_data ?? {};
    const selecionados = (d._invoice_ids as string[] | undefined) ?? [];
    const todos = (d.contact_invoices as BoletoDoDisparo[] | undefined) ?? [];
    // Sem seleção explícita, valem todos: é como a campanha se comporta.
    const boletos = selecionados.length
      ? todos.filter((b) => selecionados.includes(b.id))
      : todos;

    for (const b of boletos) {
      const dias = diasAte(b.vencimento);
      if (typeof b.valor === "number") totalCobrado += b.valor;
      linhasBoleto.push({
        "Cliente":              m.recipient_name ?? "",
        ...(info.isEmail
          ? { "E-mail": (d.email as string) ?? "" }
          : { "Telefone": m.recipient_phone ?? "" }),
        "E-mail representante": (d.email_representante as string) ?? "",
        "Nº NF":                b.numero_nf ?? "",
        "Valor":                typeof b.valor === "number" ? b.valor : "",
        "Vencimento":           comoData(b.vencimento),
        "Dias":                 dias,
        "Situação":             dias === "" ? "" : dias < 0 ? `vencido há ${Math.abs(dias)} dia(s)` : dias === 0 ? "vence hoje" : `vence em ${dias} dia(s)`,
        "Status do boleto":     b.status ?? "",
        "Código de barras":     b.codigo_barras ?? "",
        "Status do envio":      info.rotuloStatus(m.status),
        "Enviado em":           comoDataHora(m.sent_at),
        "Erro":                 m.error_message ?? "",
      });
    }
  }

  const wsBoletos = XLSX.utils.json_to_sheet(linhasBoleto, { cellDates: true });
  formatar(wsBoletos,
    [34, 32, 32, 12, 15, 13, 8, 22, 16, 30, 16, 18, 30],
    { 4: MOEDA, 5: DATA, 11: DATAH });
  XLSX.utils.book_append_sheet(wb, wsBoletos, "Boletos");

  // ── Destinatários: um por pessoa ─────────────────────────────────
  const linhasDest = mensagens.map((m) => {
    const d = m.recipient_data ?? {};
    const selecionados = (d._invoice_ids as string[] | undefined) ?? [];
    const todos = (d.contact_invoices as BoletoDoDisparo[] | undefined) ?? [];
    const boletos = selecionados.length ? todos.filter((b) => selecionados.includes(b.id)) : todos;
    const soma = boletos.reduce((s, b) => s + (typeof b.valor === "number" ? b.valor : 0), 0);
    const venc = boletos.map((b) => b.vencimento).filter(Boolean).sort()[0] ?? null;
    return {
      "Cliente":              m.recipient_name ?? "",
      ...(info.isEmail
        ? { "E-mail": (d.email as string) ?? "" }
        : { "Telefone": m.recipient_phone ?? "" }),
      "E-mail representante": (d.email_representante as string) ?? "",
      "Boletos":              boletos.length,
      "Valor total":          soma,
      "Vencimento mais próximo": comoData(venc),
      "Nº NF(s)":             boletos.map((b) => b.numero_nf || "sem NF").join(", "),
      "Status do envio":      info.rotuloStatus(m.status),
      "Enviado em":           comoDataHora(m.sent_at),
      "Código de erro":       m.error_code ? `#${m.error_code}` : "",
      "Erro":                 m.error_message ?? "",
    };
  });

  const wsDest = XLSX.utils.json_to_sheet(linhasDest, { cellDates: true });
  formatar(wsDest,
    [34, 32, 32, 9, 16, 22, 34, 16, 18, 14, 30],
    { 4: MOEDA, 5: DATA, 8: DATAH });
  XLSX.utils.book_append_sheet(wb, wsDest, "Destinatários");

  // ── Resumo: primeiro na ordem, porque é o que se olha primeiro ───
  const porStatus = new Map<string, number>();
  for (const m of mensagens) {
    const r = info.rotuloStatus(m.status);
    porStatus.set(r, (porStatus.get(r) ?? 0) + 1);
  }
  const comErro = mensagens.filter((m) => m.error_message).length;
  const vencidos = linhasBoleto.filter((l) => typeof l["Dias"] === "number" && (l["Dias"] as number) < 0);
  const somaVencida = vencidos.reduce((s, l) => s + (typeof l["Valor"] === "number" ? (l["Valor"] as number) : 0), 0);

  const resumo: (string | number | Date | "")[][] = [
    ["Relatório do disparo"],
    [],
    ["Campanha",           info.campanhaNome],
    ["Identificador",      info.campanhaId],
    ["Criada em",          comoDataHora(info.criadaEm) || ""],
    ["Canal",              info.isEmail ? "E-mail" : "WhatsApp"],
    ["Gerado em",          new Date()],
    [],
    ["Destinatários",      mensagens.length],
    ["Boletos cobrados",   linhasBoleto.length],
    ["Valor total",        Math.round(totalCobrado * 100) / 100],
    ["Boletos vencidos",   vencidos.length],
    ["Valor vencido",      Math.round(somaVencida * 100) / 100],
    ["Com erro de envio",  comErro],
    [],
    ["Situação do envio",  "Destinatários"],
    ...[...porStatus.entries()].sort((a, b) => b[1] - a[1]),
  ];

  const wsResumo = XLSX.utils.aoa_to_sheet(resumo, { cellDates: true });
  wsResumo["!cols"] = [{ wch: 26 }, { wch: 46 }];
  wsResumo["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  for (const linha of [10, 12]) {
    const cel = wsResumo[XLSX.utils.encode_cell({ r: linha, c: 1 })];
    if (cel) cel.z = MOEDA;
  }
  const celGerado = wsResumo[XLSX.utils.encode_cell({ r: 6, c: 1 })];
  if (celGerado) celGerado.z = DATAH;
  const celCriada = wsResumo[XLSX.utils.encode_cell({ r: 4, c: 1 })];
  if (celCriada && celCriada.v) celCriada.z = DATAH;

  // Inserida por último e movida para o começo: o SheetJS anexa no fim, e a
  // primeira aba é a que abre.
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");
  wb.SheetNames = ["Resumo", "Boletos", "Destinatários"];

  return wb;
}

/** Nome do arquivo com o nome da campanha, e não só o identificador.
 *  "campanha_008734e3-751b-4c23.xlsx" não diz nada na pasta de downloads. */
export function nomeDoArquivo(campanhaNome: string, campanhaId: string): string {
  const slug = campanhaNome
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || campanhaId.slice(0, 8);
  const hoje = new Date().toISOString().slice(0, 10);
  return `disparo_${slug}_${hoje}.xlsx`;
}
