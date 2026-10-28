#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
umask 077
mkdir -p backups
temporary=$(mktemp --suffix=.sql.gz.partial "backups/sillage-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
backup=${temporary%.partial}
docker compose exec -T db pg_dump -U sillage -d sillage | gzip > "$temporary"
gzip -t -- "$temporary"
mv -- "$temporary" "$backup"
echo "Sauvegarde créée : $backup"

