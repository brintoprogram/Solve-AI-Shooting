import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, Bot, Save, X, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface AIAgent {
  id:            string;
  name:          string;
  system_prompt: string;
  model:         string;
  is_active:     boolean;
  created_at:    string;
}

const MODELS = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku (rápido, econômico)" },
  { value: "claude-sonnet-4-6",         label: "Claude Sonnet (equilibrado)"      },
  { value: "gpt-4o-mini",               label: "GPT-4o Mini (OpenAI)"             },
];

const EMPTY_FORM = { name: "", system_prompt: "", model: MODELS[0].value };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function SettingsAIAgents({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast();

  const [agents,     setAgents]     = useState<AIAgent[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showNew,    setShowNew]    = useState(false);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db
      .from("ai_agents")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });
    if (error) {
      toast({ title: "Erro ao carregar agentes", description: error.message, variant: "destructive" });
    } else {
      setAgents(data ?? []);
    }
    setLoading(false);
  }, [workspaceId, toast]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  function startEdit(agent: AIAgent) {
    setEditingId(agent.id);
    setShowNew(false);
    setForm({ name: agent.name, system_prompt: agent.system_prompt, model: agent.model });
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
      if (editingId) {
        const { error } = await db
          .from("ai_agents")
          .update({ name: form.name.trim(), system_prompt: form.system_prompt.trim(), model: form.model })
          .eq("id", editingId);
        if (error) throw error;
        toast({ title: "Agente atualizado" });
      } else {
        const { error } = await db.from("ai_agents").insert({
          workspace_id:  workspaceId,
          name:          form.name.trim(),
          system_prompt: form.system_prompt.trim(),
          model:         form.model,
        });
        if (error) throw error;
        toast({ title: "Agente criado" });
      }
      cancelEdit();
      fetchAgents();
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
      fetchAgents();
    }
    setDeletingId(null);
  }

  async function toggleActive(agent: AIAgent) {
    setTogglingId(agent.id);
    const { error } = await db
      .from("ai_agents")
      .update({ is_active: !agent.is_active })
      .eq("id", agent.id);
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

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-agro-text">Agentes de IA</p>
          <p className="text-xs text-agro-muted mt-0.5">
            Crie agentes com funções específicas e atribua-os a conversas do inbox para respostas automáticas.
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
            <div>
              <p className="text-xs text-agro-muted-2 uppercase tracking-widest mb-1.5">Nome do agente</p>
              <input
                className="input-agro w-full text-sm"
                placeholder="Ex: Suporte ao Cliente, Vendas..."
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

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

            <div>
              <p className="text-xs text-agro-muted-2 uppercase tracking-widest mb-1.5">Prompt de sistema</p>
              <textarea
                className="input-agro w-full text-sm resize-none"
                rows={6}
                placeholder={`Ex: Você é um assistente de suporte da empresa XYZ. Responda de forma clara e objetiva em português. Não forneça informações sobre preços sem antes consultar o cliente sobre o produto desejado.`}
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
          <p className="text-xs text-agro-muted/70 mt-1">Crie um agente e atribua-o a uma conversa no inbox.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <div key={agent.id} className="rounded-2xl p-4" style={cardStyle}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-agro-green/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-agro-green" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-agro-text truncate">{agent.name}</p>
                      <span className="text-xs text-agro-muted bg-agro-muted/10 px-2 py-0.5 rounded-full shrink-0">
                        {MODELS.find((m) => m.value === agent.model)?.label.split(" ")[0] ?? agent.model}
                      </span>
                    </div>
                    <p className="text-xs text-agro-muted mt-1 line-clamp-2">{agent.system_prompt}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Active toggle */}
                  <button
                    onClick={() => toggleActive(agent)}
                    disabled={togglingId === agent.id}
                    title={agent.is_active ? "Ativo — clique para desativar" : "Inativo — clique para ativar"}
                    className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${agent.is_active ? "bg-agro-green" : "bg-agro-muted-2/30"}`}
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
          ))}
        </div>
      )}
    </div>
  );
}
