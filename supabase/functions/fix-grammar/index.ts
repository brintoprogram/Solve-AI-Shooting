import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

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

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content:
              "Você é um assistente de revisão de texto em português brasileiro. " +
              "Corrija apenas erros gramaticais, ortográficos e de pontuação. " +
              "Mantenha o tom, estilo e intenção originais do texto. " +
              "Responda APENAS com o texto corrigido, sem explicações, aspas ou formatação adicional.",
          },
          {
            role: "user",
            content: text,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI ${res.status}: ${body}`);
    }

    const data = await res.json();
    const corrected = (data.choices?.[0]?.message?.content as string | undefined)?.trim() ?? text;

    return Response.json({ corrected }, { headers: cors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao corrigir";
    return Response.json({ error: msg }, { status: 500, headers: cors });
  }
});
