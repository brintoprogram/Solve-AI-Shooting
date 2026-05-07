import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutTemplate, RefreshCw, Plus, Search, CheckCircle2,
  Clock, XCircle, Image, FileText, Mic, Video, ChevronDown,
  Loader2, AlertTriangle, Layers, Pencil, Trash2, MessageSquare,
  MousePointerClick, Hash,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Topbar } from "@/components/layout/Topbar";
import { supabase } from "@/lib/supabase";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { useZApiConnections } from "@/hooks/useZApiConnections";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { MetaTemplate, MetaConnection } from "@/types/shooting";
import type { TemplateComponent, ZApiTemplate } from "@/types/database";
import type { ZApiConnection } from "@/hooks/useZApiConnections";
import { TemplateBuilder } from "./TemplateBuilder";
import { ZApiTemplateEditor } from "./shooting/components/ZApiTemplateEditor";
import { useAuth } from "@/context/AuthContext";
import { getConfig } from "@/lib/config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Selected connection union ────────────────────────────────────

type SelectedConn =
  | { type: "meta";  data: MetaConnection  }
  | { type: "z_api"; data: ZApiConnection  }
  | null;

// ── Visual config ────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; border: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  APPROVED: { label: "Aprovado",  color: "#3fb06c", bg: "rgba(63,176,108,0.12)",  border: "rgba(63,176,108,0.3)",  Icon: CheckCircle2 },
  PENDING:  { label: "Pendente",  color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.3)",  Icon: Clock },
  REJECTED: { label: "Rejeitado", color: "#ef4444", bg: "rgba(239,68,68,0.12)",   border: "rgba(239,68,68,0.3)",   Icon: XCircle },
};

const CATEGORY_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  MARKETING:      { label: "Marketing",    color: "#a78bfa", bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.25)" },
  UTILITY:        { label: "Utilitário",   color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.25)"  },
  AUTHENTICATION: { label: "Autenticação", color: "#9ca3af", bg: "rgba(156,163,175,0.1)",  border: "rgba(156,163,175,0.25)" },
};

// ── Helpers ──────────────────────────────────────────────────────

function getBodyText(components: TemplateComponent[]): string {
  const body = components.find((c) => c.type === "BODY");
  return (body?.text ?? "").replace(/\n/g, " ");
}
function countVars(text: string): number {
  return text.match(/\{\{[0-9]+\}\}/g) ? new Set(text.match(/\{\{[0-9]+\}\}/g)).size : 0;
}
function getHeaderMedia(components: TemplateComponent[]): string | null {
  const header = components.find((c) => c.type === "HEADER");
  if (!header?.format || header.format === "TEXT") return null;
  return header.format;
}
function getButtonCount(components: TemplateComponent[]): number {
  return components.find((c) => c.type === "BUTTONS")?.buttons?.length ?? 0;
}
function countZApiVars(text: string): number {
  return new Set((text.match(/\{\{\w+\}\}/g) ?? [])).size;
}

function edgeFnUrl(fn: string): string {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (envUrl && envUrl !== "https://placeholder.supabase.co") return `${envUrl}/functions/v1/${fn}`;
  return `${getConfig()?.supabaseUrl ?? ""}/functions/v1/${fn}`;
}
function edgeFnKey(): string {
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (envKey && envKey !== "placeholder") return envKey;
  return getConfig()?.supabaseAnonKey ?? "";
}

const MEDIA_ICON: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  IMAGE: Image, VIDEO: Video, AUDIO: Mic, DOCUMENT: FileText,
};

// ── Sub-components ───────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  const Icon = cfg.Icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold shrink-0"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
    >
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const cfg = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.UTILITY;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
    >
      {cfg.label}
    </span>
  );
}

function StatPill({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(63,176,108,0.08)" }}
    >
      <span className="text-sm font-bold" style={{ color }}>{count}</span>
      <span className="text-xs text-agro-muted-2">{label}</span>
    </div>
  );
}

// ── Unified Connection Picker ────────────────────────────────────

