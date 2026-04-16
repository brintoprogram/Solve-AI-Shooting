import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MoreHorizontal, Eye, Copy, Trash2, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { CampaignWithTemplate, CampaignStatus } from "@/types/shooting";
import { STATUS_LABELS } from "@/types/shooting";
import { calcPercent } from "@/lib/utils";

const STATUS_STYLE: Record<CampaignStatus, { bg: string; color: string; border: string }> = {
  draft:     { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "rgba(107,114,128,0.2)"  },
  scheduled: { bg: "rgba(59,130,246,0.1)",   color: "#60a5fa", border: "rgba(59,130,246,0.2)"   },
  sending:   { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa", border: "rgba(59,130,246,0.3)"   },
  paused:    { bg: "rgba(245,158,11,0.1)",   color: "#fbbf24", border: "rgba(245,158,11,0.2)"   },
  completed: { bg: "rgba(63,176,108,0.1)",   color: "#3fb06c", border: "rgba(63,176,108,0.2)"   },
  cancelled: { bg: "rgba(107,114,128,0.08)", color: "#6b7280", border: "rgba(107,114,128,0.15)" },
  failed:    { bg: "rgba(239,68,68,0.1)",    color: "#f87171", border: "rgba(239,68,68,0.2)"    },
};

interface CampaignListProps {
  campaigns: CampaignWithTemplate[];
  loading: boolean;
  onDelete: (id: string) => void;
}

export function CampaignList({ campaigns, loading, onDelete }: CampaignListProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = campaigns.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.meta_templates?.template_name?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl animate-pulse"
            style={{ background: "rgba(63,176,108,0.04)" }}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
        <input
          className="input-agro w-full pl-9"
          placeholder="Buscar campanha ou template..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-14">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
            style={{ background: "rgba(63,176,108,0.06)", border: "1px solid rgba(63,176,108,0.1)" }}
          >
            <Search className="w-6 h-6 text-agro-muted-2" />
          </div>
          <p className="text-agro-muted font-medium text-sm">Nenhuma campanha encontrada</p>
          <p className="text-xs text-agro-muted-2 mt-1">
            {search ? "Tente outros termos de busca" : "Crie sua primeira campanha"}
          </p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden"
          style={{ border: "1px solid rgba(63,176,108,0.1)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Campanha</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Template</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Data</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Status</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">Métricas</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const st = STATUS_STYLE[c.status];
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer transition-all duration-200 hover:bg-white/5 group"
                    style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(63,176,108,0.06)" : "none" }}
                    onClick={() => navigate(`/shooting/campaigns/${c.id}`)}
                  >
                    <td className="px-4 py-3.5 font-semibold text-agro-text text-sm group-hover:text-white transition-colors">
                      {c.name}
                    </td>
                    <td className="px-4 py-3.5 text-agro-muted text-xs">
                      {c.meta_templates?.template_name ?? "—"}
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
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3 text-xs text-agro-muted">
                        <span title="Enviadas">📤 {c.sent_count}</span>
                        <span title="Entregues">✅ {calcPercent(c.delivered_count, c.total_recipients)}%</span>
                        <span title="Lidas">👀 {calcPercent(c.read_count, c.total_recipients)}%</span>
                        {c.failed_count > 0 && (
                          <span title="Falhas" className="text-red-400">❌ {c.failed_count}</span>
                        )}
                      </div>
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
                          <DropdownMenuItem
                            className="text-agro-text focus:text-white focus:bg-white/10 rounded-lg cursor-pointer"
                            onClick={() => navigate(`/shooting/campaigns/${c.id}`)}
                          >
                            <Eye className="w-3.5 h-3.5 mr-2" />
                            Ver detalhes
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-agro-text focus:text-white focus:bg-white/10 rounded-lg cursor-pointer">
                            <Copy className="w-3.5 h-3.5 mr-2" />
                            Duplicar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator style={{ background: "rgba(63,176,108,0.1)" }} />
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
      )}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent
          style={{ background: "rgba(13,26,17,0.98)", border: "1px solid rgba(63,176,108,0.15)", borderRadius: "16px" }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-agro-text">Excluir campanha?</AlertDialogTitle>
            <AlertDialogDescription className="text-agro-muted">
              Esta ação não pode ser desfeita. Todos os dados de mensagens desta campanha serão permanentemente removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="text-agro-muted hover:text-agro-text"
              style={{ background: "transparent", border: "1px solid rgba(63,176,108,0.15)" }}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
              onClick={() => {
                if (deleteId) onDelete(deleteId);
                setDeleteId(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
