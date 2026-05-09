// Deterministic light-variation engine for Z-API templates.
// Swaps well-known Portuguese phrases at a fixed position determined by `seed`,
// so every contact in a campaign gets a slightly different wording while
// variables ({{1}}, {{2}}, …) and meaning are always preserved.

type PhraseGroup = [RegExp, string[]];

const VARIATION_GROUPS: PhraseGroup[] = [
  // Greetings at line start
  [/^(E aí|Eaí|Eai|Oi|Oii|Olá|Ola|Ei|Hey)\b/im,
   ["E aí", "Oi", "Olá", "Ei"]],

  // Question complements
  [/\btudo certo\?/gi,  ["tudo certo?", "tudo bem?", "como vai?"]],
  [/\btudo bem\?/gi,    ["tudo bem?", "tudo certo?", "como vai?"]],
  [/\bcomo vai\?/gi,    ["como vai?", "tudo bem?", "tudo certo?"]],

  // Opening phrases
  [/Passando para (avisar|informar)\b/gi,
   ["Passando para avisar", "Só te avisando", "Passando para informar"]],
  [/Só te avisando\b/gi,
   ["Só te avisando", "Passando para avisar", "Só informando"]],
  [/Só informando\b/gi,
   ["Só informando", "Só te avisando", "Passando para informar"]],

  // CTA variants
  [/responda por aqui\b/gi,
   ["responda por aqui", "pode me chamar por aqui", "me chame aqui"]],
  [/pode me chamar por aqui\b/gi,
   ["pode me chamar por aqui", "responda por aqui", "fala comigo aqui"]],
  [/me chame aqui\b/gi,
   ["me chame aqui", "responda por aqui", "pode me chamar por aqui"]],
];

function extractVars(text: string): string[] {
  return (text.match(/\{\{\d+\}\}/g) ?? []).sort();
}

function validateVars(original: string, varied: string): boolean {
  const a = extractVars(original);
  const b = extractVars(varied);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function applyLightVariation(text: string, seed: number): string {
  try {
    // 1. Protect variable tokens with unique placeholders
    const tokens: string[] = [];
    const protected_ = text.replace(/\{\{\d+\}\}/g, (match) => {
      const idx = tokens.length;
      tokens.push(match);
      return `\x00VAR${idx}\x00`;
    });

    // 2. Apply phrase substitutions
    let varied = protected_;
    for (const [pattern, options] of VARIATION_GROUPS) {
      if (pattern.test(varied)) {
        const choice = options[seed % options.length];
        // Reset lastIndex for global regexes
        pattern.lastIndex = 0;
        varied = varied.replace(pattern, choice);
        pattern.lastIndex = 0;
      }
    }

    // 3. Restore variable tokens
    const restored = varied.replace(/\x00VAR(\d+)\x00/g, (_, i) => tokens[Number(i)]);

    // 4. Safety: validate vars are identical
    if (!validateVars(text, restored)) return text;

    return restored;
  } catch {
    return text;
  }
}

export function getVariationExamples(text: string, count = 3): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  seen.add(text);

  // Seed 0 = original (may or may not differ). Try seeds 0..count*3 to get distinct ones.
  for (let s = 0; s < count * 4 && results.length < count; s++) {
    const v = applyLightVariation(text, s);
    if (!seen.has(v)) {
      seen.add(v);
      results.push(v);
    }
  }

  // Pad with original if not enough distinct variations exist
  while (results.length < count) {
    results.push(text);
  }

  return results;
}
