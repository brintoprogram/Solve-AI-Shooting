-- Telefone passa a ser guardado sempre com o 55.
--
-- O sistema identifica contato por workspace_id + phone, comparando o texto
-- como ele está gravado. E ele estava gravado de qualquer jeito: 147 contatos
-- sem o 55, 58 com, 13 em outros formatos, só na NITRO. Resultado: o MESMO
-- cliente vira dois cadastros conforme a planilha do mês, e a dívida dele fica
-- partida entre os dois. A cobrança vê metade, a IA negocia sobre metade.
--
-- O comentário de cleanPhone dizia "garante que números brasileiros sem DDI
-- ficam com 55". O código nunca fez isso — só removia pontuação. O comentário
-- descrevia a intenção, e a intenção não chega ao banco.
--
-- ── O QUE ESTA MIGRATION NÃO FAZ ────────────────────────────────────
-- Não funde os 7 contatos que já estão duplicados. Fundir exige mover
-- conversas, mensagens, boletos e negociações para o sobrevivente, e as
-- chaves de conversas e mensagens são ON DELETE NO ACTION — elas seguram o
-- contato de propósito, para histórico de atendimento não sumir por acidente.
-- Isso merece passo próprio, com relatório antes. Aqui eles ficam como estão:
-- normalizar um dos lados criaria colisão com o outro.

DO $$
DECLARE
  v_antes      integer;
  v_ajustados  integer;
  v_colisoes   integer;
  v_restantes  integer;
BEGIN
  SELECT count(*) INTO v_antes FROM inbox_contacts WHERE phone IS NOT NULL AND phone <> '';

  -- Normalizáveis: 10 ou 11 dígitos (nacional) ou 12/13 começando com 55.
  -- O resto fica intocado — número quebrado não vira número bom por palpite.
  CREATE TEMP TABLE _norm ON COMMIT DROP AS
  SELECT
    id,
    workspace_id,
    phone AS antigo,
    CASE
      WHEN regexp_replace(phone, '[^0-9]', '', 'g') ~ '^55'
       AND length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 12 AND 13
        THEN regexp_replace(phone, '[^0-9]', '', 'g')
      WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 10 AND 11
        THEN '55' || regexp_replace(phone, '[^0-9]', '', 'g')
    END AS novo
  FROM inbox_contacts
  WHERE phone IS NOT NULL AND phone <> '';

  DELETE FROM _norm WHERE novo IS NULL;

  -- Grupos onde dois cadastros virariam o mesmo número: ficam de fora.
  CREATE TEMP TABLE _colide ON COMMIT DROP AS
  SELECT workspace_id, novo FROM _norm GROUP BY 1, 2 HAVING count(*) > 1;

  SELECT count(*) INTO v_colisoes FROM _colide;

  UPDATE inbox_contacts c
     SET phone = n.novo
    FROM _norm n
   WHERE c.id = n.id
     AND c.phone <> n.novo
     AND NOT EXISTS (SELECT 1 FROM _colide x
                      WHERE x.workspace_id = n.workspace_id AND x.novo = n.novo);
  GET DIAGNOSTICS v_ajustados = ROW_COUNT;

  -- ── Verificação ──────────────────────────────────────────────────
  -- Nenhum contato pode ter sumido: isto é normalização de formato, não
  -- limpeza de base.
  IF (SELECT count(*) FROM inbox_contacts WHERE phone IS NOT NULL AND phone <> '') <> v_antes THEN
    RAISE EXCEPTION 'contatos com telefone mudaram de quantidade';
  END IF;

  -- Fora dos grupos que colidem, ninguém pode ter ficado sem o 55.
  SELECT count(*) INTO v_restantes
    FROM _norm n
    JOIN inbox_contacts c ON c.id = n.id
   WHERE c.phone <> n.novo
     AND NOT EXISTS (SELECT 1 FROM _colide x
                      WHERE x.workspace_id = n.workspace_id AND x.novo = n.novo);
  IF v_restantes > 0 THEN
    RAISE EXCEPTION '% contato(s) normalizavel(is) ficaram fora do padrao', v_restantes;
  END IF;

  RAISE LOG 'telefone normalizado: % ajustados, % grupos duplicados preservados para fusao manual',
            v_ajustados, v_colisoes;
END $$;

COMMENT ON COLUMN inbox_contacts.phone IS
  'Telefone com codigo do pais e so digitos (5518997254812). E a chave de identidade do contato dentro do workspace, entao o formato precisa ser unico.';
