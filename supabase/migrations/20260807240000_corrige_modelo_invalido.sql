-- Corrige agentes salvos com um modelo que não existe.
--
-- A lista da tela oferecia "claude-sonnet-4-6", que não é um identificador
-- válido da Anthropic. Quem selecionasse ficava com o agente falhando na
-- chamada — e o sintoma era mudo: a IA simplesmente não respondia, sem nada
-- na tela dizendo por quê.
--
-- Migra para o Sonnet atual, que é o que a opção pretendia oferecer.

DO $$
DECLARE v_n integer;
BEGIN
  UPDATE ai_agents
     SET model = 'claude-sonnet-5'
   WHERE model = 'claude-sonnet-4-6';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Qualquer outro identificador fora do catálogo cai no econômico: um agente
  -- que não responde é pior que um agente respondendo com o modelo simples.
  UPDATE ai_agents
     SET model = 'claude-haiku-4-5-20251001'
   WHERE model IS NULL
      OR model NOT IN ('claude-haiku-4-5-20251001', 'claude-sonnet-5',
                       'claude-opus-5', 'gpt-4o-mini');

  RAISE LOG 'modelos corrigidos: sonnet-4-6 -> sonnet-5 em % agente(s)', v_n;
END $$;
