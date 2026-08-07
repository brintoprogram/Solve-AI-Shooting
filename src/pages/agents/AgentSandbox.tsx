// Ambiente de teste dos agentes de IA.
//
// Não confundir com AgentRoutingDemo (/agents/demo): aquilo é uma animação
// roteirizada, com cenários fixos e nenhuma chamada ao backend — serve para
// mostrar o produto. Aqui a mensagem passa pelo MESMO `ai-agent-reply` do
// WhatsApp real: o que funcionar nesta tela funciona em produção, e o que
// falhar aqui falharia com um cliente.
//
// O que a tela adiciona em relação a testar pelo WhatsApp: o painel da direita
// mostra POR QUE o agente decidiu o que decidiu. Antes disso, os dois erros de
// configuração mais comuns — o prompt citar um setor que não existe, e o setor
// existir sem agente ativo — eram silenciosos: o agente só não roteava.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Bot, RotateCcw, Send, User, Loader2, AlertTriangle,
  CheckCircle2, GitBranch, Info, MessageSquare,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Topbar } from "@/components/layout/Topbar";
import { log } from "@/lib/logger";

interface Mensagem {
  id:           string;
  direction:    string;
  body:         string | null;
  sent_by:      string | null;
  created_at:   string;
}

interface Evento {
  id:         string;
  step:       string;
  detail:     Record<string, unknown>;
  created_at: string;
}

// Cada passo do rastro ganha uma leitura humana. O `step` cru serve à máquina;
// quem está configurando o agente precisa saber o que fazer a respeito.
const PASSOS: Record<string, { rotulo: string; tom: "neutro" | "ok" | "alerta" | "erro" }> = {
  mensagem_recebida:   { rotulo: "Mensagem recebida",             tom: "neutro" },
  triagem_respondeu:   { rotulo: "Triagem processou",             tom: "neutro" },
  roteado:             { rotulo: "Roteado para o setor",          tom: "ok"     },
  sem_roteamento:      { rotulo: "Sem roteamento",                tom: "alerta" },
  setor_nao_encontrado:{ rotulo: "Setor não existe",              tom: "erro"   },
  setor_sem_agente:    { rotulo: "Setor sem agente ativo",        tom: "erro"   },
  triagem_sem_agente:  { rotulo: "Nenhum agente de triagem",      tom: "erro"   },
  sem_chave_de_ia:     { rotulo: "Chave de IA não configurada",   tom: "erro"   },
  erro_no_agente:      { rotulo: "O agente falhou",               tom: "erro"   },
};

const TOM_ESTILO = {
  neutro: { cor: "#6b7f6e", fundo: "rgba(107,127,110,0.10)", Icone: Info          },
  ok:     { cor: "#3fb06c", fundo: "rgba(63,176,108,0.12)",  Icone: CheckCircle2  },
  alerta: { cor: "#fb923c", fundo: "rgba(249,115,22,0.12)",  Icone: AlertTriangle },
  erro:   { cor: "#f87171", fundo: "rgba(239,68,68,0.12)",   Icone: AlertTriangle },
} as const;

