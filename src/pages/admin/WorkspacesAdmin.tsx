// Administração de WORKSPACES da plataforma — console do dono.
//
// Vive em /admin/workspaces e não aparece no menu de ninguém, mesma decisão do
// /admin/creditos. Criar workspace é abrir cliente novo: se o admin da empresa
// cliente pudesse, ele abriria tenants fora da sua cobrança.
//
// Quem decide o acesso é o SERVIDOR, conferindo o e-mail contra o secret
// PLATFORM_ADMIN_EMAILS. Se a function recusar, esta tela não tem dado nenhum
// para mostrar — não é o React que esconde. Por isso o estado começa em
// "verificando" e não em "autorizado".

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2, Plus, Loader2, RefreshCw, ShieldAlert, Search, Pencil,
  Users, Contact, GitBranch, Bot, Smartphone, Mail, Coins, Zap,
  AlertTriangle, Check, X, Hash, Calendar, Plug,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Topbar } from "@/components/layout/Topbar";
import { Modal } from "@/components/ui/Modal";
import { Presence } from "@/components/ui/Presence";
import { formatDate } from "@/lib/format";
import { log } from "@/lib/logger";

interface Panorama {
  id:             string;
  codigo:         string;
  name:           string;
  created_at:     string;
  api_enabled:    boolean;
  support_email:  string | null;
  membros:        number;
  saldo:          number;
  cobranca_ativa: boolean;
  custo_mensagem: number;
  custo_ia:       number;
  canais_meta:    number;
  canais_zapi:    number;
  canais_email:   number;
  contatos:       number;
  agentes_ativos: number;
  setores:        number;
  ultimo_consumo: string | null;
}

/** Mesmo formato do CHECK no banco e da validação na function. */
const FORMATO = /^[A-Z0-9][A-Z0-9-]{1,11}$/;

/** Sugere o código a partir do nome — tira acento, fica só com letra e número.
 *  É sugestão: o campo continua editável, porque "NITRO" é melhor que
 *  "NITROQUIMICA" e só quem conhece o cliente sabe disso. */
