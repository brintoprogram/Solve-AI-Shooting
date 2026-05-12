import { useState, useRef, useEffect } from "react";
import {
  LayoutTemplate, X, Check, Loader2, Plus, Trash2,
  Smartphone, Eye, Pencil, ChevronDown, Tag, FileText, MousePointerClick,
  Shuffle, ChevronUp, Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import type { ZApiTemplate, ZApiTemplateButton } from "@/types/database";
import { getVariationExamples } from "@/lib/textVariations";

interface Props {
  workspaceId:  string;
  connectionId?: string | null;
  editTemplate: ZApiTemplate | null;
  onClose:      () => void;
  onSaved:      () => void;
}

const LIMITS = { name: 100, header: 60, body: 1024, footer: 60, button: 20 };

export function ZApiTemplateEditor({ workspaceId, connectionId, editTemplate, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const isEdit = !!editTemplate;

  const [name,       setName]       = useState(editTemplate?.name        ?? "");
  const [msgType,    setMsgType]    = useState<"text" | "button_list">(editTemplate?.message_type ?? "text");
  const [headerText, setHeaderText] = useState(editTemplate?.header_text ?? "");
  const [body,       setBody]       = useState(editTemplate?.body        ?? "");
  const [footer,     setFooter]     = useState(editTemplate?.footer      ?? "");
  const [buttons,    setButtons]    = useState<ZApiTemplateButton[]>(
    editTemplate?.buttons?.length ? editTemplate.buttons : [{ id: "btn1", label: "" }],
  );
  const [enableVariations,  setEnableVariations]  = useState(editTemplate?.enable_light_variations ?? false);
  const [showVarPreviews,   setShowVarPreviews]   = useState(false);
  const [blocksMode, setBlocksMode] = useState(() => (editTemplate?.blocks?.length ?? 0) > 0);
  const [blocks,     setBlocks]     = useState<string[]>(
    editTemplate?.blocks?.length ? editTemplate.blocks : [""],
  );
  const [saving,        setSaving]        = useState(false);
  const [activeTab,     setActiveTab]     = useState<"form" | "preview">("form");
  const [showVarMenu,   setShowVarMenu]   = useState(false);
  const [showCustomVar, setShowCustomVar] = useState(false);
  const [customVarName, setCustomVarName] = useState("");

  const bodyRef    = useRef<HTMLTextAreaElement>(null);
  const varMenuRef = useRef<HTMLDivElement>(null);
  const saveFnRef  = useRef<((draft: boolean) => void) | null>(null);

  const allBodyText = blocksMode ? blocks.join("\n") : body;

  // Detected variables from body or blocks
  const detectedVars = Array.from(new Set(
    (allBodyText.match(/\{\{\w+\}\}/g) ?? []).map((m) => m.slice(2, -2)),
  ));

  function nextVarIndex(): string {
    const nums = (allBodyText.match(/\{\{(\d+)\}\}/g) ?? [])
      .map((m) => Number(m.slice(2, -2))).filter((n) => !isNaN(n));
    return nums.length > 0 ? String(Math.max(...nums) + 1) : "1";
  }

  function insertAtCursor(text: string) {
    const ta = bodyRef.current;
    if (ta) {
      const s = ta.selectionStart ?? body.length;
      const e = ta.selectionEnd   ?? body.length;
      const next = body.slice(0, s) + text + body.slice(e);
      setBody(next);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(s + text.length, s + text.length); }, 0);
    } else {
      setBody((b) => b + text);
    }
    setShowVarMenu(false);
    setShowCustomVar(false);
    setCustomVarName("");
  }

  // Close var menu on outside click
  useEffect(() => {
    if (!showVarMenu) return;
    const handler = (e: MouseEvent) => {
      if (varMenuRef.current && !varMenuRef.current.contains(e.target as Node)) {
        setShowVarMenu(false);
        setShowCustomVar(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showVarMenu]);

  // Keyboard shortcut: Cmd/Ctrl+Enter → save, Esc → close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        saveFnRef.current?.(false);
      }
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Button helpers
  function addButton() {
    if (buttons.length >= 3) return;
    setButtons((p) => [...p, { id: `btn${p.length + 1}`, label: "" }]);
  }
  function removeButton(i: number) { setButtons((p) => p.filter((_, idx) => idx !== i)); }
  function updateBtn(i: number, label: string) {
    setButtons((p) => p.map((b, idx) => idx === i ? { ...b, label } : b));
  }

  const canSave = !!(name.trim() &&
    (blocksMode ? blocks.some((b) => b.trim()) : body.trim()) &&
    (msgType !== "button_list" || buttons.some((b) => b.label.trim())));

  async function handleSave(draft: boolean) {
    if (!name.trim()) return;
    if (!draft && !canSave) return;
    setSaving(true);
    try {
      const effectiveBlocks = blocksMode ? blocks.filter((b) => b.trim()) : [];
      const effectiveBody   = blocksMode ? effectiveBlocks.join("\n") : body.trim();

      const payload = {
        workspace_id:             workspaceId,
        z_api_connection_id:      connectionId ?? null,
        name:                     name.trim(),
        message_type:             msgType,
        header_text:              (!blocksMode && headerText.trim()) || null,
        body:                     effectiveBody,
        footer:                   (!blocksMode && footer.trim()) || null,
        enable_light_variations:  enableVariations && !blocksMode,
        blocks:                   effectiveBlocks,
        buttons:                  msgType === "button_list"
          ? buttons.filter((b) => b.label.trim()).map((b, i) => ({ id: `btn${i + 1}`, label: b.label.trim() }))
          : [],
      };
      const q = isEdit
        ? supabase.from("z_api_templates").update(payload).eq("id", editTemplate!.id)
        : supabase.from("z_api_templates").insert(payload);
      const { error } = await q;
      if (error) throw error;
      toast({ title: draft ? "Rascunho salvo!" : isEdit ? "Template atualizado!" : "Template criado!", variant: "success" });
      onSaved();
    } catch (err) {
      toast({ title: "Erro ao salvar", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // Keep save fn ref up-to-date
  saveFnRef.current = handleSave;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden"
        style={{
          width: "min(92vw, 1160px)", height: "min(94vh, 820px)",
          background: "#0a110e",
          border: "1px solid rgba(139,92,246,0.2)",
          boxShadow: "0 40px 120px rgba(0,0,0,0.8)",
        }}
      >
        {/* ── Header ────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: "1px solid rgba(139,92,246,0.12)", background: "rgba(13,23,16,0.9)" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.2)" }}>
              <LayoutTemplate className="w-4 h-4" style={{ color: "#a78bfa" }} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-agro-text">
                {isEdit ? "Editar" : "Criar"} Template Z-API
              </h2>
              <p className="text-[11px] text-agro-muted-2">Configure e veja o preview ao vivo</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mobile tab toggle */}
            <div className="flex lg:hidden rounded-xl overflow-hidden"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
              {(["form", "preview"] as const).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-colors"
                  style={activeTab === tab
                    ? { background: "rgba(63,176,108,0.15)", color: "#3fb06c" }
                    : { background: "transparent", color: "#6b8a75" }}>
                  {tab === "form" ? <Pencil className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {tab === "form" ? "Form" : "Preview"}
                </button>
              ))}
            </div>

            <button onClick={onClose}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Main content ──────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left: Form */}
          <div
            className={`${activeTab === "preview" ? "hidden lg:flex" : "flex"} flex-col overflow-y-auto`}
            style={{ width: "100%", maxWidth: "520px", borderRight: "1px solid rgba(63,176,108,0.08)" }}
          >
            <div className="flex-1 p-6 space-y-7">

              {/* ── Identificação ── */}
              <section>
                <SectionLabel icon={<Tag className="w-3.5 h-3.5" />}>Identificação</SectionLabel>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="ztpl-name" className="field-label">Nome do template *</label>
                    <input id="ztpl-name" className="input-agro w-full"
                      placeholder="Ex: Cobrança Mensal, Boas-vindas…"
                      value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.name} />
                    <CharCount current={name.length} max={LIMITS.name} />
                  </div>

                  <div>
                    <p className="field-label">Tipo de mensagem *</p>
                    <div className="flex rounded-xl overflow-hidden"
                      style={{ border: "1px solid rgba(139,92,246,0.2)" }}>
                      <TypeTab active={msgType === "text"} onClick={() => setMsgType("text")}
                        label="Texto simples" sub="Somente texto" last={false} />
                      <TypeTab active={msgType === "button_list"} onClick={() => setMsgType("button_list")}
                        label="Com botões" sub="Até 3 respostas rápidas" last={true} />
                    </div>
                  </div>
                </div>
              </section>

              <Divider />

              {/* ── Conteúdo ── */}
              <section>
                <SectionLabel icon={<FileText className="w-3.5 h-3.5" />}>Conteúdo</SectionLabel>
                <div className="space-y-4">

                  {/* Header — hidden in blocks mode */}
                  {!blocksMode && (
                    <div>
                      <label htmlFor="ztpl-header" className="field-label">
                        Header <Opt />
                      </label>
                      <input id="ztpl-header" className="input-agro w-full"
                        placeholder="Ex: Aviso importante…"
                        value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={LIMITS.header} />
                      <CharCount current={headerText.length} max={LIMITS.header} />
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor={blocksMode ? undefined : "ztpl-body"} className="field-label !mb-0">
                        {blocksMode ? "Blocos de mensagem *" : "Corpo da mensagem *"}
                      </label>

                      <div className="flex items-center gap-2">
                        {/* Blocks mode toggle */}
                        <button
                          type="button"
                          onClick={() => {
                            if (!blocksMode) {
                              setBlocksMode(true);
                              setBlocks(body.trim() ? [body.trim()] : [""]);
                            } else {
                              setBlocksMode(false);
                              setBody(blocks.filter((b) => b.trim()).join("\n"));
                            }
                          }}
                          className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors"
                          style={blocksMode
                            ? { color: "#3fb06c", background: "rgba(63,176,108,0.12)", border: "1px solid rgba(63,176,108,0.4)" }
                            : { color: "#a0bfaa", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)" }}
                        >
                          <Layers className="w-3 h-3" />
                          {blocksMode ? "Blocos ativo" : "Blocos"}
                        </button>

                        {/* Variable menu — single-body mode only */}
                        {!blocksMode && (
                          <div className="relative" ref={varMenuRef}>
                            <button type="button"
                              onClick={() => { setShowVarMenu((v) => !v); setShowCustomVar(false); }}
                              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors hover:bg-agro-green/10"
                              style={{ color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }}>
                              + Inserir variável <ChevronDown className="w-3 h-3 ml-0.5" />
                            </button>
                            {showVarMenu && (
                              <div className="absolute right-0 top-full mt-1.5 z-20 rounded-xl w-56 py-1.5 shadow-2xl"
                                style={{ background: "#111d14", border: "1px solid rgba(63,176,108,0.2)" }}>
                                <button onClick={() => insertAtCursor(`{{${nextVarIndex()}}}`)}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-agro-text hover:bg-white/5 transition-colors">
                                  <span className="font-mono text-amber-400 text-[11px] bg-amber-400/10 px-1.5 py-0.5 rounded shrink-0">
                                    {`{{${nextVarIndex()}}}`}
                                  </span>
                                  Numerada — próxima
                                </button>
                                <div className="h-px mx-3 my-1" style={{ background: "rgba(63,176,108,0.1)" }} />
                                {showCustomVar ? (
                                  <div className="px-3 py-2">
                                    <p className="text-[10px] text-agro-muted-2 mb-1.5">Nome da variável personalizada</p>
                                    <div className="flex gap-2">
                                      <input autoFocus
                                        className="flex-1 rounded-lg px-2 py-1.5 text-xs text-agro-text outline-none"
                                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(63,176,108,0.2)" }}
                                        placeholder="ex: nome_cliente"
                                        value={customVarName}
                                        onChange={(e) => setCustomVarName(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") { e.preventDefault(); if (customVarName.trim()) insertAtCursor(`{{${customVarName.trim()}}}`); }
                                          if (e.key === "Escape") setShowCustomVar(false);
                                        }}
                                      />
                                      <button onClick={() => { if (customVarName.trim()) insertAtCursor(`{{${customVarName.trim()}}}`); }}
                                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors hover:bg-agro-green/15"
                                        style={{ color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }}>
                                        OK
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button onClick={() => setShowCustomVar(true)}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-agro-text hover:bg-white/5 transition-colors">
                                    <span className="font-mono text-blue-400 text-[11px] bg-blue-400/10 px-1.5 py-0.5 rounded shrink-0">
                                      {"{{nome}}"}
                                    </span>
                                    Personalizada…
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── Blocks editor ── */}
                    {blocksMode ? (
                      <div className="space-y-3">
                        {blocks.map((block, i) => {
                          const isLastBlock  = i === blocks.length - 1;
                          const isMixedLast  = isLastBlock && msgType === "button_list";
                          const borderColor  = isMixedLast
                            ? "1px solid rgba(245,158,11,0.25)"
                            : "1px solid rgba(63,176,108,0.12)";
                          return (
                            <div key={i} className="rounded-xl p-3"
                              style={{ background: "rgba(255,255,255,0.03)", border: borderColor }}>
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-semibold" style={{ color: isMixedLast ? "#f59e0b" : "#3fb06c" }}>
                                    Bloco {i + 1}
                                  </span>
                                  {isMixedLast && (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                      style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}>
                                      Com botões
                                    </span>
                                  )}
                                </div>
                                {blocks.length > 1 && (
                                  <button type="button"
                                    onClick={() => setBlocks((prev) => prev.filter((_, idx) => idx !== i))}
                                    className="w-6 h-6 rounded flex items-center justify-center text-agro-muted-2 hover:text-red-400 hover:bg-red-400/10 transition-colors">
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              <textarea
                                className="input-agro w-full resize-none" rows={2}
                                placeholder={i === 0 ? "Ex: Oi, tudo bem?" : isMixedLast ? "Texto do bloco com botões…" : `Mensagem do bloco ${i + 1}…`}
                                value={block}
                                onChange={(e) => setBlocks((prev) => prev.map((b, idx) => idx === i ? e.target.value : b))}
                                maxLength={LIMITS.body}
                              />
                              <div className="flex items-center justify-between mt-1">
                                <p className="text-[10px]" style={{ color: isMixedLast ? "rgba(245,158,11,0.6)" : "#4b6a55" }}>
                                  {isMixedLast
                                    ? "Enviado com botões de resposta rápida"
                                    : `Delay após: ~${(Math.max(1_600, Math.min(10_000, block.length * 100)) / 1_000).toFixed(1)}s`}
                                </p>
                                <CharCount current={block.length} max={LIMITS.body} />
                              </div>
                            </div>
                          );
                        })}

                        {blocks.length < 5 && (
                          <button type="button"
                            onClick={() => setBlocks((prev) => [...prev, ""])}
                            className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-xl w-full justify-center transition-colors hover:bg-agro-green/10"
                            style={{ color: "#3fb06c", border: "1px dashed rgba(63,176,108,0.3)" }}>
                            <Plus className="w-3 h-3" /> Adicionar bloco
                          </button>
                        )}

                        {/* Toggle: último bloco com botões */}
                        <div className="p-3 rounded-xl"
                          style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)" }}>
                          <label className="flex items-center gap-3 cursor-pointer select-none">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={msgType === "button_list"}
                              onClick={() => {
                                if (msgType === "text") {
                                  setMsgType("button_list");
                                  if (!buttons.some((b) => b.label.trim())) {
                                    setButtons([{ id: "btn1", label: "" }]);
                                  }
                                } else {
                                  setMsgType("text");
                                }
                              }}
                              className="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200"
                              style={{ background: msgType === "button_list" ? "#f59e0b" : "rgba(255,255,255,0.1)" }}
                            >
                              <span
                                className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                                style={{ transform: msgType === "button_list" ? "translateX(16px)" : "translateX(0)" }}
                              />
                            </button>
                            <div>
                              <p className="text-xs font-semibold"
                                style={{ color: msgType === "button_list" ? "#f59e0b" : "#7a9e83" }}>
                                Último bloco com botões
                              </p>
                              <p className="text-[10px] text-agro-muted leading-tight mt-0.5">
                                O último bloco será enviado como mensagem com botões de resposta rápida
                              </p>
                            </div>
                          </label>
                        </div>

                        <p className="text-[10px] text-agro-muted">
                          Use <span className="font-mono text-amber-400">{"{{1}}, {{2}}, ..."}</span> em qualquer bloco — mapeadas no wizard
                        </p>
                      </div>
                    ) : (
                      /* ── Single-body editor ── */
                      <>
                        <textarea id="ztpl-body" ref={bodyRef} className="input-agro w-full resize-none" rows={6}
                          placeholder="Olá {{1}}, sua fatura de {{2}} vence em {{3}}."
                          value={body} onChange={(e) => setBody(e.target.value)} maxLength={LIMITS.body} />

                        <div className="flex items-start justify-between mt-1 gap-2">
                          <p className="text-[10px] text-agro-muted">
                            Use <span className="font-mono text-amber-400">{"{{1}}, {{2}}, ..."}</span> — mapeadas no wizard
                          </p>
                          <CharCount current={body.length} max={LIMITS.body} />
                        </div>

                        {/* ── Leves variações ── */}
                        <div className="mt-3 p-3 rounded-xl" style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.15)" }}>
                          <label className="flex items-center gap-3 cursor-pointer select-none">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={enableVariations}
                              onClick={() => { setEnableVariations((v) => !v); setShowVarPreviews(false); }}
                              className="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200"
                              style={{ background: enableVariations ? "#8b5cf6" : "rgba(255,255,255,0.1)" }}
                            >
                              <span
                                className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                                style={{ transform: enableVariations ? "translateX(16px)" : "translateX(0)" }}
                              />
                            </button>
                            <div>
                              <p className="text-xs font-semibold" style={{ color: enableVariations ? "#a78bfa" : "#7a9e83" }}>
                                Permitir leves variações
                              </p>
                              <p className="text-[10px] text-agro-muted leading-tight mt-0.5">
                                Alterna pequenas partes do texto fixo a cada envio, preservando variáveis, sentido e tom.
                              </p>
                            </div>
                          </label>

                          {enableVariations && (
                            <div className="mt-2.5">
                              <button
                                type="button"
                                onClick={() => setShowVarPreviews((v) => !v)}
                                className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors"
                                style={{ color: "#a78bfa", border: "1px solid rgba(139,92,246,0.25)", background: "rgba(139,92,246,0.08)" }}
                              >
                                <Shuffle className="w-3 h-3" />
                                Pré-visualizar variações
                                {showVarPreviews ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>

                              {showVarPreviews && (
                                <div className="mt-2 space-y-2">
                                  {getVariationExamples(body, 3).map((example, i) => (
                                    <div key={i} className="p-2.5 rounded-lg text-xs text-agro-muted whitespace-pre-wrap leading-relaxed"
                                      style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.12)" }}>
                                      <span className="block text-[10px] font-semibold mb-1" style={{ color: "#7c3aed" }}>
                                        Variação {i + 1}
                                      </span>
                                      {example}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* Detected vars — shown for both modes */}
                    {detectedVars.length > 0 && (
                      <div className="mt-2.5 p-2.5 rounded-xl"
                        style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.15)" }}>
                        <p className="text-[10px] font-semibold mb-1.5" style={{ color: "rgba(251,191,36,0.7)" }}>
                          Variáveis detectadas — serão mapeadas no wizard:
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {detectedVars.map((v) => (
                            <span key={v} className="font-mono text-[11px] px-1.5 py-0.5 rounded"
                              style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24" }}>
                              {`{{${v}}}`}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer — hidden in blocks mode */}
                  {!blocksMode && (
                    <div>
                      <label htmlFor="ztpl-footer" className="field-label">Footer <Opt /></label>
                      <input id="ztpl-footer" className="input-agro w-full"
                        placeholder="Ex: Ignore se já pagou"
                        value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={LIMITS.footer} />
                      <CharCount current={footer.length} max={LIMITS.footer} />
                    </div>
                  )}
                </div>
              </section>

              {/* ── Interação (buttons) ── */}
              {msgType === "button_list" && (
                <>
                  <Divider />
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <SectionLabel icon={<MousePointerClick className="w-3.5 h-3.5" />}>Interação</SectionLabel>
                      {buttons.length < 3 && (
                        <button type="button" onClick={addButton}
                          className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors hover:bg-agro-green/10"
                          style={{ color: "#3fb06c", border: "1px solid rgba(63,176,108,0.25)" }}>
                          <Plus className="w-3 h-3" /> Adicionar
                        </button>
                      )}
                    </div>
                    <div className="space-y-2.5">
                      {buttons.map((btn, i) => (
                        <div key={i} className="flex items-center gap-2.5">
                          <span className="text-[11px] font-mono text-agro-muted-2 shrink-0 w-5 text-center">{i + 1}</span>
                          <input className="input-agro flex-1 text-sm"
                            placeholder={`Texto do botão ${i + 1}`}
                            value={btn.label} onChange={(e) => updateBtn(i, e.target.value)}
                            maxLength={LIMITS.button}
                            aria-label={`Botão ${i + 1}`} />
                          <span className="text-[10px] text-agro-muted-2 shrink-0 tabular-nums">
                            {btn.label.length}/{LIMITS.button}
                          </span>
                          {buttons.length > 1 && (
                            <button type="button" onClick={() => removeButton(i)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted-2 hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-agro-muted mt-2">Máx. 3 botões · até {LIMITS.button} caracteres cada</p>
                  </section>
                </>
              )}
            </div>
          </div>

          {/* Right: Live Preview */}
          <div
            className={`${activeTab === "form" ? "hidden lg:flex" : "flex"} flex-col flex-1 min-w-0 overflow-hidden`}
            style={{ background: "rgba(8,13,10,0.5)" }}
          >
            <div className="flex items-center gap-2 px-6 py-3 shrink-0"
              style={{ borderBottom: "1px solid rgba(63,176,108,0.07)" }}>
              <Smartphone className="w-3.5 h-3.5" style={{ color: "#6b8a75" }} />
              <span className="text-[11px] font-bold text-agro-muted-2 uppercase tracking-widest">Preview ao vivo</span>
            </div>
            <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
              <WhatsAppPreview
                header={blocksMode ? "" : headerText}
                body={blocksMode ? "" : body}
                footer={blocksMode ? "" : footer}
                buttons={msgType === "button_list" ? buttons : []}
                blocks={blocksMode ? blocks : []}
              />
            </div>
          </div>
        </div>

        {/* ── Footer action bar ─────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-6 py-3.5 shrink-0 gap-4"
          style={{ borderTop: "1px solid rgba(63,176,108,0.1)", background: "rgba(13,23,16,0.95)" }}
        >
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors shrink-0"
            style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
            Cancelar
          </button>

          <div className="flex items-center gap-3 flex-1 justify-end">
            <button onClick={() => handleSave(true)} disabled={!name.trim() || saving}
              className="hidden sm:flex px-4 py-2 rounded-xl text-sm font-medium text-agro-muted-2 hover:text-agro-text transition-colors disabled:opacity-40"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}>
              Salvar rascunho
            </button>
            <button onClick={() => handleSave(false)} disabled={!canSave || saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 btn-agro">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? "Salvando…" : isEdit ? "Atualizar template" : "Criar template"}
            </button>
          </div>

          <p className="hidden md:flex items-center gap-1 text-[10px] text-agro-muted-2 shrink-0 select-none">
            <Kbd>⌘</Kbd> + <Kbd>↵</Kbd>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function SectionLabel({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
        style={{ background: "rgba(63,176,108,0.1)", color: "#3fb06c" }}>
        {icon}
      </span>
      <p className="text-[11px] font-bold text-agro-muted-2 uppercase tracking-widest">{children}</p>
    </div>
  );
}

function Divider() {
  return <div className="h-px" style={{ background: "rgba(63,176,108,0.08)" }} />;
}

function Opt() {
  return <span className="font-normal normal-case opacity-50 ml-1">(opcional)</span>;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="font-mono px-1.5 py-0.5 rounded text-[10px]"
      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
      {children}
    </kbd>
  );
}

function CharCount({ current, max }: { current: number; max: number }) {
  const pct = current / max;
  const color = pct > 0.9 ? "#f87171" : pct > 0.7 ? "#fbbf24" : "#4b6a55";
  if (current === 0) return null;
  return (
    <p className="text-[10px] text-right mt-0.5 tabular-nums" style={{ color }}>
      {current}/{max}
    </p>
  );
}

function TypeTab({ active, onClick, label, sub, last }: {
  active: boolean; onClick: () => void; label: string; sub: string; last: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className="flex-1 py-3 px-4 text-left transition-all"
      style={{
        background: active ? "rgba(139,92,246,0.1)" : "transparent",
        color: active ? "#a78bfa" : "#6b8a75",
        borderRight: last ? "none" : "1px solid rgba(139,92,246,0.15)",
      }}>
      <p className="text-[12px] font-semibold">{label}</p>
      <p className="text-[10px] opacity-60 mt-0.5">{sub}</p>
    </button>
  );
}

// ── WhatsApp preview ──────────────────────────────────────────

function renderWithVars(text: string): React.ReactNode {
  const parts = text.split(/(\{\{\w+\}\})/g);
  return parts.map((part, i) =>
    /^\{\{\w+\}\}$/.test(part)
      ? <mark key={i} style={{ background: "rgba(251,191,36,0.25)", color: "#fcd34d", borderRadius: "3px", padding: "0 2px" }}>{part}</mark>
      : <span key={i}>{part}</span>
  );
}

function WhatsAppPreview({ header, body, footer, buttons, blocks = [] }: {
  header: string; body: string; footer: string; buttons: ZApiTemplateButton[]; blocks?: string[];
}) {
  const visibleBtns  = buttons.filter((b) => b.label.trim());
  const visibleBlocks = blocks.filter((b) => b.trim());
  const isBlocksMode = visibleBlocks.length > 0;
  const isEmpty = isBlocksMode
    ? visibleBlocks.length === 0
    : !header && !body && !footer && visibleBtns.length === 0;

  return (
    <div className="w-full max-w-[280px] select-none">
      {/* Phone shell */}
      <div className="rounded-[28px] overflow-hidden shadow-2xl"
        style={{ background: "#111b21", border: "7px solid #1c2930" }}>

        {/* WA top bar */}
        <div className="flex items-center gap-2.5 px-3 py-2.5" style={{ background: "#202c33" }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
            style={{ background: "linear-gradient(135deg, #3fb06c, #2d8a52)" }}>C</div>
          <div>
            <p className="text-[11px] font-semibold text-white leading-none">Contato</p>
            <p className="text-[9px] mt-0.5" style={{ color: "#8696a0" }}>online</p>
          </div>
        </div>

        {/* Chat area */}
        <div className="p-3 min-h-[180px]" style={{ background: "#0b141a" }}>
          {isEmpty ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-[11px] text-center leading-relaxed" style={{ color: "#8696a0" }}>
                Preencha o formulário<br />para ver o preview
              </p>
            </div>
          ) : isBlocksMode ? (
            /* ── Multi-block bubbles ── */
            <div className="space-y-1.5">
              {visibleBlocks.map((block, i) => {
                const isLast = i === visibleBlocks.length - 1;
                return (
                  <div key={i} className="ml-auto" style={{ maxWidth: "92%" }}>
                    <div className="rounded-2xl rounded-tr-sm overflow-hidden shadow-md"
                      style={{ background: "#005c4b" }}>
                      <div className="px-3 pt-2.5 pb-1">
                        <p className="text-[12px] leading-relaxed text-white whitespace-pre-wrap break-words">
                          {renderWithVars(block)}
                        </p>
                      </div>
                      <div className="flex justify-end px-3 pb-1.5 pt-0">
                        <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                          12:0{i} ✓✓
                        </p>
                      </div>
                    </div>
                    {isLast && visibleBtns.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {visibleBtns.map((btn, bi) => (
                          <div key={bi}
                            className="rounded-xl flex items-center justify-center py-2 px-3 text-[12px] font-medium"
                            style={{ background: "#005c4b", color: "#53bdeb" }}>
                            {btn.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Single-message bubble ── */
            <div className="ml-auto" style={{ maxWidth: "92%" }}>
              <div className="rounded-2xl rounded-tr-sm overflow-hidden shadow-md"
                style={{ background: "#005c4b" }}>

                {header && (
                  <div className={`px-3 pt-3 ${body || footer ? "pb-1" : "pb-3"}`}>
                    <p className="text-[13px] font-bold leading-snug text-white break-words">
                      {renderWithVars(header)}
                    </p>
                  </div>
                )}

                {body && (
                  <div className={`px-3 ${header ? "py-1" : "pt-3 pb-1"} ${!footer ? "pb-2" : ""}`}>
                    <p className="text-[12px] leading-relaxed text-white whitespace-pre-wrap break-words">
                      {renderWithVars(body)}
                    </p>
                  </div>
                )}

                {footer && (
                  <div className="px-3 py-1 pb-2">
                    <p className="text-[10px] leading-snug break-words" style={{ color: "rgba(255,255,255,0.5)" }}>
                      {renderWithVars(footer)}
                    </p>
                  </div>
                )}

                <div className="flex justify-end px-3 pb-1.5 pt-0.5">
                  <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.4)" }}>12:00 ✓✓</p>
                </div>
              </div>

              {/* Quick reply buttons */}
              {visibleBtns.length > 0 && (
                <div className="mt-1 space-y-1">
                  {visibleBtns.map((btn, i) => (
                    <div key={i}
                      className="rounded-xl flex items-center justify-center py-2 px-3 text-[12px] font-medium"
                      style={{ background: "#005c4b", color: "#53bdeb" }}>
                      {btn.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center justify-center gap-2">
        <span className="w-3 h-3 rounded shrink-0"
          style={{ background: "rgba(251,191,36,0.2)", border: "1px solid rgba(251,191,36,0.3)" }} />
        <p className="text-[10px]" style={{ color: "#8696a0" }}>
          Variáveis substituídas no envio
        </p>
      </div>
    </div>
  );
}
