-- Agendamento de disparo por e-mail via N8N.
--
-- Hoje não existe: o wizard grava scheduled_at fixo em null, nenhuma função do
-- backend lê essa coluna, e o envio sai do NAVEGADOR no clique — fechar a aba
-- antes cancela. Não é defeito, é peça que nunca foi construída.
--
-- ── POR QUE UMA COLUNA NOVA, E NÃO scheduled_at ─────────────────────
--
-- Existe hoje em produção a campanha "Campanha Safra Verão 2026": status
-- 'scheduled', 490 destinatários reais, 0 enviados, scheduled_at NULO. Alguém
-- tentou agendar, o status gravou, o horário não.
--
-- Se o ticker procurasse status='scheduled', a única coisa entre 490 pessoas e
-- um e-mail indevido seria aquele nulo — e bastaria um UPDATE futuro, uma tela
-- de reagendar, ou uma correção bem-intencionada, para dispará-la.
--
-- Segurança apoiada num valor nulo não é segurança. Por isso o agendamento
-- novo vive em `agendado_para`, e o ticker exige TAMBÉM o status 'agendada',
-- que não existia antes. As 75 campanhas atuais são inelegíveis por ESTRUTURA:
-- não há valor que possa ser corrigido sozinho para torná-las elegíveis.
--
-- scheduled_at continua onde está, sem leitor, como sempre esteve.

ALTER TABLE shooting_campaigns
  ADD COLUMN IF NOT EXISTS agendado_para timestamptz;

COMMENT ON COLUMN shooting_campaigns.agendado_para IS
  'Quando o disparo deve sair. Preenchida SO pelo fluxo novo de agendamento. O ticker exige esta coluna e o status agendada; scheduled_at (legado) nao e lida por ninguem.';

-- Índice parcial: o ticker roda a cada minuto e só se importa com o que está
-- vencido. Varrer 75 campanhas hoje é barato, varrer dezenas de milhares
-- daqui a um ano, todo minuto, não é.
CREATE INDEX IF NOT EXISTS idx_campanhas_agendadas
  ON shooting_campaigns (agendado_para)
  WHERE status = 'agendada' AND agendado_para IS NOT NULL;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_elegiveis integer;
  v_safra     integer;
BEGIN
  -- A asseveração que importa: NENHUMA campanha existente pode ser pega pelo
  -- ticker. Se esta falhar, a migration não entra.
  SELECT count(*) INTO v_elegiveis
    FROM shooting_campaigns
   WHERE status = 'agendada' AND agendado_para IS NOT NULL;
  IF v_elegiveis <> 0 THEN
    RAISE EXCEPTION 'PERIGO: % campanha(s) existente(s) ja seriam disparadas pelo ticker', v_elegiveis;
  END IF;

  -- E a campanha de 490 pessoas continua fora, com nome e sobrenome.
  SELECT count(*) INTO v_safra
    FROM shooting_campaigns
   WHERE status = 'scheduled' AND agendado_para IS NULL;
  RAISE LOG 'disparo agendado: % campanha(s) no estado legado seguem inelegiveis', v_safra;

  RAISE LOG 'disparo agendado: coluna e indice criados, 0 campanhas elegiveis';
END $$;