function sugerirCodigo(nome: string): string {
  return nome
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function Metrica({ icone: Icone, valor, rotulo, alerta }: {
  // Aceita style porque a cor do ícone muda com o alerta — os ícones do
  // lucide repassam qualquer prop de SVG.
  icone: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  valor: number | string;
  rotulo: string;
  alerta?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icone className="w-3.5 h-3.5 shrink-0" style={{ color: alerta ? "#fbbf24" : "#6b8f77" }} />
      <div className="min-w-0">
        <p className="text-sm font-semibold tabular-nums leading-none"
           style={{ color: alerta ? "#fbbf24" : "#e8f0ea" }}>{valor}</p>
        <p className="text-[10px] text-agro-muted-2 mt-0.5 truncate">{rotulo}</p>
      </div>
    </div>
  );
}

export function WorkspacesAdmin() {
  const { toast } = useToast();

  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [lista,      setLista]      = useState<Panorama[]>([]);
  const [busca,      setBusca]      = useState("");
  const [salvando,   setSalvando]   = useState(false);
  const [recarregando, setRecarregando] = useState(false);

  const [criando,   setCriando]   = useState(false);
  const [editando,  setEditando]  = useState<Panorama | null>(null);
  const [form,      setForm]      = useState({ name: "", codigo: "", support_email: "", api_enabled: true });
  const [codigoTocado, setCodigoTocado] = useState(false);

  const chamar = useCallback(async (acao: string, extra: Record<string, unknown> = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Sessão expirada.");
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workspaces-admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ acao, ...extra }),
    });
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(corpo.error ?? `Falha (${res.status})`);
    return corpo;
  }, []);

  const carregar = useCallback(async () => {
    setRecarregando(true);
    try {
      const r = await chamar("listar");
      setLista(r.workspaces ?? []);
      setAutorizado(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao carregar.";
      // Negado pelo servidor: a tela inteira não existe para esta pessoa.
      if (/permiss|autoriz|configurad/i.test(msg)) setAutorizado(false);
      else { setAutorizado(true); toast({ title: "Erro", description: msg, variant: "destructive" }); }
      log.error("workspaces_admin_falhou", { err: msg });
    } finally {
      setRecarregando(false);
    }
  }, [chamar, toast]);

  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return lista;
    return lista.filter((w) =>
      w.name.toLowerCase().includes(t) || w.codigo.toLowerCase().includes(t));
  }, [lista, busca]);

  const totais = useMemo(() => ({
    workspaces: lista.length,
    membros:    lista.reduce((s, w) => s + Number(w.membros), 0),
    contatos:   lista.reduce((s, w) => s + Number(w.contatos), 0),
    semCanal:   lista.filter((w) => !Number(w.canais_meta) && !Number(w.canais_zapi)).length,
    semSaldo:   lista.filter((w) => w.cobranca_ativa && Number(w.saldo) <= 0).length,
  }), [lista]);

  function abrirCriar() {
    setForm({ name: "", codigo: "", support_email: "", api_enabled: true });
    setCodigoTocado(false);
    setCriando(true);
  }

  function abrirEditar(w: Panorama) {
    setForm({
      name: w.name, codigo: w.codigo,
      support_email: w.support_email ?? "", api_enabled: w.api_enabled,
    });
    setCodigoTocado(true);
    setEditando(w);
  }

  const codigoValido = FORMATO.test(form.codigo);

  async function salvarCriar() {
    setSalvando(true);
    try {
      const r = await chamar("criar", { name: form.name.trim(), codigo: form.codigo });
      toast({ title: "Workspace criado", description: `${r.workspace.codigo} — ${r.workspace.name}`, variant: "success" });
      setCriando(false);
      await carregar();
    } catch (e) {
      toast({ title: "Não foi possível criar", description: e instanceof Error ? e.message : "Erro", variant: "destructive" });
    } finally { setSalvando(false); }
  }

  async function salvarEditar() {
    if (!editando) return;
    setSalvando(true);
    try {
      await chamar("atualizar", {
        workspace_id:  editando.id,
        name:          form.name.trim(),
        codigo:        form.codigo,
        support_email: form.support_email.trim(),
        api_enabled:   form.api_enabled,
      });
      toast({ title: "Workspace atualizado", variant: "success" });
      setEditando(null);
      await carregar();
    } catch (e) {
      toast({ title: "Não foi possível salvar", description: e instanceof Error ? e.message : "Erro", variant: "destructive" });
    } finally { setSalvando(false); }
  }

  // ── Verificando / negado ─────────────────────────────────────────
  if (autorizado === null) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a110e" }}>
        <Loader2 className="w-6 h-6 animate-spin text-agro-green" />
      </div>
    );
  }

  if (autorizado === false) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#0a110e" }}>
        <div className="max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
               style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <ShieldAlert className="w-6 h-6 text-red-400" />
          </div>
          <h1 className="text-lg font-bold text-agro-text">Área restrita</h1>
          <p className="text-sm text-agro-muted mt-2 leading-relaxed">
            A administração de workspaces é exclusiva do dono da plataforma.
          </p>
        </div>
      </div>
    );
  }

  // ── Console ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Administração" }, { label: "Workspaces" }]} />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        <div className="flex items-start justify-between gap-4 flex-wrap animate-fade-up">
          <div>
            <h1 className="font-display text-2xl font-bold text-agro-text">Workspaces</h1>
            <p className="text-agro-muted mt-1 text-sm">Todos os clientes da plataforma</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={carregar} disabled={recarregando}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-agro-text disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(63,176,108,0.2)" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${recarregando ? "animate-spin" : ""}`} /> Atualizar
            </button>
            <button onClick={abrirCriar}
              className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white">
              <Plus className="w-4 h-4" /> Novo workspace
            </button>
          </div>
        </div>

        {/* ── Resumo ──────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-up-delay-1">
          {[
            { icone: Building2, valor: totais.workspaces, rotulo: "clientes",        alerta: false },
            { icone: Users,     valor: totais.membros,    rotulo: "pessoas",         alerta: false },
            { icone: Contact,   valor: totais.contatos.toLocaleString("pt-BR"), rotulo: "contatos", alerta: false },
            { icone: AlertTriangle, valor: totais.semCanal + totais.semSaldo, rotulo: "precisam de atenção", alerta: totais.semCanal + totais.semSaldo > 0 },
          ].map((c) => (
            <div key={c.rotulo} className="rounded-2xl p-4"
                 style={{ background: "rgba(13,26,17,0.7)", border: `1px solid ${c.alerta ? "rgba(245,158,11,0.25)" : "rgba(63,176,108,0.1)"}` }}>
              <c.icone className="w-4 h-4 mb-2" style={{ color: c.alerta ? "#fbbf24" : "#3fb06c" }} />
              <p className="text-2xl font-bold tabular-nums" style={{ color: c.alerta ? "#fbbf24" : "#e8f0ea" }}>{c.valor}</p>
              <p className="text-[10px] text-agro-muted-2 mt-0.5">{c.rotulo}</p>
            </div>
          ))}
        </div>

        {/* ── Busca ───────────────────────────────── */}
        {lista.length > 4 && (
          <div className="relative animate-fade-up-delay-2">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-agro-muted-2 pointer-events-none" />
            <input
              value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou código…"
              aria-label="Buscar workspace"
              className="w-full pl-11 pr-4 py-2.5 rounded-2xl text-sm text-agro-text placeholder:text-agro-muted-2 outline-none"
              style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.15)" }}
            />
          </div>
        )}

        {/* ── Lista ───────────────────────────────── */}
        <div className="space-y-3 animate-fade-up-delay-3">
          {filtrados.map((w) => {
            const semCanal = !Number(w.canais_meta) && !Number(w.canais_zapi);
            const semSaldo = w.cobranca_ativa && Number(w.saldo) <= 0;
            return (
              <div key={w.id} className="rounded-2xl p-5"
                   style={{ background: "rgba(13,26,17,0.7)", border: `1px solid ${semCanal || semSaldo ? "rgba(245,158,11,0.2)" : "rgba(63,176,108,0.1)"}` }}>

                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-xs font-bold px-2 py-1 rounded-lg tracking-wider"
                            style={{ background: "rgba(63,176,108,0.14)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }}>
                        {w.codigo}
                      </span>
                      <h2 className="text-base font-semibold text-agro-text truncate">{w.name}</h2>
                      {!w.api_enabled && (
                        <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded text-agro-muted-2"
                              style={{ background: "rgba(255,255,255,0.04)" }}>API desligada</span>
                      )}
                    </div>
                    <p className="flex items-center gap-1.5 text-[11px] text-agro-muted-2 mt-1.5">
                      <Calendar className="w-3 h-3" /> cliente desde {formatDate(w.created_at.slice(0, 10))}
                      {w.ultimo_consumo && <> · último consumo em {formatDate(w.ultimo_consumo.slice(0, 10))}</>}
                    </p>
                  </div>

                  <button onClick={() => abrirEditar(w)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold text-agro-text shrink-0"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(63,176,108,0.2)" }}>
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </button>
                </div>

                {/* Métricas */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-4 pt-4"
                     style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
                  <Metrica icone={Coins}     valor={Number(w.saldo).toLocaleString("pt-BR")} rotulo={w.cobranca_ativa ? "créditos" : "cobrança off"} alerta={semSaldo} />
                  <Metrica icone={Users}     valor={Number(w.membros)}        rotulo="pessoas" />
                  <Metrica icone={Contact}   valor={Number(w.contatos).toLocaleString("pt-BR")} rotulo="contatos" />
                  <Metrica icone={GitBranch} valor={Number(w.setores)}        rotulo="setores" />
                  <Metrica icone={Bot}       valor={Number(w.agentes_ativos)} rotulo="agentes ativos" />
                  <Metrica icone={Plug}      valor={Number(w.canais_meta) + Number(w.canais_zapi) + Number(w.canais_email)} rotulo="conexões" alerta={semCanal} />
                </div>

                {/* Canais e avisos */}
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  {Number(w.canais_meta) > 0 && (
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-lg"
                          style={{ background: "rgba(63,176,108,0.1)", color: "#4ade80" }}>
                      <Smartphone className="w-3 h-3" /> Meta oficial
                    </span>
                  )}
                  {Number(w.canais_zapi) > 0 && (
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-lg"
                          style={{ background: "rgba(59,130,246,0.1)", color: "#60a5fa" }}>
                      <Zap className="w-3 h-3" /> Z-API
                    </span>
                  )}
                  {Number(w.canais_email) > 0 && (
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-lg"
                          style={{ background: "rgba(168,85,247,0.1)", color: "#c084fc" }}>
                      <Mail className="w-3 h-3" /> E-mail
                    </span>
                  )}
                  {semCanal && (
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-lg"
                          style={{ background: "rgba(245,158,11,0.1)", color: "#fbbf24" }}>
                      <AlertTriangle className="w-3 h-3" /> sem canal de WhatsApp — não envia nada
                    </span>
                  )}
                  {semSaldo && (
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-lg"
                          style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}>
                      <AlertTriangle className="w-3 h-3" /> saldo zerado — tudo parado
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {filtrados.length === 0 && (
            <p className="text-center text-sm text-agro-muted-2 py-12">
              {busca ? `Nenhum workspace para “${busca}”.` : "Nenhum workspace ainda."}
            </p>
          )}
        </div>
      </div>

      {/* ── Modal: criar ────────────────────────── */}
      <Presence when={criando}>
        {(v) => (
          <Modal open={v} onClose={() => setCriando(false)} title="Novo workspace"
                 subtitle="Abre um cliente novo, já com setores e regras padrão" icon={<Building2 className="w-5 h-5" />} size="md">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="field-label">Nome do cliente</label>
                <input
                  value={form.name} autoFocus
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) => ({ ...f, name, codigo: codigoTocado ? f.codigo : sugerirCodigo(name) }));
                  }}
                  placeholder="NITRO Química"
                  className="input-agro w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="field-label flex items-center gap-1.5"><Hash className="w-3 h-3" /> Código</label>
                <input
                  value={form.codigo}
                  onChange={(e) => { setCodigoTocado(true); setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() })); }}
                  placeholder="NITRO"
                  className="input-agro w-full font-mono tracking-wider"
                />
                <p className="text-[11px] leading-relaxed"
                   style={{ color: form.codigo && !codigoValido ? "#f87171" : "#6b8f77" }}>
                  {form.codigo && !codigoValido
                    ? "2 a 12 caracteres: letras maiúsculas, números e hífen, começando por letra ou número."
                    : "Nome curto para achar o cliente no suporte e conferir cobrança sem passar UUID."}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setCriando(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
                  style={{ border: "1px solid rgba(63,176,108,0.15)" }}>Cancelar</button>
                <button onClick={salvarCriar} disabled={salvando || form.name.trim().length < 2 || !codigoValido}
                  className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
                </button>
              </div>
            </div>
          </Modal>
        )}
      </Presence>

      {/* ── Modal: editar ───────────────────────── */}
      <Presence when={editando !== null}>
        {(v) => (
          <Modal open={v} onClose={() => setEditando(null)} title="Editar workspace"
                 subtitle={editando?.codigo} icon={<Pencil className="w-5 h-5" />} size="md">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="field-label">Nome do cliente</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                       className="input-agro w-full" />
              </div>

              <div className="space-y-1.5">
                <label className="field-label flex items-center gap-1.5"><Hash className="w-3 h-3" /> Código</label>
                <input value={form.codigo}
                       onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
                       className="input-agro w-full font-mono tracking-wider" />
                {form.codigo && !codigoValido && (
                  <p className="text-[11px] text-red-400">2 a 12 caracteres: maiúsculas, números e hífen.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="field-label">E-mail de suporte</label>
                <input value={form.support_email} type="email"
                       onChange={(e) => setForm((f) => ({ ...f, support_email: e.target.value }))}
                       placeholder="suporte@cliente.com.br" className="input-agro w-full" />
                <p className="text-[11px] text-agro-muted-2">
                  Destino das notificações de chamado. Vazio, ninguém é avisado.
                </p>
              </div>

              <button
                onClick={() => setForm((f) => ({ ...f, api_enabled: !f.api_enabled }))}
                className="w-full flex items-center justify-between gap-3 p-3 rounded-xl text-left"
                style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(63,176,108,0.1)" }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-agro-text">API pública</p>
                  <p className="text-[11px] text-agro-muted-2 mt-0.5">
                    Desligada, as chaves deste cliente param de responder.
                  </p>
                </div>
                <span className="w-10 h-6 rounded-full shrink-0 flex items-center px-0.5 transition-colors"
                      style={{ background: form.api_enabled ? "#3fb06c" : "rgba(255,255,255,0.12)" }}>
                  <span className="w-5 h-5 rounded-full bg-white flex items-center justify-center transition-transform"
                        style={{ transform: form.api_enabled ? "translateX(16px)" : "translateX(0)" }}>
                    {form.api_enabled
                      ? <Check className="w-3 h-3" style={{ color: "#3fb06c" }} />
                      : <X className="w-3 h-3" style={{ color: "#6b8f77" }} />}
                  </span>
                </span>
              </button>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditando(null)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
                  style={{ border: "1px solid rgba(63,176,108,0.15)" }}>Cancelar</button>
                <button onClick={salvarEditar} disabled={salvando || form.name.trim().length < 2 || !codigoValido}
                  className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
                </button>
              </div>
            </div>
          </Modal>
        )}
      </Presence>
    </div>
  );
}
