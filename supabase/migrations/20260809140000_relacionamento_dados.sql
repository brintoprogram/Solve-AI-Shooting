-- Dados de relacionamento no contato + calendário de datas de profissão.
--
-- Cobrança fala com o cliente quando ELE deve algo. Relacionamento fala quando
-- é sobre ELE — aniversário, o dia da profissão dele. É a única mensagem do
-- sistema que não pede nada, e por isso a que mais constrói crédito para as
-- que pedem.

-- ── Contato ──────────────────────────────────────────────────────────
ALTER TABLE inbox_contacts ADD COLUMN IF NOT EXISTS data_nascimento date;
ALTER TABLE inbox_contacts ADD COLUMN IF NOT EXISTS profissao       text;
-- Bônus: "faz 1 ano que você é nosso cliente" usa o mesmo motor e não custa
-- coluna nova depois.
ALTER TABLE inbox_contacts ADD COLUMN IF NOT EXISTS cliente_desde   date;

COMMENT ON COLUMN inbox_contacts.data_nascimento IS 'Aniversário. Só dia e mês são usados no disparo; o ano serve para idade.';
COMMENT ON COLUMN inbox_contacts.profissao       IS 'Profissão como veio na importação. O casamento com datas_profissao é normalizado.';
COMMENT ON COLUMN inbox_contacts.cliente_desde   IS 'Quando virou cliente. Base do aniversário de relacionamento.';

-- Data de nascimento no futuro é erro de digitação ou de formato na planilha
-- (dd/mm lido como mm/dd). Barrar na entrada evita disparo para data impossível.
ALTER TABLE inbox_contacts DROP CONSTRAINT IF EXISTS inbox_contacts_nascimento_passado;
ALTER TABLE inbox_contacts ADD CONSTRAINT inbox_contacts_nascimento_passado
  CHECK (data_nascimento IS NULL OR data_nascimento <= current_date);

