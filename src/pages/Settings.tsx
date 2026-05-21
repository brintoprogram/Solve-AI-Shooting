import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  RefreshCw, CheckCircle, XCircle, Copy, Wifi, Settings2,
  Terminal, ExternalLink, ChevronDown, ChevronUp, User, Shield,
  Mail, Trash2, Send, LogIn, Zap, Camera, Check, Loader2,
  QrCode, Smartphone, Plus, Pencil, LayoutTemplate, GitBranch, Rocket, Sparkles, KeyRound,
} from "lucide-react";
import { ALL_CONTACT_FIELDS } from "@/lib/contactFields";
import { useContactFields }   from "@/hooks/useContactFields";
import { SettingsDepartments } from "@/pages/settings/SettingsDepartments";
import { DemoSeeder }          from "@/pages/settings/DemoSeeder";
import { ApiKeysManager }      from "@/pages/settings/ApiKeysManager";
import { Topbar }              from "@/components/layout/Topbar";
import { useAuth, ROLE_LABELS, ROLE_STYLE, initials, hasPermission } from "@/context/AuthContext";
import { useMetaConnections }  from "@/hooks/useMetaConnection";
import { useZApiConnections }  from "@/hooks/useZApiConnections";
import type { ZApiConnection } from "@/hooks/useZApiConnections";
import type { MetaConnection }  from "@/types/shooting";
import { getPhoneNumberInfo }  from "@/services/metaApi";
import { useToast }            from "@/hooks/use-toast";
import { cn }                  from "@/lib/utils";
import { supabase }            from "@/lib/supabase";

// Supabase ref via env var (set in Vercel → Settings → Environment Variables)
const SUPABASE_URL  = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
const SUPABASE_REF  = SUPABASE_URL
  ? SUPABASE_URL.replace("https://", "").split(".supabase.co")[0]
  : "SEU_PROJECT_REF";

const WEBHOOK_URL           = `https://${SUPABASE_REF}.supabase.co/functions/v1/meta-webhook`;
const CHATWOOT_VERIFY_TOKEN = "73c0163c89186e2fb98921d14d8d1ec4";

// ── Shared sub-components ─────────────────────────────────────────

function DarkCard({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode
}) {
  return (
    <div
      className="rounded-2xl p-6 space-y-5"
      style={{ background: "rgba(13,26,17,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(63,176,108,0.1)" }}
    >
      <div>
        <h2 className="text-base font-semibold text-agro-text">{title}</h2>
        {subtitle && <p className="text-sm text-agro-muted mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-1.5">{children}</p>
  );
}

function ReadonlyField({ value, onCopy }: { value: string; onCopy: () => void }) {
  return (
    <div className="flex gap-2">
      <input className="input-agro flex-1 font-mono text-xs" value={value} readOnly />
      <button
        onClick={onCopy}
        className="w-10 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors shrink-0"
        style={{ border: "1px solid rgba(63,176,108,0.15)", background: "rgba(13,26,17,0.6)" }}
      >
        <Copy className="w-4 h-4" />
      </button>
    </div>
  );
}

function CodeBlock({ code, onCopy }: { code: string; onCopy: () => void }) {
  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{ background: "rgba(8,16,10,0.95)", border: "1px solid rgba(63,176,108,0.12)" }}
    >
      <pre className="text-xs font-mono text-agro-muted p-4 overflow-x-auto scrollbar-thin leading-relaxed whitespace-pre">
        {code}
      </pre>
      <button
        onClick={onCopy}
        className="absolute top-2 right-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium text-agro-muted hover:text-agro-text transition-colors"
        style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.15)" }}
      >
        <Copy className="w-3 h-3" /> Copiar
      </button>
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <div
      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white"
      style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
    >
      {n}
    </div>
  );
}

// ── Reconnect Modal ───────────────────────────────────────────────

