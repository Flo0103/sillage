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

### Revêtements et accès OSM 6.4

Mise à jour habituelle (`git pull --ff-only`, puis `sudo docker compose up -d --build --wait`), sans migration ni clé supplémentaire. Recharger la page pour charger `osm-tags.js` et la version 6.4 des scripts. Overpass doit rester accessible depuis le serveur. Le routage local réutilise le cache des zones OSM ; le secours OSRM conserve ses propres restrictions d’accès et l’annonce. Placer des étapes proches pour conserver la maîtrise des accès dans le moteur local.

Sur un itinéraire existant, cliquer **Actualiser les revêtements OSM** puis **Modifier l’itinéraire** et enregistrer pour conserver la nouvelle analyse. L’altitude ne doit pas être redemandée. Vérifier les pointillés au changement de revêtement, les « ! » et leurs infobulles uniquement aux accès limités, puis la sauvegarde et la réouverture. Tester le cas signalé rue du Jeu de Paume à Spa : il n’a pas pu être vérifié sur les données OSM réelles depuis l’environnement de développement. Les tests automatisés couvrent une rue découpée au changement de revêtement, les nœuds rapprochés et les sens vélo dans les deux directions.

Vérifier aussi le repli/réouverture de la bibliothèque sur desktop et mobile, sans perte du parcours. Les contrôles de carte passent sur plusieurs lignes si nécessaire. Les tests de contrôleur et API sont simulés ; le rendu dans un vrai navigateur et les services publics restent à vérifier sur le VPS.

### Cas réel Spa et secours de données 6.4.1

Mise à jour habituelle : `git pull --ff-only`, puis `sudo docker compose up -d --build --wait`. Aucun secret ni changement de base. Le serveur peut désormais utiliser `api.openstreetmap.org` en HTTPS comme secours pour les petites zones si Overpass est indisponible. Le routage local est conservé dans ce cas ; le moteur OSRM public reste le dernier recours, annoncé par un avertissement.

Après déploiement :

```sh
sudo docker compose exec app node server/check-routing.js
```

La commande affiche d’abord `Sillage 6.4.1`, puis trois résultats avec moteur, source et longueur. Le test en ligne complet (accrochage du départ puis routage sur les données OSM réelles) a donné environ 823 m entre les extrémités dans les deux sens, et la même longueur avec le passage gravel explicite, dont environ 390 m de gravier. Ces tests vérifient le passage au changement de revêtement ; il ne doit pas produire le détour OSRM d’environ 1,23 km observé pendant le diagnostic. Les distances peuvent évoluer avec les données OSM. L’ancienne mention d’absence de test réel en 6.4 est désormais levée pour le moteur et ces données ; le rendu dans le navigateur et le résultat sur le VPS restent à vérifier après déploiement.

### Performances et profil 6.5

Mise à jour habituelle (`git pull --ff-only`, puis `sudo docker compose up -d --build --wait`), sans migration ni nouvelle clé. Recharger complètement la page pour charger les scripts et styles `v=6.5.0`. Les caches restent en mémoire et se remplissent au premier usage après un redémarrage ; le premier chargement d’une zone dépend des services publics. Les réseaux préparés et les résultats sont bornés, et les données expirées ne sont pas réutilisées par le cache de zone.

Vérifier après déploiement : ajouter plusieurs points voisins puis déplacer un point, annuler et rétablir ; les portions anciennes doivent rester intactes. Vérifier les sens uniques, les pointillés et la rue du Jeu de Paume avec `sudo docker compose exec app node server/check-routing.js` (version 6.5.0 et environ 823 m dans les deux sens). Les temps affichés peuvent varier avec l’état des services ; le cache doit surtout éviter des téléchargements supplémentaires sur des zones déjà chargées.

Pour le profil : vérifier les graduations régulières, le dégradé léger et l’option « Points haut et bas », puis redimensionner la fenêtre, replier la bibliothèque et passer en plein écran sans perdre le curseur. En mode « Pente », les descentes doivent être bleues, le plat blanc bordé et les montées rouges. Les libellés de légende gardent les signes. Desktop et mobile ont été vérifiés dans Chromium avec API de démonstration ; la connexion au site réel et les données de chaque compte restent à vérifier sur le VPS.


