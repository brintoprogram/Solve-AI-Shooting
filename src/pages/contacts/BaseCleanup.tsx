import { useCallback, useEffect, useRef, useState } from "react";
import {
  PhoneOff, AlertTriangle, CheckCircle2, Wifi, WifiOff, Loader2,
  Download, Trash2, RefreshCw, Phone, Upload, FileSpreadsheet, Clock,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const SUPABASE_URL  = (import.meta.env.VITE_SUPABASE_URL  as string) ?? "";
const SUPABASE_ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? "";

// ── Types ───────────────────────────────────────────────────────────

type ProblemType = "no_phone" | "invalid" | "landline" | "ok";
type WaStatus    = "unknown" | "valid" | "invalid" | "checking";
type InnerTab    = "base" | "planilha";

interface CleanupContact {
  id: string; name: string | null; phone: string | null;
  wa_status: WaStatus; problem: ProblemType;
}

interface SheetRow {
  rowIndex:    number;
  rowData:     Record<string, unknown>;
  name:        string;
  phone:       string;
  phoneNorm:   string;
  problem:     ProblemType;
  waStatus:    WaStatus;
}

interface CleanupSession {
  id: string; filename: string; total: number; valid: number;
  invalid_phone: number; no_phone: number; landline: number;
  wa_valid: number; wa_invalid: number; created_at: string;
}

type FilterTab = "all" | "no_phone" | "invalid" | "landline" | "wa_invalid" | "ok";

// ── Helpers ─────────────────────────────────────────────────────────

const PHONE_KEYWORDS = ["telefone","fone","celular","cel","whatsapp","zap","tel","mobile","phone","numero","número"];
const NAME_KEYWORDS  = ["nome","name","devedor","cliente","razão","sacado","favorecido","beneficiario"];

function normalizeKey(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

function detectPhoneCol(headers: string[]): string | null {
  for (const h of headers) {
    const k = normalizeKey(h);
    if (PHONE_KEYWORDS.some((kw) => k.includes(kw))) return h;
  }
  return null;
}

function detectNameCol(headers: string[]): string | null {
  for (const h of headers) {
    const k = normalizeKey(h);
    if (NAME_KEYWORDS.some((kw) => k.includes(kw))) return h;
  }
  return null;
}

function normalizePhone(raw: unknown): string {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return "55" + digits;
}

function classifyPhone(phone: string | null): ProblemType {
  if (!phone) return "no_phone";
  const norm = normalizePhone(phone);
  if (norm.length < 12) return "invalid";
  if (norm.length === 12) return "landline";
  if (norm.length === 13 && norm[4] !== "9") return "landline";
  return "ok";
}

// ── Style maps ──────────────────────────────────────────────────────

const PROBLEM_LABEL: Record<ProblemType, string> = {
  no_phone: "Sem telefone", invalid: "Formato inválido",
  landline: "Possível fixo", ok: "Formato OK",
};

const PROBLEM_STYLE: Record<ProblemType, { bg: string; color: string; border: string }> = {
  no_phone: { bg: "rgba(107,114,128,0.1)", color: "#9ca3af", border: "rgba(107,114,128,0.2)" },
  invalid:  { bg: "rgba(239,68,68,0.1)",   color: "#f87171", border: "rgba(239,68,68,0.2)"   },
  landline: { bg: "rgba(245,158,11,0.1)",  color: "#fbbf24", border: "rgba(245,158,11,0.2)"  },
  ok:       { bg: "rgba(63,176,108,0.1)",  color: "#3fb06c", border: "rgba(63,176,108,0.2)"  },
};

const WA_STYLE: Record<WaStatus, { bg: string; color: string; border: string; label: string }> = {
  unknown:  { bg: "rgba(107,114,128,0.1)", color: "#9ca3af", border: "rgba(107,114,128,0.2)", label: "Não verificado" },
  valid:    { bg: "rgba(63,176,108,0.1)",  color: "#3fb06c", border: "rgba(63,176,108,0.2)", label: "✓ WhatsApp"     },
  invalid:  { bg: "rgba(239,68,68,0.1)",   color: "#f87171", border: "rgba(239,68,68,0.2)",  label: "✗ Fora do WA"   },
  checking: { bg: "rgba(59,130,246,0.1)",  color: "#60a5fa", border: "rgba(59,130,246,0.2)", label: "Verificando…"   },
};

// ── Stat card ───────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color, bg, border }: {
  label: string; value: number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string; bg: string; border: string;
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <p className="text-[10px] uppercase tracking-widest font-semibold text-[#6b7f6e]">{label}</p>
      </div>
      <p className="text-2xl font-bold" style={{ color }}>{value.toLocaleString("pt-BR")}</p>
    </div>
  );
}

