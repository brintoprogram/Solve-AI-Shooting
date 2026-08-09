// Player das demonstrações.
//
// Um componente toca qualquer roteiro de src/types/demos.ts. É o que troca
// "878 linhas de JSX por assunto" por "um roteiro de dados por assunto".
//
// Decisão que define a ergonomia: o padrão é MANUAL, não autoplay. Numa reunião
// você fala enquanto avança, e uma animação correndo sozinha te obriga a
// acompanhar o vídeo em vez de o cliente acompanhar você. Autoplay existe, mas
// como opção.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play, Pause, RotateCcw, ChevronRight, ChevronLeft, Zap,
  GitBranch, Clock, Handshake, ExternalLink, Cake, Send, Bot, ShieldCheck,
  Ban, UserCog, Lock, FileText, Check, Calendar, Users, Coins,
  MessageSquare, Bell, DoorOpen, DoorClosed,
} from "lucide-react";
import type { Demo, Passo } from "@/types/demos";

// Aceita style porque a cor do icone vem do roteiro; os icones do lucide
// repassam qualquer prop de SVG.
const ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  GitBranch, Clock, Handshake, ExternalLink, Cake, Send, Bot, ShieldCheck,
  Ban, UserCog, Lock, FileText, Check, Calendar, Users, Coins,
  MessageSquare, Bell, DoorOpen, DoorClosed, Zap,
};

/** Quanto cada tipo de passo espera antes do próximo, no modo automático. */
function duracao(p: Passo): number {
  switch (p.t) {
    case "digitando": return p.ms ?? 1100;
    case "msg":       return 1500;
    case "nota":      return 2600;
    case "pausa":     return 1800;
    default:          return 1200;
  }
}