function UnifiedConnectionPicker({
  metaConns,
  zApiConns,
  selected,
  onChange,
}: {
  metaConns: MetaConnection[];
  zApiConns: ZApiConnection[];
  selected:  SelectedConn;
  onChange:  (c: SelectedConn) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = metaConns.length + zApiConns.length;
  if (total === 0) return null;

  const label = selected
    ? selected.type === "meta"
      ? selected.data.business_name ?? selected.data.display_phone ?? "Meta"
      : selected.data.display_name  ?? selected.data.phone ?? selected.data.name
    : "Selecionar número";

  const typeBg  = selected?.type === "z_api"
    ? "rgba(96,165,250,0.06)"
    : "rgba(63,176,108,0.06)";
  const typeBdr = selected?.type === "z_api"
    ? "rgba(96,165,250,0.2)"
    : "rgba(63,176,108,0.15)";
  const typeDot = selected?.type === "z_api" ? "#60a5fa" : "#3fb06c";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-agro-text transition-all"
        style={{ background: typeBg, border: `1px solid ${typeBdr}`, minWidth: 200 }}
      >
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: typeDot }} />
        <span className="flex-1 text-left truncate">{label}</span>
        {selected && (
          <span
            className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
            style={
              selected.type === "z_api"
                ? { background: "rgba(96,165,250,0.15)", color: "#60a5fa" }
                : { background: "rgba(63,176,108,0.15)", color: "#3fb06c" }
            }
          >
            {selected.type === "z_api" ? "Z-API" : "Meta"}
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-agro-muted-2 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute top-11 left-0 z-20 w-72 rounded-xl overflow-hidden shadow-xl"
            style={{ background: "#0d1a11", border: "1px solid rgba(63,176,108,0.2)" }}
          >
            {metaConns.length > 0 && (
              <>
                <div
                  className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-agro-muted-2"
                  style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
                >
                  Meta WhatsApp Business
                </div>
                {metaConns.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { onChange({ type: "meta", data: c }); setOpen(false); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-left",
                      selected?.type === "meta" && selected.data.id === c.id ? "bg-white/5" : "",
                    )}
                  >
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      c.status === "active" ? "bg-agro-green" : "bg-red-400",
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-agro-text font-medium text-sm">{c.business_name ?? "—"}</p>
                      <p className="text-[10px] text-agro-muted-2 truncate">{c.display_phone}</p>
                    </div>
                    {selected?.type === "meta" && selected.data.id === c.id && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-agro-green shrink-0" />
                    )}
                  </button>
                ))}
              </>
            )}

            {zApiConns.length > 0 && (
              <>
                <div
                  className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-agro-muted-2"
                  style={{
                    borderTop:    metaConns.length > 0 ? "1px solid rgba(63,176,108,0.08)" : undefined,
                    borderBottom: "1px solid rgba(63,176,108,0.08)",
                  }}
                >
                  Z-API
                </div>
                {zApiConns.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { onChange({ type: "z_api", data: c }); setOpen(false); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-left",
                      selected?.type === "z_api" && selected.data.id === c.id ? "bg-white/5" : "",
                    )}
                  >
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      c.status === "connected" ? "bg-blue-400" : "bg-red-400",
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-agro-text font-medium text-sm">
                        {c.display_name ?? c.name}
                      </p>
                      <p className="text-[10px] text-agro-muted-2 truncate">
                        {c.phone ?? "Z-API"}
                      </p>
                    </div>
                    {selected?.type === "z_api" && selected.data.id === c.id && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Meta Template Row ────────────────────────────────────────────

function MetaTemplateRow({ template, isLast }: { template: MetaTemplate; isLast: boolean }) {
  const bodyText    = getBodyText(template.components as TemplateComponent[]);
  const varCount    = countVars(bodyText);
  const headerMedia = getHeaderMedia(template.components as TemplateComponent[]);
  const btnCount    = getButtonCount(template.components as TemplateComponent[]);
  const MediaIcon   = headerMedia ? MEDIA_ICON[headerMedia] : null;
  const preview     = bodyText.length > 90 ? bodyText.slice(0, 87) + "…" : bodyText;

  return (
    <div
      className="grid grid-cols-[1fr_auto_auto_auto] items-start gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors"
      style={{ borderBottom: isLast ? "none" : "1px solid rgba(63,176,108,0.05)" }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <p className="text-sm font-semibold text-agro-text font-mono">{template.template_name}</p>
          {MediaIcon && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{ background: "rgba(63,176,108,0.08)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.2)" }}
            >
              <MediaIcon className="w-3 h-3" />{headerMedia}
            </span>
          )}
          {varCount > 0 && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{ background: "rgba(245,158,11,0.08)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}
            >
              {varCount} var{varCount !== 1 ? "s" : ""}
            </span>
          )}
          {btnCount > 0 && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{ background: "rgba(96,165,250,0.08)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.2)" }}
            >
              {btnCount} botão{btnCount !== 1 ? "es" : ""}
            </span>
          )}
        </div>
        {preview
          ? <p className="text-xs text-agro-muted leading-relaxed">{preview}</p>
          : <p className="text-xs text-agro-muted-2 italic">Sem prévia de texto</p>
        }
        <p className="text-[10px] text-agro-muted-2 mt-1.5">
          Sincronizado{" "}
          {formatDistanceToNow(new Date(template.last_synced_at), { addSuffix: true, locale: ptBR })}
          {" · "}{template.language}
        </p>
      </div>
      <div className="flex items-start pt-0.5"><CategoryBadge category={template.category} /></div>
      <div className="flex items-start pt-0.5"><StatusBadge status={template.status} /></div>
      <div className="w-4" />
    </div>
  );
}

