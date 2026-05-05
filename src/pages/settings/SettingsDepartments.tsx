import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, GitBranch, Save, X, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Department } from "@/types/inbox";

const PRESET_COLORS = [
  "#6366f1", "#3fb06c", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#f97316", "#ec4899",
];

interface WorkspaceRouting {
  routing_enabled: boolean;
  routing_header:  string;
  routing_body:    string;
}

export function SettingsDepartments({ workspaceId }: { workspaceId: string }) {
  const { toast }                                   = useToast();
  const [departments, setDepartments]               = useState<Department[]>([]);
  const [routing, setRouting]                       = useState<WorkspaceRouting>({
    routing_enabled: false,
    routing_header:  "Olá! Bem-vindo(a).",
    routing_body:    "Sobre qual assunto podemos te ajudar? Escolha uma opção:",
  });
  const [loading, setLoading]                       = useState(true);
  const [savingRouting, setSavingRouting]           = useState(false);
  const [editingId, setEditingId]                   = useState<string | null>(null);
  const [showNew, setShowNew]                       = useState(false);
  const [form, setForm]                             = useState({ name: "", color: PRESET_COLORS[0], description: "" });
  const [saving, setSaving]                         = useState(false);
  const [deletingId, setDeletingId]                 = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [deptRes, wsRes] = await Promise.all([
      supabase
        .from("departments")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("order_index", { ascending: true }),
      supabase
        .from("workspaces")
        .select("routing_enabled, routing_header, routing_body")
        .eq("id", workspaceId)
        .single(),
    ]);
    if (deptRes.data)  setDepartments(deptRes.data as Department[]);
    if (wsRes.data)    setRouting(wsRes.data as WorkspaceRouting);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function saveRouting() {
    setSavingRouting(true);
    const { error } = await supabase
      .from("workspaces")
      .update({
        routing_enabled: routing.routing_enabled,
        routing_header:  routing.routing_header,
        routing_body:    routing.routing_body,
      })
      .eq("id", workspaceId);
    setSavingRouting(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Configuração salva!", variant: "success" });
    }
  }

  async function saveDepartment() {
    if (!form.name.trim()) return;
    setSaving(true);

    if (editingId) {
      const { error } = await supabase
        .from("departments")
        .update({ name: form.name.trim(), color: form.color, description: form.description.trim() || null })
        .eq("id", editingId);
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Setor atualizado!", variant: "success" });
        setEditingId(null);
      }
    } else {
      const { error } = await supabase
        .from("departments")
        .insert({
          workspace_id: workspaceId,
          name:         form.name.trim(),
          color:        form.color,
          description:  form.description.trim() || null,
          order_index:  departments.length,
        });
      if (error) {
        toast({ title: "Erro ao criar setor", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Setor criado!", variant: "success" });
        setShowNew(false);
      }
    }

    setSaving(false);
    setForm({ name: "", color: PRESET_COLORS[0], description: "" });
    fetchData();
  }

  async function deleteDepartment(id: string) {
    setDeletingId(id);
    const { error } = await supabase.from("departments").delete().eq("id", id);
    setDeletingId(null);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Setor removido", variant: "success" });
      fetchData();
    }
  }

  function startEdit(dept: Department) {
    setEditingId(dept.id);
    setShowNew(false);
    setForm({ name: dept.name, color: dept.color, description: dept.description ?? "" });
  }

  function cancelEdit() {
    setEditingId(null);
    setShowNew(false);
    setForm({ name: "", color: PRESET_COLORS[0], description: "" });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-agro-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Roteamento automático */}
      <div
        className="rounded-2xl p-5 space-y-4"
        style={{ background: "rgba(8,16,10,0.6)", border: "1px solid rgba(63,176,108,0.12)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-agro-text">Menu de roteamento automático</p>
            <p className="text-xs text-agro-muted mt-0.5">
              Envia um menu interativo no primeiro contato e roteia para o setor selecionado.
            </p>
          </div>
          <button
            onClick={() => setRouting((r) => ({ ...r, routing_enabled: !r.routing_enabled }))}
            className={`relative w-11 h-6 rounded-full transition-colors ${routing.routing_enabled ? "bg-agro-green" : "bg-agro-muted-2/30"}`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${routing.routing_enabled ? "left-6" : "left-1"}`}
            />
          </button>
        </div>

        {routing.routing_enabled && (
          <div className="space-y-3 pt-1">
            <div>
              <p className="text-xs text-agro-muted-2 uppercase tracking-widest mb-1.5">Cabeçalho da mensagem</p>
              <input
                className="input-agro w-full text-sm"
                value={routing.routing_header}
                onChange={(e) => setRouting((r) => ({ ...r, routing_header: e.target.value }))}
                maxLength={60}
                placeholder="Olá! Bem-vindo(a)."
              />
            </div>
            <div>
              <p className="text-xs text-agro-muted-2 uppercase tracking-widest mb-1.5">Texto do menu</p>
              <textarea
                className="input-agro w-full text-sm resize-none"
                rows={2}
                value={routing.routing_body}
                onChange={(e) => setRouting((r) => ({ ...r, routing_body: e.target.value }))}
                maxLength={1024}
                placeholder="Sobre qual assunto podemos te ajudar?"
              />
            </div>
          </div>
        )}

        <button
          onClick={saveRouting}
          disabled={savingRouting}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-black bg-agro-green hover:bg-agro-green/90 transition-colors disabled:opacity-50"
        >
          {savingRouting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar configuração
        </button>
      </div>

      {/* Lista de setores */}
      <div className="space-y-2">
        {departments.map((dept) => (
          <div key={dept.id}>
            {editingId === dept.id ? (
              <DeptForm
                form={form}
                setForm={setForm}
                onSave={saveDepartment}
                onCancel={cancelEdit}
                saving={saving}
              />
            ) : (
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: "rgba(8,16,10,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: dept.color }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-agro-text truncate">{dept.name}</p>
                  {dept.description && (
                    <p className="text-xs text-agro-muted truncate">{dept.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(dept)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors"
                    style={{ border: "1px solid rgba(63,176,108,0.1)" }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteDepartment(dept.id)}
                    disabled={deletingId === dept.id}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-red-400 transition-colors disabled:opacity-40"
                    style={{ border: "1px solid rgba(63,176,108,0.1)" }}
                  >
                    {deletingId === dept.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {showNew && (
          <DeptForm
            form={form}
            setForm={setForm}
            onSave={saveDepartment}
            onCancel={cancelEdit}
            saving={saving}
          />
        )}

        {!showNew && editingId === null && (
          <button
            onClick={() => { setShowNew(true); setEditingId(null); setForm({ name: "", color: PRESET_COLORS[0], description: "" }); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm text-agro-muted hover:text-agro-text transition-colors"
            style={{ border: "1px dashed rgba(63,176,108,0.2)" }}
          >
            <Plus className="w-4 h-4" />
            Adicionar setor
          </button>
        )}
      </div>

      {departments.length === 0 && !showNew && (
        <div className="text-center py-6">
          <GitBranch className="w-8 h-8 text-agro-muted-2 mx-auto mb-2" />
          <p className="text-sm text-agro-muted">Nenhum setor criado ainda.</p>
        </div>
      )}

    </div>
  );
}

function DeptForm({
  form, setForm, onSave, onCancel, saving,
}: {
  form:    { name: string; color: string; description: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; color: string; description: string }>>;
  onSave:  () => void;
  onCancel:() => void;
  saving:  boolean;
}) {
  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: "rgba(13,26,17,0.9)", border: "1px solid rgba(63,176,108,0.2)" }}
    >
      <input
        autoFocus
        className="input-agro w-full text-sm"
        placeholder="Nome do setor (ex: Habitação)"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        maxLength={24}
      />
      <input
        className="input-agro w-full text-sm"
        placeholder="Descrição (opcional)"
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
      />
      <div>
        <p className="text-xs text-agro-muted-2 mb-2">Cor</p>
        <div className="flex gap-2 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setForm((f) => ({ ...f, color: c }))}
              className="w-6 h-6 rounded-full transition-transform hover:scale-110"
              style={{
                backgroundColor: c,
                outline: form.color === c ? `2px solid ${c}` : "none",
                outlineOffset: "2px",
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saving || !form.name.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-black bg-agro-green hover:bg-agro-green/90 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-agro-muted hover:text-agro-text transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <X className="w-4 h-4" />
          Cancelar
        </button>
      </div>
    </div>
  );
}
