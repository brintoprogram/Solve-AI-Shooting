// Como o sistema leu a planilha, antes de importar qualquer coisa.
//
// A tela anterior mostrava a coluna, o campo escolhido e três valores BRUTOS.
// O valor bruto é o que a pessoa já sabe: ela acabou de exportar o arquivo. O
// que ela não tem como saber é a INTERPRETAÇÃO — se "1.250" virou mil duzentos
// e cinquenta ou um e vinte e cinco, se "03/04" virou março ou abril.
//
// Os dois erros que essa leitura pega são silenciosos por natureza: produzem
// valores plausíveis, não erros. Ninguém percebe olhando a lista de contatos
// depois. Percebe quando o cliente reclama da cobrança.
//
// Por isso cada linha aqui responde três perguntas, nesta ordem:
//   o que é essa coluna · por que o sistema acha isso · como ficou o dado

import { useMemo } from "react";
import {
  ArrowRight, ChevronDown, AlertTriangle, CheckCircle2, HelpCircle, CalendarClock,
} from "lucide-react";
import {
  MAPPABLE_FIELDS, autoDetectDetalhado, analisarColunaDeData, interpretar, tipoDoCampo,
  pareceTelefone,
  type ParsedFile, type Mapping, type FieldKey, type OrdemData, type Confianca,
} from "@/lib/importUtils";

const CONTACT_FIELDS = MAPPABLE_FIELDS.filter((f) => f.category === "contact");
const INVOICE_FIELDS = MAPPABLE_FIELDS.filter((f) => f.category === "invoice");

/** Como o sistema explica o próprio palpite. A confiança fraca é a que mais
 *  importa: é onde ele acertou por coincidência de letras e pode estar errado. */
const EXPLICA: Record<Confianca, { texto: string; cor: string }> = {
  exata:   { texto: "o nome da coluna bate exatamente", cor: "#3fb06c" },
  forte:   { texto: "reconheci pela palavra",           cor: "#3fb06c" },
  fraca:   { texto: "chutei pelo pedaço",               cor: "#fbbf24" },
  nenhuma: { texto: "não reconheci",                    cor: "#6b7f6e" },
};

export function FieldSelect({
  value, onChange, usedKeys,
}: {
  value: FieldKey | "";
  onChange: (v: FieldKey | "") => void;
  usedKeys: FieldKey[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as FieldKey | "")}
        className="w-full appearance-none bg-[#0d1710] border border-[#2a3d30] rounded-lg px-2 py-1.5 pr-6 text-xs text-white focus:outline-none focus:border-[#3fb06c] cursor-pointer"
      >
        <option value="">— Ignorar —</option>
        <optgroup label="Contato">
          {CONTACT_FIELDS.map((f) => (
            <option key={f.key} value={f.key} disabled={usedKeys.includes(f.key as FieldKey)}>{f.label}</option>
          ))}
        </optgroup>
        <optgroup label="Boleto / NF">
          {INVOICE_FIELDS.map((f) => (
            <option key={f.key} value={f.key} disabled={usedKeys.includes(f.key as FieldKey)}>{f.label}</option>
          ))}
        </optgroup>
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#6b7f6e] pointer-events-none" />
    </div>
  );
}

