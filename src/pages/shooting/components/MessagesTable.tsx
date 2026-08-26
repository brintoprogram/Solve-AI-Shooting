import { useState } from "react";
import { Search, Download, ChevronLeft, ChevronRight, Clock, Check, CheckCheck, AlertCircle, Eye, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageTimeline } from "./MessageTimeline";
import { useCampaignMessages } from "@/hooks/useCampaignMessages";
import type { ShootingMessage, MessageStatus } from "@/types/shooting";
import { MESSAGE_STATUS_LABELS, asMessageStatus } from "@/types/shooting";
import * as XLSX from "xlsx";
import { montarRelatorio, nomeDoArquivo, type MensagemDoDisparo } from "@/lib/relatorioDisparo";

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

function getStatusStyle(status: MessageStatus): StatusDef {
  return STATUS_STYLE[status] ?? STATUS_FALLBACK;
}

interface MessagesTableProps {
  campaignId: string;
  /** Nome da campanha, para o relatório e para o nome do arquivo. */
  campaignName?: string;
  campaignCreatedAt?: string | null;
  dispatchChannel?: string;
  light?: boolean;
}

export function MessagesTable({ campaignId, campaignName, campaignCreatedAt, dispatchChannel, light }: MessagesTableProps) {
  const isEmail = dispatchChannel === "n8n_email";
  const [statusFilter, setStatusFilter] = useState<MessageStatus | "all">("all");
  const [detail, setDetail] = useState<ShootingMessage | null>(null);
  const [exporting, setExporting] = useState(false);

  const { messages, total, page, totalPages, loading, search, setSearch, setPage } =
    useCampaignMessages(campaignId, statusFilter === "all" ? undefined : statusFilter);

  const hasFinancialData = messages.some((m) => {
    const d = m.recipient_data as Record<string, unknown> | null;
    return d && d._financial_campaign === true;
  });

  async function exportAllToXlsx() {
    setExporting(true);
    try {
      const { data } = await supabase
        .from("shooting_messages")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at");

      const wb = montarRelatorio((data ?? []) as unknown as MensagemDoDisparo[], {
        campanhaNome: campaignName || "Campanha",
        campanhaId:   campaignId,
        criadaEm:     campaignCreatedAt ?? null,
        isEmail,
        rotuloStatus: (st) => MESSAGE_STATUS_LABELS[asMessageStatus(st)],
      });

      XLSX.writeFile(wb, nomeDoArquivo(campaignName || "Campanha", campaignId), { cellDates: true });
    } finally {
      setExporting(false);
    }
  }

  function fmt(ts: string | null) {
    if (!ts) return "—";
    return format(new Date(ts), "HH:mm");
  }

  // ── Light mode token shortcuts ────────────────────────────────
  const inputStyle = light ? {
    background: "#ffffff",
    color: "#0a1f10",
    border: "1px solid rgba(0,0,0,0.12)",
  } : undefined;

  const mutedText  = light ? "#4a7055" : undefined;
  const bodyText   = light ? "#0a1f10" : undefined;
  const tableBorder = light ? "rgba(0,0,0,0.08)" : "rgba(63,176,108,0.1)";
  const theadBg     = light ? "#f0f2f1"           : "rgba(13,26,17,0.9)";
  const theadBorder = light ? "rgba(0,0,0,0.08)"  : "rgba(63,176,108,0.1)";
  const theadColor  = light ? "#5a7a65"            : undefined;
  const rowDivider  = light ? "rgba(0,0,0,0.05)"  : "rgba(63,176,108,0.05)";
  const rowHover    = light ? "hover:bg-black/[0.025]" : "hover:bg-white/5";
  const skeletonBg  = light ? "rgba(0,0,0,0.06)"  : "rgba(63,176,108,0.06)";
  const paginBorder = light ? "rgba(0,0,0,0.1)"   : "rgba(63,176,108,0.15)";

  return (
    <>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: mutedText ?? "#6b8a75" }} />
          <input
            className="input-agro w-full pl-9"
            style={inputStyle}
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="input-agro w-44"
          style={inputStyle}
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
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
          style={{
            border: light ? "1px solid rgba(0,0,0,0.12)" : "1px solid rgba(63,176,108,0.15)",
            color: mutedText ?? "#6b8a75",
          }}
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {exporting ? "Exportando…" : "Exportar tudo"}
        </button>
      </div>

      <p className="text-xs mb-3" style={{ color: mutedText ?? "#6b8a75" }}>
        {total.toLocaleString("pt-BR")} mensagens no total
      </p>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${tableBorder}` }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: theadBg, borderBottom: `1px solid ${theadBorder}` }}>
              {[
                "Destinatário",
                ...(isEmail ? ["Email"] : ["Telefone"]),
                ...(hasFinancialData ? ["Valor", "Vencimento"] : []),
                "Status", "Enviado",
                ...(!isEmail ? ["Entregue", "Lido"] : []),
                "Erro",
              ].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: theadColor ?? "#6b8a75" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${rowDivider}` }}>
                    {Array.from({ length: isEmail ? (hasFinancialData ? 7 : 5) : (hasFinancialData ? 9 : 7) }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-20" style={{ background: skeletonBg }} />
                      </td>
                    ))}
                  </tr>
                ))
              : messages.map((msg, i) => {
                  const s = getStatusStyle(asMessageStatus(msg.status));
                  const rd = msg.recipient_data as Record<string, unknown> | null;
                  return (
                    <tr
                      key={msg.id}
                      className={`cursor-pointer transition-all duration-200 ${rowHover}`}
                      style={{ borderBottom: i < messages.length - 1 ? `1px solid ${rowDivider}` : "none" }}
                      onClick={() => setDetail(msg)}
                    >
                      <td className="px-4 py-3 font-medium text-sm" style={{ color: bodyText ?? "#c8dac0" }}>
                        {msg.recipient_name ?? "—"}
                      </td>
                      {isEmail ? (
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: mutedText ?? "#6b8a75" }}>
                          <div>{rd?.email as string ?? "—"}</div>
                          {!!rd?.email2 && <div style={{ color: mutedText ?? "#5a7a65" }}>{rd.email2 as string}</div>}
                          {!!rd?.email_representante && <div className="text-[10px]" style={{ color: mutedText ?? "#5a7a65" }}>Rep: {rd.email_representante as string}</div>}
                          {!!rd?.gerente1_email && <div className="text-[10px]" style={{ color: mutedText ?? "#5a7a65" }}>G1: {rd.gerente1_email as string}</div>}
                          {!!rd?.gerente2_email && <div className="text-[10px]" style={{ color: mutedText ?? "#5a7a65" }}>G2: {rd.gerente2_email as string}</div>}
                        </td>
                      ) : (
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: mutedText ?? "#6b8a75" }}>
                          {msg.recipient_phone}
                        </td>
                      )}
                      {hasFinancialData && (
                        <>
                          <td className="px-4 py-3 text-xs font-semibold text-amber-500">
                            {rd?.valor_total_pendente as string ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: mutedText ?? "#6b8a75" }}>
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
                      <td className="px-4 py-3 text-xs" style={{ color: mutedText ?? "#6b8a75" }}>
                        {msg.sent_at ? (
                          <span className="flex items-center gap-1">
                            <Check className="w-3 h-3" style={{ color: mutedText ?? "#6b8a75" }} />
                            {fmt(msg.sent_at)}
                          </span>
                        ) : "—"}
                      </td>
                      {!isEmail && (
                        <td className="px-4 py-3 text-xs" style={{ color: mutedText ?? "#6b8a75" }}>
                          {msg.delivered_at ? (
                            <span className="flex items-center gap-1">
                              <CheckCheck className="w-3.5 h-3.5" style={{ color: mutedText ?? "#6b8a75" }} />
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
                          ) : <span style={{ color: mutedText ?? "#6b8a75" }}>—</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 text-xs text-red-400">
                        {msg.error_code ? `#${msg.error_code}` : <span style={{ color: mutedText ?? "#6b8a75" }}>—</span>}
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
          <p className="text-xs" style={{ color: mutedText ?? "#6b8a75" }}>Página {page + 1} de {totalPages}</p>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-40 transition-colors"
              style={{ border: `1px solid ${paginBorder}`, color: mutedText ?? "#6b8a75" }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
              className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-40 transition-colors"
              style={{ border: `1px solid ${paginBorder}`, color: mutedText ?? "#6b8a75" }}
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
