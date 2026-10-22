# Sillage — carnet gravel

Application web en français pour retrouver ses sorties, isoler des portions et noter les chemins. Hébergement sur VPS avec Docker Compose, Caddy, Node.js et **PostgreSQL 17 + PostGIS 3.6**.

## Fonctionnalités

- Comptes privés sur invitation, administration des utilisateurs et changement de mot de passe.
- Bibliothèque de sorties GPX / Strava avec menus déroulants, aperçu SVG local, téléchargement et suppression de ses sorties (et segments liés). Conservation des GPX originaux.
- Connexion OAuth Strava, sélection paginée et aperçu de ses activités gravel / vélo directement dans le panneau latéral, puis import de sa propre trace. Le lien « Mon compte » reste disponible pour gérer la connexion.
- Routage vélo OSRM / FOSSGIS sur le réseau OSM complet ; snapping qui suit le GPX en option et tracé manuel point à point. Départ et arrivée conservés au changement de mode, ainsi que les tracés déjà calculés.
- Tolérance OSM 75 / 150 / 250 m ; index spatial, A*, cache de dix minutes et réutilisation des zones téléchargées. Calcul dans un Web Worker avec annulation et progression des points GPS traités.
- Nom facultatif, note sur cinq, technicité, revêtement, single track (oui / non / non renseigné), état hivernal et commentaire. Revêtement suggéré depuis les tags OSM des chemins parcourus, modifiable à la main.
- Catalogue de segments avec menu déroulant et aperçu ; segments personnels et publics visibles aussi pendant la création. Filtres hiver / single track ; couleurs par note, revêtement ou single track. Cliquer sur son segment ouvre l’édition complète, avec possibilité de redessiner.
- Fonds OSM, CyclOSM vélo, Esri satellite, IGN Belgique CartoWeb et WMS personnalisés par utilisateur.
- Carte adaptée à la hauteur de la fenêtre, plein écran et légende compacte repliable dans le coin de la carte. Sur ordinateur, le panneau latéral et l’éditeur ont un défilement indépendant de la carte.
- Export GeoJSON de ses portions. Le bouton de transfert des anciennes notes locales est supprimé.
- Palette sable / olive / argile avec accents citron, nouvelle icône dans l’en-tête et les favoris, interface adaptée au mobile et à l’ordinateur.

## Confidentialité

Les GPX restent privés. Les nouveaux segments sont publics entre membres par défaut, avec une case pour les rendre privés ; les anciens segments restent privés jusqu’à un choix explicite de leur propriétaire.