## Carte commune, légendes et relief (6.6.0)

Mise à jour habituelle : `git pull --ff-only`, puis `sudo docker compose up -d --build --wait`. Pas de migration ni de clé supplémentaire. Recharger la page pour les fichiers `v=6.6.0`.

Les sorties et segments partagent l’onglet Carte. « Dessiner un segment » ouvre l’éditeur ; le fermer conserve la sortie chargée comme repère. Les bibliothèques et la carte sont repliables indépendamment. Le panneau « Carte et légendes », également disponible en plein écran, réunit les fonds (y compris WMS), les filtres, les couleurs, les traces et les légendes.

« Fond de carte et relief » permet d’activer l’ombrage Esri World Hillshade au-dessus de n’importe quel fond. La transparence règle uniquement ce calque : 0 % = opaque, 100 % = invisible. Les vecteurs restent au-dessus du relief ; la composition en mode multiply conserve les informations du fond. Source : `https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}` ; attribution et lien aux crédits dans la carte, niveaux natifs utilisés jusqu’à 16 puis surzoom. L’activation est facultative et les tuiles ne sont pas préchargées. Si ce service externe est indisponible, le fond choisi reste utilisable et un message est affiché dans le panneau.

Vérifier sur ordinateur et mobile : sortie et segments dans le même onglet, dessin sur un segment existant, filtres sans perte du dessin, changement de fond avec relief conservé et curseur de transparence. Dans le planificateur, contrôler les palettes distinctes du plaisir et de l’altitude, le profil coloré, puis enregistrer : seules les bornes kilométriques s’affichent ; les points de passage réapparaissent via « Modifier l’itinéraire ». Les altitudes déjà enregistrées restent réutilisées.


## Simplification et recherche d’itinéraires (6.7.0)

Mise à jour habituelle : `git pull --ff-only`, puis `sudo docker compose up -d --build --wait`. Sans migration ni nouvelle clé. Recharger la page pour les fichiers `v=6.7.0`.

Le slider de relief de 6.6.0 est supprimé : la case active l’ombrage à 0 % de transparence. Le filtre single track et l’interrupteur général de segments sont supprimés. Les filtres personnel/public et hiver restent disponibles ; les single tracks apparaissent en pointillés. Vérifier le survol des attributs dans les deux onglets, y compris pendant le dessin : cliquer doit ajouter un point. Les fiches de survol échappent les textes des membres.

Vérifier la recherche d’itinéraires, les seuils distance / D+ inclusifs et les filtres d’extrémités lors d’un déplacement de carte. Le dénivelé manquant est exclu seulement lorsqu’un seuil de D+ est demandé. Les filtres restent locaux aux données accessibles du compte et ne déclenchent pas de nouvelle analyse d’altitude. Tester « Replier » dans la bibliothèque et la réouverture depuis la carte, sans perte du brouillon. Le nouveau module `/plan-library.js` est servi derrière l’authentification comme les autres scripts de l’application.


## Éditeur et export des données (6.8.0)

Mise à jour habituelle : `git pull --ff-only`, puis `sudo docker compose up -d --build --wait`. Aucune migration ni nouvelle clé. Recharger la page pour charger `v=6.8.0`.

Vérifier le formulaire en tête d’éditeur, le bouton « Créer un nouvel itinéraire » et Annuler pour retrouver le brouillon précédent. Le repli utilise désormais une seule icône de panneau avec chevron ; aucune commande « Masquer la bibliothèque » ne reste dans la barre. Vérifier sur ordinateur et mobile que la bibliothèque reste dépliable sans perdre le tracé, et que les deux curseurs de distance / D+ fonctionnent à la souris et au clavier.

L’export complet se trouve dans Mon compte, sous Mes données. Le point d’accès GET `/api/account/export` exige la session et renvoie une pièce jointe JSON avec Cache-Control no-store, private. L’export lit les tables du compte dans une transaction PostgreSQL REPEATABLE READ READ ONLY et libère la connexion même en cas d’erreur. Il conserve les GPX disponibles, les géométries, les attributs, les relations et les analyses ; les segments ont une représentation GeoJSON. Les autres utilisateurs et les secrets de connexion sont exclus. Tester le téléchargement puis vérifier que le fichier contient seulement les données du compte connecté. Le volume du JSON dépend des sorties et analyses enregistrées.


