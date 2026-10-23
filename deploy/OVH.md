# Déployer Sillage sur le VPS OVH

Sillage utilise Caddy pour HTTPS, Node.js pour l’application et **PostgreSQL 17 avec PostGIS 3.6**. Seuls HTTP/HTTPS sont exposés sur Internet ; PostgreSQL et le serveur applicatif restent sur le réseau Docker interne.

## Mise à jour d’une installation existante vers la version 4

Sur le VPS, lancer les commandes une par une :

```sh
cd ~/sillage
GIT_SSH_COMMAND="ssh -i $HOME/.ssh/sillage_github -o IdentitiesOnly=yes" git pull --ff-only
sudo bash deploy/update-postgis.sh
```

Ce script :

1. Conserve `.env` et génère uniquement les clés manquantes.
2. Télécharge `postgis/postgis:17-3.6-alpine` et construit l’application avant d’interrompre le site.
3. Arrête web et app pour suspendre les écritures, puis sauvegarde la base existante dans `backups/`.
4. Recrée le service db sur **le volume existant**, avec le même majeur PostgreSQL 17 et la même famille Alpine.
5. Démarre l’application, active PostGIS, ajoute et remplit les géométries, crée les index et les triggers.
6. Démarre Caddy et vérifie types, SRID, ordre des coordonnées et index spatiaux sur la base réelle.

Une courte interruption est nécessaire. Les comptes, mots de passe, GPX, portions, invitations et fonds WMS sont conservés. Aucun compte n’est à recréer. En cas d’échec, conserver le message et la sauvegarde, sans supprimer les volumes. Ne pas remplacer cette image par une image PostgreSQL 18 sur le volume existant.

```sh
sudo docker compose ps
sudo docker compose logs --tail=80 app db web
sudo docker compose exec app node server/check-db.js
```

La page Admin affiche aussi la version réelle de PostGIS et les nombres de géométries. L’application refuse de démarrer si la migration PostGIS échoue ; elle ne fonctionne pas silencieusement sans l’extension.

## Installation neuve

Prévoir un VPS Ubuntu/Debian avec Docker Engine et Compose, 2 Go de RAM minimum conseillé, un nom de domaine et un accès SSH par clé. Le dépôt GitHub privé peut être cloné avec une clé de déploiement en lecture seule, dédiée au VPS.

Chez Gandi : enregistrement A `sillage.gravelspa.be` vers l’IPv4 du VPS ; un AAAA seulement si l’IPv6 fonctionne. Ouvrir TCP 80/443 dans les pare-feu du VPS et d’OVH ; conserver SSH accessible. UDP 443 est facultatif.

```sh
git clone git@github.com:Flo0103/sillage.git
cd sillage
cp .env.example .env
nano .env
```

Renseigner `SILLAGE_DOMAIN=sillage.gravelspa.be` et `ACME_EMAIL` avec une adresse réelle. Pas de `https://` dans le domaine. Puis :

```sh
bash deploy/configure.sh
sudo docker compose up -d --build
sudo docker compose exec app node server/users.js flo
sudo docker compose exec app node server/admin.js flo
sudo docker compose exec app node server/check-db.js
```

La commande users demande un mot de passe d’au moins 12 caractères avec saisie masquée. Remplacer `flo` par l’identifiant souhaité. Caddy obtient et renouvelle les certificats. Pour renouveler un mot de passe oublié depuis SSH, relancer users.js avec l’identifiant existant. L’administrateur peut ensuite créer des invitations et des liens de réinitialisation depuis le site.

## Strava

La connexion reste désactivée sans Client ID/Client Secret. L’import GPX et les autres fonctions ne sont pas bloqués. Voir [STRAVA.md](STRAVA.md) pour créer l’application Strava, renseigner les identifiants **sur le VPS** et activer les événements de révocation.

## Données et sauvegardes

- Volume `sillage_postgres_data` : données utilisateurs, fichiers GPX, géométries PostGIS et jetons Strava chiffrés.
- `caddy_data` et `caddy_config` : configuration et certificats.
- `.env` : configuration locale et secrets ; ignoré par Git.
- `backups/` : sauvegardes privées ; ignoré par Git et par Docker build.

**Ne pas lancer `docker compose down -v`** : cela supprimerait les volumes.

```sh
sudo bash deploy/backup.sh
```

Conserver une copie protégée hors VPS et tester une restauration sur une instance séparée. Les sauvegardes contiennent des données personnelles et des hachages de mots de passe. Conserver aussi `.env` de façon protégée pour récupérer les clés de chiffrement, sans jamais le partager dans Git ou une conversation. Ne pas remplacer les mots de passe PostgreSQL et clés Strava générés sans procédure de rotation adaptée.

Une restauration d’un fichier SQL se fait dans une base PostGIS vide et compatible, après arrêt de l’application et plan de restauration. Ne pas restaurer sur une base contenant déjà les données :

