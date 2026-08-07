// Créditos — saldo, extrato e (para o dono da plataforma) recarga.
//
// A tela tem duas caras porque tem dois públicos:
//   · o cliente vê o próprio saldo e onde ele foi gasto
//   · você vê todos os workspaces e pode recarregar
//
// A separação NÃO é feita aqui. Quem decide é a edge function, contra um
// secret. Esconder o botão no frontend seria só cosmético — qualquer pessoa
// com o DevTools aberto chamaria a função mesmo assim.

import { useCallback, useEffect, useState } from "react";
import {
  Coins, Plus, Loader2, TrendingDown, Bot, MessageSquare,
  Mail, RefreshCw, AlertTriangle, Settings2, ShieldCheck, ChevronDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCredits } from "@/hooks/useCredits";
import { Topbar } from "@/components/layout/Topbar";
import { Modal } from "@/components/ui/Modal";
import { Presence } from "@/components/ui/Presence";
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

interface RegistroTrilha {
  id:             string;
  workspace_nome: string;
  acao:           string;
  ator_email:     string;
  antes:          Record<string, unknown> | null;
  depois:         Record<string, unknown> | null;
  detalhe:        Record<string, unknown>;
  created_at:     string;
}

const ACAO_INFO: Record<string, { rotulo: string; cor: string }> = {
  recarga:         { rotulo: "Recarga",              cor: "#3fb06c" },
  ajuste_custo:    { rotulo: "Custo alterado",       cor: "#fbbf24" },
  ajuste_cobranca: { rotulo: "Cobrança alterada",    cor: "#fb923c" },
  acesso_negado:   { rotulo: "Acesso negado",        cor: "#f87171" },
};

interface WorkspaceSaldo {
  id:             string;
  nome:           string;
  saldo:          number;
  custo_mensagem: number;
  custo_ia:       number;
  cobranca_ativa: boolean;
}

const TIPO_INFO: Record<string, { rotulo: string; Icone: typeof Coins; cor: string }> = {
  mensagem: { rotulo: "Mensagem", Icone: MessageSquare, cor: "#60a5fa" },
  ia:       { rotulo: "IA",       Icone: Bot,           cor: "#c084fc" },
  recarga:  { rotulo: "Recarga",  Icone: Plus,          cor: "#3fb06c" },
  ajuste:   { rotulo: "Ajuste",   Icone: Settings2,     cor: "#fbbf24" },
};

