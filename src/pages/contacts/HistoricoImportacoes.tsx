// Histórico de importações, com o botão de voltar atrás.
//
// Existe porque o desfazer que vive no fim do assistente só serve enquanto a
// janela está aberta. O caso real é outro: a pessoa importa, fecha, e no dia
// seguinte descobre que a planilha estava errada. Sem esta tela, a saída é
// apagar registro por registro — e ninguém faz isso com 200 linhas. Reimporta
// por cima, duplica o que der, e a base piora a cada tentativa.
//
// O filtro por período é o que torna isso utilizável: "o que entrou hoje",
// "o que entrou ontem". É assim que a pessoa se lembra do que fez, e não pelo
// nome do arquivo.

import { useCallback, useEffect, useState } from "react";
import {
  History, Loader2, Undo2, FileSpreadsheet, AlertTriangle, CheckCircle2, X,
  ChevronDown, ChevronRight, ScrollText,
} from "lucide-react";
import {
  listarImportacoes, desfazerImportacao, listarEventos,
  type Importacao, type Periodo, type EventoImportacao,
} from "@/lib/perfisDeImportacao";

const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: "hoje",   rotulo: "Hoje" },
  { id: "ontem",  rotulo: "Ontem" },
  { id: "7dias",  rotulo: "7 dias" },
  { id: "30dias", rotulo: "30 dias" },
  { id: "tudo",   rotulo: "Tudo" },
];

