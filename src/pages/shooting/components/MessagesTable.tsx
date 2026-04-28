import { useState } from "react";
import { Search, Download, ChevronLeft, ChevronRight, Clock, Check, CheckCheck, AlertCircle, Eye, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageTimeline } from "./MessageTimeline";
import { useCampaignMessages } from "@/hooks/useCampaignMessages";
import type { ShootingMessage, MessageStatus } from "@/types/shooting";
import { MESSAGE_STATUS_LABELS } from "@/types/shooting";
import * as XLSX from "xlsx";

interface StatusDef {
  bg: string; color: string; border: string; label: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  iconStyle?: React.CSSProperties;
}

const STATUS_STYLE: Record<MessageStatus, StatusDef> = {
  pending:      { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "rgba(107,114,128,0.2)",  label: "Na fila",        Icon: Clock,       iconStyle: {} },
  sent:         { bg: "rgba(59,130,246,0.1)",   color: "#60a5fa", border: "rgba(59,130,246,0.2)",   label: "Enviado",        Icon: Check,       iconStyle: {} },
  delivered:    { bg: "rgba(63,176,108,0.1)",   color: "#3fb06c", border: "rgba(63,176,108,0.2)",   label: "Entregue",       Icon: CheckCheck,  iconStyle: {} },
  read:         { bg: "rgba(52,211,153,0.1)",   color: "#34d399", border: "rgba(52,211,153,0.2)",   label: "Lido",           Icon: Eye,         iconStyle: {} },
  replied:      { bg: "rgba(52,211,153,0.15)",  color: "#34d399", border: "rgba(52,211,153,0.3)",   label: "Respondido",     Icon: CheckCheck,  iconStyle: {} },
  failed:       { bg: "rgba(239,68,68,0.1)",    color: "#f87171", border: "rgba(239,68,68,0.2)",    label: "Falhou",         Icon: AlertCircle, iconStyle: {} },
  undeliverable:{ bg: "rgba(239,68,68,0.08)",   color: "#f87171", border: "rgba(239,68,68,0.15)",   label: "Não entregável", Icon: AlertCircle, iconStyle: {} },
};

const STATUS_FALLBACK: StatusDef = { bg: "rgba(107,114,128,0.1)", color: "#9ca3af", border: "rgba(107,114,128,0.2)", label: "Desconhecido", Icon: AlertCircle, iconStyle: {} };

function getStatusStyle(status: string): StatusDef {
  return STATUS_STYLE[status as MessageStatus] ?? STATUS_FALLBACK;
}

interface MessagesTableProps {
  campaignId: string;
  dispatchChannel?: string;
}

