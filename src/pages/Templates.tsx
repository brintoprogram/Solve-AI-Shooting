import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutTemplate, RefreshCw, Plus, Search, CheckCircle2,
  Clock, XCircle, Image, FileText, Mic, Video, ChevronDown,
  Loader2, AlertTriangle, Layers,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Topbar } from "@/components/layout/Topbar";
import { supabase } from "@/lib/supabase";
import { useMetaConnections } from "@/hooks/useMetaConnection";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { MetaTemplate, MetaConnection } from "@/types/shooting";
import type { TemplateComponent } from "@/types/database";
import { TemplateBuilder } from "./TemplateBuilder";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const WORKSPACE_ID = "demo-workspace-id";

// ── Config visual ────────────────────────────────────────────────

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
  const matches = text.match(/\{\{[0-9]+\}\}/g);
  return matches ? new Set(matches).size : 0;
}

function getHeaderMedia(components: TemplateComponent[]): string | null {
  const header = components.find((c) => c.type === "HEADER");
  if (!header?.format || header.format === "TEXT") return null;
  return header.format;
}

function getButtonCount(components: TemplateComponent[]): number {
  const buttons = components.find((c) => c.type === "BUTTONS");
  return buttons?.buttons?.length ?? 0;
}

const MEDIA_ICON: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  IMAGE:    Image,
  VIDEO:    Video,
  AUDIO:    Mic,
  DOCUMENT: FileText,
};

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

// ── Sub-components ───────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  const Icon = cfg.Icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold shrink-0"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
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

