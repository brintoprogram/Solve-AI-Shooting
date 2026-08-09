// Player das demonstrações.
//
// Um componente toca qualquer roteiro de src/types/demos.ts, montando o palco
// que aquela demo pede. A primeira versão tinha um palco só — chat — e a demo
// de disparo em massa, que não tem conversa nenhuma, exibia um WhatsApp vazio
// ao lado de "2.847 contatos". Palco é escolha do roteiro agora.
//
// Duas decisões de ergonomia, das duas formas de usar:
//
//   Explorando  → passo a passo manual, você lê no seu ritmo.
//   Apresentando → tela cheia, texto grande, setas do teclado. Quem assiste
//                  está longe do monitor, e o menu lateral só atrapalha.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play, Pause, RotateCcw, ChevronRight, ChevronLeft, Zap, Maximize2, Minimize2,
  GitBranch, Clock, Handshake, ExternalLink, Cake, Send, Bot, ShieldCheck,
  Ban, UserCog, Lock, FileText, Check, Calendar, Users, Coins,
  MessageSquare, Bell, DoorOpen, DoorClosed,
} from "lucide-react";
import type { Demo, Passo, EstadoEnvio } from "@/types/demos";

const ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  GitBranch, Clock, Handshake, ExternalLink, Cake, Send, Bot, ShieldCheck,
  Ban, UserCog, Lock, FileText, Check, Calendar, Users, Coins,
  MessageSquare, Bell, DoorOpen, DoorClosed, Zap,
};

const ESTADO: Record<EstadoEnvio, { rotulo: string; cor: string; bg: string }> = {
  fila:      { rotulo: "na fila",    cor: "#6b8f77", bg: "rgba(122,158,131,0.1)" },
  enviada:   { rotulo: "enviada",    cor: "#60a5fa", bg: "rgba(96,165,250,0.12)" },
  entregue:  { rotulo: "entregue",   cor: "#3fb06c", bg: "rgba(63,176,108,0.12)" },
  lida:      { rotulo: "lida",       cor: "#4ade80", bg: "rgba(74,222,128,0.16)" },
  respondeu: { rotulo: "respondeu",  cor: "#c084fc", bg: "rgba(192,132,252,0.16)" },
  saiu:      { rotulo: "pediu sair", cor: "#f87171", bg: "rgba(248,113,113,0.14)" },
};

function duracao(p: Passo): number {
  switch (p.t) {
    case "digitando": return p.ms ?? 1100;
    case "msg":       return 1600;
    case "nota":      return 3200;
    case "pausa":     return 1800;
    case "status":    return 500;
    case "tela":      return 2400;
    default:          return 1200;
  }
}

/** Estado acumulado até um passo. Recalculado do zero a cada avanço: é barato
 *  para roteiros deste tamanho e elimina a classe de bug em que voltar um passo
 *  deixa resíduo do passo seguinte. */
function acumular(passos: Passo[], ate: number) {
  // Tipos estreitos nas listas: `Passo[]` obrigaria narrowing em todo lugar que
  // lê .texto ou .cor, e o TypeScript não estreita dentro de .map().
  const chat: Extract<Passo, { t: "msg" } | { t: "digitando" }>[] = [];
  const lateral: Extract<Passo, { t: "sistema" } | { t: "metrica" }>[] = [];
  let lista: { nome: string; sub?: string; estado: EstadoEnvio }[] = [];
  let tela: Extract<Passo, { t: "tela" }> | null = null;
  let agenda: Extract<Passo, { t: "agenda" }> | null = null;
  let nota: string | null = null;
  let pausa: string | null = null;

  // `for` e não `forEach`: o TypeScript não acompanha atribuição feita dentro
  // de callback, e `tela`/`agenda` acabavam estreitados para `never`.
  const vistos = passos.slice(0, ate);
  for (let i = 0; i < vistos.length; i++) {
    const p = vistos[i];
    switch (p.t) {
      case "msg":       chat.push(p); break;
      case "digitando": if (i === vistos.length - 1) chat.push(p); break;
      case "sistema":
      case "metrica":   lateral.push(p); break;
      case "lista":     lista = p.itens.map((x) => ({ ...x, estado: "fila" as EstadoEnvio })); break;
      case "status":    lista = lista.map((x) => x.nome === p.nome ? { ...x, estado: p.estado } : x); break;
      case "tela":      tela = p; break;
      case "agenda":    agenda = p; break;
      case "nota":      nota = p.texto; break;
      case "pausa":     pausa = p.rotulo; break;
    }
  }

  // A nota fica na tela até a próxima substituí-la — é a fala do apresentador,
  // e some no meio da frase seria pior que ficar. Já a pausa é um marco: só
  // aparece enquanto ela for o último passo dado.
  const ultimo = ate > 0 ? passos[ate - 1] : null;
  if (!ultimo || ultimo.t !== "pausa") pausa = null;

  return { chat, lateral, lista, tela, agenda, nota, pausa };
}