function ReconnectModal({ conn, onClose, onSaved }: {
  conn:    MetaConnection;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast }                         = useToast();
  const [wabaId,      setWabaId]          = useState(conn.waba_id      ?? "");
  const [phoneNumId,  setPhoneNumId]      = useState(conn.phone_number_id ?? "");
  const [accessToken, setAccessToken]     = useState("");
  const [testing,     setTesting]         = useState(false);
  const [saving,      setSaving]          = useState(false);
  const [testResult,  setTestResult]      = useState<{ ok: boolean; info?: string } | null>(null);

  async function handleTest() {
    if (!phoneNumId || !accessToken) return;
    setTesting(true);
    setTestResult(null);
    try {
      const info = await getPhoneNumberInfo(phoneNumId, accessToken);
      setTestResult({ ok: true, info: `${info.verified_name} · ${info.display_phone_number} · ${info.quality_rating}` });
    } catch (err) {
      setTestResult({ ok: false, info: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!wabaId || !phoneNumId || !accessToken) return;
    setSaving(true);
    try {
      const phoneInfo = await getPhoneNumberInfo(phoneNumId, accessToken);
      const { error: err } = await supabase
        .from("meta_connections")
        .update({
          waba_id:         wabaId,
          phone_number_id: phoneNumId,
          access_token:    accessToken,
          display_phone:   phoneInfo.display_phone_number,
          business_name:   phoneInfo.verified_name,
          quality_rating:  (phoneInfo.quality_rating as "GREEN" | "YELLOW" | "RED") ?? null,
          messaging_limit: (phoneInfo.messaging_limit_tier as "TIER_1K" | "TIER_10K" | "TIER_100K" | "UNLIMITED") ?? null,
          status:          "active",
          updated_at:      new Date().toISOString(),
        })
        .eq("id", conn.id);
      if (err) throw err;
      toast({ title: "Conexão atualizada com sucesso!", variant: "success" });
      onSaved();
      onClose();
    } catch (err) {
      console.error("[reconnect] save:", err);
      toast({ title: "Não foi possível reconectar", description: "Verifique os dados e tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl p-6 space-y-4"
        style={{ background: "#0d1710", border: "1px solid rgba(63,176,108,0.2)", boxShadow: "0 32px 80px rgba(0,0,0,0.7)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.2)" }}>
              <RefreshCw className="w-4 h-4 text-agro-green" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-agro-text">Reconectar WhatsApp</h2>
              <p className="text-[11px] text-agro-muted-2">{conn.display_phone ?? conn.phone_number_id}</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors">
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          <div>
            <FieldLabel>WABA ID</FieldLabel>
            <input className="input-agro w-full" placeholder="123456789012345"
              value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Phone Number ID</FieldLabel>
            <input className="input-agro w-full" placeholder="100123456789012"
              value={phoneNumId} onChange={(e) => setPhoneNumId(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Access Token *</FieldLabel>
            <input className="input-agro w-full" type="password" placeholder="EAAxxxxxxxxx…"
              value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
            <p className="text-xs text-agro-muted mt-1.5">Use um System User Token permanente, não um token temporário.</p>
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div className="flex items-start gap-3 p-3 rounded-xl"
            style={testResult.ok
              ? { background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.25)" }
              : { background: "rgba(239,68,68,0.08)",  border: "1px solid rgba(239,68,68,0.25)"  }}
          >
            {testResult.ok
              ? <CheckCircle className="w-4 h-4 text-agro-green shrink-0 mt-0.5" />
              : <XCircle    className="w-4 h-4 text-red-400 shrink-0 mt-0.5"    />
            }
            <div>
              <p className={cn("text-sm font-semibold", testResult.ok ? "text-agro-green" : "text-red-400")}>
                {testResult.ok ? "Conexão validada!" : "Falha na conexão"}
              </p>
              <p className="text-xs text-agro-muted mt-0.5">{testResult.info}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button onClick={handleTest} disabled={!phoneNumId || !accessToken || testing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors disabled:opacity-50"
            style={{ border: "1px solid rgba(63,176,108,0.2)" }}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", testing && "animate-spin")} />
            {testing ? "Testando…" : "Testar"}
          </button>
          <button onClick={handleSave} disabled={!wabaId || !phoneNumId || !accessToken || saving}
            className="flex-1 btn-agro flex items-center justify-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Z-API Add/Edit Modal ──────────────────────────────────────────

function ZApiAddModal({ workspaceId, onClose, onSaved }: {
  workspaceId: string;
  onClose:     () => void;
  onSaved:     () => void;
}) {
  const { toast }                      = useToast();
  const [name,        setName]         = useState("");
  const [instanceId,  setInstanceId]   = useState("");
  const [token,       setToken]        = useState("");
  const [clientToken, setClientToken]  = useState("");
  const [saving,      setSaving]       = useState(false);

  async function handleSave() {
    if (!name || !instanceId || !token || !clientToken) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("z-api-proxy", {
        body: { action: "save", workspace_id: workspaceId, name, instance_id: instanceId, token, client_token: clientToken },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "Erro ao salvar");
      toast({ title: "Conexão Z-API salva!", variant: "success" });
      onSaved();
      onClose();
    } catch (err) {
      toast({ title: "Não foi possível salvar", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-4"
        style={{ background: "#0d1710", border: "1px solid rgba(63,176,108,0.2)", boxShadow: "0 32px 80px rgba(0,0,0,0.7)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.2)" }}>
              <Smartphone className="w-4 h-4 text-agro-green" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-agro-text">Adicionar Conexão Z-API</h2>
              <p className="text-[11px] text-agro-muted-2">Insira as credenciais da instância</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors">
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <FieldLabel>Nome da conexão *</FieldLabel>
            <input className="input-agro w-full" placeholder="Ex: Meu Número Principal" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Instance ID *</FieldLabel>
            <input className="input-agro w-full font-mono" placeholder="3D14B9F66E30" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Token *</FieldLabel>
            <input className="input-agro w-full font-mono" type="password" placeholder="xxxxxxxxxxxxxxx" value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Client-Token *</FieldLabel>
            <input className="input-agro w-full font-mono" type="password" placeholder="Fxxxxxxxxxxxxxxx" value={clientToken} onChange={(e) => setClientToken(e.target.value)} />
            <p className="text-xs text-agro-muted mt-1.5">Encontre esses valores no painel da Z-API em "Instâncias".</p>
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors" style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!name || !instanceId || !token || !clientToken || saving}
            className="flex-1 btn-agro flex items-center justify-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Z-API QR Code Modal ───────────────────────────────────────────

function ZApiQrModal({ conn, onClose, onConnected }: {
  conn:        ZApiConnection;
  onClose:     () => void;
  onConnected: () => void;
}) {
  const { toast }                                = useToast();
  const [qrcode,   setQrcode]                   = useState<string | null>(null);
  const [loadingQr, setLoadingQr]               = useState(false);
  const [polling,   setPolling]                 = useState(false);

  async function fetchQr() {
    setLoadingQr(true);
    try {
      const { data, error } = await supabase.functions.invoke("z-api-proxy", {
        body: { action: "qrcode", connection_id: conn.id },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "Erro ao buscar QR");
      setQrcode(data.qrcode as string);
    } catch (err) {
      toast({ title: "Não foi possível carregar o QR Code", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setLoadingQr(false);
    }
  }

  async function checkStatus(): Promise<boolean> {
    try {
      const { data } = await supabase.functions.invoke("z-api-proxy", {
        body: { action: "status", connection_id: conn.id },
      });
      return data?.connected === true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    fetchQr();
    setPolling(true);

    const interval = setInterval(async () => {
      const connected = await checkStatus();
      if (connected) {
        clearInterval(interval);
        setPolling(false);
        toast({ title: "WhatsApp conectado!", variant: "success" });
        onConnected();
        onClose();
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      setPolling(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 space-y-4"
        style={{ background: "#0d1710", border: "1px solid rgba(63,176,108,0.2)", boxShadow: "0 32px 80px rgba(0,0,0,0.7)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.2)" }}>
              <QrCode className="w-4 h-4 text-agro-green" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-agro-text">Escanear QR Code</h2>
              <p className="text-[11px] text-agro-muted-2">{conn.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors">
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div
          className="flex items-center justify-center rounded-xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.96)", aspectRatio: "1", minHeight: 240 }}
        >
          {loadingQr ? (
            <Loader2 className="w-8 h-8 text-agro-green animate-spin" />
          ) : qrcode ? (
            <img src={`data:image/png;base64,${qrcode}`} alt="QR Code WhatsApp" className="w-full h-full object-contain p-2" />
          ) : (
            <p className="text-sm text-gray-400">QR Code indisponível</p>
          )}
        </div>

        <div className="text-center space-y-2">
          {polling && (
            <div className="flex items-center justify-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-agro-green animate-pulse" />
              <p className="text-xs text-agro-muted">Aguardando conexão…</p>
            </div>
          )}
          <p className="text-[11px] text-agro-muted-2">Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo</p>
        </div>

        <button
          onClick={fetchQr}
          disabled={loadingQr}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors disabled:opacity-50"
          style={{ border: "1px solid rgba(63,176,108,0.2)" }}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loadingQr && "animate-spin")} />
          Atualizar QR Code
        </button>
      </div>
    </div>
  );
}

// ── Z-API Webhook URL display ─────────────────────────────────────

function ZApiWebhookUrlBox({ supabaseRef }: { supabaseRef: string }) {
  const [copied, setCopied] = useState(false);
  const url = `https://${supabaseRef}.supabase.co/functions/v1/z-api-webhook`;

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
      style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.15)" }}
    >
      <code className="flex-1 text-[11px] font-mono text-agro-text truncate">{url}</code>
      <button
        onClick={handleCopy}
        className="shrink-0 p-1 rounded-lg text-agro-muted hover:text-agro-green transition-colors"
        title="Copiar URL"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-agro-green" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ── Settings page ─────────────────────────────────────────────────

export function Settings() {
  const navigate                           = useNavigate();
  const { profile, workspaceId, updateProfile } = useAuth();
  const WORKSPACE_ID = workspaceId ?? "";
  const { connections, upsertConnection, refetch: refetchConnections } = useMetaConnections(WORKSPACE_ID);
  const [reconnectTarget, setReconnectTarget] = useState<MetaConnection | null>(null);
  const { toast }                          = useToast();

  const [settingsTab, setSettingsTab] = useState<"perfil"|"whatsapp"|"email"|"ia"|"avancado"|"disparo"|"demo"|"api">("perfil");
  const { visibleFields, saveVisibleFields } = useContactFields(WORKSPACE_ID);
  const [localFields, setLocalFields]        = useState<string[]>([]);
  const [savingFields, setSavingFields]      = useState(false);

  const [form, setForm]           = useState({ waba_id: "", phone_number_id: "", access_token: "", webhook_verify_token: crypto.randomUUID() });
  const [testing,  setTesting]    = useState(false);
  const [saving,   setSaving]     = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; info?: string } | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);

  // ── Profile editing state ─────────────────────────────────────────
  const [profileForm,    setProfileForm]    = useState({ name: "", description: "" });
  const [avatarFile,     setAvatarFile]     = useState<File | null>(null);
  const [avatarPreview,  setAvatarPreview]  = useState<string | null>(null);
  const [profileSaving,  setProfileSaving]  = useState(false);

  useEffect(() => {
    if (!profile) return;
    setProfileForm({ name: profile.full_name ?? "", description: profile.description ?? "" });
    setAvatarPreview(null);
    setAvatarFile(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleProfileSave() {
    if (!profile) return;
    setProfileSaving(true);

    // 1. Try avatar upload separately — non-fatal
    let newAvatarUrl = profile.avatar_url ?? null;
    let avatarUploadError: string | null = null;

    if (avatarFile) {
      try {
        const path = `${profile.id}/avatar`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
        if (uploadError) throw new Error(uploadError.message);
        const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
        newAvatarUrl = `${publicUrl}?t=${Date.now()}`;
      } catch (err) {
        avatarUploadError = err instanceof Error ? err.message : "Erro ao salvar foto";
      }
    }

    // 2. Always save text fields (name + description + avatar if upload succeeded)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("user_profiles")
        .update({
          full_name:   profileForm.name.trim()        || null,
          description: profileForm.description.trim() || null,
          avatar_url:  newAvatarUrl,
        })
        .eq("id", profile.id);

      if (error) throw new Error(error.message);

      updateProfile({
        full_name:   profileForm.name.trim()        || null,
        description: profileForm.description.trim() || null,
        avatar_url:  newAvatarUrl,
      });

      setAvatarFile(null);
      setAvatarPreview(null);

      if (avatarUploadError) {
        console.error("[profile] avatar upload:", avatarUploadError);
        toast({
          title:       "Perfil salvo — foto não atualizada",
          description: "Não foi possível salvar a foto. Tente novamente ou use uma imagem menor.",
          variant:     "destructive",
        });
      } else {
        toast({ title: "Perfil atualizado!", variant: "success" });
      }
    } catch (err) {
      console.error("[profile] save:", err);
      toast({ title: "Não foi possível salvar o perfil", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setProfileSaving(false);
    }
  }

  // ── Email connections state ──────────────────────────────────────
  type EmailConn = {
    id: string; name: string; provider: string;
    host: string; port: number; secure: boolean; username: string;
    from_name: string; from_email: string;
    tenant_id: string | null; client_id: string | null;
  };
  const [emailConns, setEmailConns]       = useState<EmailConn[]>([]);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailForm, setEmailForm]         = useState({
    name: "", provider: "smtp" as "smtp" | "graph" | "oauth2",
    host: "", port: "587", secure: false, username: "", password: "",
    tenant_id: "", client_id: "",
    from_name: "", from_email: "",
  });
  const [emailTesting, setEmailTesting]   = useState(false);
  const [emailSaving,  setEmailSaving]    = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<{ ok: boolean; info?: string } | null>(null);

  // ── Support email state ───────────────────────────────────────────
  const [supportEmail,        setSupportEmail]        = useState("");
  const [supportEmailSaving,  setSupportEmailSaving]  = useState(false);

  useEffect(() => {
    if (!WORKSPACE_ID) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from("workspaces").select("support_email").eq("id", WORKSPACE_ID).maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: any) => { if (data?.support_email) setSupportEmail(data.support_email); });
  }, [WORKSPACE_ID]);

  async function handleSupportEmailSave() {
    if (!WORKSPACE_ID || !supportEmail.trim()) return;
    setSupportEmailSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("workspaces").update({ support_email: supportEmail.trim() }).eq("id", WORKSPACE_ID);
    if (error) {
      toast({ title: "Não foi possível salvar o email de suporte", variant: "destructive" });
    } else {
      toast({ title: "Email de suporte salvo!", variant: "success" });
    }
    setSupportEmailSaving(false);
  }

  // ── Z-API connections state ───────────────────────────────────────
  const { connections: zApiConnections, deleteConnection: deleteZApiConnection, refetch: refetchZApi } =
    useZApiConnections(WORKSPACE_ID);
  const [showZApiAdd,  setShowZApiAdd]  = useState(false);
  const [zApiQrTarget, setZApiQrTarget] = useState<ZApiConnection | null>(null);


  // ── AI Provider state ─────────────────────────────────────────────
  const [aiProvider,       setAiProvider]       = useState<"anthropic" | "openai">("anthropic");
  const [anthropicKey,     setAnthropicKey]     = useState("");
  const [openaiKey,        setOpenaiKey]        = useState("");
  const [anthropicKeySet,  setAnthropicKeySet]  = useState(false);
  const [openaiKeySet,     setOpenaiKeySet]     = useState(false);
  const [aiSaving,         setAiSaving]         = useState(false);

  const loadEmailConns = useCallback(() => {
    supabase
      .from("email_connections")
      .select("id,name,provider,host,port,secure,username,from_name,from_email,tenant_id,client_id")
      .eq("workspace_id", WORKSPACE_ID)
      .order("created_at", { ascending: true })
      .then(({ data }) => { if (data) setEmailConns(data as EmailConn[]); });
  }, []);

  // Initial load + handle OAuth2 callback redirect
  useEffect(() => {
    loadEmailConns();

    const params = new URLSearchParams(window.location.search);
    if (params.get("ms_oauth_success") === "1") {
      toast({ title: "Microsoft conectado!", description: "A conexão OAuth2 foi adicionada com sucesso.", variant: "success" });
      loadEmailConns();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("ms_oauth_error")) {
      toast({ title: "Erro ao conectar com Microsoft", description: decodeURIComponent(params.get("ms_oauth_error")!), variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // ── Load AI settings ─────────────────────────────────────────────
  useEffect(() => {
    if (!WORKSPACE_ID) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("workspaces")
      .select("ai_provider, anthropic_api_key, openai_api_key")
      .eq("id", WORKSPACE_ID)
      .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: any) => {
        if (!data) return;
        setAiProvider(data.ai_provider ?? "anthropic");
        setAnthropicKeySet(!!data.anthropic_api_key);
        setOpenaiKeySet(!!data.openai_api_key);
      });
  }, [WORKSPACE_ID]);

  async function handleAiSave() {
    if (!WORKSPACE_ID) return;
    setAiSaving(true);
    const updates: Record<string, unknown> = { ai_provider: aiProvider };
    if (anthropicKey.trim()) updates.anthropic_api_key = anthropicKey.trim();
    if (openaiKey.trim())    updates.openai_api_key    = openaiKey.trim();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("workspaces").update(updates).eq("id", WORKSPACE_ID);
    if (error) {
      console.error("[ai] save:", error);
      toast({ title: "Não foi possível salvar as configurações de IA", description: "Tente novamente.", variant: "destructive" });
    } else {
      if (anthropicKey.trim()) { setAnthropicKeySet(true); setAnthropicKey(""); }
      if (openaiKey.trim())    { setOpenaiKeySet(true);    setOpenaiKey(""); }
      toast({ title: "Configurações de IA salvas!", variant: "success" });
    }
    setAiSaving(false);
  }

  const emailFormValid = emailForm.provider === "graph"
    ? !!(emailForm.name && emailForm.tenant_id && emailForm.client_id && emailForm.password && emailForm.from_email)
    : emailForm.provider === "oauth2"
    ? !!(emailForm.name && emailForm.client_id && emailForm.password && emailForm.from_email)
    : !!(emailForm.name && emailForm.host && emailForm.username && emailForm.password && emailForm.from_email);

  const emailTestValid = emailForm.provider === "graph"
    ? !!(emailForm.tenant_id && emailForm.client_id && emailForm.password && emailForm.from_email)
    : emailForm.provider === "oauth2"
    ? false // OAuth2 uses browser redirect, not API test
    : !!(emailForm.host && emailForm.username && emailForm.password);

  async function handleEmailTest() {
    setEmailTesting(true);
    setEmailTestResult(null);

    if (!SUPABASE_URL) {
      setEmailTestResult({ ok: false, info: "VITE_SUPABASE_URL não configurada. Verifique as variáveis de ambiente." });
      setEmailTesting(false);
      return;
    }

    const endpoint = `${SUPABASE_URL}/functions/v1/test-email-connection`;

    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 30_000);

      let res: Response;
      try {
        res = await fetch(endpoint, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          signal:  controller.signal,
          body: JSON.stringify({
            provider:    emailForm.provider,
            host:        emailForm.host,
            port:        Number(emailForm.port),
            secure:      emailForm.secure,
            username:    emailForm.username,
            password:    emailForm.password,
            tenant_id:   emailForm.tenant_id,
            client_id:   emailForm.client_id,
            from_name:   emailForm.from_name,
            from_email:  emailForm.from_email,
            workspace_id: WORKSPACE_ID,
          }),
        });
        clearTimeout(timeout);
      } catch (fetchErr) {
        clearTimeout(timeout);
        const isAbort = fetchErr instanceof DOMException && fetchErr.name === "AbortError";
        throw new Error(
          isAbort
            ? "Tempo limite excedido (30s). A função pode estar em cold start ou o servidor não respondeu."
            : `Falha de rede ao chamar ${endpoint}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
        );
      }

      let data: { ok?: boolean; error?: string };
      try {
        data = await res.json();
      } catch {
        throw new Error(`Resposta inválida do servidor (HTTP ${res.status} ${res.statusText})`);
      }

      if (data.ok) {
        setEmailTestResult({ ok: true, info: "Email de teste enviado com sucesso!" });
      } else {
        setEmailTestResult({ ok: false, info: data.error ?? `Erro HTTP ${res.status}` });
      }
    } catch (err) {
      setEmailTestResult({ ok: false, info: err instanceof Error ? err.message : String(err) });
    } finally {
      setEmailTesting(false);
    }
  }

  function handleMicrosoftOAuth() {
    const state = btoa(JSON.stringify({
      workspace_id:  WORKSPACE_ID,
      name:          emailForm.name,
      from_name:     emailForm.from_name,
      from_email:    emailForm.from_email,
      tenant_id:     emailForm.tenant_id,
      client_id:     emailForm.client_id,
      client_secret: emailForm.password,
      frontend_url:  window.location.origin,
    }));

    const tenant   = emailForm.tenant_id || "common";
    const redirect = `${SUPABASE_URL}/functions/v1/ms-oauth-callback`;
    const authUrl  = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?` + new URLSearchParams({
      client_id:     emailForm.client_id,
      response_type: "code",
      redirect_uri:  redirect,
      scope:         "https://graph.microsoft.com/Mail.Send offline_access",
      state,
    }).toString();

    window.location.href = authUrl;
  }

  async function handleEmailSave() {
    setEmailSaving(true);
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke("save-email-connection", {
        body: {
          workspace_id: WORKSPACE_ID,
          name:         emailForm.name,
          provider:     emailForm.provider,
          host:         emailForm.provider === "smtp" ? emailForm.host         : "",
          port:         emailForm.provider === "smtp" ? Number(emailForm.port) : 0,
          secure:       emailForm.provider === "smtp" ? emailForm.secure       : false,
          username:     emailForm.provider === "smtp" ? emailForm.username     : emailForm.from_email,
          password:     emailForm.password,
          tenant_id:    emailForm.provider === "graph" ? emailForm.tenant_id  : null,
          client_id:    emailForm.provider === "graph" ? emailForm.client_id  : null,
          from_name:    emailForm.from_name,
          from_email:   emailForm.from_email,
        },
      });

      if (fnError || !fnData?.ok) throw new Error(fnData?.error ?? fnError?.message ?? "Erro ao salvar");
      const data = fnData.data;
      setEmailConns((prev) => [...prev, data as EmailConn]);
      setEmailForm({ name: "", provider: "smtp" as "smtp" | "graph" | "oauth2", host: "", port: "587", secure: false, username: "", password: "", tenant_id: "", client_id: "", from_name: "", from_email: "" });
      setEmailTestResult(null);
      setShowEmailForm(false);
      toast({ title: "Conexão de email salva!", variant: "success" });
    } catch (err) {
      console.error("[email] save:", err);
      toast({ title: "Não foi possível salvar a conexão de email", description: "Verifique os dados e tente novamente.", variant: "destructive" });
    } finally {
      setEmailSaving(false);
    }
  }

  async function handleEmailDelete(id: string) {
    await supabase.from("email_connections").delete().eq("id", id);
    setEmailConns((prev) => prev.filter((c) => c.id !== id));
    toast({ title: "Conexão removida" });
  }

  function copy(text: string, label = "Copiado!") {
    navigator.clipboard.writeText(text);
    toast({ title: label });
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const info = await getPhoneNumberInfo(form.phone_number_id, form.access_token);
      setTestResult({
        ok:   true,
        info: `${info.verified_name} · ${info.display_phone_number} · ${info.quality_rating}`,
      });
    } catch (err) {
      setTestResult({ ok: false, info: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const phoneInfo = await getPhoneNumberInfo(form.phone_number_id, form.access_token);
      await upsertConnection({
        workspace_id:         WORKSPACE_ID,
        waba_id:              form.waba_id,
        phone_number_id:      form.phone_number_id,
        display_phone:        phoneInfo.display_phone_number,
        business_name:        phoneInfo.verified_name,
        access_token:         form.access_token,
        token_expires_at:     null,
        webhook_verify_token: form.webhook_verify_token,
        status:               "active",
        quality_rating:       (phoneInfo.quality_rating as "GREEN" | "YELLOW" | "RED") ?? null,
        messaging_limit:      (phoneInfo.messaging_limit_tier as "TIER_1K" | "TIER_10K" | "TIER_100K" | "UNLIMITED") ?? null,
      });
      toast({ title: "Conexão salva com sucesso!", variant: "success" });
      setForm({ waba_id: "", phone_number_id: "", access_token: "", webhook_verify_token: crypto.randomUUID() });
      setTestResult(null);
    } catch (err) {
      console.error("[whatsapp] save:", err);
      toast({
        title:       "Não foi possível salvar a conexão",
        description: "Verifique os dados da API e tente novamente.",
        variant:     "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const QUALITY_COLOR: Record<string, string> = {
    GREEN:  "rgba(63,176,108,0.1)",
    YELLOW: "rgba(245,158,11,0.1)",
    RED:    "rgba(239,68,68,0.1)",
  };
  const QUALITY_TEXT: Record<string, string> = {
    GREEN:  "#3fb06c",
    YELLOW: "#fbbf24",
    RED:    "#f87171",
  };

  const cmd_deploy = `# 1. Instale o CLI e autentique (se ainda não fez)
npm install -g supabase
supabase login

# 2. Vincule o projeto (rode na pasta do projeto)
supabase link --project-ref ${SUPABASE_REF}

# 3. Publique as Edge Functions
supabase functions deploy meta-webhook
supabase functions deploy send-inbox-message
supabase functions deploy campaign-engine
supabase functions deploy email-engine
supabase functions deploy test-email-connection
supabase functions deploy ms-oauth-callback
supabase functions deploy embedded-signup
supabase functions deploy invite-user
supabase functions deploy analyze-reply

# 4. Configure a chave da IA (necessário para alertas de resposta)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-COLOQUE_SUA_CHAVE_AQUI`;

  const sql_workspaces = `-- Multi-tenant: workspaces, membros e convites
CREATE TABLE IF NOT EXISTS workspaces (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE workspaces DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS workspace_members (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  role         TEXT NOT NULL DEFAULT 'agent',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);
ALTER TABLE workspace_members DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS workspace_invites (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL,
  role         TEXT        NOT NULL DEFAULT 'agent',
  token        TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  invited_by   UUID        NOT NULL,
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE workspace_invites DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email
  ON workspace_invites(email, accepted_at) WHERE accepted_at IS NULL;`;

  const sql_audit_logs = `-- Tabela de auditoria estruturada (webhook, disparos, erros, retries)
CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id TEXT        NOT NULL,
  event_type   TEXT        NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  status       TEXT        NOT NULL DEFAULT 'info',
  error        TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace
  ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs(entity_id) WHERE entity_id IS NOT NULL;`;

  const sql_bucket = `-- Bucket para mídias do Inbox (50 MB por arquivo)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('inbox_media', 'inbox_media', true, 52428800)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "inbox_media_select" ON storage.objects;
CREATE POLICY "inbox_media_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'inbox_media');

DROP POLICY IF EXISTS "inbox_media_insert" ON storage.objects;
CREATE POLICY "inbox_media_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'inbox_media');

DROP POLICY IF EXISTS "inbox_media_delete" ON storage.objects;
CREATE POLICY "inbox_media_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'inbox_media');`;

  const sql_profile = `-- Campos de perfil e bucket de fotos
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS avatar_url  TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('avatars', 'avatars', true, 5242880)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars_select" ON storage.objects;
CREATE POLICY "avatars_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_insert" ON storage.objects;
CREATE POLICY "avatars_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_update" ON storage.objects;
CREATE POLICY "avatars_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_delete" ON storage.objects;
CREATE POLICY "avatars_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'avatars');`;

  const rs        = profile ? ROLE_STYLE[profile.role]  : null;
  const roleLabel = profile ? ROLE_LABELS[profile.role] : null;
  const displayAvatar = avatarPreview ?? profile?.avatar_url ?? null;

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Configurações" }]} />

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* ── Header ──────────────────────────── */}
        <div className="animate-fade-up">
          <h1 className="font-display text-2xl font-bold text-agro-text">Configurações</h1>
          <p className="text-agro-muted mt-1 text-sm">Perfil, conexões e integrações</p>
        </div>

        {/* ── Tab bar (admin only) ─────────────── */}
        {hasPermission(profile, "can_settings") && (() => {
          const TABS: { id: typeof settingsTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
            { id: "perfil",    label: "Perfil",    icon: User       },
            { id: "whatsapp",  label: "WhatsApp",  icon: Smartphone },
            { id: "email",     label: "Email",     icon: Mail       },
            { id: "ia",        label: "IA",        icon: Zap        },
            { id: "disparo",   label: "Disparo",   icon: Rocket     },
            { id: "avancado",  label: "Avançado",  icon: Terminal   },
            { id: "demo",      label: "Demo",      icon: Sparkles   },
            { id: "api",       label: "API",        icon: KeyRound   },
          ];
          return (
            <div
              className="flex gap-1 p-1 rounded-2xl overflow-x-auto scrollbar-none"
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(63,176,108,0.1)" }}
            >
              {TABS.map((tab) => {
                const isActive = settingsTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSettingsTab(tab.id)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0"
                    style={isActive
                      ? { background: "rgba(63,176,108,0.18)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }
                      : { color: "#6b8a75", background: "transparent", border: "1px solid transparent" }
                    }
                  >
                    <tab.icon className="w-3.5 h-3.5 shrink-0" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* ── Meu Perfil ───────────────────────── */}
        {(settingsTab === "perfil" || !hasPermission(profile, "can_settings")) && <div className="animate-fade-up">
          <DarkCard title="Meu Perfil" subtitle="Informações da sua conta">
            <div className="space-y-5">

              {/* Avatar + nome */}
              <div className="flex items-start gap-5">
                {/* Avatar clicável */}
                <div className="relative group shrink-0">
                  {displayAvatar ? (
                    <img
                      src={displayAvatar}
                      alt="Avatar"
                      className="w-16 h-16 rounded-2xl object-cover"
                      style={{ border: "1px solid rgba(63,176,108,0.25)" }}
                    />
                  ) : (
                    <div
                      className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-lg"
                      style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
                    >
                      {initials(profileForm.name || profile?.full_name)}
                    </div>
                  )}
                  <label
                    htmlFor="avatar-upload"
                    className="absolute inset-0 rounded-2xl flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "rgba(0,0,0,0.55)" }}
                    title="Alterar foto"
                  >
                    <Camera className="w-5 h-5 text-white" />
                  </label>
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={handleAvatarChange}
                  />
                </div>

                {/* Nome + cargo */}
                <div className="flex-1 space-y-3 min-w-0">
                  <div>
                    <FieldLabel>Nome completo</FieldLabel>
                    <input
                      className="input-agro w-full"
                      value={profileForm.name}
                      onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                      placeholder="Seu nome"
                    />
                  </div>
                  {rs && roleLabel && (
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                      style={{ background: rs.bg, color: rs.color, border: `1px solid ${rs.border}` }}
                    >
                      <Shield className="w-3 h-3" />
                      {roleLabel}
                    </span>
                  )}
                </div>
              </div>

              {/* Descrição */}
              <div>
                <FieldLabel>Descrição / Bio</FieldLabel>
                <textarea
                  className="input-agro w-full resize-none text-sm"
                  rows={3}
                  value={profileForm.description}
                  onChange={(e) => setProfileForm({ ...profileForm, description: e.target.value })}
                  placeholder="Fale um pouco sobre você ou seu papel na equipe…"
                  maxLength={280}
                  style={{ lineHeight: "1.5" }}
                />
                <p className="text-[11px] text-agro-muted-2 mt-1 text-right">
                  {profileForm.description.length}/280
                </p>
              </div>

              <button
                onClick={handleProfileSave}
                disabled={profileSaving}
                className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              >
                {profileSaving
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Check className="w-4 h-4" />
                }
                {profileSaving ? "Salvando…" : "Salvar perfil"}
              </button>
            </div>
          </DarkCard>
        </div>}

        {/* ── Sections visíveis apenas para admin ───────────── */}
        {hasPermission(profile, "can_settings") ? (<>

        {/* ══ Tab: WhatsApp ══════════════════════════════════ */}
        {settingsTab === "whatsapp" && <>

        {/* ── Conexões ativas ─────────────────── */}
        {connections.length > 0 && (
          <div className="animate-fade-up-delay-1">
            <DarkCard title="Conexões WhatsApp ativas">
              <div className="space-y-3">
                {connections.map((conn) => {
                  const qColor = QUALITY_COLOR[conn.quality_rating ?? ""] ?? "rgba(107,114,128,0.1)";
                  const qText  = QUALITY_TEXT[conn.quality_rating  ?? ""] ?? "#9ca3af";
                  return (
                    <div
                      key={conn.id}
                      className="rounded-xl overflow-hidden"
                      style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.08)" }}
                    >
                      <div className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            <Wifi className={cn("w-5 h-5", conn.status === "active" ? "text-agro-green" : "text-red-400")} />
                            <span
                              className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#0d1710]"
                              style={{ background: conn.status === "active" ? "#3fb06c" : "#f87171" }}
                            />
                          </div>
                          <div>
                            <p className="font-semibold text-agro-text text-sm">{conn.display_phone}</p>
                            <p className="text-xs text-agro-muted">{conn.business_name} · WABA {conn.waba_id}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {conn.quality_rating && (
                            <span
                              className="px-2.5 py-1 rounded-full text-xs font-semibold"
                              style={{ background: qColor, color: qText, border: `1px solid ${qColor}` }}
                            >
                              {conn.quality_rating}
                            </span>
                          )}
                          {conn.messaging_limit && (
                            <span
                              className="px-2.5 py-1 rounded-full text-xs font-medium text-agro-muted"
                              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                            >
                              {conn.messaging_limit}
                            </span>
                          )}
                          <button
                            onClick={() => setReconnectTarget(conn)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-[#60a5fa] hover:bg-[#1a2a3a] transition-colors"
                            style={{ border: "1px solid rgba(59,130,246,0.3)" }}
                            title="Atualizar IDs e token da conexão Meta"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Reconectar
                          </button>
                        </div>
                      </div>
                      {conn.webhook_verify_token && (
                        <div
                          className="flex items-center gap-2 px-3 py-2"
                          style={{ borderTop: "1px solid rgba(63,176,108,0.06)" }}
                        >
                          <p className="text-[10px] text-agro-muted-2 uppercase tracking-widest shrink-0">Verify Token</p>
                          <p className="text-[11px] font-mono text-agro-muted flex-1 truncate">{conn.webhook_verify_token}</p>
                          <button
                            onClick={() => copy(conn.webhook_verify_token!, "Token copiado!")}
                            className="shrink-0 text-agro-muted-2 hover:text-agro-text transition-colors"
                            title="Copiar token"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </DarkCard>
          </div>
        )}

        {/* ── Adicionar conexão ────────────────── */}
        <div className="animate-fade-up-delay-1">
          <DarkCard
            title={connections.length > 0 ? "Adicionar nova conexão" : "Configurar conexão WhatsApp"}
            subtitle="Integre com a Cloud API da Meta (WhatsApp Business)"
          >
            <div className="space-y-4">
              {/* ── Embedded Signup option ── */}
              <div
                className="rounded-xl p-4 space-y-3"
                style={{ background: "rgba(24,119,242,0.06)", border: "1px solid rgba(24,119,242,0.2)" }}
              >
                <div>
                  <p className="text-sm font-semibold text-agro-text">Conectar com o Facebook</p>
                  <p className="text-xs text-agro-muted mt-1 leading-relaxed">
                    Opção recomendada. Faça login com sua conta Meta Business e selecione o número
                    — credenciais configuradas automaticamente com suporte a coexistência.
                  </p>
                </div>
                <button
                  onClick={() => navigate("/onboarding")}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #1877F2, #0d65d9)" }}
                >
                  <LogIn className="w-4 h-4" />
                  Iniciar conexão guiada
                </button>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: "rgba(63,176,108,0.1)" }} />
                <span className="text-xs text-agro-muted-2 uppercase tracking-widest">ou manual</span>
                <div className="flex-1 h-px" style={{ background: "rgba(63,176,108,0.1)" }} />
              </div>

              <div>
                <FieldLabel>WhatsApp Business Account ID (WABA ID) *</FieldLabel>
                <input
                  className="input-agro w-full"
                  placeholder="123456789012345"
                  value={form.waba_id}
                  onChange={(e) => setForm({ ...form, waba_id: e.target.value })}
                />
              </div>
              <div>
                <FieldLabel>Phone Number ID *</FieldLabel>
                <input
                  className="input-agro w-full"
                  placeholder="100123456789012"
                  value={form.phone_number_id}
                  onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
                />
              </div>
              <div>
                <FieldLabel>Access Token (System User Token) *</FieldLabel>
                <input
                  className="input-agro w-full"
                  type="password"
                  placeholder="EAAxxxxxxxxx..."
                  value={form.access_token}
                  onChange={(e) => setForm({ ...form, access_token: e.target.value })}
                />
                <p className="text-xs text-agro-muted mt-1.5">
                  Use um System User Token permanente, não um token temporário.
                </p>
              </div>

              <div>
                <FieldLabel>Webhook Verify Token (gerado automaticamente)</FieldLabel>
                <ReadonlyField
                  value={form.webhook_verify_token}
                  onCopy={() => copy(form.webhook_verify_token, "Token copiado!")}
                />
                <p className="text-xs text-agro-muted mt-1.5">
                  Copie este token e use-o no campo <strong className="text-agro-text">Verify Token</strong> ao configurar o webhook desta conexão no Meta for Developers.
                </p>
              </div>

              {testResult && (
                <div
                  className="flex items-start gap-3 p-3 rounded-xl"
                  style={testResult.ok
                    ? { background: "rgba(63,176,108,0.08)",  border: "1px solid rgba(63,176,108,0.25)"  }
                    : { background: "rgba(239,68,68,0.08)",   border: "1px solid rgba(239,68,68,0.25)"   }
                  }
                >
                  {testResult.ok
                    ? <CheckCircle className="w-4 h-4 text-agro-green shrink-0 mt-0.5" />
                    : <XCircle    className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  }
                  <div>
                    <p className={cn("text-sm font-semibold", testResult.ok ? "text-agro-green" : "text-red-400")}>
                      {testResult.ok ? "Conexão validada!" : "Falha na conexão"}
                    </p>
                    <p className="text-xs text-agro-muted mt-0.5">{testResult.info}</p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleTest}
                  disabled={!form.phone_number_id || !form.access_token || testing}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors disabled:opacity-50"
                  style={{ border: "1px solid rgba(63,176,108,0.2)" }}
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", testing && "animate-spin")} />
                  {testing ? "Testando…" : "Testar conexão"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!form.waba_id || !form.phone_number_id || !form.access_token || saving}
                  className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Settings2 className="w-4 h-4" />
                  {saving ? "Salvando…" : "Salvar conexão"}
                </button>
              </div>
            </div>
          </DarkCard>
        </div>

        {/* ── Conexões Z-API ───────────────────── */}
        <div className="animate-fade-up-delay-1">
          <DarkCard title="Conexões Z-API" subtitle="WhatsApp via API não-oficial (texto livre, sem templates)">

            {/* List */}
            {zApiConnections.length > 0 && (
              <div className="space-y-2">
                {zApiConnections.map((conn) => {
                  const statusColor =
                    conn.status === "connected"    ? { bg: "rgba(63,176,108,0.1)",  text: "#3fb06c",  dot: "#3fb06c"  } :
                    conn.status === "banned"       ? { bg: "rgba(239,68,68,0.1)",   text: "#f87171",  dot: "#f87171"  } :
                                                    { bg: "rgba(245,158,11,0.1)",   text: "#fbbf24",  dot: "#fbbf24"  };
                  const statusLabel =
                    conn.status === "connected"    ? "Conectado"    :
                    conn.status === "banned"       ? "Banido"       :
                                                    "Desconectado";
                  return (
                    <div
                      key={conn.id}
                      className="flex items-center gap-3 p-3 rounded-xl"
                      style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(63,176,108,0.08)" }}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.15)" }}>
                        <Smartphone className="w-3.5 h-3.5 text-agro-green" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-agro-text truncate">{conn.name}</p>
                        <p className="text-[11px] text-agro-muted-2 truncate">{conn.phone ?? conn.instance_id}</p>
                      </div>
                      <span
                        className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: statusColor.bg, color: statusColor.text }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor.dot }} />
                        {statusLabel}
                      </span>
                      <button
                        onClick={() => setZApiQrTarget(conn)}
                        title="Escanear QR Code"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-green hover:bg-agro-green/10 transition-colors shrink-0"
                        style={{ border: "1px solid rgba(63,176,108,0.15)" }}
                      >
                        <QrCode className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          const { error } = await deleteZApiConnection(conn.id);
                          if (error) {
                            toast({ title: "Erro ao remover conexão", description: error, variant: "destructive" });
                          } else {
                            toast({ title: "Conexão removida" });
                          }
                        }}
                        title="Remover conexão"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => setShowZApiAdd(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-agro-green hover:text-white hover:bg-agro-green/20 transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.25)" }}
            >
              <Smartphone className="w-3.5 h-3.5" />
              {zApiConnections.length > 0 ? "Adicionar outra conexão" : "Adicionar conexão Z-API"}
            </button>

            {/* Webhook URLs */}
            <div className="mt-5 space-y-3">
              <div>
                <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-1">
                  URLs de Webhook
                </p>
                <p className="text-xs text-agro-muted">
                  Cole estas URLs no painel da Z-API → <strong className="text-agro-text">sua instância → Webhooks</strong>. Use a mesma URL nos três campos abaixo.
                </p>
              </div>
              {[
                { label: "Ao Receber", hint: "Mensagens recebidas do cliente" },
                { label: "Ao Receber Status da Mensagem", hint: "Entregue, lido, falhou" },
                { label: "Ao Enviar", hint: "Confirmação de envio" },
              ].map(({ label, hint }) => (
                <div key={label}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-[11px] font-semibold text-agro-text">{label}</p>
                    <span className="text-[10px] text-agro-muted-2">· {hint}</span>
                  </div>
                  <ZApiWebhookUrlBox supabaseRef={SUPABASE_REF} />
                </div>
              ))}
            </div>
          </DarkCard>
        </div>

        </> /* end WhatsApp tab */}

        {/* ══ Tab: Disparo ══════════════════════════════════ */}
        {settingsTab === "disparo" && (() => {
          const groups = [...new Set(ALL_CONTACT_FIELDS.map((f) => f.group))];
          const fields = localFields.length > 0 ? localFields : visibleFields;
          function toggle(key: string) {
            setLocalFields((prev) => {
              const base = prev.length > 0 ? prev : visibleFields;
              return base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
            });
          }
          async function handleSave() {
            setSavingFields(true);
            const toSave = localFields.length > 0 ? localFields : visibleFields;
            await saveVisibleFields(toSave);
            setSavingFields(false);
            toast({ title: "Campos salvos", variant: "success" });
          }
          return (
            <div className="space-y-6 animate-fade-up">
              <DarkCard
                title="Campos visíveis no mapeamento de variáveis"
                subtitle="Selecione quais campos do contato aparecem como opção ao mapear variáveis em campanhas (Meta e Z-API)."
              >
                <div className="space-y-6">
                  {groups.map((group) => (
                    <div key={group}>
                      <p className="text-[10px] font-bold text-agro-muted-2 uppercase tracking-[0.1em] mb-3">{group}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {ALL_CONTACT_FIELDS.filter((f) => f.group === group).map((f) => {
                          const on = fields.includes(f.key);
                          return (
                            <label
                              key={f.key}
                              className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors"
                              style={{
                                background: on ? "rgba(63,176,108,0.08)" : "rgba(13,26,17,0.5)",
                                border: `1px solid ${on ? "rgba(63,176,108,0.25)" : "rgba(63,176,108,0.08)"}`,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggle(f.key)}
                                className="accent-agro-green w-4 h-4 shrink-0"
                              />
                              <span className="flex-1 text-sm text-agro-text">{f.label}</span>
                              <span className="font-mono text-[10px] text-agro-muted-2">{f.key}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleSave}
                  disabled={savingFields}
                  className="btn-agro flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                >
                  {savingFields ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Salvar campos
                </button>
              </DarkCard>
            </div>
          );
        })()}

        {/* ══ Tab: Avançado (Deploy) ═════════════════════════ */}
        {settingsTab === "avancado" && <>

        {/* ── Deploy & Storage ────────────────── */}
        <div className="animate-fade-up-delay-1">
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(13,26,17,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <button
              onClick={() => setDeployOpen(!deployOpen)}
              className="w-full flex items-center justify-between p-6 text-left"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.25)" }}
                >
                  <Terminal className="w-4 h-4" style={{ color: "#34d399" }} />
                </div>
                <div className="text-left">
                  <p className="text-base font-semibold text-agro-text">Deploy das Edge Functions & Storage</p>
                  <p className="text-sm text-agro-muted mt-0.5">Publique o webhook, envio de mensagens e bucket de mídia</p>
                </div>
              </div>
              {deployOpen
                ? <ChevronUp   className="w-4 h-4 text-agro-muted shrink-0" />
                : <ChevronDown className="w-4 h-4 text-agro-muted shrink-0" />
              }
            </button>

            {deployOpen && (
              <div className="px-6 pb-6 space-y-6" style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
                <div className="mt-5 p-4 rounded-xl text-center"
                  style={{ background: "rgba(8,16,10,0.8)", border: "1px solid rgba(63,176,108,0.08)" }}
                >
                  <p className="text-xs font-mono text-agro-muted leading-loose">
                    <span className="text-agro-green font-semibold">Meta</span>
                    {" → "}
                    <span style={{ color: "#34d399" }} className="font-semibold">meta-webhook</span>
                    {" → "}
                    <span className="text-agro-green font-semibold">Supabase DB</span>
                    {"  |  "}
                    <span className="text-agro-text font-semibold">Inbox UI</span>
                    {" → "}
                    <span style={{ color: "#34d399" }} className="font-semibold">send-inbox-message</span>
                    {" → "}
                    <span className="text-agro-green font-semibold">Meta</span>
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StepBadge n={1} />
                    <div>
                      <p className="text-sm font-semibold text-agro-text">Autentique, vincule e publique</p>
                      <p className="text-xs text-agro-muted">Execute no terminal, na pasta do projeto</p>
                    </div>
                  </div>
                  <CodeBlock code={cmd_deploy} onCopy={() => copy(cmd_deploy, "Comandos copiados!")} />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StepBadge n={2} />
                    <div>
                      <p className="text-sm font-semibold text-agro-text">Crie o bucket de mídia no Supabase</p>
                      <p className="text-xs text-agro-muted">Cole no SQL Editor e clique em Run</p>
                    </div>
                  </div>
                  <CodeBlock code={sql_bucket} onCopy={() => copy(sql_bucket, "SQL copiado!")} />
                  <a
                    href={`https://supabase.com/dashboard/project/${SUPABASE_REF}/sql`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-semibold hover:opacity-80 transition-opacity"
                    style={{ color: "#34d399" }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir SQL Editor do projeto
                  </a>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StepBadge n={3} />
                    <div>
                      <p className="text-sm font-semibold text-agro-text">Crie as tabelas de multi-tenant</p>
                      <p className="text-xs text-agro-muted">workspaces + workspace_members — necessário para autenticação</p>
                    </div>
                  </div>
                  <CodeBlock code={sql_workspaces} onCopy={() => copy(sql_workspaces, "SQL copiado!")} />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StepBadge n={4} />
                    <div>
                      <p className="text-sm font-semibold text-agro-text">Crie a tabela de auditoria</p>
                      <p className="text-xs text-agro-muted">Registra disparos, erros, eventos de webhook e retries</p>
                    </div>
                  </div>
                  <CodeBlock code={sql_audit_logs} onCopy={() => copy(sql_audit_logs, "SQL copiado!")} />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StepBadge n={5} />
                    <div>
                      <p className="text-sm font-semibold text-agro-text">Habilite fotos de perfil</p>
                      <p className="text-xs text-agro-muted">Adiciona campos de descrição e avatar + bucket de storage</p>
                    </div>
                  </div>
                  <CodeBlock code={sql_profile} onCopy={() => copy(sql_profile, "SQL copiado!")} />
                </div>
              </div>
            )}
          </div>
        </div>

        </> /* end Avançado (Deploy) tab */}

        {/* ══ Tab: Email ═════════════════════════════════════ */}
        {settingsTab === "email" && <>

        {/* ── Conexões de Email ───────────────── */}
        <div className="animate-fade-up-delay-1">
          <DarkCard title="Conexões de Email" subtitle="Configure contas SMTP ou Microsoft 365 para disparos em massa via email">

            {/* Lista de conexões existentes */}
            {emailConns.length > 0 && (
              <div className="space-y-2 mb-4">
                {emailConns.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center justify-between p-3 rounded-xl"
                    style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.08)" }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}
                      >
                        <Mail className="w-4 h-4 text-agro-green" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-agro-text text-sm">{conn.name}</p>
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={conn.provider === "smtp"
                              ? { background: "rgba(63,176,108,0.1)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }
                              : conn.provider === "oauth2"
                              ? { background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)" }
                              : { background: "rgba(0,120,212,0.15)", color: "#60a5fa", border: "1px solid rgba(0,120,212,0.3)" }
                            }
                          >
                            {conn.provider === "smtp" ? "SMTP" : conn.provider === "oauth2" ? "OAuth2" : "M365"}
                          </span>
                        </div>
                        <p className="text-xs text-agro-muted">
                          {conn.from_email}
                          {conn.provider === "smtp" && ` · ${conn.host}:${conn.port}`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleEmailDelete(conn.id)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-red-400 transition-colors"
                      style={{ border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Botão para mostrar form */}
            {!showEmailForm && (
              <button
                onClick={() => setShowEmailForm(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
                style={{ border: "1px solid rgba(63,176,108,0.2)" }}
              >
                <Mail className="w-3.5 h-3.5" />
                {emailConns.length > 0 ? "Adicionar outra conexão" : "Adicionar conexão de email"}
              </button>
            )}

            {/* Formulário */}
            {showEmailForm && (
              <div className="space-y-4">
                {/* Provider toggle */}
                <div>
                  <FieldLabel>Provedor</FieldLabel>
                  <div className="flex gap-1 p-1 rounded-xl w-fit"
                    style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.12)" }}
                  >
                    {([
                      { id: "smtp",   label: "SMTP"          },
                      { id: "graph",  label: "Microsoft 365 (App)" },
                      { id: "oauth2", label: "Microsoft (Login)" },
                    ] as const).map((p) => {
                      const active = emailForm.provider === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setEmailForm({ ...emailForm, provider: p.id })}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                          style={active ? {
                            background: p.id === "smtp"
                              ? "rgba(63,176,108,0.2)"
                              : "rgba(0,120,212,0.2)",
                            border: p.id === "smtp"
                              ? "1px solid rgba(63,176,108,0.4)"
                              : "1px solid rgba(0,120,212,0.4)",
                            color: p.id === "smtp" ? "#fff" : "#60a5fa",
                          } : { color: "#6b7280" }}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <FieldLabel>Nome da conexão *</FieldLabel>
                    <input
                      className="input-agro w-full"
                      placeholder={emailForm.provider === "graph" ? "Ex: Microsoft 365 Cobrança" : "Ex: Gmail Financeiro"}
                      value={emailForm.name}
                      onChange={(e) => setEmailForm({ ...emailForm, name: e.target.value })}
                    />
                  </div>

                  {emailForm.provider === "graph" ? (
                    <>
                      <div className="col-span-2">
                        <FieldLabel>Tenant ID (Directory ID) *</FieldLabel>
                        <input
                          className="input-agro w-full"
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          value={emailForm.tenant_id}
                          onChange={(e) => setEmailForm({ ...emailForm, tenant_id: e.target.value })}
                        />
                      </div>
                      <div>
                        <FieldLabel>Client ID (App ID) *</FieldLabel>
                        <input
                          className="input-agro w-full"
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          value={emailForm.client_id}
                          onChange={(e) => setEmailForm({ ...emailForm, client_id: e.target.value })}
                        />
                      </div>
                      <div>
                        <FieldLabel>Client Secret *</FieldLabel>
                        <input
                          className="input-agro w-full"
                          type="password"
                          placeholder="••••••••••••"
                          value={emailForm.password}
                          onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })}
                        />
                      </div>
                    </>
                  ) : emailForm.provider === "oauth2" ? (
                    <>
                      <div>
                        <FieldLabel>Client ID (App ID) *</FieldLabel>
                        <input
                          className="input-agro w-full"
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          value={emailForm.client_id}
                          onChange={(e) => setEmailForm({ ...emailForm, client_id: e.target.value })}
                        />
                      </div>
                      <div>
                        <FieldLabel>Client Secret *</FieldLabel>
                        <input
                          className="input-agro w-full"
                          type="password"
                          placeholder="••••••••••••"
                          value={emailForm.password}
                          onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })}
                        />
                      </div>
                      <div className="col-span-2">
                        <FieldLabel>Tenant ID (opcional — deixe vazio para contas pessoais @outlook.com)</FieldLabel>
                        <input
                          className="input-agro w-full"
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (ou vazio para common)"
                          value={emailForm.tenant_id}
                          onChange={(e) => setEmailForm({ ...emailForm, tenant_id: e.target.value })}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <FieldLabel>Servidor SMTP *</FieldLabel>
                        <input
                          className="input-agro w-full"
                          placeholder="smtp.gmail.com"
                          value={emailForm.host}
                          onChange={(e) => setEmailForm({ ...emailForm, host: e.target.value })}
                        />
                      </div>
                      <div>
                        <FieldLabel>Porta *</FieldLabel>
                        <input
                          className="input-agro w-full"
                          placeholder="587"
                          value={emailForm.port}
                          onChange={(e) => setEmailForm({ ...emailForm, port: e.target.value })}
                        />
                      </div>
                      <div>
                        <FieldLabel>Usuário *</FieldLabel>
                        <input
                          className="input-agro w-full"
                          placeholder="usuario@empresa.com"
                          value={emailForm.username}
                          onChange={(e) => setEmailForm({ ...emailForm, username: e.target.value })}
                        />
                      </div>
                      <div>
                        <FieldLabel>Senha / App Password *</FieldLabel>
                        <input
                          className="input-agro w-full"
                          type="password"
                          placeholder="••••••••••••"
                          value={emailForm.password}
                          onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })}
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <FieldLabel>Nome do remetente *</FieldLabel>
                    <input
                      className="input-agro w-full"
                      placeholder="Ex: Notificações da Empresa"
                      value={emailForm.from_name}
                      onChange={(e) => setEmailForm({ ...emailForm, from_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <FieldLabel>Email do remetente *</FieldLabel>
                    <input
                      className="input-agro w-full"
                      placeholder={emailForm.provider === "graph" ? "credito.cobranca@empresa.com" : "cobrancas@empresa.com"}
                      value={emailForm.from_email}
                      onChange={(e) => setEmailForm({ ...emailForm, from_email: e.target.value })}
                    />
                  </div>
                </div>

                {/* Toggle TLS (SMTP only) */}
                {emailForm.provider === "smtp" && (
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <div
                      onClick={() => setEmailForm({ ...emailForm, secure: !emailForm.secure })}
                      className={cn(
                        "w-10 h-6 rounded-full transition-colors relative",
                        emailForm.secure ? "bg-agro-green" : "bg-agro-border"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
                          emailForm.secure && "translate-x-4"
                        )}
                      />
                    </div>
                    <span className="text-sm text-agro-muted">
                      Usar TLS (porta 465) — desative para STARTTLS/587
                    </span>
                  </label>
                )}

                {/* Provider info notes */}
                {emailForm.provider === "graph" && (
                  <div className="flex items-start gap-2 p-3 rounded-xl text-xs text-agro-muted"
                    style={{ background: "rgba(0,120,212,0.06)", border: "1px solid rgba(0,120,212,0.15)" }}
                  >
                    <span className="text-blue-400 shrink-0">ℹ</span>
                    <span>
                      O app Entra ID precisa da permissão <strong className="text-agro-text">Mail.Send</strong> (aplicativo, não delegada).
                      O email do remetente deve ser uma caixa de entrada válida no tenant.
                    </span>
                  </div>
                )}
                {emailForm.provider === "oauth2" && (
                  <div className="flex items-start gap-2 p-3 rounded-xl text-xs text-agro-muted"
                    style={{ background: "rgba(0,120,212,0.06)", border: "1px solid rgba(0,120,212,0.15)" }}
                  >
                    <span className="text-blue-400 shrink-0">ℹ</span>
                    <span>
                      O app Entra ID precisa da permissão <strong className="text-agro-text">Mail.Send</strong> (delegada, não aplicativo).
                      Suporta contas pessoais <strong className="text-agro-text">@outlook.com</strong> e organizacionais M365.
                      URI de redirecionamento registrada no Azure: <strong className="text-agro-text font-mono">{SUPABASE_URL}/functions/v1/ms-oauth-callback</strong>
                    </span>
                  </div>
                )}

                {/* Test result */}
                {emailTestResult && (
                  <div
                    className="flex items-start gap-3 p-3 rounded-xl"
                    style={emailTestResult.ok
                      ? { background: "rgba(63,176,108,0.08)",  border: "1px solid rgba(63,176,108,0.25)"  }
                      : { background: "rgba(239,68,68,0.08)",   border: "1px solid rgba(239,68,68,0.25)"   }
                    }
                  >
                    {emailTestResult.ok
                      ? <CheckCircle className="w-4 h-4 text-agro-green shrink-0 mt-0.5" />
                      : <XCircle    className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    }
                    <p className={cn("text-sm", emailTestResult.ok ? "text-agro-green" : "text-red-400")}>
                      {emailTestResult.info}
                    </p>
                  </div>
                )}

                <div className="flex gap-3 pt-1 flex-wrap">
                  <button
                    onClick={() => { setShowEmailForm(false); setEmailTestResult(null); }}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
                    style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    Cancelar
                  </button>

                  {emailForm.provider === "oauth2" ? (
                    <button
                      onClick={handleMicrosoftOAuth}
                      disabled={!emailFormValid}
                      className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                      style={{ background: "rgba(0,120,212,0.85)", border: "1px solid rgba(0,120,212,0.6)" }}
                    >
                      <LogIn className="w-4 h-4" />
                      Conectar com Microsoft
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleEmailTest}
                        disabled={!emailTestValid || emailTesting}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors disabled:opacity-50"
                        style={{ border: "1px solid rgba(63,176,108,0.2)" }}
                      >
                        <Send className={cn("w-3.5 h-3.5", emailTesting && "animate-pulse")} />
                        {emailTesting ? "Testando…" : "Testar conexão"}
                      </button>
                      <button
                        onClick={handleEmailSave}
                        disabled={!emailFormValid || emailSaving}
                        className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                      >
                        <Mail className="w-4 h-4" />
                        {emailSaving ? "Salvando…" : "Salvar conexão"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </DarkCard>
        </div>

        </> /* end Email tab */}

        {/* ══ Tab: IA ═══════════════════════════════════════ */}
        {settingsTab === "ia" && <>

        {/* ── Inteligência Artificial ──────────── */}
        <div className="animate-fade-up-delay-1">
          <DarkCard
            title="Inteligência Artificial"
            subtitle="Provedor de IA para classificar respostas dos clientes aos disparos"
          >
              <div className="space-y-5">
                {/* Provider toggle */}
                <div>
                  <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-3">Provedor ativo</p>
                  <div className="flex gap-3">
                    {(["anthropic", "openai"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setAiProvider(p)}
                        className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-left"
                        style={aiProvider === p ? {
                          background: "rgba(63,176,108,0.12)",
                          border:     "1px solid rgba(63,176,108,0.35)",
                        } : {
                          background: "rgba(13,26,17,0.5)",
                          border:     "1px solid rgba(63,176,108,0.08)",
                        }}
                      >
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                          style={aiProvider === p
                            ? { background: "rgba(63,176,108,0.2)", border: "1px solid rgba(63,176,108,0.4)" }
                            : { background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.12)" }
                          }
                        >
                          <Zap className="w-3.5 h-3.5" style={{ color: aiProvider === p ? "#3fb06c" : "#4a6b54" }} />
                        </div>
                        <div>
                          <p className={cn("text-sm font-semibold", aiProvider === p ? "text-agro-text" : "text-agro-muted")}>
                            {p === "anthropic" ? "Anthropic" : "OpenAI"}
                          </p>
                          <p className="text-[10px] text-agro-muted-2">
                            {p === "anthropic" ? "Claude Haiku" : "GPT-4o mini"}
                          </p>
                        </div>
                        {aiProvider === p && (
                          <div className="ml-auto w-2 h-2 rounded-full bg-agro-green shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Anthropic key */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <FieldLabel>Chave Anthropic (Claude)</FieldLabel>
                    {anthropicKeySet && (
                      <span className="text-[10px] font-semibold text-agro-green flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Configurada
                      </span>
                    )}
                  </div>
                  <input
                    className="input-agro w-full font-mono text-xs"
                    type="password"
                    placeholder={anthropicKeySet ? "••••••••••• (deixe em branco para manter)" : "sk-ant-api03-..."}
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                  />
                </div>

                {/* OpenAI key */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <FieldLabel>Chave OpenAI</FieldLabel>
                    {openaiKeySet && (
                      <span className="text-[10px] font-semibold text-agro-green flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Configurada
                      </span>
                    )}
                  </div>
                  <input
                    className="input-agro w-full font-mono text-xs"
                    type="password"
                    placeholder={openaiKeySet ? "••••••••••• (deixe em branco para manter)" : "sk-..."}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                  />
                </div>

                <div
                  className="flex items-start gap-2 p-3 rounded-xl text-xs text-agro-muted"
                  style={{ background: "rgba(63,176,108,0.04)", border: "1px solid rgba(63,176,108,0.08)" }}
                >
                  <Zap className="w-3.5 h-3.5 text-agro-green shrink-0 mt-0.5" />
                  <span>
                    O provedor selecionado será usado para classificar automaticamente as respostas dos clientes aos disparos (severidade, categoria e resumo). Você pode trocar a qualquer momento — a mudança afeta apenas novas classificações.
                  </span>
                </div>

                <button
                  onClick={handleAiSave}
                  disabled={aiSaving}
                  className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Zap className="w-4 h-4" />
                  {aiSaving ? "Salvando…" : "Salvar configurações de IA"}
                </button>
              </div>
            </DarkCard>
          </div>

        {/* ── Suporte ──────────────────────────── */}
        <div className="animate-fade-up-delay-1">
          <DarkCard
            title="Suporte"
            subtitle="Email que receberá as notificações quando usuários abrirem ou responderem tickets"
          >
            <div className="space-y-4">
              <div>
                <FieldLabel>Email de recebimento de tickets</FieldLabel>
                <input
                  className="input-agro w-full"
                  type="email"
                  placeholder="suporte@suaempresa.com"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                />
                <p className="text-xs text-agro-muted mt-1.5">
                  Tickets abertos por usuários e suas respostas serão enviados para este endereço.
                </p>
              </div>
              <div
                className="flex items-start gap-2 p-3 rounded-xl text-xs text-agro-muted"
                style={{ background: "rgba(63,176,108,0.04)", border: "1px solid rgba(63,176,108,0.08)" }}
              >
                <Mail className="w-3.5 h-3.5 text-agro-green shrink-0 mt-0.5" />
                <span>
                  Os emails são enviados via <strong className="text-agro-text">Resend API</strong>. Certifique-se de que <code className="text-agro-green">RESEND_API_KEY</code> está configurado nos secrets do Supabase e que o domínio do seu email está verificado no painel do Resend.
                </span>
              </div>
              <button
                onClick={handleSupportEmailSave}
                disabled={supportEmailSaving || !supportEmail.trim()}
                className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              >
                {supportEmailSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {supportEmailSaving ? "Salvando…" : "Salvar email de suporte"}
              </button>
            </div>
          </DarkCard>
        </div>

        </> /* end IA tab */}

        {/* ══ Tab: Avançado ══════════════════════════════════ */}
        {settingsTab === "avancado" && <>

        {/* ── Webhook Meta ─────────────────────── */}
        <div className="animate-fade-up-delay-1">
          <DarkCard
            title="Configurar Webhook na Meta"
            subtitle="Cole esses valores em Meta for Developers → WhatsApp → Configuration → Webhook"
          >
            <div className="space-y-4">
              <div>
                <FieldLabel>URL de Callback</FieldLabel>
                <ReadonlyField
                  value={`${WEBHOOK_URL}?workspace_id=${WORKSPACE_ID}`}
                  onCopy={() => copy(`${WEBHOOK_URL}?workspace_id=${WORKSPACE_ID}`, "URL copiada!")}
                />
              </div>

              <div>
                <FieldLabel>Verificar Token</FieldLabel>
                <div
                  className="p-3 rounded-xl text-xs text-agro-muted"
                  style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.12)" }}
                >
                  Cada conexão WhatsApp possui seu próprio <strong className="text-agro-text">Verify Token</strong> — visível na seção <strong className="text-agro-text">Conexões WhatsApp ativas</strong> acima (clique em copiar ao lado do token).
                  <br /><br />
                  Clique em <strong className="text-agro-text">Verificar e salvar</strong> após colar o token no painel da Meta — a confirmação é automática.
                </div>
              </div>

              <div>
                <FieldLabel>Workspace ID (referência)</FieldLabel>
                <ReadonlyField
                  value={WORKSPACE_ID}
                  onCopy={() => copy(WORKSPACE_ID, "Workspace ID copiado!")}
                />
              </div>

              <div
                className="p-3 rounded-xl"
                style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}
              >
                <p className="text-xs font-semibold text-blue-400 mb-1">Campos do webhook (Subscriptions):</p>
                <p className="text-xs text-agro-muted">
                  ✓ messages &nbsp;✓ message_deliveries &nbsp;✓ message_reads &nbsp;✓ messaging_postbacks
                </p>
              </div>

              <a
                href="https://developers.facebook.com/apps"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-xs font-semibold text-agro-green hover:text-agro-text transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Abrir Meta for Developers
              </a>
            </div>
          </DarkCard>
        </div>

        </> /* end Avançado tab */}

        {/* ══ Tab: Demo ════════════════════════════════════════ */}
        {settingsTab === "demo" && (
          <div className="animate-fade-up">
            <DemoSeeder workspaceId={WORKSPACE_ID} />
          </div>
        )}

        {/* ══ Tab: API Keys ════════════════════════════════════ */}
        {settingsTab === "api" && (
          <div className="animate-fade-up rounded-2xl p-6"
            style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}>
            <ApiKeysManager />
          </div>
        )}

        </>) : (
          <div
            className="animate-fade-up rounded-2xl p-6 flex items-start gap-4"
            style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <Shield className="w-5 h-5 text-agro-muted-2 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-agro-text">Acesso restrito</p>
              <p className="text-sm text-agro-muted mt-1">
                As configurações de credenciais, integrações e infraestrutura são visíveis apenas para administradores.
              </p>
            </div>
          </div>
        )}

      </div>

      {reconnectTarget && (
        <ReconnectModal
          conn={reconnectTarget}
          onClose={() => setReconnectTarget(null)}
          onSaved={() => refetchConnections()}
        />
      )}

      {showZApiAdd && (
        <ZApiAddModal
          workspaceId={WORKSPACE_ID}
          onClose={() => setShowZApiAdd(false)}
          onSaved={() => refetchZApi()}
        />
      )}

      {zApiQrTarget && (
        <ZApiQrModal
          conn={zApiQrTarget}
          onClose={() => setZApiQrTarget(null)}
          onConnected={() => { refetchZApi(); setZApiQrTarget(null); }}
        />
      )}

    </div>
  );
}
