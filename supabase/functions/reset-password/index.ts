// Edge Function — reset-password
// POST { email }
// Sends a password reset only if the email belongs to a registered workspace member.
// Always returns { ok: true } to prevent email enumeration.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as getCors } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { email?: string };
  try { body = await req.json(); }
  catch { return json({ ok: true }); } // silent — don't leak parse errors

  const email = body.email?.trim().toLowerCase();
  if (!email) return json({ ok: true });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Check if email belongs to a user who is a member of at least one workspace
    const { data: listData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = (listData?.users ?? []).find((u) => u.email === email);

    if (user) {
      const { count } = await admin
        .from("workspace_members")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", user.id);

      if ((count ?? 0) > 0) {
        const origin = req.headers.get("origin") ?? req.headers.get("referer")?.split("/").slice(0, 3).join("/");
        const appUrl = Deno.env.get("APP_URL") ?? origin ?? "https://system.solveai.consulting";

        const anonClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
        );
        await anonClient.auth.resetPasswordForEmail(email, { redirectTo: appUrl });
        console.log(`[reset-password] ✓ link enviado para ${email}`);
      } else {
        console.log(`[reset-password] email existe mas não é membro de nenhum workspace: ${email}`);
      }
    } else {
      console.log(`[reset-password] email não encontrado no sistema: ${email}`);
    }
  } catch (err) {
    // Log internally but don't expose to client
    console.error("[reset-password] erro:", err instanceof Error ? err.message : String(err));
  }

  // Always return the same response — never reveal if email exists
  return json({ ok: true });
});