function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function HistoricoImportacoes({
  workspaceId, onFechar, onDesfeito,
}: {
  workspaceId: string;
  onFechar: () => void;
  onDesfeito?: () => void;
}) {
  const [periodo, setPeriodo]   = useState<Periodo>("7dias");
  const [lista, setLista]       = useState<Importacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [confirmar, setConfirmar]   = useState<Importacao | null>(null);
  const [desfazendo, setDesfazendo] = useState(false);
  const [aviso, setAviso]           = useState<{ ok: boolean; texto: string } | null>(null);
  const [aberto, setAberto]         = useState<string | null>(null);
  const [eventos, setEventos]       = useState<EventoImportacao[]>([]);
  const [carregandoLog, setCarregandoLog] = useState(false);

  async function abrirLog(id: string) {
    if (aberto === id) { setAberto(null); return; }
    setAberto(id);
    setCarregandoLog(true);
    setEventos(await listarEventos(id));
    setCarregandoLog(false);
  }

  const carregar = useCallback(async () => {
    setCarregando(true);
    setLista(await listarImportacoes(workspaceId, periodo));
    setCarregando(false);
  }, [workspaceId, periodo]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function confirmarDesfazer() {
    if (!confirmar) return;
    setDesfazendo(true);
    const r = await desfazerImportacao(confirmar.id);
    setDesfazendo(false);
    setConfirmar(null);
    setAviso({ ok: r.ok, texto: r.ok ? (r.resumo ?? "Importação desfeita.") : (r.erro ?? "Não foi possível desfazer.") });
    if (r.ok) { await carregar(); onDesfeito?.(); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
         style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
         onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="w-full max-w-2xl max-h-[85dvh] rounded-2xl flex flex-col overflow-hidden"
           style={{ background: "#0d1a11", border: "1px solid rgba(63,176,108,0.2)" }}>

        <div className="flex items-center justify-between px-5 py-4 shrink-0"
             style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
          <div className="flex items-center gap-2.5">
            <History className="w-4 h-4 text-agro-green" />
            <div>
              <h2 className="text-sm font-bold text-agro-text">Importações recentes</h2>
              <p className="text-[11px] text-[#6b7f6e]">Desfazer devolve a base ao estado anterior</p>
            </div>
          </div>
          <button onClick={onFechar} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b7f6e] hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 flex items-center gap-1.5 flex-wrap shrink-0">
          {PERIODOS.map((p) => (
            <button key={p.id} type="button" onClick={() => setPeriodo(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                periodo === p.id
                  ? "bg-[#3fb06c]/15 border-[#3fb06c]/40 text-white"
                  : "bg-transparent border-[#2a3d30] text-[#6b7f6e] hover:text-white"}`}>
              {p.rotulo}
            </button>
          ))}
        </div>

        {aviso && (
          <div className="mx-5 mb-3 rounded-xl px-3 py-2.5 flex items-start gap-2 shrink-0"
               style={{ background: aviso.ok ? "rgba(63,176,108,0.08)" : "rgba(239,68,68,0.08)",
                        border: `1px solid ${aviso.ok ? "rgba(63,176,108,0.25)" : "rgba(239,68,68,0.25)"}` }}>
            {aviso.ok ? <CheckCircle2 className="w-4 h-4 text-[#3fb06c] shrink-0 mt-0.5" />
                      : <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
            <p className="text-xs text-white/85">{aviso.texto}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-5 scrollbar-thin">
          {carregando ? (
            <div className="flex items-center justify-center py-12 text-[#6b7f6e] text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
            </div>
          ) : lista.length === 0 ? (
            <div className="text-center py-12">
              <FileSpreadsheet className="w-7 h-7 text-[#3a4d3e] mx-auto mb-2" />
              <p className="text-sm text-[#6b7f6e]">Nenhuma importação neste período.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {lista.map((imp) => {
                const desfeita = imp.status === "desfeita";
                const nadaAFazer = imp.contatos_criados === 0 && imp.boletos_criados === 0
                                && imp.contatos_atualizados === 0;
                return (
                  <div key={imp.id} className="rounded-xl px-4 py-3 flex items-start gap-3"
                       style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-agro-text font-medium truncate">
                        {imp.arquivo ?? "planilha sem nome"}
                      </p>
                      <p className="text-[11px] text-[#6b7f6e] mt-0.5">
                        {quando(imp.created_at)} · {imp.linhas} linhas
                      </p>
                      <p className="text-[11px] text-[#6b7f6e] mt-1 flex flex-wrap gap-x-3">
                        <span className="text-[#3fb06c]">{imp.contatos_criados} criados</span>
                        <span>{imp.contatos_atualizados} atualizados</span>
                        <span className="text-blue-400">{imp.boletos_criados} boletos</span>
                      </p>
                      {desfeita && (
                        <p className="text-[11px] text-[#6b7f6e] mt-1">
                          Desfeita em {imp.desfeita_em ? quando(imp.desfeita_em) : "—"}
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={() => void abrirLog(imp.id)}
                        className="mt-2 flex items-center gap-1 text-[11px] text-[#6b7f6e] hover:text-white transition-colors"
                      >
                        {aberto === imp.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <ScrollText className="w-3 h-3" /> Detalhes técnicos
                      </button>

                      {aberto === imp.id && (
                        <div className="mt-2 rounded-lg p-2.5 space-y-1.5"
                             style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(63,176,108,0.08)" }}>
                          {carregandoLog ? (
                            <p className="text-[11px] text-[#6b7f6e]">Carregando…</p>
                          ) : eventos.length === 0 ? (
                            <p className="text-[11px] text-[#6b7f6e]">
                              Sem registros. Importações feitas antes desta versão não têm trilha.
                            </p>
                          ) : eventos.map((e) => (
                            <div key={e.id} className="text-[11px] leading-relaxed">
                              <span className="font-mono text-[#3a4d3e]">
                                {new Date(e.created_at).toLocaleTimeString("pt-BR")}
                              </span>
                              <span className="mx-1.5 uppercase text-[9px] font-bold tracking-wider"
                                    style={{ color: e.nivel === "erro" ? "#f87171"
                                                  : e.nivel === "aviso" ? "#fbbf24" : "#6b7f6e" }}>
                                {e.etapa}
                              </span>
                              <span className={e.nivel === "erro" ? "text-red-300" : "text-white/80"}>
                                {e.mensagem}
                              </span>
                              {e.detalhe && (
                                <pre className="mt-0.5 text-[10px] text-[#6b7f6e] whitespace-pre-wrap break-all">
                                  {JSON.stringify(e.detalhe)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {desfeita ? (
                      <span className="text-[11px] text-[#6b7f6e] shrink-0 px-2 py-1 rounded-lg"
                            style={{ border: "1px solid rgba(107,114,128,0.25)" }}>
                        desfeita
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={nadaAFazer}
                        onClick={() => { setAviso(null); setConfirmar(imp); }}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#2a3d30] text-[#6b7f6e] hover:border-red-500/40 hover:text-red-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Undo2 className="w-3.5 h-3.5" /> Desfazer
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Confirmação com o número na frente: desfazer é irreversível, e a
          pessoa precisa ver quanto vai mexer antes de dizer sim. */}
      {confirmar && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4"
             style={{ background: "rgba(0,0,0,0.6)" }}
             onClick={(e) => { if (e.target === e.currentTarget && !desfazendo) setConfirmar(null); }}>
          <div className="w-full max-w-sm rounded-2xl p-5"
               style={{ background: "#0d1a11", border: "1px solid rgba(239,68,68,0.25)" }}>
            <p className="text-sm font-semibold text-agro-text">Desfazer esta importação?</p>
            <p className="text-xs text-[#6b7f6e] mt-2 leading-relaxed">
              Serão removidos <strong className="text-white">{confirmar.boletos_criados} boletos</strong> e
              {" "}<strong className="text-white">{confirmar.contatos_criados} contatos</strong> criados por ela.
              {confirmar.contatos_atualizados > 0 && (
                <> Outros <strong className="text-white">{confirmar.contatos_atualizados}</strong> que já existiam
                voltam ao estado anterior.</>
              )}
            </p>
            <p className="text-[11px] text-[#6b7f6e] mt-2 leading-relaxed">
              Contatos que já receberam mensagem no inbox são mantidos — histórico de atendimento
              não é apagado por causa de planilha.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button" disabled={desfazendo} onClick={() => setConfirmar(null)}
                className="flex-1 py-2 rounded-lg text-xs font-medium text-[#6b7f6e] hover:text-white disabled:opacity-50"
                style={{ border: "1px solid rgba(63,176,108,0.12)" }}>
                Cancelar
              </button>
              <button type="button" disabled={desfazendo} onClick={confirmarDesfazer}
                className="flex-1 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-60"
                style={{ background: "rgba(239,68,68,0.85)" }}>
                {desfazendo ? "Desfazendo…" : "Desfazer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
