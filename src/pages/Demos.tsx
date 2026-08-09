// Demonstrações — /demos
//
// Uma galeria por funcionalidade, para reunião com cliente. Cada card abre com
// a PERGUNTA que aquela demo responde, não com o nome da feature: em reunião
// ninguém pergunta "me mostra o roteamento", perguntam "como vocês sabem para
// quem mandar a conversa?".
//
// A demo de roteamento continua no /agents/demo — ela é uma animação
// especializada, com score por setor e destaque de palavra-chave, e não caberia
// no formato de roteiro sem perder o que tem de bom. Aqui ela aparece como card
// que leva para lá.

import { useEffect, useState } from "react";
import {
  Play, ChevronLeft, ExternalLink, Presentation,
  GitBranch, Clock, Handshake, Cake, Send, Zap, Building2, Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/context/AuthContext";
import { DemoPlayer } from "@/components/demo/DemoPlayer";
import { DEMOS, type Demo } from "@/types/demos";
import { aplicar, ler, salvar, PADRAO, type Contexto } from "@/components/demo/personalizacao";

const nf = new Intl.NumberFormat("pt-BR");

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  GitBranch, Clock, Handshake, Cake, Send, Zap, ExternalLink,
};

export function Demos() {
  const navigate = useNavigate();
  const { workspaces, workspaceId } = useAuth();
  const [aberta, setAberta] = useState<Demo | null>(null);
  const [ctx,    setCtx]    = useState<Contexto>(ler);

  // Guarda no navegador: é preparação de reunião, não configuração do produto.
  useEffect(() => { salvar(ctx); }, [ctx]);

  // Esconder o item do menu não basta: a rota continua alcançável digitando o
  // endereço, e um cliente encontraria material de venda dentro do produto que
  // já comprou. Quem decide é o workspace atual, não o menu.
  const atual  = workspaces.find((w) => w.id === workspaceId);
  const isDemo = atual?.name.toLowerCase().includes("demo") ?? false;

  if (!isDemo) {
    return (
      <div className="min-h-screen" style={{ background: "#0a110e" }}>
        <Topbar breadcrumbs={[{ label: "Demonstrações" }]} />
        <div className="max-w-md mx-auto px-6 py-20 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
               style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.25)" }}>
            <Presentation className="w-6 h-6" style={{ color: "#60a5fa" }} />
          </div>
          <h1 className="text-lg font-bold text-agro-text">Disponível no ambiente de demonstração</h1>
          <p className="text-sm text-agro-muted mt-2 leading-relaxed">
            As demonstrações vivem no workspace de demo. Troque de workspace no topo da tela
            para acessá-las.
          </p>
        </div>
      </div>
    );
  }

  if (aberta) {
    const Icone = ICONS[aberta.icone] ?? Play;
    return (
      <div className="min-h-screen" style={{ background: "#0a110e" }}>
        <Topbar breadcrumbs={[{ label: "Demonstrações", href: "/demos" }, { label: aberta.titulo }]} />
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-5">
          <button onClick={() => setAberta(null)}
            className="flex items-center gap-1.5 text-xs text-agro-muted-2 hover:text-agro-text transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" /> Todas as demonstrações
          </button>

          <div className="flex items-start gap-3 animate-fade-up">
            <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: `${aberta.cor}1f`, color: aberta.cor, border: `1px solid ${aberta.cor}40` }}>
              <Icone className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold text-agro-text">{aplicar(aberta.titulo, ctx)}</h1>
              <p className="text-sm text-agro-muted mt-0.5">{aplicar(aberta.resumo, ctx)}</p>
            </div>
          </div>

          <div className="rounded-2xl px-4 py-3 animate-fade-up-delay-1"
               style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(63,176,108,0.12)" }}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-1">
              A pergunta que isto responde
            </p>
            <p className="text-sm text-agro-text">“{aplicar(aberta.pergunta, ctx)}”</p>
          </div>

          <div className="animate-fade-up-delay-2">
            <DemoPlayer demo={aberta} ctx={ctx} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Demonstrações" }]} />

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="animate-fade-up">
          <h1 className="font-display text-2xl font-bold text-agro-text">Demonstrações</h1>
          <p className="text-agro-muted mt-1.5 text-sm leading-relaxed max-w-2xl">
            Uma para cada parte do produto, feita para reunião: você avança no seu ritmo
            enquanto fala. Nenhuma envia mensagem de verdade.
          </p>
        </div>

        {/* Preparo da reunião. Fica no topo porque é a primeira coisa a fazer
            antes de abrir qualquer demo, e some da vista depois de preenchida. */}
        <div className="rounded-2xl p-4 animate-fade-up-delay-1"
             style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.2)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: "#60a5fa" }}>
            Para quem é a reunião
          </p>
          <div className="grid sm:grid-cols-[1fr_180px] gap-3">
            <div className="relative">
              <Building2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-agro-muted-2" />
              <input
                value={ctx.empresa}
                onChange={(e) => setCtx((c) => ({ ...c, empresa: e.target.value }))}
                placeholder="Nome da empresa do cliente"
                className="input-agro w-full pl-9 text-sm"
              />
            </div>
            <div className="relative">
              <Users className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-agro-muted-2" />
              <input
                type="number" min={1}
                value={ctx.base}
                onChange={(e) => setCtx((c) => ({ ...c, base: Math.max(1, Number(e.target.value) || PADRAO.base) }))}
                placeholder="tamanho da base"
                className="input-agro w-full pl-9 text-sm tabular-nums"
              />
            </div>
          </div>
          <p className="text-[11px] mt-2.5 leading-relaxed" style={{ color: "#93c5fd" }}>
            {ctx.empresa.trim()
              ? `As demos vão falar de ${ctx.empresa.trim()} e usar números na escala de ${nf.format(ctx.base)} clientes.`
              : "Preencha e as demos passam a falar o nome do cliente e usar números na escala dele, em vez de um exemplo genérico."}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 animate-fade-up-delay-1">
          {DEMOS.map((d) => {
            const Icone = ICONS[d.icone] ?? Play;
            const externa = Boolean(d.rotaExterna);
            return (
              <button
                key={d.id}
                onClick={() => (externa ? navigate(d.rotaExterna!) : setAberta(d))}
                className="text-left rounded-2xl p-5 transition-all hover:bg-white/[0.02]"
                style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}
              >
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: `${d.cor}1f`, color: d.cor, border: `1px solid ${d.cor}40` }}>
                    <Icone className="w-5 h-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-agro-text">{aplicar(d.titulo, ctx)}</h2>
                      {externa && <ExternalLink className="w-3 h-3 text-agro-muted-2 shrink-0" />}
                    </div>
                    <p className="text-xs text-agro-muted mt-1 leading-relaxed">{aplicar(d.resumo, ctx)}</p>
                    <p className="text-[11px] text-agro-muted-2 mt-2.5 italic">“{aplicar(d.pergunta, ctx)}”</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-start gap-2.5 p-4 rounded-2xl text-xs animate-fade-up-delay-2"
             style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.2)" }}>
          <Presentation className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#60a5fa" }} />
          <p style={{ color: "#93c5fd" }} className="leading-relaxed">
            Para mostrar o produto com dado de verdade, use o workspace <strong>Demo</strong> e
            rode <strong>Preparar para reunião</strong> em Configurações → Demo antes de começar:
            traz as conversas para hoje e liga os agentes de IA.
          </p>
        </div>
      </div>
    </div>
  );
}
