-- Onboarding: status do checklist em uma única ida ao banco + seed de workspace novo.
--
-- Problema 1 (desempenho): useSetupChecklist fazia 12 requisições separadas a
-- cada montagem do Dashboard/guia. São 12 round-trips HTTP para responder uma
-- pergunta só ("o que falta configurar?").
--
-- Problema 2 (ativação): workspace nascia completamente vazio. Sem setor, sem
-- regra de negociação e sem agente, o usuário precisa CRIAR tudo do zero em vez
-- de EDITAR o que já existe — que é a diferença entre 5 minutos e desistir.

-- ── 1. Status do setup em uma chamada ────────────────────────────────
--
-- SECURITY DEFINER para ler tabelas independentemente das policies de RLS
-- (algumas são permissivas e ORed entre si, o que tornaria as contagens
-- imprevisíveis). A checagem de acesso é explícita e é a primeira coisa que
-- roda. Retorna apenas números e booleanos — nunca chave, token ou PII.
CREATE OR REPLACE FUNCTION get_setup_status(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE user_id = auth.uid() AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'meta_active',        (SELECT count(*) FROM meta_connections WHERE workspace_id = p_workspace_id AND status = 'active'),
    'meta_broken',        (SELECT count(*) FROM meta_connections WHERE workspace_id = p_workspace_id AND status IN ('token_expired','disconnected')),
    'zapi',               (SELECT count(*) FROM z_api_connections WHERE workspace_id = p_workspace_id),
    'inbound_msgs',       (SELECT count(*) FROM inbox_messages   WHERE workspace_id = p_workspace_id AND direction = 'inbound'),
    'contacts',           (SELECT count(*) FROM inbox_contacts   WHERE workspace_id = p_workspace_id),
    'departments',        (SELECT count(*) FROM departments      WHERE workspace_id = p_workspace_id),
    'agents_active',      (SELECT count(*) FROM ai_agents        WHERE workspace_id = p_workspace_id AND is_active),
    'templates_approved', (SELECT count(*) FROM meta_templates   WHERE workspace_id = p_workspace_id AND status = 'APPROVED'),
    'templates_pending',  (SELECT count(*) FROM meta_templates   WHERE workspace_id = p_workspace_id AND status = 'PENDING'),
    'email_conns',        (SELECT count(*) FROM email_connections WHERE workspace_id = p_workspace_id),
    'members',            (SELECT count(*) FROM workspace_members WHERE workspace_id = p_workspace_id),
    'has_rules',          EXISTS (SELECT 1 FROM negotiation_rules WHERE workspace_id = p_workspace_id),
    -- Só o booleano: a chave em si jamais sai daqui.
    'has_ai_key',         COALESCE((
                            SELECT CASE WHEN w.ai_provider = 'openai'
                                        THEN w.openai_api_key    IS NOT NULL AND w.openai_api_key    <> ''
                                        ELSE w.anthropic_api_key IS NOT NULL AND w.anthropic_api_key <> ''
                                   END
                            FROM workspaces w WHERE w.id = p_workspace_id
                          ), false)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_setup_status(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_setup_status(uuid) TO authenticated;

-- ── 2. Seed do workspace novo ────────────────────────────────────────
--
-- Idempotente (ON CONFLICT / NOT EXISTS) para poder rodar de novo sem
-- duplicar. O agente de triagem nasce DESATIVADO de propósito: ele responde
-- clientes de verdade no WhatsApp, então ligar sozinho seria perigoso.
CREATE OR REPLACE FUNCTION seed_new_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO departments (workspace_id, name, description, color, order_index)
  VALUES
    (NEW.id, 'Cobrança',          'Negociação e renegociação de valores em atraso', '#3fb06c', 1),
    (NEW.id, 'Financeiro',        'Boletos, comprovantes e baixa de pagamento',     '#60a5fa', 2),
    (NEW.id, 'Jurídico',          'Casos que exigem análise legal',                 '#fbbf24', 3),
    (NEW.id, 'Atendimento Geral', 'Dúvidas e demais assuntos',                      '#a78bfa', 4)
  ON CONFLICT DO NOTHING;

  INSERT INTO negotiation_rules (workspace_id)
  VALUES (NEW.id)
  ON CONFLICT (workspace_id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM ai_agents WHERE workspace_id = NEW.id AND is_triage) THEN
    INSERT INTO ai_agents (workspace_id, name, system_prompt, model, is_triage, is_active)
    VALUES (
      NEW.id,
      'Triagem (rascunho)',
      'Você atende o primeiro contato de clientes desta empresa pelo WhatsApp.' || E'\n\n' ||
      'Seja breve, cordial e objetivo. Descubra o motivo do contato e direcione para o setor certo.' || E'\n\n' ||
      'Responda APENAS com a rota correspondente na última linha:' || E'\n' ||
      '- Dívida, boleto vencido, parcelamento ou desconto → ROUTE:Cobrança' || E'\n' ||
      '- Comprovante de pagamento, segunda via, valores → ROUTE:Financeiro' || E'\n' ||
      '- Menção a advogado, Procon ou processo → ROUTE:Jurídico' || E'\n' ||
      '- Qualquer outro assunto → ROUTE:Atendimento Geral' || E'\n' ||
      '- Ainda não deu para entender → ROUTE:NONE' || E'\n\n' ||
      'Revise este texto antes de ativar o agente: ele responde clientes reais.',
      'claude-haiku-4-5-20251001',
      true,
      false   -- nasce desligado: o dono revisa o prompt antes de soltar
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_workspace_created ON workspaces;
CREATE TRIGGER on_workspace_created
  AFTER INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION seed_new_workspace();
