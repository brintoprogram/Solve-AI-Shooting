import { useState, useRef, useCallback, useId } from "react";
import {
  X, Plus, Trash2, Type, Image, Video, FileText, 
  Link2, Phone, MessageSquare, AlertCircle, Loader2,
  Info, ChevronDown, CornerDownLeft,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getConfig } from "@/lib/config";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { MetaConnection } from "@/types/shooting";

// ── Types ────────────────────────────────────────────────────────

type HeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
type BtnType    = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";

interface ButtonItem {
  id: string;
  type: BtnType;
  text: string;
  url: string;
  urlExample: string;
  phone: string;
}

interface Form {
  name: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  headerType: HeaderType;
  headerText: string;
  headerExamples: string[];
  bodyText: string;
  bodyExamples: string[];
  footerText: string;
  buttons: ButtonItem[];
}

const INIT: Form = {
  name: "", category: "MARKETING", language: "pt_BR",
  headerType: "NONE", headerText: "", headerExamples: [],
  bodyText: "", bodyExamples: [],
  footerText: "", buttons: [],
};

// ── Meta limits ───────────────────────────────────────────────────

const LIMITS = {
  name:       512,
  headerText: 60,
  bodyText:   1024,
  footerText: 60,
  btnText:    25,
  btnUrl:     2000,
};

const MAX_QUICK   = 3;
const MAX_URL     = 2;
const MAX_PHONE   = 1;

// ── Helpers ──────────────────────────────────────────────────────

