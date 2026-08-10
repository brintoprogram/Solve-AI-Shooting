// Atividade — quem mudou o que, e o que era antes.
//
// A trilha nasce no banco, por gatilho, e chega aqui em jsonb cru. Despejar
// isso na tela seria devolver a pergunta ao usuário: ninguém lê
// {"max_discount_pct": 40} e conclui "alguém dobrou o teto de desconto".
//
// Então a tela traduz. Nome de tabela vira nome de coisa, nome de coluna vira
// o rótulo que aparece na tela onde ela é editada, e a mudança vira uma frase
// com o valor de antes ao lado do de agora. O valor antigo é o ponto: sem ele
// a trilha diz que algo mudou, e não o que foi desfeito.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  History, Loader2, Filter, User, Server, Database, Plus, Pencil, Trash2, Search,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Topbar } from "@/components/layout/Topbar";
import { log } from "@/lib/logger";

const db = supabase as unknown as SupabaseClient;

interface Linha {
  id: string;
  tabela: string;
  registro_id: string | null;
  acao: "criado" | "alterado" | "removido";
  ator_email: string | null;
  origem: string;
  campos: string[] | null;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  created_at: string;
}

/** Nome de tabela é vocabulário de banco. Aqui vale o nome que a pessoa vê na
 *  tela onde a coisa é editada. */
const COISAS: Record<string, { rotulo: string; onde: string }> = {
  workspaces:          { rotulo: "Dados do workspace",   onde: "Configurações" },
  workspace_members:   { rotulo: "Membro da equipe",     onde: "Equipe" },
  workspace_invites:   { rotulo: "Convite",              onde: "Equipe" },
  ai_agents:           { rotulo: "Agente de IA",         onde: "Configurações › Agentes" },
  negotiation_rules:   { rotulo: "Régua de negociação",  onde: "Configurações › Negociação" },
  departments:         { rotulo: "Setor",                onde: "Configurações › Setores" },
  meta_connections:    { rotulo: "Conexão WhatsApp oficial", onde: "Configurações › Integrações" },
  z_api_connections:   { rotulo: "Conexão WhatsApp Z-API",   onde: "Configurações › Integrações" },
  api_keys:            { rotulo: "Chave de API",         onde: "Configurações › API" },
};

/** Coluna → o rótulo do campo na tela. O que não estiver aqui aparece com o
 *  nome técnico mesmo: é melhor mostrar algo estranho do que esconder que
 *  mudou. */
const CAMPOS: Record<string, string> = {
  name: "Nome", role: "Cargo", email: "E-mail", status: "Situação",
  is_active: "Ativo", is_triage: "Faz a triagem", model: "Modelo de IA",
  system_prompt: "Instruções do agente", department_id: "Setor",
  max_discount_pct: "Desconto máximo", max_installments: "Parcelas máximas",
  min_installment_amount: "Valor mínimo da parcela",
  min_down_payment_pct: "Entrada mínima",
  max_negotiation_rounds: "Rodadas de negociação",
  is_ai_negotiation_enabled: "IA negocia sozinha",
  auto_escalate_keywords: "Palavras que chamam um humano",
  portal_token_ttl_hours: "Validade do link do portal",
  escalation_department_id: "Setor que recebe a escalada",
  routing_header: "Saudação do menu", codigo: "Código do cliente",
  color: "Cor", description: "Descrição", order_index: "Ordem",
  display_phone: "Número", business_name: "Nome do negócio",
  phone: "Telefone", instance_id: "Instância", expires_at: "Validade",
  scopes: "Permissões da chave", revoked_at: "Revogada em",
};

const ACOES = {
  criado:   { rotulo: "Criou",   icone: Plus,   cor: "#3fb06c" },
  alterado: { rotulo: "Alterou", icone: Pencil, cor: "#60a5fa" },
  removido: { rotulo: "Removeu", icone: Trash2, cor: "#f87171" },
} as const;

