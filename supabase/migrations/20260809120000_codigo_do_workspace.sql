-- Código curto por workspace.
--
-- Hoje um workspace só é identificável por UUID. Isso funciona para máquina e
-- é péssimo para gente: conferir cobrança, achar o cliente no suporte ou citar
-- num e-mail exige colar 36 caracteres que ninguém lê nem confere de olho.
--
-- O código é o nome curto do cliente — NITRO, COHAB, SOLVE. Maiúsculo por
-- definição, não por convenção: "Nitro" e "NITRO" como registros diferentes
-- seria exatamente o tipo de ambiguidade que um identificador existe para
-- eliminar.

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS codigo text;

-- ── Backfill dos que já existem ──────────────────────────────────────
-- Deriva do nome: tira acento, fica só com letra e número, corta em 12.
-- Colisão ganha sufixo numérico em vez de falhar — a migration não pode
-- depender de os nomes atuais serem convenientes.
DO $$
DECLARE
  r        record;
  v_base   text;
  v_tenta  text;
  v_n      integer;
BEGIN
  FOR r IN SELECT id, name FROM workspaces WHERE codigo IS NULL ORDER BY created_at
  LOOP
    -- translate em vez de unaccent(): a extensão pode não estar instalada, e
    -- uma migration que depende disso falha só no ambiente onde não está.
    v_base := upper(regexp_replace(
                translate(r.name,
                          'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                          'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
                '[^A-Za-z0-9]', '', 'g'));
    v_base := left(nullif(v_base, ''), 12);
    IF v_base IS NULL THEN
      v_base := 'WS' || left(replace(r.id::text, '-', ''), 6);
      v_base := upper(v_base);
    END IF;

    v_tenta := v_base;
    v_n     := 1;
    WHILE EXISTS (SELECT 1 FROM workspaces WHERE codigo = v_tenta) LOOP
      v_n     := v_n + 1;
      v_tenta := left(v_base, 11) || v_n::text;
    END LOOP;

    UPDATE workspaces SET codigo = v_tenta WHERE id = r.id;
  END LOOP;
END $$;

-- Formato: começa com letra ou número, 2 a 12 caracteres, só maiúscula,
-- número e hífen. Restringir agora é barato; restringir depois que houver
-- código fora do padrão em uso é migração de dados.
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_codigo_formato;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_codigo_formato
  CHECK (codigo ~ '^[A-Z0-9][A-Z0-9-]{1,11}$');

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_codigo_unico ON workspaces (codigo);

-- NOT NULL só depois do backfill: a coluna nasce vazia nos que já existem.
-- Com isto, workspace criado na mão sem código passa a falhar na hora — que é
-- o comportamento desejado, já que a criação agora tem tela própria.
ALTER TABLE workspaces ALTER COLUMN codigo SET NOT NULL;

COMMENT ON COLUMN workspaces.codigo IS
  'Identificador curto e legível do cliente (NITRO, COHAB). Único, maiúsculo.';

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE v_sem integer; v_dup integer;
BEGIN
  SELECT count(*) INTO v_sem FROM workspaces WHERE codigo IS NULL;
  IF v_sem > 0 THEN
    RAISE EXCEPTION 'workspace sem codigo apos backfill: %', v_sem;
  END IF;

  SELECT count(*) INTO v_dup
    FROM (SELECT codigo FROM workspaces GROUP BY codigo HAVING count(*) > 1) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'codigos duplicados: %', v_dup;
  END IF;

  RAISE LOG 'codigo do workspace: backfill e restricoes aplicados';
END $$;