// ── Props ────────────────────────────────────────────────────────────

interface Props { workspaceId: string }

// ════════════════════════════════════════════════════════════════════
// BASE CADASTRADA TAB
// ════════════════════════════════════════════════════════════════════

function BaseCadastrada({ workspaceId }: Props) {
  const { toast }                  = useToast();
  const [contacts,  setContacts]   = useState<CleanupContact[]>([]);
  const [loading,   setLoading]    = useState(false);
  const [filter,    setFilter]     = useState<FilterTab>("all");
  const [selected,  setSelected]   = useState<Set<string>>(new Set());
  const [checking,  setChecking]   = useState(false);
  const [checkProg, setCheckProg]  = useState({ done: 0, total: 0 });
  const [deleting,  setDeleting]   = useState(false);
  const pollRef                    = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await db
      .from("inbox_contacts")
      .select("id, name, phone, wa_status")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true });
    setContacts((data ?? []).map((c: { id: string; name: string | null; phone: string | null; wa_status: string | null }) => ({
      id: c.id, name: c.name, phone: c.phone,
      wa_status: (c.wa_status ?? "unknown") as WaStatus,
      problem:   classifyPhone(c.phone),
    })));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const stats = {
    total:      contacts.length,
    no_phone:   contacts.filter((c) => c.problem === "no_phone").length,
    invalid:    contacts.filter((c) => c.problem === "invalid").length,
    landline:   contacts.filter((c) => c.problem === "landline").length,
    wa_valid:   contacts.filter((c) => c.wa_status === "valid").length,
    wa_invalid: contacts.filter((c) => c.wa_status === "invalid").length,
  };

  const filtered = contacts.filter((c) => {
    if (filter === "no_phone")   return c.problem === "no_phone";
    if (filter === "invalid")    return c.problem === "invalid";
    if (filter === "landline")   return c.problem === "landline";
    if (filter === "wa_invalid") return c.wa_status === "invalid";
    if (filter === "ok")         return c.problem === "ok" && c.wa_status !== "invalid";
    return true;
  });

  function toggleAll() {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.id)));
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  async function startWaCheck() {
    const eligible = contacts.filter((c) => c.problem === "ok" || c.problem === "landline");
    if (!eligible.length) { toast({ title: "Nenhum número para verificar" }); return; }
    setChecking(true);
    setCheckProg({ done: 0, total: eligible.length });
    const ids = eligible.map((c) => c.id);
    await db.from("inbox_contacts").update({ wa_status: "checking" }).in("id", ids);
    await fetch(`${SUPABASE_URL}/functions/v1/check-wa-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
      body: JSON.stringify({ workspace_id: workspaceId, contact_ids: ids }),
    }).catch(() => {});
    pollRef.current = setInterval(async () => {
      const { data } = await db.from("inbox_contacts").select("id, wa_status").in("id", ids);
      const done = (data ?? []).filter((r: { wa_status: string }) => r.wa_status !== "checking").length;
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

  async function bulkDelete() {
    const ids = [...selected];
    setDeleting(true);
    const { error } = await db.from("inbox_contacts").delete().in("id", ids).eq("workspace_id", workspaceId);
    setDeleting(false);
    if (error) { toast({ title: "Erro ao excluir", description: error.message }); return; }
    toast({ title: `${ids.length} contato${ids.length > 1 ? "s" : ""} excluído${ids.length > 1 ? "s" : ""}` });
    setSelected(new Set());
    load();
  }

  function bulkExport() {
    const rows = filtered
      .filter((c) => !selected.size || selected.has(c.id))
      .map((c) => ({
        "Nome": c.name ?? "", "Telefone": c.phone ?? "",
        "Problema": PROBLEM_LABEL[c.problem], "Status WhatsApp": WA_STYLE[c.wa_status].label,
      }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Limpeza");
    XLSX.writeFile(wb, `limpeza_base_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const TABS: { id: FilterTab; label: string; count: number }[] = [
    { id: "all",        label: "Todos",          count: stats.total      },
    { id: "no_phone",   label: "Sem telefone",   count: stats.no_phone   },
    { id: "invalid",    label: "Inválido",       count: stats.invalid    },
    { id: "landline",   label: "Possível fixo",  count: stats.landline   },
    { id: "wa_invalid", label: "Fora do WA",     count: stats.wa_invalid },
    { id: "ok",         label: "OK",             count: contacts.filter((c) => c.problem === "ok").length },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total"           value={stats.total}      icon={Phone}         color="#3fb06c" bg="rgba(63,176,108,0.08)"  border="rgba(63,176,108,0.15)"  />
        <StatCard label="Sem telefone"    value={stats.no_phone}   icon={PhoneOff}      color="#9ca3af" bg="rgba(107,114,128,0.08)" border="rgba(107,114,128,0.15)" />
        <StatCard label="Formato inválido"value={stats.invalid}    icon={AlertTriangle} color="#f87171" bg="rgba(239,68,68,0.08)"   border="rgba(239,68,68,0.15)"   />
        <StatCard label="Possível fixo"   value={stats.landline}   icon={WifiOff}       color="#fbbf24" bg="rgba(245,158,11,0.08)"  border="rgba(245,158,11,0.15)"  />
        <StatCard label="✓ No WhatsApp"   value={stats.wa_valid}   icon={CheckCircle2}  color="#3fb06c" bg="rgba(63,176,108,0.08)"  border="rgba(63,176,108,0.15)"  />
      </div>

      {/* WA check */}
      <div className="rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4"
        style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            <Wifi className="w-4 h-4 text-[#3fb06c]" /> Verificar números no WhatsApp
          </p>
          <p className="text-xs text-[#6b7f6e] mt-0.5">
            Consulta a API da Meta para confirmar quais números existem no WhatsApp.
          </p>
          {checking && (
            <div className="mt-2">
              <div className="flex justify-between text-[10px] text-[#6b7f6e] mb-1">
                <span>Verificando…</span><span>{checkProg.done}/{checkProg.total}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(63,176,108,0.1)" }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${checkProg.total ? (checkProg.done / checkProg.total) * 100 : 0}%`, background: "linear-gradient(90deg, #3fb06c, #16A34A)" }} />
              </div>
            </div>
          )}
        </div>
        <button onClick={startWaCheck} disabled={checking || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 shrink-0"
          style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
        >
          {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
          {checking ? "Verificando…" : `Verificar ${contacts.filter((c) => c.problem === "ok" || c.problem === "landline").length} números`}
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => { setFilter(t.id); setSelected(new Set()); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5"
              style={filter === t.id ? { background: "rgba(63,176,108,0.18)", color: "#3fb06c" } : { color: "#6b7f6e" }}
            >
              {t.label}
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={filter === t.id ? { background: "rgba(63,176,108,0.25)", color: "#3fb06c" } : { background: "rgba(107,114,128,0.15)", color: "#6b7f6e" }}
              >{t.count}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {selected.size > 0 && <span className="text-xs text-[#6b7f6e]">{selected.size} selecionado{selected.size > 1 ? "s" : ""}</span>}
        <button onClick={bulkExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#6b7f6e] hover:text-white transition-colors" style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
          <Download className="w-3.5 h-3.5" /> {selected.size ? `Exportar ${selected.size}` : "Exportar filtro"}
        </button>
        {selected.size > 0 && (
          <button onClick={bulkDelete} disabled={deleting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors" style={{ border: "1px solid rgba(239,68,68,0.25)" }}>
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Excluir selecionados
          </button>
        )}
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#6b7f6e] hover:text-white disabled:opacity-50 transition-colors" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
              <th className="px-4 py-3 w-10">
                <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={toggleAll} className="accent-[#3fb06c] w-3.5 h-3.5" />
              </th>
              {["Nome","Telefone","Problema","WhatsApp"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.05)" }}>
                {Array.from({ length: 5 }).map((_, j) => (
                  <td key={j} className="px-4 py-3"><div className="h-4 rounded" style={{ background: "rgba(63,176,108,0.06)", width: j === 0 ? 16 : "60%" }} /></td>
                ))}
              </tr>
            )) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-[#6b7f6e] text-sm">Nenhum contato nesta categoria</td></tr>
            ) : filtered.map((c, i) => {
              const ps = PROBLEM_STYLE[c.problem];
              const ws = WA_STYLE[c.wa_status];
              return (
                <tr key={c.id} className="transition-colors hover:bg-white/[0.02]"
                  style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(63,176,108,0.05)" : "none" }}
                >
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} className="accent-[#3fb06c] w-3.5 h-3.5" />
                  </td>
                  <td className="px-4 py-3 font-medium text-white">{c.name ?? <span className="text-[#6b7f6e] italic">Sem nome</span>}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#8faf9a]">{c.phone ?? <span className="text-[#6b7f6e]">—</span>}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: ps.bg, color: ps.color, border: `1px solid ${ps.border}` }}>{PROBLEM_LABEL[c.problem]}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: ws.bg, color: ws.color, border: `1px solid ${ws.border}` }}>{ws.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PLANILHA AVULSA TAB
// ════════════════════════════════════════════════════════════════════

function PlanilhaAvulsa({ workspaceId }: Props) {
  const { toast }                       = useToast();
  const fileRef                         = useRef<HTMLInputElement>(null);
  const [rows,       setRows]           = useState<SheetRow[]>([]);
  const [filename,   setFilename]       = useState("");
  const [parsing,    setParsing]        = useState(false);
  const [checking,   setChecking]       = useState(false);
  const [checkProg,  setCheckProg]      = useState({ done: 0, total: 0 });
  const [saving,     setSaving]         = useState(false);
  const [sessions,   setSessions]       = useState<CleanupSession[]>([]);
  const [sessLoading,setSessLoading]    = useState(false);
  const [filter,     setFilter]         = useState<FilterTab>("all");

  const loadSessions = useCallback(async () => {
    setSessLoading(true);
    const { data } = await db.from("cleanup_sessions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(20);
    setSessions(data ?? []);
    setSessLoading(false);
  }, [workspaceId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Parse uploaded file ──────────────────────────────────────────
  async function handleFile(file: File) {
    setParsing(true);
    setRows([]);
    setFilename(file.name);
    setFilter("all");

    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: "array" });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const raw  = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

    if (!raw.length) { toast({ title: "Planilha vazia" }); setParsing(false); return; }

    const headers   = Object.keys(raw[0]);
    const phoneCol  = detectPhoneCol(headers);
    const nameCol   = detectNameCol(headers);

    const parsed: SheetRow[] = raw.map((row, i) => {
      const rawPhone = phoneCol ? row[phoneCol] : null;
      const name     = nameCol  ? String(row[nameCol] ?? "") : "";
      const phone    = rawPhone ? String(rawPhone).trim() : "";
      const norm     = phone ? normalizePhone(phone) : "";
      const problem  = classifyPhone(phone || null);
      return { rowIndex: i, rowData: row, name, phone, phoneNorm: norm, problem, waStatus: "unknown" as WaStatus };
    });

    setRows(parsed);
    setParsing(false);
    toast({ title: `${parsed.length} linhas carregadas`, description: phoneCol ? `Coluna de telefone: "${phoneCol}"` : "Coluna de telefone não detectada — verifique o cabeçalho" });
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  // ── WA check ────────────────────────────────────────────────────
  async function checkWA() {
    const eligible = rows.filter((r) => r.problem === "ok" || r.problem === "landline");
    if (!eligible.length) { toast({ title: "Nenhum número válido para verificar" }); return; }

    setChecking(true);
    setCheckProg({ done: 0, total: eligible.length });

    const updated = [...rows];
    eligible.forEach((r) => { updated[r.rowIndex] = { ...r, waStatus: "checking" }; });
    setRows(updated);

    const BATCH = 50;
    let done = 0;
    for (let i = 0; i < eligible.length; i += BATCH) {
      const batch  = eligible.slice(i, i + BATCH);
      const phones = batch.map((r) => r.phoneNorm);

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/check-wa-contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
          body: JSON.stringify({ workspace_id: workspaceId, mode: "return", phones }),
        });
        const data = await res.json() as { results?: Array<{ phone: string; status: string }> };
        const resultMap = new Map((data.results ?? []).map((r) => [r.phone.replace(/\D/g, ""), r.status]));
        batch.forEach((r) => {
          const status = resultMap.get(r.phoneNorm) ?? "unknown";
          updated[r.rowIndex] = { ...updated[r.rowIndex], waStatus: status as WaStatus };
        });
      } catch {
        batch.forEach((r) => { updated[r.rowIndex] = { ...updated[r.rowIndex], waStatus: "unknown" }; });
      }

      done += batch.length;
      setCheckProg({ done, total: eligible.length });
      setRows([...updated]);
    }

    setChecking(false);
    toast({ title: "Verificação concluída" });
  }

  // ── Save session ─────────────────────────────────────────────────
  async function saveSession() {
    if (!rows.length) return;
    setSaving(true);

    const stats = {
      total:         rows.length,
      valid:         rows.filter((r) => r.problem === "ok").length,
      invalid_phone: rows.filter((r) => r.problem === "invalid").length,
      no_phone:      rows.filter((r) => r.problem === "no_phone").length,
      landline:      rows.filter((r) => r.problem === "landline").length,
      wa_valid:      rows.filter((r) => r.waStatus === "valid").length,
      wa_invalid:    rows.filter((r) => r.waStatus === "invalid").length,
    };

    const { data: sess, error: sessErr } = await db.from("cleanup_sessions")
      .insert({ workspace_id: workspaceId, filename, ...stats })
      .select("id").single();

    if (sessErr || !sess) {
      toast({ title: "Erro ao salvar sessão", description: sessErr?.message });
      setSaving(false); return;
    }

    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => ({
        session_id:    sess.id,
        row_index:     r.rowIndex,
        row_data:      r.rowData,
        name:          r.name || null,
        phone:         r.phone || null,
        phone_norm:    r.phoneNorm || null,
        phone_problem: r.problem,
        wa_status:     r.waStatus,
      }));
      await db.from("cleanup_session_rows").insert(chunk);
    }

    setSaving(false);
    toast({ title: "Sessão salva com sucesso!" });
    loadSessions();
    setRows([]);
    setFilename("");
  }

  // ── Download session ─────────────────────────────────────────────
  async function downloadSession(session: CleanupSession) {
    const { data } = await db.from("cleanup_session_rows")
      .select("*")
      .eq("session_id", session.id)
      .order("row_index");

    const sessionRows: Array<Record<string, unknown>> = data ?? [];
    if (!sessionRows.length) { toast({ title: "Sessão sem dados" }); return; }

    const exportRows = sessionRows.map((r) => ({
      ...(r.row_data as Record<string, unknown>),
      "__Telefone Normalizado": r.phone_norm ?? "",
      "__Problema":             PROBLEM_LABEL[r.phone_problem as ProblemType] ?? r.phone_problem,
      "__Status WhatsApp":      WA_STYLE[(r.wa_status as WaStatus) ?? "unknown"].label,
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Higienizado");
    XLSX.writeFile(wb, `higienizado_${session.filename}`);
  }

  // ── Filtered rows ────────────────────────────────────────────────
  const filtered = rows.filter((r) => {
    if (filter === "no_phone")   return r.problem === "no_phone";
    if (filter === "invalid")    return r.problem === "invalid";
    if (filter === "landline")   return r.problem === "landline";
    if (filter === "wa_invalid") return r.waStatus === "invalid";
    if (filter === "ok")         return r.problem === "ok" && r.waStatus !== "invalid";
    return true;
  });

  const rowStats = {
    total:      rows.length,
    no_phone:   rows.filter((r) => r.problem === "no_phone").length,
    invalid:    rows.filter((r) => r.problem === "invalid").length,
    landline:   rows.filter((r) => r.problem === "landline").length,
    wa_invalid: rows.filter((r) => r.waStatus === "invalid").length,
  };

  const TABS: { id: FilterTab; label: string; count: number }[] = [
    { id: "all",        label: "Todos",          count: rowStats.total      },
    { id: "no_phone",   label: "Sem telefone",   count: rowStats.no_phone   },
    { id: "invalid",    label: "Inválido",       count: rowStats.invalid    },
    { id: "landline",   label: "Possível fixo",  count: rowStats.landline   },
    { id: "wa_invalid", label: "Fora do WA",     count: rowStats.wa_invalid },
    { id: "ok",         label: "OK",             count: rows.filter((r) => r.problem === "ok").length },
  ];

  return (
    <div className="space-y-5">

      {/* ── Upload area ───────────────────────────────────────────── */}
      <div
        className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-10 gap-3 cursor-pointer transition-colors hover:border-[#3fb06c]/40"
        style={{ borderColor: "rgba(63,176,108,0.2)", background: "rgba(13,26,17,0.5)" }}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
        {parsing ? (
          <><Loader2 className="w-8 h-8 text-[#3fb06c] animate-spin" /><p className="text-sm text-[#6b7f6e]">Processando planilha…</p></>
        ) : (
          <>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(63,176,108,0.1)" }}>
              <FileSpreadsheet className="w-6 h-6 text-[#3fb06c]" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white">Arraste uma planilha ou clique para selecionar</p>
              <p className="text-xs text-[#6b7f6e] mt-1">Suporta .xlsx, .xls, .csv — detecta automaticamente a coluna de telefone</p>
            </div>
          </>
        )}
      </div>

      {/* ── Results ───────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Total"            value={rowStats.total}    icon={Phone}         color="#3fb06c" bg="rgba(63,176,108,0.08)"  border="rgba(63,176,108,0.15)"  />
            <StatCard label="Sem telefone"     value={rowStats.no_phone} icon={PhoneOff}      color="#9ca3af" bg="rgba(107,114,128,0.08)" border="rgba(107,114,128,0.15)" />
            <StatCard label="Formato inválido" value={rowStats.invalid}  icon={AlertTriangle} color="#f87171" bg="rgba(239,68,68,0.08)"   border="rgba(239,68,68,0.15)"   />
            <StatCard label="Possível fixo"    value={rowStats.landline} icon={WifiOff}       color="#fbbf24" bg="rgba(245,158,11,0.08)"  border="rgba(245,158,11,0.15)"  />
            <StatCard label="✓ No WhatsApp"    value={rows.filter((r) => r.waStatus === "valid").length} icon={CheckCircle2} color="#3fb06c" bg="rgba(63,176,108,0.08)" border="rgba(63,176,108,0.15)" />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={checkWA} disabled={checking || saving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
            >
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              {checking ? `Verificando… ${checkProg.done}/${checkProg.total}` : "Verificar no WhatsApp"}
            </button>
            <button onClick={saveSession} disabled={saving || checking}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              style={{ border: "1px solid rgba(63,176,108,0.3)", color: "#3fb06c" }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {saving ? "Salvando…" : "Salvar no histórico"}
            </button>
            <button onClick={() => { setRows([]); setFilename(""); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-[#6b7f6e] hover:text-white transition-colors"
              style={{ border: "1px solid rgba(107,114,128,0.2)" }}
            >
              Limpar
            </button>

            {checking && (
              <div className="flex-1 min-w-32">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(63,176,108,0.1)" }}>
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${checkProg.total ? (checkProg.done / checkProg.total) * 100 : 0}%`, background: "linear-gradient(90deg, #3fb06c, #16A34A)" }} />
                </div>
              </div>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: "rgba(13,26,17,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setFilter(t.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5"
                style={filter === t.id ? { background: "rgba(63,176,108,0.18)", color: "#3fb06c" } : { color: "#6b7f6e" }}
              >
                {t.label}
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                  style={filter === t.id ? { background: "rgba(63,176,108,0.25)", color: "#3fb06c" } : { background: "rgba(107,114,128,0.15)", color: "#6b7f6e" }}
                >{t.count}</span>
              </button>
            ))}
          </div>

          {/* Preview table */}
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
                  {["#","Nome","Telefone","Normalizado","Problema","WhatsApp"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6b7f6e]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((r, i) => {
                  const ps = PROBLEM_STYLE[r.problem];
                  const ws = WA_STYLE[r.waStatus];
                  return (
                    <tr key={r.rowIndex} className="hover:bg-white/[0.02] transition-colors"
                      style={{ borderBottom: i < filtered.slice(0, 200).length - 1 ? "1px solid rgba(63,176,108,0.05)" : "none" }}
                    >
                      <td className="px-4 py-2 text-xs text-[#6b7f6e]">{r.rowIndex + 1}</td>
                      <td className="px-4 py-2 text-sm text-white">{r.name || <span className="text-[#6b7f6e] italic">—</span>}</td>
                      <td className="px-4 py-2 font-mono text-xs text-[#8faf9a]">{r.phone || <span className="text-[#6b7f6e]">—</span>}</td>
                      <td className="px-4 py-2 font-mono text-xs text-[#6b7f6e]">{r.phoneNorm || "—"}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: ps.bg, color: ps.color, border: `1px solid ${ps.border}` }}>{PROBLEM_LABEL[r.problem]}</span>
                      </td>
                      <td className="px-4 py-2">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: ws.bg, color: ws.color, border: `1px solid ${ws.border}` }}>{ws.label}</span>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length > 200 && (
                  <tr><td colSpan={6} className="px-4 py-3 text-center text-xs text-[#6b7f6e]">… e mais {filtered.length - 200} linhas. Salve para ver tudo ou exporte.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── History ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#3fb06c]" /> Histórico de higienizações
          </p>
          <button onClick={loadSessions} disabled={sessLoading} className="text-xs text-[#6b7f6e] hover:text-white transition-colors flex items-center gap-1">
            <RefreshCw className={`w-3 h-3 ${sessLoading ? "animate-spin" : ""}`} /> Atualizar
          </button>
        </div>

        {sessLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-[#3fb06c] animate-spin" /></div>
        ) : sessions.length === 0 ? (
          <div className="rounded-xl py-10 text-center" style={{ border: "1px solid rgba(63,176,108,0.08)" }}>
            <p className="text-sm text-[#6b7f6e]">Nenhuma sessão salva ainda</p>
            <p className="text-xs text-[#4a6b50] mt-1">Upload uma planilha e clique em "Salvar no histórico"</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="rounded-xl px-4 py-3 flex items-center gap-4"
                style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.08)" }}
              >
                <FileSpreadsheet className="w-5 h-5 text-[#3fb06c] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{s.filename}</p>
                  <div className="flex flex-wrap gap-3 mt-0.5 text-[11px] text-[#6b7f6e]">
                    <span>{s.total} linhas</span>
                    {s.no_phone > 0 && <span className="text-[#9ca3af]">{s.no_phone} sem tel</span>}
                    {s.invalid_phone > 0 && <span className="text-[#f87171]">{s.invalid_phone} inválido</span>}
                    {s.landline > 0 && <span className="text-[#fbbf24]">{s.landline} fixo</span>}
                    {s.wa_valid > 0 && <span className="text-[#3fb06c]">{s.wa_valid} ✓ WA</span>}
                    {s.wa_invalid > 0 && <span className="text-[#f87171]">{s.wa_invalid} ✗ WA</span>}
                    <span>· {new Date(s.created_at).toLocaleString("pt-BR")}</span>
                  </div>
                </div>
                <button onClick={() => downloadSession(s)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#3fb06c] hover:bg-[#1e2e22] transition-colors shrink-0"
                  style={{ border: "1px solid rgba(63,176,108,0.2)" }}
                >
                  <Download className="w-3.5 h-3.5" /> Baixar Excel
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════

export function BaseCleanup({ workspaceId }: Props) {
  const [inner, setInner] = useState<InnerTab>("base");

  return (
    <div className="p-6">
      {/* Inner tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit mb-6" style={{ background: "rgba(8,14,10,0.8)", border: "1px solid rgba(63,176,108,0.1)" }}>
        {([
          { id: "base"     as InnerTab, label: "Base cadastrada"  },
          { id: "planilha" as InnerTab, label: "Planilha avulsa"  },
        ] as { id: InnerTab; label: string }[]).map(({ id, label }) => (
          <button key={id} onClick={() => setInner(id)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={inner === id
              ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }
              : { color: "#6b7f6e", border: "1px solid transparent" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {inner === "base"     && <BaseCadastrada  workspaceId={workspaceId} />}
      {inner === "planilha" && <PlanilhaAvulsa  workspaceId={workspaceId} />}
    </div>
  );
}
