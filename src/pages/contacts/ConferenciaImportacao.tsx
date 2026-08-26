// A última tela antes de gravar: o que vai acontecer, linha a linha.
//
// A tela anterior explica como cada COLUNA foi entendida. Esta responde a outra
// metade: o que acontece com cada LINHA. São perguntas diferentes — uma coluna
// pode estar mapeada certinho e ainda assim ter 40 linhas que não entram.
//
// O resumo antigo dizia "40 linhas com defeito". Com 528 linhas isso é o mesmo
// que não dizer nada: a pessoa não tem como achar quais são. Aqui cada problema
// vem com o NÚMERO DA LINHA NO EXCEL, a coluna, o valor original e o motivo —
// os quatro dados necessários para ela abrir a planilha e corrigir.

import { useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Users, FileText, Coins, CalendarRange,
  Copy, Search, ArrowLeft,
} from "lucide-react";
import { conferir, type LinhaConferida } from "@/lib/conferencia";
import type { ParsedFile, Mapping, OrdemData } from "@/lib/importUtils";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function dataBR(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function Cartao({ icone: Icone, rotulo, valor, sub, cor }: {
  icone: React.ComponentType<{ className?: string }>;
  rotulo: string; valor: string; sub?: string; cor: string;
}) {
  return (
    <div className="rounded-xl px-3 py-3" style={{ background: `${cor}12`, border: `1px solid ${cor}30` }}>
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: cor }}>
        <Icone className="w-3 h-3" /> {rotulo}
      </p>
      <p className="text-xl font-bold text-white mt-1 tabular-nums">{valor}</p>
      {sub && <p className="text-[11px] text-[#6b7f6e] mt-0.5 leading-tight">{sub}</p>}
    </div>
  );
}

