// Relacionamento — mensagens que não pedem nada.
//
// Cobrança fala com o cliente quando ELE deve algo. Aqui a mensagem é sobre
// ele: aniversário, o dia da profissão dele, tempo de casa. É a única do
// sistema que não cobra, e por isso a que mais constrói crédito para as que
// cobram.
//
// A tela começa pela SAÚDE DOS DADOS de propósito. O modo de falhar aqui não é
// erro na tela — é regra ligada sobre coluna vazia: nada dispara, ninguém vê
// erro, e a conclusão é "o sistema não funciona".

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cake, Loader2, Plus, Briefcase, HeartHandshake, CalendarDays, AlertTriangle,
  Play, Pause, Pencil, Users, TrendingUp, Coins, Info, Check, Clock,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useCredits } from "@/hooks/useCredits";
import { useToast } from "@/hooks/use-toast";
import { Topbar } from "@/components/layout/Topbar";
import { Modal } from "@/components/ui/Modal";
import { Presence } from "@/components/ui/Presence";
import { log } from "@/lib/logger";

/* As tabelas e funcoes de relacionamento sao novas e ainda nao estao em
   src/types/database.ts. Regenerar aquele arquivo hoje resolve estas chamadas
   e quebra 105 outros pontos, porque o gerador atual emite tipos diferentes do
   que o codigo existente espera — e uma tarefa separada, nao um efeito colateral
   desta feature. Ate la o acesso e por cliente sem tipo; o retorno continua
   tipado pelas interfaces abaixo. */
const db = supabase as unknown as SupabaseClient;

type Tipo = "aniversario" | "profissao" | "cliente_desde";

interface Regra {
  id: string; name: string; tipo: Tipo; status: string;
  send_hour: number; canal: string; message_body: string | null;
  profissao_chave: string | null; enviados: number;
}
interface Saude {
  contatos: number; com_nascimento: number; com_profissao: number;
  profissao_sem_data: number; com_cliente_desde: number;
}
interface Previsao { dia: string; total: number }
interface ProfissaoBase { profissao: string; contatos: number; rotulo: string | null; dia: number | null; mes: number | null }

const TIPOS: Record<Tipo, { rotulo: string; icone: typeof Cake; cor: string; explica: string; campo: string }> = {
  aniversario: {
    rotulo: "Aniversário", icone: Cake, cor: "#f472b6", campo: "data de nascimento",
    explica: "Dispara no dia e mês do nascimento, todo ano. Quem nasceu em 29/02 recebe dia 28 nos anos não bissextos.",
  },
  profissao: {
    rotulo: "Dia da profissão", icone: Briefcase, cor: "#60a5fa", campo: "profissão",
    explica: "Dispara na data comemorativa da profissão do contato — Dia do Administrador, do Médico, do Contador.",
  },
  cliente_desde: {
    rotulo: "Tempo de casa", icone: HeartHandshake, cor: "#c084fc", campo: "cliente desde",
    explica: "Dispara no aniversário de quando virou cliente. Só a partir do primeiro ano completo.",
  },
};

const STATUS_ESTILO: Record<string, { cor: string; bg: string; rotulo: string }> = {
  active: { cor: "#4ade80", bg: "rgba(74,222,128,0.1)",   rotulo: "Ativa"    },
  paused: { cor: "#fbbf24", bg: "rgba(245,158,11,0.1)",   rotulo: "Pausada"  },
  draft:  { cor: "#7a9e83", bg: "rgba(122,158,131,0.08)", rotulo: "Rascunho" },
};

