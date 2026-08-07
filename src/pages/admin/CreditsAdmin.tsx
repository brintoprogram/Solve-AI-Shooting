// Administração de créditos da PLATAFORMA — separada da tela do cliente.
//
// Vive em /admin/creditos e não aparece no menu de ninguém. A tela de
// Créditos que o cliente vê nem sabe que outros workspaces existem: não
// busca, não recebe, não renderiza.
//
// Isso é redundante com a segurança que já existe (secret + RLS, provado em
// 20260807220000_teste_isolamento_creditos.sql). A redundância é o ponto: uma
// separação que depende de um `if` no render some junto com o `if`, numa
// refatoração distraída. Separação física não.
//
// Quem decide o acesso continua sendo o SERVIDOR. Se a function recusar, esta
// tela não tem dado nenhum para mostrar — não é o React que esconde.

import { useCallback, useEffect, useState } from "react";
import {
  Coins, Plus, Loader2, RefreshCw, Settings2, ShieldCheck,
  ChevronDown, ShieldAlert,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Topbar } from "@/components/layout/Topbar";
import { Modal } from "@/components/ui/Modal";
import { Presence } from "@/components/ui/Presence";
import { log } from "@/lib/logger";

interface WorkspaceSaldo {
  id:             string;
  nome:           string;
  saldo:          number;
  custo_mensagem: number;
  custo_ia:       number;
  cobranca_ativa: boolean;
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
  recarga:         { rotulo: "Recarga",           cor: "#3fb06c" },
  ajuste_custo:    { rotulo: "Custo alterado",    cor: "#fbbf24" },
  ajuste_cobranca: { rotulo: "Cobrança alterada", cor: "#fb923c" },
  acesso_negado:   { rotulo: "Acesso negado",     cor: "#f87171" },
};

export function CreditsAdmin() {
  const { toast } = useToast();

  const [autorizado, setAutorizado] = useState<boolean | null>(null);  // null = verificando
  const [workspaces, setWorkspaces] = useState<WorkspaceSaldo[]>([]);
  const [trilha,     setTrilha]     = useState<RegistroTrilha[]>([]);
  const [verTrilha,  setVerTrilha]  = useState(false);
  const [salvando,   setSalvando]   = useState(false);

  const [alvo,       setAlvo]       = useState<WorkspaceSaldo | null>(null);
  const [quantidade, setQuantidade] = useState("");
  const [config,     setConfig]     = useState<WorkspaceSaldo | null>(null);
  const [formCusto,  setFormCusto]  = useState({ mensagem: "", ia: "", ativa: true });

  const chamar = useCallback(async (acao: string, extra: Record<string, unknown> = {}) => {
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

  const carregar = useCallback(async () => {
    try {
      const r = await chamar("listar") as { workspaces: WorkspaceSaldo[] };
      setWorkspaces(r.workspaces ?? []);
      setAutorizado(true);
      const t = await chamar("trilha") as { registros: RegistroTrilha[] };
      setTrilha(t.registros ?? []);
    } catch (e) {
      const st = (e as Error & { status?: number }).status;
      if (st !== 403 && st !== 503) {
        log.error("admin_creditos_falhou", { err: e instanceof Error ? e.message : String(e) });
      }
      setAutorizado(false);
    }
  }, [chamar]);

  useEffect(() => { carregar(); }, [carregar]);

  async function recarregar() {
    const n = parseInt(quantidade, 10);
    if (!alvo || !Number.isInteger(n) || n === 0) {
      toast({ title: "Informe uma quantidade inteira diferente de zero", variant: "destructive" });
      return;
    }
    setSalvando(true);
    try {
      await chamar("recarregar", { workspace_id: alvo.id, quantidade: n });
      toast({ title: `${n > 0 ? "Creditado" : "Debitado"} ${Math.abs(n)} em ${alvo.nome}` });
      setAlvo(null);
      setQuantidade("");
      await carregar();
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
      await chamar("ajustar", {
        workspace_id:   config.id,
        custo_mensagem: formCusto.mensagem === "" ? undefined : Number(formCusto.mensagem),
        custo_ia:       formCusto.ia       === "" ? undefined : Number(formCusto.ia),
        cobranca_ativa: formCusto.ativa,
      });
      toast({ title: `Configuração de ${config.nome} salva` });
      setConfig(null);
      await carregar();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Falha ao salvar", variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  }

  // ── Verificando / negado ─────────────────────────────────────────
  if (autorizado === null) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a110e" }}>
        <Loader2 className="w-6 h-6 text-agro-green animate-spin" />
      </div>
    );
  }

  if (!autorizado) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#0a110e" }}>
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
               style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <ShieldAlert className="w-6 h-6 text-red-400" />
          </div>
          <p className="text-agro-text font-semibold">Área restrita</p>
          <p className="text-sm text-agro-muted mt-2">
            A administração de créditos é da plataforma. Sua tentativa ficou registrada.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Administração" }, { label: "Créditos" }]} />

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        <div className="flex items-start justify-between gap-4 animate-fade-up">
          <div>
            <h1 className="font-display text-2xl font-bold text-agro-text">Créditos da plataforma</h1>
            <p className="text-agro-muted mt-1 text-sm">Saldo, custos e recarga de cada workspace</p>
          </div>
          <button
            onClick={carregar}
            className="p-2 rounded-xl text-agro-muted hover:text-agro-text transition-colors"
            style={{ border: "1px solid rgba(63,176,108,0.15)" }}
            aria-label="Atualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* ── Workspaces ────────────────────────────── */}
        <div
          className="rounded-2xl overflow-hidden animate-fade-up-delay-1"
          style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}
        >
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

        {/* ── Trilha ────────────────────────────────── */}
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
                  Nenhuma ação administrativa registrada.
                </p>
              ) : trilha.map((r) => {
                const info = ACAO_INFO[r.acao] ?? { rotulo: r.acao, cor: "#6b7f6e" };
                // Mostra só o que MUDOU: despejar os dois objetos inteiros
                // esconde a alteração no meio do que ficou igual.
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
                        {String(r.detalhe?.quantidade ?? "")} crédito(s) · saldo{" "}
                        {String(r.antes?.saldo ?? "?")} → <span className="text-agro-text">{String(r.depois?.saldo ?? "?")}</span>
                      </p>
                    )}

                    {mudancas.length > 0 && r.acao !== "recarga" && (
                      <div className="mt-1 space-y-0.5">
                        {mudancas.map((k) => (
                          <p key={k} className="text-[11px] text-agro-muted tabular-nums">
                            {k}: {String(r.antes![k])} → <span className="text-agro-text">{String(r.depois![k])}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    {r.acao === "acesso_negado" && (
                      <p className="text-[11px] text-red-400/80 mt-1">
                        Tentou: {String(r.detalhe?.acao_tentada ?? "—")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal de configuração ───────────────────── */}
      <Presence when={config !== null}>
        {(visivel) => (
          <Modal
            open={visivel}
            onClose={() => setConfig(null)}
            title={`Configurar ${config?.nome ?? ""}`}
            subtitle="Custos e cobrança deste workspace"
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
                  <span className="text-xs text-agro-text block">Cobrança ativa</span>
                  <span className="text-[10px] text-agro-muted-2">
                    {formCusto.ativa
                      ? "Envios e IA debitam do saldo"
                      : "Nada é debitado — use no demo e no seu próprio"}
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
                Toda alteração fica na trilha, com o valor anterior, o novo e quem mudou.
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
                  Use número negativo para estornar. Todo lançamento fica na trilha com seu nome.
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
