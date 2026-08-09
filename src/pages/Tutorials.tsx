// Dossiê — /tutoriais
//
// Divisão de trabalho com /primeiros-passos: aquela tela responde "o que falta
// para eu operar?" e é uma lista curta e verificada. Esta responde "como isso
// funciona e o que cada campo faz?" e é exaustiva. Os 9 passos aparecem aqui
// também, importados de SETUP_STEPS — não recopiados.
//
// O estado ao vivo vem do mesmo RPC dos primeiros passos. Não existe checkbox
// de "já li": o selo diz o que o sistema VERIFICOU, não o que a pessoa afirmou.

import { useMemo, useState } from "react";
import {
  Search, ChevronRight, Loader2, X,
  Rocket, Smartphone, MessageSquare, Send, Users, Handshake, Settings,
  Clock, GitCompare, Gauge, Bot, Cpu, FlaskConical, GitBranch, Bell,
  FileText, Mail, Zap, BarChart2, Receipt, Eraser, ShieldCheck,
  ExternalLink, UserCog, Coins, KeyRound, Building2, Webhook, UserPlus, BookOpen,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/context/AuthContext";
import { useSetupChecklist } from "@/hooks/useSetupChecklist";
import { useCredits } from "@/hooks/useCredits";
import { ArticleBody } from "@/components/docs/ArticleBody";
import { STATUS_STYLE, StatusIcon } from "@/components/docs/status";
import { CATEGORIAS, todosOsArtigos, type DocArtigo, type DocCategoria } from "@/types/docs";
import type { StepStatus } from "@/types/setup";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Rocket, Smartphone, MessageSquare, Send, Users, Handshake, Settings,
  Clock, GitCompare, Gauge, Bot, Cpu, FlaskConical, GitBranch, Bell,
  FileText, Mail, Zap, BarChart2, Receipt, Eraser, ShieldCheck,
  ExternalLink, UserCog, Coins, KeyRound, Building2, Webhook, UserPlus,
};

/** Tudo que a busca varre — inclui o corpo, não só o título. */
function textoBuscavel(a: DocArtigo): string {
  return [
    a.title, a.summary, a.why,
    ...(a.busca ?? []),
    ...(a.how ?? []),
    ...(a.gotchas ?? []),
    ...(a.campos ?? []).flatMap((c) => [c.label, c.what, c.efeito ?? ""]),
  ].join(" ").toLowerCase();
}

/** Remove acento: quem digita "negociacao" tem que achar "negociação".
 *  \p{Diacritic} em vez do range cru de combinantes: marca combinante
 *  literal no fonte é invisível no diff e some em qualquer reformatação. */
