// Edge Function — support-notify
// POST { ticket_id, event }
// event: 'created' | 'user_replied' | 'staff_replied' | 'closed'
//
// created / user_replied  → email para workspace.support_email (admin)
// staff_replied           → email para o criador do ticket

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Verify caller JWT — failures are silent so the UI is never blocked
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: true });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: { user: caller } } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!caller) return json({ ok: true });

  let body: { ticket_id?: string; event?: string };
  try { body = await req.json(); } catch { return json({ ok: true }); }

  const { ticket_id, event } = body;
  if (!ticket_id || !event) return json({ ok: true });

  try {
    const { data: ticket } = await admin
      .from("support_tickets")
      .select("*")
      .eq("id", ticket_id)
      .maybeSingle();

    if (!ticket) return json({ ok: true });

    const { data: workspace } = await (admin as unknown as { from: (t: string) => { select: (s: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: Record<string, string> | null }> } } } })
      .from("workspaces")
      .select("support_email, name")
      .eq("id", ticket.workspace_id)
      .maybeSingle();

    const supportEmail = (workspace as Record<string, string> | null)?.support_email;

    const { data: { user: creator } } = await admin.auth.admin.getUserById(ticket.created_by);

    const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_KEY) {
      console.warn("[support-notify] RESEND_API_KEY não configurado");
      return json({ ok: true });
    }

    const origin = req.headers.get("origin") ?? req.headers.get("referer")?.split("/").slice(0, 3).join("/");
    const appUrl = Deno.env.get("APP_URL") ?? origin ?? "https://system.solveai.consulting";
    const supportUrl = `${appUrl}/support`;

    async function sendEmail(to: string, subject: string, html: string): Promise<void> {
      const res = await fetch("https://api.resend.com/emails", {
        method:  "POST",
        headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Solve AI Suporte <suporte@solveai.consulting>",
          to,
          subject,
          html,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[support-notify] Resend error ${res.status}:`, body);
      }
    }

    const creatorName = creator?.user_metadata?.full_name ?? creator?.email ?? "Usuário";
    const ticketLink  = `<a href="${supportUrl}" style="color:#3fb06c;">Ver no sistema →</a>`;

    if (event === "created" || event === "user_replied") {
      if (!supportEmail) {
        console.warn("[support-notify] support_email não configurado no workspace");
        return json({ ok: true });
      }

      const isNew   = event === "created";
      const subject = isNew ? `[Novo Ticket] ${ticket.title}` : `[Resposta] ${ticket.title}`;
      const html    = `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h2 style="color:#3fb06c;margin-bottom:8px">Solve AI — Suporte</h2>
          <p style="color:#555">${isNew ? "Novo ticket aberto" : "Resposta recebida"} por <strong>${creatorName}</strong>.</p>
          <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0">
            <p style="margin:0 0 8px"><strong>Título:</strong> ${ticket.title}</p>
            <p style="margin:0"><strong>Status:</strong> ${ticket.status}</p>
          </div>
          <p>${ticketLink}</p>
        </div>
      `;
      await sendEmail(supportEmail, subject, html);
      console.log(`[support-notify] ✓ notificação enviada para admin (${supportEmail})`);

    } else if (event === "staff_replied") {
      if (!creator?.email) return json({ ok: true });

      const html = `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h2 style="color:#3fb06c;margin-bottom:8px">Solve AI — Suporte</h2>
          <p style="color:#555">A equipe de suporte respondeu ao seu ticket <strong>${ticket.title}</strong>.</p>
          <p>${ticketLink}</p>
          <p style="color:#999;font-size:12px">Você receberá um email a cada vez que a equipe responder.</p>
        </div>
      `;
      await sendEmail(creator.email, `Re: [Ticket] ${ticket.title}`, html);
      console.log(`[support-notify] ✓ notificação enviada para usuário (${creator.email})`);

    } else if (event === "closed") {
      if (!creator?.email) return json({ ok: true });

      const html = `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h2 style="color:#3fb06c;margin-bottom:8px">Solve AI — Suporte</h2>
          <p style="color:#555">Seu ticket <strong>${ticket.title}</strong> foi encerrado pela equipe de suporte.</p>
          <p style="color:#999;font-size:12px">Se precisar de mais ajuda, abra um novo ticket.</p>
        </div>
      `;
      await sendEmail(creator.email, `[Ticket Encerrado] ${ticket.title}`, html);
    }
  } catch (err) {
    console.error("[support-notify] erro:", err instanceof Error ? err.message : String(err));
  }

  return json({ ok: true });
});
