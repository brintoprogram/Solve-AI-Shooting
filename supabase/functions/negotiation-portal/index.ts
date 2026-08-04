// Supabase Edge Function — Negotiation Portal (public, no Supabase Auth session)
// Backs the client-facing page at /negociacao/:token.
//
// Stateless auth: every mutating call re-sends { token, cpf_last_digits } and is
// re-verified from scratch — there is no session/cookie. This keeps the surface simple
// and auditable, at the cost of the client re-entering the 4 digits on every action.
//
// POST body: { action: "verify" | "view" | "accept" | "counter", token, cpf_last_digits, ... }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";
import { sendWhatsAppText } from "../_shared/whatsapp.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function getCors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}


const META_API = "https://graph.facebook.com/v25.0";
const MAX_ATTEMPTS = 5;

// ── Rules + validation (duplicated from negotiation-agent on purpose — see plan notes
// on cross-function imports not being reliable through the MCP deploy path) ──────────
interface RulesRow {
  max_discount_pct:       number;
  max_installments:       number;
  min_installment_amount: number;
}
const DEFAULT_RULES: RulesRow = { max_discount_pct: 20, max_installments: 6, min_installment_amount: 50 };

async function getRules(workspaceId: string): Promise<RulesRow> {
  const { data } = await supabase.from("negotiation_rules").select("max_discount_pct, max_installments, min_installment_amount").eq("workspace_id", workspaceId).maybeSingle();
  return (data as RulesRow | null) ?? DEFAULT_RULES;
}

// ── Token verification (stateless — re-run on every call) ────────────
interface TokenRow {
  id: string; negotiation_id: string; workspace_id: string; cpf_last_digits_hash: string;
  expires_at: string; used_at: string | null; locked_at: string | null; attempts: number;
}
type VerifyResult =
  | { ok: true; tokenRow: TokenRow }
  | { ok: false; error: string; status: number };

async function verifyToken(token: string, cpfLastDigits: string): Promise<VerifyResult> {
  const GENERIC_ERROR = "Link inválido ou expirado. Confira o link enviado no WhatsApp.";

  if (!token || !/^[a-f0-9]{64}$/.test(token)) return { ok: false, error: GENERIC_ERROR, status: 404 };
  if (!/^\d{3,4}$/.test(cpfLastDigits ?? "")) return { ok: false, error: "Informe os últimos dígitos do CPF/CNPJ.", status: 400 };

  const { data: tokenRow } = await supabase.from("negotiation_portal_tokens").select("*").eq("token", token).maybeSingle();
  if (!tokenRow) return { ok: false, error: GENERIC_ERROR, status: 404 };

  if (tokenRow.locked_at) return { ok: false, error: "Link bloqueado por excesso de tentativas. Fale com a empresa pelo WhatsApp.", status: 423 };
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) return { ok: false, error: GENERIC_ERROR, status: 410 };

  const pepper = Deno.env.get("ENCRYPTION_KEY") ?? "";
  const hash   = await sha256Hex(`${pepper}:${cpfLastDigits}`);

  if (hash !== tokenRow.cpf_last_digits_hash) {
    const attempts = (tokenRow.attempts ?? 0) + 1;
    const patch: Record<string, unknown> = { attempts };
    if (attempts >= MAX_ATTEMPTS) patch.locked_at = new Date().toISOString();
    await supabase.from("negotiation_portal_tokens").update(patch).eq("id", tokenRow.id);

    await supabase.from("audit_logs").insert({
      workspace_id: tokenRow.workspace_id, event_type: "negotiation_portal_verify_failed",
      entity_type: "negotiation_portal_token", entity_id: tokenRow.id, status: "warning",
      metadata: { attempts },
    });

    return { ok: false, error: "Não foi possível verificar. Confira os dados e tente novamente.", status: 401 };
  }

  if (!tokenRow.verified_at) {
    await supabase.from("negotiation_portal_tokens").update({ verified_at: new Date().toISOString() }).eq("id", tokenRow.id);
  }
  await supabase.from("audit_logs").insert({
    workspace_id: tokenRow.workspace_id, event_type: "negotiation_portal_access", entity_type: "negotiation_portal_token",
    entity_id: tokenRow.id, status: "success",
  });

  return { ok: true, tokenRow: tokenRow as TokenRow };
}

async function loadSummary(negotiationId: string) {
  const { data: negotiation } = await supabase.from("debt_negotiations").select("*").eq("id", negotiationId).single();
  const { data: offers } = await supabase.from("negotiation_offers").select("*").eq("negotiation_id", negotiationId).order("round", { ascending: true });
  const { data: invoice } = await supabase.from("contact_invoices").select("numero_nf, vencimento").eq("id", negotiation.invoice_id).maybeSingle();
  return { negotiation, offers: offers ?? [], invoice };
}

