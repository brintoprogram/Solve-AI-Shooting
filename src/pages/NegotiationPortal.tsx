import { useState } from "react";
import { Leaf, ShieldCheck, Loader2, AlertCircle, CheckCircle2, Handshake } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { DebtNegotiation, NegotiationOffer } from "@/types/negotiations";
import { formatBRL } from "@/lib/format";
import { edgeErrorMessage } from "@/lib/db";

const dateFmt  = (v: string | null) => v ? new Date(v + "T00:00:00").toLocaleDateString("pt-BR") : "—";

const CARD_STYLE: React.CSSProperties = {
  background:     "rgba(13,26,17,0.9)",
  border:         "1px solid rgba(63,176,108,0.15)",
  boxShadow:      "0 20px 60px rgba(0,0,0,0.5)",
  backdropFilter: "blur(20px)",
};

type Step = "verify" | "summary" | "error";

interface SummaryData {
  negotiation: DebtNegotiation;
  offers: NegotiationOffer[];
  invoice: { numero_nf: string | null; vencimento: string | null } | null;
}

export function NegotiationPortal({ token }: { token: string }) {
  const [step, setStep]       = useState<Step>("verify");
  const [cpf, setCpf]         = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [data, setData]       = useState<SummaryData | null>(null);

  async function call(action: string, extra: Record<string, unknown> = {}) {
    const { data: res, error: fnErr } = await supabase.functions.invoke("negotiation-portal", {
      body: { action, token, cpf_last_digits: cpf, ...extra },
    });
    // Em erro HTTP o corpo vem em fnErr.context, não em `res` — sem isso a tela
    // mostrava "Edge Function returned a non-2xx status code" para o cliente.
    if (fnErr) throw new Error(await edgeErrorMessage(fnErr, "Link inválido ou expirado. Confira o link enviado no WhatsApp."));
    if (res?.error) throw new Error(res.error as string);
    return res;
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (cpf.replace(/\D/g, "").length < 3) return;
    setLoading(true);
    setError(null);
    try {
      const res = await call("verify");
      setData(res as SummaryData);
      setStep("summary");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível verificar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#0a110e" }}>
      <div className="w-full max-w-md rounded-2xl p-8 space-y-6" style={CARD_STYLE}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3fb06c 0%, #16A34A 100%)" }}>
            <Leaf className="w-7 h-7 text-white" />
          </div>
          <p className="text-xl font-bold text-agro-text font-display">Solve AI</p>
        </div>

        {step === "verify" && (
          <VerifyForm cpf={cpf} setCpf={setCpf} loading={loading} error={error} onSubmit={handleVerify} />
        )}

        {step === "summary" && data && (
          <Summary data={data} cpf={cpf} token={token} />
        )}
      </div>
    </div>
  );
}

function VerifyForm({ cpf, setCpf, loading, error, onSubmit }: {
  cpf: string; setCpf: (v: string) => void; loading: boolean; error: string | null; onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="text-center space-y-2">
        <div className="flex justify-center">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}>
            <ShieldCheck className="w-5 h-5 text-agro-green" />
          </div>
        </div>
        <h1 className="text-lg font-semibold text-agro-text">Confirme sua identidade</h1>
        <p className="text-sm text-agro-muted">
          Para ver os detalhes da sua negociação, informe os 4 últimos dígitos do seu CPF ou CNPJ.
        </p>
      </div>

      <input
        type="text"
        inputMode="numeric"
        maxLength={4}
        value={cpf}
        onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 4))}
        placeholder="0000"
        autoFocus
        className="w-full text-center text-2xl tracking-[0.5em] font-bold py-3 rounded-xl bg-black/30 text-agro-text outline-none"
        style={{ border: "1px solid rgba(63,176,108,0.25)" }}
      />

      {error && (
        <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading || cpf.length < 3}
        className="btn-agro w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
        {loading ? "Verificando…" : "Continuar"}
      </button>
    </form>
  );
}

