-- Boletos: impedir duplicata na reimportação, e somar no banco.
--
-- ── Problema 1: reimportar a mesma planilha dobrava a dívida ──────────
-- A importação usava INSERT puro e não havia nenhuma constraint. Subir a
-- mesma planilha duas vezes recriava todos os boletos. Num produto de
-- cobrança isso é grave: a dívida do cliente dobra e o agente de IA passa a
-- negociar em cima de um valor que não existe.
--
-- A chave natural escolhida é conservadora de propósito:
--
--   codigo_barras           — a linha digitável de um boleto é única no país.
--                             Duas linhas com o mesmo código SÃO o mesmo
--                             boleto, por definição.
--   (contact_id, numero_nf) — número da nota é único por emitente.
--
-- Ambas são índices PARCIAIS (WHERE ... IS NOT NULL). Boleto sem código e
-- sem NF fica de fora: preferimos deixar passar uma duplicata a recusar um
-- boleto legítimo. Não dá para usar (contact_id, vencimento, valor) como
-- chave — parcelas iguais no mesmo dia existem de verdade, e a constraint
-- rejeitaria dado correto.
--
-- ── Problema 2: "Total geral em aberto" somava tudo ───────────────────
-- A tela dizia "em aberto" mas a soma não filtrava status: incluía `pago` e
-- `cancelado`. Quanto mais o cliente quitava, mais errado ficava o número.
-- Pior, a soma era feita no navegador, baixando todas as linhas — o que além
-- de caro fica silenciosamente errado se a resposta for truncada.
--
-- As funções no fim deste arquivo somam no banco e devolvem um número.

-- ═════════════════════════════════════════════════════════════════════
-- 1. Guardar o que for removido
-- ═════════════════════════════════════════════════════════════════════
-- Apagar linha de dívida sem deixar rastro não é aceitável, mesmo quando a
-- linha é comprovadamente duplicada. Tudo que sair vai para cá primeiro.

-- Estrutura derivada da tabela de origem: garante que os tipos batem, sem
-- depender de suposicao sobre uuid vs text (o tipo de workspace_id nao e
-- uniforme neste schema — ver 20260428_rls_security.sql).
CREATE TABLE IF NOT EXISTS contact_invoices_dedup_backup AS
  SELECT ci.*,
         now()::timestamptz AS removido_em,
         ''::text           AS motivo
    FROM contact_invoices ci
   WHERE false;

ALTER TABLE contact_invoices_dedup_backup ENABLE ROW LEVEL SECURITY;
-- Sem policy: só a service role enxerga. É material de auditoria, não de tela.

-- ═════════════════════════════════════════════════════════════════════
-- 2. Remover duplicatas existentes
-- ═════════════════════════════════════════════════════════════════════
-- Mantém sempre a linha MAIS ANTIGA (a primeira importação) e remove as
-- cópias posteriores. created_at desempata; id resolve o empate de created_at.

DO $$
DECLARE
  v_barras int := 0;
  v_nf     int := 0;
BEGIN
  -- ── por código de barras ──
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY workspace_id, codigo_barras
             ORDER BY created_at, id
           ) AS rn
      FROM contact_invoices
     WHERE codigo_barras IS NOT NULL
       AND btrim(codigo_barras) <> ''
  ),
  sobrando AS (SELECT id FROM ranked WHERE rn > 1),
  salvos AS (
    INSERT INTO contact_invoices_dedup_backup
    SELECT ci.*, now(), 'codigo_barras duplicado'
      FROM contact_invoices ci
      JOIN sobrando s ON s.id = ci.id
    RETURNING 1
  )
  SELECT count(*) INTO v_barras FROM salvos;

  DELETE FROM contact_invoices ci
   USING contact_invoices_dedup_backup b
   WHERE b.id = ci.id
     AND b.motivo = 'codigo_barras duplicado';

  -- ── por (contato, número da NF) ──
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY workspace_id, contact_id, numero_nf
             ORDER BY created_at, id
           ) AS rn
      FROM contact_invoices
     WHERE numero_nf IS NOT NULL
       AND btrim(numero_nf) <> ''
  ),
  sobrando AS (SELECT id FROM ranked WHERE rn > 1),
  salvos AS (
    INSERT INTO contact_invoices_dedup_backup
    SELECT ci.*, now(), 'numero_nf duplicado'
      FROM contact_invoices ci
      JOIN sobrando s ON s.id = ci.id
    RETURNING 1
  )
  SELECT count(*) INTO v_nf FROM salvos;

  DELETE FROM contact_invoices ci
   USING contact_invoices_dedup_backup b
   WHERE b.id = ci.id
     AND b.motivo = 'numero_nf duplicado';

  RAISE LOG 'dedup contact_invoices: codigo_barras=% numero_nf=%', v_barras, v_nf;
