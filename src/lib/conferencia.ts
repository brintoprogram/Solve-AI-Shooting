// Conferência da planilha, linha a linha, antes de gravar.
//
// A tela de leitura responde "como o sistema entendeu cada COLUNA". Falta a
// outra metade: o que vai acontecer com cada LINHA. São perguntas diferentes —
// uma coluna pode estar mapeada certinho e ainda assim ter 40 linhas que não
// vão entrar, e o resumo antigo dizia só "40 linhas com defeito", sem dizer
// quais nem por quê. Com 528 linhas, isso é o mesmo que não dizer nada.
//
// Aqui cada linha vira um veredito: entra, entra pela metade, ou não entra —
// e sempre com o motivo em português e o número da linha na planilha, que é
// como a pessoa vai achar aquilo no Excel.

import {
  interpretar, tipoDoCampo, parseValor, parseDate, cleanPhone,
  type ParsedFile, type Mapping, type FieldKey, type OrdemData,
} from "./importUtils";

/** Quantas linhas guardamos com detalhe para exibir. Os totais são sempre da
 *  planilha inteira; o detalhe é amostra, porque montar 20 mil objetos para
 *  uma tabela que mostra 50 por vez é gastar memória à toa. */
const MAX_DETALHE  = 300;
const MAX_PROBLEMA = 500;

export interface Problema {
  coluna: string;
  campo: FieldKey;
  bruto: string;
  motivo: string;
}

export interface LinhaConferida {
  /** Linha como ela aparece no Excel: cabeçalho é a 1, dados começam na 2. */
  numero: number;
  contato: string;
  telefone: string;
  valor: number | null;
  vencimento: string | null;
  problemas: Problema[];
  /** Sem telefone e sem CPF a linha não tem dono e não entra de jeito nenhum. */
  semChave: boolean;
  /** O telefone desta linha já pertence a outro nome no arquivo. O boleto dela
   *  não vai entrar. */
  conflito: { telefone: string; donoAnterior: string } | null;
}

export interface TotaisConferencia {
  linhas: number;
  /** Linhas que vão gerar ou atualizar um contato. */
  comContato: number;
  /** Linhas que trazem boleto. */
  comBoleto: number;
  /** Linhas que não entram: sem telefone e sem CPF. */
  semChave: number;
  /** Linhas com pelo menos um campo que não pôde ser lido. */
  comProblema: number;
  somaValor: number;
  vencimentoDe: string | null;
  vencimentoAte: string | null;
  /** Telefones repetidos dentro do próprio arquivo, com o MESMO nome. */
  duplicadosNoArquivo: number;
  /** Linhas que repetem um telefone já usado por OUTRO nome. O importador
   *  descarta o boleto delas para não pendurar dívida no cliente errado. */
  conflitoDeNome: number;
  /** Quanto em boletos vai ser descartado por esse conflito. */
  valorEmConflito: number;
}

export interface Conferencia {
  linhas: LinhaConferida[];
  problemas: LinhaConferida[];
  totais: TotaisConferencia;
  /** true quando o detalhe foi cortado — a tela avisa em vez de mentir. */
  detalheCortado: boolean;
}

const MOTIVO: Partial<Record<FieldKey, string>> = {
  inv_valor:      "não reconheci como valor",
  inv_vencimento: "não reconheci como data",
  phone:          "não parece um telefone",
  cpf_cnpj:       "não é CPF nem CNPJ",
};