## Carte directe et filtrage du dénivelé (6.9.0)

Mise à jour habituelle : `git pull --ff-only`, puis `sudo docker compose up -d --build --wait`. Recharger complètement pour les scripts `v=6.9.0`. Pas de migration ni de nouvelle clé.

Vérifier au chargement : relief et extrema cochés, absence de bandeau entre navigation et carte, pictogrammes de centrage et plein écran à côté du zoom, repli de bibliothèque et dessin toujours accessibles. En plein écran, le bouton de sortie reste disponible ; les contrôles ne déclenchent pas de point de tracé.

Le dénivelé est recalculé localement sur les profils enregistrés avec un seuil de retournement de 5 m. Les pentes sont estimées sur 300 m. Vérifier un ancien itinéraire sans requête d’altitude et comparer son D+ dans l’éditeur et la bibliothèque. Les valeurs D+/D− stockées par portion restent historiques jusqu’au prochain enregistrement ; l’affichage utilise le modèle recalculé. La source Copernicus reste la même : une concordance exacte avec Strava/Garmin n’est pas promise sans comparaison du profil effectif. Relever le nouveau total après déploiement pour comparer les mêmes tracés et profils source.


## Points, surfaces et historique dans la carte (6.10.0)

Mise à jour habituelle : `git pull --ff-only`, puis `sudo docker compose up -d --build --wait`. Aucune migration ni nouvelle clé : les portions des segments sont conservées dans `portions.data` (JSONB), avec la géométrie PostGIS existante. Recharger complètement pour les fichiers `v=6.10.0`.

Vérifier : nouveau tracé d’itinéraire avec bibliothèque repliée ; pourcentage non asphalté visible avec détail des surfaces fermé ; clic sur le départ / passage / arrivée pour sélectionner, rendre manuelle la liaison entrante ou supprimer. Le départ ne propose pas de liaison entrante. Fermer et Supprimer ne doivent jamais ajouter de point sur la carte. Tester Annuler / rétablir depuis les outils, y compris en plein écran.

Pour un segment, placer quatre points successifs : le dernier doit rester l’arrivée, les anciens calculs doivent rester intacts et seuls les nouveaux raccords être calculés. Enregistrer un segment contenant une correction locale, le rouvrir et vérifier le mode de ses portions. Les attributs seuls ne doivent pas effacer ces portions ; les anciens clients qui changent réellement la géométrie sans fournir de portions restent compatibles. Les aides générales sont derrière ?. Les droits de modification et la confidentialité des imports Strava restent appliqués.

## Identité visuelle gravel (6.11.0)

`git pull --ff-only`, puis `sudo docker compose up -d --build --wait`. Recharger complètement la page pour les ressources `v=6.11.0`. La refonte concerne uniquement la présentation ; aucune migration, clé ou variable supplémentaire. Les polices Barlow et Barlow Condensed sont chargées via Google Fonts avec une solution de secours système. Vérifier la connexion, les deux onglets, le défilement des panneaux et la gestion du compte sur ordinateur et téléphone.

## Atlas de terrain et polices locales (6.12.0)

Mise à jour habituelle : `git pull --ff-only`, puis `sudo docker compose up -d --build --wait`, puis recharger complètement la page. Les actifs graphiques et les polices WOFF2 sont inclus dans l’image Docker. Ils sont servis avant connexion par une liste explicite, avec types MIME et cache immuable ; les fichiers portent un suffixe de version. Aucune clé, variable, migration ou installation de police sur le VPS n’est nécessaire. Les écrans ne dépendent plus de Google Fonts. Vérifier connexion, navigation, aperçus et profil, ainsi que le défilement des panneaux et les champs sur mobile.

## Commandes de carte sur mobile (6.12.1)

Mise à jour habituelle : `git pull --ff-only`, puis `sudo docker compose up -d --build --wait`, puis rechargement complet pour les ressources `v=6.12.1`. Aucune migration ni configuration supplémentaire. Sur téléphone, vérifier « Carte et légendes » en haut à droite, son ouverture avec OSM, IGN et WMS, puis le nouveau bouton de création près d’Annuler/Rétablir. La création d’un nouvel itinéraire reste annulable.
