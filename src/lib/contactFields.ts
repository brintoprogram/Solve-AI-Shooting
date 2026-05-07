export interface ContactField {
  key:   string;
  label: string;
  group: string;
}

export const ALL_CONTACT_FIELDS: ContactField[] = [
  // Dados do contato
  { key: "name",                label: "Nome",                   group: "Contato" },
  { key: "phone",               label: "Telefone",               group: "Contato" },
  { key: "empresa",             label: "Empresa",                group: "Contato" },
  { key: "email",               label: "Email",                  group: "Contato" },
  { key: "email2",              label: "Email 2",                group: "Contato" },
  { key: "cpf_cnpj",            label: "CPF / CNPJ",             group: "Contato" },
  // Representantes e gerentes
  { key: "nome_representante",  label: "Representante — Nome",   group: "Representantes" },
  { key: "email_representante", label: "Representante — Email",  group: "Representantes" },
  { key: "gerente1_nome",       label: "Gerente 1 — Nome",       group: "Representantes" },
  { key: "gerente1_email",      label: "Gerente 1 — Email",      group: "Representantes" },
  { key: "gerente2_nome",       label: "Gerente 2 — Nome",       group: "Representantes" },
  { key: "gerente2_email",      label: "Gerente 2 — Email",      group: "Representantes" },
  // Endereço
  { key: "cidade",              label: "Cidade",                 group: "Endereço" },
  { key: "estado",              label: "Estado",                 group: "Endereço" },
  { key: "bairro",              label: "Bairro",                 group: "Endereço" },
  { key: "cep",                 label: "CEP",                    group: "Endereço" },
  // Financeiro — calculado de contact_invoices em tempo de criação da campanha
  { key: "valor_total_pendente", label: "Valor Total Pendente",  group: "Financeiro" },
  { key: "proximo_vencimento",   label: "Próximo Vencimento",    group: "Financeiro" },
  { key: "boleto_nf",            label: "Número NF / Boleto",    group: "Financeiro" },
  { key: "boleto_codigo_barras", label: "Código de Barras",      group: "Financeiro" },
];

export const DEFAULT_VISIBLE_FIELDS: string[] = [
  "name", "empresa", "email",
  "nome_representante", "email_representante",
  "gerente1_nome", "gerente2_nome",
  "valor_total_pendente", "proximo_vencimento", "boleto_nf",
];
