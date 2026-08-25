// Perfis de planilha: reconhecer o formato que o cliente manda todo mês.
//
// REGRA QUE GOVERNA ESTE ARQUIVO: nada aqui pode quebrar a importação. Toda
// função falha para o lado silencioso — sem perfil, sem erro, sem bloqueio. Se
// a tabela não existir, se a RLS negar, se o JSON estiver corrompido, o
// importador se comporta exatamente como antes deste recurso existir.
//
// Isso não é excesso de cuidado: perfil é conveniência, importação é o
// trabalho. Trocar "importa sem sugestão" por "não importa" seria um péssimo
// negócio, e é o modo de falhar natural de um recurso que consulta o banco no
// meio de um fluxo que antes era todo local.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Mapping, OrdemData } from "./importUtils";

/* import_profiles é nova e ainda não está em src/types/database.ts. Regenerar
   aquele arquivo hoje quebra 105 outros pontos — é tarefa separada, não efeito
   colateral deste recurso. */
const db = supabase as unknown as SupabaseClient;

export interface PerfilDeImportacao {
  id: string;
  nome: string;
  colunas: string[];
  mapeamento: Mapping;
  ordem_data: OrdemData;
  usos: number;
  ultimo_uso: string | null;
}

/** Minúsculo, sem acento, sem espaço sobrando. O mesmo tratamento dos dois
 *  lados, senão "Due Date" e "due date " deixam de ser a mesma coluna. */
