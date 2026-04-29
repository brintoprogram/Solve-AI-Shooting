import { useState, useEffect } from "react";
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

const COPY = {
  invite: {
    title:  "Bem-vindo à Solve AI",
    sub:    "Defina uma senha para acessar sua conta.",
    label:  "Criar senha",
    button: "Entrar na plataforma",
  },
  recovery: {
    title:  "Redefinir senha",
    sub:    "Crie uma nova senha para a sua conta.",
    label:  "Nova senha",
    button: "Salvar nova senha",
  },
} as const;

export function SetPassword() {
  const { user, setupType, clearSetupType } = useAuth();
  const copy = COPY[setupType ?? "recovery"];

  // Track whether the auth session is ready, still loading, or expired
  const [sessionState, setSessionState] = useState<"checking" | "ready" | "expired">("checking");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [done, setDone]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Wait for the session to be confirmed via auth context.
  // For PKCE invite flows the code exchange is async — we give it up to 8 seconds.
  useEffect(() => {
    if (user) {
      setSessionState("ready");
      return;
    }

    const timeout = setTimeout(() => setSessionState("expired"), 8000);
    return () => clearTimeout(timeout);
  }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({
      password,
      data: { workspace_invite_token: null },
    });
    setLoading(false);

    if (err) {
      if (err.message.toLowerCase().includes("session") || err.message.toLowerCase().includes("authenticated")) {
        setError("Link expirado ou já utilizado. Solicite um novo convite ao administrador.");
      } else {
        setError("Não foi possível definir a senha. Tente novamente.");
      }
      return;
    }

    setDone(true);
    setTimeout(() => clearSetupType(), 1800);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "#0a110e" }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(63,176,108,0.07) 0%, transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-sm">
        <div
          className="rounded-2xl p-8"
          style={{
            background: "rgba(13,26,17,0.85)",
            backdropFilter: "blur(24px)",
            border: "1px solid rgba(63,176,108,0.15)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.5), inset 0 0 40px rgba(63,176,108,0.02)",
          }}
        >
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <img
              src="/logo.png"
              alt="Solve AI"
              className="h-32 w-auto object-contain mb-3"
              style={{ filter: "drop-shadow(0 0 24px rgba(63,176,108,0.35))" }}
            />
            <p className="font-display text-lg font-bold tracking-widest text-agro-text uppercase">
              SOLVE <span className="text-agro-green">.AI</span>
            </p>
            <p className="text-[11px] text-agro-muted-2 mt-0.5 tracking-wide">
              A inteligência que cultiva resultados
            </p>
          </div>

          {done ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle className="w-10 h-10 text-agro-green" />
              <p className="text-base font-semibold text-agro-text">Senha definida!</p>
              <p className="text-xs text-agro-muted">Redirecionando para o painel...</p>
            </div>
          ) : sessionState === "checking" ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Loader2 className="w-8 h-8 text-agro-green animate-spin" />
              <p className="text-sm text-agro-muted">Verificando seu link de acesso...</p>
            </div>
          ) : sessionState === "expired" ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm font-semibold text-agro-text">Link expirado</p>
              <p className="text-xs text-agro-muted">
                Este link de convite já foi utilizado ou expirou.
                Solicite um novo convite ao administrador.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-base font-semibold text-agro-text text-center mb-1">
                {copy.title}
              </h1>
              <p className="text-xs text-agro-muted text-center mb-6">{copy.sub}</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-agro-muted">{copy.label}</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
                    <input
                      type={showPass ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="input-agro w-full pl-9 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-agro-muted-2 hover:text-agro-muted transition-colors"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-agro-muted">Confirmar senha</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
                    <input
                      type={showConf ? "text" : "password"}
                      placeholder="••••••••"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      className="input-agro w-full pl-9 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConf((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-agro-muted-2 hover:text-agro-muted transition-colors"
                    >
                      {showConf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Strength hint */}
                <p className="text-[11px] text-agro-muted-2">Mínimo de 8 caracteres.</p>

                {error && (
                  <div
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-red-400"
                    style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
                  >
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-agro w-full py-3 rounded-xl text-sm font-bold text-white mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Salvando...
                    </span>
                  ) : copy.button}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
