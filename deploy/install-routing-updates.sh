#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$project_dir"
if [[ "$project_dir" == *$'\n'* ]] || [[ "$project_dir" == *$'\r'* ]]; then
  echo 'Le chemin du projet ne doit pas contenir de saut de ligne.' >&2
  exit 1
fi
render_units() {
  local target=$1 escaped directory line
  # WorkingDirectory is one literal path, not a quoted word list. Leave its
  # quotes/backslashes intact; only escape systemd specifiers. The final slash
  # also preserves paths ending in whitespace or a line-continuation backslash.
  directory=${project_dir//%/%%}/
  # RequiresMountsFor, unlike WorkingDirectory, parses a quoted list of paths.
  escaped=${project_dir//\\/\\\\}
  escaped=${escaped//\"/\\\"}
  escaped=${escaped//%/%%}
  mkdir -p -- "$target"
  while IFS= read -r line; do
    case "$line" in
      'RequiresMountsFor="@PROJECT_DIR@"') printf 'RequiresMountsFor="%s"\n' "$escaped" ;;
      'WorkingDirectory=@PROJECT_DIR@') printf 'WorkingDirectory=%s\n' "$directory" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < deploy/systemd/sillage-routing-update.service > "$target/sillage-routing-update.service"
  cp -- deploy/systemd/sillage-routing-update.timer "$target/sillage-routing-update.timer"
}
if [ "${1:-}" = '--render' ] && [ "$#" -eq 2 ]; then
  render_units "$2"
  exit 0
fi
if [ "$#" -ne 0 ]; then
  echo 'Usage : sudo bash deploy/install-routing-updates.sh' >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  echo 'Lancer avec sudo bash deploy/install-routing-updates.sh' >&2
  exit 1
fi
for program in docker systemctl systemd-analyze flock; do
  command -v "$program" >/dev/null || { echo "Commande requise : $program" >&2; exit 1; }
done
stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
render_units "$stage"
systemd-analyze verify "$stage/sillage-routing-update.service" "$stage/sillage-routing-update.timer"
docker compose --profile tools config --quiet
# Build and run the native smoke test before enabling an unattended task.
docker compose --profile tools build routing-import
install -m 0644 "$stage/sillage-routing-update.service" /etc/systemd/system/sillage-routing-update.service
install -m 0644 "$stage/sillage-routing-update.timer" /etc/systemd/system/sillage-routing-update.timer
systemctl daemon-reload
systemctl enable --now sillage-routing-update.timer
systemctl restart sillage-routing-update.timer
echo 'Mise à jour prévue chaque dimanche à 04 h (Europe/Brussels). Aucun import lancé maintenant.'
systemctl list-timers --all sillage-routing-update.timer --no-pager
