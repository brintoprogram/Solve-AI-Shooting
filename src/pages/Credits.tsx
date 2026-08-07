// Créditos — saldo e extrato DO PRÓPRIO WORKSPACE.
//
// Esta tela não conhece a existência de outros workspaces: não busca, não
// recebe, não renderiza. A administração da plataforma vive em /admin/creditos.
//
// A separação lógica já era garantida pela RLS e pelo secret, e está provada
// em 20260807220000_teste_isolamento_creditos.sql. A separação FÍSICA remove a
// classe inteira de risco: numa tela compartilhada, num bug de renderização,
// numa refatoração futura, não há o que vazar porque o dado nem é buscado.

import { useCallback, useEffect, useState } from "react";
import {
  Coins, Plus, Loader2, TrendingDown, Bot, MessageSquare,
  Mail, AlertTriangle, Settings2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useCredits } from "@/hooks/useCredits";
import { Topbar } from "@/components/layout/Topbar";
import { formatDate } from "@/lib/format";
import { log } from "@/lib/logger";

interface Lancamento {
  id:         string;
  delta:      number;
  saldo_apos: number;
  tipo:       string;
  canal:      string | null;
  detalhe:    Record<string, unknown>;
  created_at: string;
}

const TIPO_INFO: Record<string, { rotulo: string; Icone: typeof Coins; cor: string }> = {
  mensagem: { rotulo: "Mensagem", Icone: MessageSquare, cor: "#60a5fa" },
  ia:       { rotulo: "IA",       Icone: Bot,           cor: "#c084fc" },
  recarga:  { rotulo: "Recarga",  Icone: Plus,          cor: "#3fb06c" },
  ajuste:   { rotulo: "Ajuste",   Icone: Settings2,     cor: "#fbbf24" },
};

export function Credits() {
  const { workspaceId } = useAuth();
  const credito = useCredits();

  const [extrato,    setExtrato]    = useState<Lancamento[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregarExtrato = useCallback(async () => {
    if (!workspaceId) return;
    // A RLS restringe ao workspace de quem pergunta; o filtro explícito é
    // defesa em profundidade, não a proteção principal.
    const { data, error } = await supabase
      .from("credit_ledger")
      .select("id, delta, saldo_apos, tipo, canal, detalhe, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) log.error("extrato_falhou", { err: error.message });
    setExtrato((data ?? []) as unknown as Lancamento[]);
    setCarregando(false);
  }, [workspaceId]);

  useEffect(() => { carregarExtrato(); }, [carregarExtrato]);

  const semSaldo = credito.cobranca_ativa && credito.saldo <= 0;

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Créditos" }]} />

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        <div className="animate-fade-up">
          <h1 className="font-display text-2xl font-bold text-agro-text">Créditos</h1>
          <p className="text-agro-muted mt-1 text-sm">Saldo e consumo deste workspace</p>
        </div>

        {/* ── Saldo ─────────────────────────────────── */}
        <div
          className="rounded-2xl p-6 animate-fade-up-delay-1"
          style={{
            background: semSaldo
              ? "linear-gradient(135deg, rgba(239,68,68,0.10) 0%, rgba(13,26,17,0.7) 60%)"
              : "linear-gradient(135deg, rgba(63,176,108,0.10) 0%, rgba(13,26,17,0.7) 60%)",
            border: `1px solid ${semSaldo ? "rgba(239,68,68,0.3)" : "rgba(63,176,108,0.2)"}`,
          }}
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2">
                Saldo disponível
              </p>
              <p className="text-4xl font-bold tabular-nums mt-1"
                 style={{ color: semSaldo ? "#f87171" : "#3fb06c" }}>
                {credito.carregando ? "—" : credito.saldo.toLocaleString("pt-BR")}
              </p>

              {!credito.cobranca_ativa && (
                <p className="text-xs text-blue-400 mt-2">
                  Cobrança desativada neste workspace — nada é debitado.
                </p>
              )}
            </div>

            <div className="text-right text-xs text-agro-muted space-y-1">
              <p>Mensagem: <span className="text-agro-text font-semibold tabular-nums">{credito.custo_mensagem}</span></p>
              <p>Resposta de IA: <span className="text-agro-text font-semibold tabular-nums">{credito.custo_ia}</span></p>
              <p className="text-agro-muted-2 max-w-[240px] leading-relaxed pt-1">
                Falar com o mesmo contato de novo em até 24h não custa crédito novo.
              </p>
            </div>
          </div>

          {semSaldo && (
            <div className="flex items-start gap-2.5 mt-4 pt-4 text-xs"
                 style={{ borderTop: "1px solid rgba(239,68,68,0.2)" }}>
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-red-300/90">
                Sem saldo, <strong>nada é enviado</strong>: campanhas pausam, a IA para de responder
                e o envio manual falha. Fale com o suporte para recarregar.
              </p>
            </div>
          )}
        </div>

        {/* ── Extrato ───────────────────────────────── */}
        <div
          className="rounded-2xl overflow-hidden animate-fade-up-delay-2"
          style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <div className="flex items-center gap-2 px-5 py-3"
               style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
            <TrendingDown className="w-3.5 h-3.5 text-agro-green" />
            <span className="text-xs font-semibold text-agro-text">Últimos lançamentos</span>
          </div>

          {carregando ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 text-agro-green animate-spin" />
            </div>
          ) : extrato.length === 0 ? (
            <p className="text-xs text-agro-muted-2 text-center py-10">
              Nenhum consumo ainda.
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: "#1a2a1e" }}>
              {extrato.map((l) => {
                const info = TIPO_INFO[l.tipo] ?? { rotulo: l.tipo, Icone: Coins, cor: "#6b7f6e" };
                const { Icone } = info;
                const origem = typeof l.detalhe?.origem === "string" ? l.detalhe.origem
                             : typeof l.detalhe?.etapa === "string"  ? l.detalhe.etapa
                             : null;
                return (
                  <div key={l.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                         style={{ background: `${info.cor}1f` }}>
                      <Icone className="w-3.5 h-3.5" style={{ color: info.cor }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-agro-text">
                        {info.rotulo}
                        {l.canal === "email" && <Mail className="w-3 h-3 inline ml-1.5 text-agro-muted-2" />}
                      </p>
                      {origem && <p className="text-[10px] text-agro-muted-2 truncate">{origem}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold tabular-nums"
                         style={{ color: l.delta < 0 ? "#f87171" : "#3fb06c" }}>
                        {l.delta > 0 ? "+" : ""}{l.delta}
                      </p>
                      <p className="text-[10px] text-agro-muted-2 tabular-nums">
                        saldo {l.saldo_apos.toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <p className="text-[10px] text-agro-muted-2 w-20 text-right shrink-0 tabular-nums">
                      {formatDate(l.created_at.slice(0, 10))}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