Les données importées **via l’API Strava et les portions qui en sont tirées restent privées**, conformément à l’accord de l’API (https://www.strava.com/legal/api). Cette restriction est appliquée côté serveur. Le bouton « Créer un nouveau segment indépendant » masque la sortie Strava et efface les points et attributs en cours : le membre choisit de nouveaux points sur OSM, sans copier la trace importée. Les segments issus d’un GPX original de compteur ou d’un tracé manuel indépendant peuvent être publics. Les jetons OAuth sont chiffrés avec AES-256-GCM et liés au compte utilisateur ; aucun jeton ni Client Secret n’est envoyé au navigateur. Les invitations et sessions sont stockées sous forme de hachages. Les mots de passe utilisent scrypt avec un sel aléatoire.

Les sessions durent sept jours. Cookie HttpOnly / Secure / SameSite=Strict, contrôles d’origine pour les écritures et limitation des tentatives de connexion. Le callback OAuth est lié à un état à usage unique, une session d’origine et un cookie nonce dédié. Les événements de révocation utilisent une URL secrète configurée auprès de Strava. Les données Strava locales sont retirées en cas de déconnexion, révocation ou suppression d’activité ; les autres GPX sont conservés.

## PostGIS

Les tables `rides` et `portions` possèdent chacune une colonne `geometry(LineString,4326)` et un index GiST. Les géométries sont remplies à partir des coordonnées existantes et synchronisées par triggers lors des créations et modifications. L’ordre des coordonnées est longitude/latitude dans PostGIS et latitude/longitude dans les tableaux utilisés par Leaflet. Les JSON sont conservés pour compatibilité et pour les attributs.

La migration active explicitement l’extension et vérifie sa présence. L’application ne démarre pas silencieusement avec une base sans PostGIS. La page Admin affiche la version réelle et les nombres de géométries. Le catalogue accepte une emprise optionnelle `bbox=ouest,sud,est,nord` et utilise ST_Intersects en conservant les contrôles de visibilité.

```sh
sudo docker compose exec app node server/check-db.js
```

Cette commande vérifie l’extension, les types, le SRID, l’ordre du premier point des géométries et les index spatiaux sur la base du VPS.

## Déploiement

Voir [le guide OVH](deploy/OVH.md). Pour une installation existante avant la version 4, utiliser le script de migration qui prépare les images, arrête les écritures, sauvegarde, met à jour PostGIS puis vérifie la base :

```sh
sudo bash deploy/update-postgis.sh
```

La connexion Strava reste facultative et désactivée tant que Client ID et Client Secret ne sont pas configurés sur le serveur. Voir [l’activation Strava](deploy/STRAVA.md). Le script `deploy/configure.sh` génère les clés locales nécessaires une fois et les conserve ; ne pas les modifier ensuite sans une procédure de réencryption.

## Tests et validation

Node 22 ou supérieur :

```sh
npm test
```

Les tests de modèle, de routage API, de confidentialité, d’OAuth, de jetons, de snapping et de DOM simulé fonctionnent sans dépendance externe. Le serveur utilise le pilote `pg` et un vrai PostgreSQL/PostGIS. Les tests SQL en mémoire ne remplacent pas une exécution de la migration sur un vrai PostGIS ; le script de déploiement effectue la vérification sur le VPS. La connexion réelle Strava et l’affichage doivent être vérifiés après configuration dans un navigateur.

## Services externes et limites

Leaflet est chargé depuis unpkg, les polices depuis Google Fonts, les tuiles depuis leurs fournisseurs. IGN CartoWeb est fourni pour l’usage non commercial avec attribution IGN / TomTom (https://ngi.be/fr/conditions-dutilisation-pour-le-service-cartoweb-be/). Les WMS sont des services HTTPS publics compatibles EPSG:3857. Changer le fond de carte ne change pas le snapping OSM.

Le routage entre deux points utilise le service vélo [OSRM de FOSSGIS](https://routing.openstreetmap.de/about.html) et transmet seulement les deux coordonnées choisies, sans compte ni fichier GPX. Il n’est plus limité au petit graphe Overpass autour des points. Il s’agit d’un profil vélo général, pas d’une garantie de revêtement gravel ; pour suivre exactement une sortie, utiliser le mode GPX. Le service public est limité à une requête par seconde sur cette instance, avec déduplication, file de quatre requêtes maximum et cache de dix minutes borné à 16 Mo / 64 itinéraires. Ses indisponibilités sont signalées sans effacer les points ni remplacer le calcul par un routage automobile. La variable serveur facultative `BIKE_ROUTING_URL` permet de configurer une autre URL de base OSRM **vélo** compatible HTTPS.

Le snapping GPX et les suggestions de revêtement utilisent Overpass, qui reçoit la zone géographique sélectionnée, sans le fichier GPX. Les calculs sont limités à 15 km et aux chemins OSM disponibles. Les modes souples peuvent ignorer quelques points GPS isolés, sans créer de raccordements entre composantes déconnectées. Le cache Overpass reste borné à 32 Mo / 16 zones. Le téléchargement et l’indexation affichent leur phase ; le pourcentage du snapping correspond aux points de contrôle traités. Le temps réseau reste variable. Pour le routage vélo, le tracé est affiché immédiatement après la réponse du moteur ; la suggestion de revêtement se charge ensuite sans bloquer l’enregistrement. Si OSM est indisponible ou trop éloigné du chemin calculé, le revêtement reste à renseigner manuellement.

Le fond CyclOSM utilise les [tuiles officielles CyclOSM / OSM France](https://www.cyclosm.org/), avec attribution, chargement à la demande et Referer identifiant le site. Les aperçus de bibliothèques sont dessinés localement en SVG, sans téléchargements de tuiles supplémentaires. Les aperçus Strava proviennent de la polyline résumée fournie par l’API au propriétaire et n’ajoutent pas d’appels API par activité. La liste Strava conserve au plus 300 sorties récentes parmi les pages consultées.

Les fichiers GPX sont limités à 25 Mo et 100 000 points ; les traces interrompues affichent le segment le plus long, mais le fichier d’origine complet est conservé. Cent sorties récentes sont proposées dans le sélecteur. L’import Strava utilise le flux de coordonnées, pas un GPX original : le GPX téléchargeable est reconstruit, sans altitude ni horodatage. La capacité et les quotas de l’application Strava peuvent limiter les comptes et consultations. Pas de réimport GeoJSON ni de réinitialisation de mot de passe par email ; l’admin peut produire un lien de réinitialisation.

Le préremplissage du revêtement repose sur `surface=*` le long du chemin retenu. Il exige au moins 50 % de longueur renseignée ; un revêtement représentant au moins 60 % de la longueur connue devient dominant, sinon « Mixte ». Aucune suggestion n’est appliquée si les données sont insuffisantes ; une modification manuelle est conservée lors des recalculs. Le caractère single track reste un attribut déclaré par le membre.
