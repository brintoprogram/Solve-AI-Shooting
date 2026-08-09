-- Panorama de todos os workspaces, para o console do dono da plataforma.
--
-- Em SQL e não no navegador porque a alternativa seria uma contagem por
-- workspace por tabela — oito consultas por cliente, crescendo com a carteira.
--
-- SEGURANÇA: esta função enxerga TODOS os workspaces, o que é exatamente o que
-- a RLS existe para impedir. Ela só é segura porque nenhum papel do navegador
-- pode executá-la: o REVOKE no fim do arquivo é parte da função, não um extra.
-- Quem autoriza é a edge function workspaces-admin, conferindo o e-mail contra
-- o secret PLATFORM_ADMIN_EMAILS antes de chamar.

CREATE OR REPLACE FUNCTION admin_workspaces_panorama()
RETURNS TABLE (
  id              uuid,
  codigo          text,
  name            text,
  created_at      timestamptz,
  api_enabled     boolean,
  support_email   text,
  membros         bigint,
  saldo           integer,
  cobranca_ativa  boolean,
  custo_mensagem  integer,
  custo_ia        integer,
  canais_meta     bigint,
  canais_zapi     bigint,
  canais_email    bigint,
  contatos        bigint,
  agentes_ativos  bigint,
  setores         bigint,
  ultimo_consumo  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id, w.codigo, w.name, w.created_at, w.api_enabled, w.support_email,
    (SELECT count(*) FROM workspace_members m  WHERE m.workspace_id = w.id),
    -- Workspace sem linha em workspace_credits ainda não consumiu nada: a linha
    -- nasce no primeiro débito. Sem o coalesce a tela mostraria vazio em vez de
    -- zero, e "vazio" seria lido como erro.
    coalesce(c.saldo, 0),
    coalesce(c.cobranca_ativa, true),
    coalesce(c.custo_mensagem, 1),
    coalesce(c.custo_ia, 3),
    (SELECT count(*) FROM meta_connections  x WHERE x.workspace_id = w.id),
    (SELECT count(*) FROM z_api_connections x WHERE x.workspace_id = w.id),
    (SELECT count(*) FROM email_connections x WHERE x.workspace_id = w.id),
    (SELECT count(*) FROM inbox_contacts    x WHERE x.workspace_id = w.id),
    (SELECT count(*) FROM ai_agents         x WHERE x.workspace_id = w.id AND x.is_active),
    (SELECT count(*) FROM departments       x WHERE x.workspace_id = w.id),
    (SELECT max(l.created_at) FROM credit_ledger l WHERE l.workspace_id = w.id)
  FROM workspaces w
  LEFT JOIN workspace_credits c ON c.workspace_id = w.id
  ORDER BY w.created_at;
$$;

REVOKE ALL ON FUNCTION admin_workspaces_panorama() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_workspaces_panorama() TO service_role;

-- ── Verificação ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'admin_workspaces_panorama()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'admin_workspaces_panorama()', 'EXECUTE') THEN
    RAISE EXCEPTION 'panorama alcancavel pelo navegador — vazaria todos os workspaces';
  END IF;

  IF NOT has_function_privilege('service_role', 'admin_workspaces_panorama()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role sem acesso — o console nao carregaria';
  END IF;

  RAISE LOG 'panorama de workspaces: criado e fechado ao navegador';
END $$;
