import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Copy,
  ExternalLink,
  Loader2,
  Database,
  Wifi,
  Rocket,
  ChevronRight,
  AlertTriangle,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveConfig, generateWorkspaceId } from "@/lib/config";
import { createTempClient } from "@/lib/supabase";
import { SETUP_SQL, TABLES_TO_CHECK } from "@/lib/setupSql";
import { cn } from "@/lib/utils";

type TableStatus = "pending" | "ok" | "missing" | "checking";

const TABLE_LABELS: Record<string, string> = {
  meta_connections:   "Conexões WhatsApp",
  meta_templates:     "Templates da Meta",
  shooting_campaigns: "Campanhas de disparo",
  shooting_messages:  "Mensagens individuais",
  shooting_uploads:   "Uploads de planilha",
  webhook_events:     "Log de webhooks",
};

const STEPS = [
  { id: 1, icon: Wifi,     label: "Conectar Supabase" },
  { id: 2, icon: Database, label: "Criar banco de dados" },
  { id: 3, icon: Rocket,   label: "Tudo pronto!" },
];

export function Setup() {
  const [step, setStep]     = useState(1);
  const [url, setUrl]       = useState("");
  const [key, setKey]       = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk]   = useState<boolean | null>(null);
  const [testError, setTestError] = useState("");
  const [copied, setCopied] = useState(false);
  const [tableStatuses, setTableStatuses] = useState<Record<string, TableStatus>>(
    Object.fromEntries(TABLES_TO_CHECK.map((t) => [t, "pending"]))
  );
  const [allTablesOk, setAllTablesOk] = useState(false);
  const [checking, setChecking] = useState(false);

  // ── Step 1: Test connection ──────────────────────────────────
  async function handleTestConnection() {
    setTesting(true);
    setTestOk(null);
    setTestError("");
    try {
      const cleanUrl = url.trim().replace(/\/$/, "");
      const client = createTempClient(cleanUrl, key.trim());
      // Simple ping: list tables in information_schema
      const { error } = await client
        .from("meta_connections")
        .select("id")
        .limit(1);

      // PGRST200 = table not found but connection works
      // 42P01 = table not found but connection works
      // Other errors = real connection problem
      const isConnError =
        error &&
        !error.message.includes("does not exist") &&
        !error.message.includes("relation") &&
        !error.message.includes("42P01") &&
        !error.message.includes("PGRST");

      if (isConnError) {
        setTestOk(false);
        setTestError(error?.message ?? "Não foi possível conectar. Verifique a URL e a chave.");
      } else {
        setTestOk(true);
        // Save config
        saveConfig({
          supabaseUrl:      url.trim().replace(/\/$/, ""),
          supabaseAnonKey:  key.trim(),
          workspaceId:      generateWorkspaceId(),
        });
      }
    } catch (e) {
      setTestOk(false);
      setTestError(e instanceof Error ? e.message : "Erro desconhecido.");
    } finally {
      setTesting(false);
    }
  }

  // ── Step 2: Copy SQL ─────────────────────────────────────────
  function handleCopy() {
    navigator.clipboard.writeText(SETUP_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // ── Step 2: Verify tables ────────────────────────────────────
  async function handleVerify() {
    setChecking(true);
    setAllTablesOk(false);
    const cfg = { supabaseUrl: url.trim().replace(/\/$/, ""), supabaseAnonKey: key.trim() };
    const client = createTempClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

    const newStatuses = { ...tableStatuses };
    for (const table of TABLES_TO_CHECK) {
      newStatuses[table] = "checking";
      setTableStatuses({ ...newStatuses });

      const { error } = await client.from(table as "meta_connections").select("id").limit(1);
      const exists =
        !error ||
        error.message.includes("Results contain 0 rows") ||
        error.code === "PGRST116"; // empty result

      newStatuses[table] = exists ? "ok" : "missing";
      setTableStatuses({ ...newStatuses });
    }

    const allOk = Object.values(newStatuses).every((s) => s === "ok");
    setAllTablesOk(allOk);
    setChecking(false);
  }

  // ── Step 3: Enter app ────────────────────────────────────────
  function handleEnterApp() {
    window.location.reload(); // Reinicia com as credenciais salvas no localStorage
  }

  const supabaseEditorUrl = url
    ? `${url.replace(/\/$/, "").replace("https://", "https://supabase.com/dashboard/project/").split(".supabase.co")[0]}/editor`
    : "https://supabase.com/dashboard";

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-green-500 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Solve AI Shooting</h1>
          <p className="text-gray-500 text-sm mt-1">Configuração inicial — leva menos de 5 minutos</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                  step === s.id
                    ? "bg-green-500 text-white shadow-md"
                    : step > s.id
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-400"
                )}
              >
                <s.icon className="w-3.5 h-3.5" />
                {s.label}
              </div>
              {i < STEPS.length - 1 && (
                <ChevronRight className={cn("w-4 h-4", step > s.id ? "text-green-400" : "text-gray-300")} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">

          {/* ── STEP 1: Credentials ─────────────────────────── */}
          {step === 1 && (
            <div className="p-8 space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Conecte seu Supabase</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Você precisa de uma conta gratuita no Supabase.{" "}
                  <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-green-600 hover:underline">
                    Criar conta grátis →
                  </a>
                </p>
              </div>

              {/* Instructions */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-2">
                <p className="font-semibold">Como encontrar suas credenciais:</p>
                <ol className="list-decimal list-inside space-y-1 text-blue-700">
                  <li>Acesse <span className="font-mono bg-blue-100 px-1 rounded">supabase.com/dashboard</span></li>
                  <li>Selecione seu projeto (ou crie um novo)</li>
                  <li>Vá em <span className="font-semibold">Settings → API</span></li>
                  <li>Copie a <span className="font-semibold">Project URL</span> e a <span className="font-semibold">anon key</span></li>
                </ol>
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-blue-600 font-semibold hover:underline mt-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir Supabase Dashboard
                </a>
              </div>

              {/* URL field */}
              <div className="space-y-2">
                <Label className="font-semibold">Project URL</Label>
                <Input
                  placeholder="https://xxxxxxxx.supabase.co"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setTestOk(null); }}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-gray-400">Começa com https:// e termina com .supabase.co</p>
              </div>

              {/* Anon key field */}
              <div className="space-y-2">
                <Label className="font-semibold">Anon Key (chave pública)</Label>
                <div className="relative">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    value={key}
                    onChange={(e) => { setKey(e.target.value); setTestOk(null); }}
                    className="font-mono text-sm pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-400">Use a <span className="font-semibold">anon / public</span> key, não a service_role</p>
              </div>

              {/* Test result */}
              {testOk === true && (
                <div className="flex items-center gap-2.5 rounded-xl bg-green-50 border border-green-200 p-3 text-green-700 text-sm font-medium">
                  <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                  Conexão bem-sucedida! Supabase conectado.
                </div>
              )}
              {testOk === false && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-red-700 text-sm font-medium">
                    <XCircle className="w-4 h-4 shrink-0" />
                    Não foi possível conectar
                  </div>
                  <p className="text-xs text-red-600 ml-6">{testError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={!url || !key || testing}
                  onClick={handleTestConnection}
                >
                  {testing ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testando...</>
                  ) : (
                    <><Wifi className="w-4 h-4 mr-2" />Testar conexão</>
                  )}
                </Button>
                <Button
                  className="flex-1"
                  disabled={!testOk}
                  onClick={() => setStep(2)}
                >
                  Próximo
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP 2: SQL ─────────────────────────────────── */}
          {step === 2 && (
            <div className="p-8 space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Criar as tabelas do banco</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Você vai copiar um script SQL e rodar no Supabase. É simples!
                </p>
              </div>

              {/* Step by step instructions */}
              <div className="space-y-3">
                {[
                  {
                    n: "1",
                    title: "Copie o script abaixo",
                    desc: 'Clique no botão "Copiar SQL"',
                  },
                  {
                    n: "2",
                    title: "Abra o SQL Editor do Supabase",
                    desc: (
                      <a
                        href={supabaseEditorUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-green-600 hover:underline font-medium"
                      >
                        Clique aqui para abrir <ExternalLink className="w-3 h-3" />
                      </a>
                    ),
                  },
                  {
                    n: "3",
                    title: 'Cole e clique em "RUN"',
                    desc: "Use Ctrl+V para colar e depois clique no botão verde RUN",
                  },
                  {
                    n: "4",
                    title: 'Clique em "Verificar instalação"',
                    desc: "O sistema vai checar se todas as tabelas foram criadas",
                  },
                ].map((item) => (
                  <div key={item.n} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-green-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {item.n}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{item.title}</p>
                      <p className="text-xs text-gray-500">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* SQL preview */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gray-800 px-4 py-2.5 flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-400">setup.sql</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <><CheckCircle className="w-3.5 h-3.5 mr-1.5 text-green-500" />Copiado!</>
                    ) : (
                      <><Copy className="w-3.5 h-3.5 mr-1.5" />Copiar SQL</>
                    )}
                  </Button>
                </div>
                <div className="bg-gray-900 p-4 max-h-40 overflow-y-auto scrollbar-thin">
                  <pre className="text-[11px] text-gray-300 font-mono leading-relaxed whitespace-pre-wrap">
                    {SETUP_SQL.slice(0, 500)}...
                  </pre>
                </div>
              </div>

              {/* Table verification */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">Status das tabelas</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleVerify}
                    disabled={checking}
                  >
                    {checking ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Verificando...</>
                    ) : (
                      <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Verificar instalação</>
                    )}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {TABLES_TO_CHECK.map((table) => {
                    const status = tableStatuses[table];
                    return (
                      <div
                        key={table}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                          status === "ok"
                            ? "border-green-200 bg-green-50 text-green-700"
                            : status === "missing"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : status === "checking"
                            ? "border-blue-200 bg-blue-50 text-blue-600"
                            : "border-gray-200 bg-gray-50 text-gray-500"
                        )}
                      >
                        {status === "ok" && <CheckCircle className="w-3.5 h-3.5 shrink-0" />}
                        {status === "missing" && <XCircle className="w-3.5 h-3.5 shrink-0" />}
                        {status === "checking" && <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />}
                        {status === "pending" && <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 shrink-0" />}
                        <span className="truncate font-medium">{TABLE_LABELS[table]}</span>
                      </div>
                    );
                  })}
                </div>

                {Object.values(tableStatuses).some((s) => s === "missing") && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Algumas tabelas não foram encontradas. Certifique-se de ter colado o SQL
                      completo e clicado em <span className="font-semibold">RUN</span> no Supabase.
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Voltar
                </Button>
                <Button
                  className="flex-1"
                  disabled={!allTablesOk}
                  onClick={() => setStep(3)}
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Success ──────────────────────────────── */}
          {step === 3 && (
            <div className="p-8 text-center space-y-6">
              <div className="relative">
                <div className="w-20 h-20 rounded-2xl bg-green-500 flex items-center justify-center mx-auto shadow-xl">
                  <Rocket className="w-10 h-10 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 left-0 right-0 flex justify-center">
                  <div className="w-6 h-6 rounded-full bg-green-400 animate-ping opacity-30" />
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900">Tudo configurado!</h2>
                <p className="text-gray-500 mt-2 text-sm leading-relaxed">
                  Seu Supabase está conectado e todas as tabelas foram criadas com sucesso.
                  Agora você pode começar a criar campanhas de disparo.
                </p>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700 space-y-1.5 text-left">
                <p className="font-semibold text-green-800">O que você pode fazer agora:</p>
                <ul className="space-y-1">
                  <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Adicionar sua conta WhatsApp Business</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Sincronizar templates da Meta</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Criar e disparar campanhas</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Acompanhar entrega em tempo real</li>
                </ul>
              </div>

              <Button size="xl" className="w-full" onClick={handleEnterApp}>
                <Rocket className="w-5 h-5 mr-2" />
                Entrar no Solve AI Shooting
              </Button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Suas credenciais ficam salvas apenas no seu navegador.
        </p>
      </div>
    </div>
  );
}
