import { useState, useEffect, useCallback } from "react";
import { Loader2, Save, ShieldOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { Department } from "@/types/inbox";


interface RulesForm {
  is_ai_negotiation_enabled: boolean;
  max_discount_pct:          string;
  max_installments:          string;
  min_installment_amount:    string;
  max_negotiation_rounds:    string;
  auto_escalate_keywords:    string; // comma-separated in the UI
  escalation_department_id:  string;
  portal_token_ttl_hours:    string;
}

const DEFAULTS: RulesForm = {
  is_ai_negotiation_enabled: true,
  max_discount_pct:          "20",
  max_installments:          "6",
  min_installment_amount:    "50",
  max_negotiation_rounds:    "3",
  auto_escalate_keywords:    "advogado, procon, fraude, processo",
  escalation_department_id:  "",
  portal_token_ttl_hours:    "48",
};

const SECTION_STYLE: React.CSSProperties = {
  border: "1px solid #1a2e1f", borderRadius: 14, padding: "16px", background: "rgba(0,0,0,0.25)",
};
const SECTION_LABEL = "text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500 mb-3 block";
const FIELD_LABEL   = "text-xs text-gray-500 uppercase tracking-widest mb-1.5 block";

export function SettingsNegotiationRules({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast();
  const [rulesId, setRulesId]       = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm]             = useState<RulesForm>(DEFAULTS);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [rulesRes, deptsRes] = await Promise.all([
      supabase.from("negotiation_rules").select("*").eq("workspace_id", workspaceId).maybeSingle(),
      supabase.from("departments").select("*").eq("workspace_id", workspaceId).order("order_index", { ascending: true }),
    ]);
    if (rulesRes.data) {
      const r = rulesRes.data;
      setRulesId(r.id);
      setForm({
        is_ai_negotiation_enabled: r.is_ai_negotiation_enabled,
        max_discount_pct:          String(r.max_discount_pct),
        max_installments:          String(r.max_installments),
        min_installment_amount:    String(r.min_installment_amount),
        max_negotiation_rounds:    String(r.max_negotiation_rounds),
        auto_escalate_keywords:    (r.auto_escalate_keywords ?? []).join(", "),
        escalation_department_id:  r.escalation_department_id ?? "",
        portal_token_ttl_hours:    String(r.portal_token_ttl_hours),
      });
    } else {
      setRulesId(null);
      setForm(DEFAULTS);
    }
    setDepartments(deptsRes.data ?? []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleSave() {
    const payload = {
      workspace_id:               workspaceId,
      is_ai_negotiation_enabled:  form.is_ai_negotiation_enabled,
      max_discount_pct:           Number(form.max_discount_pct),
      max_installments:           Number(form.max_installments),
      min_installment_amount:     Number(form.min_installment_amount),
      max_negotiation_rounds:     Number(form.max_negotiation_rounds),
      auto_escalate_keywords:     form.auto_escalate_keywords.split(",").map((k) => k.trim()).filter(Boolean),
      escalation_department_id:   form.escalation_department_id || null,
      portal_token_ttl_hours:     Number(form.portal_token_ttl_hours),
    };

    if (Number(form.max_discount_pct) < 0 || Number(form.max_discount_pct) > 100) {
      toast({ title: "Desconto máximo deve estar entre 0 e 100%", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { error } = rulesId
        ? await supabase.from("negotiation_rules").update(payload).eq("id", rulesId)
        : await supabase.from("negotiation_rules").insert(payload);
      if (error) throw error;
      toast({ title: "Regras de negociação salvas" });
      fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Erro ao salvar", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-agro-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-white">Regras de negociação de dívida</p>
        <p className="text-xs text-agro-muted mt-0.5">
          Limites que a IA nunca pode ultrapassar ao propor desconto ou parcelamento. Fora desses limites, a conversa é escalada para um atendente.
        </p>
      </div>

      <div
        className="flex items-start gap-3 p-3 rounded-xl cursor-pointer select-none transition-colors"
        style={{
          background: form.is_ai_negotiation_enabled ? "rgba(27,94,32,0.15)" : "rgba(239,68,68,0.08)",
          border: `1px solid ${form.is_ai_negotiation_enabled ? "#1B5E20" : "rgba(239,68,68,0.25)"}`,
        }}
        onClick={() => setForm((f) => ({ ...f, is_ai_negotiation_enabled: !f.is_ai_negotiation_enabled }))}
      >
        <div className="w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5 border transition-colors"
          style={{ background: form.is_ai_negotiation_enabled ? "#1B5E20" : "transparent", borderColor: form.is_ai_negotiation_enabled ? "#1B5E20" : "rgba(239,68,68,0.5)" }}>
          {form.is_ai_negotiation_enabled && <span className="text-white text-[10px] font-bold">✓</span>}
        </div>
        <div>
          <p className="text-xs font-semibold text-white flex items-center gap-1.5">
            {!form.is_ai_negotiation_enabled && <ShieldOff className="w-3.5 h-3.5 text-red-400" />}
            IA pode negociar automaticamente
          </p>
          <p className="text-[11px] text-agro-muted mt-0.5">
            Quando desativado, toda conversa sobre dívida é escalada direto para um atendente (kill-switch).
          </p>
        </div>
      </div>

      <div style={SECTION_STYLE}>
        <span className={SECTION_LABEL}>Limites financeiros</span>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={FIELD_LABEL}>Desconto máximo (%)</label>
            <input className="input-agro w-full text-sm" type="number" min={0} max={100} value={form.max_discount_pct}
              onChange={(e) => setForm((f) => ({ ...f, max_discount_pct: e.target.value }))} />
          </div>
          <div>
            <label className={FIELD_LABEL}>Parcelas máximas</label>
            <input className="input-agro w-full text-sm" type="number" min={1} value={form.max_installments}
              onChange={(e) => setForm((f) => ({ ...f, max_installments: e.target.value }))} />
          </div>
          <div>
            <label className={FIELD_LABEL}>Valor mínimo por parcela (R$)</label>
            <input className="input-agro w-full text-sm" type="number" min={0} value={form.min_installment_amount}
              onChange={(e) => setForm((f) => ({ ...f, min_installment_amount: e.target.value }))} />
          </div>
          <div>
            <label className={FIELD_LABEL}>Máx. rodadas de proposta</label>
            <input className="input-agro w-full text-sm" type="number" min={1} value={form.max_negotiation_rounds}
              onChange={(e) => setForm((f) => ({ ...f, max_negotiation_rounds: e.target.value }))} />
          </div>
        </div>
      </div>

      <div style={SECTION_STYLE}>
        <span className={SECTION_LABEL}>Escalada para humano</span>
        <div className="space-y-3">
          <div>
            <label className={FIELD_LABEL}>Palavras-chave que escalam na hora</label>
            <input className="input-agro w-full text-sm" value={form.auto_escalate_keywords}
              onChange={(e) => setForm((f) => ({ ...f, auto_escalate_keywords: e.target.value }))}
              placeholder="advogado, procon, fraude, processo" />
            <p className="text-[11px] text-agro-muted mt-1">Separadas por vírgula. Se o cliente mencionar uma delas, a IA para na hora.</p>
          </div>
          <div>
            <label className={FIELD_LABEL}>Setor de destino ao escalar</label>
            <select className="input-agro w-full text-sm" value={form.escalation_department_id}
              onChange={(e) => setForm((f) => ({ ...f, escalation_department_id: e.target.value }))}>
              <option value="">Nenhum (fica na fila geral)</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div style={SECTION_STYLE}>
        <span className={SECTION_LABEL}>Portal do cliente</span>
        <div>
          <label className={FIELD_LABEL}>Validade do link (horas)</label>
          <input className="input-agro w-full text-sm" type="number" min={1} value={form.portal_token_ttl_hours}
            onChange={(e) => setForm((f) => ({ ...f, portal_token_ttl_hours: e.target.value }))} />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-agro w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? "Salvando…" : "Salvar regras"}
      </button>
    </div>
  );
}
