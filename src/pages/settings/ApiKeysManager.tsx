import { useState, useEffect, useCallback } from "react";
import {
  Key, Plus, Trash2, Copy, Check, Eye, EyeOff, Loader2,
  ShieldCheck, Clock, AlertTriangle, RefreshCw, Terminal,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiKey {
  id:            string;
  name:          string;
  key_prefix:    string;
  scopes:        string[];
  expires_at:    string | null;
  last_used_at:  string | null;
  created_at:    string;
  revoked_at:    string | null;
}

const ALL_SCOPES = [
  { id: "contacts:read",  label: "Contatos — Leitura",  description: "GET /v1/contacts" },
  { id: "contacts:write", label: "Contatos — Escrita",  description: "POST /v1/contacts (upsert)" },
  { id: "campaigns:read", label: "Campanhas — Leitura", description: "GET /v1/campaigns" },
  { id: "stats:read",     label: "Estatísticas",        description: "GET /v1/stats" },
];

const DB_API_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";

// ── Helpers ───────────────────────────────────────────────────────────────────

const db = supabase as any;

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

async function generateRawKey(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return `sk_live_${hex}`;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScopeBadge({ scope }: { scope: string }) {
  const def = ALL_SCOPES.find(s => s.id === scope);
  const isWrite = scope.endsWith(":write");
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
      style={{
        background: isWrite ? "rgba(245,158,11,0.1)" : "rgba(63,176,108,0.08)",
        color:      isWrite ? "#fbbf24" : "#7fc49a",
        border:     `1px solid ${isWrite ? "rgba(245,158,11,0.2)" : "rgba(63,176,108,0.15)"}`,
      }}>
      {def?.label ?? scope}
    </span>
  );
}

// ── Create key modal ──────────────────────────────────────────────────────────

interface CreateModalProps {
  workspaceId: string;
  onCreated: (key: ApiKey) => void;
  onClose: () => void;
}

function CreateKeyModal({ workspaceId, onCreated, onClose }: CreateModalProps) {
  const { toast } = useToast();
  const [name,       setName]       = useState("");
  const [scopes,     setScopes]     = useState(["contacts:read","campaigns:read","stats:read"]);
  const [expiresIn,  setExpiresIn]  = useState<"never"|"30d"|"90d"|"1y">("never");
  const [saving,     setSaving]     = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied,     setCopied]     = useState(false);

  function toggleScope(s: string) {
    setScopes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  async function handleCreate() {
    if (!name.trim())     { toast({ title: "Nome é obrigatório", variant: "destructive" }); return; }
    if (scopes.length === 0) { toast({ title: "Selecione ao menos um escopo", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const rawKey   = await generateRawKey();
      const keyHash  = await sha256Hex(rawKey);
      const prefix   = rawKey.slice(0, 16) + "...";

      let expiresAt: string | null = null;
      if (expiresIn !== "never") {
        const d = new Date();
        if (expiresIn === "30d") d.setDate(d.getDate() + 30);
        if (expiresIn === "90d") d.setDate(d.getDate() + 90);
        if (expiresIn === "1y")  d.setFullYear(d.getFullYear() + 1);
        expiresAt = d.toISOString();
      }

      const { data, error } = await db
        .from("api_keys")
        .insert({
          workspace_id: workspaceId,
          name:         name.trim(),
          key_prefix:   prefix,
          key_hash:     keyHash,
          scopes,
          expires_at:   expiresAt,
        })
        .select("id, name, key_prefix, scopes, expires_at, last_used_at, created_at, revoked_at")
        .single();

      if (error) throw new Error(error.message);
      setCreatedKey(rawKey);
      onCreated(data as ApiKey);
    } catch (e) {
      toast({ title: "Erro ao criar chave", description: e instanceof Error ? e.message : "Tente novamente.", variant: "destructive" });
      setSaving(false);
    }
  }

  async function copyKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onClick={createdKey ? undefined : onClose}>
      <div className="rounded-2xl p-6 w-full max-w-md space-y-5"
        style={{ background: "rgba(13,26,17,0.98)", border: "1px solid rgba(63,176,108,0.2)" }}
        onClick={e => e.stopPropagation()}>

        {!createdKey ? (
          <>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}>
                <Key className="w-4 h-4" style={{ color: "#3fb06c" }} />
              </div>
              <h2 className="text-base font-bold text-agro-text">Nova chave de API</h2>
            </div>

            {/* Name */}
            <div>
              <label className="text-[10px] font-bold text-agro-muted uppercase tracking-widest mb-1.5 block">Nome da chave</label>
              <input
                className="input-agro w-full"
                placeholder="ex: ERP TOTVS — Produção"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={80}
              />
            </div>

            {/* Scopes */}
            <div>
              <label className="text-[10px] font-bold text-agro-muted uppercase tracking-widest mb-1.5 block">Escopos de acesso</label>
              <div className="space-y-2">
                {ALL_SCOPES.map(s => (
                  <label key={s.id} className="flex items-start gap-3 cursor-pointer group">
                    <div
                      className="w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5 transition-all"
                      style={scopes.includes(s.id)
                        ? { background: "linear-gradient(135deg,#3fb06c,#16A34A)", boxShadow: "0 0 6px rgba(63,176,108,0.4)" }
                        : { border: "1px solid rgba(63,176,108,0.3)", background: "transparent" }}
                      onClick={() => toggleScope(s.id)}>
                      {scopes.includes(s.id) && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <div onClick={() => toggleScope(s.id)}>
                      <p className="text-xs font-semibold text-agro-text">{s.label}
                        {s.id.endsWith(":write") && (
                          <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded font-bold"
                            style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.2)" }}>
                            ESCRITA
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-agro-muted-2 font-mono">{s.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Expiry */}
            <div>
              <label className="text-[10px] font-bold text-agro-muted uppercase tracking-widest mb-1.5 block">Expiração</label>
              <div className="grid grid-cols-4 gap-2">
                {(["never","30d","90d","1y"] as const).map(opt => (
                  <button key={opt}
                    onClick={() => setExpiresIn(opt)}
                    className="py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={expiresIn === opt
                      ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.35)" }
                      : { background: "rgba(0,0,0,0.2)", color: "#6b8a75", border: "1px solid rgba(63,176,108,0.1)" }}>
                    {opt === "never" ? "Nunca" : opt === "1y" ? "1 ano" : opt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-agro-muted-2 hover:text-agro-text transition-colors"
                style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
                Cancelar
              </button>
              <button onClick={handleCreate} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#3fb06c,#16A34A)" }}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Gerar chave"}
              </button>
            </div>
          </>
        ) : (
          /* ── Key reveal — shown ONCE ── */
          <>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}>
                <ShieldCheck className="w-4 h-4" style={{ color: "#3fb06c" }} />
              </div>
              <div>
                <h2 className="text-base font-bold text-agro-text">Chave gerada!</h2>
                <p className="text-[10px] text-amber-400">Copie agora — não será exibida novamente.</p>
              </div>
            </div>

            <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Guarde em local seguro
              </p>
              <p className="text-[10px] text-agro-muted">Esta chave não ficará visível novamente. Trate-a como uma senha.</p>
            </div>

            <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(63,176,108,0.15)" }}>
              <code className="text-xs text-agro-green font-mono flex-1 break-all">{createdKey}</code>
              <button onClick={copyKey}
                className="shrink-0 p-1.5 rounded-lg transition-colors hover:bg-white/10"
                style={{ color: copied ? "#3fb06c" : "#6b8a75" }}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <button onClick={onClose}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all"
              style={{ background: "linear-gradient(135deg,#3fb06c,#16A34A)" }}>
              Feito — já salvei minha chave
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ApiKeysManager() {
  const { workspaceId } = useAuth();
  const { toast }       = useToast();
  const wsId            = workspaceId ?? "";

  const [keys,       setKeys]       = useState<ApiKey[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [showRevoked,setShowRevoked]= useState(false);
  const [showDoc,    setShowDoc]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await db
      .from("api_keys")
      .select("id, name, key_prefix, scopes, expires_at, last_used_at, created_at, revoked_at")
      .eq("workspace_id", wsId)
      .order("created_at", { ascending: false });
    setKeys((data ?? []) as ApiKey[]);
    setLoading(false);
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  async function handleRevoke(keyId: string, keyName: string) {
    setRevokingId(keyId);
    const { error } = await db
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: "Revogada manualmente" })
      .eq("id", keyId);
    if (error) {
      toast({ title: "Erro ao revogar", description: error.message, variant: "destructive" });
    } else {
      setKeys(prev => prev.map(k => k.id === keyId ? { ...k, revoked_at: new Date().toISOString() } : k));
      toast({ title: `Chave "${keyName}" revogada`, variant: "success" });
    }
    setRevokingId(null);
  }

  const active  = keys.filter(k => !k.revoked_at);
  const revoked = keys.filter(k =>  k.revoked_at);
  const apiBase = `${DB_API_URL}/functions/v1/public-api/v1`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-agro-text flex items-center gap-2">
            <Key className="w-3.5 h-3.5" style={{ color: "#3fb06c" }} />
            Chaves de API
          </p>
          <p className="text-[11px] text-agro-muted mt-0.5">
            Autentique sistemas externos via <code className="font-mono text-agro-green">Authorization: Bearer sk_live_...</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} className="p-1.5 rounded-lg text-agro-muted hover:text-white transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all"
            style={{ background: "linear-gradient(135deg,#3fb06c,#16A34A)" }}>
            <Plus className="w-3.5 h-3.5" /> Nova chave
          </button>
        </div>
      </div>

      {/* Quick-ref doc toggle */}
      <button onClick={() => setShowDoc(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-agro-muted hover:text-agro-text transition-colors text-left"
        style={{ border: "1px solid rgba(63,176,108,0.1)", background: "rgba(0,0,0,0.1)" }}>
        <Terminal className="w-3.5 h-3.5 shrink-0" style={{ color: "#3fb06c" }} />
        <span>Referência rápida da API</span>
        <span className="ml-auto text-[10px]">{showDoc ? "▲ ocultar" : "▼ expandir"}</span>
      </button>

      {showDoc && (
        <div className="rounded-xl p-4 space-y-3 text-[11px]"
          style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(63,176,108,0.1)" }}>
          <p className="text-[10px] font-bold text-agro-muted uppercase tracking-widest">Base URL</p>
          <code className="block text-agro-green font-mono break-all">{apiBase}</code>

          <p className="text-[10px] font-bold text-agro-muted uppercase tracking-widest mt-3">Autenticação</p>
          <code className="block text-agro-muted-2 font-mono">Authorization: Bearer sk_live_...</code>

          <p className="text-[10px] font-bold text-agro-muted uppercase tracking-widest mt-3">Endpoints</p>
          {[
            { method: "GET",  path: "/contacts",        scope: "contacts:read",  desc: "Lista contatos (q, page, limit)" },
            { method: "GET",  path: "/contacts/:phone", scope: "contacts:read",  desc: "Busca contato por telefone" },
            { method: "POST", path: "/contacts",        scope: "contacts:write", desc: "Cria/atualiza contato + boleto" },
            { method: "GET",  path: "/campaigns",       scope: "campaigns:read", desc: "Lista campanhas (status, channel, page)" },
            { method: "GET",  path: "/campaigns/:id",   scope: "campaigns:read", desc: "Detalhe de campanha" },
            { method: "GET",  path: "/stats",           scope: "stats:read",     desc: "Resumo do workspace" },
          ].map(e => (
            <div key={e.path + e.method} className="flex items-start gap-2 py-1"
              style={{ borderBottom: "1px solid rgba(63,176,108,0.06)" }}>
              <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded font-mono ${e.method === "GET" ? "text-sky-400" : "text-amber-400"}`}
                style={{ background: e.method === "GET" ? "rgba(56,189,248,0.1)" : "rgba(245,158,11,0.1)" }}>
                {e.method}
              </span>
              <code className="text-agro-green font-mono shrink-0">{e.path}</code>
              <span className="text-agro-muted-2 flex-1">{e.desc}</span>
              <ScopeBadge scope={e.scope} />
            </div>
          ))}
        </div>
      )}

      {/* Active keys */}
      {loading ? (
        <div className="flex items-center justify-center h-20">
          <Loader2 className="w-5 h-5 animate-spin text-agro-green" />
        </div>
      ) : active.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center rounded-xl"
          style={{ border: "1px dashed rgba(63,176,108,0.12)" }}>
          <Key className="w-7 h-7 text-agro-muted/30 mb-2" />
          <p className="text-xs text-agro-muted">Nenhuma chave ativa.</p>
          <p className="text-[11px] text-agro-muted-2 mt-0.5">Crie uma para integrar sistemas externos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {active.map(key => {
            const isExpired = key.expires_at && new Date(key.expires_at) < new Date();
            return (
              <div key={key.id}
                className="rounded-xl px-4 py-3 flex items-start gap-4"
                style={{ background: "rgba(13,26,17,0.6)", border: `1px solid ${isExpired ? "rgba(239,68,68,0.2)" : "rgba(63,176,108,0.12)"}` }}>
                <Key className="w-4 h-4 shrink-0 mt-0.5" style={{ color: isExpired ? "#f87171" : "#3fb06c" }} />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-semibold text-agro-text">{key.name}</p>
                    {isExpired && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                        style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>
                        EXPIRADA
                      </span>
                    )}
                  </div>
                  <code className="text-[10px] font-mono text-agro-muted-2">{key.key_prefix}</code>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {key.scopes.map(s => <ScopeBadge key={s} scope={s} />)}
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-agro-muted-2">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Criada {fmtDate(key.created_at)}
                    </span>
                    {key.last_used_at && (
                      <span>Último uso: {fmtDate(key.last_used_at)}</span>
                    )}
                    {key.expires_at && (
                      <span style={{ color: isExpired ? "#f87171" : "#6b8a75" }}>
                        Expira {fmtDate(key.expires_at)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(key.id, key.name)}
                  disabled={revokingId === key.id}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all hover:bg-red-500/15 disabled:opacity-40"
                  style={{ color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>
                  {revokingId === key.id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <><Trash2 className="w-3 h-3" /> Revogar</>}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Revoked keys (collapsible) */}
      {revoked.length > 0 && (
        <div className="pt-1">
          <button
            onClick={() => setShowRevoked(v => !v)}
            className="text-[10px] text-agro-muted hover:text-agro-text transition-colors flex items-center gap-1">
            {showRevoked ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showRevoked ? "Ocultar" : "Ver"} chaves revogadas ({revoked.length})
          </button>
          {showRevoked && (
            <div className="mt-2 space-y-1.5 opacity-50">
              {revoked.map(key => (
                <div key={key.id}
                  className="rounded-xl px-4 py-2.5 flex items-center gap-3"
                  style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(63,176,108,0.06)" }}>
                  <Key className="w-3.5 h-3.5 shrink-0 text-agro-muted-2" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-agro-muted line-through">{key.name}</p>
                    <code className="text-[10px] font-mono text-agro-muted-2">{key.key_prefix}</code>
                  </div>
                  <span className="text-[9px] text-agro-muted-2">revogada {fmtDate(key.revoked_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <CreateKeyModal
          workspaceId={wsId}
          onCreated={(key) => {
            setKeys(prev => [key, ...prev]);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
