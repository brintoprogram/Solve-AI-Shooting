// automation-ticker — runs every hour via pg_cron.
// For each active automation_rule where send_hour == current UTC hour:
//   for each enabled trigger: find recipients whose vencimento == today - day_offset,
//   verify boleto is still pending, dedup via automation_logs, send, log result.
//
// WhatsApp (Z-API e META) envia uma mensagem por boleto — é como o template
// funciona. E-mail agrupa por cliente: todos os boletos que vencem naquele
// gatilho saem num e-mail só, igual à campanha.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { consumirCredito } from "../_shared/credits.ts";
import { decrypt } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const Z_API_BASE   = "https://api.z-api.io/instances";
const META_BASE    = "https://graph.facebook.com/v25.0";
/* Mesmo webhook e mesmo segredo das campanhas: o fluxo no N8N nao precisa
   saber se a lista veio de uma campanha ou de uma regua automatica. */
const N8N_WEBHOOK    = Deno.env.get("N8N_WEBHOOK_URL");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_CALLBACK_SECRET") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatBRL(v: number | null): string {
  if (v === null || v === undefined) return "";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("T")[0].split("-");
  return `${d}/${m}/${y}`;
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function substituteAutoVars(tpl: string, r: Recipient, dayOffset: number): string {
  const dias       = Math.abs(dayOffset);
  const statusVenc = dayOffset < 0 ? "a vencer"
    : dayOffset === 0 ? "no dia do vencimento" : "vencido";
  return tpl
    .replace(/\{nome\}/g,              r.contact_name  ?? "")
    .replace(/\{valor\}/g,             formatBRL(r.valor))
    .replace(/\{vencimento\}/g,        formatDate(r.vencimento))
    .replace(/\{dias\}/g,              String(dias))
    .replace(/\{status_vencimento\}/g, statusVenc)
    .replace(/\{boleto\}/g,            r.numero_nf ?? r.codigo_barras ?? "");
}

function substituteTemplateVars(template: string, mapping: Record<string, string>, recipient: Recipient): string {
  let result = template;
  for (const [idx, field] of Object.entries(mapping)) {
    const value = getRecipientField(recipient, field);
    result = result.replace(new RegExp(`\\{\\{${idx}\\}\\}`, "g"), value);
  }
  return result;
}

function getRecipientField(r: Recipient, field: string): string {
  switch (field) {
    case "nome":              return r.contact_name  ?? "";
    case "valor":             return formatBRL(r.valor);
    case "vencimento":        return formatDate(r.vencimento);
    case "dias":              return "";  // computed later with dayOffset context
    case "status_vencimento": return "";  // computed later with dayOffset context
    case "boleto":            return r.numero_nf ?? r.codigo_barras ?? "";
    default:                  return "";
  }
}

/** Bloco de boleto do e-mail. Copia fiel do que a campanha gera em
 *  EmailCampaignWizard — mesmo HTML, mesmos estilos, mesmo texto. O fluxo do
 *  N8N so recebe isto pronto em recipient_data.invoice_detail_html, entao
 *  divergir aqui produziria dois layouts de e-mail no mesmo sistema. */