export function normalizar(cabecalho: string): string {
  return cabecalho.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

/**
 * Quanto um perfil se parece com a planilha, de 0 a 1.
 *
 * Jaccard, e não "quantas colunas do perfil existem no arquivo": esta segunda
 * daria 1,0 para um perfil de duas colunas contra uma planilha de trinta, e o
 * sistema anunciaria com confiança que reconheceu um formato que não é aquele.
 * Punir a diferença dos dois lados é o que impede o falso reconhecimento.
 */
export function semelhanca(perfil: PerfilDeImportacao, cabecalhos: string[]): number {
  const doArquivo = new Set(cabecalhos.map(normalizar).filter(Boolean));
  const doPerfil  = new Set(perfil.colunas.map(normalizar).filter(Boolean));
  if (doArquivo.size === 0 || doPerfil.size === 0) return 0;

  let comuns = 0;
  for (const c of doPerfil) if (doArquivo.has(c)) comuns++;
  const uniao = doArquivo.size + doPerfil.size - comuns;
  return uniao === 0 ? 0 : comuns / uniao;
}

/** Abaixo disto não vale anunciar reconhecimento: a sugestão errada custa mais
 *  que a ausência de sugestão, porque a pessoa confia e não confere. */
export const LIMIAR = 0.7;

export function melhorPerfil(
  perfis: PerfilDeImportacao[],
  cabecalhos: string[],
): { perfil: PerfilDeImportacao; score: number } | null {
  let melhor: { perfil: PerfilDeImportacao; score: number } | null = null;
  for (const p of perfis) {
    const score = semelhanca(p, cabecalhos);
    if (score >= LIMIAR && (!melhor || score > melhor.score)) melhor = { perfil: p, score };
  }
  return melhor;
}

/**
 * O mapeamento do perfil traduzido para os cabeçalhos DESTE arquivo.
 *
 * A tradução passa pelo nome normalizado porque o mesmo relatório exportado
 * duas vezes pode vir com "Due Date" e "DUE DATE". Colunas que o perfil não
 * conhece ficam com o que a detecção automática já tinha achado — assim uma
 * coluna nova no meio do arquivo não desaparece só por ser nova.
 */
export function aplicarPerfil(
  perfil: PerfilDeImportacao,
  cabecalhos: string[],
  detectado: Mapping,
): Mapping {
  const porNome = new Map<string, string>();
  for (const [col, campo] of Object.entries(perfil.mapeamento)) {
    if (campo) porNome.set(normalizar(col), campo);
  }

  const saida: Mapping = {};
  const usados = new Set<string>();
  for (const h of cabecalhos) {
    const doPerfil = porNome.get(normalizar(h));
    // Um campo só pode ser usado uma vez: se o perfil e a detecção apontarem
    // para o mesmo destino, quem manda é o perfil, que já foi conferido.
    if (doPerfil && !usados.has(doPerfil)) {
      saida[h] = doPerfil as Mapping[string];
      usados.add(doPerfil);
    }
  }
  for (const h of cabecalhos) {
    if (saida[h]) continue;
    const auto = detectado[h];
    saida[h] = auto && !usados.has(auto) ? auto : "";
    if (saida[h]) usados.add(saida[h] as string);
  }
  return saida;
}

// ── Banco ─────────────────────────────────────────────────────────
// Todas silenciosas por decisão, não por descuido. Ver o comentário do topo.

export async function listarPerfis(workspaceId: string): Promise<PerfilDeImportacao[]> {
  try {
    const { data, error } = await db
      .from("import_profiles")
      .select("id, nome, colunas, mapeamento, ordem_data, usos, ultimo_uso")
      .eq("workspace_id", workspaceId)
      .order("ultimo_uso", { ascending: false, nullsFirst: false })
      .limit(50);
    if (error) return [];
    return (data ?? []) as PerfilDeImportacao[];
  } catch {
    return [];
  }
}

export async function salvarPerfil(args: {
  workspaceId: string;
  nome: string;
  cabecalhos: string[];
  mapeamento: Mapping;
  ordemData: OrdemData;
  criadoPor?: string | null;
}): Promise<{ ok: boolean; erro?: string }> {
  try {
    const { error } = await db.from("import_profiles").insert({
      workspace_id: args.workspaceId,
      nome: args.nome.trim(),
      colunas: args.cabecalhos.map(normalizar).filter(Boolean),
      mapeamento: args.mapeamento,
      ordem_data: args.ordemData,
      criado_por: args.criadoPor ?? null,
      usos: 1,
      ultimo_uso: new Date().toISOString(),
    });
    if (error) {
      // 23505 = nome repetido no workspace. É a única falha que a pessoa
      // consegue corrigir, então é a única que vale contar para ela.
      return { ok: false, erro: error.code === "23505" ? "Já existe um formato com esse nome." : "Não foi possível salvar o formato." };
    }
    return { ok: true };
  } catch {
    return { ok: false, erro: "Não foi possível salvar o formato." };
  }
}

/** Atualiza o perfil com o que foi conferido agora e conta mais um uso.
 *  Silenciosa: a importação já aconteceu, e falhar aqui não pode manchar um
 *  resultado que deu certo. */
export async function registrarUso(
  perfil: PerfilDeImportacao,
  mapeamento: Mapping,
  ordemData: OrdemData,
): Promise<void> {
  try {
    await db.from("import_profiles").update({
      mapeamento,
      ordem_data: ordemData,
      usos: (perfil.usos ?? 0) + 1,
      ultimo_uso: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", perfil.id);
  } catch { /* ver o comentário do topo */ }
}

// ── Desfazer uma importação ───────────────────────────────────────

export interface ResultadoDesfazer {
  ok: boolean;
  resumo?: string;
  erro?: string;
}

/**
 * Devolve a base ao estado anterior a uma importação.
 *
 * Ao contrário do resto deste arquivo, esta NÃO falha em silêncio: quem clicou
 * em desfazer precisa saber se desfez. Silêncio aqui faria a pessoa achar que
 * a base voltou quando não voltou, e é justamente o momento em que ela vai
 * reimportar por cima.
 */
export async function desfazerImportacao(runId: string): Promise<ResultadoDesfazer> {
  try {
    const { data, error } = await db.rpc("desfazer_importacao", { p_run_id: runId });
    if (error) return { ok: false, erro: error.message };

    const r = (data ?? {}) as Record<string, number>;
    const partes: string[] = [];
    if (r.boletos_removidos)    partes.push(`${r.boletos_removidos} boleto(s) removido(s)`);
    if (r.contatos_removidos)   partes.push(`${r.contatos_removidos} contato(s) removido(s)`);
    if (r.contatos_restaurados) partes.push(`${r.contatos_restaurados} contato(s) restaurado(s)`);
    if (r.contatos_mantidos)    partes.push(`${r.contatos_mantidos} mantido(s) por já ter conversa`);

    return { ok: true, resumo: partes.length ? partes.join(" · ") : "Nada havia para desfazer." };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao desfazer." };
  }
}
