import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { UserCheck2, MessageSquare, Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useNegotiations, useNegotiationOffers } from "@/hooks/useNegotiations";
import { supabase } from "@/lib/supabase";
import type { NegotiationStatus } from "@/types/negotiations";
import { formatBRL } from "@/lib/format";


const dateFmt  = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR") : "—";

const STATUS_LABELS: Record<NegotiationStatus, string> = {
  triggered:         "Iniciada",
  ai_negotiating:    "IA negociando",
  awaiting_customer: "Aguardando cliente",
  escalated:         "Escalada para atendimento",
  human_negotiating: "Com atendente",
  formalized:        "Formalizada",
  expired:           "Expirada",
  cancelled:         "Cancelada",
};

const PROPOSED_BY_LABELS: Record<string, string> = { ai: "IA", customer: "Cliente", staff: "Atendente", system: "Sistema" };

export function NegotiationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile, workspaceId } = useAuth();
  const { toast } = useToast();
  const { negotiations, claim } = useNegotiations(workspaceId ?? undefined);
  const negotiation = negotiations.find((n) => n.id === id);
  const { offers } = useNegotiationOffers(id ?? null);

  const [claiming, setClaiming] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualAmount, setManualAmount] = useState("");
  const [manualInstallments, setManualInstallments] = useState("1");
  const [manualDueDate, setManualDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  if (!negotiation) {
    return (
      <div className="min-h-screen" style={{ background: "#0a110e" }}>
        <Topbar breadcrumbs={[{ label: "Negociações", href: "/negotiations" }, { label: "Negociação" }]} />
        <p className="text-sm text-agro-muted-2 text-center py-16">Carregando ou negociação não encontrada…</p>
      </div>
    );
  }

  const contact       = negotiation.inbox_contacts;
  const invoice       = negotiation.contact_invoices;
  const canAssumeHere = negotiation.status === "escalated";
  const isMineToClose = negotiation.status === "human_negotiating";

  async function handleClaim() {
    if (!profile) return;
    setClaiming(true);
    const ok = await claim(negotiation!.id, negotiation!.conversation_id, profile.id);
    setClaiming(false);
    if (!ok) {
      toast({
        title: "Não foi possível assumir a negociação",
        description: "Tente novamente. Se persistir, verifique suas permissões neste workspace.",
        variant: "destructive",
      });
    }
  }

  async function handleManualFormalize(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(manualAmount.replace(",", "."));
    const installments = Number(manualInstallments);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(installments) || installments < 1 || !profile) return;

    setSaving(true);
    const round = negotiation!.offer_round + 1;
    await supabase.from("negotiation_offers").insert({
      negotiation_id: negotiation!.id, workspace_id: negotiation!.workspace_id, round,
      proposed_by: "staff", proposed_by_user_id: profile.id,
      offer_amount: amount, discount_pct: negotiation!.original_amount > 0 ? ((negotiation!.original_amount - amount) / negotiation!.original_amount) * 100 : 0,
      installments, installment_amount: amount / installments,
      first_due_date: manualDueDate || null, status: "accepted",
    });
    await supabase.from("debt_negotiations").update({
      status: "formalized", offer_round: round, agreed_amount: amount,
      agreed_installments: installments, agreed_first_due_date: manualDueDate || null,
      agreed_at: new Date().toISOString(),
    }).eq("id", negotiation!.id);
    setSaving(false);
    setShowManual(false);
  }

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Negociações", href: "/negotiations" }, { label: contact?.name ?? "Negociação" }]} />
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <button onClick={() => navigate("/negotiations")} className="flex items-center gap-1.5 text-xs text-agro-muted-2 hover:text-agro-text">
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar
        </button>

        <div className="rounded-2xl p-5 space-y-4" style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.12)" }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-agro-text">{contact?.name ?? contact?.phone}</p>
              <p className="text-xs text-agro-muted-2">{contact?.phone}</p>
            </div>
            <button
              onClick={() => navigate(`/inbox?conversation=${negotiation.conversation_id}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-agro-text shrink-0"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(63,176,108,0.2)" }}
            >
              <MessageSquare className="w-3.5 h-3.5" /> Ver conversa
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-agro-muted-2">Fatura</p>
              <p className="text-agro-text">{invoice?.numero_nf ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-agro-muted-2">Vencimento original</p>
              <p className="text-agro-text">{invoice?.vencimento ? new Date(invoice.vencimento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-agro-muted-2">Valor original</p>
              <p className="text-agro-text font-semibold">{formatBRL(negotiation.original_amount)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-agro-muted-2">Status</p>
              <p className="text-agro-text">{STATUS_LABELS[negotiation.status]}</p>
            </div>
          </div>

          {negotiation.escalation_reason && (
            <div className="text-xs p-3 rounded-lg" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#fbbf24" }}>
              Motivo da escalada: {negotiation.escalation_reason}
            </div>
          )}

          {negotiation.status === "formalized" && negotiation.agreed_amount && (
            <div className="text-sm p-3 rounded-lg flex items-center gap-2" style={{ background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)", color: "#4ade80" }}>
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Acordo: {formatBRL(negotiation.agreed_amount)} em {negotiation.agreed_installments}x
              {negotiation.agreed_first_due_date ? ` · 1ª parcela ${new Date(negotiation.agreed_first_due_date + "T00:00:00").toLocaleDateString("pt-BR")}` : ""}
            </div>
          )}

          {canAssumeHere && (
            <button
              onClick={handleClaim}
              disabled={claiming}
              className="btn-agro w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            >
              {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck2 className="w-4 h-4" />}
              Assumir esta negociação
            </button>
          )}

          {isMineToClose && !showManual && (
            <button
              onClick={() => setShowManual(true)}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-agro-text"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(63,176,108,0.2)" }}
            >
              Registrar acordo fechado manualmente
            </button>
          )}

          {isMineToClose && showManual && (
            <form onSubmit={handleManualFormalize} className="space-y-3 pt-2" style={{ borderTop: "1px solid rgba(63,176,108,0.1)" }}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-agro-muted-2 mb-1 block">Valor acordado</label>
                  <input value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder="850,00"
                    className="w-full py-2 px-3 rounded-lg bg-black/30 text-agro-text text-sm outline-none" style={{ border: "1px solid rgba(63,176,108,0.25)" }} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-agro-muted-2 mb-1 block">Parcelas</label>
                  <input type="number" min={1} max={24} value={manualInstallments} onChange={(e) => setManualInstallments(e.target.value)}
                    className="w-full py-2 px-3 rounded-lg bg-black/30 text-agro-text text-sm outline-none" style={{ border: "1px solid rgba(63,176,108,0.25)" }} />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-agro-muted-2 mb-1 block">1ª parcela (opcional)</label>
                <input type="date" value={manualDueDate} onChange={(e) => setManualDueDate(e.target.value)}
                  className="w-full py-2 px-3 rounded-lg bg-black/30 text-agro-text text-sm outline-none" style={{ border: "1px solid rgba(63,176,108,0.25)" }} />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowManual(false)} className="flex-1 py-2 rounded-lg text-xs font-semibold text-agro-muted" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>Cancelar</button>
                <button type="submit" disabled={saving} className="btn-agro flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-60">
                  {saving ? "Salvando…" : "Confirmar acordo"}
                </button>
              </div>
            </form>
          )}
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-agro-muted-2 mb-3">Histórico de ofertas</p>
          {offers.length === 0 ? (
            <p className="text-sm text-agro-muted-2">Nenhuma oferta registrada ainda.</p>
          ) : (
            <div className="space-y-2">
              {offers.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.08)" }}>
                  <div>
                    <p className="text-sm text-agro-text">
                      Rodada {o.round} · <span className="text-agro-green font-semibold">{PROPOSED_BY_LABELS[o.proposed_by] ?? o.proposed_by}</span>
                    </p>
                    <p className="text-xs text-agro-muted-2">{dateFmt(o.created_at)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-agro-text">{formatBRL(o.offer_amount)} em {o.installments}x</p>
                    <p className="text-[10px] text-agro-muted-2">{o.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