function buildInvoiceDetailHtml(
  invs: { valor: number | null; vencimento: string | null }[],
): string {
  if (invs.length === 0) return "";
  const td   = "padding:14px 20px;font-size:14px;color:#111827;";
  const sep  = "border-top:1px solid #e5e7eb;";
  const tbl  = "width:100%;border-collapse:collapse;margin:0 0 28px;border-left:3px solid #1a1a2e;background-color:#f9fafb;";
  const total = invs.reduce((s, inv) => s + (inv.valor ?? 0), 0);

  const uniqueVenc = [...new Set(invs.map((inv) => inv.vencimento).filter(Boolean))] as string[];

  if (uniqueVenc.length <= 1) {
    const vStr = uniqueVenc[0] ? formatDate(uniqueVenc[0]) : "—";
    return (
      `<table width='100%' cellpadding='0' cellspacing='0' style='${tbl}'>` +
      `<tr><td style='${td}'>Valor: <strong>${formatBRL(total)}</strong></td></tr>` +
      `<tr><td style='${td}${sep}'>Data de vencimento: <strong>${vStr}</strong></td></tr>` +
      `</table>`
    );
  }

  const sorted = [...invs].sort((a, b) => (a.vencimento ?? "").localeCompare(b.vencimento ?? ""));
  const rows = sorted.map((inv, i) => {
    const vStr   = inv.vencimento ? formatDate(inv.vencimento) : "—";
    const vVal   = inv.valor != null ? formatBRL(inv.valor) : "—";
    const border = i > 0 ? sep : "";
    return `<tr><td style='${td}${border}'>Venc. ${vStr}: <strong>${vVal}</strong></td></tr>`;
  }).join("");

  return (
    `<table width='100%' cellpadding='0' cellspacing='0' style='${tbl}'>` +
    rows +
    `<tr><td style='${td}${sep}'>Total: <strong>${formatBRL(total)}</strong></td></tr>` +
    `</table>`
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Recipient {
  id:            string;
  contact_id:    string;
  contact_name:  string;
  contact_phone: string;
  vencimento:    string;
  valor:         number | null;
  numero_nf:     string | null;
  codigo_barras: string | null;
}

interface Trigger {
  id:                  string;
  day_offset:          number;
  label:               string;
  channel:             string | null;
  z_api_connection_id: string | null;
  z_api_template_id:   string | null;
  meta_connection_id:  string | null;
  meta_template_id:    string | null;
  email_subject:       string | null;
  email_body_html:     string | null;
  column_mapping:      Record<string, string>;
  message_body:        string | null;
  enabled:             boolean;
}

interface Rule {
  id:                  string;
  workspace_id:        string;
  name:                string;
  send_hour:           number;
  channel:             string;
  z_api_connection_id: string | null;
  meta_connection_id:  string | null;
  template_mode:       string;
  unified_message:     string | null;
}

// ── Z-API send ─────────────────────────────────────────────────────────────

async function sendZApiMessage(
  instanceId: string, token: string, clientToken: string,
  phone: string, message: string,
): Promise<{ zaapId?: string; error?: string }> {
  const cleanPhone = phone.replace(/\D/g, "");
  try {
    const res = await fetch(`${Z_API_BASE}/${instanceId}/token/${token}/send-text`, {
      method: "POST",
      headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: cleanPhone, message }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) return { error: String(data.error ?? data.message ?? `HTTP ${res.status}`) };
    const id = String(data.zaapId ?? data.messageId ?? data.id ?? "");
    if (id) return { zaapId: id };
    return { error: String(data.error ?? "Unknown Z-API response") };
  } catch (err) { return { error: String(err) }; }
}

// ── META send ──────────────────────────────────────────────────────────────

interface MetaTemplateComp {
  type:    string;
  text?:   string;
  format?: string;
  buttons?: Array<{ text: string }>;
}

function buildMetaComponents(
  templateComps: MetaTemplateComp[],
  mapping:       Record<string, string>,
  recipient:     Recipient,
  dayOffset:     number,
): unknown[] {
  const out: unknown[] = [];
  for (const comp of templateComps) {
    if (comp.type === "BODY" && comp.text?.includes("{{")) {
      const params = Object.entries(mapping)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, field]) => {
          let value = getRecipientField(recipient, field);
          if (field === "dias")              value = String(Math.abs(dayOffset));
          if (field === "status_vencimento") value = dayOffset < 0 ? "a vencer" : dayOffset === 0 ? "no dia" : "vencido";
          return { type: "text", text: value };
        });
      if (params.length) out.push({ type: "body", parameters: params });
    }
  }
  return out;
}

