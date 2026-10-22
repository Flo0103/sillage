#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
umask 077
mkdir -p backups
backup="backups/sillage-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose exec -T db pg_dump -U sillage -d sillage | gzip > "$backup"
echo "Sauvegarde créée : $backup"
