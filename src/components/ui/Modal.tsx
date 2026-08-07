// Modal — primitivo de sobreposição do app.
//
// Os modais do produto eram escritos à mão, cada um repetindo a mesma <div
// fixed inset-0>. Nenhum deles animava: apareciam e sumiam de estalo, porque
// `{open && <Modal/>}` desmonta o nó no mesmo frame em que `open` vira false —
// não existe momento em que o navegador possa interpolar a saída.
//
// A correção é manter o nó montado durante a saída. `phase` guia isso:
//
//   closed  → nada no DOM
//   enter   → montado, ainda no estado inicial (opacidade 0, escala 0.96)
//   open    → estado final; a transição CSS anima a diferença
//   exit    → volta ao estado inicial e só então desmonta
//
// O passo enter→open acontece dentro de um requestAnimationFrame duplo. Um só
// não basta: o React pode aplicar o estilo inicial e o final na mesma pintura,
// e o navegador não anima o que nunca chegou a pintar como "antes".
//
// Nada aqui usa biblioteca de animação — só transições CSS, que rodam no
// compositor e não competem com o JavaScript da página.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/** Deve bater com a duração das transições abaixo, senão o nó some antes da hora. */
const EXIT_MS = 160;

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

const SIZES: Record<ModalSize, string> = {
  sm:   "max-w-sm",
  md:   "max-w-md",
  lg:   "max-w-2xl",
  xl:   "max-w-4xl",
  full: "max-w-6xl",
};

interface ModalProps {
  open:      boolean;
  onClose:   () => void;
  children:  ReactNode;
  /** Cabeçalho pronto: título, subtítulo e botão de fechar. Omita para montar o seu. */
  title?:    string;
  subtitle?: string;
  icon?:     ReactNode;
  size?:     ModalSize;
  /** Some com o X do cabeçalho quando o fluxo exige uma escolha explícita. */
  hideClose?: boolean;
  /** Trava Esc e clique no fundo — use durante uma operação que não pode ser interrompida. */
  dismissable?: boolean;
  /** z-index, para os casos de modal sobre modal. */
  zIndex?:   number;
  className?: string;
  /** Sobrescreve fundo/borda do painel. Alguns modais do app usam paleta
   *  própria (#0d1710) — isto permite migrá-los sem mudar a aparência. */
  panelStyle?: React.CSSProperties;
  /** Sobrescreve o fundo do overlay (opacidade e blur variam por tela). */
  overlayStyle?: React.CSSProperties;
}

export function Modal({
  open, onClose, children,
  title, subtitle, icon,
  size = "md",
  hideClose = false,
  dismissable = true,
  zIndex = 50,
  className = "",
  panelStyle,
  overlayStyle,
}: ModalProps) {
  const [phase, setPhase] = useState<"closed" | "enter" | "open" | "exit">("closed");
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Ciclo de vida da animação ──────────────────────────────────
  useEffect(() => {
    if (open) {
      setPhase((p) => (p === "closed" || p === "exit" ? "enter" : p));
      return;
    }
    // Fechando: só desmonta depois que a transição de saída termina.
    setPhase((p) => {
      if (p === "closed") return p;
      return "exit";
    });
    const t = setTimeout(() => setPhase("closed"), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  // enter → open no frame seguinte à primeira pintura (ver comentário do topo).
  useEffect(() => {
    if (phase !== "enter") return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPhase("open"));
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [phase]);

  // ── Esc fecha ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismissable, onClose]);

  // ── Trava a rolagem do fundo ───────────────────────────────────
  // Sem isso a página de trás rola junto quando o modal é alto.
  useEffect(() => {
    if (phase === "closed") return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = anterior; };
  }, [phase]);

  // ── Foco ───────────────────────────────────────────────────────
  // Ao abrir, leva o foco para dentro: quem navega por teclado continuava
  // na página de trás, tabulando por elementos escondidos atrás do overlay.
  useEffect(() => {
    if (phase !== "open") return;
    const alvo = panelRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])',
    );
    alvo?.focus();
  }, [phase]);

  if (phase === "closed") return null;

  const visivel = phase === "open";

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex,
        background:      "rgba(0,0,0,0.7)",
        backdropFilter:  "blur(4px)",
        opacity:         visivel ? 1 : 0,
        transition:      `opacity ${EXIT_MS}ms ease-out`,
        ...overlayStyle,
      }}
      onMouseDown={(e) => {
        // mousedown e não click: se o usuário começou a selecionar texto dentro
        // do painel e soltou o botão fora, um onClick fecharia o modal no meio
        // da seleção.
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        className={`w-full ${SIZES[size]} rounded-2xl overflow-hidden ${className}`}
        style={{
          background: "#0d1a11",
          border:     "1px solid rgba(63,176,108,0.2)",
          boxShadow:  "0 24px 64px rgba(0,0,0,0.6)",
          opacity:    visivel ? 1 : 0,
          transform:  visivel ? "scale(1) translateY(0)" : "scale(0.96) translateY(8px)",
          // Sai mais rápido do que entra: fechar é uma ação já decidida, e
          // esperar pela saída é o que faz uma interface parecer lenta.
          transition: visivel
            ? "opacity 200ms ease-out, transform 200ms cubic-bezier(0.16, 1, 0.3, 1)"
            : `opacity ${EXIT_MS}ms ease-in, transform ${EXIT_MS}ms ease-in`,
          ...panelStyle,
        }}
      >
        {title && (
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {icon && (
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}
                >
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-agro-text truncate">{title}</p>
                {subtitle && <p className="text-xs text-agro-muted truncate">{subtitle}</p>}
              </div>
            </div>
            {!hideClose && (
              <button
                onClick={onClose}
                aria-label="Fechar"
                className="p-1.5 rounded-lg text-agro-muted hover:text-agro-text transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
