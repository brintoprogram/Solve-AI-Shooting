// Um telefone, vários nomes, uma decisão por nome.
//
// O sistema identifica cliente pelo telefone, e a coluna é única por
// workspace. Isso deixava só duas saídas quando dois nomes dividiam um número,
// e as duas eram ruins: juntar pessoas diferentes no mesmo cadastro, ou perder
// o boleto. A terceira saída — cadastro próprio com telefone provisório — é o
// que permite o cliente existir mesmo sem número, com a dívida no lugar certo.
//
// Mostrar o VALOR de cada nome não é enfeite: a decisão "para qual cadastro
// isso vai" só é possível vendo quanto dinheiro está de cada lado.

import { Phone } from "lucide-react";
import { telefoneProvisorio, type AcaoConflito } from "@/lib/importUtils";
import type { GrupoConflito } from "@/lib/conferencia";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/* Separar vem primeiro e é o padrão. Numa planilha de cobrança, dois nomes
   diferentes no mesmo telefone quase sempre são duas pessoas atendidas pelo
   mesmo representante — não a mesma pessoa escrita de dois jeitos. Juntar por
   padrão misturaria a dívida de clientes distintos, que é o erro mais caro dos
   três. */
const OPCOES: { id: AcaoConflito; rotulo: string; ajuda: string }[] = [
  { id: "separar", rotulo: "Separar",        ajuda: "cria cadastro próprio, com telefone provisório" },
  { id: "juntar",  rotulo: "Juntar",         ajuda: "os boletos entram no cadastro principal" },
  { id: "fora",    rotulo: "Deixar de fora", ajuda: "não importa estes boletos" },
];

export function GrupoDeConflito({
  grupo, decisao, onEscolherDono, onDefinirAcao,
}: {
  grupo: GrupoConflito;
  decisao: { nome: string; acoes: Record<string, AcaoConflito> };
  onEscolherDono: (nome: string) => void;
  onDefinirAcao: (nome: string, acao: AcaoConflito) => void;
}) {
  return (
    <div className="rounded-xl px-4 py-3"
         style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.14)" }}>
      <p className="flex items-center gap-2 text-xs text-[#6b7f6e] flex-wrap">
        <Phone className="w-3.5 h-3.5" />
        <span className="font-mono text-white/85">{grupo.telefone}</span>
        <span>· {grupo.nomes.length} nomes · {brl.format(grupo.total)} em jogo</span>
      </p>

      <div className="mt-2.5 space-y-1.5">
        {grupo.nomes.map((n) => {
          const ehDono = n.nome === decisao.nome;
          const acao: AcaoConflito = ehDono ? "juntar" : (decisao.acoes[n.nome] ?? "separar");
          return (
            <div key={n.nome} className="px-2.5 py-2 rounded-lg"
                 style={{
                   background: ehDono ? "rgba(63,176,108,0.1)" : "transparent",
                   border: `1px solid ${ehDono ? "rgba(63,176,108,0.3)" : "rgba(63,176,108,0.06)"}`,
                 }}>
              <div className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name={`dono-${grupo.telefone}`}
                  checked={ehDono}
                  onChange={() => onEscolherDono(n.nome)}
                  title="Fica com o telefone real"
                  className="mt-1 accent-[#3fb06c]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-agro-text">
                    {n.nome}
                    {ehDono && (
                      <span className="ml-2 text-[10px] text-[#3fb06c]">fica com o telefone real</span>
                    )}
                  </span>
                  <span className="block text-[11px] text-[#6b7f6e]">
                    {n.boletos} boleto{n.boletos === 1 ? "" : "s"} · {brl.format(n.total)}
                    {" · "}linha{n.linhas.length === 1 ? "" : "s"} {n.linhas.slice(0, 6).join(", ")}
                    {n.linhas.length > 6 && ` e mais ${n.linhas.length - 6}`}
                  </span>
                </span>
              </div>

              {!ehDono && (
                <div className="mt-1.5 ml-6 flex flex-wrap items-center gap-1.5">
                  {OPCOES.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      title={o.ajuda}
                      onClick={() => onDefinirAcao(n.nome, o.id)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                        acao === o.id
                          ? "border-[#3fb06c]/45 text-white bg-[#3fb06c]/15"
                          : "border-[#2a3d30] text-[#6b7f6e] hover:text-white"}`}
                    >
                      {o.rotulo}
                    </button>
                  ))}
                  {acao === "separar" && (
                    <span className="text-[11px] text-[#6b7f6e]">
                      vira <span className="font-mono text-white/70">{telefoneProvisorio(n.nome)}</span>
                    </span>
                  )}
                  {acao === "fora" && (
                    <span className="text-[11px] text-red-300">
                      {brl.format(n.total)} não entram
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
