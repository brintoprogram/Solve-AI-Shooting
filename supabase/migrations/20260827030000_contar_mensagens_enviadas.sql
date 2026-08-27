-- Contar mensagens enviadas de uma régua, sem o teto de 1000 linhas.
--
-- O ticker contava assim: baixava as linhas de automation_logs e media o
-- tamanho do array. O PostgREST devolve no máximo 1000 linhas por requisição
-- e não avisa que cortou — então toda régua que passasse de 1000 envios
-- congelava o contador em 1000, para sempre, sem erro nenhum. É o mesmo
-- defeito que já corrigimos na exportação de contatos.
--
-- Agora a conta é feita no banco, onde não há teto, e a definição de
-- "mensagem enviada" mora num lugar só: um e-mail com três boletos gera três
-- linhas de log e conta como UMA mensagem, porque foi uma que o cliente
-- recebeu.

CREATE OR REPLACE FUNCTION automation_mensagens_enviadas(p_rule_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(DISTINCT coalesce(email_id, id))::integer
    FROM automation_logs
   WHERE rule_id = p_rule_id AND status = 'sent';
$$;

COMMENT ON FUNCTION automation_mensagens_enviadas(uuid) IS
  'Mensagens efetivamente enviadas por uma regua. Boletos agrupados no mesmo e-mail contam como uma. SECURITY INVOKER: respeita o RLS de automation_logs, entao nao vaza contagem entre workspaces.';

REVOKE ALL ON FUNCTION automation_mensagens_enviadas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation_mensagens_enviadas(uuid) TO authenticated, service_role;

-- ── Verificação ──────────────────────────────────────────────────────
DO $teste$
DECLARE
  v_ws    uuid;
  v_rule  uuid;
  v_trig  uuid;
  v_email uuid := gen_random_uuid();
  v_n     integer;
BEGIN
  INSERT INTO workspaces (name, codigo) VALUES ('__contar__', 'CONTAR') RETURNING id INTO v_ws;
  INSERT INTO automation_rules (workspace_id, name, status, send_hour, channel)
  VALUES (v_ws, 'Regua', 'draft', 9, 'n8n_email') RETURNING id INTO v_rule;
  INSERT INTO automation_triggers (rule_id, workspace_id, day_offset, label, channel, column_mapping, enabled)
  VALUES (v_rule, v_ws, 0, 'No dia', 'n8n_email', '{}'::jsonb, true) RETURNING id INTO v_trig;

  -- 1500 linhas: acima do teto de 1000 que quebrava a contagem antiga.
  INSERT INTO automation_logs (rule_id, trigger_id, workspace_id, day_offset, channel, status)
  SELECT v_rule, v_trig, v_ws, 0, 'z_api', 'sent' FROM generate_series(1, 1500);

  v_n := automation_mensagens_enviadas(v_rule);
  IF v_n <> 1500 THEN
    RAISE EXCEPTION 'teto de 1000 ainda presente: esperado 1500, veio %', v_n;
  END IF;

  -- Mais 4 boletos num e-mail só: +1 mensagem, não +4.
  INSERT INTO automation_logs (rule_id, trigger_id, workspace_id, day_offset, channel, status, email_id)
  SELECT v_rule, v_trig, v_ws, 0, 'n8n_email', 'sent', v_email FROM generate_series(1, 4);

  v_n := automation_mensagens_enviadas(v_rule);
  IF v_n <> 1501 THEN
    RAISE EXCEPTION 'e-mail agrupado contado errado: esperado 1501, veio %', v_n;
  END IF;

  -- Falhas não entram na conta de enviadas.
  INSERT INTO automation_logs (rule_id, trigger_id, workspace_id, day_offset, channel, status, error_message)
  VALUES (v_rule, v_trig, v_ws, 0, 'n8n_email', 'failed', 'sem creditos');

  v_n := automation_mensagens_enviadas(v_rule);
  IF v_n <> 1501 THEN
    RAISE EXCEPTION 'falha entrou na contagem de enviadas: veio %', v_n;
  END IF;

  DELETE FROM workspaces WHERE id = v_ws;
  RAISE LOG 'contagem: 1500 individuais + 1 e-mail com 4 boletos = 1501 mensagens, sem teto';
END
$teste$;
