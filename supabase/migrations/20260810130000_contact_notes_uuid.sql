-- contact_notes.workspace_id passa a ser uuid, como todas as outras.
--
-- Era a única tabela do schema com o workspace guardado como texto. Isso não é
-- só inconsistência de estilo: toda comparação com outra tabela precisa de
-- cast, e um cast esquecido não produz resultado errado — produz erro em tempo
-- de execução, no caminho de quem estava usando o sistema. Já aconteceu numa
-- migration escrita nesta base.
--
-- Pior: as próprias policies de RLS fazem (workspace_id)::uuid. Se um único
-- registro tivesse texto que não é uuid, o cast estouraria DENTRO da avaliação
-- da policy, e o efeito seria a tabela inteira falhando na leitura para todo
-- mundo. Com a coluna tipada, isso deixa de ser possível por construção em vez
-- de depender de quem escreve nela.
--
-- A tabela está vazia hoje, então a conversão não tem risco de dados. É o
-- momento mais barato que vai existir para fazer isso.

-- ── 1. As policies saem da frente ────────────────────────────────────
-- O Postgres recusa alterar o tipo de coluna citada em policy. Recriadas logo
-- abaixo com a mesma expressão, menos o cast que deixa de fazer sentido.
DROP POLICY IF EXISTS contact_notes_select      ON contact_notes;
DROP POLICY IF EXISTS contact_notes_insert      ON contact_notes;
DROP POLICY IF EXISTS contact_notes_update      ON contact_notes;
DROP POLICY IF EXISTS notes_workspace_isolation ON contact_notes;

-- ── 2. A conversão ───────────────────────────────────────────────────
ALTER TABLE contact_notes
  ALTER COLUMN workspace_id TYPE uuid USING workspace_id::uuid;

-- A tabela também não tinha chave estrangeira: uma nota podia sobreviver ao
-- fim do workspace dela, e uma nota de atendimento órfã é justamente o tipo de
-- dado que não deveria continuar existindo depois que o cliente sai.
ALTER TABLE contact_notes DROP CONSTRAINT IF EXISTS contact_notes_workspace_id_fkey;
ALTER TABLE contact_notes
  ADD CONSTRAINT contact_notes_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ── 3. As policies voltam ────────────────────────────────────────────
CREATE POLICY contact_notes_select ON contact_notes
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY contact_notes_insert ON contact_notes
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY contact_notes_update ON contact_notes
  FOR UPDATE USING (is_workspace_member(workspace_id));

CREATE POLICY notes_workspace_isolation ON contact_notes
  FOR ALL USING (workspace_id IN (SELECT get_my_workspace_ids()));

COMMENT ON COLUMN contact_notes.workspace_id IS
  'Workspace dono da nota. uuid como no resto do schema; era text ate agosto de 2026.';

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_tipo text;
  v_pol  integer;
  v_fk   integer;
  v_ws   uuid;
  v_ok   boolean;
BEGIN
  SELECT data_type INTO v_tipo FROM information_schema.columns
   WHERE table_name = 'contact_notes' AND column_name = 'workspace_id';
  IF v_tipo <> 'uuid' THEN RAISE EXCEPTION 'coluna continua %', v_tipo; END IF;

  -- As quatro policies precisam ter voltado. Uma conversão de tipo que deixa a
  -- tabela sem RLS é uma tabela aberta, e o sintoma seria vazamento silencioso
  -- entre workspaces — exatamente o que não pode acontecer.
  SELECT count(*) INTO v_pol FROM pg_policies WHERE tablename = 'contact_notes';
  IF v_pol <> 4 THEN RAISE EXCEPTION 'esperava 4 policies, achei %', v_pol; END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'contact_notes') THEN
    RAISE EXCEPTION 'RLS ficou desligada em contact_notes';
  END IF;

  SELECT count(*) INTO v_fk FROM pg_constraint
   WHERE conrelid = 'contact_notes'::regclass AND contype = 'f';
  IF v_fk < 1 THEN RAISE EXCEPTION 'a chave estrangeira nao entrou'; END IF;

  -- Prova pelo caminho real: uma nota apontando para workspace inexistente
  -- tem que ser recusada agora, e antes era aceita sem reclamar.
  v_ok := false;
  BEGIN
    INSERT INTO contact_notes (workspace_id, contact_phone, content)
    VALUES ('99999999-9999-4999-8999-999999999999', '5511999999999', 'nota orfa');
  EXCEPTION WHEN foreign_key_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    DELETE FROM contact_notes WHERE content = 'nota orfa';
    RAISE EXCEPTION 'nota orfa foi aceita: a chave estrangeira nao esta valendo';
  END IF;

  -- E uma nota legítima continua entrando.
  INSERT INTO workspaces (name, codigo) VALUES ('__teste_notas__', 'TSTNOT') RETURNING id INTO v_ws;
  INSERT INTO contact_notes (workspace_id, contact_phone, content)
  VALUES (v_ws, '5511988887777', 'nota valida');
  IF NOT EXISTS (SELECT 1 FROM contact_notes WHERE workspace_id = v_ws) THEN
    RAISE EXCEPTION 'nota legitima foi recusada';
  END IF;

  -- E morre com o workspace, que é o ponto da chave estrangeira.
  DELETE FROM workspaces WHERE id = v_ws;
  IF EXISTS (SELECT 1 FROM contact_notes WHERE workspace_id = v_ws) THEN
    RAISE EXCEPTION 'nota sobreviveu ao fim do workspace';
  END IF;

  RAISE LOG 'contact_notes: coluna uuid, 6 asseveracoes passaram';
END $$;
