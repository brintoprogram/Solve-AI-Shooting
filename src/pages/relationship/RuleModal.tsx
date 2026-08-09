// Criar / editar uma regra de relacionamento.
//
// A mensagem NÃO é texto livre pela via Meta, e essa é a regra que define a
// tela inteira. Relacionamento é disparo: chega a quem não fala com você há
// meses, ou seja, fora da janela de 24h — e ali a Meta só aceita template
// aprovado. Um campo de texto livre aqui produziria uma regra que parece
// configurada e falha em todo envio.
//
// A Z-API não tem conceito de template, então lá o texto livre continua sendo
// o caminho certo. Por isso o campo de mensagem depende do canal, em vez de a
// tela escolher um dos dois e quebrar o outro.

import { useEffect, useMemo, useState } from "react";
import {
  Loader2, Check, AlertTriangle, FileText, ExternalLink, Info,
  Smartphone, Zap, Search,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/components/ui/Modal";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const db = supabase as unknown as SupabaseClient;

export type Tipo = "aniversario" | "profissao" | "cliente_desde";

export interface FormRegra {
  name: string;
  send_hour: number;
  canal: "meta" | "z_api";
  meta_connection_id: string | null;
  z_api_connection_id: string | null;
  meta_template_id: string | null;
  message_body: string;
  /** Origem de cada {{n}}, por posição. [0] alimenta {{1}}. */
  variaveis: VarOrigem[];
}

export type VarOrigem =
  | { origem: "primeiro_nome" }
  | { origem: "nome_completo" }
  | { origem: "detalhe" }
  | { origem: "empresa" }
  | { origem: "fixo"; valor: string };

/** As origens oferecidas. Deliberadamente curta: cada campo do contato viraria
 *  uma opção, e uma lista longa transforma uma escolha simples em formulário.
 *  "Texto fixo" cobre o resto — vencimento, valor, mês da campanha. */
export const ORIGENS: { id: VarOrigem["origem"]; rotulo: string; exemplo: string }[] = [
  { id: "primeiro_nome", rotulo: "Primeiro nome",  exemplo: "Maria" },
  { id: "nome_completo", rotulo: "Nome completo",  exemplo: "Maria Aparecida Santos" },
  { id: "detalhe",       rotulo: "Detalhe da data", exemplo: "32 anos" },
  { id: "empresa",       rotulo: "Empresa",        exemplo: "nome da empresa do contato" },
  { id: "fixo",          rotulo: "Texto fixo",     exemplo: "digite abaixo" },
];

interface Template {
  id: string; template_name: string; category: string;
  language: string; components: Componente[];
}
interface Componente { type: string; text?: string; format?: string; buttons?: { text: string }[] }
interface Conexao { id: string; rotulo: string }

/** Texto do BODY — é a única parte que carrega variável e o que o cliente lê. */
export function corpoDoTemplate(comps: Componente[] | null | undefined): string {
  return (comps ?? []).find((c) => c.type === "BODY")?.text ?? "";
}

/** Quantas variáveis {{n}} o corpo usa. Define se o template serve aqui. */
export function contarVariaveis(texto: string): number {
  const achados = texto.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  return new Set(achados.map((m) => m.replace(/\D/g, ""))).size;
}

/** Como a variável aparece na prévia, dado o que foi escolhido para ela. */
function exemploDe(v: VarOrigem | undefined): string {
  if (!v) return "—";
  if (v.origem === "fixo") return v.valor || "(vazio)";
  return ORIGENS.find((o) => o.id === v.origem)?.exemplo ?? "—";
}

/** Renderiza *negrito* do WhatsApp e troca as variáveis pelo que foi mapeado. */
function Previa({ texto, variaveis }: { texto: string; variaveis: VarOrigem[] }) {
  const comVars = texto.replace(/\{\{\s*(\d+)\s*\}\}/g,
    (_, n) => exemploDe(variaveis[Number(n) - 1]));
  const partes  = comVars.split(/(\*[^*]+\*)/g);
  return (
    <p className="text-[13px] leading-relaxed text-agro-text whitespace-pre-wrap">
      {partes.map((p, i) =>
        p.startsWith("*") && p.endsWith("*") && p.length > 2
          ? <strong key={i}>{p.slice(1, -1)}</strong>
          : <span key={i}>{p}</span>)}
    </p>
  );
}

export function RuleModal({
  aberto, titulo, subtitulo, icone, workspaceId, form, setForm,
  salvando, onSalvar, onFechar, edicao,
}: {
  aberto: boolean;
  titulo: string;
  subtitulo: string;
  icone: React.ReactNode;
  workspaceId: string;
  form: FormRegra;
  setForm: React.Dispatch<React.SetStateAction<FormRegra>>;
  salvando: boolean;
  onSalvar: () => void;
  onFechar: () => void;
  edicao: boolean;
}) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [metas,     setMetas]     = useState<Conexao[]>([]);
  const [zapis,     setZapis]     = useState<Conexao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    if (!aberto || !workspaceId) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const [t, m, z] = await Promise.all([
        db.from("meta_templates")
          .select("id, template_name, category, language, components")
          .eq("workspace_id", workspaceId).eq("status", "APPROVED")
          .order("template_name"),
        db.from("meta_connections").select("id, display_phone, business_name").eq("workspace_id", workspaceId),
        db.from("z_api_connections").select("id, name, phone").eq("workspace_id", workspaceId),
      ]);
      if (!vivo) return;
      setTemplates((t.data ?? []) as Template[]);
      setMetas(((m.data ?? []) as Record<string, string>[])
        .map((c) => ({ id: c.id, rotulo: c.display_phone || c.business_name || "número Meta" })));
      setZapis(((z.data ?? []) as Record<string, string>[])
        .map((c) => ({ id: c.id, rotulo: c.name || c.phone || "instância Z-API" })));
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [aberto, workspaceId]);

  // Canal só é oferecido se existir conexão. Escolher um canal sem conexão
  // produziria regra que nunca envia.
  const canaisDisponiveis = useMemo(() => {
    const l: { id: "meta" | "z_api"; rotulo: string; desc: string; icone: typeof Smartphone }[] = [];
    if (metas.length) l.push({ id: "meta",  rotulo: "Meta oficial", desc: "exige template aprovado", icone: Smartphone });
    if (zapis.length) l.push({ id: "z_api", rotulo: "Z-API",        desc: "texto livre, via não oficial", icone: Zap });
    return l;
  }, [metas, zapis]);

  // Escolhe canal e conexão automaticamente. A conexão não é um campo da tela
  // porque quase todo workspace tem uma só por canal — mas ELA É OBRIGATÓRIA:
  // sem ela o ticker desiste da regra em silêncio, e a regra fica ligada sem
  // nunca enviar.
  useEffect(() => {
    if (carregando || canaisDisponiveis.length === 0) return;
    setForm((f) => {
      const canal = canaisDisponiveis.some((c) => c.id === f.canal) ? f.canal : canaisDisponiveis[0].id;
      return {
        ...f,
        canal,
        meta_connection_id:  canal === "meta"  ? (f.meta_connection_id  ?? metas[0]?.id ?? null) : f.meta_connection_id,
        z_api_connection_id: canal === "z_api" ? (f.z_api_connection_id ?? zapis[0]?.id ?? null) : f.z_api_connection_id,
      };
    });
  }, [carregando, canaisDisponiveis, metas, zapis, setForm]);

  const selecionado = templates.find((t) => t.id === form.meta_template_id) ?? null;
  const corpoSel    = corpoDoTemplate(selecionado?.components);
  const varsSel     = contarVariaveis(corpoSel);

  // A Meta recusa a mensagem inteira quando a contagem de parametros nao bate
  // com o template. Entao "completo" e: uma origem por variavel, e texto fixo
  // preenchido — fixo vazio manda string vazia e a mensagem sai truncada.
  const mapeamentoCompleto =
    form.variaveis.length === varsSel &&
    form.variaveis.every((v) => v.origem !== "fixo" || v.valor.trim().length > 0);

  function definirVar(i: number, v: VarOrigem) {
    setForm((f) => {
      const lista = [...f.variaveis];
      lista[i] = v;
      return { ...f, variaveis: lista };
    });
  }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) =>
      t.template_name.toLowerCase().includes(q) ||
      corpoDoTemplate(t.components).toLowerCase().includes(q));
  }, [templates, busca]);

  const podeSalvar =
    form.name.trim().length >= 2 &&
    canaisDisponiveis.length > 0 &&
    (form.canal === "meta"
      ? Boolean(form.meta_template_id) && mapeamentoCompleto
      : form.message_body.trim().length >= 5);

  return (
    <Modal open={aberto} onClose={onFechar} title={titulo} subtitle={subtitulo} icon={icone} size="xl">
      {carregando ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-agro-green" /></div>
      ) : (
        <div className="space-y-5">

          {/* ── Nome e hora ─────────────────────── */}
          <div className="grid sm:grid-cols-[1fr_140px] gap-3">
            <div className="space-y-1.5">
              <label className="field-label">Nome da regra</label>
              <input value={form.name} autoFocus
                     onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                     className="input-agro w-full" />
            </div>
            <div className="space-y-1.5">
              <label className="field-label">Hora do envio</label>
              <select value={form.send_hour}
                      onChange={(e) => setForm((f) => ({ ...f, send_hour: Number(e.target.value) }))}
                      className="input-agro w-full">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-agro-muted-2 -mt-3">
            Horário de Brasília. Entre 9h e 11h costuma ser o melhor — cedo demais incomoda.
          </p>

          {/* ── Canal ───────────────────────────── */}
          {canaisDisponiveis.length === 0 ? (
            <div className="rounded-xl p-4 flex items-start gap-2.5"
                 style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)" }}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#f87171" }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "#f87171" }}>Nenhum canal conectado</p>
                <p className="text-xs mt-1" style={{ color: "#fca5a5" }}>
                  Conecte um número de WhatsApp antes de criar a regra — sem canal não há por onde enviar.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="field-label">Canal de envio</label>
              <div className="grid sm:grid-cols-2 gap-2">
                {canaisDisponiveis.map((c) => {
                  const ativo = form.canal === c.id;
                  const Icone = c.icone;
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setForm((f) => ({ ...f, canal: c.id }))}
                      className="flex items-start gap-2.5 p-3 rounded-xl text-left transition-all"
                      style={ativo
                        ? { background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.4)" }
                        : { background: "rgba(0,0,0,0.2)", border: "1px solid rgba(63,176,108,0.12)" }}>
                      <Icone className="w-4 h-4 shrink-0 mt-0.5"
                             style={{ color: ativo ? "#3fb06c" : "#6b8f77" }} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-agro-text">{c.rotulo}</p>
                        <p className="text-[10px] text-agro-muted-2 mt-0.5">{c.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Mensagem: Meta = template ───────── */}
          {form.canal === "meta" && canaisDisponiveis.length > 0 && (
            <div className="space-y-2">
              <label className="field-label flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> Template aprovado
              </label>

              <div className="flex items-start gap-2.5 p-3 rounded-xl text-xs"
                   style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)" }}>
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#60a5fa" }} />
                <p style={{ color: "#93c5fd" }} className="leading-relaxed">
                  Mensagem de relacionamento chega a quem não fala com você há meses — fora da
                  janela de 24h. Ali a Meta só aceita template aprovado; texto livre é recusado
                  por ela, não pelo sistema.
                </p>
              </div>

              {templates.length === 0 ? (
                <div className="rounded-xl p-4 text-center"
                     style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
                  <AlertTriangle className="w-5 h-5 mx-auto mb-2" style={{ color: "#fbbf24" }} />
                  <p className="text-sm font-semibold" style={{ color: "#fbbf24" }}>
                    Nenhum template aprovado ainda
                  </p>
                  <p className="text-xs mt-1 mb-3" style={{ color: "#e5c07b" }}>
                    A aprovação da Meta leva de minutos a 48h. Crie o template primeiro.
                  </p>
                  <button type="button" onClick={() => { onFechar(); navigate("/templates"); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-agro-text"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(63,176,108,0.25)" }}>
                    Criar template <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <>
                  {templates.length > 4 && (
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-agro-muted-2" />
                      <input value={busca} onChange={(e) => setBusca(e.target.value)}
                             placeholder="Buscar template…"
                             className="input-agro w-full pl-9 text-xs py-2" />
                    </div>
                  )}

                  <div className="space-y-1.5 max-h-[380px] overflow-y-auto scrollbar-thin pr-1">
                    {filtrados.map((t) => {
                      const corpo = corpoDoTemplate(t.components);
                      const vars  = contarVariaveis(corpo);
                      const ativo = form.meta_template_id === t.id;
                      return (
                        <button key={t.id} type="button"
                          onClick={() => setForm((f) => ({
                            ...f,
                            meta_template_id: t.id,
                            // Palpite: a primeira variavel quase sempre e o nome;
                            // as demais o usuario decide. Comecar tudo vazio faria
                            // todo template de 3 variaveis exigir 3 cliques antes
                            // de a previa dizer qualquer coisa.
                            variaveis: Array.from({ length: vars }, (_, i) =>
                              i === 0 ? { origem: "primeiro_nome" as const }
                                      : { origem: "fixo" as const, valor: "" }),
                          }))}
                          className="w-full text-left p-3 rounded-xl transition-all"
                          style={ativo
                            ? { background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.4)" }
                            : { background: "rgba(0,0,0,0.2)", border: "1px solid rgba(63,176,108,0.1)" }}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-agro-text font-mono">{t.template_name}</span>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                                  style={t.category === "MARKETING"
                                    ? { background: "rgba(245,158,11,0.15)", color: "#fbbf24" }
                                    : { background: "rgba(63,176,108,0.15)", color: "#3fb06c" }}>
                              {t.category}
                            </span>
                            {vars > 0 && (
                              <span className="text-[9px] text-agro-muted-2">
                                {vars} variáve{vars === 1 ? "l" : "is"}
                              </span>
                            )}
                            {ativo && <Check className="w-3.5 h-3.5 ml-auto shrink-0" style={{ color: "#3fb06c" }} />}
                          </div>
                          <p className="text-[11px] text-agro-muted mt-1.5 line-clamp-2 leading-snug">
                            {corpo || "(sem corpo)"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Prévia do que chega */}
              {selecionado && (
                <div className="rounded-xl p-3.5 space-y-2.5"
                     style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(63,176,108,0.12)" }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2">
                    Como chega no WhatsApp
                  </p>
                  <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5"
                       style={{ background: "linear-gradient(135deg, rgba(63,176,108,0.22), rgba(22,163,74,0.12))",
                                border: "1px solid rgba(63,176,108,0.3)", borderBottomRightRadius: 6 }}>
                    <Previa texto={corpoSel} variaveis={form.variaveis} />
                  </div>

                  {varsSel > 0 && (
                    <div className="space-y-2 pt-2.5" style={{ borderTop: "1px solid rgba(63,176,108,0.1)" }}>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2">
                        O que entra em cada variável
                      </p>
                      {Array.from({ length: varsSel }, (_, i) => {
                        const atual = form.variaveis[i];
                        return (
                          <div key={i} className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[11px] font-bold shrink-0 w-9"
                                  style={{ color: "#3fb06c" }}>{`{{${i + 1}}}`}</span>
                            <select
                              value={atual?.origem ?? ""}
                              onChange={(e) => {
                                const o = e.target.value as VarOrigem["origem"];
                                definirVar(i, o === "fixo" ? { origem: "fixo", valor: "" } : { origem: o });
                              }}
                              className="input-agro text-xs py-1.5 flex-1 min-w-[150px]"
                            >
                              <option value="" disabled>escolha a origem…</option>
                              {ORIGENS.map((o) => (
                                <option key={o.id} value={o.id}>{o.rotulo}</option>
                              ))}
                            </select>
                            {atual?.origem === "fixo" && (
                              <input
                                value={atual.valor}
                                onChange={(e) => definirVar(i, { origem: "fixo", valor: e.target.value })}
                                placeholder="texto que vai nesta posição"
                                className="input-agro text-xs py-1.5 flex-1 min-w-[150px]"
                              />
                            )}
                          </div>
                        );
                      })}
                      {!mapeamentoCompleto && (
                        <p className="text-[10px] leading-relaxed" style={{ color: "#fbbf24" }}>
                          Preencha todas as variáveis. A Meta recusa a mensagem inteira quando a
                          contagem de parâmetros não bate com o template.
                        </p>
                      )}
                    </div>
                  )}

                  {selecionado.category === "MARKETING" && (
                    <div className="flex items-start gap-2 pt-1.5"
                         style={{ borderTop: "1px solid rgba(245,158,11,0.15)" }}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-1" style={{ color: "#fbbf24" }} />
                      <p className="text-[10px] leading-relaxed mt-0.5" style={{ color: "#e5c07b" }}>
                        Template de MARKETING é mais caro na Meta e pesa mais na qualidade do
                        número. Para felicitação sem oferta, um template UTILITY costuma ser
                        aprovado e sai melhor.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Mensagem: Z-API = texto livre ───── */}
          {form.canal === "z_api" && canaisDisponiveis.length > 0 && (
            <div className="space-y-1.5">
              <label className="field-label">Mensagem</label>
              <textarea value={form.message_body} rows={3}
                        onChange={(e) => setForm((f) => ({ ...f, message_body: e.target.value }))}
                        placeholder="Parabéns, {{nome}}! Que seu dia seja ótimo. — Equipe"
                        className="input-agro w-full resize-none" />
              <p className="text-[11px] text-agro-muted-2">
                Use <code className="text-agro-green">{"{{nome}}"}</code> para o primeiro nome
                e <code className="text-agro-green">{"{{detalhe}}"}</code> para idade ou profissão.
              </p>
              <div className="flex items-start gap-2 p-2.5 rounded-xl"
                   style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#fbbf24" }} />
                <p className="text-[10px] leading-relaxed" style={{ color: "#e5c07b" }}>
                  A Z-API aceita texto livre porque não é a via oficial — e por isso o número
                  pode ser bloqueado pelo WhatsApp sem aviso. Para operação de verdade, prefira
                  a via Meta com template.
                </p>
              </div>
            </div>
          )}

          {/* ── Ações ───────────────────────────── */}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onFechar}
              className="px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}>Cancelar</button>
            <button onClick={onSalvar} disabled={salvando || !podeSalvar}
              title={podeSalvar ? undefined : "Preencha o nome e escolha o template ou a mensagem"}
              className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {edicao ? "Salvar" : "Criar regra"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
