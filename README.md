# Sillage — carnet gravel

Application web en français pour retrouver ses sorties, isoler des portions et noter les chemins. Hébergement sur VPS avec Docker Compose, Caddy, Node.js et **PostgreSQL 17 + PostGIS 3.6**.

## Fonctionnalités

- Comptes privés sur invitation, administration des utilisateurs et changement de mot de passe.
- Bibliothèque de sorties GPX / Strava avec menus déroulants, aperçu sur fond OSM, téléchargement et suppression de ses sorties (et segments liés). Conservation des GPX originaux.
- Connexion OAuth Strava, sélection paginée et aperçu de ses activités gravel / vélo directement dans le panneau latéral, puis import de sa propre trace. Le lien « Mon compte » reste disponible pour gérer la connexion.
- Routage vélo OSRM / FOSSGIS sur le réseau OSM complet ; snapping qui suit le GPX en option et tracé manuel point à point. Départ et arrivée déplaçables, glissement de la route pour ajouter des passages, déplacement et suppression des passages. Les points sont conservés au changement de mode et les points du routage sont enregistrés avec le segment.
- Tolérance OSM 75 / 150 / 250 m ; index spatial, A*, cache de dix minutes et réutilisation des zones téléchargées. Calcul dans un Web Worker avec annulation et progression des points GPS traités.
- Nom facultatif, note sur cinq, technicité, revêtement, single track (oui / non / non renseigné), état hivernal et commentaire. Revêtement suggéré depuis les tags OSM des chemins parcourus, modifiable à la main.
- Catalogue de segments avec menu déroulant et aperçu ; segments personnels et publics visibles aussi pendant la création. Filtres hiver / single track ; couleurs par note, revêtement ou single track. Cliquer sur son segment ouvre l’édition complète, avec possibilité de redessiner.
- Fonds OSM, CyclOSM vélo, Esri satellite, IGN Belgique CartoWeb et WMS personnalisés par utilisateur.
- Carte adaptée à la hauteur de la fenêtre, plein écran et légende compacte repliable dans le coin de la carte. Sur ordinateur, le panneau latéral et l’éditeur ont un défilement indépendant de la carte.
- Onglet « Itinéraires » : parcours indépendants jusqu’à 500 km et 200 points, routage vélo avec corrections manuelles locales, annuler/rétablir, passages déplaçables, enregistrement privé par défaut ou public entre membres, bibliothèque, modification de ses parcours, copie des parcours publics et export GPX.
- Case « Toutes mes traces importées » : superposition de toutes les sorties du compte connecté, y compris les imports Strava, sans rendre les sorties d’autres comptes accessibles. Les géométries de superposition sont simplifiées pour l’affichage, les originaux restent inchangés.
- Export GeoJSON de ses portions. Le bouton de transfert des anciennes notes locales est supprimé.
- Palette sable / olive / argile avec accents citron, nouvelle icône dans l’en-tête et les favoris, interface adaptée au mobile et à l’ordinateur.

## Confidentialité

Les GPX restent privés. Les nouveaux segments sont publics entre membres par défaut, avec une case pour les rendre privés ; les anciens segments restent privés jusqu’à un choix explicite de leur propriétaire.

