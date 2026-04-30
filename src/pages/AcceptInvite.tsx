import { useState } from "react";
import { Leaf, Mail, Loader2, AlertCircle, CheckCircle } from "lucide-react";

export function AcceptInvite() {
  // The full Supabase confirmation URL is stored in the hash fragment.
  // Hash fragments are never sent to the server, so email scanners can't follow them.
  // The token is only consumed when the user clicks the button and the browser
  // navigates to the actual Supabase verification endpoint.
  const confirmationUrl = window.location.hash.slice(1); // strip leading #
  const [accepting, setAccepting] = useState(false);

  function handleAccept() {
    if (!confirmationUrl) return;
    setAccepting(true);
    window.location.href = confirmationUrl;
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "#0a110e" }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 space-y-6"
        style={{
          background:     "rgba(13,26,17,0.9)",
          border:         "1px solid rgba(63,176,108,0.15)",
          boxShadow:      "0 20px 60px rgba(0,0,0,0.5)",
          backdropFilter: "blur(20px)",
        }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #3fb06c 0%, #16A34A 100%)" }}
          >
            <Leaf className="w-7 h-7 text-white" />
          </div>
          <p className="text-xl font-bold text-agro-text font-display">Solve AI</p>
        </div>

        {!confirmationUrl ? (
          <div className="flex items-start gap-3 p-4 rounded-xl"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">Link inválido. Verifique se copiou o link completo do email.</p>
          </div>
        ) : (
          <>
            <div className="text-center space-y-2">
              <div className="flex justify-center">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(63,176,108,0.1)", border: "1px solid rgba(63,176,108,0.2)" }}
                >
                  <Mail className="w-5 h-5 text-agro-green" />
                </div>
              </div>
              <h1 className="text-lg font-semibold text-agro-text">Você foi convidado</h1>
              <p className="text-sm text-agro-muted">
                Clique no botão abaixo para aceitar o convite e criar sua senha de acesso.
              </p>
            </div>

            <button
              disabled={accepting}
              onClick={handleAccept}
              className="btn-agro w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            >
              {accepting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {accepting ? "Redirecionando…" : "Aceitar convite"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
