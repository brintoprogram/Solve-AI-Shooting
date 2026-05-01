import { useState } from "react";
import { Mail, Lock, AlertCircle, Eye, EyeOff, CheckCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [showPass, setShowPass]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [mode, setMode]           = useState<"login" | "reset">("login");
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await signIn(email.trim(), password);
    if (err) {
      setError(
        err.includes("Invalid login credentials")
          ? "E-mail ou senha inválidos."
          : err
      );
    }
    setLoading(false);
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setResetLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY },
          body: JSON.stringify({ email: email.trim() }),
        },
      );
      if (!res.ok) throw new Error("Erro ao enviar email");
      setResetSent(true);
    } catch {
      setError("Não foi possível enviar o email. Tente novamente.");
    }
    setResetLoading(false);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "#0a110e" }}
    >
      {/* Ambient glow */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(63,176,108,0.07) 0%, transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Card */}
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

          <h1 className="text-base font-semibold text-agro-text text-center mb-6">
            {mode === "login" ? "Entrar na sua conta" : "Recuperar senha"}
          </h1>

          {/* ── Login form ── */}
          {mode === "login" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-agro-muted">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="input-agro w-full pl-9"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-agro-muted">Senha</label>
                  <button
                    type="button"
                    onClick={() => { setMode("reset"); setError(null); }}
                    className="text-[11px] text-agro-muted-2 hover:text-agro-green transition-colors"
                  >
                    Esqueceu a senha?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
                  <input
                    type={showPass ? "text" : "password"}
                    autoComplete="current-password"
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
                    Entrando...
                  </span>
                ) : "Entrar"}
              </button>
            </form>
          )}

          {/* ── Reset password form ── */}
          {mode === "reset" && (
            <div className="space-y-4">
              {resetSent ? (
                <div
                  className="flex flex-col items-center gap-3 py-4 px-3 rounded-xl text-center"
                  style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.2)" }}
                >
                  <CheckCircle className="w-8 h-8 text-agro-green" />
                  <div>
                    <p className="text-sm font-semibold text-agro-text">E-mail enviado!</p>
                    <p className="text-xs text-agro-muted mt-1">
                      Verifique sua caixa de entrada e clique no link para redefinir sua senha.
                    </p>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleReset} className="space-y-4">
                  <p className="text-xs text-agro-muted leading-relaxed">
                    Digite seu e-mail e enviaremos um link para redefinir sua senha.
                  </p>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-agro-muted">E-mail</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
                      <input
                        type="email"
                        autoComplete="email"
                        placeholder="seu@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="input-agro w-full pl-9"
                      />
                    </div>
                  </div>

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
                    disabled={resetLoading}
                    className="btn-agro w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-60"
                  >
                    {resetLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Enviando...
                      </span>
                    ) : "Enviar link de recuperação"}
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => { setMode("login"); setResetSent(false); setError(null); }}
                className="w-full text-center text-xs text-agro-muted-2 hover:text-agro-muted transition-colors pt-1"
              >
                ← Voltar ao login
              </button>
            </div>
          )}

          <p className="text-center text-[11px] text-agro-muted-2 mt-6 leading-relaxed">
            Não tem acesso?{" "}
            <span className="text-agro-muted">Solicite ao administrador da sua equipe.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