async function sendMetaTemplate(
  phoneNumberId: string, accessToken: string, to: string,
  templateName: string, language: string, components: unknown[],
): Promise<{ wamid?: string; error?: string }> {
  try {
    const res = await fetch(`${META_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: { name: templateName, language: { code: language }, components },
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const err = (data.error as Record<string, unknown>) ?? {};
      return { error: String(err.message ?? "API error") };
    }
    const msgs = data.messages as Array<{ id: string }>;
    return { wamid: msgs?.[0]?.id ?? "" };
  } catch (err) { return { error: String(err) }; }
}

// ── Log helper ─────────────────────────────────────────────────────────────

interface LogExtra {
  zaap_id?:       string;
  wamid?:         string;
  error_message?: string;
  /** Endereco/numero realmente usado. Para e-mail e a unica coluna que guarda
   *  para onde a mensagem foi — contact_phone nao serve. */
  destino?:       string;
  /** Identificador do e-mail FISICO. Boletos do mesmo e-mail compartilham. */
  email_id?:      string;
}

/** Uma linha de log POR BOLETO, sempre. É o que o dedup lê na próxima rodada:
 *  se um boleto que saiu no e-mail agrupado não tivesse linha própria, a
 *  rodada seguinte o encontraria "não enviado" e mandaria um segundo e-mail. */
async function writeLog(
  rule: Rule, trigger: Trigger, recipients: Recipient | Recipient[],
  channel: string, status: "sent" | "failed", extra: LogExtra,
): Promise<void> {
  const lista = Array.isArray(recipients) ? recipients : [recipients];
  if (!lista.length) return;
  const agora = new Date().toISOString();
  await db.from("automation_logs").insert(lista.map((recipient) => ({
    rule_id:       rule.id,
    trigger_id:    trigger.id,
    recipient_id:  recipient.id,
    workspace_id:  rule.workspace_id,
    contact_name:  recipient.contact_name,
    contact_phone: recipient.contact_phone,
    day_offset:    trigger.day_offset,
    channel,
    status,
    zaap_id:       extra.zaap_id       ?? null,
    wamid:         extra.wamid         ?? null,
    error_message: extra.error_message ?? null,
    destino:       extra.destino       ?? recipient.contact_phone ?? null,
    email_id:      extra.email_id      ?? null,
    scheduled_for: agora,
  })));
}

// ── PENDING_STATUSES (mirrors frontend InvoiceSelector) ────────────────────

const PENDING = ["pendente", "vencido", "aberto", "em_aberto"];

// ── E-mail: um por cliente, com todos os boletos do gatilho ────────────────

/** Filtra do grupo os boletos que já foram pagos e os que já saíram numa
 *  rodada anterior. Em lote: um grupo de 8 boletos não deve virar 24 queries. */
async function boletosQueAindaValem(
  trigger: Trigger, grupo: Recipient[],
): Promise<Recipient[]> {
  const ids = grupo.map((r) => r.id);

  const { data: linhas } = await db
    .from("automation_recipients").select("id, invoice_id").in("id", ids);
  const invoiceDe = new Map<string, string | null>(
    (linhas ?? []).map((l) => [l.id as string, l.invoice_id as string | null]));

  const invIds = [...invoiceDe.values()].filter(Boolean) as string[];
  const pagos = new Set<string>();
  if (invIds.length) {
    const { data: invs } = await db
      .from("contact_invoices").select("id, status").in("id", invIds);
    for (const i of invs ?? []) {
      if (!PENDING.includes(i.status as string)) pagos.add(i.id as string);
    }
  }

  const { data: jaSaiu } = await db
    .from("automation_logs").select("recipient_id")
    .eq("trigger_id", trigger.id).in("recipient_id", ids).eq("status", "sent");
  const enviados = new Set((jaSaiu ?? []).map((l) => l.recipient_id as string));

  return grupo.filter((r) => {
    const inv = invoiceDe.get(r.id);
    if (inv && pagos.has(inv)) return false;
    if (enviados.has(r.id))    return false;
    return true;
  });
}

/** Um e-mail para o cliente, com todos os boletos que vencem neste gatilho.
 *
 *  O payload e o recipient_data sao IDÊNTICOS aos da campanha, campo por campo
 *  e com os mesmos nomes — inclusive `contact_invoices` com a lista inteira,
 *  que é o motivo de esta função receber um grupo e não uma linha. O fluxo do
 *  N8N lê `recipient_data.invoice_detail_html`, `valor_total_pendente`,
 *  `proximo_vencimento` e o contato espalhado na raiz; um objeto parecido com
 *  outras chaves produziria e-mail com campo vazio.
 *
 *  Campos a mais existem e são só isso: a mais. `origem`, `rule_id`,
 *  `trigger_label` e `day_offset` dizem de onde a lista veio, para o fluxo
 *  poder ramificar sem precisar mudar para continuar funcionando. */
async function processarEmail(rule: Rule, trigger: Trigger, grupo: Recipient[]): Promise<void> {
  const canal = "n8n_email";

  const boletosValidos = await boletosQueAindaValem(trigger, grupo);
  if (!boletosValidos.length) {
    console.log(`[ticker] e-mail sem boleto pendente: contato=${grupo[0]?.contact_id}`);
    return;
  }

  if (!N8N_WEBHOOK) {
    await writeLog(rule, trigger, boletosValidos, canal, "failed",
                   { error_message: "N8N_WEBHOOK_URL não configurado" });
    return;
  }

  const primeiro = boletosValidos[0];

  // O contato inteiro, como a campanha faz com `...c`.
  const { data: contato } = await db
    .from("inbox_contacts").select("*").eq("id", primeiro.contact_id).maybeSingle();

  const email = ((contato?.email as string | undefined) ?? "").trim();
  if (!email) {
    await writeLog(rule, trigger, boletosValidos, canal, "failed",
                   { error_message: "Contato sem e-mail cadastrado" });
    return;
  }

  // invoice_id real de cada linha, para _invoice_ids apontar para os boletos.
  const { data: linhas } = await db
    .from("automation_recipients").select("id, invoice_id")
    .in("id", boletosValidos.map((r) => r.id));
  const invoiceDe = new Map<string, string | null>(
    (linhas ?? []).map((l) => [l.id as string, l.invoice_id as string | null]));

  const boletos = boletosValidos.map((r) => ({
    id:            invoiceDe.get(r.id) ?? r.id,
    contact_id:    r.contact_id,
    valor:         r.valor,
    vencimento:    r.vencimento,
    numero_nf:     r.numero_nf,
    codigo_barras: r.codigo_barras,
    status:        "pendente",
  }));

  const valorTotal  = boletos.reduce((s, b) => s + (b.valor ?? 0), 0);
  const proximoVenc = boletos.map((b) => b.vencimento).filter(Boolean).sort()[0] ?? "";

  const recipientData: Record<string, unknown> = {
    ...(contato ?? {}),
    _financial_campaign:  true,
    valor_total_pendente: formatBRL(valorTotal),
    proximo_vencimento:   proximoVenc ? formatDate(proximoVenc) : undefined,
    invoice_detail_html:  buildInvoiceDetailHtml(boletos),
    _invoice_count:       boletos.length,
    _invoice_ids:         boletos.map((b) => b.id),
    contact_invoices:     boletos,
  };

  /* Assunto e corpo falam do conjunto, não de uma linha: {valor} é o total,
     {vencimento} é o mais próximo e {boleto} lista as notas. Sem isto o
     e-mail agrupado diria "seu boleto de R$ 1.200" tendo três dentro. */
  const agregado: Recipient = {
    ...primeiro,
    valor:      valorTotal,
    vencimento: proximoVenc,
    numero_nf:  boletos.map((b) => b.numero_nf).filter(Boolean).join(", ") || null,
  };

  const assunto = substituteAutoVars(trigger.email_subject ?? "", agregado, trigger.day_offset);
  const corpo   = substituteAutoVars(
    trigger.email_body_html ?? trigger.message_body ?? "", agregado, trigger.day_offset);
  if (!corpo.trim()) {
    await writeLog(rule, trigger, boletosValidos, canal, "failed",
                   { error_message: "Gatilho sem corpo de e-mail" });
    return;
  }

  /* Um e-mail, um crédito. Cobrar por boleto puniria o cliente justamente por
     o sistema ter feito a coisa certa e juntado tudo numa mensagem só. */
  const emailId = crypto.randomUUID();
  const credito = await consumirCredito(db, rule.workspace_id, "mensagem", {
    destino: email,
    canal:   "email",
    detalhe: { origem: "automacao", rule_id: rule.id, day_offset: trigger.day_offset,
               boletos: boletos.length },
  });
  if (!credito.permitido) {
    await writeLog(rule, trigger, boletosValidos, canal, "failed",
                   { error_message: `Sem créditos (saldo: ${credito.saldo})`, destino: email });
    return;
  }

  const resp = await fetch(N8N_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // ── Os mesmos campos da campanha, com os mesmos nomes ──
      campaign_id:     rule.id,          // a régua faz o papel da campanha
      workspace_id:    rule.workspace_id,
      campaign_name:   `${rule.name} — ${trigger.label}`,
      dispatched_at:   new Date().toISOString(),
      callback_api:    `${SUPABASE_URL}/functions/v1/update-campaign-status`,
      callback_secret: WEBHOOK_SECRET,
      recipients: [{
        /* Na campanha isto é o id da shooting_message. Aqui é o id do e-mail
           físico, que é o que existe do nosso lado para o callback casar: as
           linhas de log deste envio todas carregam ele em email_id. */
        message_id:     emailId,
        name:           primeiro.contact_name,
        phone:          primeiro.contact_phone,
        recipient_data: recipientData,
      }],
      // ── A mais, para o fluxo poder ramificar se quiser ──
      origem:        "automacao",
      rule_id:       rule.id,
      rule_name:     rule.name,
      trigger_id:    trigger.id,
      trigger_label: trigger.label,
      day_offset:    trigger.day_offset,
      email_id:      emailId,
      assunto,
      corpo_html:    corpo,
    }),
  });

  if (resp.ok) {
    await writeLog(rule, trigger, boletosValidos, canal, "sent",
                   { destino: email, email_id: emailId });
  } else {
    const txt = await resp.text().catch(() => "");
    await writeLog(rule, trigger, boletosValidos, canal, "failed",
                   { error_message: `N8N respondeu ${resp.status}: ${txt.slice(0, 200)}`,
                     destino: email, email_id: emailId });
  }
}

// ── Process one trigger + recipient pair (WhatsApp) ────────────────────────

async function processOne(rule: Rule, trigger: Trigger, recipient: Recipient): Promise<void> {
  // 1. Check invoice still pending (via invoice_id on the automation_recipients row)
  const { data: recipRow } = await db
    .from("automation_recipients")
    .select("invoice_id")
    .eq("id", recipient.id)
    .single();

  if (recipRow?.invoice_id) {
    const { data: inv } = await db
      .from("contact_invoices")
      .select("status")
      .eq("id", recipRow.invoice_id)
      .maybeSingle();
    if (inv && !PENDING.includes(inv.status)) {
      console.log(`[ticker] skip paid invoice: recipient=${recipient.id}`);
      return;
    }
  }

  // 2. Dedup — already sent for this trigger + recipient?
  const { data: existing } = await db
    .from("automation_logs")
    .select("id")
    .eq("trigger_id", trigger.id)
    .eq("recipient_id", recipient.id)
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log(`[ticker] skip dedup: trigger=${trigger.id} recipient=${recipient.id}`);
    return;
  }

  // 3. Resolve effective channel + connection
  const effectiveChannel = (trigger.channel ?? rule.channel) as string;
  const isZApi           = effectiveChannel === "z_api";

  try {
    if (isZApi) {
      // Fetch Z-API connection
      const connId = trigger.z_api_connection_id ?? rule.z_api_connection_id;
      if (!connId) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "No Z-API connection configured" });
        return;
      }

      const { data: conn } = await db
        .from("z_api_connections")
        .select("instance_id, token, client_token")
        .eq("id", connId)
        .single();

      if (!conn) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "Z-API connection not found" });
        return;
      }

      const instanceId   = conn.instance_id as string;
      const token        = await decrypt(conn.token        as string);
      const clientToken  = await decrypt(conn.client_token as string);

      let message: string;

      if (rule.template_mode === "unified" && rule.unified_message) {
        message = substituteAutoVars(rule.unified_message, recipient, trigger.day_offset);
      } else if (trigger.z_api_template_id) {
        // Per-trigger: Z-API template with column mapping
        const { data: tpl } = await db
          .from("z_api_templates")
          .select("body")
          .eq("id", trigger.z_api_template_id)
          .single();
        if (!tpl) {
          await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "Z-API template not found" });
          return;
        }
        message = substituteTemplateVars(tpl.body as string, trigger.column_mapping ?? {}, recipient);
        // Replace dias/status_vencimento manually since they need dayOffset
        const dias       = Math.abs(trigger.day_offset);
        const statusVenc = trigger.day_offset < 0 ? "a vencer" : trigger.day_offset === 0 ? "no dia" : "vencido";
        for (const [idx, field] of Object.entries(trigger.column_mapping ?? {})) {
          if (field === "dias")              message = message.replace(new RegExp(`\\{\\{${idx}\\}\\}`, "g"), String(dias));
          if (field === "status_vencimento") message = message.replace(new RegExp(`\\{\\{${idx}\\}\\}`, "g"), statusVenc);
        }
      } else if (trigger.message_body) {
        message = substituteAutoVars(trigger.message_body, recipient, trigger.day_offset);
      } else {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "No message configured for this trigger" });
        return;
      }

      const credito = await consumirCredito(db, rule.workspace_id, "mensagem", {
        destino: recipient.contact_phone,
        canal:   "whatsapp",
        detalhe: { origem: "automacao", rule_id: rule.id },
      });
      if (!credito.permitido) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed",
                       { error_message: `Sem créditos (saldo: ${credito.saldo})` });
        return;
      }

      const result = await sendZApiMessage(instanceId, token, clientToken, recipient.contact_phone, message);

      if (result.zaapId) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "sent", { zaap_id: result.zaapId });
      } else {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: result.error });
      }

    } else if (effectiveChannel === "meta") {
      // META channel
      const metaConnId   = trigger.meta_connection_id ?? rule.meta_connection_id;
      const metaTplId    = trigger.meta_template_id;

      if (!metaConnId || !metaTplId) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "META connection or template not configured" });
        return;
      }

      const { data: conn } = await db
        .from("meta_connections")
        .select("phone_number_id, access_token")
        .eq("id", metaConnId)
        .single();

      if (!conn) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "META connection not found" });
        return;
      }

      const { data: tpl } = await db
        .from("meta_templates")
        .select("template_name, language, components")
        .eq("id", metaTplId)
        .single();

      if (!tpl) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: "META template not found" });
        return;
      }

      const phoneNumberId = conn.phone_number_id as string;
      const accessToken   = await decrypt(conn.access_token as string);
      const components    = buildMetaComponents(
        tpl.components as MetaTemplateComp[],
        trigger.column_mapping ?? {},
        recipient,
        trigger.day_offset,
      );

      const credito = await consumirCredito(db, rule.workspace_id, "mensagem", {
        destino: recipient.contact_phone,
        canal:   "whatsapp",
        detalhe: { origem: "automacao", rule_id: rule.id },
      });
      if (!credito.permitido) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed",
                       { error_message: `Sem créditos (saldo: ${credito.saldo})` });
        return;
      }

      const result = await sendMetaTemplate(
        phoneNumberId, accessToken, recipient.contact_phone,
        tpl.template_name as string, tpl.language as string, components,
      );

      if (result.wamid) {
        await writeLog(rule, trigger, recipient, effectiveChannel, "sent", { wamid: result.wamid });
      } else {
        await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: result.error });
      }
    }
  } catch (err) {
    await writeLog(rule, trigger, recipient, effectiveChannel, "failed", { error_message: String(err) });
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // Allow pg_cron POST and manual triggers
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const hourUTC  = new Date().getUTCHours();
  const today    = todayISO();

  console.log(`[automation-ticker] start hour=${hourUTC} today=${today}`);

  // Load all active rules firing this hour
  const { data: rules, error: rulesErr } = await db
    .from("automation_rules")
    .select("*")
    .eq("status", "active")
    .eq("send_hour", hourUTC);

  if (rulesErr) {
    console.error("[automation-ticker] failed to load rules:", rulesErr.message);
    return new Response(JSON.stringify({ error: rulesErr.message }), { status: 500 });
  }

  let totalSent  = 0;
  let totalFailed = 0;

  for (const rule of (rules ?? []) as Rule[]) {
    console.log(`[automation-ticker] processing rule=${rule.id} name="${rule.name}"`);

    // Load enabled triggers for this rule
    const { data: triggers } = await db
      .from("automation_triggers")
      .select("*")
      .eq("rule_id", rule.id)
      .eq("enabled", true);

    for (const trigger of (triggers ?? []) as Trigger[]) {
      // targetVencimento = date whose day_offset fires today
      // e.g. day_offset=-1 means fire 1 day before: boletos with vencimento = tomorrow
      const targetVencimento = addDays(today, -trigger.day_offset);

      // Find recipients for this vencimento
      const { data: recipients } = await db
        .from("automation_recipients")
        .select("*")
        .eq("rule_id", rule.id)
        .eq("removed", false)
        .eq("vencimento", targetVencimento);

      const lista            = (recipients ?? []) as Recipient[];
      const effectiveChannel = (trigger.channel ?? rule.channel) as string;

      if (effectiveChannel === "n8n_email") {
        /* Um e-mail por cliente. Sem isto, três boletos do mesmo cliente
           vencendo no mesmo dia viravam três e-mails idênticos no mesmo
           minuto — que é spam, e não é o que a campanha faz. */
        const porContato = new Map<string, Recipient[]>();
        for (const r of lista) {
          const chave = r.contact_id ?? r.id;
          const atual = porContato.get(chave);
          if (atual) atual.push(r); else porContato.set(chave, [r]);
        }
        console.log(`[automation-ticker] trigger=${trigger.id}: ${lista.length} boleto(s) → ${porContato.size} e-mail(s)`);

        for (const grupo of porContato.values()) {
          try {
            await processarEmail(rule, trigger, grupo);
            totalSent++;
          } catch (err) {
            totalFailed++;
            console.error(`[automation-ticker] erro no e-mail do contato=${grupo[0]?.contact_id}:`, err);
            await writeLog(rule, trigger, grupo, "n8n_email", "failed",
                           { error_message: String(err) }).catch(() => {});
          }
          await sleep(800);
        }
      } else {
        for (const recipient of lista) {
          try {
            await processOne(rule, trigger, recipient);
            totalSent++;
          } catch (err) {
            totalFailed++;
            console.error(`[automation-ticker] error processing recipient=${recipient.id}:`, err);
          }
          await sleep(800); // brief pause between sends
        }
      }
    }

    /* Mensagens enviadas, não linhas de log: um e-mail com três boletos gera
       três linhas e é UMA mensagem. count(*) aqui diria 3 e estaria mentindo
       sobre quanto o cliente recebeu. A conta é feita no banco porque o
       PostgREST corta em 1000 linhas sem avisar. */
    const { data: enviadas } = await db
      .rpc("automation_mensagens_enviadas", { p_rule_id: rule.id });

    await db.from("automation_rules").update({
      sent_count: (enviadas as number | null) ?? 0,
      updated_at: new Date().toISOString(),
    }).eq("id", rule.id);
  }

  const msg = `automation-ticker done: rules=${(rules ?? []).length} sent=${totalSent} failed=${totalFailed}`;
  console.log(`[automation-ticker] ${msg}`);
  return new Response(JSON.stringify({ ok: true, msg }), {
    headers: { "Content-Type": "application/json" },
  });
});