function StatPill({
  count, label, color,
}: { count: number; label: string; color: string }) {
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

// ── Connection Selector ──────────────────────────────────────────

function ConnectionSelector({
  connections,
  selected,
  onChange,
}: {
  connections: MetaConnection[];
  selected: MetaConnection | null;
  onChange: (c: MetaConnection) => void;
}) {
  const [open, setOpen] = useState(false);

  if (connections.length === 0) return null;
  if (connections.length === 1) return null; // auto-selected, no UI needed

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-agro-text transition-all"
        style={{
          background: "rgba(63,176,108,0.06)",
          border: "1px solid rgba(63,176,108,0.15)",
          minWidth: 180,
        }}
      >
        <div className="w-2 h-2 rounded-full bg-agro-green shrink-0" />
        <span className="flex-1 text-left truncate">
          {selected?.business_name ?? selected?.display_phone ?? "Selecionar conexão"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-agro-muted-2 shrink-0" />
      </button>

      {open && (
        <div
          className="absolute top-10 left-0 z-20 w-64 rounded-xl overflow-hidden shadow-xl"
          style={{ background: "#0d1a11", border: "1px solid rgba(63,176,108,0.2)" }}
        >
          {connections.map((c) => (
            <button
              key={c.id}
              onClick={() => { onChange(c); setOpen(false); }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-agro-muted hover:text-agro-text hover:bg-white/5 transition-colors text-left"
            >
              <div className="w-2 h-2 rounded-full bg-agro-green shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-agro-text font-medium">{c.business_name ?? "—"}</p>
                <p className="text-[10px] text-agro-muted-2 truncate">{c.display_phone}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Template Row ─────────────────────────────────────────────────

function TemplateRow({ template, isLast }: { template: MetaTemplate; isLast: boolean }) {
  const bodyText   = getBodyText(template.components as TemplateComponent[]);
  const varCount   = countVars(bodyText);
  const headerMedia = getHeaderMedia(template.components as TemplateComponent[]);
  const btnCount   = getButtonCount(template.components as TemplateComponent[]);
  const MediaIcon  = headerMedia ? MEDIA_ICON[headerMedia] : null;
  const preview    = bodyText.length > 90 ? bodyText.slice(0, 87) + "…" : bodyText;

  return (
    <div
      className="grid grid-cols-[1fr_auto_auto_auto] items-start gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors"
      style={{ borderBottom: isLast ? "none" : "1px solid rgba(63,176,108,0.05)" }}
    >
      {/* Name + preview */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <p className="text-sm font-semibold text-agro-text font-mono">
            {template.template_name}
          </p>
          {MediaIcon && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{ background: "rgba(63,176,108,0.08)", color: "#3fb06c", border: "1px solid rgba(63,176,108,0.2)" }}
            >
              <MediaIcon className="w-3 h-3" />
              {headerMedia}
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

        {preview ? (
          <p className="text-xs text-agro-muted leading-relaxed">{preview}</p>
        ) : (
          <p className="text-xs text-agro-muted-2 italic">Sem prévia de texto</p>
        )}

        <p className="text-[10px] text-agro-muted-2 mt-1.5">
          Sincronizado{" "}
          {formatDistanceToNow(new Date(template.last_synced_at), {
            addSuffix: true,
            locale: ptBR,
          })}
          {" · "}
          {template.language}
        </p>
      </div>

      {/* Category */}
      <div className="flex items-start pt-0.5">
        <CategoryBadge category={template.category} />
      </div>

      {/* Status */}
      <div className="flex items-start pt-0.5">
        <StatusBadge status={template.status} />
      </div>

      {/* Placeholder for Passo 3 actions */}
      <div className="w-4" />
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────

function EmptyState({ hasCon, onSync }: { hasCon: boolean; onSync: () => void }) {
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
            <RefreshCw className="w-4 h-4" />
            Sincronizar agora
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

// ── Main Page ────────────────────────────────────────────────────

export function Templates() {
  const { toast }    = useToast();
  const navigate     = useNavigate();
  const { connections, loading: conLoading } = useMetaConnections(WORKSPACE_ID);

  const [templates, setTemplates]     = useState<MetaTemplate[]>([]);
  const [loadingTpl, setLoadingTpl]   = useState(true);
  const [syncing, setSyncing]         = useState(false);
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedConn, setSelectedConn] = useState<MetaConnection | null>(null);
  const [showBuilder, setShowBuilder]   = useState(false);

  // Auto-select first connection
  useEffect(() => {
    if (!selectedConn && connections.length > 0) {
      setSelectedConn(connections[0]);
    }
  }, [connections, selectedConn]);

  // Load templates from DB
  const loadTemplates = useCallback(async () => {
    setLoadingTpl(true);
    const q = db
      .from("meta_templates")
      .select("*")
      .eq("workspace_id", WORKSPACE_ID)
      .order("template_name");

    const { data } = await q;
    setTemplates((data as MetaTemplate[]) ?? []);
    setLoadingTpl(false);
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // Sync from Meta API via edge function
  async function handleSync() {
    if (!selectedConn) {
      toast({ title: "Selecione uma conexão", variant: "destructive" });
      return;
    }
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${edgeFnUrl("meta-templates")}?connection_id=${selectedConn.id}&workspace_id=${WORKSPACE_ID}`,
        {
          headers: {
            "Authorization": `Bearer ${session?.access_token ?? ""}`,
            "apikey": edgeFnKey(),
          },
        },
      );
      const json = await res.json();

      if (!res.ok) {
        toast({
          title: "Erro ao sincronizar",
          description: json.error ?? "Erro desconhecido",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Templates sincronizados!",
          description: `${json.count} template${json.count !== 1 ? "s" : ""} importado${json.count !== 1 ? "s" : ""} da Meta.`,
          variant: "success",
        });
        await loadTemplates();
      }
    } catch (err) {
      toast({ title: "Erro de conexão", description: String(err), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  // Filtering
  const filtered = templates.filter((t) => {
    const matchSearch = !search ||
      t.template_name.toLowerCase().includes(search.toLowerCase()) ||
      getBodyText(t.components as TemplateComponent[]).toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "ALL" || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const counts = {
    APPROVED: templates.filter((t) => t.status === "APPROVED").length,
    PENDING:  templates.filter((t) => t.status === "PENDING").length,
    REJECTED: templates.filter((t) => t.status === "REJECTED").length,
  };

  const hasConnections = connections.length > 0;
  const isLoading = conLoading || loadingTpl;

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
              Gerencie e crie templates aprovados pela Meta Business
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Connection picker (only if >1 connection) */}
            <ConnectionSelector
              connections={connections}
              selected={selectedConn}
              onChange={setSelectedConn}
            />

            {/* Sync */}
            <button
              onClick={handleSync}
              disabled={syncing || !hasConnections}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                "text-agro-muted hover:text-agro-text hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed",
              )}
              style={{ border: "1px solid rgba(63,176,108,0.12)" }}
            >
              {syncing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />
              }
              {syncing ? "Sincronizando…" : "Sincronizar Meta"}
            </button>

            {/* Novo Template */}
            <button
              onClick={() => {
                if (!selectedConn) {
                  toast({
                    title:       "Nenhuma conexão configurada",
                    description: "Configure uma conexão WhatsApp em Configurações primeiro.",
                    variant:     "destructive",
                  });
                  navigate("/settings");
                  return;
                }
                setShowBuilder(true);
              }}
              className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
            >
              <Plus className="w-4 h-4" />
              Novo Template
            </button>
          </div>
        </div>

        {/* ── Stats row ────────────────────────── */}
        {!isLoading && templates.length > 0 && (
          <div className="flex items-center gap-3 animate-fade-up">
            <StatPill count={counts.APPROVED} label="aprovados" color="#3fb06c" />
            <StatPill count={counts.PENDING}  label="pendentes" color="#f59e0b" />
            <StatPill count={counts.REJECTED} label="rejeitados" color="#ef4444" />
            <span className="ml-auto text-xs text-agro-muted-2">{templates.length} templates no total</span>
          </div>
        )}

        {/* ── Filters ──────────────────────────── */}
        {templates.length > 0 && (
          <div className="flex items-center gap-3 animate-fade-up">
            {/* Search */}
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

            {/* Status filter tabs */}
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
                    statusFilter === s
                      ? "bg-agro-green text-white"
                      : "text-agro-muted-2 hover:text-agro-text",
                  )}
                >
                  {s === "ALL" ? "Todos" : STATUS_CONFIG[s]?.label}
                </button>
              ))}
            </div>
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
          {/* Table header */}
          {!isLoading && templates.length > 0 && (
            <div
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-3"
              style={{ borderBottom: "1px solid rgba(63,176,108,0.08)" }}
            >
              {["Nome & Prévia", "Categoria", "Status", ""].map((h, i) => (
                <p key={i} className="text-[10px] font-semibold uppercase tracking-widest text-agro-muted-2">
                  {h}
                </p>
              ))}
            </div>
          )}

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-agro-muted-2 animate-spin" />
            </div>
          ) : filtered.length === 0 && search ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Search className="w-8 h-8 text-agro-muted-2 mb-3" />
              <p className="text-sm font-medium text-agro-text">Nenhum resultado para "{search}"</p>
              <p className="text-xs text-agro-muted mt-1">Tente outro termo ou limpe o filtro.</p>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState hasCon={hasConnections} onSync={handleSync} />
          ) : (
            filtered.map((t, i) => (
              <TemplateRow key={t.id} template={t} isLast={i === filtered.length - 1} />
            ))
          )}
        </div>

        {/* ── PENDING info card ─────────────────── */}
        {!isLoading && counts.PENDING > 0 && (
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm animate-fade-up-delay-1"
            style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-agro-muted">
              <span className="text-amber-400 font-semibold">{counts.PENDING} template{counts.PENDING !== 1 ? "s" : ""} em revisão.</span>{" "}
              A Meta pode levar até 24 horas para aprovar. Sincronize novamente para atualizar o status.
            </p>
          </div>
        )}

        {/* ── REJECTED info card ────────────────── */}
        {!isLoading && counts.REJECTED > 0 && (
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm animate-fade-up-delay-1"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-agro-muted">
              <span className="text-red-400 font-semibold">{counts.REJECTED} template{counts.REJECTED !== 1 ? "s" : ""} rejeitado{counts.REJECTED !== 1 ? "s" : ""}.</span>{" "}
              Revise o conteúdo e reenvie com o Construtor Visual (em breve).
            </p>
          </div>
        )}
      </div>

      {/* ── Template Builder modal ───────────────────────────────── */}
      {showBuilder && selectedConn && (
        <TemplateBuilder
          connection={selectedConn}
          workspaceId={WORKSPACE_ID}
          onClose={() => setShowBuilder(false)}
          onSuccess={loadTemplates}
        />
      )}
    </div>
  );
}
