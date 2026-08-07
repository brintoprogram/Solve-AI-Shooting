-- View de contatos com o saldo em aberto agregado.
--
-- Problema: a lista de contatos é paginada no servidor (range de 25 em 25 sobre
-- inbox_contacts), mas o saldo vive em contact_invoices e era buscado numa
-- segunda consulta, só para a página atual. Isso torna impossível ordenar por
-- saldo ou por vencimento: ordenar 25 linhas já paginadas não ordena a base —
-- daria a "página 1 ordenada por saldo", não "os 25 que mais devem".
--
-- Num produto de cobrança essas são as duas ordenações que a operação mais
-- quer ("quem deve mais", "quem está mais atrasado") e nenhuma existia. Só a
-- ordenação por nome existia, que é a menos útil das três.
--
-- Com a view o PostgREST ordena e pagina no banco, usando .order() e .range()
-- normalmente, sem RPC nova. De quebra o saldo vem junto da linha e elimina a
-- segunda consulta por página.

CREATE OR REPLACE VIEW inbox_contacts_com_saldo
WITH (security_invoker = true)   -- aplica a RLS de inbox_contacts a quem consulta;
                                 -- sem isto a view rodaria como dona e vazaria
                                 -- contato entre workspaces.
AS
SELECT c.*,
       -- coalesce para 0: contato sem boleto tem que ordenar como zero, não
       -- como nulo (nulo vai para uma ponta e polui as duas ordenações).
       coalesce(s.saldo_em_aberto, 0) AS saldo_em_aberto,
       s.proximo_vencimento
  FROM inbox_contacts c
  LEFT JOIN (
    SELECT contact_id,
           sum(valor)      AS saldo_em_aberto,
           min(vencimento) AS proximo_vencimento
      FROM contact_invoices
     WHERE status = ANY (invoice_status_em_aberto())
     GROUP BY contact_id
  ) s ON s.contact_id = c.id;

-- A view é lida pelo app com a sessão do usuário.
GRANT SELECT ON inbox_contacts_com_saldo TO authenticated;

-- Sustenta o agregado da subconsulta.
CREATE INDEX IF NOT EXISTS idx_contact_invoices_contact_status
  ON contact_invoices (contact_id, status)
  INCLUDE (valor, vencimento);
