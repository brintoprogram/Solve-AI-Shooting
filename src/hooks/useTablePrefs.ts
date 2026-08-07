// Preferências de exibição da tabela de contatos.
//
// Por que localStorage e não o banco: densidade e escolha de coluna são
// preferências de QUEM OLHA, não do workspace. Duas pessoas do mesmo time
// querem colunas diferentes — o cobrador quer saldo e vencimento, o cadastro
// quer endereço. Guardar no workspace faria uma sobrescrever a outra.
//
// Note que NÃO reaproveito `useContactFields`: aquilo controla
// `workspaces.shooting_visible_fields`, que define as variáveis disponíveis nas
// mensagens de campanha. Ligar as duas coisas faria esconder uma coluna aqui
// quebrar a variável de uma campanha lá.

import { useCallback, useEffect, useState } from "react";

export type Densidade = "compacta" | "confortavel";

/** Colunas opcionais da tabela. Nome e saldo não entram: são o motivo da tela. */
export const COLUNAS_OPCIONAIS = [
  { key: "phone",         label: "Telefone"      },
  { key: "cpf_cnpj",      label: "CPF / CNPJ"    },
  { key: "email",         label: "Email"         },
  { key: "representante", label: "Representante" },
  { key: "vencimento",    label: "Próx. venc."   },
  { key: "cidade",        label: "Cidade / UF"   },
  { key: "tags",          label: "Tags"          },
] as const;

export type ColunaKey = typeof COLUNAS_OPCIONAIS[number]["key"];

const TODAS: ColunaKey[] = COLUNAS_OPCIONAIS.map((c) => c.key);

const CHAVE_DENSIDADE = "contatos:densidade";
const CHAVE_COLUNAS   = "contatos:colunas";

function ler<T>(chave: string, padrao: T): T {
  try {
    const cru = localStorage.getItem(chave);
    return cru ? (JSON.parse(cru) as T) : padrao;
  } catch {
    // localStorage pode estar bloqueado (modo privado, política de site).
    // Preferência de layout não vale derrubar a tela.
    return padrao;
  }
}

function gravar(chave: string, valor: unknown): void {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* idem */ }
}

export function useTablePrefs() {
  const [densidade, setDensidadeState] = useState<Densidade>(
    () => ler<Densidade>(CHAVE_DENSIDADE, "confortavel"),
  );
  const [colunas, setColunasState] = useState<ColunaKey[]>(
    () => ler<ColunaKey[]>(CHAVE_COLUNAS, TODAS),
  );

  // Uma coluna removida do código não pode continuar "visível" no localStorage
  // de quem já usou o app — filtra contra a lista atual.
  useEffect(() => {
    const validas = colunas.filter((c) => TODAS.includes(c));
    if (validas.length !== colunas.length) setColunasState(validas);
  }, [colunas]);

  const setDensidade = useCallback((d: Densidade) => {
    setDensidadeState(d);
    gravar(CHAVE_DENSIDADE, d);
  }, []);

  const alternarColuna = useCallback((key: ColunaKey) => {
    setColunasState((atuais) => {
      const proximas = atuais.includes(key)
        ? atuais.filter((c) => c !== key)
        : [...atuais, key];
      gravar(CHAVE_COLUNAS, proximas);
      return proximas;
    });
  }, []);

  const mostrar = useCallback((key: ColunaKey) => colunas.includes(key), [colunas]);

  return { densidade, setDensidade, colunas, alternarColuna, mostrar };
}

/** Padding vertical das células conforme a densidade escolhida. */
export function padCelula(d: Densidade): string {
  return d === "compacta" ? "py-1.5" : "py-3";
}
