#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$project_dir"
umask 077
compose=(docker compose --profile tools)
if [ -z "${SILLAGE_ROUTING_UPDATE_LOCK:-}" ]; then
  install -d -m 0700 /run/sillage-routing-update
fi
lock_file="${SILLAGE_ROUTING_UPDATE_LOCK:-/run/sillage-routing-update/update.lock}"
exec 9>"$lock_file"
if ! flock -n 9; then
  echo 'Une mise à jour automatique est déjà en cours ; ce lancement est ignoré.'
  exit 0
fi
"${compose[@]}" config --quiet
routing_image="$("${compose[@]}" config --images routing-import)"
if [ -z "$routing_image" ] || [[ "$routing_image" == *$'\n'* ]] || ! docker image inspect "$routing_image" >/dev/null 2>&1; then
  echo 'Image routing-import absente. Relancer sudo bash deploy/install-routing-updates.sh.' >&2
  exit 1
fi
"${compose[@]}" exec -T db pg_isready -U sillage -d sillage
container_name="sillage-routing-update-$$"
run_token="$$-$(date -u +%Y%m%dT%H%M%SZ)"
cleanup() {
  local result=$?
  trap - EXIT
  set +e
  local token
  token="$(docker container inspect --format '{{index .Config.Labels "be.gravelspa.sillage.routing-update"}}' "$container_name" 2>/dev/null)"
  if [ "$token" = "$run_token" ]; then
    docker container stop --time 30 "$container_name" >/dev/null 2>&1
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
echo "[$(date -u +%FT%TZ)] Mise à jour des régions OSM installées."
"${compose[@]}" run --rm --no-deps --pull never -T --name "$container_name" --label "be.gravelspa.sillage.routing-update=$run_token" --entrypoint node routing-import server/refresh-routing.js
echo "[$(date -u +%FT%TZ)] Mise à jour OSM terminée."
