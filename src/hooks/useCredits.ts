// Saldo de créditos do workspace atual.
//
// Lê direto da tabela: a RLS já restringe ao workspace de quem pergunta, e
// gravar é exclusivo da service role. Não precisa de edge function para ler.
//
// Realtime porque o saldo cai enquanto a pessoa olha a tela — uma campanha
// rodando consome sozinha. Um número parado enquanto o saldo despenca é pior
// que não mostrar número nenhum.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { log } from "@/lib/logger";

export interface SaldoCreditos {
  saldo:          number;
  custo_mensagem: number;
  custo_ia:       number;
  cobranca_ativa: boolean;
}

export function useCredits() {
  const { workspaceId } = useAuth();
  const [dados,   setDados]   = useState<SaldoCreditos | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!workspaceId) { setCarregando(false); return; }

    const { data, error } = await supabase
      .from("workspace_credits")
      .select("saldo, custo_mensagem, custo_ia, cobranca_ativa")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) {
      log.error("credito_saldo_falhou", { err: error.message });
      setDados(null);
    } else {
      // Workspace que nunca consumiu não tem linha ainda — isso é saldo zero,
      // não "sem informação". Mostrar em branco faria parecer erro.
      setDados(data ?? { saldo: 0, custo_mensagem: 1, custo_ia: 3, cobranca_ativa: true });
    }
    setCarregando(false);
  }, [workspaceId]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!workspaceId) return;
    const ch = supabase
      .channel(`creditos-${workspaceId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "workspace_credits", filter: `workspace_id=eq.${workspaceId}` },
        carregar)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [workspaceId, carregar]);

  return { ...(dados ?? { saldo: 0, custo_mensagem: 1, custo_ia: 3, cobranca_ativa: true }),
           carregando, recarregar: carregar };
}
