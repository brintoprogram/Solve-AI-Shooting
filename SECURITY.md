# Security Policy

## Versões suportadas

| Versão | Suporte de segurança |
|--------|----------------------|
| main (produção) | Ativo |
| branches de feature | Não suportado |

## Reportar uma vulnerabilidade

**Não abra um issue público para reportar vulnerabilidades de segurança.**

Se você encontrou uma vulnerabilidade, envie um email para:

**brunoaraujo@solveai.consulting**

Inclua no email:
- Descrição do problema e do impacto potencial
- Passos para reproduzir (se aplicável)
- Versão ou commit afetado
- Seu nome ou handle (para crédito, se desejar)

### O que esperar

- **Confirmação de recebimento:** em até 48 horas úteis
- **Avaliação inicial:** em até 5 dias úteis
- **Correção e divulgação:** depende da severidade — críticos em 7 dias, altos em 30 dias

Vulnerabilidades confirmadas serão corrigidas com prioridade. Você será notificado quando a correção for publicada.

## Escopo

Este repositório cobre o produto **Solve AI Shooting**, incluindo:
- Frontend React (Vite)
- Supabase Edge Functions (Deno)
- Configurações de banco de dados (RLS, migrações)

## Fora do escopo

- Vulnerabilidades em dependências de terceiros já reportadas publicamente (relate diretamente ao projeto upstream)
- Ataques de força bruta ou DoS sem demonstração de impacto real
- Phishing ou engenharia social

## Boas práticas para contribuidores

- Nunca commite chaves de API, tokens ou credenciais — use variáveis de ambiente
- O repositório tem um pre-commit hook que detecta padrões de credencial
- Use `.env.example` como referência; nunca o `.env` real
- Dados pessoais de clientes são protegidos pela LGPD — minimize logging de dados identificáveis
