# Déployer sur un VPS OVH

Cette configuration sert la version GPX de Sillage en HTTPS. Elle convient à un VPS Linux avec Docker Compose. Elle ne convient pas à un hébergement mutualisé OVH sans Docker. Aucun serveur Strava ni stockage de données utilisateur n’est inclus pour le moment.

## À prévoir

- Un VPS Ubuntu 24.04 LTS ou Debian avec environ 2 Go de RAM pour commencer.
- Un nom de domaine ou un sous-domaine, par exemple `gravel.mondomaine.fr`.
- Un accès SSH au VPS avec une clé, et Docker Engine + le plugin Compose installés selon la documentation officielle Docker.
- Les ports entrants TCP 80 et 443 ouverts dans le pare-feu du VPS et dans le pare-feu OVH. Le port SSH doit rester accessible. UDP 443 est facultatif (HTTP/3).

Configurer un enregistrement DNS A vers l’IPv4 du VPS. Ajouter un AAAA seulement si l’IPv6 est configurée et accessible. Vérifier les deux avant de lancer Caddy : une adresse IPv6 erronée peut empêcher l’émission du certificat.

## Accès au dépôt privé

Sur le VPS, créer une clé SSH dédiée à ce dépôt, puis ajouter **sa clé publique uniquement** dans GitHub → dépôt → Settings → Deploy keys. Laisser l’accès en lecture seule. Conserver la clé privée sur le VPS ; ne pas la déposer dans le dépôt ou une conversation. Vérifier l’empreinte SSH de GitHub à partir de la documentation officielle lors de la première connexion.

Cloner le dépôt sous le compte de déploiement :

```sh
git clone git@github.com:Flo0103/sillage.git
cd sillage
cp .env.example .env
nano .env
```

Renseigner le domaine réel et une adresse de contact. Ne pas ajouter `https://` au domaine. Le fichier `.env` est ignoré par Git.

## Validation et lancement

```sh
docker compose config --quiet
docker compose run --rm --no-deps web caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d
docker compose logs --tail=100 web
```

Caddy obtient et renouvelle automatiquement le certificat. Ouvrir ensuite `https://votre-domaine` et vérifier l’import d’un GPX, une sélection, une notation et un export. La carte nécessite Internet pour Leaflet, les polices et les tuiles OSM ; l’accrochage nécessite Overpass.

Le site sera accessible publiquement à cette adresse. Le dépôt reste privé. Les GPX et notes restent dans le navigateur, sauf la zone envoyée à Overpass lors d’un accrochage. Cette version ne fournit pas de connexion ni de partage de notes.

## Mise à jour

Après sauvegarde locale des modifications éventuelles sur le VPS :

```sh
git pull --ff-only
docker compose config --quiet
docker compose run --rm --no-deps web caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d --force-recreate web
```

Le contenu est monté en lecture seule depuis `dist/`. Le redémarrage prend aussi en compte les modifications du Caddyfile. Pour suivre les correctifs du serveur, mettre à jour explicitement la version de l’image Caddy dans `compose.yaml` après validation.

## Données et évolution Strava

Les volumes `caddy_data` et `caddy_config` conservent la configuration et les certificats. Ne pas lancer `docker compose down -v` sans vouloir les supprimer. Les notes sont stockées dans le navigateur : les sauvegarder avec « Exporter mes données ». Changer de domaine crée une nouvelle origine et ne migre pas les notes.

Plus tard, un service API pourra être ajouté à Compose et exposé via Caddy. Le secret Strava devra être fourni côté serveur, avec une base de données et une authentification avant de stocker des parcours personnels. Aucun secret Strava n’est nécessaire pour cette version.
