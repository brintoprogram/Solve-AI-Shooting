# DATA_FLOW_AUDIT.md — Solve AI Shooting
> Documento de conformidade LGPD. Manter atualizado a cada alteração de esquema ou integração.
> Última revisão: 2026-04-23 | Responsável: Bruno Araujo (brunoaraujo@solveai.consulting)

---

## 1. Inventário de Tabelas com Dados Pessoais (PII)

| Tabela | Campos PII | Finalidade | Base Legal LGPD | Retenção | Criptografia em repouso |
|---|---|---|---|---|---|
| `inbox_contacts` | name, phone, cpf_cnpj, email, email2, empresa, nome_representante, email_representante, logradouro, numero, complemento, bairro, cidade, estado, cep | CRM — gestão de relacionamento com clientes | Legítimo interesse (Art. 7º, IX) | Enquanto o workspace existir + 5 anos | Não (campos em plaintext) |
| `inbox_conversations` | contact_id (FK), last_message_body | Histórico de atendimento | Legítimo interesse (Art. 7º, IX) | Enquanto o workspace existir | Não |
| `inbox_messages` | body, media_url | Conteúdo das mensagens trocadas | Legítimo interesse (Art. 7º, IX) | 2 anos | Não |
| `shooting_messages` | recipient_phone, recipient_data (JSON com dados do contato) | Rastreamento de disparos de campanhas | Legítimo interesse (Art. 7º, IX) | 2 anos | Não |
| `contact_invoices` | valor, vencimento, numero_nf (vinculado a contact_id) | Financeiro — controle de boletos | Execução de contrato (Art. 7º, V) | 5 anos (obrigação fiscal) | Não |
| `contact_notes` | conteudo, tipo, created_by | Notas internas sobre contatos | Legítimo interesse (Art. 7º, IX) | Enquanto o workspace existir | Não |
| `meta_connections` | access_token, phone_number_id, waba_id, display_phone | Credenciais de integração WhatsApp (Meta) | Execução de contrato (Art. 7º, V) | Enquanto a conexão estiver ativa | **SIM — AES-256-GCM (access_token)** |
| `email_connections` | password, oauth_access_token, oauth_refresh_token, username, from_email | Credenciais de integração de e-mail | Execução de contrato (Art. 7º, V) | Enquanto a conexão estiver ativa | **SIM — AES-256-GCM (password, oauth_*_token)** |
| `user_profiles` | full_name, avatar_url, role, permissions | Perfil e permissões dos usuários do sistema | Execução de contrato (Art. 7º, V) | Enquanto o usuário existir | Não (gerenciado pelo Supabase Auth) |
| `audit_logs` | user_id, entity_id, metadata | Trilha de auditoria imutável | Legítimo interesse / Obrigação legal (Art. 7º, IX e II) | 5 anos — **IMUTÁVEL POR DESIGN** | Não |
| `cleanup_sessions` | nome da sessão, contagem de linhas | Sessões de limpeza de base (planilhas avulsas) | Legítimo interesse (Art. 7º, IX) | 90 dias | Não |
| `cleanup_session_rows` | phone (normalizado) | Linhas de planilha avulsa processadas | Legítimo interesse (Art. 7º, IX) | 90 dias | Não |
| `workspace_invites` | email, role | Convites de acesso ao workspace | Execução de contrato (Art. 7º, V) | 7 dias (expiração automática) | Não |

---

## 2. Mapa de Integrações Externas

| Integração | Provedor | Dados Transmitidos | Finalidade | País dos Dados | DPA Assinado |
|---|---|---|---|---|---|
| WhatsApp Cloud API | Meta Platforms Inc. (EUA) | Números de telefone, conteúdo de mensagens, templates | Envio e recebimento de mensagens WhatsApp | EUA (servidores Meta) | Termos de Serviço Meta for Developers |
| Supabase | Supabase Inc. (EUA) | Todos os dados do banco + auth | Banco de dados, autenticação, storage | EUA (AWS us-east-1) | DPA disponível em supabase.com/dpa |
| Anthropic Claude API | Anthropic PBC (EUA) | Conteúdo de mensagens de inbox (analyze-reply) | Sugestões de resposta por IA | EUA | Termos de Serviço Anthropic |
| SMTP (genérico) | Configurado pelo cliente | Endereços de e-mail, conteúdo das mensagens | Envio de campanhas de e-mail | Depende da configuração | Responsabilidade do cliente |
| Microsoft Graph API | Microsoft Corp. (EUA) | Endereços de e-mail, conteúdo das mensagens | Envio de campanhas de e-mail via Entra ID | EUA | Microsoft Online Services DPA |
| Facebook OAuth | Meta Platforms Inc. (EUA) | Código de autorização, access token | Autenticação embedded signup WhatsApp | EUA | Termos de Serviço Meta |
| Vercel | Vercel Inc. (EUA) | Código-fonte, variáveis de ambiente (frontend) | Hospedagem do frontend | EUA | DPA disponível em vercel.com/legal/dpa |

---

## 3. Edge Functions × Tabelas Acessadas

