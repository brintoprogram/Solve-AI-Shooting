import { useState } from "react";
import { RefreshCw, CheckCircle, XCircle, Copy, Wifi, Settings2, Trash2, Terminal, ExternalLink, ChevronDown, ChevronUp, GitBranch } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { getPhoneNumberInfo } from "@/services/metaApi";
import { getConfig, clearConfig } from "@/lib/config";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const WORKSPACE_ID = "demo-workspace-id";

// Token de verificação do Chatwoot — já cadastrado na Meta
const CHATWOOT_VERIFY_TOKEN = "73c0163c89186e2fb98921d14d8d1ec4";
const CHATWOOT_WEBHOOK_URL  = "https://chatwoot.solveai.consulting/webhooks/whatsapp/+5511950239278";

function DarkCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-6 space-y-5"
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

function CodeBlock({ code, onCopy }: { code: string; onCopy: () => void }) {
  return (
    <div className="relative rounded-xl overflow-hidden"
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
        <Copy className="w-3 h-3" />
        Copiar
      </button>
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white"
      style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
    >
      {n}
    </div>
  );
}

export function Settings() {
  const { connections, upsertConnection } = useMetaConnections(WORKSPACE_ID);
  const { toast } = useToast();
  const currentConfig = getConfig();

  const supabaseRef = currentConfig?.supabaseUrl
    ? currentConfig.supabaseUrl.replace("https://", "").split(".supabase.co")[0]
    : "SEU_PROJECT_REF";

  const proxyUrl   = `https://${supabaseRef}.supabase.co/functions/v1/meta-webhook-proxy`;
  const solveUrl   = `https://${supabaseRef}.supabase.co/functions/v1/meta-webhook`;

  const [form, setForm] = useState({ waba_id: "", phone_number_id: "", access_token: "" });
  const [testing, setTesting]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; info?: string } | null>(null);
  const [proxyOpen, setProxyOpen] = useState(false);

  function copy(text: string, label = "Copiado!") {
    navigator.clipboard.writeText(text);
    toast({ title: label });
  }

  function handleResetSetup() {
    if (confirm("Isso vai apagar as credenciais do Supabase e voltar para a tela de configuração. Continuar?")) {
      clearConfig();
      window.location.reload();
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const info = await getPhoneNumberInfo(form.phone_number_id, form.access_token);
      setTestResult({ ok: true, info: `${info.verified_name} · ${info.display_phone_number} · ${info.quality_rating}` });
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
    } catch (err) {
      toast({ title: "Erro ao salvar", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const QUALITY_COLOR: Record<string, string> = { GREEN: "rgba(63,176,108,0.1)", YELLOW: "rgba(245,158,11,0.1)", RED: "rgba(239,68,68,0.1)" };
  const QUALITY_TEXT:  Record<string, string> = { GREEN: "#3fb06c",              YELLOW: "#fbbf24",              RED: "#f87171"             };

  const cmd_deploy  = `npx supabase functions deploy meta-webhook-proxy --project-ref ${supabaseRef}`;
  const cmd_secrets = `npx supabase secrets set \\\n  SOLVE_WEBHOOK_URL="${solveUrl}" \\\n  --project-ref ${supabaseRef}`;

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Configurações" }]} />

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* ── Header ──────────────────────────── */}
        <div className="animate-fade-up">
          <h1 className="font-display text-2xl font-bold text-agro-text">Configurações</h1>
          <p className="text-agro-muted mt-1 text-sm">Gerencie suas integrações</p>
        </div>

        {/* ── Supabase status ──────────────────── */}
        {currentConfig && (
          <div className="flex items-center justify-between p-4 rounded-xl animate-fade-up-delay-1"
            style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.2)" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
              >
                <Settings2 className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-agro-text">Supabase conectado</p>
                <p className="text-xs text-agro-muted font-mono truncate max-w-xs">{currentConfig.supabaseUrl}</p>
              </div>
            </div>
            <button
              onClick={handleResetSetup}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
              style={{ border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Reconfigurar
            </button>
          </div>
        )}

        {/* ── Active connections ───────────────── */}
        {connections.length > 0 && (
          <div className="animate-fade-up-delay-1">
            <DarkCard title="Conexões ativas">
              <div className="space-y-3">
                {connections.map((conn) => {
                  const qColor = QUALITY_COLOR[conn.quality_rating ?? ""] ?? "rgba(107,114,128,0.1)";
                  const qText  = QUALITY_TEXT[conn.quality_rating  ?? ""] ?? "#9ca3af";
                  return (
                    <div key={conn.id} className="flex items-center justify-between p-3 rounded-xl"
                      style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.08)" }}
                    >
                      <div className="flex items-center gap-3">
                        <Wifi className={cn("w-5 h-5", conn.status === "active" ? "text-agro-green" : "text-red-400")} />
                        <div>
                          <p className="font-semibold text-agro-text text-sm">{conn.display_phone}</p>
                          <p className="text-xs text-agro-muted">{conn.business_name} · {conn.waba_id}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {conn.quality_rating && (
                          <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                            style={{ background: qColor, color: qText, border: `1px solid ${qColor}` }}
                          >
                            {conn.quality_rating}
                          </span>
                        )}
                        {conn.messaging_limit && (
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium text-agro-muted"
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

        {/* ── Connection form ──────────────────── */}
        <div className="animate-fade-up-delay-1">
          <DarkCard
            title={connections.length > 0 ? "Adicionar nova conexão" : "Configurar conexão"}
            subtitle="Configure sua integração com a Cloud API da Meta"
          >
            <div className="space-y-4">
              <div>
                <FieldLabel>WhatsApp Business Account ID (WABA ID) *</FieldLabel>
                <input className="input-agro w-full" placeholder="123456789012345"
                  value={form.waba_id} onChange={(e) => setForm({ ...form, waba_id: e.target.value })}
                />
              </div>
              <div>
                <FieldLabel>Phone Number ID *</FieldLabel>
                <input className="input-agro w-full" placeholder="100123456789012"
                  value={form.phone_number_id} onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
                />
              </div>
              <div>
                <FieldLabel>Access Token (System User Token) *</FieldLabel>
                <input className="input-agro w-full" type="password" placeholder="EAAxxxxxxxxx..."
                  value={form.access_token} onChange={(e) => setForm({ ...form, access_token: e.target.value })}
                />
                <p className="text-xs text-agro-muted mt-1.5">Use um System User Token permanente, não um token temporário.</p>
              </div>

              {testResult && (
                <div className="flex items-start gap-3 p-3 rounded-xl"
                  style={testResult.ok
                    ? { background: "rgba(63,176,108,0.08)",  border: "1px solid rgba(63,176,108,0.25)"  }
                    : { background: "rgba(239,68,68,0.08)",   border: "1px solid rgba(239,68,68,0.25)"   }}
                >
                  {testResult.ok
                    ? <CheckCircle className="w-4 h-4 text-agro-green shrink-0 mt-0.5" />
                    : <XCircle    className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
                  <div>
                    <p className={cn("text-sm font-semibold", testResult.ok ? "text-agro-green" : "text-red-400")}>
                      {testResult.ok ? "Conexão bem-sucedida!" : "Falha na conexão"}
                    </p>
                    <p className="text-xs text-agro-muted mt-0.5">{testResult.info}</p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={handleTest}
                  disabled={!form.phone_number_id || !form.access_token || testing}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors disabled:opacity-50"
                  style={{ border: "1px solid rgba(63,176,108,0.2)" }}
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", testing && "animate-spin")} />
                  {testing ? "Testando..." : "Testar conexão"}
                </button>
                <button onClick={handleSave}
                  disabled={!form.waba_id || !form.phone_number_id || !form.access_token || saving}
                  className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Salvar conexão"}
                </button>
              </div>
            </div>
          </DarkCard>
        </div>

        {/* ── Webhook proxy tutorial ───────────── */}
        <div className="animate-fade-up-delay-1">
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(13,26,17,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            {/* Header — clicável para expandir */}
            <button
              onClick={() => setProxyOpen(!proxyOpen)}
              className="w-full flex items-center justify-between p-6 text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.2)" }}
                >
                  <GitBranch className="w-4.5 h-4.5" style={{ color: "#a78bfa" }} />
                </div>
                <div className="text-left">
                  <p className="text-base font-semibold text-agro-text">Proxy de Webhook (Chatwoot + Solve.AI)</p>
                  <p className="text-sm text-agro-muted mt-0.5">Como receber eventos da Meta nos dois sistemas ao mesmo tempo</p>
                </div>
              </div>
              {proxyOpen
                ? <ChevronUp  className="w-4 h-4 text-agro-muted shrink-0" />
                : <ChevronDown className="w-4 h-4 text-agro-muted shrink-0" />}
            </button>

            {proxyOpen && (
              <div className="px-6 pb-6 space-y-6"
                style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}
              >
                {/* Diagrama */}
                <div className="mt-5 p-4 rounded-xl text-center"
                  style={{ background: "rgba(8,16,10,0.8)", border: "1px solid rgba(63,176,108,0.08)" }}
                >
                  <p className="text-xs font-mono text-agro-muted leading-loose">
                    <span className="text-agro-green font-semibold">Meta</span>
                    {" → "}
                    <span className="text-purple-400 font-semibold">meta-webhook-proxy</span>
                    {" → "}
                    <span className="text-blue-400 font-semibold">Chatwoot</span>
                    {" + "}
                    <span className="text-agro-green font-semibold">Solve.AI</span>
                  </p>
                  <p className="text-[10px] text-agro-muted-2 mt-2">
                    Você só muda a URL no painel da Meta — Chatwoot não precisa de nenhuma alteração
                  </p>
                </div>

                {/* Passo 1 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StepBadge n={1} />
                    <div>
                      <p className="text-sm font-semibold text-agro-text">Instale o Supabase CLI</p>
                      <p className="text-xs text-agro-muted">Se ainda não tiver instalado</p>
                    </div>
                  </div>
                  <CodeBlock
                    code="npm install -g supabase"
                    onCopy={() => copy("npm install -g supabase")}
                  />
                </div>

                {/* Passo 2 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StepBadge n={2} />
                    <div>
                      <p className="text-sm font-semibold text-agro-text">Faça login e link o projeto</p>
                      <p className="text-xs text-agro-muted">Na pasta do projeto clonado do GitHub</p>
                    </div>
                  </div>
                  <CodeBlock
                    code={`supabase login\nsupabase link --project-ref ${supabaseRef}`}
                    onCopy={() => copy(`supabase login\nsupabase link --project-ref ${supabaseRef}`)}
                  />
                </div>

                {/* Passo 3 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StepBadge n={3} />
                    <div>
                      <p className="text-sm font-semibold text-agro-text">Deploy da Edge Function</p>
                      <p className="text-xs text-agro-muted">Publica o proxy no seu Supabase</p>
                    </div>
                  </div>
                  <CodeBlock
                    code={cmd_deploy}
                    onCopy={() => copy(cmd_deploy)}
                  />
                </div>

                {/* Passo 4 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StepBadge n={4} />
                    <div>
                      <p className="text-sm font-semibold text-agro-text">Configure o secret</p>
                      <p className="text-xs text-agro-muted">Informa ao proxy onde está o Solve.AI</p>
                    </div>
                  </div>
                  <CodeBlock
                    code={cmd_secrets}
                    onCopy={() => copy(`npx supabase secrets set SOLVE_WEBHOOK_URL="${solveUrl}" --project-ref ${supabaseRef}`)}
                  />
                </div>

                {/* Passo 5 — Meta */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <StepBadge n={5} />
                    <div>
                      <p className="text-sm font-semibold text-agro-text">Troque a URL no painel da Meta</p>
                      <p className="text-xs text-agro-muted">
                        Meta for Developers → Seu App → WhatsApp → Configuration → Webhook
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <FieldLabel>Nova URL do Webhook</FieldLabel>
                      <div className="flex gap-2">
                        <input className="input-agro flex-1 font-mono text-xs" value={proxyUrl} readOnly />
                        <button
                          onClick={() => copy(proxyUrl)}
                          className="w-10 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors"
                          style={{ border: "1px solid rgba(63,176,108,0.15)", background: "rgba(13,26,17,0.6)" }}
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <FieldLabel>Verify Token (mesmo de antes — não muda)</FieldLabel>
                      <div className="flex gap-2">
                        <input className="input-agro flex-1 font-mono text-xs" value={CHATWOOT_VERIFY_TOKEN} readOnly />
                        <button
                          onClick={() => copy(CHATWOOT_VERIFY_TOKEN)}
                          className="w-10 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors"
                          style={{ border: "1px solid rgba(63,176,108,0.15)", background: "rgba(13,26,17,0.6)" }}
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-xs text-agro-muted mt-1.5">
                        Este é o token já cadastrado no Chatwoot — não precisa alterar nada no Chatwoot.
                      </p>
                    </div>
                  </div>

                  <a
                    href="https://developers.facebook.com/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-semibold text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir Meta for Developers
                  </a>
                </div>

                {/* Resultado */}
                <div className="p-4 rounded-xl"
                  style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.15)" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Terminal className="w-4 h-4 text-agro-green" />
                    <p className="text-xs font-semibold text-agro-green">Após configurar</p>
                  </div>
                  <ul className="space-y-1 text-xs text-agro-muted">
                    <li className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-agro-green shrink-0" /> Chatwoot continua recebendo tudo normalmente</li>
                    <li className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-agro-green shrink-0" /> Solve.AI passa a receber os mesmos eventos em paralelo</li>
                    <li className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-agro-green shrink-0" /> Falha em um não afeta o outro</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Webhook info ─────────────────────── */}
        <div className="animate-fade-up-delay-1">
          <DarkCard title="Informações do Webhook Solve.AI">
            <div className="space-y-4">
              <div>
                <FieldLabel>URL do Webhook (Solve.AI)</FieldLabel>
                <div className="flex gap-2">
                  <input className="input-agro flex-1 font-mono text-xs" value={solveUrl} readOnly />
                  <button
                    onClick={() => copy(solveUrl)}
                    className="w-10 rounded-xl flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors"
                    style={{ border: "1px solid rgba(63,176,108,0.15)", background: "rgba(13,26,17,0.6)" }}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-xl"
                style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}
              >
                <p className="text-xs font-semibold text-blue-400 mb-1">Subscriptions necessárias:</p>
                <p className="text-xs text-agro-muted">
                  ✓ messages &nbsp; ✓ message_deliveries &nbsp; ✓ message_reads &nbsp; ✓ messaging_postbacks
                </p>
              </div>
            </div>
          </DarkCard>
        </div>

      </div>
    </div>
  );
}