function Balao({ p }: { p: Extract<Passo, { t: "msg" }> }) {
  const meu = p.de === "empresa";
  return (
    <div className={`flex ${meu ? "justify-end" : "justify-start"} animate-fade-up`}>
      <div className="max-w-[82%] rounded-2xl px-3.5 py-2.5"
           style={meu
             ? { background: "linear-gradient(135deg, rgba(63,176,108,0.22), rgba(22,163,74,0.12))",
                 border: "1px solid rgba(63,176,108,0.3)", borderBottomRightRadius: 6 }
             : { background: "rgba(255,255,255,0.05)",
                 border: "1px solid rgba(255,255,255,0.08)", borderBottomLeftRadius: 6 }}>
        <p className="text-[13px] leading-relaxed text-agro-text whitespace-pre-wrap">{p.texto}</p>
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
  const [ate,  setAte]  = useState(0);        // quantos passos já rodaram
  const [auto, setAuto] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limpar = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  // Recomeça do zero ao trocar de demo — senão a próxima abre no meio.
  useEffect(() => { limpar(); setAte(0); setAuto(false); }, [demo.id, limpar]);

  useEffect(() => {
    if (!auto || ate >= passos.length) { limpar(); return; }
    timer.current = setTimeout(() => setAte((n) => n + 1), duracao(passos[ate]));
    return limpar;
  }, [auto, ate, passos, limpar]);

  useEffect(() => () => limpar(), [limpar]);

  const fim = ate >= passos.length;
  const visiveis = passos.slice(0, ate);

  // "digitando" é transitório: só aparece se for o último passo mostrado.
  const chat = visiveis.filter((p, i) =>
    p.t === "msg" || (p.t === "digitando" && i === visiveis.length - 1));
  const lateral = visiveis.filter((p) => p.t === "sistema" || p.t === "metrica");
  const notaAtual = [...visiveis].reverse().find((p) => p.t === "nota") as
    Extract<Passo, { t: "nota" }> | undefined;
  const pausaAtual = visiveis.length > 0 && visiveis[visiveis.length - 1].t === "pausa"
    ? (visiveis[visiveis.length - 1] as Extract<Passo, { t: "pausa" }>) : undefined;

  return (
    <div className="space-y-4">
      {/* ── Controles ─────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => { setAuto(false); setAte((n) => Math.max(0, n - 1)); }}
          disabled={ate === 0}
          className="p-2 rounded-xl text-agro-muted hover:text-agro-text transition-colors disabled:opacity-30"
          style={{ border: "1px solid rgba(63,176,108,0.2)" }}
          title="Passo anterior"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          onClick={() => { setAuto(false); setAte((n) => Math.min(passos.length, n + 1)); }}
          disabled={fim}
          className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
        >
          Avançar <ChevronRight className="w-4 h-4" />
        </button>

        <button
          onClick={() => setAuto((v) => !v)}
          disabled={fim}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-agro-text disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(63,176,108,0.2)" }}
        >
          {auto ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {auto ? "Pausar" : "Automático"}
        </button>

        <button
          onClick={() => { setAuto(false); setAte(0); }}
          className="p-2 rounded-xl text-agro-muted hover:text-agro-text transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.2)" }}
          title="Recomeçar"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <span className="ml-auto text-[11px] text-agro-muted-2 tabular-nums">
          {ate} / {passos.length}
        </span>
      </div>

      <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full transition-all duration-300"
             style={{ width: `${passos.length ? (ate / passos.length) * 100 : 0}%`,
                      background: `linear-gradient(90deg, ${demo.cor}, ${demo.cor}88)` }} />
      </div>

      {/* ── Palco ─────────────────────────────── */}
      <div className="grid lg:grid-cols-[1fr_280px] gap-4">

        {/* Conversa */}
        <div className="rounded-2xl p-4 min-h-[340px] flex flex-col"
             style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(63,176,108,0.12)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-3">
            WhatsApp do cliente
          </p>
          <div className="space-y-2.5 flex-1">
            {chat.length === 0 && (
              <p className="text-xs text-agro-muted-2 text-center py-16">
                Clique em <strong className="text-agro-text">Avançar</strong> para começar.
              </p>
            )}
            {/* Ternario encadeado por tipo: o `else` generico nao estreita o
                tipo, e `p.de` so existe em msg e digitando. */}
            {chat.map((p, i) =>
              p.t === "msg"       ? <Balao key={i} p={p} />
              : p.t === "digitando" ? <Digitando key={i} de={p.de} />
              : null)}
          </div>
        </div>

        {/* O que o sistema fez */}
        <div className="rounded-2xl p-4"
             style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-3">
            Por baixo
          </p>
          <div className="space-y-2">
            {lateral.length === 0 && (
              <p className="text-[11px] text-agro-muted-2">Nada ainda.</p>
            )}
            {lateral.map((p, i) => {
              if (p.t === "metrica") {
                return (
                  <div key={i} className="flex items-baseline justify-between gap-2 px-2.5 py-2 rounded-lg animate-fade-up"
                       style={{ background: "rgba(255,255,255,0.03)" }}>
                    <span className="text-[10px] text-agro-muted-2">{p.rotulo}</span>
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-sm font-bold tabular-nums" style={{ color: p.cor ?? "#e8f0ea" }}>{p.valor}</span>
                      {p.delta && (
                        <span className="text-[10px] font-semibold tabular-nums"
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
                    <p className="text-[11px] font-semibold text-agro-text leading-snug">{p.texto}</p>
                    {p.detalhe && <p className="text-[10px] text-agro-muted-2 mt-0.5 leading-snug">{p.detalhe}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Nota do apresentador ──────────────── */}
      {notaAtual && (
        <div className="rounded-2xl p-4 animate-fade-up"
             style={{ background: `${demo.cor}0f`, border: `1px solid ${demo.cor}33` }}>
          <p className="text-sm leading-relaxed" style={{ color: demo.cor }}>{notaAtual.texto}</p>
        </div>
      )}

      {pausaAtual && (
        <p className="text-center text-xs font-semibold" style={{ color: demo.cor }}>
          — {pausaAtual.rotulo} —
        </p>
      )}
    </div>
  );
}