function Balao({ p, grande }: { p: Extract<Passo, { t: "msg" }>; grande: boolean }) {
  const meu = p.de === "empresa";
  return (
    <div className={`flex ${meu ? "justify-end" : "justify-start"} animate-fade-up`}>
      <div className="max-w-[82%] rounded-2xl px-3.5 py-2.5"
           style={meu
             ? { background: "linear-gradient(135deg, rgba(63,176,108,0.22), rgba(22,163,74,0.12))",
                 border: "1px solid rgba(63,176,108,0.3)", borderBottomRightRadius: 6 }
             : { background: "rgba(255,255,255,0.05)",
                 border: "1px solid rgba(255,255,255,0.08)", borderBottomLeftRadius: 6 }}>
        <p className={`${grande ? "text-lg" : "text-[13px]"} leading-relaxed text-agro-text whitespace-pre-wrap`}>
          {p.texto}
        </p>
        {p.hora && <p className="text-[9px] text-agro-muted-2 mt-1 text-right tabular-nums">{p.hora}</p>}
      </div>
    </div>
  );
}

function Digitando({ de }: { de: "cliente" | "empresa" }) {
  return (
    <div className={`flex ${de === "empresa" ? "justify-end" : "justify-start"}`}>
      <div className="rounded-2xl px-3.5 py-3 flex gap-1"
           style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: "#6b8f77", animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

export function DemoPlayer({ demo }: { demo: Demo }) {
  const passos = demo.passos ?? [];
  const [ate,  setAte]  = useState(0);
  const [auto, setAuto] = useState(false);
  const [cheia, setCheia] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limpar = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  useEffect(() => { limpar(); setAte(0); setAuto(false); }, [demo.id, limpar]);

  useEffect(() => {
    if (!auto || ate >= passos.length) { limpar(); return; }
    timer.current = setTimeout(() => setAte((n) => n + 1), duracao(passos[ate]));
    return limpar;
  }, [auto, ate, passos, limpar]);

  useEffect(() => () => limpar(), [limpar]);

  const avancar = useCallback(() => { setAuto(false); setAte((n) => Math.min(passos.length, n + 1)); }, [passos.length]);
  const voltar  = useCallback(() => { setAuto(false); setAte((n) => Math.max(0, n - 1)); }, []);

  // Teclado: em apresentação a mão está no controle remoto ou nas setas, não
  // no mouse. Só liga em tela cheia para não sequestrar as setas da página.
  useEffect(() => {
    if (!cheia) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); avancar(); }
      if (e.key === "ArrowLeft"  || e.key === "PageUp")                    { e.preventDefault(); voltar(); }
      if (e.key === "Escape")                                              setCheia(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cheia, avancar, voltar]);

  // Trava a rolagem do fundo enquanto apresenta.
  useEffect(() => {
    if (!cheia) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = antes; };
  }, [cheia]);

  const fim = ate >= passos.length;
  const est = acumular(passos, ate);
  const g = cheia;   // tipografia maior em apresentação

  const temChat   = demo.palco.includes("chat");
  const temGrade  = demo.palco.includes("grade");
  const temPortal = demo.palco.includes("portal");
  const temAgenda = demo.palco.includes("agenda");

  const corpo = (
    <div className={g ? "space-y-6" : "space-y-4"}>
      {/* ── Controles ─────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={voltar} disabled={ate === 0}
          className="p-2 rounded-xl text-agro-muted hover:text-agro-text transition-colors disabled:opacity-30"
          style={{ border: "1px solid rgba(63,176,108,0.2)" }} title="Voltar">
          <ChevronLeft className={g ? "w-5 h-5" : "w-4 h-4"} />
        </button>

        <button onClick={avancar} disabled={fim}
          className={`btn-agro flex items-center gap-2 rounded-xl font-semibold text-white disabled:opacity-40 ${
            g ? "px-6 py-3 text-base" : "px-4 py-2 text-sm"}`}>
          Avançar <ChevronRight className={g ? "w-5 h-5" : "w-4 h-4"} />
        </button>

        <button onClick={() => setAuto((v) => !v)} disabled={fim}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-agro-text disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(63,176,108,0.2)" }}>
          {auto ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {auto ? "Pausar" : "Sozinho"}
        </button>

        <button onClick={() => { setAuto(false); setAte(0); }}
          className="p-2 rounded-xl text-agro-muted hover:text-agro-text transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.2)" }} title="Recomeçar">
          <RotateCcw className="w-4 h-4" />
        </button>

        <button onClick={() => setCheia((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-agro-text"
          style={{ background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.3)", color: "#93c5fd" }}
          title={cheia ? "Sair da apresentação (Esc)" : "Apresentar em tela cheia"}>
          {cheia ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          {cheia ? "Sair" : "Apresentar"}
        </button>

        <span className={`ml-auto text-agro-muted-2 tabular-nums ${g ? "text-sm" : "text-[11px]"}`}>
          {ate} / {passos.length}
        </span>
      </div>

      <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full transition-all duration-300"
             style={{ width: `${passos.length ? (ate / passos.length) * 100 : 0}%`,
                      background: `linear-gradient(90deg, ${demo.cor}, ${demo.cor}88)` }} />
      </div>

      {/* ── Agenda ────────────────────────────── */}
      {temAgenda && est.agenda && (
        <div className="grid grid-cols-3 gap-2.5 animate-fade-up">
          {est.agenda.dias.map((d) => (
            <div key={d.rotulo} className={`rounded-2xl ${g ? "p-5" : "p-3.5"} transition-all`}
                 style={{
                   background: d.ativo ? `${d.cor ?? "#6b8f77"}1f` : "rgba(0,0,0,0.25)",
                   border: `1px solid ${d.ativo ? `${d.cor ?? "#6b8f77"}66` : "rgba(63,176,108,0.1)"}`,
                 }}>
              <p className={`font-semibold ${g ? "text-base" : "text-xs"}`}
                 style={{ color: d.ativo ? (d.cor ?? "#e8f0ea") : "#8faf9a" }}>{d.rotulo}</p>
              {d.sub && (
                <p className={`text-agro-muted-2 mt-1 ${g ? "text-sm" : "text-[10px]"}`}>{d.sub}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Palco principal ───────────────────── */}
      <div className={`grid gap-4 ${temChat && temPortal ? "lg:grid-cols-2" : "lg:grid-cols-[1fr_290px]"}`}>

        {temGrade && (
          <div className={`rounded-2xl ${g ? "p-5" : "p-4"}`}
               style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(63,176,108,0.12)" }}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-3">
              Quem está recebendo agora
            </p>
            {est.lista.length === 0 ? (
              <p className={`text-agro-muted-2 text-center py-14 ${g ? "text-base" : "text-xs"}`}>
                Clique em <strong className="text-agro-text">Avançar</strong> para começar.
              </p>
            ) : (
              <div className="space-y-1.5">
                {est.lista.map((c) => {
                  const e = ESTADO[c.estado];
                  return (
                    <div key={c.nome} className="flex items-center gap-3 px-3 py-2 rounded-xl transition-all"
                         style={{ background: "rgba(255,255,255,0.02)" }}>
                      <div className="min-w-0 flex-1">
                        <p className={`text-agro-text truncate ${g ? "text-base" : "text-xs"}`}>{c.nome}</p>
                        {c.sub && <p className={`text-agro-muted-2 ${g ? "text-xs" : "text-[10px]"}`}>{c.sub}</p>}
                      </div>
                      <span className={`font-semibold px-2 py-1 rounded shrink-0 ${g ? "text-xs" : "text-[10px]"}`}
                            style={{ background: e.bg, color: e.cor }}>
                        {e.rotulo}
                      </span>
                    </div>
                  );
                })}
                <p className={`text-agro-muted-2 pt-1.5 ${g ? "text-sm" : "text-[10px]"}`}>
                  …e mais 2.841 pessoas
                </p>
              </div>
            )}
          </div>
        )}

        {temChat && (
          <div className={`rounded-2xl flex flex-col ${g ? "p-5 min-h-[380px]" : "p-4 min-h-[320px]"}`}
               style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(63,176,108,0.12)" }}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-3">
              WhatsApp do cliente
            </p>
            <div className={`flex-1 ${g ? "space-y-3.5" : "space-y-2.5"}`}>
              {est.chat.length === 0 && (
                <p className={`text-agro-muted-2 text-center py-14 ${g ? "text-base" : "text-xs"}`}>
                  Clique em <strong className="text-agro-text">Avançar</strong> para começar.
                </p>
              )}
              {est.chat.map((p, i) =>
                p.t === "msg"       ? <Balao key={i} p={p} grande={g} />
                : p.t === "digitando" ? <Digitando key={i} de={p.de} />
                : null)}
            </div>
          </div>
        )}

        {temPortal && (
          <div className="rounded-2xl overflow-hidden"
               style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(96,165,250,0.25)" }}>
            {/* Moldura de navegador: deixa claro que é outra tela, não o app. */}
            <div className="flex items-center gap-2 px-3 py-2"
                 style={{ background: "rgba(0,0,0,0.3)", borderBottom: "1px solid rgba(96,165,250,0.15)" }}>
              <span className="flex gap-1.5">
                {["#f87171", "#fbbf24", "#4ade80"].map((c) => (
                  <span key={c} className="w-2 h-2 rounded-full" style={{ background: c, opacity: 0.5 }} />
                ))}
              </span>
              <span className="text-[10px] text-agro-muted-2 font-mono truncate">solveai.link/n/a9f3</span>
            </div>

            <div className={g ? "p-6" : "p-5"}>
              {!est.tela ? (
                <p className={`text-agro-muted-2 text-center py-14 ${g ? "text-base" : "text-xs"}`}>
                  A página do cliente aparece aqui.
                </p>
              ) : (
                <div className="space-y-3.5 animate-fade-up">
                  <p className={`font-bold text-agro-text ${g ? "text-xl" : "text-base"}`}>{est.tela.titulo}</p>

                  {est.tela.linhas?.map((l) => (
                    <div key={l.rotulo} className="flex items-baseline justify-between gap-3 pb-2"
                         style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <span className={`text-agro-muted ${g ? "text-base" : "text-xs"}`}>{l.rotulo}</span>
                      <span className={`font-semibold tabular-nums ${
                        l.forte ? (g ? "text-2xl" : "text-lg") : (g ? "text-base" : "text-sm")}`}
                        style={{ color: l.forte ? "#3fb06c" : "#e8f0ea" }}>{l.valor}</span>
                    </div>
                  ))}

                  {est.tela.aviso && (
                    <p className={`text-agro-muted ${g ? "text-base" : "text-xs"}`}>{est.tela.aviso}</p>
                  )}

                  {est.tela.acao && (
                    <div className={`rounded-xl text-center font-semibold text-white ${g ? "py-3.5 text-base" : "py-2.5 text-sm"}`}
                         style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}>
                      {est.tela.acao}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Coluna do sistema — some quando o palco já tem duas colunas. */}
        {!(temChat && temPortal) && (
          <div className={`rounded-2xl ${g ? "p-5" : "p-4"}`}
               style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-3">
              O que o sistema fez
            </p>
            <div className="space-y-2">
              {est.lateral.length === 0 && (
                <p className={`text-agro-muted-2 ${g ? "text-sm" : "text-[11px]"}`}>Nada ainda.</p>
              )}
              {est.lateral.map((p, i) => {
                if (p.t === "metrica") {
                  return (
                    <div key={i} className="flex items-baseline justify-between gap-2 px-2.5 py-2 rounded-lg animate-fade-up"
                         style={{ background: "rgba(255,255,255,0.03)" }}>
                      <span className={`text-agro-muted-2 ${g ? "text-sm" : "text-[10px]"}`}>{p.rotulo}</span>
                      <span className="flex items-baseline gap-1.5">
                        <span className={`font-bold tabular-nums ${g ? "text-xl" : "text-sm"}`}
                              style={{ color: p.cor ?? "#e8f0ea" }}>{p.valor}</span>
                        {p.delta && (
                          <span className={`font-semibold tabular-nums ${g ? "text-sm" : "text-[10px]"}`}
                                style={{ color: p.delta.startsWith("−") ? "#f87171" : "#6b8f77" }}>
                            {p.delta}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                }
                const Icone = ICONS[p.icone] ?? Zap;
                return (
                  <div key={i} className="flex gap-2.5 px-2.5 py-2 rounded-lg animate-fade-up"
                       style={{ background: `${p.cor ?? "#6b8f77"}14` }}>
                    <Icone className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: p.cor ?? "#6b8f77" }} />
                    <div className="min-w-0">
                      <p className={`font-semibold text-agro-text leading-snug ${g ? "text-sm" : "text-[11px]"}`}>{p.texto}</p>
                      {p.detalhe && (
                        <p className={`text-agro-muted-2 mt-0.5 leading-snug ${g ? "text-xs" : "text-[10px]"}`}>{p.detalhe}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sistema em linha, quando o palco ocupou as duas colunas. */}
      {temChat && temPortal && est.lateral.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {est.lateral.slice(-3).map((p, i) => {
            if (p.t === "metrica") return null;
            const Icone = ICONS[p.icone] ?? Zap;
            return (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl animate-fade-up"
                   style={{ background: `${p.cor ?? "#6b8f77"}14` }}>
                <Icone className="w-3.5 h-3.5 shrink-0" style={{ color: p.cor ?? "#6b8f77" }} />
                <span className={`font-semibold text-agro-text ${g ? "text-sm" : "text-[11px]"}`}>{p.texto}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Fala do apresentador ──────────────── */}
      {est.nota && (
        <div className={`rounded-2xl animate-fade-up ${g ? "p-6" : "p-4"}`}
             style={{ background: `${demo.cor}0f`, border: `1px solid ${demo.cor}33` }}>
          <p className={`leading-relaxed ${g ? "text-xl" : "text-sm"}`} style={{ color: demo.cor }}>
            {est.nota}
          </p>
        </div>
      )}

      {est.pausa && (
        <p className={`text-center font-semibold ${g ? "text-lg" : "text-xs"}`} style={{ color: demo.cor }}>
          — {est.pausa} —
        </p>
      )}
    </div>
  );

  if (!cheia) return corpo;

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto" style={{ background: "#0a110e" }}>
      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="flex items-center gap-3 mb-6">
          <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${demo.cor}1f`, color: demo.cor, border: `1px solid ${demo.cor}40` }}>
            {(() => { const I = ICONS[demo.icone] ?? Play; return <I className="w-5 h-5" />; })()}
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold text-agro-text">{demo.titulo}</h1>
            <p className="text-sm text-agro-muted">{demo.resumo}</p>
          </div>
          <span className="ml-auto text-[11px] text-agro-muted-2 hidden sm:block">
            setas ← → para navegar · Esc para sair
          </span>
        </div>
        {corpo}
      </div>
    </div>
  );
}
