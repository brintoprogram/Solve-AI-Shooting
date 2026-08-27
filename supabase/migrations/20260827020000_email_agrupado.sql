-- Um e-mail por cliente, e não um por boleto.
--
-- A régua dispara por vencimento. Se o cliente tem três boletos vencendo no
-- mesmo dia, o gatilho "no dia do vencimento" achava três linhas em
-- automation_recipients e mandava três e-mails idênticos no mesmo minuto —
-- mesmo assunto, mesmo corpo, mudando só o valor. Do lado de quem recebe isso
-- não é cobrança, é spam, e é exatamente o que a campanha por e-mail NÃO faz:
-- lá os boletos do contato entram todos no mesmo e-mail, num bloco só.
--
-- Agora o ticker agrupa por contato antes de enviar. Isso cria uma pergunta
-- que o log não sabia responder: "saíram 3 linhas 'sent' — foram 3 e-mails ou
-- 1?". As duas colunas abaixo existem para essa pergunta ter resposta.
--
-- Nada muda para WhatsApp. Z-API e META continuam uma mensagem por boleto,
-- porque lá é assim que o template funciona.

ALTER TABLE automation_logs
  ADD COLUMN IF NOT EXISTS destino  text,
  ADD COLUMN IF NOT EXISTS email_id uuid;

COMMENT ON COLUMN automation_logs.destino IS
  'Endereco realmente usado no envio. Para e-mail e o endereco: contact_phone nao servia, e antes disto o e-mail nao ficava registrado em lugar nenhum.';
COMMENT ON COLUMN automation_logs.email_id IS
  'Identificador do e-mail FISICO. Boletos que sairam no mesmo e-mail compartilham este valor. NULL = mensagem individual (todo o WhatsApp). Mensagens enviadas = count(DISTINCT coalesce(email_id, id)); boletos comunicados = count(*).';

CREATE INDEX IF NOT EXISTS idx_automation_logs_email
  ON automation_logs (email_id) WHERE email_id IS NOT NULL;

-- ── Verificação ──────────────────────────────────────────────────────
-- O que precisa ser verdade: as duas contagens têm que dar números
-- diferentes e ambos certos a partir das mesmas linhas. Se derem o mesmo
-- número, o agrupamento virou invisível e o log volta a mentir.
DO $teste$
DECLARE
  v_ws       uuid;
  v_rule     uuid;
  v_trig     uuid;
  v_email    uuid := gen_random_uuid();
  v_boletos  integer;
  v_enviados integer;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__agrupado__', 'AGRUP') RETURNING id INTO v_ws;
  INSERT INTO automation_rules (workspace_id, name, status, send_hour, channel)
  VALUES (v_ws, 'Regua', 'draft', 9, 'n8n_email') RETURNING id INTO v_rule;
  INSERT INTO automation_triggers (rule_id, workspace_id, day_offset, label, channel, column_mapping, enabled)
  VALUES (v_rule, v_ws, 0, 'No dia', 'n8n_email', '{}'::jsonb, true) RETURNING id INTO v_trig;

  -- Três boletos do mesmo cliente, um e-mail só.
  INSERT INTO automation_logs (rule_id, trigger_id, workspace_id, contact_name, day_offset,
                               channel, status, destino, email_id)
  SELECT v_rule, v_trig, v_ws, 'Cliente com 3 boletos', 0,
         'n8n_email', 'sent', 'cliente@exemplo.com', v_email
    FROM generate_series(1, 3);

  -- Um boleto de outro cliente, outro e-mail.
  INSERT INTO automation_logs (rule_id, trigger_id, workspace_id, contact_name, day_offset,
                               channel, status, destino, email_id)
  VALUES (v_rule, v_trig, v_ws, 'Cliente com 1 boleto', 0,
          'n8n_email', 'sent', 'outro@exemplo.com', gen_random_uuid());

  -- Um WhatsApp, que não agrupa e por isso não tem email_id.
  INSERT INTO automation_logs (rule_id, trigger_id, workspace_id, contact_name, contact_phone,
                               day_offset, channel, status, destino)
  VALUES (v_rule, v_trig, v_ws, 'Cliente por WhatsApp', '5511999999999',
          0, 'z_api', 'sent', '5511999999999');

  SELECT count(*), count(DISTINCT coalesce(email_id, id))
    INTO v_boletos, v_enviados
    FROM automation_logs WHERE rule_id = v_rule AND status = 'sent';

  IF v_boletos <> 5 THEN
    RAISE EXCEPTION 'boletos comunicados: esperado 5, veio %', v_boletos;
  END IF;
  IF v_enviados <> 3 THEN
    RAISE EXCEPTION 'mensagens enviadas: esperado 3 (1 e-mail agrupado + 1 e-mail + 1 zap), veio %', v_enviados;
  END IF;

  -- E o WhatsApp continua contando um por um, que é o comportamento dele.
  IF (SELECT count(DISTINCT coalesce(email_id, id)) FROM automation_logs
       WHERE rule_id = v_rule AND channel = 'z_api') <> 1 THEN
    RAISE EXCEPTION 'whatsapp deixou de contar individualmente';
  END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'email agrupado: 5 boletos comunicados em 3 mensagens, contagens separadas';
END
$teste$;
