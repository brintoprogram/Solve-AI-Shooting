import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Zap, Clock, Users, ChevronRight, Pause, Play, Trash2, RefreshCw } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { useAutomationRules } from "@/hooks/useAutomationRules";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AutomationRule } from "@/types/automations";

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  draft:     { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "rgba(107,114,128,0.2)",  label: "Rascunho"  },
  active:    { bg: "rgba(63,176,108,0.1)",   color: "#3fb06c", border: "rgba(63,176,108,0.2)",   label: "Ativo"     },
  paused:    { bg: "rgba(245,158,11,0.1)",   color: "#fbbf24", border: "rgba(245,158,11,0.2)",   label: "Pausado"   },
  completed: { bg: "rgba(63,176,108,0.06)",  color: "#6b8a75", border: "rgba(63,176,108,0.1)",   label: "Concluído" },
};

function padHour(h: number) { return `${String(h).padStart(2, "0")}:00`; }

export function Automations() {
  const navigate       = useNavigate();
  const { toast }      = useToast();
  const { workspaceId } = useAuth();
  const wsId           = workspaceId ?? "";

  const { rules, loading, refetch, updateStatus, deleteRule } = useAutomationRules(wsId);
  const [acting, setActing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function handleToggle(rule: AutomationRule) {
    const next = rule.status === "active" ? "paused" : "active";
    setActing(rule.id);
    const err = await updateStatus(rule.id, next);
    if (err) toast({ title: "Erro ao atualizar status", description: err, variant: "destructive" });
    else toast({ title: next === "active" ? "Régua ativada!" : "Régua pausada", variant: "success" });
    setActing(null);
  }

  async function handleDelete(id: string) {
    setActing(id);
    const err = await deleteRule(id);
    if (err) toast({ title: "Erro ao excluir", description: err, variant: "destructive" });
    setActing(null);
    setConfirm(null);
  }

  const active    = rules.filter((r) => r.status === "active");
  const drafts    = rules.filter((r) => r.status === "draft");
  const paused    = rules.filter((r) => r.status === "paused");
  const completed = rules.filter((r) => r.status === "completed");

  function RuleCard({ rule }: { rule: AutomationRule }) {
    const statusStyle = STATUS_STYLE[rule.status] ?? STATUS_STYLE.draft;
    const canToggle   = rule.status === "active" || rule.status === "paused";
    const isActing    = acting === rule.id;

    const progress = rule.total_recipients > 0
      ? Math.round((rule.sent_count / rule.total_recipients) * 100)
      : 0;

    return (
      <div
        className="rounded-2xl p-5 hover:border-agro-green/25 transition-all cursor-pointer group"
        style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.12)" }}
        onClick={() => navigate(`/automations/${rule.id}`)}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.15)" }}>
              <Zap className="w-4 h-4 text-agro-green" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-agro-text text-sm truncate group-hover:text-agro-green transition-colors">
                {rule.name}
              </p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: statusStyle.bg, color: statusStyle.color, border: `1px solid ${statusStyle.border}` }}>
                  {statusStyle.label}
                </span>
                <span className="text-[10px] text-agro-muted-2">{rule.channel === "z_api" ? "Z-API" : "Meta"}</span>
                <span className="text-[10px] text-agro-muted flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" /> {padHour(rule.send_hour)}
                </span>
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-agro-muted-2 group-hover:text-agro-green transition-colors shrink-0 mt-1" />
        </div>

        <div className="flex items-center gap-3 mb-3">
          <span className="text-[10px] text-agro-muted flex items-center gap-1">
            <Users className="w-3 h-3" /> {rule.total_recipients} destinatários
          </span>
          <span className="text-[10px] text-agro-muted">
            {rule.sent_count} enviados
          </span>
        </div>

        {rule.total_recipients > 0 && (
          <div className="mb-3">
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(63,176,108,0.1)" }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progress}%`, background: "linear-gradient(90deg, #3fb06c, #16A34A)" }}
              />
            </div>
            <p className="text-[10px] text-agro-muted mt-1">{progress}% concluído</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2" style={{ borderTop: "1px solid rgba(63,176,108,0.07)" }}
          onClick={(e) => e.stopPropagation()}>
          {canToggle && (
            <button
              disabled={isActing}
              onClick={() => handleToggle(rule)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 hover:bg-white/5"
              style={{ color: rule.status === "active" ? "#fbbf24" : "#3fb06c", border: "1px solid rgba(63,176,108,0.15)" }}>
              {rule.status === "active" ? <><Pause className="w-3 h-3" /> Pausar</> : <><Play className="w-3 h-3" /> Ativar</>}
            </button>
          )}
          <button
            disabled={isActing}
            onClick={() => setConfirm(rule.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-agro-muted-2 hover:text-red-400 transition-colors disabled:opacity-50"
            style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
            <Trash2 className="w-3 h-3" /> Excluir
          </button>
        </div>
      </div>
    );
  }

  function Section({ title, items }: { title: string; items: AutomationRule[] }) {
    if (items.length === 0) return null;
    return (
      <div>
        <p className="text-[11px] font-bold text-agro-muted-2 uppercase tracking-widest mb-3">{title}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((r) => <RuleCard key={r.id} rule={r} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Automações" }]} />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-agro-text">Réguas de Cobrança</h1>
            <p className="text-sm text-agro-muted mt-1">Disparos automáticos baseados no vencimento de boletos</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refetch}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate("/automations/new")}
              className="btn-agro flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white">
              <Plus className="w-4 h-4" /> Nova régua
            </button>
          </div>
        </div>

        {/* Summary strip */}
        {rules.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total",     value: rules.length,    color: "#9ca3af" },
              { label: "Ativas",    value: active.length,   color: "#3fb06c" },
              { label: "Pausadas",  value: paused.length,   color: "#fbbf24" },
              { label: "Rascunho",  value: drafts.length,   color: "#6b7280" },
            ].map(({ label, value, color }) => (
              <div key={label} className="p-4 rounded-xl text-center"
                style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}>
                <p className="text-2xl font-bold" style={{ color }}>{value}</p>
                <p className="text-[11px] text-agro-muted-2 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-agro-green/30 border-t-agro-green rounded-full animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && rules.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-5">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.15)" }}>
              <Zap className="w-7 h-7 text-agro-green" />
            </div>
            <div className="text-center">
              <p className="text-agro-text font-semibold">Nenhuma régua criada</p>
              <p className="text-sm text-agro-muted mt-1 max-w-sm">
                Crie sua primeira régua de cobrança para automatizar o envio de mensagens nos dias certos.
              </p>
            </div>
            <button onClick={() => navigate("/automations/new")}
              className="btn-agro flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white">
              <Plus className="w-4 h-4" /> Criar primeira régua
            </button>
          </div>
        )}

        {/* Rule sections */}
        {!loading && (
          <div className="space-y-8">
            <Section title="Ativas" items={active} />
            <Section title="Pausadas" items={paused} />
            <Section title="Rascunhos" items={drafts} />
            <Section title="Concluídas" items={completed} />
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={() => setConfirm(null)}>
          <div className="rounded-2xl p-6 max-w-sm w-full space-y-4"
            style={{ background: "rgba(13,26,17,0.95)", border: "1px solid rgba(239,68,68,0.3)" }}
            onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-agro-text">Excluir régua?</p>
            <p className="text-sm text-agro-muted">Esta ação não pode ser desfeita. Todos os gatilhos, destinatários e logs serão removidos.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirm(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-agro-muted-2 hover:text-agro-text transition-colors"
                style={{ border: "1px solid rgba(63,176,108,0.2)" }}>
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirm)}
                disabled={acting === confirm}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500/80 hover:bg-red-500 transition-colors disabled:opacity-50">
                {acting === confirm ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