export function AgentSandbox() {
  const navigate = useNavigate();
  const { workspaceId } = useAuth();
  const { toast } = useToast();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [eventos,   setEventos]   = useState<Evento[]>([]);
  const [texto,     setTexto]     = useState("");
  const [enviando,  setEnviando]  = useState(false);
  const [iniciando, setIniciando] = useState(true);
  const [agenteAtual, setAgenteAtual] = useState<string | null>(null);

  const fimDaConversa = useRef<HTMLDivElement>(null);

  const chamar = useCallback(async (acao: string, extra: Record<string, unknown> = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Sessão expirada. Entre novamente.");

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-sandbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ workspace_id: workspaceId, acao, ...extra }),
    });
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(corpo?.error ?? "Falha no ambiente de teste.");
    return corpo as { conversation_id: string; aviso?: string };
  }, [workspaceId]);

  // ── Prepara a conversa ao abrir ────────────────────────────────
  useEffect(() => {
    if (!workspaceId) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await chamar("nova");
        if (!cancelado) setConversationId(r.conversation_id);
      } catch (e) {
        log.error("sandbox_init_falhou", { err: e instanceof Error ? e.message : String(e) });
        if (!cancelado) toast({ title: "Não foi possível abrir o ambiente de teste", variant: "destructive" });
      } finally {
        if (!cancelado) setIniciando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [workspaceId, chamar, toast]);

  // ── Carrega e acompanha mensagens e rastro ─────────────────────
  const carregar = useCallback(async () => {
    if (!conversationId) return;

    const [msgs, evs, conv] = await Promise.all([
      supabase.from("inbox_messages")
        .select("id, direction, body, sent_by, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true }),
      supabase.from("agent_trace_events")
        .select("id, step, detail, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true }),
      supabase.from("inbox_conversations")
        .select("ai_agent_id, ai_agents(name)")
        .eq("id", conversationId)
        .maybeSingle(),
    ]);

    setMensagens((msgs.data ?? []) as Mensagem[]);
    setEventos((evs.data ?? []) as unknown as Evento[]);
    const ag = conv.data as { ai_agents?: { name?: string } | null } | null;
    setAgenteAtual(ag?.ai_agents?.name ?? null);
  }, [conversationId]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime: a resposta do agente chega depois da requisição voltar, porque
  // ela é gravada pela edge function e não pelo navegador.
  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase
      .channel(`sandbox-${conversationId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "inbox_messages", filter: `conversation_id=eq.${conversationId}` },
        carregar)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "agent_trace_events", filter: `conversation_id=eq.${conversationId}` },
        carregar)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, carregar]);

  useEffect(() => {
    fimDaConversa.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens.length, eventos.length]);

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setTexto("");
    try {
      const r = await chamar("enviar", { mensagem: t });
      if (r.aviso) toast({ title: r.aviso, variant: "destructive" });
      await carregar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: msg, variant: "destructive" });
      setTexto(t);   // devolve o texto para não perder o que foi digitado
    } finally {
      setEnviando(false);
    }
  }

  async function reiniciar() {
    setEnviando(true);
    try {
      await chamar("reiniciar");
      await carregar();
      toast({ title: "Conversa reiniciada" });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Falha ao reiniciar", variant: "destructive" });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Agentes", href: "/agents" }, { label: "Ambiente de teste" }]} />

      <div className="max-w-6xl w-full mx-auto px-6 py-6 flex-1 flex flex-col gap-4">

        {/* ── Cabeçalho ───────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              onClick={() => navigate("/agents")}
              className="p-2 rounded-xl text-agro-muted hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}
              aria-label="Voltar"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="font-display text-2xl font-bold text-agro-text">Ambiente de teste</h1>
              <p className="text-agro-muted mt-1 text-sm">
                Converse com seus agentes sem WhatsApp. Passa pelo mesmo motor do atendimento real.
              </p>
            </div>
          </div>

          <button
            onClick={reiniciar}
            disabled={enviando || !conversationId}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl text-agro-muted transition-colors hover:bg-[#1e2e22] hover:text-agro-text disabled:opacity-40 shrink-0"
            style={{ border: "1px solid #2a3d30" }}
          >
            <RotateCcw className="w-4 h-4" /> Reiniciar
          </button>
        </div>

        {/* ── Aviso de isolamento ─────────────────────── */}
        <div
          className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-xs"
          style={{ background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.18)" }}
        >
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-agro-muted">
            Nada aqui sai para o WhatsApp e nada entra nas suas telas de trabalho: esta conversa
            fica fora do Inbox, e o contato de teste fora de Contatos e das campanhas.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 flex-1 min-h-0">

          {/* ── Conversa ──────────────────────────────── */}
          <div
            className="rounded-2xl flex flex-col min-h-[460px]"
            style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <div className="flex items-center justify-between px-5 py-3 shrink-0"
                 style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
              <span className="text-xs font-semibold text-agro-text">Conversa</span>
              {agenteAtual ? (
                <span className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg"
                      style={{ background: "rgba(63,176,108,0.12)", color: "#3fb06c" }}>
                  <Bot className="w-3 h-3" /> {agenteAtual}
                </span>
              ) : (
                <span className="text-[11px] text-agro-muted-2">Ainda na triagem</span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 scrollbar-thin">
              {iniciando ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-5 h-5 text-agro-green animate-spin" />
                </div>
              ) : mensagens.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-10">
                  <MessageSquare className="w-8 h-8 text-agro-muted-2" />
                  <p className="text-sm text-agro-muted">Escreva como se fosse o cliente.</p>
                  <p className="text-xs text-agro-muted-2 max-w-xs">
                    A triagem vai ler a mensagem e decidir o setor. O painel ao lado mostra o porquê
                    de cada decisão.
                  </p>
                </div>
              ) : (
                mensagens.map((m) => {
                  const doCliente = m.direction === "inbound";
                  return (
                    <div key={m.id} className={`flex gap-2 ${doCliente ? "" : "flex-row-reverse"}`}>
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: doCliente ? "rgba(107,127,110,0.15)" : "rgba(63,176,108,0.15)" }}
                      >
                        {doCliente
                          ? <User className="w-3.5 h-3.5 text-agro-muted" />
                          : <Bot className="w-3.5 h-3.5 text-agro-green" />}
                      </div>
                      <div
                        className="max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words"
                        style={doCliente
                          ? { background: "#16241b", color: "#c8d8cc" }
                          : { background: "rgba(63,176,108,0.14)", color: "#dff0e4" }}
                      >
                        {m.body}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={fimDaConversa} />
            </div>

            <div className="p-3 shrink-0" style={{ borderTop: "1px solid rgba(63,176,108,0.1)" }}>
              <div className="flex gap-2">
                <input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                  disabled={enviando || iniciando}
                  placeholder="Digite como o cliente…"
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm text-agro-text bg-[#0d1710] outline-none focus:border-agro-green transition-colors disabled:opacity-50"
                  style={{ border: "1px solid #2a3d30" }}
                />
                <button
                  onClick={enviar}
                  disabled={enviando || iniciando || !texto.trim()}
                  className="btn-agro px-4 py-2.5 flex items-center gap-2 text-sm disabled:opacity-40"
                >
                  {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Enviar
                </button>
              </div>
            </div>
          </div>

          {/* ── Rastro das decisões ───────────────────── */}
          <div
            className="rounded-2xl flex flex-col min-h-[460px]"
            style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <div className="flex items-center gap-2 px-5 py-3 shrink-0"
                 style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
              <GitBranch className="w-3.5 h-3.5 text-agro-green" />
              <span className="text-xs font-semibold text-agro-text">Decisões do agente</span>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 scrollbar-thin">
              {eventos.length === 0 ? (
                <p className="text-xs text-agro-muted-2 text-center py-8">
                  Mande uma mensagem para ver o raciocínio do roteamento.
                </p>
              ) : (
                eventos.map((ev) => {
                  const meta = PASSOS[ev.step] ?? { rotulo: ev.step, tom: "neutro" as const };
                  const est  = TOM_ESTILO[meta.tom];
                  const { Icone } = est;
                  const d = ev.detail ?? {};
                  return (
                    <div key={ev.id} className="rounded-xl p-3" style={{ background: est.fundo }}>
                      <div className="flex items-center gap-2">
                        <Icone className="w-3.5 h-3.5 shrink-0" style={{ color: est.cor }} />
                        <span className="text-xs font-semibold" style={{ color: est.cor }}>
                          {meta.rotulo}
                        </span>
                      </div>

                      {typeof d.setor === "string" && (
                        <p className="text-[11px] text-agro-muted mt-1.5">
                          Setor: <span className="text-agro-text font-medium">{d.setor}</span>
                          {typeof d.agente === "string" && <> · Agente: <span className="text-agro-text font-medium">{d.agente}</span></>}
                        </p>
                      )}
                      {typeof d.setor_pedido === "string" && (
                        <p className="text-[11px] text-agro-muted mt-1.5">
                          O modelo pediu <span className="text-agro-text font-medium">{d.setor_pedido}</span>.
                          {Array.isArray(d.setores_existentes) && (
                            <> Setores que existem: {(d.setores_existentes as string[]).join(", ") || "nenhum"}.</>
                          )}
                        </p>
                      )}
                      {typeof d.motivo === "string" && (
                        <p className="text-[11px] text-agro-muted mt-1.5">{d.motivo}</p>
                      )}
                      {typeof d.dica === "string" && (
                        <p className="text-[11px] mt-1.5" style={{ color: est.cor }}>{d.dica}</p>
                      )}
                      {typeof d.resposta_bruta === "string" && (
                        <details className="mt-2">
                          <summary className="text-[10px] text-agro-muted-2 cursor-pointer hover:text-agro-muted">
                            Ver resposta bruta do modelo
                          </summary>
                          <pre className="text-[10px] text-agro-muted mt-1.5 whitespace-pre-wrap break-words font-mono">
                            {d.resposta_bruta as string}
                          </pre>
                        </details>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
