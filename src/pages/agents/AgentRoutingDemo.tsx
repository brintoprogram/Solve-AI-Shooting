import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot, ArrowLeft, Play, RotateCcw, Zap, Brain, GitBranch,
  CheckCircle2, MessageSquare, User, Sparkles, ChevronRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Scenario {
  id:              string;
  label:           string;
  icon:            string;
  tag:             string;
  tagColor:        string;
  messages:        { text: string; delay: number }[];
  keywords:        string[];
  intent:          string;
  intentDetail:    string;
  departments:     { name: string; color: string; score: number }[];
  routeDept:       string;
  routeColor:      string;
  agent:           string;
  agentInitials:   string;
  agentRole:       string;
  confidence:      number;
  promptSnippet:   string;
}

type Phase =
  | "idle"
  | "typing_1" | "msg_1"
  | "typing_2" | "msg_2"
  | "typing_3" | "msg_3"
  | "ai_activated"
  | "ai_reading"
  | "ai_intent"
  | "ai_routing"
  | "ai_assigning"
  | "complete";

// ── Scenarios ─────────────────────────────────────────────────────────────────

const SCENARIOS: Scenario[] = [
  {
    id:           "financial",
    label:        "Cobrança",
    icon:         "💳",
    tag:          "Financeiro",
    tagColor:     "#f59e0b",
    messages: [
      { text: "Boa tarde! Tudo bem?",                                           delay: 0    },
      { text: "Preciso resolver umas faturas em aberto aqui",                   delay: 1600 },
      { text: "Tenho 3 boletos vencidos e não estou conseguindo pagar pelo app", delay: 2800 },
    ],
    keywords:     ["faturas", "boletos", "vencidos", "pagar"],
    intent:       "Problema com cobrança / inadimplência",
    intentDetail: "Cliente relata dificuldade com pagamento de boletos vencidos via plataforma",
    departments:  [
      { name: "Financeiro",  color: "#f59e0b", score: 97 },
      { name: "Suporte",     color: "#60a5fa", score: 14 },
      { name: "Comercial",   color: "#3fb06c", score:  3 },
    ],
    routeDept:    "Financeiro",
    routeColor:   "#f59e0b",
    agent:        "Priscila Matos",
    agentInitials:"PM",
    agentRole:    "Especialista Financeiro",
    confidence:   97,
    promptSnippet:"Se o assunto for boleto, fatura ou pagamento → ROUTE:Financeiro",
  },
  {
    id:           "sales",
    label:        "Vendas",
    icon:         "🚀",
    tag:          "Comercial",
    tagColor:     "#3fb06c",
    messages: [
      { text: "Olá! Vi a divulgação de vocês no Instagram",                     delay: 0    },
      { text: "Já sou cliente há 6 meses e quero ampliar meu contrato",         delay: 1800 },
      { text: "Qual plano me daria mais disparos por mês? Tenho uma base grande", delay: 3000 },
    ],
    keywords:     ["ampliar", "contrato", "plano", "disparos"],
    intent:       "Expansão de contrato / upsell",
    intentDetail: "Cliente existente com interesse em upgrade de plano — alta propensão de conversão",
    departments:  [
      { name: "Comercial",   color: "#3fb06c", score: 94 },
      { name: "Financeiro",  color: "#f59e0b", score: 18 },
      { name: "Suporte",     color: "#60a5fa", score:  5 },
    ],
    routeDept:    "Comercial",
    routeColor:   "#3fb06c",
    agent:        "Rafael Alves",
    agentInitials:"RA",
    agentRole:    "Executivo de Vendas",
    confidence:   94,
    promptSnippet:"Se o assunto for plano, upgrade ou contrato → ROUTE:Comercial",
  },
  {
    id:           "support",
    label:        "Suporte",
    icon:         "🔧",
    tag:          "Técnico",
    tagColor:     "#60a5fa",
    messages: [
      { text: "Bom dia, estou com um problema sério aqui",                      delay: 0    },
      { text: "A plataforma parou de enviar as mensagens do disparo",           delay: 1400 },
      { text: "A campanha estava ativa e de repente parou no meio. Erro 403",   delay: 2600 },
    ],
    keywords:     ["erro", "parou", "mensagens", "disparo", "403"],
    intent:       "Falha técnica na plataforma",
    intentDetail: "Interrupção de campanha ativa com código de erro 403 — prioridade alta",
    departments:  [
      { name: "Suporte",     color: "#60a5fa", score: 98 },
      { name: "Técnico",     color: "#8b5cf6", score: 71 },
      { name: "Comercial",   color: "#3fb06c", score:  2 },
    ],
    routeDept:    "Suporte",
    routeColor:   "#60a5fa",
    agent:        "Lucas Ferreira",
    agentInitials:"LF",
    agentRole:    "Analista de Suporte N2",
    confidence:   98,
    promptSnippet:"Se o assunto for erro, bug ou falha técnica → ROUTE:Suporte",
  },
  {
    id:           "new_lead",
    label:        "Novo Lead",
    icon:         "✨",
    tag:          "Pré-vendas",
    tagColor:     "#a78bfa",
    messages: [
      { text: "Olá! Encontrei vocês no Google",                                 delay: 0    },
      { text: "Trabalho com agro e tenho uma lista de mais de 5 mil contatos",  delay: 1700 },
      { text: "Gostaria de entender como funciona o serviço de disparos",       delay: 2900 },
    ],
    keywords:     ["Google", "lista", "contatos", "disparos", "funciona"],
    intent:       "Novo lead — interesse inicial",
    intentDetail: "Prospect via Google com base de 5k+ contatos — perfil ideal, encaminhar para qualificação",
    departments:  [
      { name: "Pré-vendas",  color: "#a78bfa", score: 96 },
      { name: "Comercial",   color: "#3fb06c", score: 40 },
      { name: "Suporte",     color: "#60a5fa", score:  1 },
    ],
    routeDept:    "Pré-vendas",
    routeColor:   "#a78bfa",
    agent:        "Camila Rocha",
    agentInitials:"CR",
    agentRole:    "SDR / Qualificação",
    confidence:   96,
    promptSnippet:"Se for um novo contato com interesse no produto → ROUTE:Pré-vendas",
  },
  {
    id:           "complaint",
    label:        "Reclamação",
    icon:         "⚠️",
    tag:          "Atendimento",
    tagColor:     "#f87171",
    messages: [
      { text: "Preciso falar com o responsável AGORA",                          delay: 0    },
      { text: "Fui cobrado duas vezes esse mês e ninguém me responde",          delay: 1200 },
      { text: "Se não resolver hoje vou entrar com processo. Isso é um absurdo", delay: 2400 },
    ],
    keywords:     ["cobrado", "duas vezes", "processo", "absurdo", "responsável"],
    intent:       "Reclamação urgente / risco de churn",
    intentDetail: "Cliente insatisfeito com cobrança duplicada — risco crítico de cancelamento e ação judicial",
    departments:  [
      { name: "Atendimento", color: "#f87171", score: 99 },
      { name: "Financeiro",  color: "#f59e0b", score: 85 },
      { name: "Suporte",     color: "#60a5fa", score: 12 },
    ],
    routeDept:    "Atendimento",
    routeColor:   "#f87171",
    agent:        "Amanda Souza",
    agentInitials:"AS",
    agentRole:    "Gerente de Relacionamento",
    confidence:   99,
    promptSnippet:"Se houver urgência, reclamação ou ameaça → ROUTE:Atendimento",
  },
];

