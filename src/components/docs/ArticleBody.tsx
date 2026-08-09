// Corpo de um artigo — usado pelo dossiê (/tutoriais) E pelos primeiros passos.
//
// Extraído de SetupGuide.tsx para que as duas telas mostrem a mesma coisa. Um
// tutorial renderizado de dois jeitos diferentes é um tutorial que vai divergir:
// alguém melhora o espaçamento de um lado e o outro fica para trás.
//
// A tabela de campos (`campos`) é a parte que não existia nos primeiros passos —
// é ela que transforma "como configurar" em "o que cada campo faz e no que dá
// mexer nele".

import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ExternalLink, Lightbulb, ListChecks, Timer, Lock, Table2 } from "lucide-react";
import { useAuth, hasPermission } from "@/context/AuthContext";
import type { ArtigoRenderizavel } from "@/types/docs";

export function ArticleBody({
  artigo,
  acoesExtras,
}: {
  artigo: ArtigoRenderizavel;
  /** Botões específicos da tela que hospeda (ex.: "Testar agora"). */
  acoesExtras?: ReactNode;
}) {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const podeAbrir = !artigo.routePerm || hasPermission(profile, artigo.routePerm);

  return (
    <div className="space-y-5 pt-4">
      <div className="text-sm text-agro-muted leading-relaxed">{artigo.why}</div>

      {artigo.eta && (
        <div className="flex items-center gap-2 text-xs text-agro-muted-2">
          <Timer className="w-3.5 h-3.5 shrink-0" />
          <span>{artigo.eta}</span>
        </div>
      )}

      {artigo.requires && artigo.requires.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(63,176,108,0.1)" }}>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-2.5">
            <ListChecks className="w-3.5 h-3.5" /> Tenha em mãos antes de começar
          </p>
          <ul className="space-y-1.5">
            {artigo.requires.map((r) => (
              <li key={r} className="flex gap-2 text-sm text-agro-text">
                <span className="text-agro-green shrink-0">•</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {artigo.how && artigo.how.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-3">Passo a passo</p>
          <ol className="space-y-2.5">
            {artigo.how.map((h, i) => (
              <li key={h} className="flex gap-3 text-sm text-agro-text leading-relaxed">
                <span
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                  style={{ background: "rgba(63,176,108,0.15)", color: "#3fb06c" }}
                >
                  {i + 1}
                </span>
                {h}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Referência campo a campo. */}
      {artigo.campos && artigo.campos.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-agro-muted-2 mb-3">
            <Table2 className="w-3.5 h-3.5" /> O que cada campo faz
          </p>
          <div className="space-y-2">
            {artigo.campos.map((c) => (
              <div
                key={c.label}
                className="rounded-xl p-3.5"
                style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(63,176,108,0.1)" }}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <p className="text-sm font-semibold text-agro-text">{c.label}</p>
                  {c.padrao && (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 tabular-nums"
                      style={{ background: "rgba(63,176,108,0.12)", color: "#3fb06c" }}
                      title="Como vem de fábrica"
                    >
                      padrão: {c.padrao}
                    </span>
                  )}
                </div>
                <p className="text-sm text-agro-muted mt-1 leading-relaxed">{c.what}</p>
                {c.efeito && (
                  <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "#8faf9a" }}>
                    {c.efeito}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {artigo.gotchas && artigo.gotchas.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest mb-2.5" style={{ color: "#fbbf24" }}>
            <Lightbulb className="w-3.5 h-3.5" /> Onde as pessoas travam
          </p>
          <ul className="space-y-1.5">
            {artigo.gotchas.map((g) => (
              <li key={g} className="text-sm leading-relaxed" style={{ color: "#e5c07b" }}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {artigo.route && (
          <button
            onClick={() => podeAbrir && navigate(artigo.route!)}
            disabled={!podeAbrir}
            title={podeAbrir ? undefined : "Você não tem permissão para acessar esta tela"}
            className="btn-agro flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:cursor-not-allowed"
            style={podeAbrir ? undefined : { opacity: 0.35 }}
          >
            {artigo.routeLabel ?? "Abrir"}
            {podeAbrir ? <ChevronRight className="w-4 h-4" /> : <Lock className="w-3.5 h-3.5" />}
          </button>
        )}
        {artigo.external && (
          <a
            href={artigo.external.url} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-agro-text"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(63,176,108,0.2)" }}
          >
            {artigo.external.label} <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        {acoesExtras}
      </div>
    </div>
  );
}
