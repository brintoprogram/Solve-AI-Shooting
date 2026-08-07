// Uma única definição de "boleto em aberto".
//
// Antes cada lugar tinha a sua e os números não batiam:
//
//   - a coluna de total na lista de contatos somava TODO status, incluindo
//     `pago` e `cancelado`
//   - o rodapé rotulado "Total geral em aberto" fazia o mesmo
//   - já `aggregateInvoices`, que gera a variável usada nas mensagens de
//     campanha, filtrava só os pendentes
//
// Resultado: o mesmo contato aparecia com R$ 5.000 na lista e recebia uma
// cobrança de R$ 3.200. Não era arredondamento — eram duas regras diferentes
// para a mesma pergunta.
//
// O espelho disto no banco é a função invoice_status_em_aberto()
// (20260807_invoice_dedup_and_totals.sql). Se mudar aqui, mude lá.

/** Status que representam dívida ainda devida. */
export const OPEN_INVOICE_STATUSES = [
  "pendente",
  "vencido",
  "aberto",
  "em_aberto",
] as const;

/** Status possíveis de um boleto (inclui os que NÃO contam como dívida). */
export const ALL_INVOICE_STATUSES = [
  ...OPEN_INVOICE_STATUSES,
  "pago",
  "cancelado",
] as const;

/** true quando o boleto ainda representa valor a receber. */
export function isOpenInvoice(status: string | null | undefined): boolean {
  return (OPEN_INVOICE_STATUSES as readonly string[])
    .includes((status ?? "").toLowerCase().trim());
}