```sh
gunzip -c backups/NOM-DE-LA-SAUVEGARDE.sql.gz | sudo docker compose exec -T db psql -U sillage -d sillage
```

## Validation après déploiement

- Connexion, import GPX, retour dans le sélecteur et téléchargement du fichier d’origine.
- Deux comptes : GPX et segments privés isolés ; segments publics visibles par les membres.
- Filtre hiver, couleurs et légende repliable en bas de carte.
- Carte redimensionnée avec la fenêtre et avec le bouton plein écran, puis retour au mode normal.
- Accrochage OSM, changement de tolérance et mode manuel.
- Création et acceptation d’une invitation ; changement de mot de passe ; gestion des utilisateurs.
- Vérification PostGIS avec check-db.js et dans Admin.
- Après configuration Strava : connexion OAuth réelle, sélection gravel, import privé, téléchargement GPX reconstruit et déconnexion.

Les tests locaux utilisent des adaptateurs SQL et API simulés. Ils ne remplacent pas ces vérifications sur le VPS et dans un navigateur.

### Itinéraires (version 6)

Après le `git pull`, lancer `sudo docker compose up -d --build --wait`, puis `sudo docker compose exec app node server/check-db.js`. Le démarrage crée automatiquement la table PostGIS `planned_routes` et ses index, sans conversion ni suppression des sorties existantes. La vérification porte désormais sur les trois tables géographiques. Aucun nouveau secret ni réglage Strava n’est requis.

### Éditeur d’itinéraires 6.1

Le déploiement reste identique (`git pull --ff-only`, puis `sudo docker compose up -d --build --wait`). Il n’y a pas de nouvelle migration : les portions route/manuelles et les analyses sont dans le JSONB existant `planned_routes.data`, avec la géométrie PostGIS habituelle synchronisée. Aucun nouveau secret n’est nécessaire. Autoriser les sorties HTTPS du serveur vers `overpass-api.de` (revêtements OSM) et `api.open-meteo.com` (altitudes), en plus du routage existant. Le rendu en pointillés apparaît à mesure que l’analyse des revêtements aboutit. En cas de panne, une couverture partielle est affichée ; le tracé et l’export restent disponibles. L’enregistrement attend l’analyse en cours pour inclure les altitudes disponibles dans le GPX.

Après mise à jour, vérifier : prolonger un itinéraire sans modifier les portions précédentes ; ajouter une correction locale sans routage puis reprendre OSM ; annuler/rétablir ; enregistrer et rouvrir le résultat ; vérifier D+/D− et les couvertures ; exporter un fichier portant le nom de l’itinéraire avec le sport et les altitudes disponibles. Les services tiers et l’affichage dans un navigateur doivent être vérifiés sur le serveur réel.

### Profils et consultation 6.2

Mise à jour habituelle par `git pull --ff-only` puis `sudo docker compose up -d --build --wait`, sans migration ni nouvelle variable. Les profils utilisent les analyses déjà enregistrées et le service d’analyse existant pour compléter les données manquantes. Recharger complètement la page pour charger `elevation.js`.

Vérifier sur desktop et mobile : ouvrir un itinéraire par le sélecteur ou l’aperçu, replier le profil sous la carte, survoler ou toucher le graphe et déplacer le curseur au clavier ; vérifier le repère sur le parcours. Essayer les quatre colorations, zoomer pour les bornes kilométriques, passer en édition pour les points, modifier uniquement le routage entrant d’un point. Effacer puis annuler/rétablir doit restaurer le dessin et son contexte sans supprimer la sauvegarde. Les portions manuelles restent continues tant que le revêtement OSM ne les classe pas comme non asphaltées. Vérifier aussi la légende de technicité des segments.

### Profils plus rapides 6.3

Mise à jour habituelle (`git pull --ff-only`, `sudo docker compose up -d --build --wait`), sans migration ni nouvelle clé. Recharger complètement la page pour charger aussi `elevation-data.js`. Les anciens profils sont lissés localement sans nouvelle demande d’altitude. Ouvrir un itinéraire ne lance plus d’analyse ; pour un itinéraire ancien sans données, utiliser « Compléter les données », passer en édition puis enregistrer pour les conserver. Les données déjà sauvegardées restent dans PostgreSQL après un redémarrage.

Les altitudes sont demandées par lots et séparément des surfaces, avec des files de débit distinctes. Une lenteur d’Overpass ne doit plus empêcher l’apparition du graphe d’altitude. Le SVG et le modèle du graphe sont aussi mis en cache/allégés. Vérifier sur le serveur réel le premier calcul, l’apparition du graphe avant les surfaces, l’enregistrement puis la réouverture sans POST vers `/api/plan-elevations` ou `/api/plan-metrics`. Le délai réel dépend des services publics ; aucun temps de réponse externe n’est garanti par les tests locaux.
