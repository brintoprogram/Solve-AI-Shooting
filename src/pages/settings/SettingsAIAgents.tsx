import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, Bot, Save, X, Loader2, Shuffle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Department } from "@/types/inbox";

interface AIAgent {
  id:            string;
  name:          string;
  system_prompt: string;
  model:         string;
  is_active:     boolean;
  is_triage:     boolean;
  department_id: string | null;
  created_at:    string;
}

const MODELS = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku (rápido, econômico)" },
  { value: "claude-sonnet-4-6",         label: "Claude Sonnet (equilibrado)"      },
  { value: "gpt-4o-mini",               label: "GPT-4o Mini (OpenAI)"             },
];

const EMPTY_FORM = {
  name:          "",
  system_prompt: "",
  model:         MODELS[0].value,
  is_triage:     false,
  department_id: "",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function SettingsAIAgents({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast();

  const [agents,      setAgents]      = useState<AIAgent[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showNew,     setShowNew]     = useState(false);
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [saving,      setSaving]      = useState(false);
  const [deletingId,  setDeletingId]  = useState<string | null>(null);
  const [togglingId,  setTogglingId]  = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [agentsRes, deptsRes] = await Promise.all([
      db.from("ai_agents")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("is_triage", { ascending: false })   // triador sempre primeiro
        .order("created_at", { ascending: true }),
      db.from("departments")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("order_index", { ascending: true }),
    ]);
    if (agentsRes.error) {
      toast({ title: "Erro ao carregar agentes", description: agentsRes.error.message, variant: "destructive" });
    } else {
      setAgents(agentsRes.data ?? []);
    }
    setDepartments(deptsRes.data ?? []);
    setLoading(false);
  }, [workspaceId, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const existingTriage = agents.find((a) => a.is_triage && a.id !== editingId);

  function startEdit(agent: AIAgent) {
    setEditingId(agent.id);
    setShowNew(false);
    setForm({
      name:          agent.name,
      system_prompt: agent.system_prompt,
      model:         agent.model,
      is_triage:     agent.is_triage,
      department_id: agent.department_id ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setShowNew(false);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }
    if (!form.system_prompt.trim()) {
      toast({ title: "Prompt de sistema obrigatório", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // If setting this agent as triage, clear previous triage agent first
      if (form.is_triage && existingTriage) {
        await db.from("ai_agents").update({ is_triage: false }).eq("id", existingTriage.id);
      }

      const payload = {
        name:          form.name.trim(),
        system_prompt: form.system_prompt.trim(),
        model:         form.model,
        is_triage:     form.is_triage,
        department_id: form.is_triage || !form.department_id ? null : form.department_id,
        // Triage agents start inactive by default when first created
        ...(editingId ? {} : { is_active: !form.is_triage }),
      };

      if (editingId) {
        const { error } = await db.from("ai_agents").update(payload).eq("id", editingId);
        if (error) throw error;
        toast({ title: "Agente atualizado" });
      } else {
        const { error } = await db.from("ai_agents").insert({ workspace_id: workspaceId, ...payload });
        if (error) throw error;
        toast({ title: form.is_triage ? "Agente de triagem criado (inativo por padrão)" : "Agente criado" });
      }
      cancelEdit();
      fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Erro ao salvar", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const { error } = await db.from("ai_agents").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro ao excluir agente", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Agente excluído" });
      fetchData();
    }
    setDeletingId(null);
  }

  async function toggleActive(agent: AIAgent) {
    setTogglingId(agent.id);
    const { error } = await db.from("ai_agents").update({ is_active: !agent.is_active }).eq("id", agent.id);
    if (error) {
      toast({ title: "Erro ao alterar status", description: error.message, variant: "destructive" });
    } else {
      setAgents((prev) => prev.map((a) => a.id === agent.id ? { ...a, is_active: !a.is_active } : a));
    }
    setTogglingId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-agro-muted" />
      </div>
    );
  }

  const cardStyle = { background: "rgba(8,16,10,0.6)", border: "1px solid rgba(63,176,108,0.12)" };

  const deptMap = Object.fromEntries(departments.map((d) => [d.id, d]));

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-agro-text">Agentes de IA</p>
          <p className="text-xs text-agro-muted mt-0.5">
            Crie agentes por setor e um agente de triagem que distribui conversas automaticamente.
          </p>
        </div>
        {!showNew && !editingId && (
          <button
            onClick={() => { setShowNew(true); setEditingId(null); setForm(EMPTY_FORM); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-agro-green/10 text-agro-green hover:bg-agro-green/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo agente
          </button>
        )}
      </div>

      {/* Form — create or edit */}
      {(showNew || editingId) && (
        <div className="rounded-2xl p-5 space-y-4" style={cardStyle}>
          <p className="text-xs font-semibold text-agro-text uppercase tracking-widest">
            {editingId ? "Editar agente" : "Novo agente"}
          </p>

          <div className="space-y-3">
            {/* Name */}
            <div>
              <p className="text-xs text-agro-muted-2 uppercase tracking-widest mb-1.5">Nome do agente</p>
              <input
                className="input-agro w-full text-sm"
                placeholder="Ex: Suporte ao Cliente, Triagem..."
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            {/* Triage checkbox */}
            <div
              className="flex items-start gap-3 p-3 rounded-xl cursor-pointer select-none"
              style={{ background: form.is_triage ? "rgba(139,92,246,0.08)" : "rgba(0,0,0,0.2)", border: `1px solid ${form.is_triage ? "rgba(139,92,246,0.25)" : "rgba(63,176,108,0.08)"}` }}
              onClick={() => setForm((f) => ({ ...f, is_triage: !f.is_triage, department_id: f.is_triage ? f.department_id : "" }))}
            >
              <div
                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5 border transition-colors ${form.is_triage ? "bg-violet-500 border-violet-500" : "border-agro-muted-2/50 bg-transparent"}`}
              >
                {form.is_triage && <span className="text-white text-[10px] font-bold">✓</span>}
              </div>
              <div>
                <p className="text-xs font-semibold text-agro-text">Agente de Triagem</p>
                <p className="text-[11px] text-agro-muted mt-0.5">
                  Analisa a primeira mensagem de conversas sem agente e distribui automaticamente para o setor correto.
                  {existingTriage && (
                    <span className="text-amber-400"> Atenção: "{existingTriage.name}" perderá essa função.</span>
                  )}
                </p>
                {form.is_triage && (
                  <p className="text-[11px] text-violet-400 mt-1">Nascerá desativado — ligue manualmente quando estiver pronto.</p>
                )}
              </div>
            </div>

            {/* Department — only if not triage */}
            {!form.is_triage && (
              <div>
                <p className="text-xs text-agro-muted-2 uppercase tracking-widest mb-1.5">Setor associado</p>
                <select
                  className="input-agro w-full text-sm"
                  value={form.department_id}
                  onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}
                >
                  <option value="">Nenhum setor</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                {departments.length === 0 && (
                  <p className="text-[11px] text-agro-muted mt-1">
                    Nenhum setor criado. Configure em Configurações → WhatsApp → Setores.
                  </p>
                )}
              </div>
            )}

            {/* Model */}
            <div>
              <p className="text-xs text-agro-muted-2 uppercase tracking-widest mb-1.5">Modelo de IA</p>
              <select
                className="input-agro w-full text-sm"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              >
                {MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* System prompt */}
            <div>
              <p className="text-xs text-agro-muted-2 uppercase tracking-widest mb-1.5">
                {form.is_triage ? "Prompt de triagem" : "Prompt de sistema"}
              </p>
              {form.is_triage && (
                <div
                  className="mb-2 p-3 rounded-xl text-[11px] text-violet-300 space-y-1"
                  style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)" }}
                >
                  <p className="font-semibold">Instrução de roteamento (injetada automaticamente):</p>
                  <p className="font-mono text-[10px] text-violet-400/80">
                    ROUTE:NomeDoSetor — quando souber o setor correto<br />
                    ROUTE:NONE — quando precisar de mais informações<br />
                    Texto antes da linha ROUTE: é enviado ao cliente.
                  </p>
                  <p>Use os nomes exatos dos seus setores (ex: Suporte, Vendas).</p>
                </div>
              )}
              <textarea
                className="input-agro w-full text-sm resize-none"
                rows={form.is_triage ? 5 : 6}
                placeholder={
                  form.is_triage
                    ? `Ex: Analise a mensagem do cliente e determine o setor:\n- Problema técnico ou erro → ROUTE:Suporte\n- Dúvida sobre preço ou contrato → ROUTE:Vendas\n- Se não souber → ROUTE:NONE`
                    : `Ex: Você é um assistente de suporte da empresa XYZ. Responda de forma clara e objetiva em português. Não forneça informações sobre preços sem antes consultar o cliente sobre o produto desejado.`
                }
                value={form.system_prompt}
                onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-agro-green text-black hover:bg-agro-green/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button
              onClick={cancelEdit}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-agro-muted hover:text-agro-text transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Agent list */}
      {agents.length === 0 && !showNew ? (
        <div className="rounded-2xl p-8 text-center" style={cardStyle}>
          <Bot className="w-8 h-8 text-agro-muted mx-auto mb-2" />
          <p className="text-sm text-agro-muted">Nenhum agente criado ainda.</p>
          <p className="text-xs text-agro-muted/70 mt-1">Crie um agente de triagem para distribuição automática, ou um agente por setor para atribuição manual.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => {
            const dept = agent.department_id ? deptMap[agent.department_id] : null;
            return (
              <div key={agent.id} className="rounded-2xl p-4" style={cardStyle}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Icon — triage gets shuffle, dept agents get bot */}
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                      style={{
                        background: agent.is_triage ? "rgba(139,92,246,0.12)" : "rgba(63,176,108,0.1)",
                      }}
                    >
                      {agent.is_triage
                        ? <Shuffle className="w-4 h-4 text-violet-400" />
                        : <Bot className="w-4 h-4 text-agro-green" />
                      }
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-agro-text truncate">{agent.name}</p>

                        {/* Triage badge */}
                        {agent.is_triage && (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                            style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)" }}
                          >
                            Triagem
                          </span>
                        )}

                        {/* Department badge */}
                        {dept && (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                            style={{
                              color:       dept.color,
                              background:  `${dept.color}18`,
                              border:      `1px solid ${dept.color}45`,
                            }}
                          >
                            {dept.name}
                          </span>
                        )}

                        {/* Model badge */}
                        <span className="text-xs text-agro-muted bg-agro-muted/10 px-2 py-0.5 rounded-full shrink-0">
                          {MODELS.find((m) => m.value === agent.model)?.label.split(" ")[0] ?? agent.model}
                        </span>
                      </div>

                      <p className="text-xs text-agro-muted mt-1 line-clamp-2">{agent.system_prompt}</p>

                      {/* Inactive triage warning */}
                      {agent.is_triage && !agent.is_active && (
                        <p className="text-[11px] text-amber-400/80 mt-1.5">
                          ⚠ Triagem desativada — ligue para começar a distribuir conversas automaticamente.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Active toggle */}
                    <button
                      onClick={() => toggleActive(agent)}
                      disabled={togglingId === agent.id}
                      title={agent.is_active ? "Ativo — clique para desativar" : "Inativo — clique para ativar"}
                      className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${agent.is_active ? (agent.is_triage ? "bg-violet-500" : "bg-agro-green") : "bg-agro-muted-2/30"}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${agent.is_active ? "left-4" : "left-0.5"}`} />
                    </button>

                    <button
                      onClick={() => startEdit(agent)}
                      className="p-1.5 rounded-lg text-agro-muted hover:text-agro-text hover:bg-white/5 transition-colors"
                      title="Editar"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleDelete(agent.id)}
                      disabled={deletingId === agent.id}
                      className="p-1.5 rounded-lg text-agro-muted hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                      title="Excluir"
                    >
                      {deletingId === agent.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />
                      }
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
