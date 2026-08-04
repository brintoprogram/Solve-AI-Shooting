import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { DebtNegotiation, NegotiationOffer } from "@/types/negotiations";
import { runOk } from "@/lib/db";



export function useNegotiations(workspaceId?: string) {
  const [negotiations, setNegotiations] = useState<DebtNegotiation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("debt_negotiations")
      .select("*, inbox_contacts(*), contact_invoices(numero_nf, vencimento, status)")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (error) console.error("[useNegotiations] erro ao carregar negociações:", error.message);
    setNegotiations(data ?? []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`negotiations-${workspaceId ?? "none"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "debt_negotiations" }, () => { load(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [load]);

  /** Retorna false se qualquer uma das duas escritas falhar (ex.: RLS). */
  async function claim(negotiationId: string, conversationId: string, myUserId: string): Promise<boolean> {
    const a = await runOk("negotiation_claim",
      supabase.from("debt_negotiations").update({ status: "human_negotiating" }).eq("id", negotiationId),
      { negotiation_id: negotiationId });
    const b = await runOk("negotiation_assign_conversation",
      supabase.from("inbox_conversations").update({ assigned_to: myUserId }).eq("id", conversationId),
      { conversation_id: conversationId });
    return a && b;
  }

  return { negotiations, loading, claim, refresh: load };
}

export function useNegotiationOffers(negotiationId: string | null) {
  const [offers, setOffers] = useState<NegotiationOffer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!negotiationId) { setOffers([]); return; }

    setLoading(true);
    supabase.from("negotiation_offers")
      .select("*")
      .eq("negotiation_id", negotiationId)
      .order("round", { ascending: true })
      .then(({ data }: { data: NegotiationOffer[] | null }) => {
        setOffers(data ?? []);
        setLoading(false);
      });

    const channel = supabase
      .channel(`negotiation-offers-${negotiationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "negotiation_offers", filter: `negotiation_id=eq.${negotiationId}` },
        (payload: { eventType: string; new: NegotiationOffer; old: { id: string } }) => {
          setOffers((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((o) => o.id !== payload.old.id);
            if (prev.some((o) => o.id === payload.new.id)) return prev.map((o) => (o.id === payload.new.id ? payload.new : o));
            return [...prev, payload.new].sort((a, b) => a.round - b.round);
          });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [negotiationId]);

  return { offers, loading };
}
