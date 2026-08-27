// Criação e gestão dos links de convite.
//
// A diferença para o convite por e-mail não é de interface, é de natureza:
// quem tiver o link entra. Por isso os limites (quantas pessoas, por quantos
// dias) ficam na tela principal e não escondidos atrás de "opções avançadas" —
// quem cria o link precisa ver o alcance do que está criando enquanto cria.

import { useState, useEffect, useCallback } from "react";
import {
  Link2, Loader2, X, Copy, Check, Trash2, MessageCircle,
  AlertTriangle, Clock, Users, Shield, ChevronDown, Pencil,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { ROLE_LABELS, ROLE_STYLE, DEFAULT_PERMISSIONS } from "@/context/AuthContext";
import type { UserProfile, PermissionKey } from "@/context/AuthContext";
import { FEATURE_DEFS } from "@/lib/permissoes";

type Papel = UserProfile["role"];
type Perms = Partial<Record<PermissionKey, boolean>>;

interface LinkConvite {
  id:          string;
  url:         string;
  role:        Papel;
  label:       string | null;
  permissions: Perms | null;
  max_uses:    number;
  uses:        number;
  expires_at:  string;
  revoked_at:  string | null;
  created_at:  string;
}

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-link`;

async function chamar(corpo: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(FN, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${session?.access_token ?? ""}`,
      "apikey":        import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(corpo),
  });
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { /* resposta não-JSON */ }
  return { ok: res.ok, json };
}

