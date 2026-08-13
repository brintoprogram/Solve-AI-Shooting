// Navegação do celular.
//
// Antes eram cinco destinos fixos no código, de um sistema que tem vinte. Não
// havia Equipe, então convidar alguém pelo telefone era impossível; não havia
// Relacionamento, Créditos, Negociações nem Atividade. E a lista ignorava
// permissões, então "Disparos" aparecia para quem ia bater numa parede.
//
// Agora a barra tem os atalhos e o botão Menu abre TUDO, do mesmo mapa que a
// sidebar usa. Nenhuma tela nova precisa lembrar de se cadastrar aqui.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { gruposVisiveis, NAV_GROUPS, DEMO_ITEM, isAllowed, type NavItem } from "./navegacao";

/* Ordem de preferência para os atalhos da barra. Os quatro primeiros que a
   pessoa PODE acessar entram — sem isto, um usuário sem permissão de disparo
   ficaria com a barra pela metade. */
const PREFERIDOS = ["/", "/inbox", "/contacts", "/shooting", "/alerts", "/tutoriais"];

export function MobileBottomNav() {
  const { profile, workspaces, workspaceId } = useAuth();
  const { pathname } = useLocation();
  const [aberto, setAberto] = useState(false);

  const isDemo = workspaces.find((w) => w.id === workspaceId)?.name.toLowerCase().includes("demo") ?? false;
  const grupos = gruposVisiveis(profile, isDemo);

  // Trocar de tela fecha o menu. Sem isto ele fica por cima do destino.
  useEffect(() => { setAberto(false); }, [pathname]);

  // Menu aberto trava a rolagem do fundo — senão o dedo arrasta a página de
  // trás e a pessoa perde o lugar onde estava.
  useEffect(() => {
    if (!aberto) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    window.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = antes; window.removeEventListener("keydown", esc); };
  }, [aberto]);

  const todos: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.itens), DEMO_ITEM];
  const atalhos = PREFERIDOS
    .map((to) => todos.find((i) => i.to === to))
    .filter((i): i is NavItem => Boolean(i) && isAllowed(profile, i as NavItem))
    .slice(0, 4);

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around"
        style={{
          background: "#0d1a11",
          borderTop: "1px solid rgba(63,176,108,0.1)",
          backdropFilter: "blur(12px)",
          // Barra de gestos do iPhone: sem isto os rótulos ficam embaixo dela.
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {atalhos.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[56px] transition-colors ${
                isActive ? "text-[#3fb06c]" : "text-[#6b8a75]"}`}
          >
            {({ isActive }) => (
              <>
                <Icon className="w-5 h-5" style={isActive ? { filter: "drop-shadow(0 0 6px rgba(63,176,108,0.5))" } : {}} />
                <span className="text-[10px] font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}

        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir menu"
          className={`flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[56px] transition-colors ${
            aberto ? "text-[#3fb06c]" : "text-[#6b8a75]"}`}
        >
          <Menu className="w-5 h-5" />
          <span className="text-[10px] font-medium">Menu</span>
        </button>
      </nav>

      {/* Portal para o body: qualquer ancestral com transform prenderia um
          elemento fixed dentro dele, e a folha abriria no lugar errado — ou
          simplesmente não apareceria. */}
      {aberto && createPortal(
        <div className="md:hidden fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setAberto(false)}
            aria-hidden
          />

          <div
            className="absolute inset-x-0 bottom-0 max-h-[85vh] flex flex-col rounded-t-2xl overflow-hidden"
            style={{ background: "#0d1a11", borderTop: "1px solid rgba(63,176,108,0.18)" }}
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
          >
            <div className="flex items-center justify-between px-5 py-4 shrink-0"
                 style={{ borderBottom: "1px solid rgba(63,176,108,0.1)" }}>
              <p className="font-display text-base font-bold text-agro-text">Ir para</p>
              <button
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar menu"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-agro-muted hover:text-agro-text"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto scrollbar-thin px-3 py-3"
                 style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
              {grupos.map((g) => (
                <div key={g.id} className="mb-4 last:mb-0">
                  <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-agro-muted-2">
                    {g.label}
                  </p>
                  <div className="space-y-0.5">
                    {g.itens.map(({ to, icon: Icon, label, subtitle }) => (
                      <NavLink
                        key={to}
                        to={to}
                        end={to === "/"}
                        className={({ isActive }) =>
                          `flex items-center gap-3 px-2 py-2.5 rounded-xl transition-colors ${
                            isActive ? "bg-agro-accent/15 text-agro-text" : "text-agro-muted active:bg-white/5"}`}
                      >
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                              style={{ background: "rgba(63,176,108,0.1)" }}>
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium leading-tight">{label}</span>
                          <span className="block text-[11px] text-agro-muted-2 leading-tight mt-0.5 truncate">
                            {subtitle}
                          </span>
                        </span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
