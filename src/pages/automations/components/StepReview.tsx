import { Clock, Users, Zap, MessageSquare, AlertTriangle } from "lucide-react";
import type { AutomationWizardState } from "@/types/automations";
import type { ZApiConnection } from "@/hooks/useZApiConnections";
import type { MetaConnection } from "@/types/shooting";

interface Props {
  state:               AutomationWizardState;
  zApiConnections:     ZApiConnection[];
  metaConnections:     MetaConnection[];
  saving:              boolean;
  onSaveDraft:         () => void;
  onActivate:          () => void;
  editMode?:           boolean;
  editRecipientCount?: number;
}

function padHour(h: number) { return `${String(h).padStart(2, "0")}:00`; }

function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatBRL(v: number | null): string {
  if (v === null || isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function StepReview({ state, zApiConnections, metaConnections, saving, onSaveDraft, onActivate, editMode = false, editRecipientCount }: Props) {
  const isZApi = state.channel === "z_api";

  const connLabel = isZApi
    ? zApiConnections.find((c) => c.id === state.z_api_connection_id)?.name ?? "—"
    : metaConnections.find((c) => c.id === state.meta_connection_id)?.display_phone ?? "—";

  const sortedTriggers = [...state.triggers].sort((a, b) => a.day_offset - b.day_offset);
  const enabledTriggers = sortedTriggers.filter((t) => t.enabled);

  // Warn: recipients where ALL enabled trigger dates are already in the past
  const today = new Date().toISOString().slice(0, 10);
  const deadRecipients = state.selectedRecipients.filter((r) =>
    enabledTriggers.length > 0 &&
    enabledTriggers.every((t) => addDays(r.vencimento, t.day_offset) < today)
  );

  // Warn: recipients with vencimento already past (useful even if some triggers are "after")
  const overdueRecipients = state.selectedRecipients.filter((r) => r.vencimento < today);

  return (
    <div className="space-y-6">
      <p className="text-xs text-agro-muted">Revise as configurações antes de ativar a régua.</p>

      {/* Warning: recipients that will never fire */}
      {deadRecipients.length > 0 && (
        <div className="p-4 rounded-xl space-y-2"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)" }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-sm font-semibold text-red-400">
              {deadRecipients.length} boleto{deadRecipients.length !== 1 ? "s" : ""} não serão disparados
            </p>
          </div>
          <p className="text-xs text-red-300/70 leading-relaxed">
            As datas de todos os gatilhos ativos já passaram para {deadRecipients.length === 1 ? "este boleto" : "estes boletos"}.
            Eles permanecem na régua mas nenhuma mensagem será enviada.
          </p>
          <ul className="space-y-0.5 mt-1">
            {deadRecipients.slice(0, 5).map((r) => (
              <li key={r.invoice_id} className="text-xs text-red-300/60 font-mono">
                • {r.contact_name} — venc. {formatDate(r.vencimento)}
              </li>
            ))}
            {deadRecipients.length > 5 && (
              <li className="text-xs text-red-300/50">e mais {deadRecipients.length - 5}…</li>
            )}
          </ul>
        </div>
      )}

      {/* Warning: overdue but with "after" triggers that may still fire */}
      {overdueRecipients.length > 0 && deadRecipients.length === 0 && (
        <div className="p-4 rounded-xl flex items-start gap-3"
          style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-400">
              {overdueRecipients.length} boleto{overdueRecipients.length !== 1 ? "s" : ""} já vencido{overdueRecipients.length !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-amber-300/70 mt-0.5">
              Gatilhos "antes do vencimento" não dispararão para estes boletos. Apenas gatilhos "depois" ainda podem disparar.
            </p>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: Zap,          label: "Canal",      value: isZApi ? "Z-API" : "Meta API" },
          { icon: MessageSquare, label: "Conexão",    value: connLabel },
          { icon: Clock,        label: "Disparo",    value: padHour(state.send_hour) },
          { icon: Users,        label: "Destinatários", value: `${editMode ? (editRecipientCount ?? 0) : state.selectedRecipients.length} contatos` },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="p-3 rounded-xl"
            style={{ background: "rgba(13,26,17,0.7)", border: "1px solid rgba(63,176,108,0.12)" }}>
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-3.5 h-3.5 text-agro-green" />
              <p className="text-[10px] font-semibold text-agro-muted-2 uppercase tracking-wider">{label}</p>
            </div>
            <p className="text-sm font-semibold text-agro-text">{value}</p>
          </div>
        ))}
      </div>

      {/* Triggers */}
      <div>
        <p className="text-[11px] font-bold text-agro-muted-2 uppercase tracking-widest mb-3">
          Gatilhos ({sortedTriggers.filter((t) => t.enabled).length} ativos)
        </p>
        <div className="space-y-2">
          {sortedTriggers.map((t) => (
            <div key={t.key}
              className="flex items-center justify-between px-3 py-2.5 rounded-xl"
              style={{ background: "rgba(13,26,17,0.6)", border: `1px solid ${t.enabled ? "rgba(63,176,108,0.15)" : "rgba(63,176,108,0.05)"}`, opacity: t.enabled ? 1 : 0.5 }}>
              <span className="text-sm font-medium text-agro-text">{t.label}</span>
              <div className="flex items-center gap-2">
                {state.template_mode === "per_trigger" && (
                  <span className="text-[10px] px-2 py-0.5 rounded font-medium"
                    style={{ background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}>
                    {t.channel ?? state.channel === "z_api" ? "Z-API" : "Meta"}
                  </span>
                )}
                {!t.enabled && (
                  <span className="text-[10px] px-2 py-0.5 rounded font-medium"
                    style={{ background: "rgba(255,255,255,0.05)", color: "#6b8a75" }}>inativo</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recipients preview */}
      {state.selectedRecipients.length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-agro-muted-2 uppercase tracking-widest mb-3">
            Primeiros destinatários
          </p>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
                  <th className="px-3 py-2 text-left text-agro-muted-2 font-semibold uppercase tracking-wider">Nome</th>
                  <th className="px-3 py-2 text-left text-agro-muted-2 font-semibold uppercase tracking-wider">Vencimento</th>
                  <th className="px-3 py-2 text-right text-agro-muted-2 font-semibold uppercase tracking-wider">Valor</th>
                </tr>
              </thead>
              <tbody>
                {state.selectedRecipients.slice(0, 5).map((r, i) => (
                  <tr key={r.contact_id}
                    style={{ borderBottom: i < Math.min(state.selectedRecipients.length, 5) - 1 ? "1px solid rgba(63,176,108,0.06)" : "none" }}>
                    <td className="px-3 py-2 text-agro-text font-medium">{r.contact_name}</td>
                    <td className="px-3 py-2 text-agro-muted">{formatDate(r.vencimento)}</td>
                    <td className="px-3 py-2 text-right text-agro-text font-semibold">{formatBRL(r.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {state.selectedRecipients.length > 5 && (
              <div className="px-3 py-2 text-center text-[10px] text-agro-muted"
                style={{ borderTop: "1px solid rgba(63,176,108,0.06)" }}>
                e mais {state.selectedRecipients.length - 5} contatos...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onSaveDraft}
          disabled={saving}
          className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-agro-muted-2 hover:text-agro-text transition-colors disabled:opacity-50"
          style={{ border: "1px solid rgba(63,176,108,0.2)" }}
        >
          {saving ? "Salvando..." : editMode ? "Salvar alterações" : "Salvar rascunho"}
        </button>
        <button
          onClick={onActivate}
          disabled={saving}
          className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 btn-agro flex items-center justify-center gap-2"
        >
          <Zap className="w-4 h-4" />
          {saving ? "Ativando..." : "Ativar régua"}
        </button>
      </div>
    </div>
  );
}
