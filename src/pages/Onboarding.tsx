import { useState, useEffect, useRef } from "react";
import { useNavigate }                  from "react-router-dom";
import { Leaf, CheckCircle, AlertCircle, Loader2, ChevronRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { log } from "@/lib/logger";

const META_APP_ID    = (import.meta.env.VITE_META_APP_ID   as string) ?? "";
const META_CONFIG_ID = (import.meta.env.VITE_META_CONFIG_ID as string) ?? "";
const SUPABASE_URL   = (import.meta.env.VITE_SUPABASE_URL   as string) ?? "";

// Versão do SDK do Facebook. Estava em v19.0 (fev/2024) enquanto o painel da
// Meta recomenda v26.0 — coexistência exige versão recente. Manter numa
// constante evita que as duas chamadas a FB.init divirjam de novo.
const FB_SDK_VERSION = "v26.0";

declare global {
  interface Window {
    // deno-lint-ignore no-explicit-any
    FB: any;
    fbAsyncInit: () => void;
  }
}

type Step = "idle" | "sdk_loading" | "waiting_user" | "processing" | "success" | "error";

export function Onboarding() {
  const navigate              = useNavigate();
  const [step, setStep]       = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const sdkLoaded             = useRef(false);
  const { workspaceId }       = useAuth();
  const WORKSPACE_ID          = workspaceId ?? "";

  // ── Load FB JS SDK once ────────────────────────────────────────────
  useEffect(() => {
    if (sdkLoaded.current || !META_APP_ID) return;
    sdkLoaded.current = true;

    // If SDK already loaded from a previous navigation, just re-init
    if (window.FB) {
      window.FB.init({ appId: META_APP_ID, version: FB_SDK_VERSION, xfbml: false, cookie: true });
      return;
    }

    setStep("sdk_loading");

    window.fbAsyncInit = function () {
      window.FB.init({ appId: META_APP_ID, version: FB_SDK_VERSION, xfbml: false, cookie: true });
      setStep("idle");
    };

    const existing = document.getElementById("facebook-jssdk");
    if (!existing) {
      const script       = document.createElement("script");
      script.id          = "facebook-jssdk";
      script.async       = true;
      script.src         = "https://connect.facebook.net/en_US/sdk.js";
      script.crossOrigin = "anonymous";
      script.onerror     = () => {
        setStep("error");
        setErrorMsg(
          "Não foi possível carregar o SDK do Facebook. " +
          "Verifique sua conexão ou desative extensões que bloqueiam scripts (ex: uBlock Origin)."
        );
      };
      document.body.appendChild(script);
    } else {
      // Script tag exists but FB might already be available
      if (window.FB) setStep("idle");
    }
  }, []);

  // ── Listen for WA_EMBEDDED_SIGNUP window messages ─────────────────
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      ) return;

      // deno-lint-ignore no-explicit-any
      let data: any;
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch { return; }

      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;

      // Session logging: a Meta EXIGE que o parceiro registre estes eventos.
      // Logamos só o nome do evento e se os IDs vieram — nunca os IDs em si,
      // que identificam a conta do cliente.
      log.info("embedded_signup_event", {
        signup_event: String(data.event ?? "?"),
        has_waba:     !!data.data?.waba_id,
        has_phone:    !!data.data?.phone_number_id,
      });

      // "FINISH"                                → número novo, registrado por nós
      // "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" → coexistência: o cliente mantém
      //   o app WhatsApp Business e a Meta devolve APENAS o waba_id.
      //   A versão anterior tratava só "FINISH" e exigia phone_number_id, então
      //   a coexistência falhava sempre com "IDs não recebidos".
      if (data.event === "FINISH" || data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
        const { phone_number_id, waba_id } = data.data ?? {};
        if (waba_id)         sessionStorage.setItem("_ob_waba",  waba_id);
        if (phone_number_id) sessionStorage.setItem("_ob_phone", phone_number_id);
        if (data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
          sessionStorage.setItem("_ob_coex", "1");
        }
      } else if (data.event === "ERROR" || data.event === "CANCEL") {
        log.warn("embedded_signup_aborted", { signup_event: String(data.event) });
        setStep("error");
        setErrorMsg("Fluxo cancelado ou erro reportado pela Meta.");
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // ── Trigger FB.login ───────────────────────────────────────────────
  function handleConnect() {
    if (!META_APP_ID || !META_CONFIG_ID) {
      setStep("error");
      setErrorMsg(
        !META_APP_ID
          ? "VITE_META_APP_ID não configurada no ambiente."
          : "VITE_META_CONFIG_ID não configurada no ambiente."
      );
      return;
    }

    if (!window.FB) {
      setStep("error");
      setErrorMsg(
        "SDK do Facebook ainda não carregou. Aguarde 2-3 segundos e tente novamente. " +
        "Se o problema persistir, verifique se há extensões bloqueando scripts externos (ex: uBlock Origin)."
      );
      return;
    }

    // Clear any stale session storage values
    sessionStorage.removeItem("_ob_phone");
    sessionStorage.removeItem("_ob_waba");

    setStep("waiting_user");

    try {
    window.FB.login(
      // deno-lint-ignore no-explicit-any
      (response: any) => { void (async () => {
        const code = response?.authResponse?.code;

        if (!code) {
          // User closed the dialog without completing
          setStep("idle");
          return;
        }

        const waba_id         = sessionStorage.getItem("_ob_waba")  ?? "";
        const phone_number_id = sessionStorage.getItem("_ob_phone") ?? "";
        const coexistence     = sessionStorage.getItem("_ob_coex") === "1";

        // Na coexistência o phone_number_id NÃO vem — o servidor descobre pela
        // WABA. Exigir os dois aqui era o que travava esse fluxo.
        if (!waba_id) {
          log.error("embedded_signup_missing_waba", { coexistence });
          setStep("error");
          setErrorMsg(
            "A Meta não devolveu a identificação da conta. " +
            "Conclua todas as etapas do popup sem fechá-lo e tente de novo."
          );
          return;
        }

        sessionStorage.removeItem("_ob_waba");
        sessionStorage.removeItem("_ob_phone");
        sessionStorage.removeItem("_ob_coex");

        setStep("processing");

        try {
          // A função exige sessão: sem o token, qualquer um poderia anexar um
          // número ao workspace de outro cliente.
          const { data: session } = await supabase.auth.getSession();
          const accessToken = session.session?.access_token;
          if (!accessToken) throw new Error("Sua sessão expirou. Entre novamente e repita a conexão.");

          const res = await fetch(`${SUPABASE_URL}/functions/v1/embedded-signup`, {
            method:  "POST",
            headers: {
              "Content-Type":  "application/json",
              "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              code, waba_id, workspace_id: WORKSPACE_ID,
              ...(phone_number_id ? { phone_number_id } : {}),
              ...(coexistence ? { coexistence: true } : {}),
            }),
          });

          const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };

          if (!res.ok || !data.ok) {
            throw new Error(data.error ?? `Erro HTTP ${res.status}`);
          }

          log.info("embedded_signup_connected", { coexistence });
          setStep("success");
          setTimeout(() => navigate("/primeiros-passos"), 2500);

        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error("embedded_signup_failed", { err: msg, coexistence });
          setStep("error");
          setErrorMsg(msg);
        }
      })(); },
      {
        config_id:                      META_CONFIG_ID,
        response_type:                  "code",
        override_default_response_type: true,
        scope: "whatsapp_business_management,whatsapp_business_messaging",
        extras: {
          // Enables coexistence: user keeps the WA Business App + Cloud API simultaneously
          // Coexistência: o cliente mantém o app WhatsApp Business no celular
          // e ganha a Cloud API no mesmo número. Precisa estar habilitado
          // também na configuração do Embedded Signup no painel da Meta.
          featureType:        "whatsapp_business_app_onboarding",
          // v3 é a versão que entrega o evento
          // FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING.
          sessionInfoVersion: 3,
        },
      }
    );
    } catch (err) {
      setStep("error");
      setErrorMsg(
        "Não foi possível abrir o diálogo do Facebook. " +
        "Verifique se pop-ups estão liberados para este site e tente novamente. " +
        `(${String(err)})`
      );
    }
  }

  // ── UI ─────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "#0a110e" }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 space-y-6"
        style={{
          background:    "rgba(13,26,17,0.9)",
          border:        "1px solid rgba(63,176,108,0.15)",
          backdropFilter: "blur(20px)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
          >
            <Leaf className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-agro-text">Solve AI</p>
            <p className="text-xs text-agro-muted">Conectar WhatsApp Business</p>
          </div>
        </div>

        {/* ── Idle ── */}
        {step === "idle" && (
          <>
            <div>
              <h1 className="text-xl font-bold text-agro-text mb-2">
                Conecte seu WhatsApp
              </h1>
              <p className="text-sm text-agro-muted leading-relaxed">
                Clique no botão abaixo para abrir o fluxo de conexão da Meta. Você irá
                fazer login com sua conta do Facebook Business e selecionar o número
                que deseja conectar à plataforma.
              </p>
            </div>

            <div
              className="rounded-xl p-4 space-y-2"
              style={{
                background: "rgba(63,176,108,0.05)",
                border:     "1px solid rgba(63,176,108,0.1)",
              }}
            >
              <p className="text-xs font-semibold text-agro-muted-2 uppercase tracking-widest">
                O que acontecerá
              </p>
              {[
                "Login no Facebook Business Manager",
                "Seleção da conta WABA e número de telefone",
                "Permissões de envio concedidas à Solve AI",
                "Coexistência ativada: você mantém o app e a Cloud API",
                "Número conectado e webhooks configurados automaticamente",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2">
                  <ChevronRight className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-agro-muted">{item}</p>
                </div>
              ))}
            </div>

            <button
              onClick={handleConnect}
              disabled={step === "sdk_loading"}
              className="w-full py-3 rounded-xl font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, #1877F2, #0d65d9)" }}
            >
              {step === "sdk_loading" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando SDK…
                </>
              ) : "Continuar com o Facebook"}
            </button>
            <button
              onClick={() => navigate("/settings")}
              className="w-full py-2 rounded-xl text-sm text-agro-muted hover:text-agro-text transition-colors"
            >
              Cancelar
            </button>

          </>
        )}

        {/* ── Waiting for user in FB dialog ── */}
        {step === "waiting_user" && (
          <div className="text-center space-y-4 py-6">
            <Loader2 className="w-10 h-10 text-green-400 animate-spin mx-auto" />
            <p className="text-agro-text font-medium">Aguardando a Meta...</p>
            <p className="text-sm text-agro-muted">
              Complete o fluxo na janela que abriu. Se ela não apareceu, verifique se
              pop-ups estão bloqueados no navegador.
            </p>
            <button
              onClick={() => setStep("idle")}
              className="text-xs text-agro-muted underline hover:text-agro-text transition-colors"
            >
              Cancelar
            </button>
          </div>
        )}

        {/* ── Processing (calling edge function) ── */}
        {step === "processing" && (
          <div className="text-center space-y-4 py-6">
            <Loader2 className="w-10 h-10 text-green-400 animate-spin mx-auto" />
            <p className="text-agro-text font-medium">Processando conexão...</p>
            <p className="text-sm text-agro-muted">
              Salvando credenciais e configurando webhooks. Aguarde.
            </p>
          </div>
        )}

        {/* ── Success ── */}
        {step === "success" && (
          <div className="text-center space-y-4 py-6">
            <CheckCircle className="w-14 h-14 text-green-400 mx-auto" />
            <p className="text-agro-text font-semibold text-xl">Conectado com sucesso!</p>
            <p className="text-sm text-agro-muted">
              Seu número está pronto. Redirecionando para as configurações...
            </p>
          </div>
        )}

        {/* ── Error ── */}
        {step === "error" && (
          <div className="text-center space-y-4 py-6">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
            <p className="text-agro-text font-semibold text-lg">Erro na conexão</p>
            <p className="text-sm text-agro-muted break-words">{errorMsg}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setStep("idle")}
                className="px-5 py-2 rounded-xl text-sm font-medium text-agro-text transition-colors hover:opacity-80"
                style={{
                  background: "rgba(63,176,108,0.1)",
                  border:     "1px solid rgba(63,176,108,0.2)",
                }}
              >
                Tentar novamente
              </button>
              <button
                onClick={() => navigate("/settings")}
                className="px-5 py-2 rounded-xl text-sm text-agro-muted hover:text-agro-text transition-colors"
              >
                Ir para configurações
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