| Edge Function | Lê | Escreve | Dados externos enviados |
|---|---|---|---|
| `embedded-signup` | — | `meta_connections` | Meta Graph API (troca de código OAuth) |
| `send-inbox-message` | `inbox_conversations`, `inbox_contacts`, `meta_connections` | `inbox_messages`, `inbox_conversations` | Meta Graph API (envia mensagem) |
| `campaign-engine` | `shooting_campaigns`, `meta_connections`, `meta_templates`, `shooting_messages`, `user_profiles` | `shooting_messages`, `inbox_messages`, `inbox_conversations`, `inbox_contacts`, `audit_logs` | Meta Graph API (envia template) |
| `check-wa-contacts` | `meta_connections`, `inbox_contacts` | `inbox_contacts` (wa_status) | Meta Graph API (valida números) |
| `meta-templates` | `meta_connections` | `meta_templates` | Meta Graph API (lista/cria templates) |
| `meta-webhook` | `meta_connections` | `inbox_messages`, `inbox_conversations`, `inbox_contacts` | Meta Graph API (download de mídia) |
| `email-engine` | `email_campaigns`, `email_connections`, `email_messages` | `email_messages`, `email_campaigns`, `audit_logs`, `email_connections` (refresh token) | SMTP / Microsoft Graph API |
| `save-email-connection` | — | `email_connections` | — |
| `analyze-reply` | `inbox_messages` | `inbox_messages` (sugestão) | Anthropic Claude API |
| `gdpr-export` | `inbox_contacts`, `contact_invoices`, `contact_notes`, `inbox_conversations`, `inbox_messages`, `shooting_messages` | `audit_logs` | — |
| `gdpr-forget` | `inbox_contacts` | `inbox_contacts`, `shooting_messages`, `audit_logs` | — |
| `invite-user` | `user_profiles` | `workspace_invites` | — |
| `ms-oauth-callback` | — | `email_connections` | Microsoft Graph API (token exchange) |
| `resolve-media` | `meta_connections` | — (proxy de mídia) | Meta Graph API (download de mídia) |
| `migrate-encrypt-tokens` | `meta_connections`, `email_connections` | `meta_connections`, `email_connections` | — |

---

## 4. Status de Criptografia por Campo Sensível

| Tabela | Campo | Em trânsito | Em repouso | Algoritmo |
|---|---|---|---|---|
| `meta_connections` | `access_token` | TLS 1.2+ | **Criptografado** | AES-256-GCM |
| `email_connections` | `password` | TLS 1.2+ | **Criptografado** | AES-256-GCM |
| `email_connections` | `oauth_access_token` | TLS 1.2+ | **Criptografado** | AES-256-GCM |
| `email_connections` | `oauth_refresh_token` | TLS 1.2+ | **Criptografado** | AES-256-GCM |
| `inbox_contacts` | Todos os campos PII | TLS 1.2+ | Plaintext (RLS ativo) | — |
| `inbox_messages` | `body` | TLS 1.2+ | Plaintext (RLS ativo) | — |
| `shooting_messages` | `recipient_data` | TLS 1.2+ | Plaintext (RLS ativo) | — |

> **Gestão da chave de criptografia:** `ENCRYPTION_KEY` armazenada exclusivamente como Supabase Edge Function Secret. Nunca exposta em código-fonte, variáveis de ambiente do frontend ou logs. Rotação da chave requer re-execução do `migrate-encrypt-tokens` com nova chave.

---

## 5. Direitos dos Titulares (LGPD Art. 18)

| Direito | Implementação | Edge Function | SLA Interno |
|---|---|---|---|
| Acesso (Art. 18, II) | Exportação JSON de todos os dados do titular | `gdpr-export` | 72 horas |
| Anonimização (Art. 18, IV) | Substitui PII por valores anônimos, mantém histórico estatístico | `gdpr-forget` (mode: anonymize) | 15 dias |
| Eliminação (Art. 18, VI) | DELETE completo + cascade | `gdpr-forget` (mode: hard_delete) | 15 dias |
| Portabilidade (Art. 18, V) | JSON estruturado via `gdpr-export` | `gdpr-export` | 72 horas |

Todas as operações de direitos dos titulares são registradas em `audit_logs` com `event_type: "gdpr_export"` ou `"gdpr_forget"`.

---

## 6. Controles de Acesso

- **Row Level Security (RLS):** ativo em todas as tabelas — queries isoladas por `workspace_id`
- **Roles:** `admin` > `manager` > `agent` com permissões granulares via `user_profiles.permissions`
- **Operações LGPD:** restritas a `admin` e `manager` (verificação via `profile.role` na UI)
- **Edge Functions:** autenticadas via JWT do Supabase Auth; funções de sistema usam `SUPABASE_SERVICE_ROLE_KEY` exclusivamente em server-side

---

## 7. Contato do Encarregado (DPO)

| | |
|---|---|
| **Nome** | Bruno Araujo |
| **E-mail** | brunoaraujo@solveai.consulting |
| **Empresa** | Solve AI Consulting |
| **Canal para titulares** | brunoaraujo@solveai.consulting (assunto: "LGPD — Solicitação de Titular") |

---

## 8. Histórico de Revisões

| Data | Alteração | Responsável |
|---|---|---|
| 2026-04-23 | Criação inicial — Fase 3 LGPD Privacy by Design | Bruno Araujo |
