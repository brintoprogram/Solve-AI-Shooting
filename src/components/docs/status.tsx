// Estilo do selo de estado, compartilhado entre /primeiros-passos e /tutoriais.
//
// Vive fora das duas páginas porque as duas mostram o MESMO estado verificado —
// se o "Pronto" fosse verde num lugar e azul no outro, a pessoa leria como
// coisas diferentes.

import { Check, Clock, AlertTriangle, Circle } from "lucide-react";
import type { StepStatus } from "@/types/setup";

export const STATUS_STYLE: Record<StepStatus, { color: string; bg: string; border: string; label: string }> = {
  done:      { color: "#4ade80", bg: "rgba(74,222,128,0.1)",   border: "rgba(74,222,128,0.3)",  label: "Pronto"     },
  waiting:   { color: "#60a5fa", bg: "rgba(59,130,246,0.1)",   border: "rgba(59,130,246,0.3)",  label: "Aguardando" },
  attention: { color: "#fbbf24", bg: "rgba(245,158,11,0.1)",   border: "rgba(245,158,11,0.3)",  label: "Atenção"    },
  pending:   { color: "#7a9e83", bg: "rgba(122,158,131,0.08)", border: "rgba(122,158,131,0.2)", label: "Pendente"   },
};

export function StatusIcon({ status }: { status: StepStatus }) {
  if (status === "done")      return <Check className="w-4 h-4" />;
  if (status === "waiting")   return <Clock className="w-4 h-4" />;
  if (status === "attention") return <AlertTriangle className="w-4 h-4" />;
  return <Circle className="w-4 h-4" />;
}
