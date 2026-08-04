import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Handshake, UserCheck2, Clock, CheckCircle2, Settings } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth, hasPermission } from "@/context/AuthContext";
import { useNegotiations } from "@/hooks/useNegotiations";
import type { DebtNegotiation, NegotiationStatus } from "@/types/negotiations";
import { formatBRL } from "@/lib/format";


const STATUS_CONFIG: Record<NegotiationStatus, { label: string; color: string; bg: string; border: string }> = {
  triggered:          { label: "Iniciada",           color: "#7a9e83", bg: "rgba(122,158,131,0.1)", border: "rgba(122,158,131,0.25)" },
  ai_negotiating:     { label: "IA negociando",      color: "#3fb06c", bg: "rgba(63,176,108,0.1)",  border: "rgba(63,176,108,0.25)" },
  awaiting_customer:  { label: "Aguardando cliente", color: "#60a5fa", bg: "rgba(59,130,246,0.1)",  border: "rgba(59,130,246,0.25)" },
  escalated:          { label: "Escalada",           color: "#fbbf24", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.25)" },
  human_negotiating:  { label: "Com atendente",      color: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.25)" },
  formalized:         { label: "Formalizada",        color: "#4ade80", bg: "rgba(74,222,128,0.1)",  border: "rgba(74,222,128,0.25)" },
  expired:            { label: "Expirada",           color: "#6b7280", bg: "rgba(107,114,128,0.1)", border: "rgba(107,114,128,0.25)" },
  cancelled:          { label: "Cancelada",          color: "#6b7280", bg: "rgba(107,114,128,0.1)", border: "rgba(107,114,128,0.25)" },
};

type FilterKey = "active" | "escalated" | "formalized" | "all";
const FILTERS: { key: FilterKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "active",     label: "Ativas",       icon: Handshake },
  { key: "escalated",  label: "Escaladas",    icon: UserCheck2 },
  { key: "formalized", label: "Formalizadas", icon: CheckCircle2 },
  { key: "all",        label: "Todas",        icon: Clock },
];

function matchesFilter(n: DebtNegotiation, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "escalated") return n.status === "escalated" || n.status === "human_negotiating";
  if (filter === "formalized") return n.status === "formalized";
  return ["triggered", "ai_negotiating", "awaiting_customer"].includes(n.status);
}

export function Negotiations() {
  const { workspaceId, profile } = useAuth();
  const navigate = useNavigate();
  const { negotiations, loading } = useNegotiations(workspaceId ?? undefined);
  const [filter, setFilter] = useState<FilterKey>("active");

  const filtered = useMemo(() => negotiations.filter((n) => matchesFilter(n, filter)), [negotiations, filter]);

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Negociações" }]} />
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-agro-text">Negociações de dívida</h1>
            <p className="text-sm text-agro-muted mt-1">Propostas em andamento via IA e conversas escaladas para atendimento humano.</p>
          </div>
          {hasPermission(profile, "can_settings") && (
            <button
              onClick={() => navigate("/negotiations/rules")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-agro-text shrink-0"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(63,176,108,0.2)" }}
            >
              <Settings className="w-3.5 h-3.5" /> Regras
            </button>
          )}
        </div>

        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
              style={
                filter === f.key
                  ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.35)" }
                  : { background: "rgba(255,255,255,0.03)", color: "#7a9e83", border: "1px solid rgba(255,255,255,0.06)" }
              }
            >
              <f.icon className="w-3.5 h-3.5" />
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-agro-muted-2 text-center py-12">Carregando…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-agro-muted-2 text-center py-12">Nenhuma negociação nesta categoria.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((n) => {
              const cfg = STATUS_CONFIG[n.status];
              const contact = n.inbox_contacts;
              return (
                <button
                  key={n.id}
                  onClick={() => navigate(`/negotiations/${n.id}`)}
                  className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-left transition-all hover:brightness-110"
                  style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}
                >
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}>
                    {(contact?.name ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-agro-text truncate">{contact?.name ?? contact?.phone ?? "Contato"}</p>
                    <p className="text-xs text-agro-muted-2 truncate">
                      {n.contact_invoices?.numero_nf ? `Fatura ${n.contact_invoices.numero_nf} · ` : ""}
                      {formatBRL(n.original_amount)} · rodada {n.offer_round}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[10px] font-semibold px-2 py-1 rounded"
                      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                      {cfg.label}
                    </span>
                    <span className="text-[10px] text-agro-muted-2">
                      {formatDistanceToNow(new Date(n.updated_at), { addSuffix: true, locale: ptBR })}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
