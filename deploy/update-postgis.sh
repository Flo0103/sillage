#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
if [ "$(id -u)" -ne 0 ]; then
  echo 'Lancer avec sudo bash deploy/update-postgis.sh' >&2
  exit 1
fi
bash deploy/configure.sh
docker compose config --quiet
# Téléchargement et construction avant l’interruption du site.
docker compose pull db
docker compose build app
docker compose stop web app
bash deploy/backup.sh
# Même PostgreSQL majeur 17, même famille Alpine, même volume de données.
docker compose up -d db
docker compose up -d app web
docker compose exec -T app node server/check-db.js
docker compose ps
