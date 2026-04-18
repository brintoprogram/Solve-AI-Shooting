import { useState } from "react";
import {
  RefreshCw, CheckCircle, XCircle, Copy, Wifi, Settings2,
  Terminal, ExternalLink, ChevronDown, ChevronUp, User, Shield,
} from "lucide-react";
import { Topbar }              from "@/components/layout/Topbar";
import { useAuth, ROLE_LABELS, ROLE_STYLE, initials } from "@/context/AuthContext";
import { useMetaConnections }  from "@/hooks/useMetaConnection";
import { getPhoneNumberInfo }  from "@/services/metaApi";
import { getWorkspaceId }      from "@/lib/config";
import { useToast }            from "@/hooks/use-toast";
import { cn }                  from "@/lib/utils";

const WORKSPACE_ID = getWorkspaceId();

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

// ── Settings page ─────────────────────────────────────────────────

export function Settings() {
  const { profile }                        = useAuth();
  const { connections, upsertConnection }  = useMetaConnections(WORKSPACE_ID);
  const { toast }                          = useToast();

  const [form, setForm]           = useState({ waba_id: "", phone_number_id: "", access_token: "" });
  const [testing,  setTesting]    = useState(false);
  const [saving,   setSaving]     = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; info?: string } | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);

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
        webhook_verify_token: CHATWOOT_VERIFY_TOKEN,
        status:               "active",
        quality_rating:       (phoneInfo.quality_rating as "GREEN" | "YELLOW" | "RED") ?? null,
        messaging_limit:      (phoneInfo.messaging_limit_tier as "TIER_1K" | "TIER_10K" | "TIER_100K" | "UNLIMITED") ?? null,
      });
      toast({ title: "Conexão salva com sucesso!", variant: "success" });
      setForm({ waba_id: "", phone_number_id: "", access_token: "" });
      setTestResult(null);
    } catch (err) {
      toast({
        title:       "Erro ao salvar",
        description: err instanceof Error ? err.message : "Tente novamente.",
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
supabase functions deploy send-inbox-message`;

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

  const rs        = profile ? ROLE_STYLE[profile.role]  : null;
  const roleLabel = profile ? ROLE_LABELS[profile.role] : null;

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Configurações" }]} />

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* ── Header ──────────────────────────── */}
        <div className="animate-fade-up">
          <h1 className="font-display text-2xl font-bold text-agro-text">Configurações</h1>
          <p className="text-agro-muted mt-1 text-sm">Perfil, conexões e integrações</p>
        </div>

        {/* ── Meu Perfil ───────────────────────── */}
        <div className="animate-fade-up">
          <DarkCard title="Meu Perfil" subtitle="Informações da sua conta">
            <div className="flex items-center gap-4">
              {/* Avatar */}
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-base shrink-0"
                style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
              >
                {initials(profile?.full_name)}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-agro-text truncate">
                  {profile?.full_name ?? "—"}
                </p>
                {rs && roleLabel && (
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mt-1"
                    style={{ background: rs.bg, color: rs.color, border: `1px solid ${rs.border}` }}
                  >
                    <Shield className="w-3 h-3" />
                    {roleLabel}
                  </span>
                )}
              </div>

              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.15)" }}
              >
                <User className="w-5 h-5 text-agro-green" />
              </div>
            </div>
          </DarkCard>
        </div>

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
                      className="flex items-center justify-between p-3 rounded-xl"
                      style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.08)" }}
                    >
                      <div className="flex items-center gap-3">
                        {/* Status indicator */}
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
                      </div>
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
              </div>
            )}
          </div>
        </div>

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
                <ReadonlyField
                  value={CHATWOOT_VERIFY_TOKEN}
                  onCopy={() => copy(CHATWOOT_VERIFY_TOKEN, "Token copiado!")}
                />
                <p className="text-xs text-agro-muted mt-1.5">
                  Clique em <strong className="text-agro-text">Verificar e salvar</strong> — a Meta confirmará o token automaticamente.
                </p>
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

      </div>
    </div>
  );
}
