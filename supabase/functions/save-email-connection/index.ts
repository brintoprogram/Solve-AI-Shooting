// Supabase Edge Function — Save Email Connection (with encrypted password)
// Deploy: npx supabase functions deploy save-email-connection
//
// POST body: same fields as email_connections table (password is encrypted before storing)
// Called from Settings.tsx instead of direct supabase.from("email_connections").insert()

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encrypt } from "../_shared/crypto.ts";


const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  // Verify calling user
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const workspace_id = body.workspace_id as string;
  if (!workspace_id) return json({ error: "workspace_id required" }, 400);

  const password = body.password as string | undefined;

  const { data, error } = await supabase
    .from("email_connections")
    .insert({
      workspace_id,
      name:       body.name,
      provider:   body.provider,
      host:       body.host       ?? "",
      port:       body.port       ?? 0,
      secure:     body.secure     ?? false,
      username:   body.username   ?? "",
      password:   password ? await encrypt(password) : "",
      tenant_id:  body.tenant_id  ?? null,
      client_id:  body.client_id  ?? null,
      from_name:  body.from_name,
      from_email: body.from_email,
    })
    .select("id,name,provider,host,port,secure,username,from_name,from_email,tenant_id,client_id")
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, data });
});
