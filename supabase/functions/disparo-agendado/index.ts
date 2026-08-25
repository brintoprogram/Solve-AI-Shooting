// Edge Function — disparo-agendado
//
// Roda a cada minuto pelo pg_cron e dispara para o N8N as campanhas de e-mail
// cujo horário chegou. É o que faz o agendamento funcionar com o site fechado:
// o envio deixa de depender do navegador de alguém.
//
// POR QUE NÃO REUSAR n8n-dispatch: aquela função valida um JWT de USUÁRIO e
// confere a associação ao workspace por caller.id. Um job agendado não tem
// sessão de ninguém, então ela responderia 401 — foi desenhada para ser
// chamada por uma pessoa no navegador, e continua servindo para isso.
//
// ── O QUE ESTA FUNÇÃO SE RECUSA A PEGAR ─────────────────────────────
// Só campanhas com status 'agendada' E agendado_para preenchido. As duas
// condições são novas: nenhuma das 75 campanhas que existiam antes deste
// recurso pode satisfazê-las. Em particular a "Campanha Safra Verão 2026",
// com 490 destinatários reais parada em status 'scheduled'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_CALLBACK_SECRET") ?? "";
const N8N_WEBHOOK    = Deno.env.get("N8N_WEBHOOK_URL");

const db = createClient(SUPABASE_URL, SERVICE_KEY);

// Teto por rodada. Um erro de agendamento em massa não vira uma enxurrada de
// chamadas ao N8N no mesmo minuto; o resto sai nos minutos seguintes.
const MAX_POR_RODADA = 5;

interface Campanha {
  id: string;
  workspace_id: string;
  name: string;
  agendado_para: string;
  total_recipients: number | null;
}

Deno.serve(async () => {
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  const { data: vencidas, error: errBusca } = await db
    .from("shooting_campaigns")
    .select("id, workspace_id, name, agendado_para, total_recipients")
    .eq("status", "agendada")
    .eq("dispatch_channel", "n8n_email")
    .not("agendado_para", "is", null)
    .lte("agendado_para", new Date().toISOString())
    .order("agendado_para", { ascending: true })
    .limit(MAX_POR_RODADA);

  if (errBusca) {
    console.error("[disparo-agendado] busca falhou:", errBusca.message);
    return json({ error: errBusca.message }, 500);
  }

  const pendentes = (vencidas ?? []) as Campanha[];
  if (pendentes.length === 0) return json({ ok: true, disparadas: 0 });

  if (!N8N_WEBHOOK) {
    console.error("[disparo-agendado] N8N_WEBHOOK_URL nao configurado");
    return json({ error: "N8N_WEBHOOK_URL ausente" }, 500);
  }

  let disparadas = 0;
  const falhas: string[] = [];

  for (const c of pendentes) {
    // RESERVA ANTES DE ENVIAR. O UPDATE condicional em status='agendada' é o
    // que impede envio dobrado: se o N8N demorar mais que um minuto, a rodada
    // seguinte encontra a campanha já em 'sending' e não a pega. Sem isto, a
    // mesma lista sairia duas vezes — e para o destinatário isso é spam vindo
    // de quem ele confia.
    const { data: reservada, error: errReserva } = await db
      .from("shooting_campaigns")
      .update({ status: "sending", started_at: new Date().toISOString() })
      .eq("id", c.id)
      .eq("status", "agendada")
      .select("id");

    if (errReserva || !reservada || reservada.length === 0) {
      console.log(`[disparo-agendado] ${c.id} ja foi pega por outra rodada`);
      continue;
    }

    try {
      const { data: msgs, error: errMsgs } = await db
        .from("shooting_messages")
        .select("id, recipient_name, recipient_phone, recipient_data")
        .eq("campaign_id", c.id);

      if (errMsgs) throw new Error(errMsgs.message);
      if (!msgs || msgs.length === 0) throw new Error("campanha sem destinatarios gravados");

      // Mesmo formato que n8n-dispatch monta, para o fluxo do N8N nao precisar
      // saber por qual caminho a campanha chegou.
      const payload = {
        campaign_id:   c.id,
        workspace_id:  c.workspace_id,
        campaign_name: c.name,
        dispatched_at: new Date().toISOString(),
        agendado_para: c.agendado_para,
        callback_api:  `${SUPABASE_URL}/functions/v1/update-campaign-status`,
        callback_secret: WEBHOOK_SECRET,
        recipients: msgs.map((m: Record<string, unknown>) => ({
          message_id:     m.id,
          name:           m.recipient_name,
          phone:          m.recipient_phone,
          recipient_data: m.recipient_data,
        })),
      };

      const res = await fetch(N8N_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const texto = await res.text().catch(() => "");
        throw new Error(`N8N respondeu ${res.status}: ${texto.slice(0, 200)}`);
      }

      disparadas++;
      console.log(`[disparo-agendado] campanha ${c.id} enviada ao N8N (${msgs.length} destinatarios)`);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      falhas.push(`${c.id}: ${motivo}`);
      console.error(`[disparo-agendado] ${c.id} falhou:`, motivo);

      // Marca como falha em vez de devolver para 'agendada'. Repetir seria
      // arriscar envio duplicado justamente no caso ambiguo — o N8N pode ter
      // recebido a lista e falhado so na resposta. Diante da duvida, a escolha
      // e nao enviar de novo e deixar visivel para uma pessoa decidir.
      await db.from("shooting_campaigns")
        .update({ status: "failed", error_summary: { agendamento: motivo } })
        .eq("id", c.id);
    }
  }

  return json({ ok: true, disparadas, falhas });
});
