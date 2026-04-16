import { useState } from "react";
import { Search, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageTimeline } from "./MessageTimeline";
import { useCampaignMessages } from "@/hooks/useCampaignMessages";
import type { ShootingMessage, MessageStatus } from "@/types/shooting";
import { MESSAGE_STATUS_LABELS } from "@/types/shooting";
import * as XLSX from "xlsx";

const STATUS_BADGE: Record<MessageStatus, { label: string; variant: string; className: string }> = {
  pending: { label: "Na fila", variant: "gray", className: "bg-gray-100 text-gray-600" },
  sent: { label: "Enviado", variant: "blue", className: "bg-blue-100 text-blue-700" },
  delivered: { label: "Entregue", variant: "green", className: "bg-green-100 text-green-700" },
  read: { label: "Lido ✓✓", variant: "green", className: "bg-green-200 text-green-800" },
  replied: { label: "Respondido 💬", variant: "green", className: "bg-green-300 text-green-900" },
  failed: { label: "Falhou", variant: "destructive", className: "bg-red-100 text-red-700" },
  undeliverable: { label: "Não entregável", variant: "destructive", className: "bg-red-200 text-red-800" },
};

interface MessagesTableProps {
  campaignId: string;
}

export function MessagesTable({ campaignId }: MessagesTableProps) {
  const [statusFilter, setStatusFilter] = useState<MessageStatus | "all">("all");
  const [detail, setDetail] = useState<ShootingMessage | null>(null);

  const { messages, total, page, totalPages, loading, search, setSearch, setPage } =
    useCampaignMessages(campaignId, statusFilter === "all" ? undefined : statusFilter);

  function exportToXlsx() {
    const rows = messages.map((m) => ({
      Nome: m.recipient_name ?? "",
      Telefone: m.recipient_phone,
      Status: MESSAGE_STATUS_LABELS[m.status],
      Enviado: m.sent_at ? format(new Date(m.sent_at), "dd/MM/yyyy HH:mm") : "",
      Entregue: m.delivered_at ? format(new Date(m.delivered_at), "dd/MM/yyyy HH:mm") : "",
      Lido: m.read_at ? format(new Date(m.read_at), "dd/MM/yyyy HH:mm") : "",
      Erro: m.error_message ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mensagens");
    XLSX.writeFile(wb, `campanha_${campaignId}_mensagens.xlsx`);
  }

  function fmt(ts: string | null) {
    if (!ts) return "—";
    return format(new Date(ts), "HH:mm");
  }

  return (
    <>
      {/* Filters bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as MessageStatus | "all")}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {(Object.keys(MESSAGE_STATUS_LABELS) as MessageStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {MESSAGE_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportToXlsx}>
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Exportar
        </Button>
      </div>

      <p className="text-xs text-gray-500 mb-3">
        {total.toLocaleString("pt-BR")} mensagens no total
      </p>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Destinatário</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Telefone</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Enviado</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Entregue</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Lido</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Erro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-24" />
                      </td>
                    ))}
                  </tr>
                ))
              : messages.map((msg) => {
                  const s = STATUS_BADGE[msg.status];
                  return (
                    <tr
                      key={msg.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setDetail(msg)}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {msg.recipient_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                        {msg.recipient_phone}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmt(msg.sent_at)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmt(msg.delivered_at)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmt(msg.read_at)}</td>
                      <td className="px-4 py-3 text-xs text-red-500">
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
          <p className="text-xs text-gray-500">
            Página {page + 1} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail sheet */}
      <Sheet open={!!detail} onOpenChange={() => setDetail(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Detalhes da Mensagem</SheetTitle>
          </SheetHeader>
          {detail && <MessageTimeline message={detail} />}
        </SheetContent>
      </Sheet>
    </>
  );
}