-- ── Normalização para casar profissão ────────────────────────────────
-- "Administrador", "administrador" e "ADMINISTRAÇÃO" têm que casar. Sem isto,
-- a regra funcionaria para quem digitou igual ao seed e falharia em silêncio
-- para todo o resto — o pior tipo de falha, porque parece configurado.
CREATE OR REPLACE FUNCTION normaliza_texto(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(trim(regexp_replace(
    translate(coalesce(p, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
    '[^a-zA-Z0-9 ]', '', 'g')));
$$;

-- ── Calendário de datas de profissão ─────────────────────────────────
CREATE TABLE IF NOT EXISTS datas_profissao (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = data global, válida para todos os workspaces (o seed).
  -- Preenchido = data que um cliente criou ou corrigiu para si.
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  rotulo       text    NOT NULL,
  chave        text    NOT NULL,
  dia          integer NOT NULL CHECK (dia BETWEEN 1 AND 31),
  mes          integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  apelidos     text[]  NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Uma chave por escopo: o workspace pode sobrescrever a data global sem
-- conflitar com ela.
CREATE UNIQUE INDEX IF NOT EXISTS datas_profissao_global
  ON datas_profissao (chave) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS datas_profissao_por_ws
  ON datas_profissao (workspace_id, chave) WHERE workspace_id IS NOT NULL;

ALTER TABLE datas_profissao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS datas_profissao_leitura ON datas_profissao;
CREATE POLICY datas_profissao_leitura ON datas_profissao
  FOR SELECT USING (workspace_id IS NULL OR is_workspace_member(workspace_id));

DROP POLICY IF EXISTS datas_profissao_escrita ON datas_profissao;
CREATE POLICY datas_profissao_escrita ON datas_profissao
  FOR ALL USING (workspace_id IS NOT NULL AND is_workspace_member(workspace_id))
          WITH CHECK (workspace_id IS NOT NULL AND is_workspace_member(workspace_id));

-- ── Seed ─────────────────────────────────────────────────────────────
-- ATENÇÃO: datas comemorativas de profissão variam por fonte, conselho de
-- classe e às vezes por estado. Este seed é ponto de partida, não autoridade —
-- por isso a tabela é editável por workspace. Confira as das profissões que
-- realmente existem na sua base antes de ligar a regra.
INSERT INTO datas_profissao (rotulo, chave, dia, mes, apelidos) VALUES
  ('Dia do Administrador',        'administrador',      9,  9,  ARRAY['administracao','adm','administradora']),
  ('Dia do Advogado',             'advogado',           11, 8,  ARRAY['advocacia','advogada','direito']),
  ('Dia do Arquiteto',            'arquiteto',          15, 12, ARRAY['arquitetura','arquiteta']),
  ('Dia do Assistente Social',    'assistente social',  15, 5,  ARRAY['servico social']),
  ('Dia do Biólogo',              'biologo',            3,  9,  ARRAY['biologia','biologa']),
  ('Dia do Contador',             'contador',           22, 9,  ARRAY['contabilidade','contadora','contabilista']),
  ('Dia do Corretor de Imóveis',  'corretor de imoveis',27, 8,  ARRAY['corretor','corretora']),
  ('Dia do Dentista',             'dentista',           25, 10, ARRAY['odontologia','cirurgiao dentista']),
  ('Dia do Economista',           'economista',         13, 8,  ARRAY['economia']),
  ('Dia do Enfermeiro',           'enfermeiro',         12, 5,  ARRAY['enfermagem','enfermeira']),
  ('Dia do Engenheiro',           'engenheiro',         11, 12, ARRAY['engenharia','engenheira']),
  ('Dia do Farmacêutico',         'farmaceutico',       20, 1,  ARRAY['farmacia','farmaceutica']),
  ('Dia do Fisioterapeuta',       'fisioterapeuta',     13, 10, ARRAY['fisioterapia']),
  ('Dia do Jornalista',           'jornalista',         7,  4,  ARRAY['jornalismo']),
  ('Dia do Médico',               'medico',             18, 10, ARRAY['medicina','medica','doutor']),
  ('Dia do Motorista',            'motorista',          25, 7,  ARRAY['caminhoneiro','condutor']),
  ('Dia do Nutricionista',        'nutricionista',      31, 8,  ARRAY['nutricao']),
  ('Dia do Pedagogo',             'pedagogo',           20, 5,  ARRAY['pedagogia','pedagoga']),
  ('Dia do Professor',            'professor',          15, 10, ARRAY['professora','docente','educador']),
  ('Dia do Psicólogo',            'psicologo',          27, 8,  ARRAY['psicologia','psicologa']),
  ('Dia do Publicitário',         'publicitario',       1,  2,  ARRAY['publicidade','marketing']),
  ('Dia do Veterinário',          'veterinario',        9,  9,  ARRAY['veterinaria','medico veterinario']),
  ('Dia do Vendedor',             'vendedor',           1,  10, ARRAY['vendas','vendedora','representante comercial']),
  ('Dia do Profissional de TI',   'ti',                 19, 10, ARRAY['tecnologia da informacao','analista de sistemas','desenvolvedor','programador'])
ON CONFLICT DO NOTHING;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE v_n integer; v_casou text;
BEGIN
  SELECT count(*) INTO v_n FROM datas_profissao WHERE workspace_id IS NULL;
  IF v_n < 20 THEN RAISE EXCEPTION 'seed de profissoes incompleto: %', v_n; END IF;

  -- O casamento normalizado é o coração da regra de profissão. Se "ADMINISTRAÇÃO"
  -- não casar com 'administrador', a regra dispara para ninguém e ninguém nota.
  SELECT rotulo INTO v_casou
    FROM datas_profissao
   WHERE workspace_id IS NULL
     AND (chave = normaliza_texto('ADMINISTRAÇÃO')
          OR normaliza_texto('ADMINISTRAÇÃO') = ANY(apelidos));
  IF v_casou IS NULL THEN
    RAISE EXCEPTION 'normalizacao nao casou ADMINISTRACAO com o dia do administrador';
  END IF;

  RAISE LOG 'relacionamento: colunas de contato e % datas de profissao', v_n;
END $$;
