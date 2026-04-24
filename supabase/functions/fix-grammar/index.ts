import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { text } = await req.json();
    if (!text?.trim()) {
      return Response.json({ error: "text required" }, { status: 400, headers: cors });
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content:
              `Corrija a gramática e ortografia do texto abaixo em português brasileiro. ` +
              `Mantenha o tom, estilo e intenção originais. ` +
              `Corrija apenas erros gramaticais, ortográficos e de pontuação. ` +
              `Responda APENAS com o texto corrigido, sem explicações, aspas ou formatação adicional.\n\n` +
              `Texto: ${text}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic ${res.status}: ${body}`);
    }

    const data = await res.json();
    const corrected = (data.content?.[0]?.text as string | undefined)?.trim() ?? text;

    return Response.json({ corrected }, { headers: cors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao corrigir";
    return Response.json({ error: msg }, { status: 500, headers: cors });
  }
});