function Summary({ data, cpf, token }: {
  data: SummaryData; cpf: string; token: string;
}) {
  const { negotiation, offers, invoice } = data;
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState<"accepted" | "countered" | null>(null);
  const [showCounter, setShowCounter] = useState(false);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterInstallments, setCounterInstallments] = useState("1");

  const pendingOffer = offers.find((o) => o.status === "pending" && (o.proposed_by === "ai" || o.proposed_by === "staff"));
  const isClosed = ["formalized", "expired", "cancelled"].includes(negotiation.status);

  async function call(action: string, extra: Record<string, unknown> = {}) {
    const { data: res, error: fnErr } = await supabase.functions.invoke("negotiation-portal", {
      body: { action, token, cpf_last_digits: cpf, ...extra },
    });
    // Em erro HTTP o corpo vem em fnErr.context, não em `res` — sem isso a tela
    // mostrava "Edge Function returned a non-2xx status code" para o cliente.
    if (fnErr) throw new Error(await edgeErrorMessage(fnErr, "Link inválido ou expirado. Confira o link enviado no WhatsApp."));
    if (res?.error) throw new Error(res.error as string);
    return res;
  }

  async function handleAccept() {
    if (!pendingOffer) return;
    setBusy(true);
    setError(null);
    try {
      await call("accept", { offer_id: pendingOffer.id });
      setDone("accepted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível confirmar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCounter(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(counterAmount.replace(",", "."));
    const installments = Number(counterInstallments);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(installments) || installments < 1) return;
    setBusy(true);
    setError(null);
    try {
      await call("counter", { amount, installments });
      setDone("countered");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar sua proposta. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  if (done === "accepted") {
    return (
      <StatusMessage
        icon={<CheckCircle2 className="w-6 h-6 text-agro-green" />}
        title="Acordo confirmado!"
        text="Combinamos os novos termos. Nossa equipe vai gerar a cobrança atualizada e falar com você pelo WhatsApp em breve."
      />
    );
  }
  if (done === "countered") {
    return (
      <StatusMessage
        icon={<Handshake className="w-6 h-6 text-agro-green" />}
        title="Proposta enviada!"
        text="Recebemos sua contraproposta. Você vai receber a resposta pelo WhatsApp em instantes."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center space-y-1">
        <p className="text-xs uppercase tracking-wider text-agro-muted-2">
          {invoice?.numero_nf ? `Fatura ${invoice.numero_nf}` : "Sua negociação"}
        </p>
        <p className="text-2xl font-bold text-agro-text">{formatBRL(negotiation.original_amount)}</p>
        <p className="text-xs text-agro-muted">valor original {invoice?.vencimento ? `· venceu em ${dateFmt(invoice.vencimento)}` : ""}</p>
      </div>

      {isClosed ? (
        <StatusMessage
          icon={<CheckCircle2 className="w-6 h-6 text-agro-green" />}
          title={negotiation.status === "formalized" ? "Negociação já formalizada" : "Negociação encerrada"}
          text={
            negotiation.status === "formalized" && negotiation.agreed_amount
              ? `Acordo: ${formatBRL(negotiation.agreed_amount)} em ${negotiation.agreed_installments}x.`
              : "Fale com a empresa pelo WhatsApp para mais detalhes."
          }
        />
      ) : pendingOffer ? (
        <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.25)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-agro-green">Proposta atual</p>
          <p className="text-xl font-bold text-agro-text">{formatBRL(pendingOffer.offer_amount)}</p>
          <p className="text-sm text-agro-muted">
            em {pendingOffer.installments}x de {formatBRL(pendingOffer.installment_amount)}
            {pendingOffer.discount_pct > 0 && ` · ${pendingOffer.discount_pct.toFixed(0)}% de desconto`}
          </p>
          {pendingOffer.first_due_date && <p className="text-xs text-agro-muted-2">1ª parcela: {dateFmt(pendingOffer.first_due_date)}</p>}
        </div>
      ) : (
        <div className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-sm text-agro-muted">Ainda não há uma proposta enviada. Você pode sugerir uma condição abaixo.</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {!isClosed && !showCounter && (
        <div className="flex flex-col gap-2">
          {pendingOffer && (
            <button
              onClick={handleAccept}
              disabled={busy}
              className="btn-agro w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Aceitar esta proposta
            </button>
          )}
          <button
            onClick={() => setShowCounter(true)}
            disabled={busy}
            className="w-full py-3 rounded-xl text-sm font-semibold text-agro-text disabled:opacity-60"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(63,176,108,0.2)" }}
          >
            Sugerir outra condição
          </button>
        </div>
      )}

      {!isClosed && showCounter && (
        <form onSubmit={handleCounter} className="space-y-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-agro-muted-2 mb-1 block">Valor total que você propõe</label>
            <input
              type="text" inputMode="decimal" value={counterAmount}
              onChange={(e) => setCounterAmount(e.target.value)}
              placeholder="Ex: 850,00"
              className="w-full py-2.5 px-3 rounded-xl bg-black/30 text-agro-text outline-none text-sm"
              style={{ border: "1px solid rgba(63,176,108,0.25)" }}
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-agro-muted-2 mb-1 block">Em quantas parcelas</label>
            <input
              type="number" min={1} max={24} value={counterInstallments}
              onChange={(e) => setCounterInstallments(e.target.value)}
              className="w-full py-2.5 px-3 rounded-xl bg-black/30 text-agro-text outline-none text-sm"
              style={{ border: "1px solid rgba(63,176,108,0.25)" }}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowCounter(false)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-agro-muted"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-agro flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enviar proposta"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function StatusMessage({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="text-center space-y-3 py-4">
      <div className="flex justify-center">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.25)" }}>
          {icon}
        </div>
      </div>
      <h1 className="text-lg font-semibold text-agro-text">{title}</h1>
      <p className="text-sm text-agro-muted leading-relaxed">{text}</p>
    </div>
  );
}
