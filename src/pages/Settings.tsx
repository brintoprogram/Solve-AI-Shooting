import { useState } from "react";
import { RefreshCw, CheckCircle, XCircle, Copy, Wifi, Settings2, Trash2 } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { getPhoneNumberInfo } from "@/services/metaApi";
import { getConfig, clearConfig } from "@/lib/config";
import { useToast } from "@/hooks/use-toast";

const WORKSPACE_ID = "demo-workspace-id";

function genVerifyToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function Settings() {
  const { connections, upsertConnection } = useMetaConnections(WORKSPACE_ID);
  const { toast } = useToast();
  const currentConfig = getConfig();

  function handleResetSetup() {
    if (confirm("Isso vai apagar as credenciais do Supabase e voltar para a tela de configuração. Continuar?")) {
      clearConfig();
      window.location.reload();
    }
  }

  const [form, setForm] = useState({
    waba_id: "",
    phone_number_id: "",
    access_token: "",
    webhook_verify_token: genVerifyToken(),
  });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; info?: string } | null>(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const info = await getPhoneNumberInfo(form.phone_number_id, form.access_token);
      setTestResult({
        ok: true,
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
    } catch (err) {
      toast({ title: "Erro ao salvar", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const appDomain = import.meta.env.VITE_APP_DOMAIN ?? "https://your-domain.com";
  const webhookUrl = `${appDomain}/api/webhooks/meta/${WORKSPACE_ID}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar breadcrumbs={[{ label: "Configurações" }]} />

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Configurações</h1>
            <p className="text-gray-500 mt-1">Gerencie suas integrações</p>
          </div>
        </div>

        {/* Supabase info */}
        {currentConfig && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center">
                  <Settings2 className="w-4.5 h-4.5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Supabase conectado</p>
                  <p className="text-xs text-gray-400 font-mono truncate max-w-xs">{currentConfig.supabaseUrl}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={handleResetSetup}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Reconfigurar
              </Button>
            </div>
          </div>
        )}

        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-1">WhatsApp Business API</h2>
          <p className="text-gray-500 text-sm">Configure sua integração com a Cloud API da Meta</p>
        </div>

        {/* Existing connections */}
        {connections.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Conexões ativas</h2>
            {connections.map((conn) => (
              <div key={conn.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Wifi className={`w-5 h-5 ${conn.status === "active" ? "text-green-500" : "text-red-500"}`} />
                  <div>
                    <p className="font-semibold text-gray-900">{conn.display_phone}</p>
                    <p className="text-xs text-gray-400">{conn.business_name} · {conn.waba_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {conn.quality_rating && (
                    <Badge variant={conn.quality_rating === "GREEN" ? "default" : conn.quality_rating === "YELLOW" ? "amber" : "destructive"}>
                      {conn.quality_rating}
                    </Badge>
                  )}
                  {conn.messaging_limit && <Badge variant="secondary">{conn.messaging_limit}</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Connection form */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h2 className="text-base font-semibold text-gray-900">
            {connections.length > 0 ? "Adicionar nova conexão" : "Configurar conexão"}
          </h2>

          <div className="space-y-2">
            <Label>WhatsApp Business Account ID (WABA ID) *</Label>
            <Input
              placeholder="123456789012345"
              value={form.waba_id}
              onChange={(e) => setForm({ ...form, waba_id: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Phone Number ID *</Label>
            <Input
              placeholder="100123456789012"
              value={form.phone_number_id}
              onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Access Token (System User Token) *</Label>
            <Input
              type="password"
              placeholder="EAAxxxxxxxxx..."
              value={form.access_token}
              onChange={(e) => setForm({ ...form, access_token: e.target.value })}
            />
            <p className="text-xs text-gray-400">Use um System User Token permanente, não um token de usuário temporário.</p>
          </div>

          {/* Test button */}
          {testResult && (
            <Alert variant={testResult.ok ? "success" : "destructive"}>
              {testResult.ok ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              <AlertTitle>{testResult.ok ? "Conexão bem-sucedida!" : "Falha na conexão"}</AlertTitle>
              <AlertDescription>{testResult.info}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={!form.phone_number_id || !form.access_token || testing}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${testing ? "animate-spin" : ""}`} />
              {testing ? "Testando..." : "Testar conexão"}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.waba_id || !form.phone_number_id || !form.access_token || saving}
            >
              {saving ? "Salvando..." : "Salvar conexão"}
            </Button>
          </div>
        </div>

        {/* Webhook configuration */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Configuração do Webhook</h2>
          <p className="text-sm text-gray-500">
            Configure esses valores no painel Meta for Developers → Seu App → WhatsApp → Configuration → Webhook.
          </p>

          <div className="space-y-2">
            <Label>URL do Webhook</Label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="font-mono text-xs bg-gray-50" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => { navigator.clipboard.writeText(webhookUrl); toast({ title: "Copiado!" }); }}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Verify Token</Label>
            <div className="flex gap-2">
              <Input value={form.webhook_verify_token} readOnly className="font-mono text-xs bg-gray-50" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => { navigator.clipboard.writeText(form.webhook_verify_token); toast({ title: "Copiado!" }); }}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-gray-400">Cole esse token no campo "Verify Token" no painel da Meta.</p>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700 space-y-1">
            <p className="font-semibold">Subscriptions necessárias:</p>
            <p>✓ messages &nbsp; ✓ message_deliveries &nbsp; ✓ message_reads &nbsp; ✓ messaging_postbacks</p>
          </div>
        </div>
      </div>
    </div>
  );
}