function normaliza(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function Tutorials() {
  const { workspaceId } = useAuth();
  const { states, loading } = useSetupChecklist(workspaceId ?? undefined);
  const credito = useCredits();

  const [busca, setBusca]   = useState("");
  const [cat, setCat]       = useState<DocCategoria | "todos">("todos");
  const [aberto, setAberto] = useState<string | null>(null);

  const artigos = useMemo(() => todosOsArtigos(), []);

  const indice = useMemo(
    () => new Map(artigos.map((a) => [a.id, normaliza(textoBuscavel(a))])),
    [artigos],
  );

  const filtrados = useMemo(() => {
    const termo = normaliza(busca.trim());
    return artigos.filter((a) => {
      if (cat !== "todos" && a.categoria !== cat) return false;
      if (!termo) return true;
      return (indice.get(a.id) ?? "").includes(termo);
    });
  }, [artigos, cat, busca, indice]);

  // Busca ativa mistura categorias; agrupar embaralharia a relevância.
  const agrupar = !busca.trim();

  const porCategoria = useMemo(() => {
    const m = new Map<DocCategoria, DocArtigo[]>();
    for (const a of filtrados) {
      const lista = m.get(a.categoria) ?? [];
      lista.push(a);
      m.set(a.categoria, lista);
    }
    return m;
  }, [filtrados]);

  function renderArtigo(a: DocArtigo) {
    // Créditos não é um passo de setup — o saldo vem do hook em tempo real.
    // Sem isso, o artigo que mais gera dúvida ("acabou meu crédito?") seria o
    // único sem resposta na própria tela.
    const st: { status: StepStatus; detail?: string } | undefined =
      a.id === "creditos" && !credito.carregando
        ? {
            status: credito.cobranca_ativa && credito.saldo <= 0 ? "attention" : "done",
            detail: credito.cobranca_ativa
              ? `saldo: ${credito.saldo.toLocaleString("pt-BR")} crédito${credito.saldo === 1 ? "" : "s"}`
              : "cobrança desativada neste workspace",
          }
        : a.sinal
          ? states[a.sinal]
          : undefined;
    const cfg     = st ? STATUS_STYLE[st.status] : null;
    const Icon    = ICONS[a.icon] ?? BookOpen;
    const isOpen  = aberto === a.id;

    return (
      <div
        key={a.id}
        className="rounded-2xl overflow-hidden"
        style={{
          background: "rgba(13,26,17,0.6)",
          border: `1px solid ${isOpen ? "rgba(63,176,108,0.3)" : "rgba(63,176,108,0.1)"}`,
        }}
      >
        <button
          onClick={() => setAberto(isOpen ? null : a.id)}
          aria-expanded={isOpen}
          className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
        >
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={
              cfg
                ? { background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }
                : { background: "rgba(63,176,108,0.08)", color: "#7a9e83", border: "1px solid rgba(63,176,108,0.12)" }
            }
          >
            {cfg && st && st.status !== "pending" ? <StatusIcon status={st.status} /> : <Icon className="w-4 h-4" />}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-agro-text">{a.title}</span>
            <span className="block text-xs text-agro-muted-2 mt-0.5">
              {st?.detail ?? a.summary}
            </span>
          </span>

          {cfg && !loading && (
            <span
              className="text-[10px] font-semibold px-2 py-1 rounded shrink-0 hidden sm:inline"
              style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
            >
              {cfg.label}
            </span>
          )}
          <ChevronRight className={`w-4 h-4 text-agro-muted-2 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
        </button>

        {isOpen && (
          <div className="px-5 pb-5" style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
            <ArticleBody artigo={a} />

            {a.related && a.related.length > 0 && (
              <div className="pt-5 mt-5" style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-2.5">
                  Leia também
                </p>
                <div className="flex flex-wrap gap-2">
                  {a.related.map((rid) => {
                    const alvo = artigos.find((x) => x.id === rid);
                    if (!alvo) return null;
                    return (
                      <button
                        key={rid}
                        onClick={() => {
                          setBusca("");
                          setCat("todos");
                          setAberto(rid);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg text-agro-text transition-colors hover:bg-white/[0.04]"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(63,176,108,0.15)" }}
                      >
                        {alvo.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Tutoriais" }]} />

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        <div className="animate-fade-up">
          <h1 className="font-display text-2xl font-bold text-agro-text">Tutoriais</h1>
          <p className="text-agro-muted mt-1.5 text-sm leading-relaxed max-w-2xl">
            Como configurar e operar cada parte do sistema — o que cada campo faz, como vem
            de fábrica e onde as pessoas travam. Os itens com selo mostram o estado real do
            seu workspace.
          </p>
        </div>

        {/* ── Busca ─────────────────────────────────── */}
        <div className="relative animate-fade-up-delay-1">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-agro-muted-2 pointer-events-none" />
          <input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setAberto(null); }}
            placeholder="Buscar: crédito, template recusado, desconto, 24 horas…"
            aria-label="Buscar nos tutoriais"
            className="w-full pl-11 pr-10 py-3 rounded-2xl text-sm text-agro-text placeholder:text-agro-muted-2 outline-none transition-colors focus:border-agro-green/40"
            style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.15)" }}
          />
          {busca && (
            <button
              onClick={() => setBusca("")}
              aria-label="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-agro-muted-2 hover:text-agro-text transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Categorias ────────────────────────────── */}
        {/* flex-wrap, nunca overflow-x-auto: barra de rolagem horizontal aqui
            é o bug que já apareceu uma vez na tela de Configurações. */}
        <div
          className="flex flex-wrap gap-1 p-1 rounded-2xl animate-fade-up-delay-2"
          style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(63,176,108,0.1)" }}
          role="tablist"
          aria-label="Categorias de tutoriais"
        >
          {([{ id: "todos" as const, label: "Todos", icon: "BookOpen" }, ...CATEGORIAS]).map((c) => {
            const ativo = cat === c.id;
            const CatIcon = ICONS[c.icon] ?? BookOpen;
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={ativo}
                onClick={() => { setCat(c.id as DocCategoria | "todos"); setAberto(null); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-150 whitespace-nowrap"
                style={ativo
                  ? { background: "rgba(63,176,108,0.18)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.3)" }
                  : { color: "#6b8a75", background: "transparent", border: "1px solid transparent" }}
              >
                <CatIcon className="w-3.5 h-3.5 shrink-0" />
                {c.label}
              </button>
            );
          })}
        </div>

        {/* ── Lista ─────────────────────────────────── */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-agro-muted" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-14">
            <p className="text-sm text-agro-muted">Nada encontrado para “{busca}”.</p>
            <button
              onClick={() => { setBusca(""); setCat("todos"); }}
              className="text-xs text-agro-green hover:underline mt-2"
            >
              Ver todos os tutoriais
            </button>
          </div>
        ) : agrupar ? (
          <div className="space-y-8 animate-fade-up-delay-3">
            {CATEGORIAS.map((c) => {
              const lista = porCategoria.get(c.id);
              if (!lista || lista.length === 0) return null;
              return (
                <section key={c.id} className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 px-1">
                    {c.label}
                  </p>
                  {lista.map(renderArtigo)}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2 animate-fade-up-delay-3">
            <p className="text-xs text-agro-muted-2 px-1">
              {filtrados.length} resultado{filtrados.length > 1 ? "s" : ""}
            </p>
            {filtrados.map(renderArtigo)}
          </div>
        )}
      </div>
    </div>
  );
}
