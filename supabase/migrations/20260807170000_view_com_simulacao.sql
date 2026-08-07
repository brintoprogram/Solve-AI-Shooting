-- Recria inbox_contacts_com_saldo para incluir is_simulation.
--
-- Armadilha do Postgres: `SELECT c.*` numa view é resolvido no momento da
-- CRIAÇÃO, não a cada consulta. A view nasceu em 20260807120000, antes de
-- 20260807160000 adicionar is_simulation em inbox_contacts — então ela ficou
-- congelada na lista de colunas antiga e a coluna nova simplesmente não
-- existia ali.
--
-- Efeito prático: a tela de Contatos, ao filtrar `.eq("is_simulation", false)`,
-- receberia 400 do PostgREST e a lista apareceria vazia. Verificado antes de
-- escrever esta migration — a tabela respondia 200 e a view 400 para a mesma
-- coluna.
--
-- CREATE OR REPLACE VIEW não basta quando a lista de colunas muda; é preciso
-- derrubar e recriar.

DROP VIEW IF EXISTS inbox_contacts_com_saldo;

CREATE VIEW inbox_contacts_com_saldo
WITH (security_invoker = true)   -- aplica a RLS de inbox_contacts a quem consulta
AS
SELECT c.*,
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

GRANT SELECT ON inbox_contacts_com_saldo TO authenticated;
