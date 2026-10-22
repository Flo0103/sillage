#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo 'Complétez SILLAGE_DOMAIN et ACME_EMAIL dans .env avant le lancement.'
fi
# Conserve le domaine, l’email et le mot de passe existants. Ne montre aucun secret.
if ! grep -Eq '^POSTGRES_PASSWORD=.+$' .env; then
  if grep -q '^POSTGRES_PASSWORD=' .env; then
    echo 'La variable POSTGRES_PASSWORD est vide : retirez cette ligne puis relancez ce script.' >&2
    exit 1
  fi
  umask 077
  db_password=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  printf '\nPOSTGRES_PASSWORD=%s\n' "$db_password" >> .env
fi
chmod 600 .env
echo 'Configuration PostgreSQL prête ; secrets conservés dans .env.'

for task_key in STRAVA_TOKEN_KEY STRAVA_WEBHOOK_SECRET; do
  if ! grep -Eq "^${task_key}=.+$" .env; then
    if grep -q "^${task_key}=" .env; then
      echo "${task_key} est vide : retirez cette ligne puis relancez ce script." >&2
      exit 1
    fi
    umask 077
    task_secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
    printf '\n%s=%s\n' "$task_key" "$task_secret" >> .env
  fi
done
chmod 600 .env
echo 'Clés Strava prêtes ; aucun secret affiché.'