function json(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// ── WhatsApp confirmation sender ──────────────────────────────────
async function sendConfirmation(
  negotiation: { conversation_id: string; workspace_id: string; contact_id: string },
  text: string,
): Promise<void> {
  const { data: conv } = await supabase.from("inbox_conversations")
    .select("id, meta_connection_id, z_api_connection_id").eq("id", negotiation.conversation_id).single();
  if (!conv) return;

  // onError "swallow": neste ponto o acordo JÁ foi gravado no banco. Uma falha
  // de entrega no WhatsApp não pode virar erro para o cliente, que de fato
  // concluiu a ação — a mensagem fica registrada com wamid null para a equipe.
  await sendWhatsAppText(
    supabase,
    { ...conv, workspace_id: negotiation.workspace_id, contact_id: negotiation.contact_id },
    text,
    "negotiation-portal",
    { onError: "swallow", touchUpdatedAt: false, logLabel: "negotiation-portal" },
  );
}

// ── Main handler ───────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, CORS);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, CORS); }

  const action        = body.action as string;
  const token         = (body.token as string) ?? "";
  const cpfLastDigits = ((body.cpf_last_digits as string) ?? "").replace(/\D/g, "");

  if (!action) return json({ error: "action é obrigatório" }, 400, CORS);

  try {
    const verify = await verifyToken(token, cpfLastDigits);
    if (!verify.ok) return json({ error: verify.error }, verify.status, CORS);
    const { tokenRow } = verify;

    // ── verify / view — read-only, both just return the current state ──
    if (action === "verify" || action === "view") {
      const summary = await loadSummary(tokenRow.negotiation_id);
      return json({ ok: true, ...summary, token_used: !!tokenRow.used_at }, 200, CORS);
    }

    if (tokenRow.used_at) {
      return json({ error: "Esta proposta já foi respondida. Aguarde um novo link caso a negociação continue." }, 409, CORS);
    }

    const { negotiation } = await loadSummary(tokenRow.negotiation_id);
    if (negotiation.status !== "awaiting_customer" && negotiation.status !== "triggered") {
      return json({ error: "Esta negociação não está mais aberta para respostas por aqui." }, 409, CORS);
    }

    // ── accept ───────────────────────────────────────────────────────
    if (action === "accept") {
      const offerId = body.offer_id as string;
      const { data: offer } = await supabase.from("negotiation_offers").select("*")
        .eq("id", offerId).eq("negotiation_id", negotiation.id).eq("status", "pending")
        .in("proposed_by", ["ai", "staff"]).maybeSingle();

      if (!offer) return json({ error: "Proposta não encontrada ou já respondida." }, 404, CORS);

      await supabase.from("negotiation_offers").update({ status: "accepted" }).eq("id", offer.id);
      await supabase.from("debt_negotiations").update({
        status: "formalized", agreed_amount: offer.offer_amount, agreed_installments: offer.installments,
        agreed_first_due_date: offer.first_due_date, agreed_at: new Date().toISOString(),
      }).eq("id", negotiation.id);
      await supabase.from("negotiation_portal_tokens").update({ used_at: new Date().toISOString() }).eq("id", tokenRow.id);

      await supabase.from("inbox_messages").insert({
        workspace_id: negotiation.workspace_id, conversation_id: negotiation.conversation_id, contact_id: negotiation.contact_id,
        direction: "outbound", message_type: "text",
        body: `[Cliente formalizou o acordo pelo portal: R$ ${Number(offer.offer_amount).toFixed(2)} em ${offer.installments}x]`,
        is_internal: true, status: "sent", created_at: new Date().toISOString(),
      });

      await sendConfirmation(negotiation, `Combinado! Seu acordo foi confirmado: R$ ${Number(offer.offer_amount).toFixed(2)} em ${offer.installments}x. Nossa equipe vai gerar a nova cobrança e te avisar em breve. Obrigado!`);

      return json({ ok: true, status: "formalized" }, 200, CORS);
    }

    // ── counter ──────────────────────────────────────────────────────
    if (action === "counter") {
      const amount       = Number(body.amount);
      const installments = Number(body.installments);

      if (!Number.isFinite(amount) || amount <= 0 || amount > negotiation.original_amount) {
        return json({ error: "Valor proposto inválido." }, 400, CORS);
      }
      if (!Number.isInteger(installments) || installments < 1 || installments > 24) {
        return json({ error: "Número de parcelas inválido." }, 400, CORS);
      }

      const rules = await getRules(negotiation.workspace_id);
      const discount_pct       = negotiation.original_amount > 0 ? ((negotiation.original_amount - amount) / negotiation.original_amount) * 100 : 0;
      const installment_amount = amount / installments;
      const round = (negotiation.offer_round as number) + 1;

      await supabase.from("negotiation_offers")
        .update({ status: "superseded" })
        .eq("negotiation_id", negotiation.id).eq("status", "pending");

      await supabase.from("negotiation_offers").insert({
        negotiation_id: negotiation.id, workspace_id: negotiation.workspace_id, round,
        proposed_by: "customer", offer_amount: amount, discount_pct, installments,
        installment_amount, status: "pending", rule_snapshot: rules,
      });
      await supabase.from("debt_negotiations").update({ offer_round: round }).eq("id", negotiation.id);
      await supabase.from("negotiation_portal_tokens").update({ used_at: new Date().toISOString() }).eq("id", tokenRow.id);

      await supabase.from("inbox_messages").insert({
        workspace_id: negotiation.workspace_id, conversation_id: negotiation.conversation_id, contact_id: negotiation.contact_id,
        direction: "inbound", message_type: "text",
        body: `[Via portal] Cliente propôs: R$ ${amount.toFixed(2)} em ${installments}x`,
        status: "delivered", created_at: new Date().toISOString(),
      });

      // Ask the negotiation agent to react to the customer's counter-offer right away.
      supabase.functions.invoke("negotiation-agent", {
        body: { conversation_id: negotiation.conversation_id, message_body: `[Via portal] Cliente propôs: R$ ${amount.toFixed(2)} em ${installments}x` },
      })
        .then(({ error }) => {
          if (error) console.error(JSON.stringify({ level: "error", event: "negotiation_dispatch_failed",
            fn: "negotiation-portal", conversation_id: negotiation.conversation_id, err: error.message }));
        })
        .catch((e: unknown) => console.error("[negotiation-portal] erro de rede ao acionar negotiation-agent:", e));

      return json({ ok: true, status: "countered" }, 200, CORS);
    }

    return json({ error: "action desconhecida" }, 400, CORS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[negotiation-portal] erro:", msg);
    return json({ error: "Erro interno. Tente novamente em instantes." }, 500, CORS);
  }
});