END $$;

-- ═════════════════════════════════════════════════════════════════════
-- 3. Impedir que volte a acontecer
-- ═════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_invoices_codigo_barras
  ON contact_invoices (workspace_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL AND btrim(codigo_barras) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_invoices_numero_nf
  ON contact_invoices (workspace_id, contact_id, numero_nf)
  WHERE numero_nf IS NOT NULL AND btrim(numero_nf) <> '';

-- ═════════════════════════════════════════════════════════════════════
-- 4. Somar no banco
-- ═════════════════════════════════════════════════════════════════════
-- Uma única definição de "em aberto", usada por todo mundo. Antes cada tela
-- tinha a sua: a lista somava todo status, a variável de campanha filtrava
-- só os pendentes, e o mesmo contato aparecia com dois valores diferentes.

CREATE OR REPLACE FUNCTION invoice_status_em_aberto()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['pendente', 'vencido', 'aberto', 'em_aberto'];
$$;

-- Total do workspace. Devolve um número, não a tabela inteira.
CREATE OR REPLACE FUNCTION invoice_total_workspace(
  p_workspace_id text,
  p_venc_from    date DEFAULT NULL,
  p_venc_to      date DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER            -- respeita a RLS de quem chamou; sem vazamento entre tenants
SET search_path = public
AS $$
  SELECT coalesce(sum(valor), 0)
    FROM contact_invoices
   WHERE workspace_id::text = p_workspace_id::text
     AND status = ANY (invoice_status_em_aberto())
     AND (p_venc_from IS NULL OR vencimento >= p_venc_from)
     AND (p_venc_to   IS NULL OR vencimento <= p_venc_to);
$$;

-- Mesma soma, restrita a um conjunto de contatos (busca/filtro na tela).
CREATE OR REPLACE FUNCTION invoice_total_contatos(
  p_workspace_id text,
  p_contact_ids  text[],
  p_venc_from    date DEFAULT NULL,
  p_venc_to      date DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(sum(valor), 0)
    FROM contact_invoices
   WHERE workspace_id::text = p_workspace_id::text
     AND contact_id::text = ANY (p_contact_ids)
     AND status = ANY (invoice_status_em_aberto())
     AND (p_venc_from IS NULL OR vencimento >= p_venc_from)
     AND (p_venc_to   IS NULL OR vencimento <= p_venc_to);
$$;

-- Totais por contato, para a página atual da lista. Uma chamada em vez de
-- baixar as linhas e agrupar no navegador.
CREATE OR REPLACE FUNCTION invoice_totais_por_contato(
  p_workspace_id text,
  p_contact_ids  text[]
)
RETURNS TABLE (contact_id text, total numeric, proximo_vencimento date)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT ci.contact_id::text,
         sum(ci.valor)      AS total,
         min(ci.vencimento) AS proximo_vencimento
    FROM contact_invoices ci
   WHERE ci.workspace_id::text = p_workspace_id::text
     AND ci.contact_id::text = ANY (p_contact_ids)
     AND ci.status = ANY (invoice_status_em_aberto())
   GROUP BY ci.contact_id;
$$;

-- Índice que sustenta as três: o filtro é sempre workspace + status.
CREATE INDEX IF NOT EXISTS idx_contact_invoices_ws_status
  ON contact_invoices (workspace_id, status, contact_id)
  INCLUDE (valor, vencimento);