export function MessagesTable({ campaignId, dispatchChannel }: MessagesTableProps) {
  const isEmail = dispatchChannel === "n8n_email";
  const [statusFilter, setStatusFilter] = useState<MessageStatus | "all">("all");
  const [detail, setDetail] = useState<ShootingMessage | null>(null);
  const [exporting, setExporting] = useState(false);

  const { messages, total, page, totalPages, loading, search, setSearch, setPage } =
    useCampaignMessages(campaignId, statusFilter === "all" ? undefined : statusFilter);

  // Auto-detect whether this campaign has financial data in recipient_data
  const hasFinancialData = messages.some((m) => {
    const d = m.recipient_data as Record<string, unknown> | null;
    return d && d._financial_campaign === true;
  });

  async function exportAllToXlsx() {
    setExporting(true);
    const { data } = await supabase
      .from("shooting_messages")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("created_at");

    const all: ShootingMessage[] = data ?? [];
    const anyFinancial = all.some((m) => {
      const d = m.recipient_data as Record<string, unknown> | null;
      return d && d._financial_campaign === true;
    });
    const rows = all.map((m) => {
      const d = m.recipient_data as Record<string, unknown> | null;
      const base: Record<string, string> = {
        "Nome": m.recipient_name ?? "",
        ...(isEmail
          ? { "Email": (d?.email as string) ?? "" }
          : { "Telefone": m.recipient_phone }),
        "Status":  MESSAGE_STATUS_LABELS[m.status],
        "Enviado": m.sent_at ? format(new Date(m.sent_at), "dd/MM/yyyy HH:mm") : "",
        ...(!isEmail && {
          "Entregue":   m.delivered_at ? format(new Date(m.delivered_at), "dd/MM/yyyy HH:mm") : "",
          "Lido":       m.read_at      ? format(new Date(m.read_at),      "dd/MM/yyyy HH:mm") : "",
          "Respondido": m.replied_at   ? format(new Date(m.replied_at),   "dd/MM/yyyy HH:mm") : "",
        }),
        "Código de erro": m.error_code ? `#${m.error_code}` : "",
        "Mensagem de erro": m.error_message ?? "",
      };
      if (anyFinancial) {
        base["Valor (boleto)"]      = d?.valor_total_pendente as string ?? "";
        base["Vencimento (filtro)"] = d?.proximo_vencimento   as string ?? "";
        base["Qtd Boletos"]         = d?._invoice_count != null ? String(d._invoice_count) : "";
        const invIds = d?._invoice_ids as string[] | undefined;
        const allInvs = d?.contact_invoices as Array<{ id: string; numero_nf: string | null }> | undefined;
        base["Nº NF(s)"] = invIds && allInvs
          ? allInvs.filter((inv) => invIds.includes(inv.id)).map((inv) => inv.numero_nf || "sem NF").join(", ") || "—"
          : (d?.boleto_nf as string | undefined) ?? "";
      }
      return base;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mensagens");
    XLSX.writeFile(wb, `campanha_${campaignId}_mensagens.xlsx`);
    setExporting(false);
  }

  function fmt(ts: string | null) {
    if (!ts) return "—";
    return format(new Date(ts), "HH:mm");
  }

  return (
    <>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-agro-muted-2" />
          <input
            className="input-agro w-full pl-9"
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="input-agro w-44"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as MessageStatus | "all")}
        >
          <option value="all">Todos os status</option>
          {(Object.keys(MESSAGE_STATUS_LABELS) as MessageStatus[]).map((s) => (
            <option key={s} value={s}>{MESSAGE_STATUS_LABELS[s]}</option>
          ))}
        </select>

        <button
          onClick={exportAllToXlsx}
          disabled={exporting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-agro-muted hover:text-agro-text transition-colors disabled:opacity-40"
          style={{ border: "1px solid rgba(63,176,108,0.15)" }}
        >
          {exporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          {exporting ? "Exportando…" : "Exportar tudo"}
        </button>
      </div>

      <p className="text-xs text-agro-muted mb-3">
        {total.toLocaleString("pt-BR")} mensagens no total
      </p>

      {/* Table */}
      <div className="rounded-xl overflow-hidden"
        style={{ border: "1px solid rgba(63,176,108,0.1)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "rgba(13,26,17,0.9)", borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
              {[
                "Destinatário",
                ...(isEmail ? ["Email"] : ["Telefone"]),
                ...(hasFinancialData ? ["Valor", "Vencimento"] : []),
                "Status", "Enviado",
                ...(!isEmail ? ["Entregue", "Lido"] : []),
                "Erro",
              ].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-agro-muted-2 uppercase tracking-widest">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(63,176,108,0.05)" }}>
                    {Array.from({ length: isEmail ? (hasFinancialData ? 7 : 5) : (hasFinancialData ? 9 : 7) }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-20" style={{ background: "rgba(63,176,108,0.06)" }} />
                      </td>
                    ))}
                  </tr>
                ))
              : messages.map((msg, i) => {
                  const s = getStatusStyle(msg.status);
                  const rd = msg.recipient_data as Record<string, unknown> | null;
                  return (
                    <tr
                      key={msg.id}
                      className="cursor-pointer transition-all duration-200 hover:bg-white/5"
                      style={{ borderBottom: i < messages.length - 1 ? "1px solid rgba(63,176,108,0.05)" : "none" }}
                      onClick={() => setDetail(msg)}
                    >
                      <td className="px-4 py-3 font-medium text-agro-text text-sm">
                        {msg.recipient_name ?? "—"}
                      </td>
                      {isEmail ? (
                        <td className="px-4 py-3 text-agro-muted font-mono text-xs">
                          <div>{rd?.email as string ?? "—"}</div>
                          {rd?.email2 && <div className="text-agro-muted-2">{rd.email2 as string}</div>}
                          {rd?.email_representante && <div className="text-agro-muted-2 text-[10px]">Rep: {rd.email_representante as string}</div>}
                          {rd?.gerente1_email && <div className="text-agro-muted-2 text-[10px]">G1: {rd.gerente1_email as string}</div>}
                          {rd?.gerente2_email && <div className="text-agro-muted-2 text-[10px]">G2: {rd.gerente2_email as string}</div>}
                        </td>
                      ) : (
                        <td className="px-4 py-3 text-agro-muted font-mono text-xs">
                          {msg.recipient_phone}
                        </td>
                      )}
                      {hasFinancialData && (
                        <>
                          <td className="px-4 py-3 text-xs font-semibold text-amber-400">
                            {rd?.valor_total_pendente as string ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-agro-muted">
                            {rd?.proximo_vencimento as string ?? "—"}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
                        >
                          <s.Icon className="w-3 h-3 shrink-0" />
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-agro-muted text-xs">
                        {msg.sent_at ? (
                          <span className="flex items-center gap-1">
                            <Check className="w-3 h-3 text-agro-muted-2" />
                            {fmt(msg.sent_at)}
                          </span>
                        ) : "—"}
                      </td>
                      {!isEmail && (
                        <td className="px-4 py-3 text-agro-muted text-xs">
                          {msg.delivered_at ? (
                            <span className="flex items-center gap-1">
                              <CheckCheck className="w-3.5 h-3.5 text-agro-muted-2" />
                              {fmt(msg.delivered_at)}
                            </span>
                          ) : "—"}
                        </td>
                      )}
                      {!isEmail && (
                        <td className="px-4 py-3 text-xs">
                          {msg.read_at ? (
                            <span className="flex items-center gap-1" style={{ color: "#34d4fb" }}>
                              <CheckCheck className="w-3.5 h-3.5 shrink-0" style={{ color: "#34d4fb" }} />
                              {fmt(msg.read_at)}
                            </span>
                          ) : "—"}
                        </td>
                      )}
                      <td className="px-4 py-3 text-xs text-red-400">
                        {msg.error_code ? `#${msg.error_code}` : "—"}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-agro-muted">Página {page + 1} de {totalPages}</p>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-text disabled:opacity-40 transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-text disabled:opacity-40 transition-colors"
              style={{ border: "1px solid rgba(63,176,108,0.15)" }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Detail sheet */}
      <Sheet open={!!detail} onOpenChange={() => setDetail(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto"
          style={{ background: "rgba(13,26,17,0.98)", borderLeft: "1px solid rgba(63,176,108,0.15)" }}
        >
          <SheetHeader>
            <SheetTitle className="text-agro-text">Detalhes da Mensagem</SheetTitle>
          </SheetHeader>
          {detail && <MessageTimeline message={detail} />}
        </SheetContent>
      </Sheet>
    </>
  );
}