// ── Phase timing map ──────────────────────────────────────────────────────────

const PHASE_AFTER: Partial<Record<Phase, Phase>> = {
  typing_1:     "msg_1",
  msg_1:        "typing_2",
  typing_2:     "msg_2",
  msg_2:        "typing_3",
  typing_3:     "msg_3",
  msg_3:        "ai_activated",
  ai_activated: "ai_reading",
  ai_reading:   "ai_intent",
  ai_intent:    "ai_routing",
  ai_routing:   "ai_assigning",
  ai_assigning: "complete",
};

const PHASE_DELAYS: Partial<Record<Phase, number>> = {
  typing_1:     400,
  msg_1:        900,
  typing_2:     600,
  msg_2:        900,
  typing_3:     600,
  msg_3:        1200,
  ai_activated: 700,
  ai_reading:   1800,
  ai_intent:    1400,
  ai_routing:   2200,
  ai_assigning: 1000,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentRoutingDemo() {
  const navigate = useNavigate();
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [phase,       setPhase]       = useState<Phase>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scenario = SCENARIOS[scenarioIdx];

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const advance = useCallback((from: Phase) => {
    const next = PHASE_AFTER[from];
    if (!next) return;
    const delay = PHASE_DELAYS[from] ?? 1000;
    timerRef.current = setTimeout(() => {
      setPhase(next);
      advance(next);
    }, delay);
  }, []);

  function start() {
    clearTimer();
    setPhase("typing_1");
    advance("typing_1");
  }

  function reset() {
    clearTimer();
    setPhase("idle");
  }

  function selectScenario(idx: number) {
    clearTimer();
    setScenarioIdx(idx);
    setPhase("idle");
  }

  useEffect(() => () => clearTimer(), []);

  const visMsg1 = ["msg_1","typing_2","msg_2","typing_3","msg_3","ai_activated","ai_reading","ai_intent","ai_routing","ai_assigning","complete"].includes(phase);
  const visMsg2 = ["msg_2","typing_3","msg_3","ai_activated","ai_reading","ai_intent","ai_routing","ai_assigning","complete"].includes(phase);
  const visMsg3 = ["msg_3","ai_activated","ai_reading","ai_intent","ai_routing","ai_assigning","complete"].includes(phase);
  const showTyping1 = phase === "typing_1";
  const showTyping2 = phase === "typing_2";
  const showTyping3 = phase === "typing_3";
  const aiOn       = ["ai_activated","ai_reading","ai_intent","ai_routing","ai_assigning","complete"].includes(phase);
  const showRead   = ["ai_reading","ai_intent","ai_routing","ai_assigning","complete"].includes(phase);
  const showIntent = ["ai_intent","ai_routing","ai_assigning","complete"].includes(phase);
  const showRoute  = ["ai_routing","ai_assigning","complete"].includes(phase);
  const showResult = ["ai_assigning","complete"].includes(phase);

  const scanning = phase === "ai_reading";
  const isComplete = phase === "complete";

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#060d09" }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center gap-4 px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid rgba(63,176,108,0.12)", background: "rgba(10,17,14,0.8)" }}
      >
        <button
          onClick={() => navigate("/agents")}
          className="flex items-center gap-2 text-xs text-agro-muted hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </button>

        <div className="w-px h-5 bg-white/10" />

        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(63,176,108,0.3), rgba(22,163,74,0.15))", border: "1px solid rgba(63,176,108,0.3)" }}
          >
            <Brain className="w-4 h-4" style={{ color: "#3fb06c" }} />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Demo: Roteamento Inteligente</p>
            <p className="text-[10px] text-agro-muted">IA lê o contexto e distribui para o setor certo em segundos</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "rgba(63,176,108,0.1)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-agro-green animate-pulse" />
            Modo Apresentação
          </span>
        </div>
      </div>

      {/* ── Scenario selector ── */}
      <div
        className="flex items-center gap-2 px-6 py-3 shrink-0 overflow-x-auto"
        style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
      >
        <span className="text-[10px] font-semibold text-agro-muted uppercase tracking-widest shrink-0 mr-1">Cenário:</span>
        {SCENARIOS.map((s, i) => {
          const active = scenarioIdx === i;
          return (
            <button
              key={s.id}
              onClick={() => selectScenario(i)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all"
              style={active
                ? { background: `${s.tagColor}20`, color: s.tagColor, border: `1px solid ${s.tagColor}60` }
                : { background: "rgba(255,255,255,0.03)", color: "#6b8a75", border: "1px solid rgba(63,176,108,0.08)" }
              }
            >
              <span>{s.icon}</span>
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT: WhatsApp chat simulation */}
        <div
          className="flex flex-col w-[420px] shrink-0"
          style={{ borderRight: "1px solid rgba(63,176,108,0.1)", background: "#0a110e" }}
        >
          {/* Chat header */}
          <div
            className="flex items-center gap-3 px-4 py-3 shrink-0"
            style={{ borderBottom: "1px solid rgba(63,176,108,0.08)", background: "rgba(13,26,17,0.8)" }}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
              style={{ background: "linear-gradient(135deg, #2d6a4f, #1b4332)" }}
            >
              <User className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Cliente (WhatsApp)</p>
              <p className="text-[10px]" style={{ color: "#4ade80" }}>Online</p>
            </div>
            <div className="ml-auto">
              <span
                className="text-[9px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: `${scenario.tagColor}18`, color: scenario.tagColor, border: `1px solid ${scenario.tagColor}40` }}
              >
                {scenario.tag}
              </span>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 relative">
            {/* Scan line animation when AI is reading */}
            {scanning && (
              <div
                className="absolute left-0 right-0 h-0.5 z-10 pointer-events-none"
                style={{
                  background: "linear-gradient(90deg, transparent, #3fb06c, transparent)",
                  boxShadow: "0 0 12px rgba(63,176,108,0.6)",
                  animation: "scanDown 1.8s ease-in-out",
                  top: "0px",
                }}
              />
            )}

            {phase === "idle" && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-3">
                  <MessageSquare className="w-10 h-10 text-agro-muted/30 mx-auto" />
                  <p className="text-xs text-agro-muted/50">Clique em "Iniciar Demo" para simular</p>
                </div>
              </div>
            )}

            {/* Message 1 */}
            {visMsg1 && (
              <ChatBubble
                text={scenario.messages[0].text}
                highlighted={showRead}
                keywords={scenario.keywords}
              />
            )}

            {/* Typing indicator 2 */}
            {showTyping1 && <TypingIndicator />}

            {/* Message 2 */}
            {visMsg2 && (
              <ChatBubble
                text={scenario.messages[1].text}
                highlighted={showRead}
                keywords={scenario.keywords}
              />
            )}

            {showTyping2 && <TypingIndicator />}

            {/* Message 3 */}
            {visMsg3 && (
              <ChatBubble
                text={scenario.messages[2].text}
                highlighted={showRead}
                keywords={scenario.keywords}
              />
            )}

            {showTyping3 && <TypingIndicator />}

            {/* AI response bubble */}
            {showResult && (
              <div className="flex items-start gap-2 mt-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "linear-gradient(135deg, #1B5E20, #0a3d1f)", border: "1px solid rgba(63,176,108,0.4)" }}
                >
                  <Bot className="w-3.5 h-3.5" style={{ color: "#4ade80" }} />
                </div>
                <div
                  className="max-w-[75%] px-3 py-2.5 rounded-2xl rounded-tl-sm text-xs text-white animate-fade-in"
                  style={{ background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.25)" }}
                >
                  <p className="text-[10px] font-semibold mb-1" style={{ color: "#4ade80" }}>
                    IA Triagem • Respond automaticamente:
                  </p>
                  <p>
                    Olá! Entendi sua situação. Estou te conectando com nossa equipe de <strong style={{ color: scenario.tagColor }}>{scenario.routeDept}</strong> agora mesmo. Em instantes, {scenario.agent.split(" ")[0]} entrará em contato. 😊
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Start / Reset button */}
          <div
            className="px-4 py-3 shrink-0"
            style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}
          >
            {phase === "idle" ? (
              <button
                onClick={start}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)", color: "#000" }}
              >
                <Play className="w-4 h-4 fill-current" />
                Iniciar Demo
              </button>
            ) : (
              <button
                onClick={reset}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all text-agro-muted hover:text-white"
                style={{ border: "1px solid rgba(63,176,108,0.15)" }}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reiniciar
              </button>
            )}
          </div>
        </div>

        {/* RIGHT: AI brain visualization */}
        <div className="flex-1 flex flex-col p-6 gap-4 overflow-y-auto">

          {/* AI Status bar */}
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl shrink-0 transition-all duration-500"
            style={{
              background:  aiOn ? "rgba(63,176,108,0.08)" : "rgba(255,255,255,0.02)",
              border:      aiOn ? "1px solid rgba(63,176,108,0.3)" : "1px solid rgba(255,255,255,0.05)",
              boxShadow:   aiOn ? "0 0 30px rgba(63,176,108,0.08)" : "none",
            }}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: aiOn ? "rgba(63,176,108,0.15)" : "rgba(255,255,255,0.04)",
                border:     aiOn ? "1px solid rgba(63,176,108,0.4)" : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <Brain
                className={`w-4.5 h-4.5 transition-all ${aiOn ? "" : "opacity-30"}`}
                style={{ color: aiOn ? "#3fb06c" : "#6b8a75", width: 18, height: 18 }}
              />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white">
                {aiOn ? "Agente de Triagem" : "Agente de Triagem"}
              </p>
              <p className="text-[10px] text-agro-muted">
                {isComplete
                  ? "Roteamento concluído com sucesso"
                  : aiOn
                  ? "Analisando conversa em tempo real..."
                  : "Aguardando nova mensagem..."}
              </p>
            </div>
            {aiOn && (
              <div className="flex items-center gap-1.5">
                {!isComplete && (
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-agro-green animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-agro-green animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-agro-green animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                )}
                {isComplete && <CheckCircle2 className="w-4 h-4" style={{ color: "#4ade80" }} />}
              </div>
            )}
          </div>

          {/* Step: Reading */}
          <AIStep
            visible={showRead}
            active={phase === "ai_reading"}
            done={showIntent}
            icon={<Sparkles className="w-4 h-4" />}
            title="Lendo contexto da conversa"
            color="#8b5cf6"
          >
            <div className="mt-2 space-y-1.5">
              <p className="text-[11px] text-agro-muted">Palavras-chave identificadas:</p>
              <div className="flex flex-wrap gap-1.5">
                {scenario.keywords.map((kw) => (
                  <span
                    key={kw}
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full animate-fade-in"
                    style={{ background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.35)" }}
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          </AIStep>

          {/* Step: Intent */}
          <AIStep
            visible={showIntent}
            active={phase === "ai_intent"}
            done={showRoute}
            icon={<Brain className="w-4 h-4" />}
            title="Intenção detectada"
            color="#60a5fa"
          >
            <div className="mt-2 space-y-2">
              <p className="text-sm font-bold text-white">{scenario.intent}</p>
              <p className="text-[11px] text-agro-muted leading-relaxed">{scenario.intentDetail}</p>
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 h-1.5 rounded-full overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{
                      width: showIntent ? `${scenario.confidence}%` : "0%",
                      background: "linear-gradient(90deg, #60a5fa, #3b82f6)",
                    }}
                  />
                </div>
                <span className="text-xs font-bold text-blue-400">{scenario.confidence}% conf.</span>
              </div>
            </div>
          </AIStep>

          {/* Prompt snippet */}
          {showIntent && (
            <div
              className="rounded-xl px-4 py-3 animate-fade-in"
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(63,176,108,0.1)", fontFamily: "monospace" }}
            >
              <p className="text-[9px] text-agro-muted uppercase tracking-widest mb-2">Regra de triagem disparada:</p>
              <p className="text-[11px]" style={{ color: "#4ade80" }}>{scenario.promptSnippet}</p>
            </div>
          )}

          {/* Step: Routing */}
          <AIStep
            visible={showRoute}
            active={phase === "ai_routing"}
            done={showResult}
            icon={<GitBranch className="w-4 h-4" />}
            title="Calculando melhor rota"
            color="#f59e0b"
          >
            <div className="mt-3 space-y-2">
              {scenario.departments.map((dept, i) => (
                <div key={dept.name} className="flex items-center gap-3">
                  <span className="text-[11px] text-agro-muted w-24 shrink-0">{dept.name}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width:      showRoute ? `${dept.score}%` : "0%",
                        background: i === 0 ? dept.color : `${dept.color}60`,
                        transitionDuration: `${600 + i * 200}ms`,
                        transitionDelay:    `${i * 100}ms`,
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-bold w-8 text-right shrink-0" style={{ color: i === 0 ? dept.color : "#6b8a75" }}>
                    {dept.score}%
                  </span>
                </div>
              ))}
            </div>
          </AIStep>

          {/* Final result */}
          {showResult && (
            <div
              className="rounded-2xl p-5 animate-fade-in"
              style={{
                background:  `linear-gradient(135deg, ${scenario.routeColor}12 0%, rgba(0,0,0,0.3) 100%)`,
                border:      `1px solid ${scenario.routeColor}50`,
                boxShadow:   `0 0 40px ${scenario.routeColor}15`,
              }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4" style={{ color: scenario.routeColor }} />
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: scenario.routeColor }}>
                  Roteamento Executado
                </p>
                {isComplete && (
                  <span
                    className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: `${scenario.routeColor}20`, color: scenario.routeColor, border: `1px solid ${scenario.routeColor}40` }}
                  >
                    ✓ Confirmado
                  </span>
                )}
              </div>

              <div className="flex items-stretch gap-4">
                {/* Department card */}
                <div
                  className="flex-1 rounded-xl p-4 flex flex-col items-center justify-center gap-2"
                  style={{ background: `${scenario.routeColor}10`, border: `1px solid ${scenario.routeColor}35` }}
                >
                  <GitBranch className="w-5 h-5" style={{ color: scenario.routeColor }} />
                  <p className="text-[10px] text-agro-muted">Setor</p>
                  <p className="text-base font-bold" style={{ color: scenario.routeColor }}>{scenario.routeDept}</p>
                </div>

                <ChevronRight className="self-center w-4 h-4 text-agro-muted shrink-0" />

                {/* Agent card */}
                <div
                  className="flex-1 rounded-xl p-4 flex flex-col items-center justify-center gap-2"
                  style={{ background: `${scenario.routeColor}10`, border: `1px solid ${scenario.routeColor}35` }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                    style={{ background: `linear-gradient(135deg, ${scenario.routeColor}80, ${scenario.routeColor}40)` }}
                  >
                    {scenario.agentInitials}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-white">{scenario.agent}</p>
                    <p className="text-[10px] text-agro-muted">{scenario.agentRole}</p>
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: `1px solid ${scenario.routeColor}20` }}>
                <div className="text-center">
                  <p className="text-lg font-black" style={{ color: scenario.routeColor }}>
                    {scenario.confidence}%
                  </p>
                  <p className="text-[9px] text-agro-muted uppercase tracking-wide">Confiança</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-black text-white">&lt;2s</p>
                  <p className="text-[9px] text-agro-muted uppercase tracking-wide">Tempo de rota</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-black text-white">24/7</p>
                  <p className="text-[9px] text-agro-muted uppercase tracking-wide">Disponível</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-black text-white">Zero</p>
                  <p className="text-[9px] text-agro-muted uppercase tracking-wide">Interv. humana</p>
                </div>
              </div>
            </div>
          )}

          {/* Next scenario shortcut */}
          {isComplete && (
            <button
              onClick={() => selectScenario((scenarioIdx + 1) % SCENARIOS.length)}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold text-agro-muted hover:text-white transition-all animate-fade-in"
              style={{ border: "1px solid rgba(63,176,108,0.12)" }}
            >
              <ChevronRight className="w-3.5 h-3.5" />
              Próximo cenário: {SCENARIOS[(scenarioIdx + 1) % SCENARIOS.length].icon} {SCENARIOS[(scenarioIdx + 1) % SCENARIOS.length].label}
            </button>
          )}

          {/* Idle hint */}
          {phase === "idle" && (
            <div
              className="rounded-2xl p-6 text-center"
              style={{ border: "1px dashed rgba(63,176,108,0.1)" }}
            >
              <Bot className="w-8 h-8 text-agro-muted/30 mx-auto mb-2" />
              <p className="text-sm font-semibold text-agro-muted/50">Análise em tempo real</p>
              <p className="text-xs text-agro-muted/30 mt-1">
                Selecione um cenário e clique em "Iniciar Demo" para ver o roteamento automático
              </p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes scanDown {
          0%   { top: 0;    opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .animate-fade-in {
          animation: fade-in 0.4s ease-out both;
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 animate-fade-in">
      <div className="w-7 h-7 rounded-full bg-agro-surface flex items-center justify-center shrink-0">
        <User className="w-3.5 h-3.5 text-agro-muted" />
      </div>
      <div
        className="flex gap-1 px-3 py-2.5 rounded-2xl rounded-bl-sm"
        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-agro-muted animate-bounce" style={{ animationDelay: "0ms"   }} />
        <span className="w-1.5 h-1.5 rounded-full bg-agro-muted animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-1.5 h-1.5 rounded-full bg-agro-muted animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

function ChatBubble({ text, highlighted, keywords }: { text: string; highlighted: boolean; keywords: string[] }) {
  if (!highlighted) {
    return (
      <div className="flex items-end gap-2 animate-fade-in">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg, #2d6a4f, #1b4332)" }}
        >
          <User className="w-3.5 h-3.5 text-white" />
        </div>
        <div
          className="max-w-[80%] px-3 py-2.5 rounded-2xl rounded-bl-sm text-sm text-white"
          style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {text}
        </div>
      </div>
    );
  }

  // Highlight keywords
  const parts = splitWithKeywords(text, keywords);
  return (
    <div className="flex items-end gap-2 animate-fade-in">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
        style={{ background: "linear-gradient(135deg, #2d6a4f, #1b4332)" }}
      >
        <User className="w-3.5 h-3.5 text-white" />
      </div>
      <div
        className="max-w-[80%] px-3 py-2.5 rounded-2xl rounded-bl-sm text-sm"
        style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(139,92,246,0.35)", boxShadow: "0 0 12px rgba(139,92,246,0.12)" }}
      >
        {parts.map((part, i) =>
          part.match ? (
            <mark key={i} style={{ background: "rgba(139,92,246,0.3)", color: "#c4b5fd", borderRadius: 3, padding: "0 2px" }}>
              {part.text}
            </mark>
          ) : (
            <span key={i} className="text-white">{part.text}</span>
          )
        )}
      </div>
    </div>
  );
}

function splitWithKeywords(text: string, keywords: string[]): { text: string; match: boolean }[] {
  const regex = new RegExp(`(${keywords.map(escapeRegex).join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((p) => ({ text: p, match: keywords.some((k) => k.toLowerCase() === p.toLowerCase()) }));
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface AIStepProps {
  visible:  boolean;
  active:   boolean;
  done:     boolean;
  icon:     React.ReactNode;
  title:    string;
  color:    string;
  children?: React.ReactNode;
}

function AIStep({ visible, active, done, icon, title, color, children }: AIStepProps) {
  if (!visible) return null;
  return (
    <div
      className="rounded-2xl p-4 animate-fade-in transition-all duration-500"
      style={{
        background: done ? `${color}08` : `${color}10`,
        border:     `1px solid ${done ? color + "25" : color + "45"}`,
        boxShadow:  active ? `0 0 24px ${color}18` : "none",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${color}20`, color }}
        >
          {icon}
        </div>
        <p className="text-xs font-bold text-white">{title}</p>
        {done && <CheckCircle2 className="w-3.5 h-3.5 ml-auto shrink-0" style={{ color }} />}
        {active && (
          <span className="ml-auto flex gap-0.5 shrink-0">
            <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: color, animationDelay: "0ms" }} />
            <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: color, animationDelay: "150ms" }} />
            <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: color, animationDelay: "300ms" }} />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