const ORIGENS = {
  painel:   { rotulo: "pelo painel",           icone: User,     cor: "#8fa99a" },
  servidor: { rotulo: "pelo servidor",         icone: Server,   cor: "#8fa99a" },
  banco:    { rotulo: "direto no banco",       icone: Database, cor: "#fbbf24" },
} as const;

/** Um valor de jsonb virando algo legível. Booleano vira sim/não porque
 *  "false" numa frase em português trava a leitura. */
function comoTexto(v: unknown): string {
  if (v === null || v === undefined || v === "") return "vazio";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "vazio";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  // UUID no meio de uma frase não informa nada a ninguém.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return "outro registro";
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

function rotuloDoCampo(c: string): string {
  return CAMPOS[c] ?? c.replace(/_/g, " ");
}

/** O nome do registro afetado, quando a linha tem um. Sem isto a trilha diz
 *  "alterou um setor" sem dizer qual. */
function nomeDoRegistro(l: Linha): string | null {
  const d = l.depois ?? l.antes ?? {};
  for (const k of ["name", "template_name", "email", "display_phone", "codigo"]) {
    const v = d[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

export function Activity() {
  const { workspaceId } = useAuth();

  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<string>("todas");
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    if (!workspaceId) return;
    setCarregando(true);
    const { data, error } = await db
      .from("workspace_audit_log")
      .select("id, tabela, registro_id, acao, ator_email, origem, campos, antes, depois, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) {
      log.error("atividade_falhou", { err: error.message });
      setErro("Não foi possível carregar a atividade.");
    } else {
      setLinhas((data ?? []) as Linha[]);
      setErro(null);
    }
    setCarregando(false);
  }, [workspaceId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const tabelasPresentes = useMemo(
    () => Array.from(new Set(linhas.map((l) => l.tabela))).sort(),
    [linhas]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (filtro !== "todas" && l.tabela !== filtro) return false;
      if (!t) return true;
      const alvo = [
        l.ator_email ?? "", COISAS[l.tabela]?.rotulo ?? l.tabela,
        nomeDoRegistro(l) ?? "", (l.campos ?? []).map(rotuloDoCampo).join(" "),
      ].join(" ").toLowerCase();
      return alvo.includes(t);
    });
  }, [linhas, filtro, busca]);

  // Agrupado por dia: uma lista corrida de 300 linhas com data em cada uma é
  // ilegível, e a pergunta que traz alguém aqui quase sempre começa com "o que
  // mudou naquele dia".
  const porDia = useMemo(() => {
    const mapa = new Map<string, Linha[]>();
    for (const l of visiveis) {
      const dia = new Date(l.created_at).toLocaleDateString("pt-BR",
        { day: "2-digit", month: "long", year: "numeric" });
      const atual = mapa.get(dia);
      if (atual) atual.push(l); else mapa.set(dia, [l]);
    }
    return Array.from(mapa.entries());
  }, [visiveis]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Topbar breadcrumbs={[{ label: "Atividade" }]} />
      <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <h1 className="font-display text-2xl font-bold text-agro-text">Atividade</h1>
          <p className="text-agro-muted mt-1.5 text-sm leading-relaxed max-w-2xl">
            Toda mudança de configuração e de equipe fica registrada aqui, com quem fez e
            o que valia antes. O registro é feito pelo banco e não pode ser editado nem
            apagado, nem por quem tem acesso de administrador.
          </p>

          {/* ── Filtros ─────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 mt-6">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por pessoa, item ou campo"
                className="w-full bg-agro-surface border border-agro-border rounded-lg pl-9 pr-3 py-2
                           text-sm text-agro-text placeholder:text-agro-muted-2
                           focus:outline-none focus:border-agro-accent/50"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Filter className="w-3.5 h-3.5 text-agro-muted-2" />
              <button
                onClick={() => setFiltro("todas")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  filtro === "todas"
                    ? "bg-agro-accent/15 border-agro-accent/40 text-agro-text"
                    : "bg-agro-surface border-agro-border text-agro-muted hover:text-agro-text"}`}>
                Tudo
              </button>
              {tabelasPresentes.map((t) => (
                <button
                  key={t}
                  onClick={() => setFiltro(t)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    filtro === t
                      ? "bg-agro-accent/15 border-agro-accent/40 text-agro-text"
                      : "bg-agro-surface border-agro-border text-agro-muted hover:text-agro-text"}`}>
                  {COISAS[t]?.rotulo ?? t}
                </button>
              ))}
            </div>
          </div>

          {/* ── Lista ───────────────────────────────────────────── */}
          <div className="mt-6">
            {carregando ? (
              <div className="flex items-center gap-2 text-agro-muted text-sm py-12 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
              </div>
            ) : erro ? (
              <p className="text-sm text-red-400 py-12 text-center">{erro}</p>
            ) : visiveis.length === 0 ? (
              <div className="text-center py-16">
                <History className="w-8 h-8 text-agro-muted-2 mx-auto mb-3" />
                <p className="text-sm text-agro-muted">
                  {linhas.length === 0
                    ? "Nenhuma mudança registrada ainda."
                    : "Nada encontrado com esse filtro."}
                </p>
                {linhas.length === 0 && (
                  <p className="text-xs text-agro-muted-2 mt-1.5 max-w-md mx-auto leading-relaxed">
                    O registro começou a valer agora. O que foi configurado antes disso não
                    aparece aqui.
                  </p>
                )}
              </div>
            ) : (
              porDia.map(([dia, doDia]) => (
                <div key={dia} className="mb-7">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-3">
                    {dia}
                  </p>
                  <div className="space-y-2">
                    {doDia.map((l) => {
                      const acao   = ACOES[l.acao];
                      const Icone  = acao.icone;
                      const origem = ORIGENS[l.origem as keyof typeof ORIGENS] ?? ORIGENS.banco;
                      const OIcone = origem.icone;
                      const coisa  = COISAS[l.tabela];
                      const nome   = nomeDoRegistro(l);
                      const hora   = new Date(l.created_at).toLocaleTimeString("pt-BR",
                        { hour: "2-digit", minute: "2-digit" });

                      return (
                        <div key={l.id}
                             className="bg-agro-surface border border-agro-border rounded-xl px-4 py-3">
                          <div className="flex items-start gap-3">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                                 style={{ backgroundColor: `${acao.cor}1a` }}>
                              <Icone className="w-3.5 h-3.5" style={{ color: acao.cor }} />
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-agro-text leading-snug">
                                <span className="font-semibold">
                                  {l.ator_email ?? "Sistema"}
                                </span>{" "}
                                <span className="text-agro-muted">{acao.rotulo.toLowerCase()}</span>{" "}
                                <span className="font-medium">
                                  {coisa?.rotulo ?? l.tabela}
                                </span>
                                {nome && <span className="text-agro-muted"> · {nome}</span>}
                              </p>

                              {/* O que mudou, campo a campo, com o valor de antes. */}
                              {l.acao === "alterado" && l.campos?.length ? (
                                <div className="mt-2 space-y-1">
                                  {l.campos.map((c) => (
                                    <p key={c} className="text-xs leading-relaxed">
                                      <span className="text-agro-muted-2">{rotuloDoCampo(c)}: </span>
                                      <span className="text-agro-muted line-through decoration-agro-muted-2/60">
                                        {comoTexto(l.antes?.[c])}
                                      </span>
                                      <span className="text-agro-muted-2"> → </span>
                                      <span className="text-agro-text font-medium">
                                        {comoTexto(l.depois?.[c])}
                                      </span>
                                    </p>
                                  ))}
                                </div>
                              ) : null}

                              <p className="flex items-center gap-1.5 text-[11px] text-agro-muted-2 mt-2">
                                <OIcone className="w-3 h-3" style={{ color: origem.cor }} />
                                {origem.rotulo}
                                {coisa && <span>· em {coisa.onde}</span>}
                              </p>
                            </div>

                            <span className="text-[11px] text-agro-muted-2 tabular-nums shrink-0">
                              {hora}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {linhas.length >= 300 && (
            <p className="text-[11px] text-agro-muted-2 text-center pb-6">
              Mostrando as 300 mudanças mais recentes.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
