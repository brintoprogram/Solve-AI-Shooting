import { useCallback, useEffect, useRef, useState } from "react";
import {
  PhoneOff, AlertTriangle, CheckCircle2, Wifi, WifiOff, Loader2,
  Download, Trash2, RefreshCw, Phone,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const SUPABASE_URL  = (import.meta.env.VITE_SUPABASE_URL  as string) ?? "";
const SUPABASE_ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? "";

type ProblemType = "no_phone" | "invalid" | "landline" | "ok";
type WaStatus    = "unknown" | "valid" | "invalid" | "checking";

interface CleanupContact {
  id:         string;
  name:       string | null;
  phone:      string | null;
  wa_status:  WaStatus;
  problem:    ProblemType;
}

type FilterTab = "all" | "no_phone" | "invalid" | "landline" | "wa_invalid" | "ok";

function classifyPhone(phone: string | null): ProblemType {
  if (!phone) return "no_phone";
  const digits = phone.replace(/\D/g, "");
  const norm   = digits.startsWith("55") ? digits : "55" + digits;
  if (norm.length < 12) return "invalid";
  if (norm.length === 12) return "landline";
  if (norm.length === 13 && norm[4] !== "9") return "landline";
  return "ok";
}

const PROBLEM_LABEL: Record<ProblemType, string> = {
  no_phone:  "Sem telefone",
  invalid:   "Formato inválido",
  landline:  "Possível fixo",
  ok:        "Formato OK",
};

const PROBLEM_STYLE: Record<ProblemType, { bg: string; color: string; border: string }> = {
  no_phone:  { bg: "rgba(107,114,128,0.1)", color: "#9ca3af", border: "rgba(107,114,128,0.2)" },
  invalid:   { bg: "rgba(239,68,68,0.1)",   color: "#f87171", border: "rgba(239,68,68,0.2)"   },
  landline:  { bg: "rgba(245,158,11,0.1)",  color: "#fbbf24", border: "rgba(245,158,11,0.2)"  },
  ok:        { bg: "rgba(63,176,108,0.1)",  color: "#3fb06c", border: "rgba(63,176,108,0.2)"  },
};

const WA_STYLE: Record<WaStatus, { bg: string; color: string; border: string; label: string }> = {
  unknown:  { bg: "rgba(107,114,128,0.1)", color: "#9ca3af", border: "rgba(107,114,128,0.2)", label: "Não verificado" },
  valid:    { bg: "rgba(63,176,108,0.1)",  color: "#3fb06c", border: "rgba(63,176,108,0.2)", label: "✓ WhatsApp"     },
  invalid:  { bg: "rgba(239,68,68,0.1)",   color: "#f87171", border: "rgba(239,68,68,0.2)",  label: "✗ Fora do WA"   },
  checking: { bg: "rgba(59,130,246,0.1)",  color: "#60a5fa", border: "rgba(59,130,246,0.2)", label: "Verificando…"   },
};

interface Props { workspaceId: string }

export function BaseCleanup({ workspaceId }: Props) {
  const { toast }                       = useToast();
  const [contacts,   setContacts]       = useState<CleanupContact[]>([]);
  const [loading,    setLoading]        = useState(false);
  const [filter,     setFilter]         = useState<FilterTab>("all");
  const [selected,   setSelected]       = useState<Set<string>>(new Set());
  const [checking,   setChecking]       = useState(false);
  const [checkProg,  setCheckProg]      = useState({ done: 0, total: 0 });
  const [deleting,   setDeleting]       = useState(false);
  const pollRef                         = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await db
      .from("inbox_contacts")
      .select("id, name, phone, wa_status")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true });

    const rows: CleanupContact[] = (data ?? []).map((c: { id: string; name: string | null; phone: string | null; wa_status: WaStatus | null }) => ({
      id:        c.id,
      name:      c.name,
      phone:     c.phone,
      wa_status: (c.wa_status ?? "unknown") as WaStatus,
      problem:   classifyPhone(c.phone),
    }));
    setContacts(rows);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  // ── Stats ────────────────────────────────────────────────────────
  const stats = {
    total:     contacts.length,
    no_phone:  contacts.filter((c) => c.problem === "no_phone").length,
    invalid:   contacts.filter((c) => c.problem === "invalid").length,
    landline:  contacts.filter((c) => c.problem === "landline").length,
    wa_valid:  contacts.filter((c) => c.wa_status === "valid").length,
    wa_invalid:contacts.filter((c) => c.wa_status === "invalid").length,
  };

  const problemCount = stats.no_phone + stats.invalid + stats.landline + stats.wa_invalid;

  // ── Filtered list ────────────────────────────────────────────────
  const filtered = contacts.filter((c) => {
    if (filter === "no_phone")   return c.problem === "no_phone";
    if (filter === "invalid")    return c.problem === "invalid";
    if (filter === "landline")   return c.problem === "landline";
    if (filter === "wa_invalid") return c.wa_status === "invalid";
    if (filter === "ok")         return c.problem === "ok" && c.wa_status !== "invalid";
    return true;
  });

  // ── Select helpers ───────────────────────────────────────────────
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((c) => c.id)));
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  // ── WhatsApp check ───────────────────────────────────────────────
  async function startWaCheck() {
    const eligible = contacts.filter((c) => c.problem === "ok" || c.problem === "landline");
    if (!eligible.length) {
      toast({ title: "Nenhum número para verificar" }); return;
    }
    setChecking(true);
    setCheckProg({ done: 0, total: eligible.length });

    const ids = eligible.map((c) => c.id);
    await db.from("inbox_contacts")
      .update({ wa_status: "checking" })
      .in("id", ids);

    // fire edge function (batches handled inside)
    await fetch(`${SUPABASE_URL}/functions/v1/check-wa-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
      body: JSON.stringify({ workspace_id: workspaceId, contact_ids: ids }),
    }).catch(() => {/* edge fn errors surfaced via polling */});

    // poll DB until none remain 'checking'
    pollRef.current = setInterval(async () => {
      const { data } = await db
        .from("inbox_contacts")
        .select("id, wa_status")
        .eq("workspace_id", workspaceId)
        .in("id", ids);

      const rows: Array<{ wa_status: string }> = data ?? [];
      const done  = rows.filter((r) => r.wa_status !== "checking").length;
      setCheckProg({ done, total: eligible.length });

      if (done >= eligible.length) {
        clearInterval(pollRef.current!);
        setChecking(false);
        load();
        toast({ title: `Verificação concluída — ${done} números verificados` });
      }
    }, 2000);
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Bulk delete ──────────────────────────────────────────────────
  async function bulkDelete() {
    if (!selected.size) return;
    const ids = [...selected];
    setDeleting(true);
    const { error } = await db
      .from("inbox_contacts")
      .delete()
      .in("id", ids)
      .eq("workspace_id", workspaceId);
    setDeleting(false);
    if (error) { toast({ title: "Erro ao excluir", description: error.message }); return; }
    toast({ title: `${ids.length} contato${ids.length > 1 ? "s" : ""} excluído${ids.length > 1 ? "s" : ""}` });
    setSelected(new Set());
    load();
  }

  // ── Bulk export ──────────────────────────────────────────────────
  function bulkExport() {
    const rows = filtered
      .filter((c) => !selected.size || selected.has(c.id))
      .map((c) => ({
        "Nome":            c.name ?? "",
        "Telefone":        c.phone ?? "",
        "Problema":        PROBLEM_LABEL[c.problem],
        "Status WhatsApp": WA_STYLE[c.wa_status].label,
      }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Limpeza");
    XLSX.writeFile(wb, `limpeza_base_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ── UI ───────────────────────────────────────────────────────────
  const TABS: { id: FilterTab; label: string; count: number }[] = [
    { id: "all",       label: "Todos",          count: stats.total     },
    { id: "no_phone",  label: "Sem telefone",   count: stats.no_phone  },
    { id: "invalid",   label: "Inválido",       count: stats.invalid   },
    { id: "landline",  label: "Possível fixo",  count: stats.landline  },
    { id: "wa_invalid",label: "Fora do WA",     count: stats.wa_invalid},
    { id: "ok",        label: "OK",             count: contacts.filter((c) => c.problem === "ok").length },
  ];

  return (
    <div className="p-6 space-y-5">

      {/* ── Stats cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total",          value: stats.total,      icon: Phone,         color: "#3fb06c", bg: "rgba(63,176,108,0.08)",  border: "rgba(63,176,108,0.15)"  },
          { label: "Sem telefone",   value: stats.no_phone,   icon: PhoneOff,      color: "#9ca3af", bg: "rgba(107,114,128,0.08)", border: "rgba(107,114,128,0.15)" },
          { label: "Formato inválido",value:stats.invalid,    icon: AlertTriangle, color: "#f87171", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.15)"   },
          { label: "Possível fixo",  value: stats.landline,   icon: WifiOff,       color: "#fbbf24", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.15)"  },
          { label: "✓ No WhatsApp",  value: stats.wa_valid,   icon: CheckCircle2,  color: "#3fb06c", bg: "rgba(63,176,108,0.08)",  border: "rgba(63,176,108,0.15)"  },
        ].map(({ label, value, icon: Icon, color, bg, border }) => (
          <div key={label} className="rounded-xl p-4" style={{ background: bg, border: `1px solid ${border}` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <Icon className="w-3.5 h-3.5" style={{ color }} />
              <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "#6b7f6e" }}>{label}</p>
            </div>
            <p className="text-2xl font-bold" style={{ color }}>{value.toLocaleString("pt-BR")}</p>
          </div>
        ))}
      </div>

      {/* ── WA check action ─────────────────────────────────────── */}
      <div
        className="rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4"
        style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            <Wifi className="w-4 h-4 text-[#3fb06c]" />
            Verificar números no WhatsApp
          </p>
          <p className="text-xs text-[#6b7f6e] mt-0.5">
            Consulta a API da Meta para confirmar quais números realmente existem no WhatsApp. Requer número conectado nas configurações.
          </p>
          {checking && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[10px] text-[#6b7f6e] mb-1">
                <span>Verificando…</span>
                <span>{checkProg.done}/{checkProg.total}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(63,176,108,0.1)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${checkProg.total ? (checkProg.done / checkProg.total) * 100 : 0}%`,
                    background: "linear-gradient(90deg, #3fb06c, #16A34A)",
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <button
          onClick={startWaCheck}
          disabled={checking || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50 shrink-0"
          style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
        >
          {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
          {checking ? "Verificando…" : `Verificar ${contacts.filter((c) => c.problem === "ok" || c.problem === "landline").length} números`}
        </button>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* filter tabs */}
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setFilter(t.id); setSelected(new Set()); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5"
              style={filter === t.id
                ? { background: "rgba(63,176,108,0.18)", color: "#3fb06c" }
                : { color: "#6b7f6e" }
              }
            >
              {t.label}
              <span
                className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={filter === t.id
                  ? { background: "rgba(63,176,108,0.25)", color: "#3fb06c" }
                  : { background: "rgba(107,114,128,0.15)", color: "#6b7f6e" }
                }
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* bulk actions */}
        {selected.size > 0 && (
          <span className="text-xs text-[#6b7f6e]">{selected.size} selecionado{selected.size > 1 ? "s" : ""}</span>
        )}
        <button
          onClick={bulkExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#6b7f6e] hover:text-white transition-colors"
          style={{ border: "1px solid rgba(63,176,108,0.15)" }}
        >
          <Download className="w-3.5 h-3.5" />
          {selected.size ? `Exportar ${selected.size}` : "Exportar filtro"}
        </button>
        {selected.size > 0 && (
          <button
            onClick={bulkDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
            style={{ border: "1px solid rgba(239,68,68,0.25)" }}
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Excluir selecionados
          </button>
        )}
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#6b7f6e] hover:text-white transition-colors disabled:opacity-50"
          style={{ border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  className="accent-[#3fb06c] w-3.5 h-3.5"
                />
              </th>
              {["Nome", "Telefone", "Problema", "WhatsApp"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.05)" }}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 rounded" style={{ background: "rgba(63,176,108,0.06)", width: j === 0 ? 16 : "60%" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-[#6b7f6e] text-sm">
                  Nenhum contato nesta categoria
                </td>
              </tr>
            ) : (
              filtered.map((c, i) => {
                const ps = PROBLEM_STYLE[c.problem];
                const ws = WA_STYLE[c.wa_status];
                return (
                  <tr
                    key={c.id}
                    className="transition-colors hover:bg-white/[0.02]"
                    style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(63,176,108,0.05)" : "none" }}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        className="accent-[#3fb06c] w-3.5 h-3.5"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-white">
                      {c.name ?? <span className="text-[#6b7f6e] italic">Sem nome</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#8faf9a]">
                      {c.phone ?? <span className="text-[#6b7f6e]">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: ps.bg, color: ps.color, border: `1px solid ${ps.border}` }}
                      >
                        {PROBLEM_LABEL[c.problem]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: ws.bg, color: ws.color, border: `1px solid ${ws.border}` }}
                      >
                        {ws.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {problemCount > 0 && (
        <p className="text-xs text-center text-[#6b7f6e]">
          {problemCount} contato{problemCount > 1 ? "s" : ""} com problema detectado
          {stats.wa_invalid > 0 ? ` · ${stats.wa_invalid} fora do WhatsApp` : ""}
        </p>
      )}
    </div>
  );
}