// ── Z-API Template Row ───────────────────────────────────────────

function ZApiTemplateRow({
  template, isLast, onEdit, onDelete, confirmingDelete, onConfirmDelete, onCancelDelete,
}: {
  template:        ZApiTemplate;
  isLast:          boolean;
  onEdit:          () => void;
  onDelete:        () => void;
  confirmingDelete: boolean;
  onConfirmDelete:  () => void;
  onCancelDelete:   () => void;
}) {
  const varCount = countZApiVars(template.body);
  const preview  = template.body.length > 90 ? template.body.slice(0, 87) + "…" : template.body;
  const isBtn    = template.message_type === "button_list";

  return (
    <div
      className="grid grid-cols-[1fr_auto] items-start gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors"
      style={{ borderBottom: isLast ? "none" : "1px solid rgba(63,176,108,0.05)" }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <p className="text-sm font-semibold text-agro-text">{template.name}</p>

          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={
              isBtn
                ? { background: "rgba(96,165,250,0.08)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.2)" }
                : { background: "rgba(63,176,108,0.08)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.2)" }
            }
          >
            {isBtn ? <MousePointerClick className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
            {isBtn ? "Com botões" : "Texto"}
          </span>

          {varCount > 0 && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{ background: "rgba(245,158,11,0.08)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}
            >
              <Hash className="w-3 h-3" />{varCount} var{varCount !== 1 ? "s" : ""}
            </span>
          )}

          {isBtn && template.buttons.length > 0 && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{ background: "rgba(167,139,250,0.08)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}
            >
              {template.buttons.length} botão{template.buttons.length !== 1 ? "es" : ""}
            </span>
          )}
        </div>

        {template.header_text && (
          <p className="text-[10px] text-agro-muted-2 mb-0.5 font-medium">
            Header: <span className="text-agro-muted">{template.header_text}</span>
          </p>
        )}
        {preview
          ? <p className="text-xs text-agro-muted leading-relaxed">{preview}</p>
          : <p className="text-xs text-agro-muted-2 italic">Sem corpo</p>
        }
        {template.footer && (
          <p className="text-[10px] text-agro-muted-2 mt-0.5 italic">{template.footer}</p>
        )}

        <p className="text-[10px] text-agro-muted-2 mt-1.5">
          Atualizado {formatDistanceToNow(new Date(template.updated_at), { addSuffix: true, locale: ptBR })}
        </p>
      </div>

      <div className="flex items-center gap-1.5 pt-0.5">
        {confirmingDelete ? (
          <>
            <button
              onClick={onConfirmDelete}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white transition-colors"
              style={{ background: "rgba(239,68,68,0.8)" }}
            >
              Confirmar
            </button>
            <button
              onClick={onCancelDelete}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-agro-muted hover:text-agro-text transition-colors"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg text-agro-muted-2 hover:text-agro-text hover:bg-white/5 transition-colors"
              title="Editar template"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg text-agro-muted-2 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Excluir template"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Empty states ─────────────────────────────────────────────────

function EmptyMetaState({ hasCon, onSync }: { hasCon: boolean; onSync: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "rgba(63,176,108,0.08)", border: "1px solid rgba(63,176,108,0.15)" }}
      >
        <Layers className="w-6 h-6 text-agro-muted-2" />
      </div>
      {hasCon ? (
        <>
          <p className="text-base font-semibold text-agro-text mb-1">Nenhum template encontrado</p>
          <p className="text-sm text-agro-muted mb-6 max-w-xs">
            Sincronize para buscar os templates aprovados na sua conta Meta Business.
          </p>
          <button onClick={onSync} className="btn-agro flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white">
            <RefreshCw className="w-4 h-4" />Sincronizar agora
          </button>
        </>
      ) : (
        <>
          <p className="text-base font-semibold text-agro-text mb-1">Nenhuma conexão Meta configurada</p>
          <p className="text-sm text-agro-muted max-w-xs">
            Configure uma conexão WhatsApp Business em <strong>Configurações</strong> para começar.
          </p>
        </>
      )}
    </div>
  );
}

function EmptyZApiState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.15)" }}
      >
        <MessageSquare className="w-6 h-6 text-agro-muted-2" />
      </div>
      <p className="text-base font-semibold text-agro-text mb-1">Nenhum template Z-API</p>
      <p className="text-sm text-agro-muted mb-6 max-w-xs">
        Crie templates personalizados com header, botões e variáveis — sem aprovação necessária.
      </p>
      <button onClick={onNew} className="btn-agro flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white">
        <Plus className="w-4 h-4" />Criar primeiro template
      </button>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────

export function Templates() {
  const { toast }       = useToast();
  const navigate        = useNavigate();
  const { workspaceId } = useAuth();
  const WORKSPACE_ID    = workspaceId ?? "";

  const { connections: metaConns, loading: metaConLoading } = useMetaConnections(WORKSPACE_ID);
  const { connections: zApiConns, loading: zApiConLoading  } = useZApiConnections(WORKSPACE_ID);

  // Selected connection (unified)
  const [selected, setSelected] = useState<SelectedConn>(null);

  // Meta templates
  const [metaTemplates, setMetaTemplates]   = useState<MetaTemplate[]>([]);
  const [loadingMeta,   setLoadingMeta]     = useState(false);
  const [syncing,       setSyncing]         = useState(false);
  const [statusFilter,  setStatusFilter]    = useState<string>("ALL");

  // Z-API templates
  const [zApiTemplates, setZApiTemplates]   = useState<ZApiTemplate[]>([]);
  const [loadingZApi,   setLoadingZApi]     = useState(false);
  const [confirmDelete, setConfirmDelete]   = useState<string | null>(null);
  const [editTemplate,  setEditTemplate]    = useState<ZApiTemplate | null>(null);

  // Shared
  const [search,       setSearch]       = useState("");
  const [showBuilder,  setShowBuilder]  = useState(false);
  const [showZEditor,  setShowZEditor]  = useState(false);

  // Auto-select first available connection on load
  useEffect(() => {
    if (selected) return;
    if (metaConns.length > 0)      setSelected({ type: "meta",  data: metaConns[0] });
    else if (zApiConns.length > 0) setSelected({ type: "z_api", data: zApiConns[0] });
  }, [metaConns, zApiConns, selected]);

  // Load meta templates when Meta connection selected
  const loadMetaTemplates = useCallback(async (connId: string) => {
    setLoadingMeta(true);
    const { data } = await db
      .from("meta_templates")
      .select("*")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("meta_connection_id", connId)
      .order("template_name");
    setMetaTemplates((data as MetaTemplate[]) ?? []);
    setLoadingMeta(false);
  }, [WORKSPACE_ID]);

  // Load Z-API templates when Z-API connection selected
  const loadZApiTemplates = useCallback(async (connId: string) => {
    setLoadingZApi(true);
    const { data } = await db
      .from("z_api_templates")
      .select("*")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("z_api_connection_id", connId)
      .order("created_at", { ascending: false });
    setZApiTemplates((data as ZApiTemplate[]) ?? []);
    setLoadingZApi(false);
  }, [WORKSPACE_ID]);

  useEffect(() => {
    if (!selected) return;
    setSearch("");
    if (selected.type === "meta")  loadMetaTemplates(selected.data.id);
    if (selected.type === "z_api") loadZApiTemplates(selected.data.id);
  }, [selected, loadMetaTemplates, loadZApiTemplates]);

  // ── Meta sync ──────────────────────────────────────────────
  async function handleSync() {
    if (selected?.type !== "meta") return;
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${edgeFnUrl("meta-templates")}?connection_id=${selected.data.id}&workspace_id=${WORKSPACE_ID}`,
        {
          headers: {
            "Authorization": `Bearer ${session?.access_token ?? ""}`,
            "apikey": edgeFnKey(),
          },
        },
      );
      const json = await res.json();
      if (!res.ok) {
        toast({ title: "Erro ao sincronizar", description: json.error ?? json.message ?? "Erro desconhecido", variant: "destructive" });
      } else {
        toast({
          title: "Templates sincronizados!",
          description: `${json.count} template${json.count !== 1 ? "s" : ""} importado${json.count !== 1 ? "s" : ""} da Meta.`,
          variant: "success",
        });
        loadMetaTemplates(selected.data.id);
      }
    } catch (err) {
      toast({ title: "Erro de conexão", description: String(err), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  // ── Z-API delete ───────────────────────────────────────────
  async function handleDeleteZApi(id: string) {
    await db.from("z_api_templates").delete().eq("id", id);
    setZApiTemplates((prev) => prev.filter((t) => t.id !== id));
    setConfirmDelete(null);
    toast({ title: "Template excluído", variant: "success" });
  }

  // ── Derived / filtering ────────────────────────────────────
  const filteredMeta = metaTemplates.filter((t) => {
    const matchSearch = !search ||
      t.template_name.toLowerCase().includes(search.toLowerCase()) ||
      getBodyText(t.components as TemplateComponent[]).toLowerCase().includes(search.toLowerCase());
    return matchSearch && (statusFilter === "ALL" || t.status === statusFilter);
  });

  const filteredZApi = zApiTemplates.filter((t) =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.body.toLowerCase().includes(search.toLowerCase()),
  );

  const metaCounts = {
    APPROVED: metaTemplates.filter((t) => t.status === "APPROVED").length,
    PENDING:  metaTemplates.filter((t) => t.status === "PENDING").length,
    REJECTED: metaTemplates.filter((t) => t.status === "REJECTED").length,
  };

  const isMeta     = selected?.type === "meta";
  const isZApi     = selected?.type === "z_api";
  const isLoading  = (metaConLoading || zApiConLoading) || (isMeta ? loadingMeta : isZApi ? loadingZApi : false);
  const hasAnyConn = metaConns.length > 0 || zApiConns.length > 0;

  return (
    <div className="min-h-screen" style={{ background: "#0a110e" }}>
      <Topbar breadcrumbs={[{ label: "Templates" }]} />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* ── Page header ──────────────────────── */}
        <div className="flex items-start justify-between animate-fade-up">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
              >
                <LayoutTemplate className="w-4 h-4 text-white" />
              </div>
              <h1 className="font-display text-2xl font-bold text-agro-text">Templates</h1>
            </div>
            <p className="text-sm text-agro-muted ml-12">
              {isMeta
                ? "Templates aprovados pela Meta Business"
                : isZApi
                  ? "Templates Z-API — criados localmente, sem aprovação"
                  : "Selecione um número para ver os templates"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <UnifiedConnectionPicker
              metaConns={metaConns}
              zApiConns={zApiConns}
              selected={selected}
              onChange={(c) => { setSelected(c); setStatusFilter("ALL"); }}
            />

            {/* Sync button — Meta only */}
            {isMeta && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                  "text-agro-muted hover:text-agro-text hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed",
                )}
                style={{ border: "1px solid rgba(63,176,108,0.12)" }}
              >
                {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {syncing ? "Sincronizando…" : "Sincronizar Meta"}
              </button>
            )}

            {/* New Template button */}
            {selected && (
              <button
                onClick={() => {
                  if (isMeta) {
                    setShowBuilder(true);
                  } else {
                    setEditTemplate(null);
                    setShowZEditor(true);
                  }
                }}
                className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
              >
                <Plus className="w-4 h-4" />
                Novo Template
              </button>
            )}

            {/* No connection state */}
            {!selected && !hasAnyConn && (
              <button
                onClick={() => navigate("/settings")}
                className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
              >
                <Plus className="w-4 h-4" />
                Configurar conexão
              </button>
            )}
          </div>
        </div>

        {/* ── Stats row (Meta only) ─────────────── */}
        {isMeta && !isLoading && metaTemplates.length > 0 && (
          <div className="flex items-center gap-3 animate-fade-up">
            <StatPill count={metaCounts.APPROVED} label="aprovados" color="#3fb06c" />
            <StatPill count={metaCounts.PENDING}  label="pendentes" color="#f59e0b" />
            <StatPill count={metaCounts.REJECTED} label="rejeitados" color="#ef4444" />
            <span className="ml-auto text-xs text-agro-muted-2">{metaTemplates.length} templates</span>
          </div>
        )}

        {/* ── Stats row (Z-API) ─────────────────── */}
        {isZApi && !isLoading && zApiTemplates.length > 0 && (
          <div className="flex items-center gap-3 animate-fade-up">
            <StatPill count={zApiTemplates.filter((t) => t.message_type === "text").length}        label="texto"      color="#3fb06c" />
            <StatPill count={zApiTemplates.filter((t) => t.message_type === "button_list").length} label="com botões" color="#60a5fa" />
            <span className="ml-auto text-xs text-agro-muted-2">{zApiTemplates.length} templates</span>
          </div>
        )}

        {/* ── Filters ──────────────────────────── */}
        {((isMeta && metaTemplates.length > 0) || (isZApi && zApiTemplates.length > 0)) && (
          <div className="flex items-center gap-3 animate-fade-up">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-agro-muted-2" />
              <input
                type="text"
                placeholder="Buscar templates…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-agro w-full pl-9 text-sm"
              />
            </div>

            {/* Status filter — Meta only */}
            {isMeta && (
              <div
                className="flex items-center rounded-xl p-0.5 gap-0.5"
                style={{ background: "rgba(63,176,108,0.05)", border: "1px solid rgba(63,176,108,0.1)" }}
              >
                {["ALL", "APPROVED", "PENDING", "REJECTED"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
                      statusFilter === s ? "bg-agro-green text-white" : "text-agro-muted-2 hover:text-agro-text",
                    )}
                  >
                    {s === "ALL" ? "Todos" : STATUS_CONFIG[s]?.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Table ────────────────────────────── */}
        <div
          className="rounded-2xl overflow-hidden animate-fade-up-delay-1"
          style={{
            background: "rgba(13,26,17,0.7)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(63,176,108,0.1)",
          }}
        >
          {/* Meta table header */}
          {isMeta && !isLoading && metaTemplates.length > 0 && (
            <div
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-3"
              style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
            >
              {["Nome & Prévia", "Categoria", "Status", ""].map((h, i) => (
                <p key={i} className="text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2">{h}</p>
              ))}
            </div>
          )}

          {/* Z-API table header */}
          {isZApi && !isLoading && zApiTemplates.length > 0 && (
            <div
              className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3"
              style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
            >
              {["Nome & Prévia", "Ações"].map((h, i) => (
                <p key={i} className="text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2">{h}</p>
              ))}
            </div>
          )}

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-agro-muted-2 animate-spin" />
            </div>
          ) : !selected ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <Layers className="w-8 h-8 text-agro-muted-2 mb-3" />
              <p className="text-sm font-medium text-agro-text">Nenhuma conexão configurada</p>
              <p className="text-xs text-agro-muted mt-1 max-w-xs">
                Configure uma conexão WhatsApp Business ou Z-API em <strong>Configurações</strong>.
              </p>
            </div>
          ) : isMeta ? (
            filteredMeta.length === 0 && search ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <Search className="w-8 h-8 text-agro-muted-2 mb-3" />
                <p className="text-sm font-medium text-agro-text">Nenhum resultado para "{search}"</p>
                <p className="text-xs text-agro-muted mt-1">Tente outro termo.</p>
              </div>
            ) : filteredMeta.length === 0 ? (
              <EmptyMetaState hasCon={true} onSync={handleSync} />
            ) : (
              filteredMeta.map((t, i) => (
                <MetaTemplateRow key={t.id} template={t} isLast={i === filteredMeta.length - 1} />
              ))
            )
          ) : isZApi ? (
            filteredZApi.length === 0 && search ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <Search className="w-8 h-8 text-agro-muted-2 mb-3" />
                <p className="text-sm font-medium text-agro-text">Nenhum resultado para "{search}"</p>
                <p className="text-xs text-agro-muted mt-1">Tente outro termo.</p>
              </div>
            ) : filteredZApi.length === 0 ? (
              <EmptyZApiState onNew={() => { setEditTemplate(null); setShowZEditor(true); }} />
            ) : (
              filteredZApi.map((t, i) => (
                <ZApiTemplateRow
                  key={t.id}
                  template={t}
                  isLast={i === filteredZApi.length - 1}
                  onEdit={() => { setEditTemplate(t); setShowZEditor(true); }}
                  onDelete={() => setConfirmDelete(t.id)}
                  confirmingDelete={confirmDelete === t.id}
                  onConfirmDelete={() => handleDeleteZApi(t.id)}
                  onCancelDelete={() => setConfirmDelete(null)}
                />
              ))
            )
          ) : null}
        </div>

        {/* ── Meta info cards ───────────────────── */}
        {isMeta && !isLoading && metaCounts.PENDING > 0 && (
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm animate-fade-up-delay-1"
            style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-agro-muted">
              <span className="text-amber-400 font-semibold">
                {metaCounts.PENDING} template{metaCounts.PENDING !== 1 ? "s" : ""} em revisão.
              </span>{" "}
              A Meta pode levar até 24 horas para aprovar. Sincronize novamente para atualizar o status.
            </p>
          </div>
        )}
        {isMeta && !isLoading && metaCounts.REJECTED > 0 && (
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm animate-fade-up-delay-1"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-agro-muted">
              <span className="text-red-400 font-semibold">
                {metaCounts.REJECTED} template{metaCounts.REJECTED !== 1 ? "s" : ""} rejeitado{metaCounts.REJECTED !== 1 ? "s" : ""}.
              </span>{" "}
              Revise o conteúdo e reenvie com o Construtor Visual (em breve).
            </p>
          </div>
        )}
      </div>

      {/* ── Meta Template Builder modal ──────────────────────────── */}
      {showBuilder && selected?.type === "meta" && (
        <TemplateBuilder
          connection={selected.data}
          workspaceId={WORKSPACE_ID}
          onClose={() => setShowBuilder(false)}
          onSuccess={() => loadMetaTemplates(selected.data.id)}
        />
      )}

      {/* ── Z-API Template Editor modal ──────────────────────────── */}
      {showZEditor && selected?.type === "z_api" && (
        <ZApiTemplateEditor
          workspaceId={WORKSPACE_ID}
          connectionId={selected.data.id}
          editTemplate={editTemplate}
          onClose={() => { setShowZEditor(false); setEditTemplate(null); }}
          onSaved={() => {
            setShowZEditor(false);
            setEditTemplate(null);
            loadZApiTemplates(selected.data.id);
          }}
        />
      )}
    </div>
  );
}