export function Relationship() {
  const { workspaceId } = useAuth();
  const credito = useCredits();
  const { toast } = useToast();

  const [regras,     setRegras]     = useState<Regra[]>([]);
  const [saude,      setSaude]      = useState<Saude | null>(null);
  const [profs,      setProfs]      = useState<ProfissaoBase[]>([]);
  const [previsoes,  setPrevisoes]  = useState<Record<string, Previsao[]>>({});
  const [carregando, setCarregando] = useState(true);
  const [salvando,   setSalvando]   = useState(false);

  const [editando, setEditando] = useState<Regra | null>(null);
  const [novo,     setNovo]     = useState<Tipo | null>(null);
  const [form,     setForm]     = useState({ name: "", send_hour: 9, message_body: "" });

  const carregar = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [r, s, p] = await Promise.all([
        db.from("relationship_rules").select("*").eq("workspace_id", workspaceId).order("created_at"),
        db.rpc("relacionamento_saude",      { p_workspace_id: workspaceId }),
        db.rpc("relacionamento_profissoes", { p_workspace_id: workspaceId }),
      ]);
      const lista = (r.data ?? []) as unknown as Regra[];
      setRegras(lista);
      setSaude(((s.data as unknown as Saude[]) ?? [])[0] ?? null);
      setProfs((p.data as unknown as ProfissaoBase[]) ?? []);

      // Previsão por regra: uma chamada cada, e só das que existem.
      const prev: Record<string, Previsao[]> = {};
      await Promise.all(lista.map(async (rg) => {
        const { data } = await db.rpc("relacionamento_previsao", { p_rule_id: rg.id, p_dias: 30 });
        prev[rg.id] = (data as unknown as Previsao[]) ?? [];
      }));
      setPrevisoes(prev);
    } catch (e) {
      log.error("relacionamento_falhou", { err: e instanceof Error ? e.message : String(e) });
    } finally { setCarregando(false); }
  }, [workspaceId]);

  useEffect(() => { carregar(); }, [carregar]);

  const semDado = useMemo(() => {
    if (!saude) return {} as Record<Tipo, boolean>;
    return {
      aniversario:   Number(saude.com_nascimento) === 0,
      profissao:     Number(saude.com_profissao) === 0,
      cliente_desde: Number(saude.com_cliente_desde) === 0,
    } as Record<Tipo, boolean>;
  }, [saude]);

  async function criar(tipo: Tipo) {
    if (!workspaceId) return;
    setSalvando(true);
    try {
      const { error } = await db.from("relationship_rules").insert({
        workspace_id: workspaceId,
        name: form.name.trim() || TIPOS[tipo].rotulo,
        tipo, send_hour: form.send_hour,
        message_body: form.message_body.trim() || null,
        status: "draft",
      });
      if (error) throw error;
      toast({ title: "Regra criada", description: "Nasce como rascunho — revise antes de ativar.", variant: "success" });
      setNovo(null);
      await carregar();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha", variant: "destructive" });
    } finally { setSalvando(false); }
  }

  async function salvarEdicao() {
    if (!editando) return;
    setSalvando(true);
    try {
      const { error } = await db.from("relationship_rules")
        .update({
          name: form.name.trim(), send_hour: form.send_hour,
          message_body: form.message_body.trim() || null, updated_at: new Date().toISOString(),
        })
        .eq("id", editando.id);
      if (error) throw error;
      toast({ title: "Regra salva", variant: "success" });
      setEditando(null);
      await carregar();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha", variant: "destructive" });
    } finally { setSalvando(false); }
  }

  async function alternar(r: Regra) {
    const novoStatus = r.status === "active" ? "paused" : "active";
    const { error } = await db.from("relationship_rules")
      .update({ status: novoStatus, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    await carregar();
  }

  const custoMes = (id: string) =>
    (previsoes[id] ?? []).reduce((s, d) => s + Number(d.total), 0) * (credito.custo_mensagem || 1);

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Relacionamento" }]} />

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        <div className="animate-fade-up">
          <h1 className="font-display text-2xl font-bold text-agro-text">Relacionamento</h1>
          <p className="text-agro-muted mt-1.5 text-sm leading-relaxed max-w-2xl">
            Mensagens que não pedem nada: aniversário, o dia da profissão do cliente e tempo de casa.
            Disparam sozinhas, todo ano, sem ninguém lembrar.
          </p>
        </div>

        {carregando ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-agro-green" /></div>
        ) : (
          <>
            {/* ── Saúde dos dados ─────────────────── */}
            {saude && (
              <div className="rounded-2xl p-5 animate-fade-up-delay-1"
                   style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.12)" }}>
                <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-4">
                  <Users className="w-3.5 h-3.5" /> Quanto da sua base está preenchida
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { rot: "contatos",       n: Number(saude.contatos),          total: null },
                    { rot: "com aniversário",n: Number(saude.com_nascimento),    total: Number(saude.contatos) },
                    { rot: "com profissão",  n: Number(saude.com_profissao),     total: Number(saude.contatos) },
                    { rot: "com data de cliente", n: Number(saude.com_cliente_desde), total: Number(saude.contatos) },
                  ].map((c) => {
                    const pct = c.total ? Math.round((c.n / Math.max(c.total, 1)) * 100) : null;
                    const vazio = c.total !== null && c.n === 0;
                    return (
                      <div key={c.rot}>
                        <p className="text-xl font-bold tabular-nums" style={{ color: vazio ? "#fbbf24" : "#e8f0ea" }}>
                          {c.n.toLocaleString("pt-BR")}
                          {pct !== null && <span className="text-xs text-agro-muted-2 font-normal"> · {pct}%</span>}
                        </p>
                        <p className="text-[10px] text-agro-muted-2 mt-0.5">{c.rot}</p>
                      </div>
                    );
                  })}
                </div>

                {Number(saude.profissao_sem_data) > 0 && (
                  <div className="flex items-start gap-2.5 mt-4 pt-4 text-xs"
                       style={{ borderTop: "1px solid rgba(245,158,11,0.2)" }}>
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#fbbf24" }} />
                    <p style={{ color: "#e5c07b" }}>
                      <strong>{Number(saude.profissao_sem_data).toLocaleString("pt-BR")} contatos</strong> têm
                      profissão preenchida que não bate com nenhuma data cadastrada. Eles somem do disparo sem
                      erro nenhum — veja a lista abaixo.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Regras ──────────────────────────── */}
            <div className="space-y-3 animate-fade-up-delay-2">
              {(Object.keys(TIPOS) as Tipo[]).map((tipo) => {
                const cfg   = TIPOS[tipo];
                const regra = regras.find((r) => r.tipo === tipo);
                const Icone = cfg.icone;
                const prev  = regra ? (previsoes[regra.id] ?? []) : [];
                const total30 = prev.reduce((s, d) => s + Number(d.total), 0);
                const maximo  = Math.max(1, ...prev.map((d) => Number(d.total)));

                return (
                  <div key={tipo} className="rounded-2xl p-5"
                       style={{ background: "rgba(13,26,17,0.7)", border: `1px solid ${regra?.status === "active" ? "rgba(63,176,108,0.25)" : "rgba(63,176,108,0.1)"}` }}>

                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                              style={{ background: `${cfg.cor}1f`, color: cfg.cor, border: `1px solid ${cfg.cor}40` }}>
                          <Icone className="w-5 h-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-sm font-semibold text-agro-text">{regra?.name ?? cfg.rotulo}</h2>
                            {regra && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded"
                                    style={{ background: STATUS_ESTILO[regra.status].bg, color: STATUS_ESTILO[regra.status].cor }}>
                                {STATUS_ESTILO[regra.status].rotulo}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-agro-muted mt-1 leading-relaxed max-w-lg">{cfg.explica}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {regra ? (
                          <>
                            <button onClick={() => { setForm({ name: regra.name, send_hour: regra.send_hour, message_body: regra.message_body ?? "" }); setEditando(regra); }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-agro-text"
                              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(63,176,108,0.2)" }}>
                              <Pencil className="w-3.5 h-3.5" /> Editar
                            </button>
                            <button onClick={() => alternar(regra)} disabled={semDado[tipo]}
                              title={semDado[tipo] ? `Nenhum contato tem ${cfg.campo} preenchida` : undefined}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-agro-text disabled:opacity-40 disabled:cursor-not-allowed"
                              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(63,176,108,0.2)" }}>
                              {regra.status === "active" ? <><Pause className="w-3.5 h-3.5" /> Pausar</> : <><Play className="w-3.5 h-3.5" /> Ativar</>}
                            </button>
                          </>
                        ) : (
                          <button onClick={() => { setForm({ name: cfg.rotulo, send_hour: 9, message_body: "" }); setNovo(tipo); }}
                            className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white">
                            <Plus className="w-3.5 h-3.5" /> Criar regra
                          </button>
                        )}
                      </div>
                    </div>

                    {semDado[tipo] && (
                      <div className="flex items-start gap-2.5 mt-4 p-3 rounded-xl text-xs"
                           style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#fbbf24" }} />
                        <p style={{ color: "#e5c07b" }}>
                          Nenhum contato tem <strong>{cfg.campo}</strong> preenchida. Ligada assim, esta regra não
                          dispara para ninguém — e não mostra erro. Preencha na importação de contatos primeiro.
                        </p>
                      </div>
                    )}

                    {/* Previsão de 30 dias */}
                    {regra && !semDado[tipo] && (
                      <div className="mt-4 pt-4" style={{ borderTop: "1px solid rgba(63,176,108,0.08)" }}>
                        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-agro-muted-2">
                            <CalendarDays className="w-3.5 h-3.5" /> Próximos 30 dias
                          </p>
                          <div className="flex items-center gap-4 text-xs">
                            <span className="flex items-center gap-1.5 text-agro-muted">
                              <TrendingUp className="w-3.5 h-3.5" />
                              <strong className="text-agro-text tabular-nums">{total30}</strong> mensagens
                            </span>
                            <span className="flex items-center gap-1.5 text-agro-muted">
                              <Coins className="w-3.5 h-3.5" />
                              <strong className="text-agro-text tabular-nums">{custoMes(regra.id)}</strong> créditos
                            </span>
                            <span className="flex items-center gap-1.5 text-agro-muted-2">
                              <Clock className="w-3.5 h-3.5" /> {String(regra.send_hour).padStart(2, "0")}h
                            </span>
                          </div>
                        </div>

                        <div className="flex items-end gap-[3px] h-14">
                          {prev.map((d) => {
                            const n = Number(d.total);
                            return (
                              <div key={d.dia} className="flex-1 rounded-t transition-all"
                                   title={`${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)} — ${n} mensagem${n === 1 ? "" : "s"}`}
                                   style={{
                                     height: n ? `${Math.max(8, (n / maximo) * 100)}%` : "2px",
                                     background: n ? cfg.cor : "rgba(255,255,255,0.06)",
                                     opacity: n ? 0.85 : 1,
                                   }} />
                            );
                          })}
                        </div>
                        {total30 === 0 && (
                          <p className="text-[11px] text-agro-muted-2 mt-2">
                            Ninguém faz aniversário nos próximos 30 dias — normal em base pequena.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Profissões da base ──────────────── */}
            {profs.length > 0 && (
              <div className="rounded-2xl overflow-hidden animate-fade-up-delay-3"
                   style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.1)" }}>
                <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
                  <Briefcase className="w-3.5 h-3.5 text-agro-green" />
                  <span className="text-xs font-semibold text-agro-text">Profissões na sua base</span>
                </div>
                <div className="divide-y" style={{ borderColor: "#1a2a1e" }}>
                  {profs.slice(0, 20).map((p) => (
                    <div key={p.profissao} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="flex-1 min-w-0 text-xs text-agro-text truncate">{p.profissao}</span>
                      <span className="text-[11px] text-agro-muted-2 tabular-nums shrink-0">
                        {Number(p.contatos).toLocaleString("pt-BR")}
                      </span>
                      {p.rotulo ? (
                        <span className="text-[10px] font-semibold px-2 py-1 rounded shrink-0 w-40 text-center"
                              style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80" }}>
                          {String(p.dia).padStart(2, "0")}/{String(p.mes).padStart(2, "0")} · {p.rotulo?.replace("Dia do ", "")}
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-1 rounded shrink-0 w-40 text-center"
                              style={{ background: "rgba(245,158,11,0.1)", color: "#fbbf24" }}>
                          sem data cadastrada
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-start gap-2.5 p-4 rounded-2xl text-xs animate-fade-up-delay-4"
                 style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)" }}>
              <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#60a5fa" }} />
              <p style={{ color: "#93c5fd" }} className="leading-relaxed">
                Mensagem de aniversário chega a quem não fala com você há meses, ou seja, <strong>fora da janela
                de 24h</strong>. Pela via Meta isso exige template aprovado — e a Meta costuma classificar
                felicitação como <strong>MARKETING</strong>, que é mais caro e pesa na qualidade do número.
                Vale usar com parcimônia e não misturar com oferta.
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── Modal criar / editar ────────────────── */}
      <Presence when={novo !== null || editando !== null}>
        {(v) => {
          const tipo = novo ?? editando?.tipo ?? "aniversario";
          const cfg  = TIPOS[tipo];
          return (
            <Modal open={v} onClose={() => { setNovo(null); setEditando(null); }}
                   title={editando ? "Editar regra" : `Nova regra — ${cfg.rotulo}`}
                   subtitle={cfg.explica} icon={<cfg.icone className="w-5 h-5" />} size="md">
              <div className="space-y-4">
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
                  <p className="text-[11px] text-agro-muted-2">
                    Horário de Brasília. Entre 9h e 11h costuma ser o melhor — cedo demais incomoda.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="field-label">Mensagem</label>
                  <textarea value={form.message_body} rows={3}
                            onChange={(e) => setForm((f) => ({ ...f, message_body: e.target.value }))}
                            placeholder="Parabéns, {{nome}}! Que seu dia seja ótimo. — Equipe"
                            className="input-agro w-full resize-none" />
                  <p className="text-[11px] text-agro-muted-2">
                    Use <code className="text-agro-green">{"{{nome}}"}</code> para o primeiro nome do contato.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => { setNovo(null); setEditando(null); }}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
                    style={{ border: "1px solid rgba(63,176,108,0.15)" }}>Cancelar</button>
                  <button onClick={() => (editando ? salvarEdicao() : criar(tipo))} disabled={salvando}
                    className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
                    {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {editando ? "Salvar" : "Criar"}
                  </button>
                </div>
              </div>
            </Modal>
          );
        }}
      </Presence>
    </div>
  );
}