function diasRestantes(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** Um link só está de pé se não foi revogado, não venceu e ainda tem uso. */
function estaDePe(l: LinkConvite): boolean {
  return !l.revoked_at && new Date(l.expires_at) > new Date() && l.uses < l.max_uses;
}

interface Props {
  onClose:      () => void;
  workspaceId:  string;
  podeCriarAdmin: boolean;
}

export function InviteLinkModal({ onClose, workspaceId, podeCriarAdmin }: Props) {
  const [papel,    setPapel]    = useState<Papel>("agent");
  const [perms,    setPerms]    = useState<Perms>({});
  const [abrirPerms, setAbrirPerms] = useState(false);
  const [pessoas,  setPessoas]  = useState(1);
  const [dias,     setDias]     = useState(7);
  const [rotulo,   setRotulo]   = useState("");
  const [gerando,  setGerando]  = useState(false);
  const [editando, setEditando] = useState<LinkConvite | null>(null);
  const [erro,     setErro]     = useState<string | null>(null);
  const [novo,     setNovo]     = useState<LinkConvite | null>(null);
  const [links,    setLinks]    = useState<LinkConvite[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [copiado,  setCopiado]  = useState<string | null>(null);
  const [revogando, setRevogando] = useState<string | null>(null);
  const { toast } = useToast();

  const carregar = useCallback(async () => {
    const { ok, json } = await chamar({ action: "list", workspace_id: workspaceId });
    if (ok) setLinks((json.links as LinkConvite[]) ?? []);
    setCarregando(false);
  }, [workspaceId]);

  useEffect(() => { carregar(); }, [carregar]);

  /* Admin pode tudo por definição — hasPermission() devolve true antes de
     olhar a lista. Mostrar interruptores desligáveis para um admin seria a
     tela prometendo um limite que o sistema não aplica. */
  const admin = papel === "admin";

  function valorEfetivo(k: PermissionKey): boolean {
    if (admin) return true;
    return perms[k] ?? DEFAULT_PERMISSIONS[papel][k] ?? false;
  }

  function alternar(k: PermissionKey, v: boolean) {
    const padrao = DEFAULT_PERMISSIONS[papel][k] ?? false;
    setPerms((prev) => {
      const prox = { ...prev };
      // Igual ao padrão do cargo = não guarda exceção. Assim, mudar o cargo
      // do link depois continua trazendo os padrões novos junto.
      if (v === padrao) delete prox[k]; else prox[k] = v;
      return prox;
    });
  }

  const ajustes = Object.keys(perms).length;

  async function gerar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null); setGerando(true);
    try {
      const corpo = editando
        ? { action: "update", id: editando.id, role: papel, permissions: perms,
            max_uses: pessoas, expires_in_days: dias, label: rotulo.trim() || null }
        : { action: "create", workspace_id: workspaceId, role: papel, permissions: perms,
            max_uses: pessoas, expires_in_days: dias, label: rotulo.trim() || null };
      const { ok, json } = await chamar(corpo);
      if (!ok) { setErro(String(json.error ?? "Não foi possível salvar o link.")); return; }
      setNovo(json.link as LinkConvite);
      setEditando(null);
      setRotulo("");
      carregar();
    } catch {
      setErro("Erro de conexão. Verifique sua internet.");
    } finally { setGerando(false); }
  }

  /** Traz um link existente de volta para o formulário. Só faz sentido
   *  enquanto ninguém usou: depois disso o acesso da pessoa já existe e se
   *  edita na tela Equipe. */
  function editar(l: LinkConvite) {
    setEditando(l);
    setPapel(l.role);
    setPerms(l.permissions ?? {});
    setPessoas(l.max_uses);
    setDias(Math.max(diasRestantes(l.expires_at), 1));
    setRotulo(l.label ?? "");
    setAbrirPerms(!!l.permissions && Object.keys(l.permissions).length > 0);
    setNovo(null);
    setErro(null);
  }

  async function copiar(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(id);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      toast({ title: "Não foi possível copiar", description: "Selecione o link e copie manualmente.", variant: "destructive" });
    }
  }

  /** No celular abre a folha nativa (WhatsApp entre as opções); no
   *  computador vai direto para o WhatsApp Web. */
  async function compartilhar(link: LinkConvite) {
    const texto = `Você foi convidado para a equipe no Solve AI. Acesse: ${link.url}`;
    if (navigator.share) {
      try { await navigator.share({ text: texto }); return; }
      catch { /* cancelado pelo usuário — não é erro */ return; }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  }

  async function revogar(id: string) {
    setRevogando(id);
    const { ok, json } = await chamar({ action: "revoke", id });
    if (ok) {
      toast({ title: "Link cancelado", description: "Quem tiver esse link não consegue mais entrar.", variant: "success" });
      if (novo?.id === id) setNovo(null);
      carregar();
    } else {
      toast({ title: "Erro", description: String(json.error ?? "Não foi possível cancelar."), variant: "destructive" });
    }
    setRevogando(null);
  }

  const ativos = links.filter(estaDePe);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
         style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md max-h-[88dvh] overflow-y-auto scrollbar-thin rounded-2xl p-5 sm:p-6"
           style={{ background: "#0d1a11", border: "1px solid rgba(63,176,108,0.2)", boxShadow: "0 32px 80px rgba(0,0,0,0.6)" }}>

        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                 style={{ background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.2)" }}>
              <Link2 className="w-4 h-4 text-agro-green" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-agro-text">Link de convite</h2>
              <p className="text-[11px] text-agro-muted-2">Para mandar no WhatsApp</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── O link recém-criado ─────────────────────────────── */}
        {novo ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl space-y-3"
                 style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.25)" }}>
              <p className="text-xs text-agro-muted">
                Link pronto — vale para <strong className="text-agro-text">{novo.max_uses === 1 ? "1 pessoa" : `${novo.max_uses} pessoas`}</strong>,
                por <strong className="text-agro-text">{diasRestantes(novo.expires_at)} dia(s)</strong>,
                com acesso de <strong style={{ color: ROLE_STYLE[novo.role].color }}>{ROLE_LABELS[novo.role]}</strong>.
              </p>
              <p className="text-[12px] text-agro-text break-all font-mono leading-relaxed px-3 py-2.5 rounded-lg"
                 style={{ background: "rgba(0,0,0,0.35)" }}>
                {novo.url}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => copiar(novo.url, novo.id)}
                        className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-agro-text transition-colors"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(63,176,108,0.15)" }}>
                  {copiado === novo.id ? <Check className="w-4 h-4 text-agro-green" /> : <Copy className="w-4 h-4" />}
                  {copiado === novo.id ? "Copiado" : "Copiar"}
                </button>
                <button onClick={() => compartilhar(novo)}
                        className="btn-agro flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white">
                  <MessageCircle className="w-4 h-4" />
                  Enviar
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
                 style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-200/70 leading-relaxed">
                Qualquer pessoa com este link entra na equipe. Mande só para quem deve entrar —
                e se errar o destino, cancele o link aqui embaixo.
              </p>
            </div>

            <button onClick={() => setNovo(null)}
                    className="w-full py-2.5 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
                    style={{ border: "1px solid rgba(63,176,108,0.12)" }}>
              Gerar outro link
            </button>
          </div>
        ) : (
          /* ── Formulário ─────────────────────────────────────── */
          <form onSubmit={gerar} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-agro-muted">Acesso de</label>
              <select value={papel} onChange={(e) => { setPapel(e.target.value as Papel); setPerms({}); }}
                      className="input-agro w-full py-2.5">
                <option value="agent">Agente</option>
                <option value="manager">Gerente</option>
                {podeCriarAdmin && <option value="admin">Admin</option>}
              </select>
            </div>

            {/* ── Permissões ─────────────────────────────────────── */}
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.12)" }}>
              <button type="button" onClick={() => setAbrirPerms(!abrirPerms)}
                      className="w-full flex items-center justify-between px-3.5 py-3 text-left hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-agro-green" />
                  <span className="text-xs font-medium text-agro-text">Permissões</span>
                  {admin ? (
                    <span className="text-[10px] text-agro-muted-2">acesso total</span>
                  ) : ajustes > 0 ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md text-agro-green"
                          style={{ background: "rgba(63,176,108,0.12)" }}>
                      {ajustes} ajuste{ajustes > 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span className="text-[10px] text-agro-muted-2">padrão do cargo</span>
                  )}
                </div>
                <ChevronDown className={`w-4 h-4 text-agro-muted-2 transition-transform ${abrirPerms ? "rotate-180" : ""}`} />
              </button>

              {abrirPerms && (
                <div className="px-3.5 pb-3.5 space-y-1" style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
                  {admin ? (
                    <p className="text-[11px] text-agro-muted-2 leading-relaxed pt-3">
                      Administrador tem acesso a tudo por definição — não há o que ajustar aqui.
                      Para dar um acesso recortado, escolha Gerente ou Agente.
                    </p>
                  ) : (
                    <>
                      <p className="text-[11px] text-agro-muted-2 leading-relaxed pt-3 pb-1">
                        Valem só neste workspace. Quem entrar não leva nada disto para outra empresa.
                      </p>
                      {FEATURE_DEFS.map((f) => {
                        const ligado  = valorEfetivo(f.key);
                        const mudou   = perms[f.key] !== undefined;
                        const Icone   = f.icon;
                        return (
                          <div key={f.key} className="flex items-center gap-3 py-2">
                            <Icone className="w-3.5 h-3.5 text-agro-muted-2 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-agro-text flex items-center gap-1.5">
                                {f.label}
                                {mudou && <span className="w-1 h-1 rounded-full bg-agro-green shrink-0" />}
                              </p>
                              <p className="text-[10px] text-agro-muted-2 leading-snug">{f.desc}</p>
                            </div>
                            <button type="button" onClick={() => alternar(f.key, !ligado)}
                                    role="switch" aria-checked={ligado} aria-label={f.label}
                                    className="relative w-9 h-5 rounded-full shrink-0 transition-colors"
                                    style={{ background: ligado ? "#3fb06c" : "rgba(255,255,255,0.12)" }}>
                              <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                                    style={{ left: ligado ? "18px" : "2px" }} />
                            </button>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-agro-muted flex items-center gap-1.5">
                  <Users className="w-3 h-3" />Quantas pessoas
                </label>
                <input type="number" min={1} max={100} value={pessoas}
                       onChange={(e) => setPessoas(Math.min(Math.max(Number(e.target.value) || 1, 1), 100))}
                       className="input-agro w-full py-2.5" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-agro-muted flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />Vale por (dias)
                </label>
                <input type="number" min={1} max={90} value={dias}
                       onChange={(e) => setDias(Math.min(Math.max(Number(e.target.value) || 1, 1), 90))}
                       className="input-agro w-full py-2.5" />
              </div>
            </div>

            <p className="text-[11px] text-agro-muted-2 leading-relaxed">
              {pessoas === 1
                ? "O link morre assim que a primeira pessoa entrar."
                : `O link aceita ${pessoas} pessoas e depois para de funcionar.`}
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-agro-muted">Anotação <span className="text-agro-muted-2">(opcional)</span></label>
              <input type="text" value={rotulo} maxLength={80} onChange={(e) => setRotulo(e.target.value)}
                     placeholder="Ex.: equipe de cobrança" className="input-agro w-full py-2.5" />
            </div>

            {erro && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm text-red-400"
                   style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <X className="w-4 h-4 shrink-0 mt-0.5" />{erro}
              </div>
            )}

            <button type="submit" disabled={gerando}
                    className="btn-agro w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-60">
              {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {gerando ? "Salvando…" : editando ? "Salvar alterações" : "Gerar link"}
            </button>

            {editando && (
              <button type="button"
                      onClick={() => { setEditando(null); setPerms({}); setPapel("agent"); setPessoas(1); setDias(7); setRotulo(""); }}
                      className="w-full py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors">
                Cancelar edição
              </button>
            )}
          </form>
        )}

        {/* ── Links já criados ────────────────────────────────── */}
        <div className="mt-6 pt-5" style={{ borderTop: "1px solid rgba(63,176,108,0.1)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2 mb-3">
            Links ativos {!carregando && `(${ativos.length})`}
          </p>

          {carregando ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-agro-muted-2 animate-spin" /></div>
          ) : ativos.length === 0 ? (
            <p className="text-xs text-agro-muted-2 py-3">Nenhum link ativo no momento.</p>
          ) : (
            <div className="space-y-2">
              {ativos.map((l) => (
                <div key={l.id} className="p-3 rounded-xl space-y-2"
                     style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(63,176,108,0.08)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-agro-text truncate">
                        {l.label || ROLE_LABELS[l.role]}
                      </p>
                      <p className="text-[11px] text-agro-muted-2">
                        <span style={{ color: ROLE_STYLE[l.role].color }}>{ROLE_LABELS[l.role]}</span>
                        {" · "}{l.uses}/{l.max_uses} usado(s)
                        {" · "}{diasRestantes(l.expires_at)} dia(s)
                        {l.permissions && Object.keys(l.permissions).length > 0 &&
                          ` · ${Object.keys(l.permissions).length} ajuste(s)`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => copiar(l.url, l.id)} title="Copiar"
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors">
                        {copiado === l.id ? <Check className="w-3.5 h-3.5 text-agro-green" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => compartilhar(l)} title="Enviar"
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-green hover:bg-white/5 transition-colors">
                        <MessageCircle className="w-3.5 h-3.5" />
                      </button>
                      {l.uses === 0 && (
                        <button onClick={() => editar(l)} title="Editar cargo e permissões"
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => revogar(l.id)} disabled={revogando === l.id} title="Cancelar"
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-red-400 hover:bg-white/5 transition-colors disabled:opacity-50">
                        {revogando === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
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
