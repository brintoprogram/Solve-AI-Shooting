import { useState } from "react";
import {
  CheckCircle, XCircle, Copy, ExternalLink, Loader2,
  Database, Wifi, Rocket, ChevronRight, AlertTriangle, Eye, EyeOff, RefreshCw, Leaf,
} from "lucide-react";
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
  { id: 1, icon: Wifi,     label: "Supabase" },
  { id: 2, icon: Database, label: "Banco de dados" },
  { id: 3, icon: Rocket,   label: "Pronto!" },
];

export function Setup() {
  const [step, setStep]         = useState(1);
  const [url, setUrl]           = useState("");
  const [key, setKey]           = useState("");
  const [showKey, setShowKey]   = useState(false);
  const [testing, setTesting]   = useState(false);
  const [testOk, setTestOk]     = useState<boolean | null>(null);
  const [testError, setTestError] = useState("");
  const [copied, setCopied]     = useState(false);
  const [tableStatuses, setTableStatuses] = useState<Record<string, TableStatus>>(
    Object.fromEntries(TABLES_TO_CHECK.map((t) => [t, "pending"]))
  );
  const [allTablesOk, setAllTablesOk] = useState(false);
  const [checking, setChecking] = useState(false);

  async function handleTestConnection() {
    setTesting(true);
    setTestOk(null);
    setTestError("");
    try {
      const cleanUrl = url.trim().replace(/\/$/, "");
      const client = createTempClient(cleanUrl, key.trim());
      const { error } = await client.from("meta_connections").select("id").limit(1);
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
        saveConfig({ supabaseUrl: cleanUrl, supabaseAnonKey: key.trim(), workspaceId: generateWorkspaceId() });
      }
    } catch (e) {
      setTestOk(false);
      setTestError(e instanceof Error ? e.message : "Erro desconhecido.");
    } finally {
      setTesting(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(SETUP_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleVerify() {
    setChecking(true);
    setAllTablesOk(false);
    const client = createTempClient(url.trim().replace(/\/$/, ""), key.trim());
    const newStatuses = { ...tableStatuses };
    for (const table of TABLES_TO_CHECK) {
      newStatuses[table] = "checking";
      setTableStatuses({ ...newStatuses });
      const { error } = await client.from(table as "meta_connections").select("id").limit(1);
      const exists = !error || error.message.includes("Results contain 0 rows") || error.code === "PGRST116";
      newStatuses[table] = exists ? "ok" : "missing";
      setTableStatuses({ ...newStatuses });
    }
    const allOk = Object.values(newStatuses).every((s) => s === "ok");
    setAllTablesOk(allOk);
    setChecking(false);
  }

  function handleEnterApp() {
    window.location.reload();
  }

  const supabaseEditorUrl = url
    ? `${url.replace(/\/$/, "").replace("https://", "https://supabase.com/dashboard/project/").split(".supabase.co")[0]}/editor`
    : "https://supabase.com/dashboard";

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#0a110e" }}>
      <div className="w-full max-w-xl">

        {/* ── Logo ──────────────────────────────── */}
        <div className="text-center mb-8 animate-fade-up">
          <div className="relative inline-block">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 glow-green"
              style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
            >
              <Leaf className="w-7 h-7 text-white" />
            </div>
            <div className="absolute inset-0 rounded-2xl border border-agro-green opacity-40 animate-ping" />
          </div>
          <p className="font-display text-xl font-bold tracking-widest text-agro-text uppercase">
            SOLVE <span className="text-agro-green">.AI</span>
          </p>
          <p className="text-agro-muted text-sm mt-1">Configuração inicial · menos de 5 minutos</p>
        </div>

        {/* ── Step indicators ───────────────────── */}
        <div className="flex items-center justify-center gap-2 mb-8 animate-fade-up">
          {STEPS.map((s, i) => {
            const isDone   = step > s.id;
            const isActive = step === s.id;
            return (
              <div key={s.id} className="flex items-center gap-2">
                <div className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300",
                )}
                  style={isActive ? {
                    background: "rgba(63,176,108,0.15)",
                    border: "1px solid rgba(63,176,108,0.4)",
                    color: "#3fb06c",
                    boxShadow: "0 0 12px rgba(63,176,108,0.2)",
                  } : isDone ? {
                    background: "rgba(63,176,108,0.1)",
                    border: "1px solid rgba(63,176,108,0.2)",
                    color: "#3fb06c",
                  } : {
                    background: "rgba(26,46,34,0.4)",
                    border: "1px solid rgba(63,176,108,0.08)",
                    color: "#6b8f77",
                  }}
                >
                  <s.icon className="w-3.5 h-3.5" />
                  {s.label}
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight className={cn("w-4 h-4", isDone ? "text-agro-green" : "text-agro-muted-2")} />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Card ─────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden animate-fade-up-delay-1"
          style={{
            background: "rgba(13,26,17,0.85)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(63,176,108,0.15)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }}
        >
          {/* Top accent */}
          <div className="h-px mx-8"
            style={{ background: "linear-gradient(90deg, transparent, rgba(63,176,108,0.5), transparent)" }}
          />

          {/* ── STEP 1 ───────────────────────────── */}
          {step === 1 && (
            <div className="p-8 space-y-6">
              <div>
                <h2 className="font-display text-xl font-bold text-agro-text">Conecte seu Supabase</h2>
                <p className="text-sm text-agro-muted mt-1">
                  Precisa de uma conta?{" "}
                  <a href="https://supabase.com" target="_blank" rel="noreferrer"
                    className="text-agro-green hover:underline font-medium"
                  >
                    Criar conta grátis →
                  </a>
                </p>
              </div>

              {/* Instructions */}
              <div className="p-4 rounded-xl space-y-2"
                style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}
              >
                <p className="text-xs font-semibold text-blue-400">Como encontrar suas credenciais:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs text-agro-muted">
                  <li>Acesse <span className="font-mono text-agro-text bg-white/5 px-1 rounded">supabase.com/dashboard</span></li>
                  <li>Selecione seu projeto (ou crie um novo)</li>
                  <li>Vá em <span className="font-semibold text-agro-text">Settings → API</span></li>
                  <li>Copie a <span className="font-semibold text-agro-text">Project URL</span> e a <span className="font-semibold text-agro-text">anon key</span></li>
                </ol>
                <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Abrir Supabase Dashboard
                </a>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-1.5">Project URL</p>
                  <input
                    className="input-agro w-full font-mono"
                    placeholder="https://xxxxxxxx.supabase.co"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setTestOk(null); }}
                  />
                  <p className="text-xs text-agro-muted mt-1">Começa com https:// e termina com .supabase.co</p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest mb-1.5">Anon Key (chave pública)</p>
                  <div className="relative">
                    <input
                      type={showKey ? "text" : "password"}
                      className="input-agro w-full font-mono pr-10"
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      value={key}
                      onChange={(e) => { setKey(e.target.value); setTestOk(null); }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-agro-muted hover:text-agro-text transition-colors"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-agro-muted mt-1">Use a <span className="font-semibold text-agro-text">anon / public</span> key, não a service_role</p>
                </div>
              </div>

              {testOk === true && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl text-sm font-medium"
                  style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.25)" }}
                >
                  <CheckCircle className="w-5 h-5 text-agro-green shrink-0" />
                  <span className="text-agro-green">Conexão bem-sucedida! Supabase conectado.</span>
                </div>
              )}
              {testOk === false && (
                <div className="p-3 rounded-xl"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-red-400">
                    <XCircle className="w-4 h-4 shrink-0" />
                    Não foi possível conectar
                  </div>
                  <p className="text-xs text-agro-muted mt-1 ml-6">{testError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  disabled={!url || !key || testing}
                  onClick={handleTestConnection}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors disabled:opacity-50"
                  style={{ border: "1px solid rgba(63,176,108,0.2)" }}
                >
                  {testing ? <><Loader2 className="w-4 h-4 animate-spin" />Testando...</> : <><Wifi className="w-4 h-4" />Testar conexão</>}
                </button>
                <button
                  disabled={!testOk}
                  onClick={() => setStep(2)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white btn-agro disabled:opacity-30"
                  style={!testOk ? { background: "rgba(63,176,108,0.15)", border: "1px solid rgba(63,176,108,0.1)" } : undefined}
                >
                  Próximo
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2 ───────────────────────────── */}
          {step === 2 && (
            <div className="p-8 space-y-6">
              <div>
                <h2 className="font-display text-xl font-bold text-agro-text">Criar as tabelas do banco</h2>
                <p className="text-sm text-agro-muted mt-1">Cole o script SQL no Supabase e rode.</p>
              </div>

              <div className="space-y-3">
                {[
                  { n: "1", title: 'Copie o script SQL abaixo', desc: 'Clique no botão "Copiar SQL"' },
                  { n: "2", title: "Abra o SQL Editor do Supabase", desc: <a href={supabaseEditorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-agro-green hover:underline text-xs font-medium">Clique aqui para abrir <ExternalLink className="w-3 h-3" /></a> },
                  { n: "3", title: 'Cole e clique em "RUN"', desc: 'Use Ctrl+V para colar e depois clique no botão verde RUN' },
                  { n: "4", title: 'Clique em "Verificar instalação"', desc: 'O sistema vai checar se todas as tabelas foram criadas' },
                ].map((item) => (
                  <div key={item.n} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white"
                      style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
                    >
                      {item.n}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-agro-text">{item.title}</p>
                      <p className="text-xs text-agro-muted">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* SQL preview */}
              <div className="rounded-xl overflow-hidden"
                style={{ border: "1px solid rgba(63,176,108,0.12)" }}
              >
                <div className="flex items-center justify-between px-4 py-2.5"
                  style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.1)" }}
                >
                  <span className="text-xs font-mono text-agro-muted">setup.sql</span>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors"
                    style={copied ? {
                      background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)",
                    } : {
                      background: "rgba(255,255,255,0.05)", color: "#8faf9a", border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {copied ? <><CheckCircle className="w-3.5 h-3.5" />Copiado!</> : <><Copy className="w-3.5 h-3.5" />Copiar SQL</>}
                  </button>
                </div>
                <div className="p-4 max-h-36 overflow-y-auto scrollbar-thin"
                  style={{ background: "rgba(8,16,10,0.9)" }}
                >
                  <pre className="text-[11px] text-agro-muted font-mono leading-relaxed whitespace-pre-wrap">
                    {SETUP_SQL.slice(0, 500)}...
                  </pre>
                </div>
              </div>

              {/* Table verification */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-agro-text">Status das tabelas</p>
                  <button
                    onClick={handleVerify}
                    disabled={checking}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-agro-muted hover:text-agro-text transition-colors disabled:opacity-50"
                    style={{ border: "1px solid rgba(63,176,108,0.15)" }}
                  >
                    {checking ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Verificando...</> : <><RefreshCw className="w-3.5 h-3.5" />Verificar instalação</>}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {TABLES_TO_CHECK.map((table) => {
                    const status = tableStatuses[table];
                    return (
                      <div key={table} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all"
                        style={status === "ok" ? {
                          background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.25)", color: "#3fb06c",
                        } : status === "missing" ? {
                          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171",
                        } : status === "checking" ? {
                          background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "#60a5fa",
                        } : {
                          background: "rgba(26,46,34,0.4)", border: "1px solid rgba(63,176,108,0.08)", color: "#6b8f77",
                        }}
                      >
                        {status === "ok"       && <CheckCircle className="w-3.5 h-3.5 shrink-0" />}
                        {status === "missing"  && <XCircle    className="w-3.5 h-3.5 shrink-0" />}
                        {status === "checking" && <Loader2    className="w-3.5 h-3.5 shrink-0 animate-spin" />}
                        {status === "pending"  && <div className="w-3.5 h-3.5 rounded-full border-2 border-current opacity-30 shrink-0" />}
                        <span className="truncate font-medium">{TABLE_LABELS[table]}</span>
                      </div>
                    );
                  })}
                </div>

                {Object.values(tableStatuses).some((s) => s === "missing") && (
                  <div className="flex items-start gap-2 p-3 rounded-xl text-xs"
                    style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#fbbf24" }}
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Algumas tabelas não foram encontradas. Certifique-se de ter colado o SQL completo e clicado em{" "}
                      <span className="font-semibold">RUN</span> no Supabase.
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setStep(1)}
                  className="px-4 py-2.5 rounded-xl text-sm text-agro-muted hover:text-agro-text transition-colors"
                >
                  Voltar
                </button>
                <button
                  disabled={!allTablesOk}
                  onClick={() => setStep(3)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white btn-agro disabled:opacity-30"
                  style={!allTablesOk ? { background: "rgba(63,176,108,0.15)", border: "1px solid rgba(63,176,108,0.1)" } : undefined}
                >
                  <CheckCircle className="w-4 h-4" />
                  Continuar
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3 ───────────────────────────── */}
          {step === 3 && (
            <div className="p-8 text-center space-y-6">
              <div className="relative">
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto glow-green"
                  style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
                >
                  <Rocket className="w-10 h-10 text-white" />
                </div>
                <div className="absolute inset-0 flex justify-center items-center">
                  <div className="w-24 h-24 rounded-2xl border border-agro-green opacity-20 animate-ping" />
                </div>
              </div>

              <div>
                <h2 className="font-display text-2xl font-bold text-agro-text">Tudo configurado!</h2>
                <p className="text-agro-muted mt-2 text-sm leading-relaxed max-w-sm mx-auto">
                  Seu Supabase está conectado e todas as tabelas foram criadas com sucesso.
                  Agora você pode começar a criar campanhas de disparo.
                </p>
              </div>

              <div className="p-4 rounded-xl text-left space-y-2"
                style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.15)" }}
              >
                <p className="text-xs font-semibold text-agro-green">O que você pode fazer agora:</p>
                <ul className="space-y-1.5">
                  {[
                    "Adicionar sua conta WhatsApp Business",
                    "Sincronizar templates da Meta",
                    "Criar e disparar campanhas",
                    "Acompanhar entrega em tempo real",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2 text-xs text-agro-muted">
                      <CheckCircle className="w-4 h-4 text-agro-green shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={handleEnterApp}
                className="btn-agro w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white"
              >
                <Rocket className="w-5 h-5" />
                Entrar no Solve AI Shooting
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-agro-muted-2 mt-4">
          Suas credenciais ficam salvas apenas no seu navegador.
        </p>
      </div>
    </div>
  );
}