export function LeituraDaPlanilha({
  parsed, mapping, setMapping, ordem, setOrdem,
}: {
  parsed: ParsedFile;
  mapping: Mapping;
  setMapping: (m: Mapping) => void;
  ordem: OrdemData;
  setOrdem: (o: OrdemData) => void;
}) {
  const deteccao = useMemo(() => autoDetectDetalhado(parsed.headers), [parsed.headers]);

  const colunaDe = (header: string) => parsed.headers.indexOf(header);
  const valoresDe = (header: string) => {
    const i = colunaDe(header);
    return parsed.rows.map((r) => r[i]);
  };

  // O laudo das datas é da coluna inteira, não das 3 linhas da amostra: basta
  // UM valor com dia acima de 12 em qualquer linha para a ordem estar provada.
  const laudoDatas = useMemo(() => {
    const alvo = parsed.headers.find((h) => mapping[h] === "inv_vencimento");
    return alvo ? { header: alvo, ...analisarColunaDeData(valoresDe(alvo), ordem) } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, mapping, ordem]);

  const reconhecidas = parsed.headers.filter((h) => mapping[h]).length;
  const ignoradas    = parsed.headers.length - reconhecidas;

  /* O sistema identifica contato pelo TELEFONE. Sem uma coluna de telefone,
     nenhuma linha tem como ser atribuída a alguém e a importação inteira
     grava zero — foi o que aconteceu com uma planilha de 528 linhas cuja
     coluna "NUMERO CLIENTE" foi lida como número de endereço.
     
     O cabeçalho enganou; o conteúdo, não. Por isso a sugestão olha os dados. */
  const temTelefone = parsed.headers.some((h) => mapping[h] === "phone");
  const temCpf      = parsed.headers.some((h) => mapping[h] === "cpf_cnpj");

  const candidatoTelefone = useMemo(() => {
    if (temTelefone) return null;
    return parsed.headers.find((_, i) => pareceTelefone(parsed.rows.map((r) => r[i]))) ?? null;
  }, [parsed, temTelefone]);

  const usarComoTelefone = (header: string) => {
    const novo: Mapping = { ...mapping };
    // Libera o campo de quem estiver com ele, senão dois cabeçalhos disputam.
    for (const h of Object.keys(novo)) if (novo[h] === "phone") novo[h] = "";
    novo[header] = "phone";
    setMapping(novo);
  };

  /* Amostra e contagem de problemas de TODAS as colunas, numa passada só e
     memoizadas.
     
     A primeira versão calculava isto durante o render, por coluna, varrendo a
     planilha inteira duas vezes cada uma. Numa planilha de 5 mil linhas por 20
     colunas dava 100 mil interpretações A CADA RENDER — inclusive a cada tecla
     digitada e a cada troca de campo. Medido: 3,5 s no Node, pior no
     navegador. A aba congelava, e o clique em "Importar" não chegava a
     acontecer: parecia que a importação simplesmente não fazia nada.

     A amostra são as 3 primeiras linhas COM conteúdo. Pegar as 3 primeiras da
     planilha mostraria "—" três vezes quando a coluna começa vazia, e a pessoa
     não veria interpretação nenhuma justo onde precisa. */
  const porColuna = useMemo(() => {
    const mapa = new Map<string, { amostra: unknown[]; problemas: number }>();
    parsed.headers.forEach((header, i) => {
      const campo = mapping[header] ?? "";
      const conferir = campo !== "" && tipoDoCampo(campo as FieldKey) !== "texto";
      const amostra: unknown[] = [];
      let problemas = 0;

      for (const linha of parsed.rows) {
        const v = linha[i];
        const vazio = v === null || v === undefined || String(v).trim() === "";
        if (!vazio && amostra.length < 3) amostra.push(v);
        if (conferir && !vazio && !interpretar(campo as FieldKey, v, ordem).ok) problemas++;
      }

      if (amostra.length === 0) {
        for (const linha of parsed.rows.slice(0, 3)) amostra.push(linha[i]);
      }
      mapa.set(header, { amostra, problemas });
    });
    return mapa;
  }, [parsed, mapping, ordem]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6b7f6e]">
        <span>{parsed.rows.length} linhas</span>
        <span>·</span>
        <span className="text-[#3fb06c]">{reconhecidas} colunas reconhecidas</span>
        {ignoradas > 0 && <><span>·</span><span>{ignoradas} ignoradas</span></>}
      </div>

      {/* ── Sem telefone, nada entra ─────────────────────────────── */}
      {!temTelefone && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.3)" }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#f87171" }} />
          <div className="min-w-0 flex-1 text-xs leading-relaxed">
            <p className="text-white/90">
              <strong>Nenhuma coluna está sendo lida como telefone.</strong>{" "}
              {temCpf
                ? "As linhas só vão atualizar contatos que já existem — nenhum cliente novo será criado."
                : `Sem telefone o sistema não consegue saber de quem é cada linha, e as ${parsed.rows.length} linhas serão ignoradas.`}
            </p>
            {candidatoTelefone && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-agro-muted">
                  A coluna <span className="font-mono text-agro-text">{candidatoTelefone}</span> parece
                  conter telefones.
                </span>
                <button
                  type="button"
                  onClick={() => usarComoTelefone(candidatoTelefone)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white"
                  style={{ background: "rgba(63,176,108,0.9)" }}
                >
                  Usar como telefone
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Ordem das datas ─────────────────────────────────────────
          Só aparece quando existe coluna de data, porque fora daí é uma
          pergunta sem contexto. Quando os dados provam a ordem, o controle
          informa; quando não provam, ele pergunta — e essa é a diferença que
          decide se a pessoa precisa parar para pensar. */}
      {laudoDatas && (
        <div
          className="rounded-xl px-4 py-3 flex flex-col gap-2.5"
          style={{
            background: laudoDatas.ambigua ? "rgba(251,191,36,0.07)" : "rgba(63,176,108,0.06)",
            border: `1px solid ${laudoDatas.ambigua ? "rgba(251,191,36,0.3)" : "rgba(63,176,108,0.18)"}`,
          }}
        >
          <div className="flex items-start gap-2.5">
            {laudoDatas.ambigua
              ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#fbbf24" }} />
              : <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#3fb06c" }} />}
            <div className="min-w-0 text-xs leading-relaxed">
              {laudoDatas.prova ? (
                <p className="text-white/85">
                  As datas estão em <strong>{laudoDatas.ordem === "dmy" ? "dia/mês/ano" : "mês/dia/ano"}</strong>.
                  {" "}O valor <span className="font-mono text-white">{laudoDatas.prova}</span> na coluna
                  {" "}<span className="font-mono">{laudoDatas.header}</span> não deixa dúvida.
                </p>
              ) : laudoDatas.afetados > 0 ? (
                <p className="text-white/85">
                  <strong>Nenhuma linha prova a ordem das datas.</strong>{" "}
                  {laudoDatas.afetados} {laudoDatas.afetados === 1 ? "data muda" : "datas mudam"} de
                  significado conforme a escolha abaixo. Se a planilha veio de um sistema em inglês,
                  provavelmente é mês/dia.
                </p>
              ) : (
                <p className="text-white/85">As datas desta planilha não são ambíguas.</p>
              )}
              {laudoDatas.invalidos > 0 && (
                <p className="text-[#fbbf24] mt-1">
                  {laudoDatas.invalidos} {laudoDatas.invalidos === 1 ? "valor não é" : "valores não são"} data
                  e {laudoDatas.invalidos === 1 ? "vai ficar" : "vão ficar"} em branco.
                </p>
              )}
            </div>
          </div>

          {(laudoDatas.ambigua || laudoDatas.afetados > 0) && (
            <div className="flex items-center gap-2 pl-6">
              <CalendarClock className="w-3.5 h-3.5 text-[#6b7f6e]" />
              {(["dmy", "mdy"] as OrdemData[]).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOrdem(o)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                    ordem === o
                      ? "bg-[#3fb06c]/15 border-[#3fb06c]/40 text-white"
                      : "bg-transparent border-[#2a3d30] text-[#6b7f6e] hover:text-white"}`}
                >
                  {o === "dmy" ? "dia/mês/ano (Brasil)" : "mês/dia/ano (EUA)"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tabela de leitura ───────────────────────────────────── */}
      <div className="rounded-xl border border-[#2a3d30] overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#2a3d30] bg-[#111a14]">
              <th className="px-3 py-2 text-left text-[#6b7f6e] font-medium w-[190px]">Coluna da planilha</th>
              <th className="px-3 py-2 text-center text-[#6b7f6e] font-medium w-8"></th>
              <th className="px-3 py-2 text-left text-[#6b7f6e] font-medium w-[190px]">Campo Solve AI</th>
              <th className="px-3 py-2 text-left text-[#6b7f6e] font-medium">Como o sistema leu</th>
            </tr>
          </thead>
          <tbody>
            {parsed.headers.map((header) => {
              const campo = mapping[header] ?? "";
              const det   = deteccao[header];
              const { amostra, problemas } = porColuna.get(header) ?? { amostra: [], problemas: 0 };
              // O palpite só vale como explicação enquanto ninguém mexeu: se a
              // pessoa trocou o campo à mão, dizer "reconheci pela palavra X"
              // seria mentira sobre a escolha dela.
              const explicaVale = campo && det?.campo === campo;

              return (
                <tr key={header} className="border-b border-[#1e2e22] last:border-0 align-top">
                  <td className="px-3 py-2.5">
                    <p className="font-mono text-white/80 break-words">{header}</p>
                    {explicaVale && det.termo && (
                      <p className="text-[10px] mt-0.5 leading-tight" style={{ color: EXPLICA[det.confianca].cor }}>
                        {EXPLICA[det.confianca].texto}
                        {det.confianca !== "exata" && <> “{det.termo}”</>}
                      </p>
                    )}
                    {!campo && (
                      <p className="text-[10px] mt-0.5 text-[#6b7f6e] flex items-center gap-1">
                        <HelpCircle className="w-3 h-3" /> não vai ser importada
                      </p>
                    )}
                  </td>

                  <td className="px-3 py-3 text-center">
                    <ArrowRight className={`w-3 h-3 mx-auto ${campo ? "text-[#3fb06c]" : "text-[#2a3d30]"}`} />
                  </td>

                  <td className="px-3 py-2">
                    <FieldSelect
                      value={campo}
                      onChange={(v) => setMapping({ ...mapping, [header]: v })}
                      usedKeys={Object.values(mapping).filter((k) => k && k !== campo) as FieldKey[]}
                    />
                  </td>

                  <td className="px-3 py-2.5">
                    {!campo ? (
                      <span className="text-[#3a4d3e]">—</span>
                    ) : (
                      <div className="space-y-0.5">
                        {amostra.map((bruto, i) => {
                          const { lido, ok } = interpretar(campo as FieldKey, bruto, ordem);
                          const cru = bruto === null || bruto === undefined || String(bruto).trim() === ""
                            ? "(vazio)" : String(bruto);
                          const mudou = cru !== lido;
                          return (
                            <div key={i} className="flex items-baseline gap-1.5 flex-wrap leading-snug">
                              <span className="font-mono text-[#6b7f6e]">{cru.slice(0, 28)}</span>
                              {mudou && <span className="text-[#3a4d3e]">→</span>}
                              {mudou && (
                                <span className={ok ? "text-white/90 font-medium" : "text-[#fbbf24]"}>{lido}</span>
                              )}
                            </div>
                          );
                        })}
                        {problemas > 0 && (
                          <p className="text-[10px] text-[#fbbf24] pt-1 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            {problemas} {problemas === 1 ? "linha não pôde ser lida" : "linhas não puderam ser lidas"}
                            {" "}nesta coluna
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
