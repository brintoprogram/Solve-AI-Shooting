// Página pública do convite por link — /entrar/:token
//
// Ela é aberta no celular, dentro do navegador do WhatsApp, por alguém que
// nunca viu o sistema. Isso decide o layout inteiro: uma coluna, campos
// grandes, nada que dependa de hover, e o mínimo de passos entre abrir e
// estar dentro.
//
// O token nunca vira uma consulta ao banco daqui. Tudo passa pela edge
// function invite-link, que é quem tem permissão de ler o convite — e é
// também onde o uso é contado e registrado.

import { useState, useEffect } from "react";
import { Leaf, Loader2, AlertCircle, CheckCircle, Users, ArrowRight, LogIn } from "lucide-react";
import { supabase } from "@/lib/supabase";

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-link`;

interface Espiada {
  valido:     boolean;
  motivo:     string | null;
  workspace?: string;
  role_label?: string;
}

const MOTIVO_TEXTO: Record<string, string> = {
  expirado: "Este convite expirou.",
  revogado: "Este convite foi cancelado.",
  esgotado: "Este convite já foi usado.",
  invalido: "Este link não é válido.",
};

async function chamar(corpo: Record<string, unknown>, token?: string) {
  const res = await fetch(FN, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey":       import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(corpo),
  });
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { /* resposta não-JSON */ }
  return { ok: res.ok, status: res.status, json };
}

export function JoinWorkspace({ token }: { token: string }) {
  const [espiada,  setEspiada]  = useState<Espiada | null>(null);
  const [sessaoEmail, setSessaoEmail] = useState<string | null>(null);
  const [modo,     setModo]     = useState<"criar" | "entrar">("criar");
  const [nome,     setNome]     = useState("");
  const [email,    setEmail]    = useState("");
  const [senha,    setSenha]    = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro,     setErro]     = useState<string | null>(null);
  const [pronto,   setPronto]   = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (vivo && session?.user) setSessaoEmail(session.user.email ?? "");
      const { json } = await chamar({ action: "peek", token });
      if (vivo) setEspiada(json as unknown as Espiada);
    })();
    return () => { vivo = false; };
  }, [token]);

  /** Entra com a sessão que já existe — o caminho de quem já é do time. */
  async function entrarComSessao() {
    setErro(null); setEnviando(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { ok, json } = await chamar({ action: "redeem", token }, session?.access_token);
      if (!ok) { setErro(String(json.error ?? "Não foi possível entrar.")); return; }
      setPronto(true);
      setTimeout(() => { window.location.href = "/"; }, 1200);
    } catch {
      setErro("Erro de conexão. Verifique sua internet.");
    } finally { setEnviando(false); }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null); setEnviando(true);
    try {
      if (modo === "entrar") {
        /* Quem já tem conta faz login aqui mesmo e só depois resgata: assim
           a sessão prova quem é a pessoa, e o link não vira uma forma de
           anexar a conta de outro. */
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(), password: senha,
        });
        if (error || !data.session) {
          setErro(error?.message === "Invalid login credentials"
            ? "E-mail ou senha incorretos."
            : error?.message ?? "Não foi possível entrar.");
          return;
        }
        const { ok, json } = await chamar({ action: "redeem", token }, data.session.access_token);
        if (!ok) { setErro(String(json.error ?? "Não foi possível entrar.")); return; }
      } else {
        const { ok, json } = await chamar({
          action: "redeem", token,
          email: email.trim(), password: senha, full_name: nome.trim(),
        });
        if (!ok) {
          setErro(String(json.error ?? "Não foi possível criar sua conta."));
          if (json.precisa_login) setModo("entrar");
          return;
        }
        // Conta criada pela edge function — agora abre a sessão no navegador.
        await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
      }
      setPronto(true);
      setTimeout(() => { window.location.href = "/"; }, 1200);
    } catch {
      setErro("Erro de conexão. Verifique sua internet.");
    } finally { setEnviando(false); }
  }

  const caixa = {
    background:     "rgba(13,26,17,0.9)",
    border:         "1px solid rgba(63,176,108,0.15)",
    boxShadow:      "0 20px 60px rgba(0,0,0,0.5)",
    backdropFilter: "blur(20px)",
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6" style={{ background: "#0a110e" }}>
      <div className="w-full max-w-md rounded-2xl p-6 sm:p-8 space-y-6" style={caixa}>

        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
               style={{ background: "linear-gradient(135deg, #3fb06c 0%, #16A34A 100%)" }}>
            <Leaf className="w-7 h-7 text-white" />
          </div>
          <p className="text-xl font-bold text-agro-text font-display">Solve AI</p>
        </div>

        {/* ── Carregando ─────────────────────────────────────────── */}
        {!espiada && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-agro-muted-2 animate-spin" />
          </div>
        )}

        {/* ── Link que não vale ──────────────────────────────────── */}
        {espiada && !espiada.valido && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-xl"
                 style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm text-red-400">
                  {MOTIVO_TEXTO[espiada.motivo ?? "invalido"] ?? MOTIVO_TEXTO.invalido}
                </p>
                <p className="text-xs text-agro-muted-2">
                  Peça um novo link para quem te convidou.
                </p>
              </div>
            </div>
            <a href="/" className="block text-center text-sm text-agro-muted hover:text-agro-text transition-colors">
              Ir para a tela de login
            </a>
          </div>
        )}

        {/* ── Entrou ─────────────────────────────────────────────── */}
        {pronto && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle className="w-10 h-10 text-agro-green" />
            <p className="text-base font-semibold text-agro-text">Tudo certo!</p>
            <p className="text-sm text-agro-muted">Levando você para o painel…</p>
          </div>
        )}

        {/* ── Convite válido ─────────────────────────────────────── */}
        {espiada?.valido && !pronto && (
          <>
            <div className="text-center space-y-2">
              <div className="flex justify-center">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                     style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}>
                  <Users className="w-5 h-5 text-agro-green" />
                </div>
              </div>
              <h1 className="text-lg font-semibold text-agro-text">
                Você foi convidado para {espiada.workspace}
              </h1>
              <p className="text-sm text-agro-muted">
                Seu acesso será de <span className="text-agro-green font-medium">{espiada.role_label}</span>.
              </p>
            </div>

            {/* Já está logado: um botão e acabou. */}
            {sessaoEmail ? (
              <div className="space-y-3">
                <div className="px-4 py-3 rounded-xl text-sm text-agro-muted"
                     style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.12)" }}>
                  Conectado como <span className="text-agro-text font-medium break-all">{sessaoEmail}</span>
                </div>
                {erro && <Erro texto={erro} />}
                <button onClick={entrarComSessao} disabled={enviando}
                        className="btn-agro w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60">
                  {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {enviando ? "Entrando…" : "Entrar nesta equipe"}
                </button>
              </div>
            ) : (
              <form onSubmit={enviar} className="space-y-4">
                {modo === "criar" && (
                  <Campo rotulo="Seu nome" >
                    <input type="text" required value={nome} onChange={(e) => setNome(e.target.value)}
                           autoComplete="name" placeholder="João Silva"
                           className="input-agro w-full py-3 text-base" />
                  </Campo>
                )}

                <Campo rotulo="E-mail">
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                         autoComplete="email" inputMode="email" placeholder="nome@empresa.com"
                         className="input-agro w-full py-3 text-base" />
                </Campo>

                <Campo rotulo={modo === "criar" ? "Crie uma senha" : "Senha"}>
                  <input type="password" required value={senha} onChange={(e) => setSenha(e.target.value)}
                         autoComplete={modo === "criar" ? "new-password" : "current-password"}
                         minLength={modo === "criar" ? 8 : undefined}
                         placeholder={modo === "criar" ? "Mínimo 8 caracteres" : "Sua senha"}
                         className="input-agro w-full py-3 text-base" />
                </Campo>

                {erro && <Erro texto={erro} />}

                <button type="submit" disabled={enviando}
                        className="btn-agro w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white disabled:opacity-60">
                  {enviando
                    ? <><Loader2 className="w-4 h-4 animate-spin" />{modo === "criar" ? "Criando…" : "Entrando…"}</>
                    : <>{modo === "criar" ? <CheckCircle className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                        {modo === "criar" ? "Criar conta e entrar" : "Entrar"}</>}
                </button>

                <button type="button" onClick={() => { setModo(modo === "criar" ? "entrar" : "criar"); setErro(null); }}
                        className="w-full text-center text-sm text-agro-muted hover:text-agro-text transition-colors py-1">
                  {modo === "criar" ? "Já tenho uma conta" : "Não tenho conta ainda"}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-agro-muted">{rotulo}</label>
      {children}
    </div>
  );
}

function Erro({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm text-red-400"
         style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{texto}</span>
    </div>
  );
}