export function Credits() {
  const { workspaceId } = useAuth();
  const { toast } = useToast();
  const credito = useCredits();

  const [extrato,   setExtrato]   = useState<Lancamento[]>([]);
  const [carregando, setCarregando] = useState(true);

  // Administração: só preenche se a function autorizar. Não perguntamos ao
  // frontend quem é o usuário — perguntamos ao servidor o que ele pode ver.
  const [ehDono,     setEhDono]     = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSaldo[]>([]);
  const [alvo,       setAlvo]       = useState<WorkspaceSaldo | null>(null);
  const [quantidade, setQuantidade] = useState("");
  const [salvando,   setSalvando]   = useState(false);

  // Configuração
  const [config,     setConfig]     = useState<WorkspaceSaldo | null>(null);
  const [formCusto,  setFormCusto]  = useState({ mensagem: "", ia: "", ativa: true });

  // Trilha de auditoria
  const [trilha,     setTrilha]     = useState<RegistroTrilha[]>([]);
  const [verTrilha,  setVerTrilha]  = useState(false);

  const chamarAdmin = useCallback(async (acao: string, extra: Record<string, unknown> = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Sessão expirada.");
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/credits-admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ acao, ...extra }),
    });
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(corpo?.error ?? "Falha na administração de créditos.");
      (e as Error & { status?: number }).status = res.status;
      throw e;
    }
    return corpo;
  }, []);

  // ── Extrato do workspace ───────────────────────────────────────
  const carregarExtrato = useCallback(async () => {
    if (!workspaceId) return;
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

  // ── Descobre se é dono da plataforma ───────────────────────────
  const carregarAdmin = useCallback(async () => {
    try {
      const r = await chamarAdmin("listar") as { workspaces: WorkspaceSaldo[] };
      setWorkspaces(r.workspaces ?? []);
      setEhDono(true);
    } catch (e) {
      // 403 é resposta esperada para quem não é dono — não é erro a reportar.
      const st = (e as Error & { status?: number }).status;
      if (st !== 403 && st !== 503) {
        log.error("admin_creditos_falhou", { err: e instanceof Error ? e.message : String(e) });
      }
      setEhDono(false);
    }
  }, [chamarAdmin]);

  useEffect(() => { carregarAdmin(); }, [carregarAdmin]);

  async function recarregar() {
    const n = parseInt(quantidade, 10);
    if (!alvo || !Number.isInteger(n) || n === 0) {
      toast({ title: "Informe uma quantidade inteira diferente de zero", variant: "destructive" });
      return;
    }
    setSalvando(true);
    try {
      await chamarAdmin("recarregar", { workspace_id: alvo.id, quantidade: n });
      toast({ title: `${n > 0 ? "Creditado" : "Debitado"} ${Math.abs(n)} em ${alvo.nome}` });
      setAlvo(null);
      setQuantidade("");
      await Promise.all([carregarAdmin(), credito.recarregar(), carregarExtrato()]);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Falha ao recarregar", variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  }

  async function salvarConfig() {
    if (!config) return;
    setSalvando(true);
    try {
      await chamarAdmin("ajustar", {
        workspace_id:   config.id,
        custo_mensagem: formCusto.mensagem === "" ? undefined : Number(formCusto.mensagem),
        custo_ia:       formCusto.ia       === "" ? undefined : Number(formCusto.ia),
        cobranca_ativa: formCusto.ativa,
      });
      toast({ title: `Configuração de ${config.nome} salva` });
      setConfig(null);
      await Promise.all([carregarAdmin(), credito.recarregar(), carregarTrilha()]);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Falha ao salvar", variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  }

  const carregarTrilha = useCallback(async () => {
    try {
      const r = await chamarAdmin("trilha") as { registros: RegistroTrilha[] };
      setTrilha(r.registros ?? []);
    } catch { /* quem nao e dono nao ve trilha; nao e erro */ }
  }, [chamarAdmin]);

  useEffect(() => { if (ehDono) carregarTrilha(); }, [ehDono, carregarTrilha]);

  const semSaldo = credito.cobranca_ativa && credito.saldo <= 0;

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Créditos" }]} />

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        <div className="animate-fade-up">
          <h1 className="font-display text-2xl font-bold text-agro-text">Créditos</h1>
          <p className="text-agro-muted mt-1 text-sm">Saldo, consumo e recarga</p>
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
                e o envio manual falha. Recarregue para voltar a operar.
              </p>
            </div>
          )}
        </div>

        {/* ── Administração (só dono da plataforma) ─── */}
        {ehDono && (
          <div
            className="rounded-2xl overflow-hidden animate-fade-up-delay-2"
            style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <div className="flex items-center justify-between px-5 py-3"
                 style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
              <span className="text-xs font-semibold text-agro-text">Todos os workspaces</span>
              <button
                onClick={carregarAdmin}
                className="p-1.5 rounded-lg text-agro-muted hover:text-agro-text transition-colors"
                aria-label="Atualizar"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2">Workspace</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2">Saldo</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2">Msg</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2">IA</th>
                    <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2">Cobrança</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {workspaces.map((w) => (
                    <tr key={w.id} className="contatos-linha" style={{ borderBottom: "1px solid #1a2a1e" }}>
                      <td className="px-5 py-3 text-agro-text">{w.nome}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold"
                          style={{ color: w.saldo > 0 ? "#3fb06c" : "#f87171" }}>
                        {w.saldo.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-agro-muted">{w.custo_mensagem}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-agro-muted">{w.custo_ia}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-[10px] px-2 py-0.5 rounded-md"
                              style={w.cobranca_ativa
                                ? { background: "rgba(63,176,108,0.12)", color: "#3fb06c" }
                                : { background: "rgba(107,127,110,0.12)", color: "#6b7f6e" }}>
                          {w.cobranca_ativa ? "ativa" : "desligada"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => {
                              setConfig(w);
                              setFormCusto({
                                mensagem: String(w.custo_mensagem),
                                ia:       String(w.custo_ia),
                                ativa:    w.cobranca_ativa,
                              });
                            }}
                            className="text-xs font-medium text-agro-muted hover:text-agro-text transition-colors"
                          >
                            Configurar
                          </button>
                          <button
                            onClick={() => { setAlvo(w); setQuantidade(""); }}
                            className="text-xs font-medium text-agro-green hover:brightness-125 transition-all"
                          >
                            Recarregar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Trilha de auditoria (so dono) */}
        {ehDono && (
          <div
            className="rounded-2xl overflow-hidden animate-fade-up-delay-2"
            style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <button
              onClick={() => setVerTrilha((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3 transition-colors hover:bg-[#111a14]"
              style={{ borderBottom: verTrilha ? "1px solid rgba(63,176,108,0.1)" : undefined }}
            >
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-agro-green" />
                <span className="text-xs font-semibold text-agro-text">Trilha de auditoria</span>
                <span className="text-[10px] text-agro-muted-2">
                  {trilha.length} registro{trilha.length === 1 ? "" : "s"}
                </span>
              </span>
              <ChevronDown
                className="w-4 h-4 text-agro-muted transition-transform"
                style={{ transform: verTrilha ? "rotate(180deg)" : undefined }}
              />
            </button>

            {verTrilha && (
              <div className="max-h-96 overflow-y-auto scrollbar-thin divide-y" style={{ borderColor: "#1a2a1e" }}>
                {trilha.length === 0 ? (
                  <p className="text-xs text-agro-muted-2 text-center py-8">
                    Nenhuma acao administrativa registrada.
                  </p>
                ) : trilha.map((r) => {
                  const info = ACAO_INFO[r.acao] ?? { rotulo: r.acao, cor: "#6b7f6e" };
                  /* Mostra so o que MUDOU: despejar os dois objetos inteiros
                     esconde a alteracao no meio do que ficou igual. */
                  const mudancas = r.antes && r.depois
                    ? Object.keys(r.depois).filter((k) => String(r.antes![k]) !== String(r.depois![k]))
                    : [];
                  return (
                    <div key={r.id} className="px-5 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold"
                              style={{ background: `${info.cor}1f`, color: info.cor }}>
                          {info.rotulo}
                        </span>
                        <span className="text-xs text-agro-text">{r.workspace_nome}</span>
                        <span className="text-[10px] text-agro-muted-2 ml-auto tabular-nums">
                          {new Date(r.created_at).toLocaleString("pt-BR")}
                        </span>
                      </div>

                      <p className="text-[11px] text-agro-muted mt-1">
                        por <span className="text-agro-text">{r.ator_email}</span>
                      </p>

                      {r.acao === "recarga" && (
                        <p className="text-[11px] text-agro-muted mt-1 tabular-nums">
                          {String(r.detalhe?.quantidade ?? "")} credito(s) &middot;
                          saldo {String(r.antes?.saldo ?? "?")} &rarr; <span className="text-agro-text">{String(r.depois?.saldo ?? "?")}</span>
                        </p>
                      )}

                      {mudancas.length > 0 && r.acao !== "recarga" && (
                        <div className="mt-1 space-y-0.5">
                          {mudancas.map((k) => (
                            <p key={k} className="text-[11px] text-agro-muted tabular-nums">
                              {k}: {String(r.antes![k])} &rarr; <span className="text-agro-text">{String(r.depois![k])}</span>
                            </p>
                          ))}
                        </div>
                      )}

                      {r.acao === "acesso_negado" && (
                        <p className="text-[11px] text-red-400/80 mt-1">
                          Tentou: {String(r.detalhe?.acao_tentada ?? "-")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Extrato ───────────────────────────────── */}
        <div
          className="rounded-2xl overflow-hidden animate-fade-up-delay-3"
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

      {/* Modal de configuracao */}
      <Presence when={config !== null}>
        {(visivel) => (
          <Modal
            open={visivel}
            onClose={() => setConfig(null)}
            title={`Configurar ${config?.nome ?? ""}`}
            subtitle="Custos e cobranca deste workspace"
            icon={<Settings2 className="w-4 h-4 text-agro-green" />}
            size="sm"
          >
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 block mb-1.5">
                    Custo por mensagem
                  </label>
                  <input
                    type="number" min="0"
                    value={formCusto.mensagem}
                    onChange={(e) => setFormCusto((f) => ({ ...f, mensagem: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl text-sm text-agro-text bg-[#0d1710] outline-none focus:border-agro-green transition-colors tabular-nums"
                    style={{ border: "1px solid #2a3d30" }}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 block mb-1.5">
                    Custo por IA
                  </label>
                  <input
                    type="number" min="0"
                    value={formCusto.ia}
                    onChange={(e) => setFormCusto((f) => ({ ...f, ia: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl text-sm text-agro-text bg-[#0d1710] outline-none focus:border-agro-green transition-colors tabular-nums"
                    style={{ border: "1px solid #2a3d30" }}
                  />
                </div>
              </div>

              <button
                onClick={() => setFormCusto((f) => ({ ...f, ativa: !f.ativa }))}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors hover:bg-[#1e2e22]"
                style={{ border: "1px solid #2a3d30" }}
                role="switch"
                aria-checked={formCusto.ativa}
              >
                <span className="text-left">
                  <span className="text-xs text-agro-text block">Cobranca ativa</span>
                  <span className="text-[10px] text-agro-muted-2">
                    {formCusto.ativa
                      ? "Envios e IA debitam do saldo"
                      : "Nada e debitado - use no demo e no seu proprio"}
                  </span>
                </span>
                <span
                  className="w-9 h-5 rounded-full shrink-0 relative transition-colors"
                  style={{ background: formCusto.ativa ? "#3fb06c" : "#2a3d30" }}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                    style={{ left: formCusto.ativa ? 18 : 2 }}
                  />
                </span>
              </button>

              <p className="text-[10px] text-agro-muted-2">
                Toda alteracao fica na trilha de auditoria, com o valor anterior, o novo e quem mudou.
              </p>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfig(null)}
                  className="px-4 py-2 rounded-xl text-sm text-agro-muted hover:text-agro-text transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={salvarConfig}
                  disabled={salvando}
                  className="btn-agro px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-40"
                >
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings2 className="w-4 h-4" />}
                  Salvar
                </button>
              </div>
            </div>
          </Modal>
        )}
      </Presence>

      {/* ── Modal de recarga ────────────────────────── */}
      <Presence when={alvo !== null}>
        {(visivel) => (
          <Modal
            open={visivel}
            onClose={() => setAlvo(null)}
            title={`Recarregar ${alvo?.nome ?? ""}`}
            subtitle={`Saldo atual: ${(alvo?.saldo ?? 0).toLocaleString("pt-BR")}`}
            icon={<Coins className="w-4 h-4 text-agro-green" />}
            size="sm"
          >
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 block mb-1.5">
                  Quantidade
                </label>
                <input
                  type="number"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") recarregar(); }}
                  placeholder="10000"
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-agro-text bg-[#0d1710] outline-none focus:border-agro-green transition-colors tabular-nums"
                  style={{ border: "1px solid #2a3d30" }}
                />
                <p className="text-[10px] text-agro-muted-2 mt-1.5">
                  Use número negativo para estornar. Todo lançamento fica no extrato com seu nome.
                </p>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setAlvo(null)}
                  className="px-4 py-2 rounded-xl text-sm text-agro-muted hover:text-agro-text transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={recarregar}
                  disabled={salvando}
                  className="btn-agro px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-40"
                >
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Lançar
                </button>
              </div>
            </div>
          </Modal>
        )}
      </Presence>
    </div>
  );
}