export function conferir(parsed: ParsedFile, mapping: Mapping, ordem: OrdemData): Conferencia {
  const indices = new Map<FieldKey, number>();
  parsed.headers.forEach((h, i) => {
    const campo = mapping[h];
    if (campo && !indices.has(campo)) indices.set(campo, i);
  });

  const colunaDe = (campo: FieldKey) => {
    const i = indices.get(campo);
    return i === undefined ? "" : parsed.headers[i];
  };
  const valorDe = (linha: unknown[], campo: FieldKey) => {
    const i = indices.get(campo);
    return i === undefined ? undefined : linha[i];
  };

  const totais: TotaisConferencia = {
    linhas: parsed.rows.length,
    comContato: 0, comBoleto: 0, semChave: 0, comProblema: 0,
    somaValor: 0, vencimentoDe: null, vencimentoAte: null,
    duplicadosNoArquivo: 0, conflitoDeNome: 0, valorEmConflito: 0,
  };

  const linhas: LinhaConferida[] = [];
  const problemas: LinhaConferida[] = [];
  /* Guarda o PRIMEIRO nome visto para cada telefone.
  
     O importador tem uma regra de segurança: duas linhas com o mesmo telefone
     e nomes diferentes provavelmente são pessoas diferentes, então ele mantém
     a primeira e DESCARTA O BOLETO da segunda — para não pendurar dívida no
     cliente errado.
     
     A regra é boa. O problema era ela agir em silêncio: numa planilha real, 37
     linhas e R$ 1,36 milhão sumiram assim, e a diferença só apareceu quando
     alguém foi conferir a soma. Aqui isso passa a ser dito ANTES. */
  const donoDoTelefone = new Map<string, string>();
  let cortado = false;

  parsed.rows.forEach((linha, idx) => {
    const bruto = (c: FieldKey) => valorDe(linha, c);

    const tel = cleanPhone(bruto("phone") ?? "");
    const doc = String(bruto("cpf_cnpj") ?? "").replace(/\D/g, "");
    const semChave = !tel && !doc;

    // Duplicata dentro do arquivo: a segunda linha não cria contato novo, ela
    // sobrescreve a primeira. Saber disso ANTES evita a conversa de "sumiu um
    // cliente" depois.
    const nome = String(bruto("name") ?? "").trim();
    let conflito: LinhaConferida["conflito"] = null;
    if (tel) {
      const dono = donoDoTelefone.get(tel);
      if (dono === undefined) {
        donoDoTelefone.set(tel, nome);
      } else if (nome && dono && nome !== dono) {
        conflito = { telefone: tel, donoAnterior: dono };
        totais.conflitoDeNome++;
      } else {
        totais.duplicadosNoArquivo++;
      }
    }

    const problemasDaLinha: Problema[] = [];
    for (const [campo] of indices) {
      if (tipoDoCampo(campo) === "texto") continue;
      const v = bruto(campo);
      if (v === null || v === undefined || String(v).trim() === "") continue;
      const r = interpretar(campo, v, ordem);
      if (!r.ok) {
        problemasDaLinha.push({
          coluna: colunaDe(campo),
          campo,
          bruto: String(v),
          motivo: MOTIVO[campo] ?? r.lido,
        });
      }
    }

    const valor = parseValor(bruto("inv_valor"));
    const venc  = parseDate(bruto("inv_vencimento"), ordem);
    const temBoleto = valor !== null || venc !== null;

    if (!semChave) totais.comContato++;
    else totais.semChave++;
    if (temBoleto && !semChave) totais.comBoleto++;
    if (problemasDaLinha.length) totais.comProblema++;
    if (valor !== null) totais.somaValor += valor;
    if (conflito && valor !== null) totais.valorEmConflito += valor;
    if (venc) {
      if (!totais.vencimentoDe  || venc < totais.vencimentoDe)  totais.vencimentoDe  = venc;
      if (!totais.vencimentoAte || venc > totais.vencimentoAte) totais.vencimentoAte = venc;
    }

    const conferida: LinhaConferida = {
      // +2: a linha 1 da planilha é o cabeçalho, e o índice começa em zero.
      // É o número que a pessoa vai procurar no Excel, não o do array.
      numero: idx + 2,
      contato: String(bruto("name") ?? "").trim() || String(bruto("empresa") ?? "").trim() || "—",
      telefone: tel,
      valor,
      vencimento: venc,
      problemas: problemasDaLinha,
      semChave,
      conflito,
    };

    if (linhas.length < MAX_DETALHE) linhas.push(conferida);
    else cortado = true;

    if ((problemasDaLinha.length > 0 || semChave || conflito) && problemas.length < MAX_PROBLEMA) {
      problemas.push(conferida);
    }
  });

  // Arredonda no fim, não a cada soma: somar centavos em ponto flutuante 500
  // vezes acumula erro que aparece no total.
  totais.somaValor       = Math.round(totais.somaValor * 100) / 100;
  totais.valorEmConflito = Math.round(totais.valorEmConflito * 100) / 100;

  return { linhas, problemas, totais, detalheCortado: cortado };
}
