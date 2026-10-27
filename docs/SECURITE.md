# Sécurité et déploiement du renforcement du 27 octobre 2026

Cette revue porte sur le code. Elle ne certifie ni le VPS, ni une résistance à un déni de service distribué. Les comptes restent sur invitation. Aucun accès aux données réelles ni test de charge en production n'a été effectué.

## Protections ajoutées

- Les tentatives de connexion sont limitées en PostgreSQL à vingt par IP sur quinze minutes. Le compteur global par identifiant est retiré : connaître un nom ne permet plus de bloquer son propriétaire depuis une autre IP. Une même IP partagée reste soumise au même budget. Les mots de passe doivent rester longs et uniques ; ce mécanisme ne remplace pas une authentification multifacteur contre un réseau d'attaquants.
- Avant lecture du corps et accès à la base, l'API autorise une rafale de 120 requêtes par IP, renouvelée à deux par seconde. Les réponses 429 comportent `Retry-After`. Les compteurs mémoire expirent et leur nombre est borné à 4 096 IP.
- L'API traite au plus 64 requêtes simultanées, dont seize par IP. Les calculs route / OSM / relief sont limités à quatre simultanés, dont deux par IP. Les opérations avec mot de passe ont quatre créneaux, dont un par IP. Les imports GPX ont deux créneaux, dont un par IP. Ces limites sont par processus, adaptées au déploiement actuel avec une instance ; elles ne remplacent pas une protection en amont du VPS.
- Les corps de connexion, invitation et changement de mot de passe sont limités à 16 Kio. Les limites GPX existantes sont conservées. La réception des en-têtes et des requêtes est bornée à quinze et soixante secondes. Les créneaux sont libérés après succès comme après erreur.
- Leaflet est servi localement, avec licence, CSS et images. Sa version npm exacte est une dépendance de développement utilisée par la CI pour comparer les fichiers et vérifier les avis de sécurité. Pour une mise à jour, remplacer ensemble le paquet, les fichiers vendus, leurs empreintes et les références de version.
- La CSP restreint les scripts et workers à l'origine de Sillage, interdit les scripts inline, les objets, les iframes entrantes et les formulaires externes. Les styles inline nécessaires à Leaflet et les fournisseurs cartographiques HTTPS restent autorisés. Le retour OAuth Strava utilise un script local.
- `package-lock.json` est généré par npm. Les deux images et la CI utilisent `npm ci`; la CI vérifie aussi les vulnérabilités npm de toutes les dépendances, dont Leaflet.

## Configuration indispensable

L'application utilise `X-Real-IP` uniquement parce que Caddy le remplace par l'adresse du client. Ne pas publier le port 3000 de l'application ni celui de PostgreSQL. Le fichier Compose ne publie que les ports de Caddy. Ne pas placer un autre proxy devant Caddy sans revoir la gestion des adresses clientes.

Le pare-feu, SSH, les mises à jour du VPS, les sauvegardes hors serveur et les restaurations restent à vérifier sur le serveur. Les contrôles npm ne couvrent pas les paquets système ni les images Docker.

## Mise à jour de l'unique production

Fusionner la PR seulement après réussite de GitHub Actions. Les commandes ci-dessous supposent `~/sillage`, la branche `main` et la clé GitHub déjà utilisée sur ce VPS. Elles conservent un dossier de secours unique et l'image actuelle. Aucune clé Strava ne doit être régénérée.

Préparer pendant que le site fonctionne :

```bash
cd ~/sillage
(
  set -euo pipefail
  test -z "$(git status --porcelain)" || { echo 'Modifications locales présentes : arrêter ici.'; exit 1; }
  test "$(git branch --show-current)" = main
  sudo install -d -m 700 backups
  SILLAGE_BACKUP=$(sudo mktemp -d "$PWD/backups/securite-XXXXXXXX")
  git rev-parse HEAD | sudo tee "$SILLAGE_BACKUP/commit.txt" >/dev/null
  sudo install -m 600 .env "$SILLAGE_BACKUP/env"
  SILLAGE_CONTAINER=$(sudo docker compose ps -q app)
  test -n "$SILLAGE_CONTAINER"
  SILLAGE_IMAGE=$(sudo docker inspect --format '{{.Image}}' "$SILLAGE_CONTAINER")
  SILLAGE_TAG="sillage-app:$(basename "$SILLAGE_BACKUP")"
  sudo docker image tag "$SILLAGE_IMAGE" "$SILLAGE_TAG"
  printf '%s\n' "$SILLAGE_TAG" | sudo tee "$SILLAGE_BACKUP/image.txt" >/dev/null
  printf 'Dossier de secours à conserver : %s\n' "$SILLAGE_BACKUP"
  GIT_SSH_COMMAND="ssh -i $HOME/.ssh/sillage_github -o IdentitiesOnly=yes" git pull --ff-only origin main
  test -f server/security.js
  test -f package-lock.json
  test -f dist/vendor/leaflet-1.9.4/leaflet.js
  sudo docker compose config --quiet
  sudo docker compose build app
)
```

Si la préparation échoue, ne pas lancer la bascule.

La courte interruption commence dans ce deuxième bloc. Il arrête le site, crée une sauvegarde cohérente, puis démarre l'application corrigée. Une erreur arrête la procédure ; ne pas poursuivre les commandes à la main.

```bash
(
  set -euo pipefail
  test -f server/security.js
  sudo docker compose stop web app
  sudo bash deploy/backup.sh
  sudo docker compose up -d --no-deps --wait app
  sudo docker compose exec -T app node server/check-db.js
  sudo docker compose start web
  sudo docker compose ps
)
sudo docker compose logs --tail=80 app web
```

Vérifier connexion, carte, import GPX, enregistrement et téléchargement. Le retour OAuth Strava doit rejoindre la carte. Ne jamais lancer `npm run test:db` sur cette base de production.

Pour revenir à l'image précédente en cas d'échec, utiliser le dossier exact affiché pendant la préparation, puis exécuter :

```bash
SILLAGE_BACKUP='/chemin/exact/affiche/pendant/la/preparation'
(
  set -euo pipefail
  sudo test -f "$SILLAGE_BACKUP/commit.txt"
  SILLAGE_TAG=$(sudo cat "$SILLAGE_BACKUP/image.txt")
  sudo docker image inspect "$SILLAGE_TAG" >/dev/null
  sudo docker compose stop web app
  git switch --detach "$(sudo cat "$SILLAGE_BACKUP/commit.txt")"
  printf 'services:\n  app:\n    image: %s\n    pull_policy: never\n' "$SILLAGE_TAG" | sudo tee "$SILLAGE_BACKUP/rollback.yaml" >/dev/null
  sudo docker compose -f compose.yaml -f "$SILLAGE_BACKUP/rollback.yaml" up -d --no-deps --no-build --wait app
  sudo docker compose start web
  sudo docker compose ps
)
```

Le retour arrière conserve la base et réintroduit les anciens comportements. La restauration de la base est une opération distincte. Conserver le dossier de secours et une copie protégée de la sauvegarde hors du VPS.