function extractVarNums(text: string): number[] {
  const matches = text.match(/\{\{(\d+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => parseInt(m.replace(/\{|\}/g, ""))))].sort((a, b) => a - b);
}

function nextVarNum(text: string): number {
  const vars = extractVarNums(text);
  return vars.length > 0 ? Math.max(...vars) + 1 : 1;
}

function seqError(text: string): string | null {
  const vars = extractVarNums(text);
  for (let i = 0; i < vars.length; i++) {
    if (vars[i] !== i + 1) return `Variáveis devem ser sequenciais. Faltando {{${i + 1}}}`;
  }
  return null;
}

function normalName(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function edgeFnUrl(fn: string): string {
  const e = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (e && e !== "https://placeholder.supabase.co") return `${e}/functions/v1/${fn}`;
  return `${getConfig()?.supabaseUrl ?? ""}/functions/v1/${fn}`;
}
function edgeFnKey(): string {
  const e = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (e && e !== "placeholder") return e;
  return getConfig()?.supabaseAnonKey ?? "";
}

// ── Build Meta JSON ──────────────────────────────────────────────

function buildComponents(f: Form): unknown[] {
  const out: unknown[] = [];

  if (f.headerType !== "NONE") {
    if (f.headerType === "TEXT" && f.headerText.trim()) {
      const vars = extractVarNums(f.headerText);
      const comp: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: f.headerText.trim() };
      if (vars.length > 0) {
        const ex = vars.map((_, i) => f.headerExamples[i] || `exemplo_header_${i + 1}`);
        comp.example = { header_text: ex };
      }
      out.push(comp);
    } else if (f.headerType !== "TEXT") {
      out.push({ type: "HEADER", format: f.headerType });
    }
  }

  if (f.bodyText.trim()) {
    const vars = extractVarNums(f.bodyText);
    const comp: Record<string, unknown> = { type: "BODY", text: f.bodyText.trim() };
    if (vars.length > 0) {
      const ex = vars.map((_, i) => f.bodyExamples[i] || `exemplo_${i + 1}`);
      comp.example = { body_text: [ex] };
    }
    out.push(comp);
  }

  if (f.footerText.trim()) {
    out.push({ type: "FOOTER", text: f.footerText.trim() });
  }

  if (f.buttons.length > 0) {
    const btns = f.buttons.map((b) => {
      if (b.type === "QUICK_REPLY") return { type: "QUICK_REPLY", text: b.text };
      if (b.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone };
      const urlBtn: Record<string, unknown> = { type: "URL", text: b.text, url: b.url };
      if (b.url.includes("{{1}}") && b.urlExample) urlBtn.example = [b.urlExample];
      return urlBtn;
    });
    out.push({ type: "BUTTONS", buttons: btns });
  }

  return out;
}

// ── Validation ───────────────────────────────────────────────────

interface ValidationError { field: string; message: string }

function validate(f: Form): ValidationError[] {
  const errs: ValidationError[] = [];

  if (!f.name) { errs.push({ field: "name", message: "Nome é obrigatório" }); }
  else if (!/^[a-z0-9_]+$/.test(f.name)) { errs.push({ field: "name", message: "Apenas letras minúsculas, números e underscores" }); }

  if (!f.bodyText.trim()) { errs.push({ field: "body", message: "O BODY é obrigatório" }); }
  else {
    const err = seqError(f.bodyText);
    if (err) errs.push({ field: "body", message: err });
    const vars = extractVarNums(f.bodyText);
    vars.forEach((_, i) => {
      if (!f.bodyExamples[i]?.trim()) errs.push({ field: `bodyEx_${i}`, message: `Exemplo para {{${i + 1}}} é obrigatório` });
    });
  }

  if (f.headerType === "TEXT") {
    if (!f.headerText.trim()) errs.push({ field: "headerText", message: "Texto do cabeçalho é obrigatório" });
    else {
      const err = seqError(f.headerText);
      if (err) errs.push({ field: "headerText", message: err });
      const vars = extractVarNums(f.headerText);
      vars.forEach((_, i) => {
        if (!f.headerExamples[i]?.trim()) errs.push({ field: `headerEx_${i}`, message: `Exemplo para {{${i + 1}}} do cabeçalho é obrigatório` });
      });
    }
  }

  f.buttons.forEach((b, i) => {
    if (!b.text.trim()) errs.push({ field: `btnText_${i}`, message: `Texto do botão ${i + 1} é obrigatório` });
    if (b.type === "URL" && !b.url.trim()) errs.push({ field: `btnUrl_${i}`, message: `URL do botão ${i + 1} é obrigatória` });
    if (b.type === "PHONE_NUMBER" && !b.phone.trim()) errs.push({ field: `btnPhone_${i}`, message: `Telefone do botão ${i + 1} é obrigatório` });
  });

  return errs;
}

// ── WhatsApp Preview ─────────────────────────────────────────────

const MEDIA_PREV: Record<string, { Icon: React.ComponentType<{className?:string}>; label: string; bg: string }> = {
  IMAGE:    { Icon: Image,    label: "Imagem",    bg: "rgba(96,165,250,0.1)"  },
  VIDEO:    { Icon: Video,    label: "Vídeo",     bg: "rgba(167,139,250,0.1)" },
  DOCUMENT: { Icon: FileText, label: "Documento", bg: "rgba(245,158,11,0.1)"  },
};

function renderText(text: string, examples: string[]): React.ReactNode {
  if (!text) return null;
  return text.split(/(\{\{\d+\}\})/g).map((part, i) => {
    const m = part.match(/\{\{(\d+)\}\}/);
    if (m) {
      const val = examples[parseInt(m[1]) - 1];
      return (
        <mark key={i} className="px-1 rounded not-italic" style={{ background: "rgba(245,158,11,0.25)", color: "#f59e0b" }}>
          {val || part}
        </mark>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function Preview({ f }: { f: Form }) {
  const bodyEmpty   = !f.bodyText && f.headerType === "NONE" && f.buttons.length === 0;
  const media       = f.headerType !== "NONE" && f.headerType !== "TEXT" ? MEDIA_PREV[f.headerType] : null;

  return (
    <div className="flex flex-col gap-3 h-full">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2">Preview</p>

      {/* Phone frame */}
      <div
        className="rounded-2xl flex-1 flex flex-col overflow-hidden"
        style={{ background: "#0f1c14", border: "1px solid rgba(63,176,108,0.12)" }}
      >
        {/* WA status bar */}
        <div className="flex items-center gap-2 px-4 py-3" style={{ background: "#1a2e1f" }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(63,176,108,0.2)" }}>
            <MessageSquare className="w-3.5 h-3.5 text-agro-green" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-agro-text leading-none">Solve AI</p>
            <p className="text-[10px] text-agro-muted-2">WhatsApp Business</p>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 p-4 overflow-y-auto flex flex-col justify-end gap-1">
          {bodyEmpty ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-agro-muted-2 text-center leading-relaxed">
                Preencha os campos<br />para ver o preview
              </p>
            </div>
          ) : (
            <>
              {/* Bubble */}
              <div className="flex justify-end">
                <div className="max-w-[90%]">
                  <div
                    className="rounded-t-2xl rounded-bl-2xl overflow-hidden"
                    style={{ background: "#1e3a2a", border: "1px solid rgba(63,176,108,0.2)" }}
                  >
                    {/* Header */}
                    {f.headerType === "TEXT" && f.headerText && (
                      <p className="px-3 pt-3 pb-1 text-sm font-bold text-agro-text">
                        {renderText(f.headerText, f.headerExamples)}
                      </p>
                    )}
                    {media && (
                      <div className="mx-3 mt-3 mb-1 h-24 rounded-lg flex flex-col items-center justify-center gap-1.5"
                        style={{ background: media.bg }}>
                        <media.Icon className="w-7 h-7 text-agro-muted" />
                        <p className="text-[10px] text-agro-muted-2">{media.label} · enviado no disparo</p>
                      </div>
                    )}

                    {/* Body */}
                    {f.bodyText && (
                      <p className="px-3 py-2 text-sm text-agro-text leading-relaxed whitespace-pre-wrap break-words">
                        {renderText(f.bodyText, f.bodyExamples)}
                      </p>
                    )}

                    {/* Footer */}
                    {f.footerText && (
                      <p className="px-3 pb-3 text-[11px] text-agro-muted-2">{f.footerText}</p>
                    )}

                    <p className="px-3 pb-2 text-right text-[10px] text-agro-muted-2">14:25 ✓✓</p>
                  </div>

                  {/* Buttons */}
                  {f.buttons.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1">
                      {f.buttons.map((b, i) => (
                        <div key={b.id} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
                          style={{ background: "#1e3a2a", border: "1px solid rgba(63,176,108,0.2)", color: "#3fb06c" }}>
                          {b.type === "URL"          && <Link2  className="w-3 h-3 shrink-0" />}
                          {b.type === "PHONE_NUMBER" && <Phone  className="w-3 h-3 shrink-0" />}
                          {b.text || `Botão ${i + 1}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────

function Section({ title, optional, right, children }: {
  title: string; optional?: boolean; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
      <div className="flex items-center justify-between px-4 py-2.5 rounded-t-xl"
        style={{ background: "rgba(63,176,108,0.04)", borderBottom: "1px solid rgba(63,176,108,0.08)" }}>
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-agro-muted-2">{title}</p>
          {optional && (
            <span className="text-[9px] px-1.5 py-0.5 rounded text-agro-muted-2"
              style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
              opcional
            </span>
          )}
        </div>
        {right}
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

// ── FieldError inline ─────────────────────────────────────────────

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs text-red-400 flex items-center gap-1 mt-1"><AlertCircle className="w-3 h-3 shrink-0" />{msg}</p>;
}

// ── Main component ───────────────────────────────────────────────

interface Props {
  connection: MetaConnection;
  workspaceId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function TemplateBuilder({ connection, workspaceId, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const uid       = useId();
  const bodyRef   = useRef<HTMLTextAreaElement>(null);

  const [form, setForm]         = useState<Form>(INIT);
  const [errors, setErrors]     = useState<ValidationError[]>([]);
  const [submitting, setSubmit] = useState(false);
  const [showBtnMenu, setShowBtnMenu] = useState(false);

  const err = useCallback((field: string) => errors.find((e) => e.field === field)?.message, [errors]);

  // ── Field helpers ──────────────────────────────────────────────

  function patch(update: Partial<Form>) { setForm((p) => ({ ...p, ...update })); }

  function onNameChange(raw: string) { patch({ name: normalName(raw) }); }

  function onBodyChange(val: string) {
    const vars = extractVarNums(val);
    const examples = Array.from({ length: Math.max(...(vars.length ? vars : [0])) || 0 },
      (_, i) => form.bodyExamples[i] ?? "");
    patch({ bodyText: val, bodyExamples: examples });
  }

  function onHeaderTextChange(val: string) {
    const vars = extractVarNums(val);
    const examples = Array.from({ length: Math.max(...(vars.length ? vars : [0])) || 0 },
      (_, i) => form.headerExamples[i] ?? "");
    patch({ headerText: val, headerExamples: examples });
  }

  function insertVar() {
    const el = bodyRef.current;
    if (!el) return;
    const next  = `{{${nextVarNum(form.bodyText)}}}`;
    const start = el.selectionStart;
    const end   = el.selectionEnd;
    const newText = form.bodyText.slice(0, start) + next + form.bodyText.slice(end);
    onBodyChange(newText);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + next.length, start + next.length);
    });
  }

  // ── Buttons ────────────────────────────────────────────────────

  function addButton(type: BtnType) {
    setShowBtnMenu(false);
    const item: ButtonItem = { id: `${uid}-${Date.now()}`, type, text: "", url: "", urlExample: "", phone: "" };
    patch({ buttons: [...form.buttons, item] });
  }

  function removeButton(id: string) {
    patch({ buttons: form.buttons.filter((b) => b.id !== id) });
  }

  function patchButton(id: string, update: Partial<ButtonItem>) {
    patch({ buttons: form.buttons.map((b) => (b.id === id ? { ...b, ...update } : b)) });
  }

  const countType = (t: BtnType) => form.buttons.filter((b) => b.type === t).length;
  const canAddQR    = countType("QUICK_REPLY") < MAX_QUICK;
  const canAddURL   = countType("URL") < MAX_URL;
  const canAddPhone = countType("PHONE_NUMBER") < MAX_PHONE;

  // ── Submit ─────────────────────────────────────────────────────

  async function handleSubmit() {
    const errs = validate(form);
    setErrors(errs);
    if (errs.length > 0) return;

    setSubmit(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const components = buildComponents(form);

      const res = await fetch(edgeFnUrl("meta-templates"), {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
          "apikey":        edgeFnKey(),
        },
        body: JSON.stringify({
          connection_id: connection.id,
          workspace_id:  workspaceId,
          name:          form.name,
          language:      form.language,
          category:      form.category,
          components,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        const detail = json.error as string ?? "Erro desconhecido";
        const code   = json.code ? ` (código ${json.code})` : "";
        toast({ title: "Meta rejeitou o template", description: `${detail}${code}`, variant: "destructive" });
      } else {
        toast({
          title: "Template enviado para revisão!",
          description: `"${form.name}" foi submetido. A Meta pode levar até 24h para aprovar.`,
          variant: "success",
        });
        onSuccess();
        onClose();
      }
    } catch (e) {
      toast({ title: "Erro de conexão", description: String(e), variant: "destructive" });
    } finally {
      setSubmit(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  const bodyVars   = extractVarNums(form.bodyText);
  const headerVars = extractVarNums(form.headerText);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full flex flex-col rounded-2xl overflow-hidden"
        style={{
          maxWidth: 1100,
          maxHeight: "94vh",
          background: "#0d1a11",
          border: "1px solid rgba(63,176,108,0.2)",
          boxShadow: "0 40px 100px rgba(0,0,0,0.7)",
        }}
      >
        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: "1px solid rgba(63,176,108,0.1)", background: "rgba(63,176,108,0.03)" }}>
          <div>
            <h2 className="font-display text-base font-bold text-agro-text">Construtor de Template</h2>
            <p className="text-xs text-agro-muted-2 mt-0.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-agro-green inline-block" />
              {connection.business_name ?? connection.display_phone}
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body: form + preview ────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left — scrollable form */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

            {/* ── Basic info ────────────────────────── */}
            <Section title="Informações básicas">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3">
                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-agro-muted">Nome do template</label>
                  <input
                    type="text"
                    placeholder="ex: cobranca_boleto_v1"
                    value={form.name}
                    onChange={(e) => onNameChange(e.target.value)}
                    className={cn("input-agro w-full font-mono text-sm", err("name") && "border-red-500/50")}
                    maxLength={LIMITS.name}
                  />
                  <FieldError msg={err("name")} />
                  <p className="text-[10px] text-agro-muted-2">Apenas minúsculas, números e _</p>
                </div>

                {/* Category */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-agro-muted">Categoria</label>
                  <select className="input-agro" value={form.category}
                    onChange={(e) => patch({ category: e.target.value as Form["category"] })}>
                    <option value="MARKETING">Marketing</option>
                    <option value="UTILITY">Utilitário</option>
                    <option value="AUTHENTICATION">Autenticação</option>
                  </select>
                </div>

                {/* Language */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-agro-muted">Idioma</label>
                  <select className="input-agro" value={form.language}
                    onChange={(e) => patch({ language: e.target.value })}>
                    <option value="pt_BR">🇧🇷 pt_BR</option>
                    <option value="en_US">🇺🇸 en_US</option>
                    <option value="es_AR">🇦🇷 es_AR</option>
                    <option value="es_MX">🇲🇽 es_MX</option>
                    <option value="es_ES">🇪🇸 es_ES</option>
                  </select>
                </div>
              </div>
            </Section>

            {/* ── HEADER ────────────────────────────── */}
            <Section title="Header" optional>
              <div className="space-y-3">
                {/* Type selector */}
                <div className="flex flex-wrap gap-2">
                  {(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as HeaderType[]).map((t) => {
                    const icons: Record<HeaderType, React.ReactNode> = {
                      NONE:     <span className="text-[10px]">—</span>,
                      TEXT:     <Type     className="w-3 h-3" />,
                      IMAGE:    <Image    className="w-3 h-3" />,
                      VIDEO:    <Video    className="w-3 h-3" />,
                      DOCUMENT: <FileText className="w-3 h-3" />,
                    };
                    const labels: Record<HeaderType, string> = {
                      NONE: "Nenhum", TEXT: "Texto", IMAGE: "Imagem", VIDEO: "Vídeo", DOCUMENT: "Documento",
                    };
                    const active = form.headerType === t;
                    return (
                      <button key={t} onClick={() => patch({ headerType: t })}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{
                          background: active ? "rgba(63,176,108,0.15)" : "rgba(255,255,255,0.03)",
                          border: `1px solid ${active ? "rgba(63,176,108,0.4)" : "rgba(255,255,255,0.08)"}`,
                          color: active ? "#3fb06c" : "#6b8f77",
                        }}>
                        {icons[t]}
                        {labels[t]}
                      </button>
                    );
                  })}
                </div>

                {/* TEXT header input */}
                {form.headerType === "TEXT" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-agro-muted">Texto do cabeçalho</label>
                      <span className="text-[10px] text-agro-muted-2">{form.headerText.length}/{LIMITS.headerText}</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Ex: Olá {{1}}, confira sua fatura!"
                      value={form.headerText}
                      maxLength={LIMITS.headerText}
                      onChange={(e) => onHeaderTextChange(e.target.value)}
                      className={cn("input-agro w-full", err("headerText") && "border-red-500/50")}
                    />
                    <FieldError msg={err("headerText")} />
                    {headerVars.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <p className="text-[11px] text-agro-muted flex items-center gap-1.5">
                          <Info className="w-3 h-3 text-agro-green" />
                          Exemplos para aprovação da Meta:
                        </p>
                        {headerVars.map((v, i) => (
                          <input key={v} type="text" placeholder={`Exemplo para {{${v}}}`}
                            value={form.headerExamples[i] ?? ""}
                            className={cn("input-agro w-full text-sm", err(`headerEx_${i}`) && "border-red-500/50")}
                            onChange={(e) => {
                              const ex = [...form.headerExamples];
                              ex[i] = e.target.value;
                              patch({ headerExamples: ex });
                            }} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Media info */}
                {form.headerType !== "NONE" && form.headerType !== "TEXT" && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs text-agro-muted"
                    style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.12)" }}>
                    <Info className="w-3.5 h-3.5 text-agro-green mt-0.5 shrink-0" />
                    A {MEDIA_PREV[form.headerType]?.label ?? form.headerType} será enviada no momento do disparo da campanha. Apenas o tipo de mídia é definido aqui.
                  </div>
                )}
              </div>
            </Section>

            {/* ── BODY ──────────────────────────────── */}
            <Section title="Body"
              right={<span className="text-[10px] text-agro-muted-2">{form.bodyText.length}/{LIMITS.bodyText}</span>}
            >
              <div className="space-y-2">
                <textarea
                  ref={bodyRef}
                  rows={5}
                  placeholder={"Olá {{1}}, sua fatura de R$ {{2}} vence em {{3}}.\n\nClique abaixo para pagar."}
                  value={form.bodyText}
                  maxLength={LIMITS.bodyText}
                  onChange={(e) => onBodyChange(e.target.value)}
                  className={cn("input-agro w-full resize-none leading-relaxed text-sm", err("body") && "border-red-500/50")}
                />
                <FieldError msg={err("body")} />

                {/* Variable insert button */}
                <button onClick={insertVar}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b" }}>
                  <CornerDownLeft className="w-3 h-3" />
                  Inserir variável {`{{${nextVarNum(form.bodyText)}}}`}
                </button>

                {/* Example values */}
                {bodyVars.length > 0 && (
                  <div className="space-y-2 pt-1 border-t" style={{ borderColor: "rgba(63,176,108,0.08)" }}>
                    <p className="text-[11px] text-agro-muted flex items-center gap-1.5 pt-1">
                      <Info className="w-3 h-3 text-agro-green" />
                      Exemplos para aprovação da Meta (obrigatório):
                    </p>
                    {bodyVars.map((v, i) => (
                      <div key={v} className="flex items-center gap-2">
                        <span className="text-xs font-mono text-amber-400 shrink-0 w-10">{`{{${v}}}`}</span>
                        <input type="text" placeholder={`Valor de exemplo`}
                          value={form.bodyExamples[i] ?? ""}
                          className={cn("input-agro flex-1 text-sm", err(`bodyEx_${i}`) && "border-red-500/50")}
                          onChange={(e) => {
                            const ex = [...form.bodyExamples];
                            ex[i] = e.target.value;
                            patch({ bodyExamples: ex });
                          }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>

            {/* ── FOOTER ────────────────────────────── */}
            <Section title="Footer" optional
              right={<span className="text-[10px] text-agro-muted-2">{form.footerText.length}/{LIMITS.footerText}</span>}
            >
              <input type="text" placeholder="Ex: Responda PARAR para cancelar."
                value={form.footerText}
                maxLength={LIMITS.footerText}
                onChange={(e) => patch({ footerText: e.target.value })}
                className="input-agro w-full text-sm" />
              <p className="text-[10px] text-agro-muted-2 mt-1">Nota de rodapé em cinza pequeno. Sem variáveis.</p>
            </Section>

            {/* ── BUTTONS ───────────────────────────── */}
            <Section title="Botões" optional>
              <div className="space-y-3">
                {form.buttons.map((btn, i) => (
                  <div key={btn.id} className="rounded-xl p-3 space-y-2.5"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    {/* Row 1: type badge + text + remove */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded font-semibold shrink-0"
                        style={{
                          background: btn.type === "QUICK_REPLY" ? "rgba(63,176,108,0.12)" :
                                      btn.type === "URL"          ? "rgba(96,165,250,0.12)" : "rgba(167,139,250,0.12)",
                          color:      btn.type === "QUICK_REPLY" ? "#3fb06c" :
                                      btn.type === "URL"          ? "#60a5fa" : "#a78bfa",
                        }}>
                        {btn.type === "QUICK_REPLY" ? "Resposta Rápida" : btn.type === "URL" ? "Link" : "Telefone"}
                      </span>
                      <input type="text" placeholder="Texto do botão"
                        value={btn.text}
                        maxLength={LIMITS.btnText}
                        onChange={(e) => patchButton(btn.id, { text: e.target.value })}
                        className={cn("input-agro flex-1 text-sm", err(`btnText_${i}`) && "border-red-500/50")}
                      />
                      <span className="text-[10px] text-agro-muted-2 shrink-0">{btn.text.length}/25</span>
                      <button onClick={() => removeButton(btn.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Row 2: URL input */}
                    {btn.type === "URL" && (
                      <div className="space-y-1.5 pl-2">
                        <input type="url" placeholder="https://seusite.com/{{1}}"
                          value={btn.url}
                          maxLength={LIMITS.btnUrl}
                          onChange={(e) => patchButton(btn.id, { url: e.target.value })}
                          className={cn("input-agro w-full text-sm font-mono", err(`btnUrl_${i}`) && "border-red-500/50")}
                        />
                        <FieldError msg={err(`btnUrl_${i}`)} />
                        {btn.url.includes("{{1}}") && (
                          <input type="url" placeholder="Exemplo de URL completa (obrigatório)"
                            value={btn.urlExample}
                            onChange={(e) => patchButton(btn.id, { urlExample: e.target.value })}
                            className="input-agro w-full text-sm"
                          />
                        )}
                        <p className="text-[10px] text-agro-muted-2">Use {"{{1}}"} no final da URL para uma variável dinâmica.</p>
                      </div>
                    )}

                    {/* Row 2: Phone input */}
                    {btn.type === "PHONE_NUMBER" && (
                      <div className="pl-2">
                        <input type="tel" placeholder="+5511999999999"
                          value={btn.phone}
                          onChange={(e) => patchButton(btn.id, { phone: e.target.value })}
                          className={cn("input-agro w-full text-sm font-mono", err(`btnPhone_${i}`) && "border-red-500/50")}
                        />
                        <FieldError msg={err(`btnPhone_${i}`)} />
                      </div>
                    )}
                  </div>
                ))}

                {/* Add button menu — inline (não absolute) para evitar clipping do overflow */}
                <div className="space-y-1">
                  <button
                    onClick={() => setShowBtnMenu((v) => !v)}
                    disabled={form.buttons.length >= 10}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                    style={{ border: "1px dashed rgba(63,176,108,0.3)", color: "#3fb06c" }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar botão
                    <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${showBtnMenu ? "rotate-180" : ""}`} />
                  </button>

                  {showBtnMenu && (
                    <div className="w-64 rounded-xl overflow-hidden shadow-xl"
                      style={{ background: "#0d1a11", border: "1px solid rgba(63,176,108,0.2)" }}>
                      {[
                        { type: "QUICK_REPLY"  as BtnType, icon: MessageSquare, label: "Resposta Rápida", desc: `máx ${MAX_QUICK}`,  ok: canAddQR    },
                        { type: "URL"          as BtnType, icon: Link2,         label: "Link",            desc: `máx ${MAX_URL}`,    ok: canAddURL   },
                        { type: "PHONE_NUMBER" as BtnType, icon: Phone,         label: "Telefone",        desc: `máx ${MAX_PHONE}`,  ok: canAddPhone },
                      ].map(({ type, icon: Icon, label, desc, ok }) => (
                        <button key={type} disabled={!ok} onClick={() => addButton(type)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/5">
                          <Icon className="w-4 h-4 text-agro-muted-2 shrink-0" />
                          <div className="text-left">
                            <p className="font-medium text-agro-text text-sm">{label}</p>
                            <p className="text-[10px] text-agro-muted-2">{desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {form.buttons.length > 0 && (
                  <p className="text-[10px] text-agro-muted-2 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    Mix: até 3 Respostas Rápidas + 2 Links + 1 Telefone
                  </p>
                )}
              </div>
            </Section>

            {/* Global errors */}
            {errors.length > 0 && (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm text-red-400"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold mb-1">Corrija os erros antes de enviar:</p>
                  <ul className="space-y-0.5">
                    {errors.slice(0, 4).map((e, i) => <li key={i} className="text-xs">• {e.message}</li>)}
                    {errors.length > 4 && <li className="text-xs text-red-300">...e mais {errors.length - 4}</li>}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Right — sticky preview */}
          <div className="w-72 shrink-0 flex flex-col px-4 py-5"
            style={{ borderLeft: "1px solid rgba(63,176,108,0.08)", background: "rgba(0,0,0,0.15)" }}>
            <Preview f={form} />
          </div>
        </div>

        {/* ── Footer ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderTop: "1px solid rgba(63,176,108,0.1)", background: "rgba(63,176,108,0.02)" }}>
          <p className="text-xs text-agro-muted-2">
            Status inicial: <span className="text-amber-400 font-medium">Pendente</span> · A Meta pode levar até 24h
          </p>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.12)" }}>
              Cancelar
            </button>
            <button onClick={handleSubmit} disabled={submitting}
              className="btn-agro flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-60">
              {submitting
                ? <><Loader2 className="w-4 h-4 animate-spin" />Enviando…</>
                : <><Plus className="w-4 h-4" />Criar Template</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
