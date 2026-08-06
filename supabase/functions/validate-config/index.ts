// Supabase Edge Function — Validate Config
//
// Alimenta o botão "Testar agora" do guia de configuração. Faz verificações
// que o frontend não consegue: a chave de IA fica criptografada no banco e a
// chamada ao provedor exige o segredo em claro (que nunca pode ir ao browser).
//
// POST { workspace_id, check: "ai" | "meta" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";
import { requireWorkspaceMember } from "../_shared/auth.ts";
import { corsHeaders as getCors } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const META_API = "https://graph.facebook.com/v25.0";

interface CheckResult {
  ok:      boolean;
  message: string;
  detail?: string;
}

/** Chamada real e barata ao provedor: 1 token de saída só para provar que a chave vale. */
async function checkAi(workspaceId: string): Promise<CheckResult> {
  const { data: ws } = await supabase
    .from("workspaces")
    .select("ai_provider, anthropic_api_key, openai_api_key")
    .eq("id", workspaceId)
    .maybeSingle();

  const provider = (ws?.ai_provider ?? "anthropic") as "anthropic" | "openai";
  const raw = provider === "openai" ? ws?.openai_api_key : ws?.anthropic_api_key;

  if (!raw) {
    return { ok: false, message: "Nenhuma chave salva ainda.", detail: `Configurações → IA (provedor: ${provider})` };
  }

  let key: string;
  try {
    key = await decrypt(raw as string);
  } catch {
    return { ok: false, message: "A chave salva não pôde ser lida.", detail: "Salve a chave novamente em Configurações → IA." };
  }

  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1, messages: [{ role: "user", content: "oi" }] }),
      });
      if (res.ok) return { ok: true, message: "Chave da OpenAI funcionando." };
      if (res.status === 401) return { ok: false, message: "Chave rejeitada pela OpenAI.", detail: "Confira se copiou a chave inteira." };
      if (res.status === 429) return { ok: false, message: "Chave válida, mas sem créditos.", detail: "Adicione saldo na conta da OpenAI." };
      return { ok: false, message: `OpenAI respondeu ${res.status}.`, detail: (await res.text()).slice(0, 160) };
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "oi" }] }),
    });
    if (res.ok) return { ok: true, message: "Chave da Anthropic funcionando." };
    if (res.status === 401) return { ok: false, message: "Chave rejeitada pela Anthropic.", detail: "Confira se copiou a chave inteira (começa com sk-ant-)." };
    if (res.status === 429) return { ok: false, message: "Chave válida, mas sem créditos ou com limite atingido.", detail: "Verifique o saldo no console da Anthropic." };
    return { ok: false, message: `Anthropic respondeu ${res.status}.`, detail: (await res.text()).slice(0, 160) };
  } catch (e) {
    return { ok: false, message: "Não foi possível falar com o provedor.", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Confirma que o token da Meta ainda vale e que o número está registrado. */
async function checkMeta(workspaceId: string): Promise<CheckResult> {
  const { data: conns } = await supabase
    .from("meta_connections")
    .select("id, display_phone, phone_number_id, access_token, status, quality_rating")
    .eq("workspace_id", workspaceId);

  if (!conns || conns.length === 0) {
    return { ok: false, message: "Nenhum número da Meta conectado.", detail: "Use o botão 'Conectar pela Meta'." };
  }

  const conn = conns.find((c) => c.status === "active") ?? conns[0];
  try {
    const token = await decrypt(conn.access_token as string);
    const res = await fetch(`${META_API}/${conn.phone_number_id}?fields=display_phone_number,quality_rating`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const code = (body as { error?: { code?: number } })?.error?.code;
      if (code === 190) {
        // Marca no banco para o checklist mostrar "reconecte"
        await supabase.from("meta_connections").update({ status: "token_expired" }).eq("id", conn.id);
        return { ok: false, message: "O token da Meta expirou.", detail: "Refaça a conexão pelo botão 'Conectar pela Meta'." };
      }
      return { ok: false, message: `A Meta respondeu ${res.status}.`, detail: JSON.stringify(body).slice(0, 160) };
    }
    const info = await res.json() as { display_phone_number?: string; quality_rating?: string };
    return {
      ok: true,
      message: `Número ${info.display_phone_number ?? conn.display_phone} respondendo.`,
      detail: info.quality_rating ? `Qualidade segundo a Meta: ${info.quality_rating}` : undefined,
    };
  } catch (e) {
    return { ok: false, message: "Não foi possível falar com a Meta.", detail: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req: Request) => {
  const CORS = getCors(req);
  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  let body: { workspace_id?: string; check?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { workspace_id, check } = body;
  if (!workspace_id || !check) return json({ error: "workspace_id e check são obrigatórios" }, 400);

  const authErr = await requireWorkspaceMember(supabase, req, workspace_id);
  if (authErr) return json({ error: authErr }, 401);

  const result = check === "ai"   ? await checkAi(workspace_id)
               : check === "meta" ? await checkMeta(workspace_id)
               : null;

  if (!result) return json({ error: "check desconhecido" }, 400);
  return json(result);
});
