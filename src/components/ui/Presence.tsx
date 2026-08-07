// Presence — segura um filho no DOM enquanto ele anima a saída.
//
// O problema que isto resolve:
//
// Os modais do app são montados assim pelo pai:
//
//     {showEdit && <ContactFormModal ... />}
//
// Quando `showEdit` vira false o nó some no mesmo frame. Não existe instante
// em que o navegador possa animar a saída — por isso os modais fechavam de
// estalo, mesmo depois de o próprio modal ganhar transições.
//
// A saída óbvia seria manter o modal sempre montado e só escondê-lo. Mas isso
// quebra algo mais importante que a animação: esses formulários inicializam o
// estado a partir das props uma única vez —
//
//     const [name, setName] = useState(contact?.name ?? "");
//
// Um componente que nunca desmonta nunca reexecuta esse `useState`. Abrir o
// modal para o contato B depois de ter aberto o contato A mostraria os dados
// de A num formulário que salva no banco. Trocar um defeito visual por um
// defeito de dados seria um péssimo negócio.
//
// Presence dá os dois: mantém o filho montado apenas durante a saída
// (EXIT_MS) e desmonta de verdade em seguida. Toda abertura é uma montagem
// nova, com o estado lido das props corretas.

import { useEffect, useState, type ReactNode } from "react";

/** Precisa acompanhar a duração da saída em Modal.tsx. */
const EXIT_MS = 160;

interface PresenceProps {
  /** Condição que antes ficava à esquerda do `&&`. */
  when: boolean;
  /** Recebe `visible`: repasse para a prop `open` do Modal. */
  children: (visible: boolean) => ReactNode;
  /** Sobrescreva se a saída daquele componente durar outra coisa. */
  exitMs?: number;
}

export function Presence({ when, children, exitMs = EXIT_MS }: PresenceProps) {
  // `montado` acompanha `when`, mas atrasa o desligamento.
  const [montado, setMontado] = useState(when);

  useEffect(() => {
    if (when) { setMontado(true); return; }
    if (!montado) return;
    const t = setTimeout(() => setMontado(false), exitMs);
    return () => clearTimeout(t);
  }, [when, montado, exitMs]);

  if (!montado) return null;
  // `when` (não `montado`) é o que o filho recebe: durante a saída ele já
  // vale false, que é o gatilho da animação de fechamento.
  return <>{children(when)}</>;
}
