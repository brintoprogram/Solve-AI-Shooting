export interface InvoiceRaw {
  id:            string;
  valor:         number;
  vencimento:    string | null;
  status:        string;
  numero_nf:     string | null;
  codigo_barras: string | null;
}

const PENDING_STATUSES = ["pendente", "vencido", "aberto", "em_aberto"];

export function aggregateInvoices(
  contact:     Record<string, unknown> & { contact_invoices?: InvoiceRaw[] },
  filterDate?: string,
  selectedIds?: Set<string>,
): Record<string, unknown> {
  let invoices = (contact.contact_invoices ?? []).filter((inv) =>
    PENDING_STATUSES.includes((inv.status ?? "").toLowerCase())
  );

  if (filterDate) {
    invoices = invoices.filter((inv) => inv.vencimento === filterDate);
  }

  if (selectedIds && selectedIds.size > 0) {
    invoices = invoices.filter((inv) => selectedIds.has(inv.id));
  }

  if (invoices.length === 0) {
    return {
      ...contact,
      valor_total_pendente: "R$ 0,00",
      proximo_vencimento:   filterDate
        ? (() => { const [y, m, d] = filterDate.split("-"); return `${d}/${m}/${y}`; })()
        : "",
      boleto_nf:            "",
      boleto_codigo_barras: "",
    };
  }

  const sorted = [...invoices].sort((a, b) => {
    if (!a.vencimento) return 1;
    if (!b.vencimento) return -1;
    return new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime();
  });

  const total      = invoices.reduce((sum, inv) => sum + (Number(inv.valor) || 0), 0);
  const mostUrgent = sorted[0];

  const valorFormatado = total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  let vencimentoFormatado = "";
  if (mostUrgent.vencimento) {
    const [y, m, d] = mostUrgent.vencimento.split("-");
    if (y && m && d) vencimentoFormatado = `${d}/${m}/${y}`;
  }

  return {
    ...contact,
    valor_total_pendente: valorFormatado,
    proximo_vencimento:   vencimentoFormatado,
    boleto_nf:            mostUrgent.numero_nf     ?? "",
    boleto_codigo_barras: mostUrgent.codigo_barras ?? "",
  };
}
