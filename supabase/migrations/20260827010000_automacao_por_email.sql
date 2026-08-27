-- Automação passa a aceitar e-mail, além de WhatsApp.
--
-- A estrutura já servia: automation_triggers tem `day_offset`, que é
-- exatamente "no dia do vencimento" (0), "três dias antes" (-3), "cinco dias
-- depois" (+5). O que faltava era o canal — a restrição só aceitava z_api e
-- meta, e o ticker só sabia falar por esses dois.
--
-- NADA do disparo de campanha por e-mail é tocado. O caminho novo reusa o
-- mesmo webhook do N8N e o mesmo formato de payload, mas por dentro da
-- automação, que tem regra própria, dedupe próprio e log próprio.
--
-- O assunto e o corpo ficam no GATILHO, e não na regra: a mensagem de "vence
-- em 3 dias" não é a mesma de "venceu há 5", e essa diferença é o motivo de
-- existir mais de um gatilho.

ALTER TABLE automation_rules DROP CONSTRAINT IF EXISTS automation_rules_channel_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_channel_check
  CHECK (channel IN ('z_api', 'meta', 'n8n_email'));

ALTER TABLE automation_triggers DROP CONSTRAINT IF EXISTS automation_triggers_channel_check;
ALTER TABLE automation_triggers ADD CONSTRAINT automation_triggers_channel_check
  CHECK (channel IN ('z_api', 'meta', 'n8n_email'));

ALTER TABLE automation_triggers
  ADD COLUMN IF NOT EXISTS email_subject   text,
  ADD COLUMN IF NOT EXISTS email_body_html text;

COMMENT ON COLUMN automation_triggers.email_subject IS
  'Assunto do e-mail deste gatilho. Aceita as mesmas variaveis do corpo.';
COMMENT ON COLUMN automation_triggers.email_body_html IS
  'Corpo do e-mail em HTML. Variaveis: {nome}, {valor}, {vencimento}, {nf}, {dias}, {status_vencimento}.';

-- ── Verificação ──────────────────────────────────────────────────────
DO $teste$
DECLARE
  v_ws   uuid;
  v_rule uuid;
  v_ok   boolean;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__autoemail__', 'AUTOEM') RETURNING id INTO v_ws;

  -- O canal novo entra.
  INSERT INTO automation_rules (workspace_id, name, status, send_hour, channel)
  VALUES (v_ws, 'Regua de vencimento', 'draft', 9, 'n8n_email') RETURNING id INTO v_rule;

  INSERT INTO automation_triggers (rule_id, workspace_id, day_offset, label, channel,
                                   email_subject, email_body_html, column_mapping, enabled)
  VALUES (v_rule, v_ws, 0, 'No dia do vencimento', 'n8n_email',
          'Seu boleto vence hoje', '<p>Ola {nome}, o boleto de {valor} vence hoje.</p>',
          '{}'::jsonb, true);

  -- Os canais antigos continuam valendo: a mudanca e aditiva.
  INSERT INTO automation_triggers (rule_id, workspace_id, day_offset, label, channel, column_mapping, enabled)
  VALUES (v_rule, v_ws, -3, 'Tres dias antes', 'z_api', '{}'::jsonb, true);

  -- E canal inventado continua sendo recusado.
  v_ok := false;
  BEGIN
    INSERT INTO automation_triggers (rule_id, workspace_id, day_offset, label, channel, column_mapping, enabled)
    VALUES (v_rule, v_ws, 1, 'Invalido', 'telegrama', '{}'::jsonb, true);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'aceitou canal invalido'; END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'automacao por e-mail: canal aceito, canais antigos preservados';
END
$teste$;
