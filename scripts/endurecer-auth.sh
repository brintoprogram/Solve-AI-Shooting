#!/usr/bin/env bash
# Endurece a configuração de Auth do projeto Supabase.
#
# Por que script e não migration: isto não vive no banco. É configuração do
# projeto, alterável só pela API de gerenciamento — e por isso não aparece em
# nenhuma migration, não vai junto num restore e um ambiente novo nasce sem.
# Deixar registrado aqui é o que torna reproduzível.
#
# O PATCH da API de gerenciamento altera SOMENTE os campos enviados. É por isso
# que usamos ele em vez de `supabase config push`, que envia o bloco [auth]
# inteiro e devolve ao padrão do CLI tudo que não estiver no config.toml —
# incluindo site_url, redirects e templates de e-mail.
#
# ── Como usar ────────────────────────────────────────────────────────
#   1. Crie um token em https://supabase.com/dashboard/account/tokens
#   2. export SUPABASE_PAT='sbp_...'
#   3. Opcional, para configurar o remetente próprio:
#        export RESEND_API_KEY='re_...'
#   4. bash scripts/endurecer-auth.sh
#   5. Revogue o token no painel quando terminar.

set -euo pipefail

PROJECT_REF="${PROJECT_REF:-emmtsjbpnavlzzspzcmt}"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth"

if [ -z "${SUPABASE_PAT:-}" ]; then
  echo "ERRO: exporte SUPABASE_PAT primeiro (token em /dashboard/account/tokens)." >&2
  exit 1
fi

# Só os campos que interessam. O GET devolve a config inteira, incluindo
# smtp_pass — imprimir tudo jogaria a senha no terminal e no histórico.
mostrar() {
  curl -sS -H "Authorization: Bearer ${SUPABASE_PAT}" "$API" | python -c "
import sys, json
c = json.load(sys.stdin)
print('  senha vazada bloqueada :', c.get('password_hibp_enabled'))
print('  expiracao do link (s)  :', c.get('mailer_otp_exp'))
print('  tamanho minimo de senha:', c.get('password_min_length'))
print('  smtp                   :', c.get('smtp_host') or '(remetente padrao do Supabase)')
"
}

echo "== ANTES =="
mostrar

# ── Endurecimento ────────────────────────────────────────────────────
# password_hibp_enabled: recusa senha que já apareceu em vazamento conhecido.
# mailer_otp_exp: 3600s. Link de convite e de recuperação dá acesso à conta;
#   acima de 1h a janela de uso indevido fica longa demais.
# password_min_length: o padrão do Supabase é 6, que hoje é fraco demais.
PAYLOAD='{"password_hibp_enabled": true, "mailer_otp_exp": 3600, "password_min_length": 10}'

# ── Remetente próprio (opcional) ─────────────────────────────────────
# Sem SMTP próprio o convite sai pelo serviço embutido do Supabase, limitado a
# poucos e-mails por hora e explicitamente não recomendado para produção —
# convidar três pessoas de uma vez faz uma não chegar.
#
# Usamos Resend porque o domínio solveai.consulting já está verificado lá
# (é o mesmo caminho que support-notify usa). Trocar de provedor é trocar host,
# usuário e senha abaixo.
if [ -n "${RESEND_API_KEY:-}" ]; then
  echo "== configurando remetente proprio (Resend) =="
  # Passa o JSON por variável de ambiente, não interpolado no fonte python:
  # aspas dentro do payload quebrariam a string literal.
  PAYLOAD=$(BASE="$PAYLOAD" python -c "
import json, os
p = json.loads(os.environ['BASE'])
p.update({
    'smtp_host': 'smtp.resend.com',
    'smtp_port': '587',
    'smtp_user': 'resend',
    'smtp_pass': os.environ['RESEND_API_KEY'],
    'smtp_admin_email': 'nao-responda@solveai.consulting',
    'smtp_sender_name': 'Solve AI',
})
print(json.dumps(p))
")
else
  echo "== RESEND_API_KEY nao definido: mantendo o remetente atual =="
fi

curl -sS -X PATCH "$API" \
  -H "Authorization: Bearer ${SUPABASE_PAT}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" > /dev/null

echo
echo "== DEPOIS =="
mostrar

echo
echo "Pronto. Revogue o token em https://supabase.com/dashboard/account/tokens"
echo "Teste real: convide alguem em Equipe e confirme que o e-mail chega."
