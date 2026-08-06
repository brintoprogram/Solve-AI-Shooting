import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { log } from "@/lib/logger";
import { SETUP_STEPS, type StepState, type SetupStep } from "@/types/setup";

/**
 * Deriva o estado de cada passo de configuração consultando o banco.
 *
 * Princípio: nunca perguntar "você já fez isso?" — verificar. O usuário não
 * precisa marcar checkbox e o progresso não mente.
 *
 * Desempenho: tudo vem da RPC `get_setup_status`, uma única ida ao banco. A
 * versão anterior disparava 12 requisições separadas a cada montagem do
 * Dashboard e do guia, para responder uma pergunta só ("o que falta?").
 *
 * Segurança: a RPC roda como SECURITY DEFINER mas confere membership no
 * workspace antes de qualquer leitura, e devolve apenas contagens e booleanos
 * — nenhuma chave de API, token ou dado pessoal atravessa essa fronteira.
 */
export interface ChecklistResult {
  states:      Record<string, StepState>;
  loading:     boolean;
  /** Passos essenciais que ainda faltam. Zero = workspace operável. */
  blockersLeft: number;
  doneCount:   number;
  totalCount:  number;
  /** true quando nem o canal foi conectado — workspace recém-criado. */
  isFresh:     boolean;
  refresh:     () => void;
}

/** Espelha o jsonb devolvido por get_setup_status. */
interface SetupStatus {
  meta_active:        number;
  meta_broken:        number;
  zapi:               number;
  inbound_msgs:       number;
  contacts:           number;
  departments:        number;
  agents_active:      number;
  templates_approved: number;
  templates_pending:  number;
  email_conns:        number;
  members:            number;
  has_rules:          boolean;
  has_ai_key:         boolean;
}

const plural = (n: number, singular: string, plural_: string) =>
  `${n} ${n === 1 ? singular : plural_}`;

function buildStates(s: SetupStatus): Record<string, StepState> {
  const hasChannel = s.meta_active > 0 || s.zapi > 0;

  return {
    channel: s.meta_active > 0
      ? { status: "done", detail: s.meta_active > 1 ? `${s.meta_active} números` : "Meta · ativo" }
      : s.zapi > 0
        ? { status: "done", detail: "Z-API (não oficial)" }
        : s.meta_broken > 0
          ? { status: "attention", detail: "token expirado — reconecte" }
          : { status: "pending" },

    // Mensagem recebida é a prova de que o webhook entrega de ponta a ponta.
    webhook: s.inbound_msgs > 0
      ? { status: "done", detail: plural(s.inbound_msgs, "mensagem recebida", "mensagens recebidas") }
      : hasChannel
        ? { status: "pending", detail: "nenhuma mensagem chegou ainda" }
        : { status: "pending", detail: "conecte um canal antes" },

    contacts: s.contacts > 0
      ? { status: "done", detail: plural(s.contacts, "contato", "contatos") }
      : { status: "pending" },

    departments: s.departments > 0
      ? { status: "done", detail: plural(s.departments, "setor", "setores") }
      : { status: "pending" },

    templates: s.templates_approved > 0
      ? { status: "done", detail: plural(s.templates_approved, "aprovado", "aprovados") }
      : s.templates_pending > 0
        ? { status: "waiting", detail: `${s.templates_pending} aguardando a Meta` }
        : { status: "pending" },

    ai: s.has_ai_key && s.agents_active > 0
      ? { status: "done", detail: plural(s.agents_active, "agente ativo", "agentes ativos") }
      : s.has_ai_key
        ? { status: "pending", detail: "chave salva — falta ativar um agente" }
        : { status: "pending" },

    negotiation: s.has_rules
      ? { status: "done", detail: "regras definidas" }
      : { status: "pending" },

    team: s.members > 1
      ? { status: "done", detail: `${s.members} pessoas` }
      : { status: "pending", detail: "só você" },

    email: s.email_conns > 0
      ? { status: "done", detail: plural(s.email_conns, "conexão", "conexões") }
      : { status: "pending" },
  };
}

export function useSetupChecklist(workspaceId?: string): ChecklistResult {
  const [states, setStates]   = useState<Record<string, StepState>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);

    const { data, error } = await supabase.rpc("get_setup_status", { p_workspace_id: workspaceId });

    if (error) {
      log.error("setup_checklist_load_failed", { err: error.message, workspace_id: workspaceId });
    } else if (data) {
      setStates(buildStates(data as unknown as SetupStatus));
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const isDone = (s: SetupStep) => states[s.id]?.status === "done";
  const blockersLeft = SETUP_STEPS.filter((s) => s.weight === "blocker" && !isDone(s)).length;
  const doneCount    = SETUP_STEPS.filter(isDone).length;

  return {
    states,
    loading,
    blockersLeft,
    doneCount,
    totalCount: SETUP_STEPS.length,
    isFresh: !loading && states.channel?.status === "pending" && states.contacts?.status === "pending",
    refresh: load,
  };
}
