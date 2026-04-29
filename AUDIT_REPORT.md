# Relatório de Auditoria de Segurança

**Projeto:** Solve AI Shooting  
**Data:** 2026-04-28  
**Auditor:** Claude Sonnet 4.6 (Anthropic) — solicitado por Bruno Araujo  
**Repositório:** privado, GitHub

---

## Resumo Executivo

Projeto SaaS em produção com clientes ativos. Stack: React + Vite + Supabase (Edge Functions Deno) + Vercel. Processa dados pessoais sob LGPD (CPF, telefone, dados financeiros). O repositório é **privado** e acesso restrito ao proprietário. A auditoria não encontrou vulnerabilidades de injeção SQL, uso de `Math.random()` para segredos, ou chave de serviço (`service_role`) exposta no frontend. O principal risco identificado são constantes hardcoded em arquivos de Edge Function que deveriam estar em variáveis de ambiente, e CORS aberto (`*`) em todas as funções.

---

## [CRÍTICO] Achados que requerem ação

### C1 — Token de verificação de webhook hardcoded
- **Arquivo:** `src/supabase/functions/meta-webhook-proxy/index.ts:16`
- **Valor:** `CHATWOOT_VERIFY_TOKEN = "73c0...1ec4"` (hardcoded)
- **Risco:** Qualquer pessoa com acesso ao repo pode forjar chamadas de webhook da Meta como legítimas. O valor também está no histórico Git.
- **Ação:** Mover para `Deno.env.get("CHATWOOT_VERIFY_TOKEN")` via `supabase secrets set`. *(Pendente — Onda 2)*

### C2 — Chatwoot URL com número de telefone hardcoded
- **Arquivo:** `src/supabase/functions/meta-webhook-proxy/index.ts:17`
- **Valor:** URL completa com `+5511950239278` hardcoded
- **Risco:** Endpoint interno de mensagens e número de produção expostos no código-fonte.
- **Ação:** Mover para `Deno.env.get("CHATWOOT_URL")`. *(Pendente — Onda 2, ou remoção da função se não for mais usada)*

### C3 — UUID de webhook N8N hardcoded
- **Arquivo:** `supabase/functions/n8n-dispatch/index.ts:13`
- **Valor:** `N8N_WEBHOOK = "https://n8n.solveai.consulting/webhook/f03bd6...671ae6"` (hardcoded)
- **Risco:** UUID de webhook de produção exposto. Qualquer pessoa com a URL pode acionar o webhook diretamente.
- **Ação:** Mover para `Deno.env.get("N8N_WEBHOOK_URL")` via `supabase secrets set`. *(Pendente — Onda 2)*

---

## [ALTO] Achados sérios

### A1 — CORS wildcard em Edge Functions autenticadas
- **Arquivos:** `campaign-engine`, `send-inbox-message`, `n8n-dispatch`, `invite-user`
- **Problema:** `"Access-Control-Allow-Origin": "*"` permite chamadas cross-origin de qualquer site. Para funções que verificam JWT, o risco prático é baixo (atacante precisaria do token do usuário). Mas é contrário às boas práticas.
- **Ação:** Implementar lista de origens via `ALLOWED_ORIGINS` env var. *(Pendente — Onda 3)*

### A2 — `verify_jwt = false` em todas as Edge Functions
- **Arquivo:** `supabase/config.toml`
- **Problema:** Verificação automática de JWT desabilitada; cada função precisa validar auth manualmente. Qualquer função com bug de autenticação vira endpoint aberto.
- **Avaliação:** Inspeção manual confirmou que as funções que requerem auth validam o header `Authorization` explicitamente. Funções de webhook (`meta-webhook`, `meta-webhook-proxy`) corretamente não exigem JWT.
- **Ação:** Baixo risco atual; monitorar ao adicionar novas funções.

---

## [MÉDIO] Melhorias recomendadas

### M1 — Telefone de contato em log de Edge Function ✅ CORRIGIDO
- **Arquivo:** `src/supabase/functions/send-inbox-message/index.ts:140`
- **Problema:** `console.log` imprimia o número de telefone do contato nos logs da Edge Function.
- **Correção:** Removido o número do log — agora registra apenas o `wamid`.

### M2 — Secret Scanning e Push Protection desabilitados no GitHub
- **Problema:** GitHub não monitora pushes em busca de credenciais.
- **Ação:** Habilitar em Settings → Code security. *(Pendente — Onda 4)*

### M3 — Dependabot não configurado
- **Problema:** Sem alertas automáticos de vulnerabilidades em dependências.
- **Ação:** Habilitar em Settings → Security. *(Pendente — Onda 4)*

### M4 — Branch protection não configurada
- **Problema:** Commits diretos na branch default sem review.
- **Ação:** Configurar em Settings → Branches. *(Pendente — Onda 4)*

---

## [BAIXO] Observações

- **`supabaseAnonKey` em localStorage:** A chave anon do Supabase é públicamente acessível por design (não é a `service_role`). O armazenamento em localStorage é aceitável neste contexto, mas vulnerável a XSS. Fora do escopo desta auditoria.
- **Sem GitHub Actions:** Projeto sem CI/CD automatizado. Oportunidade futura para lint, testes e deploy automático com validação de segurança.
- **Sem SQL injection:** Todas as queries usam o cliente Supabase com queries parametrizadas. Nenhum risco de SQL injection encontrado.
- **Sem `Math.random()` para segredos:** Não encontrado. Geração de tokens usa `crypto.randomUUID()`.
- **Criptografia em repouso:** Edge Functions usam AES-256-GCM com IV aleatório de 96 bits para campos sensíveis (chaves de API, passwords de email). Implementação correta.
- **RLS ativo:** Row Level Security habilitado em todas as tabelas com políticas de isolamento por workspace.

---

## O que foi corrigido automaticamente nesta auditoria

| Item | Arquivo | Ação |
|------|---------|------|
| M1 — Telefone em log | `send-inbox-message/index.ts` | Removido número do `console.log` |
| `.gitignore` incompleto | `.gitignore` | Adicionadas 20+ entradas faltantes |
| `.env.example` incompleto | `.env.example` | Documentadas todas as variáveis de ambiente |
| Sem política de segurança | `SECURITY.md` | Criado |
| Sem pre-commit hook | `.git/hooks/pre-commit` | Criado e tornado executável |

---

## O que requer sua ação

### Onda 2 — Mover credenciais hardcoded para Supabase Secrets
1. Verificar se `meta-webhook-proxy` ainda é usada (Claude fará isso)
2. Rodar `supabase secrets set N8N_WEBHOOK_URL=<valor-atual>` (e outros se aplicável)
3. Claude refatora o código para usar `Deno.env.get()`
4. Deploy e teste de cada função

### Onda 3 — Restringir CORS
1. Confirmar lista de domínios autorizados
2. Claude implementa `ALLOWED_ORIGINS` pattern com suporte a wildcard
3. Deploy e teste

### Onda 4 — GitHub Settings
1. Habilitar Secret Scanning + Push Protection
2. Habilitar Dependabot
3. Configurar branch protection na `main`

---

## Próximos passos (prioridade)

1. **Alta** — Executar Onda 2: mover tokens hardcoded para Supabase Secrets
2. **Alta** — Executar Onda 4: habilitar Secret Scanning no GitHub (detecta o que já está no histórico)
3. **Média** — Executar Onda 3: restringir CORS
4. **Baixa** — Considerar `git filter-repo` no futuro se o repo for algum dia tornado público (para limpar tokens do histórico)
5. **Baixa** — Adicionar `npm audit` ao workflow de desenvolvimento periódico
