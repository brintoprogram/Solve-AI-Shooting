import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  MoreHorizontal, Trash2, Search, Play, Pause, XCircle, Loader2,
  Mail, Plus, Zap,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
const SUPABASE_ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? "";


type EmailStatus = "draft" | "sending" | "paused" | "completed" | "cancelled" | "failed";

interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  status: EmailStatus;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  email_connections?: { name: string } | null;
  _source?: "smtp" | "n8n";
}

const STATUS_STYLE: Record<EmailStatus, { bg: string; color: string; border: string }> = {
  draft:     { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "rgba(107,114,128,0.2)"  },
  sending:   { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa", border: "rgba(59,130,246,0.3)"   },
  paused:    { bg: "rgba(245,158,11,0.1)",   color: "#fbbf24", border: "rgba(245,158,11,0.2)"   },
  completed: { bg: "rgba(63,176,108,0.1)",   color: "#3fb06c", border: "rgba(63,176,108,0.2)"   },
  cancelled: { bg: "rgba(107,114,128,0.08)", color: "#6b7280", border: "rgba(107,114,128,0.15)" },
  failed:    { bg: "rgba(239,68,68,0.1)",    color: "#f87171", border: "rgba(239,68,68,0.2)"    },
};

const STATUS_LABELS: Record<EmailStatus, string> = {
  draft:     "Rascunho",
  sending:   "Enviando",
  paused:    "Pausado",
  completed: "Concluído",
  cancelled: "Cancelado",
  failed:    "Falhou",
};

interface EmailCampaignListProps {
  onNew: () => void;
}

export function EmailCampaignList({ onNew }: EmailCampaignListProps) {
  const { toast } = useToast();
  const { workspaceId } = useAuth();
  const WORKSPACE_ID = workspaceId ?? "";
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [deleteId,  setDeleteId]  = useState<string | null>(null);
  const [actionId,  setActionId]  = useState<string | null>(null);
  const [tab,       setTab]       = useState<"active" | "draft" | "history">("active");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [smtpRes, n8nRes] = await Promise.all([
      supabase
        .from("email_campaigns")
        .select("id,name,subject,status,total_recipients,sent_count,failed_count,created_at,email_connections(name)")
        .eq("workspace_id", WORKSPACE_ID)
        .order("created_at", { ascending: false }),
      supabase
        .from("shooting_campaigns")
        .select("id,name,status,total_recipients,sent_count,failed_count,created_at,dispatch_channel")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("dispatch_channel", "n8n_email")
        .order("created_at", { ascending: false }),
    ]);

    const smtpCampaigns: EmailCampaign[] = (smtpRes.data ?? []).map((c) => ({
      ...(c as unknown as EmailCampaign),
      _source: "smtp" as const,
    }));

    const n8nCampaigns: EmailCampaign[] = (n8nRes.data ?? []).map((c) => ({
      id:               c.id,
      name:             c.name,
      subject:          "—",
      status:           c.status as EmailStatus,
      total_recipients: c.total_recipients ?? 0,
      sent_count:       c.sent_count ?? 0,
      failed_count:     c.failed_count ?? 0,
      created_at:       c.created_at,
      email_connections: null,
      _source:          "n8n" as const,
    }));

    const merged = [...smtpCampaigns, ...n8nCampaigns].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setCampaigns(merged);
    setLoading(false);
  }

  async function handleAction(id: string, action: "start" | "pause" | "resume" | "cancel") {
    setActionId(id);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token ?? "";

      const res  = await fetch(`${SUPABASE_URL}/functions/v1/email-engine`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
          "apikey":        SUPABASE_ANON,
        },
        body: JSON.stringify({ action, campaign_id: id }),
      });

      let data: { ok?: boolean; error?: string; info?: string; processed?: number } = {};
      try { data = await res.json(); } catch { /* empty body */ }

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Erro HTTP ${res.status}`);
      }

      const OK: Record<string, string> = {
        start:  "Disparo iniciado!",
        pause:  "Pausado.",
        resume: "Retomado!",
        cancel: "Cancelado.",
      };
      toast({ title: OK[action], variant: "success" });
      await load();
    } catch (err) {
      toast({
        title:       "Erro no disparo",
        description: err instanceof Error ? err.message : "Erro desconhecido. Tente novamente.",
        variant:     "destructive",
      });
      await load(); // reload to show updated status (e.g. "failed")
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete(id: string) {
    const campaign = campaigns.find((c) => c.id === id);
    if (campaign?._source === "n8n") {
      await supabase.from("shooting_campaigns").delete().eq("id", id);
    } else {
      await supabase.from("email_campaigns").delete().eq("id", id);
    }
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
    toast({ title: "Campanha excluída" });
  }

  const active  = campaigns.filter((c) => c.status === "sending" || c.status === "paused");
  const drafts  = campaigns.filter((c) => c.status === "draft");
  const history = campaigns.filter((c) => ["completed","cancelled","failed"].includes(c.status));

  const tabData: Record<string, EmailCampaign[]> = { active, draft: drafts, history };

  const filtered = (tabData[tab] ?? []).filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c._source !== "n8n" && c.subject.toLowerCase().includes(search.toLowerCase()))
  );

  const TABS = [
    { id: "active",  label: "Em andamento", count: active.length  },
    { id: "draft",   label: "Rascunhos",     count: drafts.length  },
    { id: "history", label: "Histórico",     count: history.length },
  ];

  return (
    <>
      {/* Tab bar */}
      <div className="flex gap-1 mb-5 p-1 rounded-xl"
        style={{ background: "rgba(13,26,17,0.6)", border: "1px solid rgba(63,176,108,0.1)" }}
      >
        {TABS.map((t) => {
          const isActive = t.id === tab;
          return (
            <button key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200",
                isActive ? "text-white" : "text-agro-muted hover:text-agro-text",
              )}
              style={isActive ? {
                background: "linear-gradient(135deg, rgba(63,176,108,0.2), rgba(22,163,74,0.1))",
                border: "1px solid rgba(63,176,108,0.3)",
              } : undefined}
            >
              {t.label}
              {t.count > 0 && (
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={isActive
                    ? { background: "#3fb06c", color: "#fff" }
                    : { background: "rgba(63,176,108,0.15)", color: "#3fb06c" }}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse"
              style={{ background: "rgba(63,176,108,0.04)" }}
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <Zap className="w-7 h-7 text-agro-muted-2" />
          </div>
          <p className="text-agro-muted font-medium">Nenhum disparo de email em {TABS.find((t) => t.id === tab)?.label.toLowerCase()}</p>
          <p className="text-sm text-agro-muted-2 mt-1">Crie uma nova campanha de email para começar</p>
          {tab === "active" && (
            <button onClick={onNew}
              className="btn-agro mt-5 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            >
              <Plus className="w-4 h-4" />
              Nova Campanha de Email
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
            <input
              className="input-agro w-full pl-9"
              placeholder="Buscar por nome ou assunto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(63,176,108,0.1)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Campanha</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Assunto</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Data</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Status</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Métricas</th>
                  <th className="px-4 py-3 w-28 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Ação</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => {
                  const st = STATUS_STYLE[c.status] ?? STATUS_STYLE.draft;
                  const isN8N = c._source === "n8n";
                  return (
                    <tr key={c.id}
                      className="transition-all duration-200 hover:bg-white/5 group cursor-pointer"
                      style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none" }}
                      onClick={() => isN8N ? (window.location.href = `/shooting/campaigns/${c.id}`) : undefined}
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-agro-text text-sm group-hover:text-white transition-colors">{c.name}</p>
                          {isN8N && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                              style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)" }}
                            >
                              N8N
                            </span>
                          )}
                        </div>
                        {c.email_connections?.name && (
                          <p className="text-[11px] text-agro-muted-2 mt-0.5 flex items-center gap-1">
                            <Mail className="w-3 h-3" />{c.email_connections.name}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-agro-muted text-xs max-w-[180px] truncate">
                        {isN8N ? <span className="text-agro-muted-2 italic">via N8N</span> : c.subject}
                      </td>
                      <td className="px-4 py-3.5 text-agro-muted text-xs">
                        {format(new Date(c.created_at), "dd/MM/yyyy", { locale: ptBR })}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                          style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}
                        >
                          {c.status === "sending" && (
                            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                          )}
                          {STATUS_LABELS[c.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-agro-muted">
                        <span title="Enviados">📤 {c.sent_count}</span>
                        {" · "}
                        <span title="Total">{c.total_recipients} total</span>
                        {c.failed_count > 0 && (
                          <span title="Falhas" className="text-red-400 ml-2">❌ {c.failed_count}</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                        {!isN8N && c.status === "draft" && (
                          <button disabled={actionId === c.id}
                            onClick={() => handleAction(c.id, "start")}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
                            style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
                          >
                            {actionId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                            Iniciar
                          </button>
                        )}
                        {!isN8N && c.status === "sending" && (
                          <button disabled={actionId === c.id}
                            onClick={() => handleAction(c.id, "pause")}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                            style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", color: "#fbbf24" }}
                          >
                            {actionId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pause className="w-3 h-3" />}
                            Pausar
                          </button>
                        )}
                        {!isN8N && c.status === "paused" && (
                          <button disabled={actionId === c.id}
                            onClick={() => handleAction(c.id, "resume")}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
                            style={{ background: "linear-gradient(135deg, #3fb06c, #16A34A)" }}
                          >
                            {actionId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                            Retomar
                          </button>
                        )}
                        {isN8N && (
                          <a href={`/shooting/campaigns/${c.id}`}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-agro-muted hover:text-agro-text transition-all"
                            style={{ border: "1px solid rgba(63,176,108,0.15)" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Ver detalhes
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="w-7 h-7 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-text transition-colors hover:bg-white/10">
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end"
                            style={{ background: "rgba(13,26,17,0.98)", border: "1px solid rgba(63,176,108,0.15)", borderRadius: "12px" }}
                          >
                            {["sending","paused"].includes(c.status) && (
                              <>
                                <DropdownMenuItem
                                  className="text-amber-400 focus:text-amber-400 focus:bg-amber-400/10 rounded-lg cursor-pointer"
                                  onClick={() => handleAction(c.id, "cancel")}
                                >
                                  <XCircle className="w-3.5 h-3.5 mr-2" />
                                  Cancelar disparo
                                </DropdownMenuItem>
                                <DropdownMenuSeparator style={{ background: "rgba(63,176,108,0.1)" }} />
                              </>
                            )}
                            <DropdownMenuItem
                              className="text-red-400 focus:text-red-400 focus:bg-red-400/10 rounded-lg cursor-pointer"
                              onClick={() => setDeleteId(c.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent
          style={{ background: "rgba(13,26,17,0.98)", border: "1px solid rgba(63,176,108,0.15)", borderRadius: "16px" }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-agro-text">Excluir campanha de email?</AlertDialogTitle>
            <AlertDialogDescription className="text-agro-muted">
              Esta ação não pode ser desfeita. Todas as mensagens desta campanha serão removidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-agro-muted hover:text-agro-text"
              style={{ background: "transparent", border: "1px solid rgba(63,176,108,0.15)" }}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
              onClick={() => { if (deleteId) handleDelete(deleteId); setDeleteId(null); }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