Les données importées **via l’API Strava et les portions qui en sont tirées restent privées**, conformément à l’accord de l’API (https://www.strava.com/legal/api). Cette restriction est appliquée côté serveur. Le bouton « Créer un nouveau segment indépendant » conserve la sortie comme repère privé, mais efface les points et attributs du dessin en cours. Le membre choisit de nouveaux points sur OSM ou les place manuellement ; le mode « Suivre le GPX » est alors désactivé. Le nouveau segment ne reprend ni coordonnées GPS, ni nom, ni identifiant ni lien de sortie Strava, et peut être public. Les segments accrochés au GPX Strava conservent leur provenance et restent privés. Cette séparation technique ne constitue pas une confirmation de Strava que le redessin visuel est autorisé pour le partage ; les textes ne tranchent pas explicitement ce cas. Les segments issus d’un GPX original de compteur ou d’un tracé manuel indépendant peuvent être publics. Les jetons OAuth sont chiffrés avec AES-256-GCM et liés au compte utilisateur ; aucun jeton ni Client Secret n’est envoyé au navigateur. Les invitations et sessions sont stockées sous forme de hachages. Les mots de passe utilisent scrypt avec un sel aléatoire.

Les sessions durent sept jours. Cookie HttpOnly / Secure / SameSite=Strict, contrôles d’origine pour les écritures et limitation des tentatives de connexion. Le callback OAuth est lié à un état à usage unique, une session d’origine et un cookie nonce dédié. Les événements de révocation utilisent une URL secrète configurée auprès de Strava. Les données Strava locales sont retirées en cas de déconnexion, révocation ou suppression d’activité ; les autres GPX sont conservés.

## PostGIS

Les tables `rides`, `portions` et `planned_routes` possèdent chacune une colonne `geometry(LineString,4326)` et un index GiST. Les géométries sont remplies à partir des coordonnées existantes et synchronisées par triggers lors des créations et modifications. L’ordre des coordonnées est longitude/latitude dans PostGIS et latitude/longitude dans les tableaux utilisés par Leaflet. Les JSON sont conservés pour compatibilité et pour les attributs.

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

Le routage et l’accrochage individuel des points utilisent le service vélo [OSRM de FOSSGIS](https://routing.openstreetmap.de/about.html) et transmet seulement les coordonnées choisies (départ, arrivée et passages éventuels), sans compte ni fichier GPX. Il n’est plus limité au petit graphe Overpass autour des points. Il s’agit d’un profil vélo général, pas d’une garantie de revêtement gravel ; pour suivre exactement une sortie, utiliser le mode GPX. Le service public est limité à une requête par seconde sur cette instance, avec déduplication, file de quatre requêtes maximum et cache de dix minutes borné à 16 Mo / 64 itinéraires. Ses indisponibilités sont signalées sans effacer les points ni remplacer le calcul par un routage automobile. La variable serveur facultative `BIKE_ROUTING_URL` permet de configurer une autre URL de base OSRM **vélo** compatible HTTPS.

Le snapping GPX et les suggestions de revêtement utilisent Overpass, qui reçoit la zone géographique sélectionnée, sans le fichier GPX. Le suivi GPX est limité à 15 km et aux chemins OSM disponibles. Les modes souples peuvent ignorer quelques points GPS isolés, sans créer de raccordements entre composantes déconnectées. Le cache Overpass reste borné à 32 Mo / 16 zones. Le téléchargement et l’indexation affichent leur phase ; le pourcentage du snapping correspond aux points de contrôle traités. Le temps réseau reste variable. Pour le routage vélo, le tracé est affiché immédiatement après la réponse du moteur ; la suggestion de revêtement se charge ensuite sans bloquer l’enregistrement. Si OSM est indisponible ou trop éloigné du chemin calculé, le revêtement reste à renseigner manuellement.

Le fond CyclOSM utilise les [tuiles officielles CyclOSM / OSM France](https://www.cyclosm.org/), avec attribution, chargement à la demande et Referer identifiant le site. Les aperçus de sorties et segments sont des mini-cartes Leaflet avec fond OSM et attribution. Les tuiles sont chargées seulement lorsque l’aperçu devient visible ; les cartes et observateurs sont libérés au changement de sélection. Le SVG reste un secours si Leaflet est indisponible. Les aperçus Strava proviennent de la polyline résumée fournie par l’API au propriétaire et n’ajoutent pas d’appels API par activité. La liste Strava conserve au plus 300 sorties récentes parmi les pages consultées.

Les fichiers GPX sont limités à 25 Mo et 100 000 points ; les traces interrompues affichent le segment le plus long, mais le fichier d’origine complet est conservé. Cent sorties récentes sont proposées dans le sélecteur. L’import Strava utilise le flux de coordonnées, pas un GPX original : le GPX téléchargeable est reconstruit, sans altitude ni horodatage. La capacité et les quotas de l’application Strava peuvent limiter les comptes et consultations. Pas de réimport GeoJSON ni de réinitialisation de mot de passe par email ; l’admin peut produire un lien de réinitialisation.

Le préremplissage du revêtement repose sur `surface=*` le long du chemin retenu. Il exige au moins 50 % de longueur renseignée ; un revêtement représentant au moins 60 % de la longueur connue devient dominant, sinon « Mixte ». Aucune suggestion n’est appliquée si les données sont insuffisantes ; une modification manuelle est conservée lors des recalculs. Le caractère single track reste un attribut déclaré par le membre.

Le routage de portions accepte jusqu’à 12 points, dont 10 passages. Le planificateur accepte 200 points et 500 km : il conserve une géométrie par portion et n’envoie que deux points par requête. Prolonger calcule uniquement la nouvelle portion ; déplacer un point recalcule ses deux voisines ; insérer un point recalcule la portion divisée. Les géométries et analyses des autres portions sont conservées. La tolérance du planificateur est fixée à 150 m. Le premier point est accroché avec OSRM Nearest ; les nouvelles extrémités sont repositionnées sur les positions réellement accrochées sans modifier une portion antérieure déjà calculée. Les clics rapprochés sont regroupés pendant 250 ms ; les réponses devenues périmées sont ignorées. Le recalcul démarre à la fin du glissement. Les fractions cumulées de longueur déterminent l’insertion sur un parcours sinueux. Les segments et les traces superposés ne capturent plus les clics dans le planificateur. La liste des points est repliée par défaut.

Dans le planificateur, « Sans routage · correction locale » relie directement les prochains points et peut aussi diviser une portion existante en insérant un point manuel. Reprendre le routage conserve ces corrections. Annuler/rétablir garde jusqu’à 60 opérations de géométrie (boutons ou Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z). Les portions manuelles sont enregistrées séparément et survivent au rechargement ; les anciens itinéraires sont découpés sans recalcul intégral. Le nom de l’itinéraire est obligatoire, côté navigateur et serveur.

L’analyse, distincte du routage, interroge Overpass le long d’un corridor de 35 m et associe les revêtements explicitement renseignés dans OSM aux portions du parcours (distance maximale 20 m et direction compatible). Une voie sans attribut reste inconnue ; une route parallèle peut rendre cette estimation incertaine. Asphalte, bitume et béton sont continus ; les autres revêtements connus sont en pointillés, quel que soit le mode de construction (routé ou manuel). Une correction manuelle sans revêtement connu reste continue. L’affichage indique les distances, pourcentages et couvertures disponibles. Les données OSM peuvent différer de la version utilisée par le moteur de routage.

Le dénivelé est estimé avec l’API publique [Open-Meteo](https://open-meteo.com/en/docs/elevation-api) et le modèle de surface Copernicus DEM GLO-90, de résolution nominale d’environ 90 m. Ce ne sont pas des altitudes GPS ou un MNT LiDAR local. Les échantillons sont espacés d’environ 100 m, limités à 401 par portion et 4096 par demande regroupée (espacement augmenté si nécessaire), dédupliqués aux points communs et envoyés par lots d’au plus 100 coordonnées. Les altitudes sont prioritaires et indépendantes des requêtes de revêtement Overpass. Les données brutes échantillonnées restent enregistrées dans le JSONB des itinéraires ; le modèle du graphe applique localement un lissage triangulaire selon la distance (rayon 150 m) et un seuil de 3 m pour le D+/D−. Les portions contiguës sont lissées ensemble, sans relier les lacunes d’altitude. Graphe, curseur, pentes, D+/D− et GPX utilisent le même profil lissé. Le relief fin peut être sous-estimé ; ces valeurs restent indicatives.

Ouvrir un itinéraire, même incomplet, n’appelle plus aucun service d’altitude ou de surface. Le bouton « Compléter les données » permet de demander explicitement les données manquantes ; le propriétaire les conserve en enregistrant ensuite l’itinéraire. Pendant le dessin, seules les portions nouvelles ou modifiées sont analysées après une courte pause (900 ms). Modifier un itinéraire ancien n’entraîne pas la récupération automatique des analyses manquantes des autres portions. Le cache des modèles est conservé tant que géométrie et profils d’altitude sont identiques ; une mise à jour des surfaces ne reconstruit pas le graphe. L’affichage SVG est limité à environ 1200 points pour le graphe et 320 pour la miniature, en conservant les extrema, alors que le curseur conserve le profil complet.

L’enregistrement attend l’analyse engagée pour conserver les résultats disponibles. Une panne d’altitude ou de revêtement laisse l’autre résultat utilisable, indique la couverture partielle et permet quand même l’enregistrement. Les appels identifiés sont limités à une requête par seconde **par fournisseur**, avec files séparées, quatre analyses simultanées maximum, déduplication et cache de résultats (32 Mo / 128 entrées, une heure, une minute pour un résultat incomplet). Les altitudes individuelles ont un cache mémoire borné à 32768 coordonnées pendant 24 heures, réutilisable entre découpages différents d’un parcours ; il est vidé au redémarrage du serveur, contrairement aux profils enregistrés en base. Après une panne, une minute de pause évite de réinterroger le service pour chaque portion. Aucune clé supplémentaire n’est requise pour cet usage non commercial des services publics ; leurs limites s’appliquent.



## Mise à jour vers les itinéraires (version 6)

La migration au démarrage crée `planned_routes`, sa géométrie PostGIS, son trigger et son index GiST. Elle est additive et conserve les sorties et portions existantes. Après récupération de la nouvelle version :

```sh
sudo docker compose up -d --build --wait
sudo docker compose exec app node server/check-db.js
```

Les itinéraires sont privés par défaut. Le propriétaire peut modifier ou supprimer son parcours ; les autres membres peuvent consulter et exporter uniquement les parcours publics et en créer leur propre copie. La désactivation d’un compte retire ses itinéraires publics du catalogue des autres membres. L’export est un GPX 1.1 reconstruit à partir de la géométrie enregistrée. Son nom de fichier est le nom de l’itinéraire suivi de `.gpx`, avec encodage UTF-8 et nettoyage des caractères interdits dans un fichier. Le sport est indiqué par `<type>cycling</type>` et l’extension `sillage:sport=GravelRide` (les logiciels ignorant cette extension verront du vélo). Les altitudes disponibles sont interpolées à partir du profil estimé enregistré ; aucune altitude manquante ni aucun horodatage ne sont inventés.

Les aperçus ont des règles CSS limitées au SVG de secours direct : les SVG du moteur Leaflet et son drapeau d’attribution conservent leurs dimensions natives. Les tests incluent l’accrochage des marqueurs, les réponses tardives, le planificateur long, les droits de partage, l’export GPX et la confidentialité de la superposition des sorties. La migration sur PostGIS et les gestes dans un navigateur réel restent à vérifier sur le VPS.

## Consultation et profil d’élévation (6.2)

Le choix dans la bibliothèque ou le clic sur la carte d’aperçu ouvre directement l’itinéraire en consultation. Un miniature du profil est placée juste sous cette carte, puis la répartition des surfaces en pourcentage. Le propriétaire passe en édition avec « Modifier l’itinéraire » ; les points de passage sont cachés en consultation. Le bouton « Effacer l’itinéraire » à droite vide la carte pour un nouveau dessin sans supprimer l’itinéraire enregistré. C’est une opération de l’historique : annuler/rétablir restaure aussi le nom, les analyses, la visibilité et le mode de consultation ou d’édition.

Le profil d’altitude est un panneau repliable sous la carte, disponible pendant le dessin et en consultation, y compris en plein écran. Le survol, le glissement au doigt et le curseur accessible au clavier montrent la distance, l’altitude et la pente estimées, avec un repère lié sur le parcours. Les portions sans altitude restent des trous dans le graphe, sans interpolation entre deux portions séparées par des données manquantes. La miniature utilise les mêmes données. Les analyses manquantes peuvent être calculées sur demande explicite lors de la consultation d’un parcours public sans modifier celui de son propriétaire.

Le sélecteur de l’itinéraire propose ligne simple, surface, pente et altitude. La couleur de surface et sa légende indiquent le pourcentage de chaque type ; une surface inconnue reste grise. Les pentes sont estimées sur une fenêtre d’environ 150 m à partir du profil de terrain ; elles ne remplacent pas une mesure sur le terrain. Les pointillés représentent exclusivement un revêtement non asphalté explicitement renseigné, avec bitume et béton continus. Le mode manuel ne change plus le motif de la ligne. Les segments possèdent une légende de technicité en plus de la note, du revêtement et du single track.

En consultation, les bornes kilométriques suivent le tracé et s’adaptent au zoom : 1 km dès le niveau 14, 5 km aux niveaux 12–13, 10 km aux niveaux 10–11, aucune aux niveaux inférieurs. Seules les bornes dans l’emprise visible sont dessinées, avec espacement minimal en pixels et nombre limité pour éviter l’encombrement. Les boutons de passage et les marqueurs d’édition réapparaissent en édition. Cliquer un marqueur ouvre le choix « Sans routage depuis le point précédent », également accessible dans la liste repliable. Ce choix ne modifie que la portion entrante ; il est annulable, enregistré et conservé après déplacement du point.