export function ConferenciaImportacao({
  parsed, mapping, ordem, onVoltar,
}: {
  parsed: ParsedFile;
  mapping: Mapping;
  ordem: OrdemData;
  onVoltar: () => void;
}) {
  const c = useMemo(() => conferir(parsed, mapping, ordem), [parsed, mapping, ordem]);
  const [aba, setAba]   = useState<"resumo" | "linhas" | "problemas">(
    c.totais.comProblema > 0 || c.totais.semChave > 0 ? "problemas" : "resumo");
  const [busca, setBusca] = useState("");

  const t = c.totais;
  const entram = t.comContato;

  const filtradas = (lista: LinhaConferida[]) => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((l) =>
      l.contato.toLowerCase().includes(q) ||
      l.telefone.includes(q) ||
      String(l.numero) === q);
  };

  const copiarProblemas = () => {
    const texto = c.problemas.map((l) => {
      const motivos = l.semChave
        ? "sem telefone e sem CPF"
        : l.problemas.map((p) => `${p.coluna}="${p.bruto}" (${p.motivo})`).join("; ");
      return `Linha ${l.numero} · ${l.contato} · ${motivos}`;
    }).join("\n");
    void navigator.clipboard?.writeText(texto);
  };

  const abas = [
    { id: "resumo"    as const, rotulo: "Resumo",       n: null },
    { id: "linhas"    as const, rotulo: "Linha a linha", n: c.linhas.length },
    { id: "problemas" as const, rotulo: "Problemas",    n: c.problemas.length },
  ];

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onVoltar}
        className="self-start flex items-center gap-1.5 text-xs text-[#6b7f6e] hover:text-white transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Voltar ao mapeamento
      </button>

      {/* ── Cartões ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Cartao icone={Users} rotulo="Contatos" cor="#3fb06c"
                valor={String(entram)}
                sub={t.semChave > 0 ? `${t.semChave} sem dono, fora` : "todas as linhas têm dono"} />
        <Cartao icone={FileText} rotulo="Boletos" cor="#60a5fa"
                valor={String(t.comBoleto)}
                sub="linhas com valor ou vencimento" />
        <Cartao icone={Coins} rotulo="Soma" cor="#fbbf24"
                valor={brl.format(t.somaValor)}
                sub="total dos boletos da planilha" />
        <Cartao icone={CalendarRange} rotulo="Vencimentos" cor="#c084fc"
                valor={t.vencimentoDe ? dataBR(t.vencimentoDe) : "—"}
                sub={t.vencimentoAte ? `até ${dataBR(t.vencimentoAte)}` : "nenhuma data lida"} />
      </div>

      {/* A soma é o número que a pessoa confere contra o sistema dela. Se
          bater, a leitura está certa; se não bater, algo foi lido errado e
          ainda dá tempo de voltar. */}
      {t.duplicadosNoArquivo > 0 && (
        <div className="rounded-xl px-4 py-2.5 flex items-start gap-2.5"
             style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.28)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#fbbf24" }} />
          <p className="text-xs text-white/85 leading-relaxed">
            <strong>{t.duplicadosNoArquivo}</strong>{" "}
            {t.duplicadosNoArquivo === 1 ? "linha repete um telefone" : "linhas repetem telefones"}
            {" "}que já aparece antes no próprio arquivo. A última vence — as anteriores não viram
            contatos separados. Os boletos de todas elas entram no mesmo cliente.
          </p>
        </div>
      )}

      {/* ── Abas ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              aba === a.id
                ? "bg-[#3fb06c]/15 border-[#3fb06c]/40 text-white"
                : "bg-transparent border-[#2a3d30] text-[#6b7f6e] hover:text-white"}`}
          >
            {a.rotulo}
            {a.n !== null && a.n > 0 && (
              <span className={a.id === "problemas" ? "ml-1.5 text-amber-400" : "ml-1.5 text-[#6b7f6e]"}>
                {a.n}
              </span>
            )}
          </button>
        ))}

        {aba !== "resumo" && (
          <div className="relative ml-auto min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6b7f6e]" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="nome, telefone ou nº da linha"
              className="w-full bg-[#0d1710] border border-[#2a3d30] rounded-lg pl-8 pr-2 py-1.5 text-xs text-white placeholder:text-[#3a4d3e] focus:outline-none focus:border-[#3fb06c]"
            />
          </div>
        )}
      </div>

      {/* ── Resumo ──────────────────────────────────────────────── */}
      {aba === "resumo" && (
        <div className="rounded-xl border border-[#2a3d30] divide-y divide-[#1e2e22]">
          {[
            { r: "Linhas na planilha",              v: String(t.linhas) },
            { r: "Viram ou atualizam contato",      v: String(t.comContato) },
            { r: "Trazem boleto",                   v: String(t.comBoleto) },
            { r: "Não entram (sem telefone e sem CPF)", v: String(t.semChave), alerta: t.semChave > 0 },
            { r: "Com algum campo ilegível",        v: String(t.comProblema), alerta: t.comProblema > 0 },
            { r: "Soma dos boletos",                v: brl.format(t.somaValor) },
          ].map((l) => (
            <div key={l.r} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-xs text-[#6b7f6e]">{l.r}</span>
              <span className={`text-sm font-semibold tabular-nums ${l.alerta ? "text-amber-400" : "text-white"}`}>
                {l.v}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Linha a linha ───────────────────────────────────────── */}
      {aba === "linhas" && (
        <div className="rounded-xl border border-[#2a3d30] overflow-auto max-h-[46vh]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#111a14]">
              <tr className="text-[#6b7f6e]">
                <th className="px-3 py-2 text-left font-medium w-14">Linha</th>
                <th className="px-3 py-2 text-left font-medium">Contato</th>
                <th className="px-3 py-2 text-left font-medium">Telefone</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
                <th className="px-3 py-2 text-left font-medium">Vencimento</th>
              </tr>
            </thead>
            <tbody>
              {filtradas(c.linhas).map((l) => (
                <tr key={l.numero} className="border-t border-[#1e2e22]">
                  <td className="px-3 py-2 text-[#6b7f6e] tabular-nums">{l.numero}</td>
                  <td className="px-3 py-2 text-white/85">
                    {l.contato}
                    {l.semChave && <span className="ml-2 text-[10px] text-amber-400">não entra</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[#6b7f6e]">{l.telefone || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white/85">
                    {l.valor === null ? "—" : brl.format(l.valor)}
                  </td>
                  <td className="px-3 py-2 text-[#6b7f6e]">{dataBR(l.vencimento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.detalheCortado && (
            <p className="px-3 py-2 text-[11px] text-[#6b7f6e] border-t border-[#1e2e22]">
              Mostrando as {c.linhas.length} primeiras linhas. Os totais acima são da planilha inteira.
            </p>
          )}
        </div>
      )}

      {/* ── Problemas ───────────────────────────────────────────── */}
      {aba === "problemas" && (
        c.problemas.length === 0 ? (
          <div className="rounded-xl border border-[#2a3d30] py-10 text-center">
            <CheckCircle2 className="w-7 h-7 text-[#3fb06c] mx-auto mb-2" />
            <p className="text-sm text-white/85">Nenhuma linha com problema.</p>
            <p className="text-xs text-[#6b7f6e] mt-1">Todas as {t.linhas} linhas foram lidas por inteiro.</p>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={copiarProblemas}
              className="self-start flex items-center gap-1.5 text-[11px] text-[#6b7f6e] hover:text-white transition-colors"
            >
              <Copy className="w-3 h-3" /> Copiar lista para corrigir na planilha
            </button>
            <div className="rounded-xl border border-[#2a3d30] overflow-auto max-h-[42vh] divide-y divide-[#1e2e22]">
              {filtradas(c.problemas).map((l) => (
                <div key={l.numero} className="px-4 py-2.5">
                  <p className="text-xs text-white/85">
                    <span className="font-mono text-[#6b7f6e]">Linha {l.numero}</span>
                    <span className="mx-1.5 text-[#3a4d3e]">·</span>
                    {l.contato}
                  </p>
                  {l.semChave && (
                    <p className="text-[11px] text-amber-400 mt-1">
                      Sem telefone e sem CPF — não há como saber de quem é. Esta linha não entra.
                    </p>
                  )}
                  {l.problemas.map((p, i) => (
                    <p key={i} className="text-[11px] mt-1 leading-relaxed">
                      <span className="text-[#6b7f6e]">{p.coluna}: </span>
                      <span className="font-mono text-amber-400">{p.bruto.slice(0, 40)}</span>
                      <span className="text-[#6b7f6e]"> — {p.motivo}. Fica em branco.</span>
                    </p>
                  ))}
                </div>
              ))}
            </div>
            {c.problemas.length >= 500 && (
              <p className="text-[11px] text-[#6b7f6e]">
                Mostrando os 500 primeiros problemas.
              </p>
            )}
          </>
        )
      )}
    </div>
  );
}
