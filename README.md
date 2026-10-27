# Sillage — atlas gravel

Application web en français pour retrouver ses sorties, isoler des portions et noter les chemins. Hébergement sur VPS avec Docker Compose, Caddy, Node.js et **PostgreSQL 17 + PostGIS 3.6**.

## Fonctionnalités

- Comptes privés sur invitation, administration des utilisateurs et changement de mot de passe.
- Onglet « Carte · sorties et segments » commun à la consultation et au dessin, avec bibliothèques repliables et bouton « Dessiner un segment ». La sortie chargée reste visible en quittant le dessin ; les segments existants laissent passer les clics pendant le tracé.
- Bibliothèque de sorties GPX / Strava avec menus déroulants, aperçu sur fond OSM, téléchargement et suppression de ses sorties (et segments liés). Conservation des GPX originaux.
- Connexion OAuth Strava, sélection paginée et aperçu de ses activités gravel / vélo directement dans le panneau latéral, puis import de sa propre trace. Le lien « Mon compte » reste disponible pour gérer la connexion.
- Routage local OSM pour les étapes courtes, avec secours OSRM / FOSSGIS pour les grandes emprises ou les pannes ; snapping qui suit le GPX en option et tracé manuel point à point. Départ et arrivée déplaçables, glissement de la route pour ajouter des passages, déplacement et suppression des passages. Les points sont conservés au changement de mode et les points du routage sont enregistrés avec le segment.
- Tolérance OSM 75 / 150 / 250 m ; index spatial, A*, cache de dix minutes et réutilisation des zones téléchargées. Calcul dans un Web Worker avec annulation et progression des points GPS traités.
- Nom facultatif, note sur cinq, technicité, revêtement, single track (oui / non / non renseigné), état hivernal et commentaire. Revêtement suggéré depuis les tags OSM des chemins parcourus, modifiable à la main.
- Catalogue de segments avec menu déroulant et aperçu ; segments personnels et publics visibles aussi pendant la création. Filtre hiver ; couleurs par note, revêtement ou technicité ; single tracks toujours visibles en pointillés. Au survol dans les deux onglets, fiche des attributs ; les clics restent utilisables pour dessiner. Cliquer sur son segment ouvre l’édition complète, avec possibilité de redessiner.
- Fonds OSM, CyclOSM vélo, Esri satellite, IGN Belgique CartoWeb et WMS personnalisés par utilisateur. Panneau « Carte et légendes » commun aux fonds, superpositions, filtres et palettes ; ombrage Esri World Hillshade facultatif, superposé à tout fond, sans transparence lorsque la case est cochée.
- Recherche des itinéraires par nom, auteur et notes, filtres combinés de distance, D+ enregistré et départ / arrivée sur la zone visible ; compteur et réinitialisation. Déplacement de la carte pris en compte sans requête réseau ni recalcul d’altitude.
- Carte sans bandeau intermédiaire, commandes pictographiques de centrage / plein écran / repli / dessin réunies près du zoom, et légende compacte repliable dans le coin de la carte. Sur ordinateur, le panneau latéral et l’éditeur ont un défilement indépendant de la carte.
- Onglet « Itinéraires » : parcours indépendants jusqu’à 500 km et 200 points, routage vélo avec corrections manuelles locales, annuler/rétablir, passages déplaçables, enregistrement privé par défaut ou public entre membres, bibliothèque, modification de ses parcours, copie des parcours publics et export GPX.
- Case « Toutes mes traces importées » : superposition de toutes les sorties du compte connecté, y compris les imports Strava, sans rendre les sorties d’autres comptes accessibles. Les géométries de superposition sont simplifiées pour l’affichage, les originaux restent inchangés.
- Export de toutes ses données depuis Mon compte : fichier JSON contenant compte, sorties avec GPX originaux, segments GeoJSON, itinéraires et analyses, fonds WMS et identité de la connexion Strava. Le bouton de transfert des anciennes notes locales est supprimé.
- Profil coloré et ligne d’altitude avec la même palette terrain que la carte ; notes de plaisir du rouge (1/5) au vert (5/5). Après enregistrement, l’itinéraire passe directement en consultation avec bornes kilométriques ; « Modifier » retrouve les points de passage.
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

Le routage et l’accrochage individuel des points utilisent en priorité le graphe OSM local décrit en section 6.4. Le service vélo [OSRM de FOSSGIS](https://routing.openstreetmap.de/about.html) sert de secours et reçoit seulement les coordonnées choisies (départ, arrivée et passages éventuels), sans compte ni fichier GPX. Le profil public est un profil vélo général, sans garantie de revêtement gravel ; pour suivre exactement une sortie, utiliser le mode GPX. Le secours public est limité à une requête par seconde sur cette instance, avec déduplication, file de quatre requêtes maximum et cache de dix minutes borné à 16 Mo / 64 itinéraires. Ses indisponibilités sont signalées sans effacer les points ni passer à un routage automobile. La variable serveur facultative `BIKE_ROUTING_URL` permet de configurer une autre URL de base OSRM **vélo** compatible HTTPS.

Le snapping GPX et les suggestions de revêtement utilisent Overpass, qui reçoit la zone géographique sélectionnée, sans le fichier GPX. Le suivi GPX est limité à 15 km et aux chemins OSM disponibles. Les modes souples peuvent ignorer quelques points GPS isolés, sans créer de raccordements entre composantes déconnectées. Le cache Overpass reste borné à 32 Mo / 16 zones. Le téléchargement et l’indexation affichent leur phase ; le pourcentage du snapping correspond aux points de contrôle traités. Le temps réseau reste variable. Pour le routage vélo, le tracé est affiché immédiatement après la réponse du moteur ; la suggestion de revêtement se charge ensuite sans bloquer l’enregistrement. Si OSM est indisponible ou trop éloigné du chemin calculé, le revêtement reste à renseigner manuellement.

Le fond CyclOSM utilise les [tuiles officielles CyclOSM / OSM France](https://www.cyclosm.org/), avec attribution, chargement à la demande et Referer identifiant le site. Les aperçus de sorties et segments sont des mini-cartes Leaflet avec fond OSM et attribution. Les tuiles sont chargées seulement lorsque l’aperçu devient visible ; les cartes et observateurs sont libérés au changement de sélection. Le SVG reste un secours si Leaflet est indisponible. Les aperçus Strava proviennent de la polyline résumée fournie par l’API au propriétaire et n’ajoutent pas d’appels API par activité. La liste Strava conserve au plus 300 sorties récentes parmi les pages consultées.

Les fichiers GPX sont limités à 25 Mo et 100 000 points ; les traces interrompues affichent le segment le plus long, mais le fichier d’origine complet est conservé. Cent sorties récentes sont proposées dans le sélecteur. L’import Strava utilise le flux de coordonnées, pas un GPX original : le GPX téléchargeable est reconstruit, sans altitude ni horodatage. La capacité et les quotas de l’application Strava peuvent limiter les comptes et consultations. Pas de réimport GeoJSON ni de réinitialisation de mot de passe par email ; l’admin peut produire un lien de réinitialisation.

Le préremplissage du revêtement repose sur `surface=*` le long du chemin retenu. Il exige au moins 50 % de longueur renseignée ; un revêtement représentant au moins 60 % de la longueur connue devient dominant, sinon « Mixte ». Aucune suggestion n’est appliquée si les données sont insuffisantes ; une modification manuelle est conservée lors des recalculs. Le caractère single track reste un attribut déclaré par le membre.

Le routage de portions accepte jusqu’à 12 points, dont 10 passages. Le planificateur accepte 200 points et 500 km : il conserve une géométrie par portion et n’envoie que deux points par requête. Prolonger calcule uniquement la nouvelle portion ; déplacer un point recalcule ses deux voisines ; insérer un point recalcule la portion divisée. Les géométries et analyses des autres portions sont conservées. La tolérance du planificateur est fixée à 150 m. Le premier point est accroché au graphe OSM local, avec OSRM Nearest en secours ; les nouvelles extrémités sont repositionnées sur les positions réellement accrochées sans modifier une portion antérieure déjà calculée. Les clics rapprochés sont regroupés pendant 250 ms ; les réponses devenues périmées sont ignorées. Le recalcul démarre à la fin du glissement. Les fractions cumulées de longueur déterminent l’insertion sur un parcours sinueux. Les segments et les traces superposés ne capturent plus les clics dans le planificateur. La liste des points est repliée par défaut.

Dans le planificateur, « Sans routage · correction locale » relie directement les prochains points et peut aussi diviser une portion existante en insérant un point manuel. Reprendre le routage conserve ces corrections. Annuler/rétablir garde jusqu’à 60 opérations de géométrie (boutons ou Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z). Les portions manuelles sont enregistrées séparément et survivent au rechargement ; les anciens itinéraires sont découpés sans recalcul intégral. Le nom de l’itinéraire est obligatoire, côté navigateur et serveur.

Pour les géométries sans annotations directes du routage local, l’analyse interroge Overpass le long d’un corridor de 35 m et associe les revêtements explicitement renseignés dans OSM aux portions du parcours (distance maximale 20 m et direction compatible). Une voie sans attribut reste inconnue ; une route parallèle peut rendre cette estimation incertaine. Asphalte, bitume et béton sont continus ; les autres revêtements connus sont en pointillés, quel que soit le mode de construction (routé ou manuel). Une correction manuelle sans revêtement connu reste continue. L’affichage indique les distances, pourcentages et couvertures disponibles. Les données OSM peuvent différer de la version utilisée par le moteur de routage.

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

Le sélecteur de l’itinéraire propose ligne simple, surface, pente et altitude. La couleur de surface et sa légende indiquent le pourcentage de chaque type ; une surface inconnue reste grise. Les pentes sont estimées sur une fenêtre d’environ 150 m à partir du profil de terrain ; elles ne remplacent pas une mesure sur le terrain. Les pointillés représentent exclusivement un revêtement non asphalté renseigné ou un `tracktype` non revêtu, avec bitume et béton continus. Le mode manuel ne change plus le motif de la ligne. Les segments possèdent une légende de technicité en plus de la note, du revêtement et du single track.

En consultation, les bornes kilométriques suivent le tracé et s’adaptent au zoom : 1 km dès le niveau 14, 5 km aux niveaux 12–13, 10 km aux niveaux 10–11, aucune aux niveaux inférieurs. Seules les bornes dans l’emprise visible sont dessinées, avec espacement minimal en pixels et nombre limité pour éviter l’encombrement. Les boutons de passage et les marqueurs d’édition réapparaissent en édition. Cliquer un marqueur ouvre le choix « Sans routage depuis le point précédent », également accessible dans la liste repliable. Ce choix ne modifie que la portion entrante ; il est annulable, enregistré et conservé après déplacement du point.

## Surfaces, accès et routage local (6.4)

Les étapes courtes du planificateur et du dessin de segments utilisent en priorité un graphe OSM calculé sur le serveur. Les clics sont projetés sur les arêtes, y compris entre deux nœuds très éloignés ou sur deux points proches. Une rue découpée en plusieurs objets au changement de revêtement reste reliée par ses identifiants de nœuds communs ; deux chemins simplement proches ou croisés sans nœud commun ne sont jamais fusionnés. Le graphe est dirigé : `oneway`, sens inversé, ronds-points et exceptions vélo (`oneway:bicycle`, voies opposées) sont pris en compte. Les restrictions de virage des relations OSM ne sont pas gérées par ce petit moteur.

Le calcul local conserve les voies portant une restriction d’accès au lieu de les retirer. Les restrictions explicites applicables au vélo et les accès conditionnels sont signalés par un petit « ! » sur la portion concernée, en édition et en consultation. Un accès vélo explicite prime sur une interdiction générale ; une absence de tag d’accès n’est pas une interdiction. Le survol précise le tag et la condition, sans interpréter les horaires. Ces annotations sont sauvegardées dans le JSONB de l’itinéraire ; PostGIS reste synchronisé avec le tracé. Les conditions sur place restent à vérifier.

Le calcul est borné aux étapes dont la longueur directe est au plus 15 km et à une emprise maximale de 0,012 degré carré (environ 95 km² à Spa), avec cache OSM dix minutes. Une zone plus large est essayée si aucun raccord n’est trouvé. Si l’emprise est trop grande ou Overpass est indisponible, le moteur OSRM vélo public sert de secours, avec un avertissement : il peut encore éviter les accès privés/interdits. Les étapes du secours annoncées à pied ou avec vélo poussé sont refusées, notamment pour ne pas accepter silencieusement un contre-sens à pied. Ajouter des passages plus rapprochés permet de rester dans le calcul local. Un échec de connexion ou de sens dans le graphe local n’est pas contourné automatiquement par le secours.

Les revêtements du calcul local sont utilisés immédiatement, sans deuxième requête de surface. Pour une géométrie existante ou manuelle, le corridor Overpass récupère explicitement tags et géométrie ; une réponse incomplète est signalée. Les variantes usuelles de `surface` sont classées et `tracktype=grade2…grade5` est un indice de chemin non revêtu. Un chemin sans information fiable reste « Inconnu ». Asphalte, bitume et béton restent continus ; les autres revêtements renseignés sont pointillés, indépendamment du mode manuel ou routé. Pour mettre à jour un ancien itinéraire, utiliser **Actualiser les revêtements OSM**, puis modifier/enregistrer si l’on est propriétaire. Cette action ne demande aucune altitude. Les données altimétriques déjà enregistrées sont conservées.

Dans le planificateur, **Masquer / Afficher la bibliothèque** replie le panneau gauche, redimensionne la carte et conserve le dessin et l’historique. Le bouton reste accessible au-dessus de la carte, sur desktop et mobile.

## Diagnostic réel de la rue du Jeu de Paume (6.4.1)

Le test a été effectué avec les données OSM réelles récupérées le 23 octobre 2026, entre le Boulevard des Anglais (`50.4918849, 5.8693681`) et l’Avenue Léopold II (`50.4976469, 5.870257`). Les sept objets OSM de la rue sont raccordés, notamment au nœud `3065855837` lors du changement asphalte/gravier. Le trajet suivant uniquement la rue mesure environ 823 m, dont 390 m de gravier. Le calcul purement fondé sur la distance favorisait un raccourci voisin de 747 m sur des pistes `tracktype=grade4`. Le profil applique désormais un surcoût modéré aux pistes grade4/grade5 (facteurs 1,25 et 1,5), sans les interdire : le trajet de 823 m suit la rue dans les deux sens, sans point de passage intermédiaire. Un passage supplémentaire sur la portion gravel (`50.4959481, 5.8711952`) reste possible. Le moteur public interrogé lors du diagnostic a choisi un détour de 1 226 m. Les restrictions `access=destination` figurent sur une partie de la rue ; une autre portion possède une autorisation vélo explicite.

Les appels Overpass ont expiré dans l’environnement de diagnostic, alors que la source OSM directe répondait. Pour les calculs locaux, un secours de **données** OSM (`api.openstreetmap.org/api/0.6/map.json`) permet désormais de conserver le graphe, ses surfaces et ses annotations d’accès, avant tout recours au moteur public. Il est limité aux petites emprises de 0,001 degré carré maximum (environ 8 km² à Spa), dédupliqué, espacé d’au moins une seconde et mis en cache une heure pour limiter les téléchargements. Une panne déclenche une pause d’une minute du fournisseur concerné. Une réponse 400 pour une zone trop dense ne pénalise que cette zone, pas toutes les autres demandes. L’accrochage initial se limite à environ 400 m de marge : l’ancienne marge de 1 200 m dépassait la limite de 50 000 nœuds de l’API directe à Spa, puis désactivait à tort le secours pour les requêtes plus petites. Les téléchargements sont bornés à 20 Mo et seules les voies routables avec tous leurs nœuds sont conservées ; aucune connexion n’est inventée. Pour une exploitation intensive, prévoir une source de données dédiée plutôt que multiplier les appels aux services publics.

Dans ces petites emprises, Overpass dispose de huit secondes avant la tentative de secours OSM direct (dix secondes). Les emprises plus grandes restent sur Overpass et conservent les limites du moteur public décrites en 6.4. Cela ne prouve pas quel moteur a été utilisé sur le VPS : sa session privée et sa version déployée ne sont pas accessibles depuis le diagnostic.

```sh
sudo docker compose exec app node server/check-routing.js
```

Cette commande vérifie l’accrochage initial puis effectue trois calculs en lecture seule : les deux sens entre les extrémités, puis la rue entière avec un passage gravel. Elle affiche la version de Sillage, la source de données, le moteur, les distances, les surfaces et les avertissements éventuels. Elle ne consulte ni les comptes ni la base. Elle sort avec un code non nul si un calcul échoue ou utilise le secours public. L’enchaînement accrochage initial puis routage a aussi été vérifié en ligne avec ces deux fournisseurs : la source OSM directe a rendu 823 m dans les deux sens, avec 390 m de gravier. Les données minimales réelles utilisées dans les tests sont dans `test/fixtures/spa-jeu-de-paume.json` : © OpenStreetMap contributors, sous ODbL, avec source et licence incluses.

## Planificateur et profil plus fluides (6.5)

Le planificateur et les segments utilisent le même moteur. Les réseaux OSM préparés (graphe dirigé et index spatial des arêtes) sont désormais réutilisés au lieu d’être reconstruits pour chaque étape. Seules les arêtes contenant les nouveaux points sont divisées dans une surcouche propre à la requête ; le graphe partagé ne reçoit jamais de points virtuels. Le cache est borné à quatre réseaux et 250 000 arêtes ; les résultats récents sont également bornés. Les règles de sens unique, les restrictions annotées et le coût des pistes restent identiques.

Avant de télécharger un nouveau cadre de 650 m de marge, le moteur essaie une zone déjà disponible avec au moins la marge d’accrochage nécessaire. Une recherche voisine peut aussi attendre le téléchargement d’accrochage initial en cours, si sa couverture suffit. Si le cache ne fournit pas de raccord ou propose un grand détour, le calcul reprend avec une zone plus large. L’expiration des données reste respectée. Les échecs Overpass sont espacés progressivement (1, 2, 4, 8 puis 15 minutes), sans prolonger la pause à chaque utilisation de la source de secours ; un succès réinitialise ce délai. Les limites et le débit des fournisseurs sont conservés.

Le regroupement des clics passe de 250 à 100 ms et l’analyse différée de 900 à 300 ms. L’altitude reste indépendante du routage : une réponse d’altitude ne redessine plus la ligne simple ni ne relance le routage. Le rendu des couleurs est mis en cache, les calques inchangés sont conservés et la liste de passages n’est construite qu’à son ouverture. Les anciennes portions conservent leur géométrie et leurs analyses.

Mesures locales du 23 octobre 2026 (Node 24, 80 couples de points distincts, hors HTTP et téléchargement) : sur le réseau réel de Spa utilisé pendant le diagnostic, médiane 4,86 → 0,69 ms et 95e percentile 10,32 → 1,27 ms. Sur une grille de 14 000 nœuds, médiane 86,18 → 0,70 ms, après préparation initiale. Ce sont des mesures CPU dans l’environnement de développement, pas une promesse de délai sur le VPS. La séquence accrochage + deux sens + passage gravel utilise deux téléchargements de zone au lieu de trois dans la comparaison simulée. Le diagnostic en ligne conserve 823 m dans chaque cas ; la variante avec passage a réutilisé la zone chargée au lieu d’en télécharger une autre.

```sh
npm run bench:routing
# Option : instantané JSON OSM local, contenant le réseau de Spa
node test/benchmark-routing.js /chemin/vers/spa-map.json
```

Ces commandes se lancent dans le checkout de développement ; les tests et benchmarks ne sont pas copiés dans l’image Docker de production. Le premier calcul d’une nouvelle zone dépend toujours des services OSM et peut nécessiter leur délai de secours.

Le profil sous la carte adopte la largeur réelle de son conteneur pour préserver la taille de la police, avec redimensionnement sans perdre le curseur. Ses graduations d’altitude sont des multiples réguliers arrondis (par exemple 100, 200, 300 m), adaptés à l’amplitude ; elles ne sont plus les seuls minima/maxima exacts. Des lignes de grille, des repères de distance et un léger dégradé lié à l’altitude facilitent la lecture. « Points haut et bas » affiche facultativement les extrema lissés, sans modifier les données enregistrées. Les lacunes d’altitude restent visibles et les miniatures utilisent le même rendu.

La palette de pente est divergente : bleu foncé pour les fortes descentes, bleu pâle puis blanc autour de zéro (±0,5 %), rose puis rouge vif pour les fortes montées. La légende indique explicitement « Descente », « Plat » et « Montée » avec les signes. Un liseré neutre maintient les portions blanches lisibles sur le fond de carte. Les valeurs restent issues du profil estimé et lissé existant ; aucune nouvelle source d’altitude ni migration de base n’est introduite.

Validation : tests fonctionnels de cache, concurrence, expiration, arêtes longues, graphe dirigé comparé à un Dijkstra indépendant, rendu réutilisé, axes, palettes et redimensionnement. Vérification Chromium réelle sur desktop et mobile avec données de démonstration et tuiles simulées : police non étirée, absence de débordement horizontal, options d’extrema et curseur synchronisé avec la carte. Le diagnostic de routage utilise les services OSM réels ; le VPS reste à mettre à jour séparément.


## Affichage et bibliothèque des itinéraires (6.7.0)

Le relief s’active sans slider, à 0 % de transparence (opacité 1), avec composition multiply conservant le fond. Le plaisir retrouve cinq couleurs du rouge au vert. Les single tracks sont indiqués par des pointillés dans tous les modes de couleur ; leur ancien filtre et leur palette dédiée sont retirés de l’interface. Les cases Mes segments / Segments publiques pilotent seules l’affichage des segments, sans interrupteur général redondant. Le survol montre les attributs, échappés avant affichage ; un clic pendant le dessin ajoute un point au lieu de sélectionner le segment. Le remplissage des profils principal et miniature est plus transparent.

La bibliothèque du planificateur propose une recherche sans distinction d’accents ou de casse et des bornes min/max de distance (km) et de dénivelé positif (m). Les valeurs D+ proviennent du profil enregistré, avec le même lissage que le graphe, et restent en cache pendant la consultation. Si un filtre D+ est utilisé, les itinéraires sans altitude sont exclus. Le filtre géographique porte sur les extrémités effectives de la trace, avec départ, arrivée, l’un ou l’autre, ou les deux dans l’emprise visible ; un itinéraire qui traverse seulement la carte ne suffit pas. Ces filtres changent la bibliothèque sans modifier le tracé en cours. Le panneau se replie depuis la bibliothèque ou la barre de carte.


## Éditeur, export du compte et curseurs (6.8.0)

Le formulaire nom / notes / visibilité / enregistrement est placé au début de l’éditeur d’itinéraire. Le bouton « Créer un nouvel itinéraire » démarre un brouillon vierge sans supprimer un parcours enregistré ; cette opération reste annulable, y compris lorsque seul le nom ou les notes ont été saisis. Un bouton à icône de panneau et chevron remplace les deux commandes textuelles de repli. Il reste au bord de la carte pour replier ou déplier la bibliothèque, avec nom accessible et état aria-expanded ; il est masqué en plein écran où la bibliothèque est extérieure à la carte.

Les filtres de distance et D+ prennent la forme de curseurs à deux poignées, accessibles à la souris, au tactile et au clavier. Les bornes s’adaptent aux itinéraires de la bibliothèque, les poignées ne se croisent pas, la plage choisie est lisible et la réinitialisation remet tous les parcours, y compris ceux sans altitude. Ces filtres ne modifient pas le brouillon ni ses analyses.

Le bouton Exporter quitte le bandeau : Mon compte → Mes données → « Exporter toutes ses données » télécharge un JSON (`format: sillage-account-export`, `version: 1`). Il comprend le profil du compte, les sorties avec coordonnées et GPX originaux disponibles, les segments dans une FeatureCollection GeoJSON, les itinéraires avec toutes leurs portions et analyses, les configurations WMS et l’identifiant de l’athlète Strava. Les coordonnées des sorties et itinéraires restent latitude/longitude ; celles des géométries GeoJSON sont longitude/latitude. Les lectures utilisent un instantané PostgreSQL cohérent, en lecture seule, limité à l’utilisateur connecté, sans exporter les données publiques d’autres membres ni les éléments d’authentification. L’export ne contacte pas Strava ou un service cartographique. Le fichier décrit les données conservées ; il ne modifie rien et ne propose pas d’import automatique.


## Carte directe et dénivelé filtré (6.9.0)

L’ombrage et les points haut/bas du profil sont activés au chargement ; les cases restent disponibles pour les désactiver pendant la session. Le bandeau au-dessus de la carte est supprimé. Recentrer et plein écran sont des pictogrammes dans la barre du zoom, avec intitulés accessibles et boutons utilisables au clavier. Repli de bibliothèque et dessin utilisent la même barre ; le contexte de sortie est affiché dans la bibliothèque. La carte occupe directement l’espace sous la navigation, y compris en plein écran.

La pente utilise une fenêtre de 300 m sur le profil déjà lissé. Elle conserve cette largeur près des extrémités quand les données le permettent, et ne franchit jamais une lacune d’altitude. Le dénivelé utilise un suivi des extrema avec seuil de retournement de 5 m : de petites baisses pendant une montée ne deviennent plus des descentes et remontées répétées. Les grandes montées et descentes restent mesurées ; le point de fin conserve la différence nette d’altitude. Le calcul est linéaire et partagé entre analyses serveur, profil, statistiques et filtres de bibliothèque. Les itinéraires enregistrés profitent du nouveau calcul à partir des profils conservés, sans téléchargement ni migration.

La source reste Copernicus GLO-90 via Open-Meteo. Ce calcul filtre le bruit sans appliquer de coefficient de réduction aux totaux. Il peut restituer davantage d’une véritable montée que l’ancien compteur à ancre mobile ; il ne garantit pas une baisse de tous les totaux ni une égalité avec Strava ou Garmin, qui peuvent employer des altitudes corrigées ou barométriques et d’autres filtres. Une comparaison quantitative exige les mêmes tracés et des profils d’altitude connus.


## Dessin commun et correction des points (6.10.0)

Démarrer, copier ou modifier un itinéraire replie la bibliothèque pour libérer la carte ; son bouton permet de la rouvrir. Le détail des surfaces est replié à l’ouverture. La synthèse affiche le pourcentage non asphalté, calculé depuis les portions OSM connues, également dans l’aperçu ; un signe ≥ indique que des surfaces restent inconnues. Les profils anciens sans géométrie de surfaces réutilisent les longueurs par type déjà enregistrées.

En routage de segment comme d’itinéraire, chaque clic prolonge le dessin : le troisième point devient l’arrivée, le deuxième devient un passage. Le même modèle de portions conserve les parties précédentes et recalcule seulement les jonctions touchées. Un clic sur un point fait apparaître un menu ancré dans la carte et un anneau de sélection. Le menu permet de supprimer le point (départ, passage ou arrivée), ou de relier directement depuis le précédent. Cette dernière option est désactivée pour le départ. Fermer ou supprimer dans le menu ne déclenche pas un clic de tracé sur la carte.

Les segments enregistrent leurs portions routées / manuelles dans leur JSON existant, jusqu’à 200 points ; les segments anciens restent éditables. La provenance Strava et les permissions restent attachées à l’enregistrement. Annuler / rétablir sont des pictogrammes dans les outils de carte et fonctionnent aussi en plein écran. Les aides générales sont disponibles derrière l’icône ?. Les informations de calcul et les erreurs restent visibles dans l’éditeur.

## Identité visuelle gravel (6.11.0)

L’interface utilise une palette olive, toile écrue, sable et argile, avec Barlow pour les contrôles et Barlow Condensed pour les titres. Le bandeau, les bibliothèques, les éditeurs, les outils et légendes de carte, le profil d’altitude et les pages de compte partagent cette identité. La connexion présente un dessin topographique décoratif en SVG intégré, sans téléchargement d’image ou de carte. Les polices Google Fonts utilisent `display=swap` avec des polices système de secours. Les couleurs cartographiques de plaisir (rouge à vert), surface, pente et altitude restent dédiées aux données.

Les panneaux conservent leur défilement indépendant sur ordinateur et les formulaires passent sous la carte sur mobile. Les boutons à pictogramme gardent leurs noms accessibles et le clavier reste utilisable. Mise à jour habituelle, sans modification de base ni nouvelle configuration.

## Atlas de terrain — identité Sillage (6.12.0)

La signature et le signe à double trace, la planche de relief originale, les repères des aperçus et le profil annoté forment une identité commune à la carte, aux éditeurs et aux pages de compte. Hanken Grotesk, Bricolage Grotesque et IBM Plex Mono sont désormais hébergées avec l’application, sous SIL Open Font License ; les pages ne contactent plus Google Fonts. La feuille de styles a été réorganisée par composants et états. Voir [la charte Sillage](design/IDENTITY.md) pour les règles, couleurs et sources des actifs. Aucun changement de calcul, de visibilité ou de base de données.

## Légendes mobiles et création dans la carte (6.12.1)

Sur téléphone, le panneau « Carte et légendes » est ancré en haut à droite, face aux outils. Sa hauteur tient compte des crédits cartographiques réels pour garder les commandes visibles avec les différents fonds et WMS. Sur ordinateur, la légende reste en bas à gauche, au-dessus des crédits. Les dimensions sont mises à jour au redimensionnement et lors des changements de texte et d’outils.

La commande de nouveau segment ou nouvel itinéraire quitte l’éditeur et rejoint les outils de carte, juste après Annuler/Rétablir. Son nom accessible et son infobulle suivent l’onglet. La création d’un nouvel itinéraire conserve l’historique existant et reste annulable ; elle ne supprime aucun itinéraire enregistré.

## Tracé unique, défilement mobile et surfaces (6.13.0)

Le dessin des segments suit le même modèle incrémental que les itinéraires : routage OSM à 150 m par défaut, points successifs, corrections locales sans routage, déplacement et annuler/rétablir. Les trois boutons de mode sont retirés ; les GPX et sorties Strava restent des repères sur la carte. Les segments historiques restent éditables, y compris leurs géométries manuelles, sans routage imposé au chargement. Les règles de confidentialité et de provenance restent appliquées côté serveur.

Sur mobile, le profil déplié laisse le geste vertical défiler vers le formulaire. Le panneau n’intercepte plus le dépassement de défilement ; les événements tactiles du graphe sont passifs et ne forcent pas de capture du pointeur.

Une réponse de routage avec des surfaces inconnues peut désormais être enrichie par une analyse de corridor, sans déplacer les points. Les revêtements déjà connus sont conservés sur leurs intervalles ; les données d’altitude enregistrées sont conservées. Une analyse OSM manquante ou inconnue dispose d’une seule nouvelle tentative automatique, après 65 secondes, pour respecter les délais de reprise des fournisseurs. Les réponses arrivées pour une ancienne géométrie sont ignorées. Les secteurs réellement non renseignés dans OSM restent inconnus.

Les réponses de surface inconnues sont mises en cache une minute, au lieu d’une heure. Une actualisation explicite réinterroge le fournisseur même si la précédente réponse inconnue ne contenait pas d’erreur. Le cache long des surfaces complètes et le cache des altitudes restent conservés. La suggestion de revêtement des nouveaux segments utilise les analyses par portion et respecte les corrections manuelles du formulaire ; l’enregistrement attend la première analyse en cours et vérifie que la géométrie n’a pas changé.


## Secteurs gravel et accès restreints (6.14.0)

« Secteur gravel » remplace portion/segment dans l’interface, dans l’onglet Sorties & secteurs. Les noms personnels existants sont conservés ; un nouveau secteur sans nom reçoit un nom automatique. La marque associe un vélo gravel à un chemin sinueux, avec des SVG couleur et monochrome. Les pictogrammes secteur et itinéraire partagent deux bornes ouvertes et un trait distinct. Voir la charte et les fichiers SVG dans `dist`.

Le routage OSM commence par une emprise plus serrée et ne l’élargit qu’en cas de déconnexion ou de détour important. Un chemin local déjà calculé est conservé si l’élargissement échoue. Quand Overpass est indisponible, une emprise de routage peut être assemblée depuis au maximum neuf petites zones OSM, téléchargées en série, espacées d’une seconde et mises en cache une heure. L’assemblage conserve les identifiants des nœuds, les restrictions et les sens vélo ; aucun raccord artificiel n’est créé. Les cases valides sans route sont acceptées.

Les accès restreints restent routables avec un repère « ! », désormais aussi pendant le dessin d’un secteur et dans sa légende. Les sens uniques vélo restent appliqués, y compris si le réseau est déconnecté. Les grandes étapes dépassant les limites locales ou les pannes des deux sources peuvent encore utiliser le moteur vélo de secours, avec un message persistant dans l’éditeur : ce fournisseur peut éviter les accès restreints. Ajouter un point de passage rapproche alors les calculs locaux. La limite locale de 15 km et le budget de neuf zones restent bornés ; il ne s’agit pas d’un téléchargement régional.

Les tests couvrent une longue liaison synthétique comprenant un chemin privé, la conservation d’un résultat local en cas de panne, les sens uniques, le nombre de zones, le cache et les repères dans les deux éditeurs. Cette régression reproduit le motif « petite étape réussie / grande étape en détour » ; elle ne remplace pas la vérification terrain du tracé exact de la Fagne wallonne après déploiement. Mise à jour habituelle, sans migration ni nouveau secret.


## Logo gravel (6.14.1)

Roues agrandies de 14 % et deux bornes ouvertes aux changements de direction du cadre. Les versions couleur, monochrome, le bandeau et les icônes utilisent la même géométrie. Les centres des bornes sont transparents, pour les fonds clairs et sombres. Les actifs `v3` remplacent les références `v2` ; les anciens fichiers restent servis pour le cache. Mise à jour habituelle sans migration ni modification du routage.


## Profil de relief des secteurs (6.15.0)

Le panneau repliable « Le relief » sous la carte accompagne aussi les secteurs, pendant le dessin et lors de l’ouverture d’un secteur personnel ou public. Il reprend le graphe coloré, les extrema, les graduations, le dénivelé filtré et le curseur lié à un repère sur la carte des itinéraires. Le défilement mobile vers le formulaire reste celui du panneau existant.

Les altitudes sont demandées par lots, seulement pour les étapes manquantes ; les profils existants sont réutilisés sans requête et sans nouveau routage. Les nouvelles analyses d’altitude sont enregistrées avec les étapes du secteur dans son JSONB, avec la même validation que les itinéraires. Les anciens secteurs peuvent recevoir un profil à l’ouverture ; il est conservé au prochain enregistrement par leur propriétaire. La consultation d’un secteur public n’écrit rien dans le compte de son auteur. Les réponses devenues obsolètes sont ignorées. Si la source d’altitude échoue, une commande « Compléter le profil d’altitude » permet une nouvelle tentative explicite.

Aucune migration ni nouvelle clé. Mettre à jour normalement puis recharger le navigateur pour les modules `v=6.15.0`. Vérifier un secteur en création, un secteur enregistré avec profil et un ancien secteur, personnel et public : replier le panneau, déplacer le curseur, enregistrer puis rouvrir. Les tests couvrent la conservation des profils à l’édition, les altitudes invalides, l’absence de recalcul d’un profil stocké, le curseur et les réponses obsolètes.


## Carte et bibliothèque uniques (6.16.0)

L’application conserve une seule entrée « Itinéraires ». Les outils de carte proposent deux commandes permanentes, « Créer un nouvel itinéraire » et « Créer un secteur », à côté d’Annuler/Rétablir. Le même panneau de tracé montre le formulaire approprié, avec les attributs et la note du secteur ou le nom obligatoire et les notes de l’itinéraire. Les outils de dessin, le profil de relief et les fonds de carte restent communs. Créer un nouvel itinéraire dans le planificateur reste annulable. Les deux commandes restent accessibles pendant la consultation et la création. La barre d’outils peut défiler sur les petits écrans.

La bibliothèque possède un choix Itinéraire / Secteur / Sortie, un champ de recherche commun et les filtres distance, dénivelé connu et départ/arrivée dans la zone visible. Les visibilités personnelles/publiques restent disponibles pour les secteurs et itinéraires ; les sorties GPX et Strava restent personnelles. Changer de catégorie ou de recherche ne change pas le tracé en cours. Une sortie chargée s’affiche en consultation et n’ouvre plus automatiquement la création d’un secteur. Elle peut rester comme repère pendant un nouveau dessin, y compris un itinéraire ; son affichage reste désactivable dans la légende. Les règles de provenance et de confidentialité Strava restent inchangées.

Les sorties importées utilisent des métadonnées légères de départ/arrivée issues de PostGIS pour le filtre de zone, sans charger chaque trace entière. La recherche dans les activités Strava utilise les activités déjà chargées et leurs aperçus ; les sorties plus anciennes restent accessibles avec la pagination existante. Les éléments sans profil enregistré sont exclus d’un filtre D+ actif. Aucune nouvelle donnée d’altitude n’est demandée pour faire une recherche. Les chargements devenus obsolètes ne remplacent pas un secteur ouvert ensuite.

Mise à jour habituelle, sans migration ni nouvelle clé. Recharger le navigateur pour les modules `v=6.16.0`. Vérifier les trois catégories, leurs filtres et aperçus, la création de chaque type, une sortie conservée comme repère, les profils sous la carte et les deux commandes de création sur mobile et en plein écran.


## En-tête compact et atlas gravel (6.17.0)

L’onglet unique et le grand bandeau d’introduction de la bibliothèque sont retirés. L’en-tête reprend des lignes de niveau discrètes et un dessin vectoriel de chemins reliés par des bornes ouvertes. Le décor de connexion est également redessiné avec ce langage, en remplacement de la ligne sinueuse. Les libellés visibles utilisent « atlas » : signature, recherche, connexion et pied de page. Les nouveaux actifs `sillage-header-v1.svg` et `sillage-terrain-v2.svg` sont versionnés ; l’ancien reste disponible pour les caches.

Le bouton de secteur possède le même signe + que celui d’itinéraire. Les commandes de zoom et les boutons utilisent une même dimension, avec centrage par flex et sans marge verticale du pictogramme SVG. La couleur verte et l’état accessible `aria-pressed` des commandes de création ne s’activent que pour le type d’un nouveau tracé en cours. Ils restent neutres lors de la consultation, après enregistrement et pendant l’édition d’un élément existant.

La bibliothèque utilise par défaut les éléments personnels et revient à ce choix après réinitialisation des filtres. Le libellé est « Mes secteurs » ou « Mes itinéraires » selon la catégorie. Les autres éléments publics restent accessibles par un choix explicite ; la recherche reste indépendante des couches visibles sur la carte. « Zone de recherche » propose Partout, Départ, Arrivée ou Départ et arrivée ; l’option Départ ou arrivée est supprimée de l’interface.

Mettre à jour normalement puis recharger les modules `v=6.17.0`. Aucune migration ni nouvelle variable. Vérifier l’en-tête compact sur téléphone et ordinateur, les tailles des outils, les états de création/consultation et le retour aux éléments personnels après réinitialisation.


## Routage explicite, file de calcul et mobile (6.18.0)

Sur mobile, bibliothèque repliée, la carte occupe la hauteur du viewport dynamique moins l’en-tête et le profil réellement visibles, avec un minimum de 240 px pour les petits écrans en paysage. Le défilement vertical du profil et du formulaire reste disponible ; aucun bloc vide n’est réservé sous une carte de 68 svh.

Les nouveaux calculs de l’interface et les demandes `allowRestricted: true` utilisent la politique OSM explicite. Une interdiction vélo inconditionnelle (`bicycle=no`, `dismount`, `use_sidepath`, avec priorité des tags directionnels) est exclue, même avec un point dessus. Les exceptions vélo explicites sur un accès général restent respectées. Les autres accès restreints sont exclus du transit, sauf si l’un des points de l’étape est placé sur ce chemin : son réseau restreint connecté est alors utilisable, toujours en respectant les sens uniques. Le rattachement se fait par les identifiants des nœuds OSM, sans raccord artificiel.

En 6.18, la dérogation d’accès exigeait une proximité de 5 m au chemin. Depuis 6.22, les points s’accrochent au chemin sélectionné dans le même rayon de 150 m, libre ou restreint ; seule sa composante restreinte connectée est autorisée. À un carrefour partagé, le chemin libre reste préféré. Les interdictions vélo ne servent jamais de pont entre deux réseaux restreints. Le cache des résultats distingue les politiques d’accès. Les repères « ! » restent présents sur les accès restreints effectivement empruntés.

L’interface ne bascule plus vers un fournisseur dont les accès ne peuvent pas être vérifiés lorsque la source OSM locale est indisponible. Les points sont conservés et le routage peut être relancé. Les limites d’emprise et de 15 km par calcul local restent bornées : ajouter un point intermédiaire si nécessaire. Les géométries déjà enregistrées restent historiques ; la nouvelle règle s’applique aux nouveaux calculs et aux étapes recalculées.

Le calcul utilise une file unique : les points ajoutés pendant une requête sont traités ensuite, à partir de l’extrémité réellement accrochée. Un ajout conserve la requête valide en cours ; déplacer ou supprimer son étape abandonne la requête obsolète côté navigateur. Une étape géométriquement impossible ne bloque plus les suivantes. Une panne ou un quota du fournisseur met la file en pause, sans rafale ni perte des points ; Réessayer reprend les seules étapes manquantes. Les analyses des étapes terminées peuvent progresser pendant la suite du routage.

Les marqueurs gardent leur DOM si les points n’ont pas bougé, pour que le premier clic et les mises à jour d’analyse n’empêchent pas le double-clic. Le départ, l’arrivée et les passages disposent du même menu de suppression, du double-clic, du clic droit et de la touche Suppr. Les extrémités sont aussi retirables dans la liste des points, même si leurs marqueurs se superposent. Leur suppression reste annulable et ne déclenche pas un clic de dessin sur la carte.

### Mesures de performance

Les longueurs cumulées de chaque étape, les synthèses de surfaces et les propriétés OSM par chemin sont réutilisées. Les caches reposent sur les géométries et analyses immuables et sont invalidés lors d’un changement de tracé ou d’analyse. Mesures locales Node 24, hors affichage, HTTP et téléchargement :

| Opération sur 60 000 points | Médiane avant | Médiane après |
| --- | ---: | ---: |
| Mise à jour du modèle de profil, géométrie identique | 8,44 ms | 2,12 ms |
| Synthèse répétée du relief et des surfaces | 4,52 ms | 0,013 ms |

Ces chiffres ne mesurent pas le délai de réponse des fournisseurs ni le temps total de tracé dans le navigateur. Les commandes `npm run bench:routing -- --profile` et `npm run bench:routing -- --summary` reproduisent les deux cas sur un checkout avec Node. Le benchmark du moteur seul garde un mode historique d’accès pour comparer le CPU, distinct de la politique de production.

Mise à jour habituelle, sans migration ni nouveau secret ; recharger les scripts `v=6.18.0`. Vérifier sur téléphone la carte bibliothèque masquée puis le défilement jusqu’au formulaire avec profil ouvert. Tester plusieurs clics avant la fin du premier calcul, un déplacement pendant une requête, la suppression des deux extrémités et les restrictions sur un trajet connu. Le rendu réel et les services externes restent à vérifier après déploiement.

## 6.18.1 — Calcul des étapes longues

La règle d’accès de 6.18 avait rendu le planificateur dépendant d’un téléchargement rectangulaire de toutes les routes entre deux points, avec une limite locale de 15 km. Sur une diagonale longue, la zone devenait trop grande ; les téléchargements successifs et les délais d’Overpass pouvaient rendre le calcul très lent.

Au-delà de 2 km entre les points, le routeur vélo fournit maintenant un guide avec les identifiants des nœuds OSM. Une requête ciblée récupère leurs chemins et les alentours des points réellement cliqués. Sillage reconstruit son graphe dirigé sur ces données et recalcule le trajet : le résultat public n’est jamais utilisé sans cette vérification. Les interdictions vélo, sens uniques, exceptions vélo, composantes d’accès restreint et annotations de surface restent identiques au moteur local. Le voisinage de récupération des clics utilise 175 m ; depuis 6.22, l’accrochage effectif utilise le même rayon de 150 m pour les chemins libres et restreints. Le guide ne constitue pas une dérogation.

Cette voie ne dépend pas de l’emprise rectangulaire ni du plafond local de 15 km ; la limite de l’itinéraire reste 500 km. La requête guidée est bornée à 25 000 identifiants de nœuds et une réponse de 20 Mo. Les instantanés partiels ont un cache distinct et ne sont jamais annoncés comme couvrant toute une emprise. Les calculs identiques sont dédupliqués et gardés dix minutes. La vérification OSM d’un utilisateur ne retient plus la file du routeur public des autres utilisateurs ; sa cadence reste limitée à une requête par seconde. Une source Overpass de secours est essayée avec des délais de six secondes par source et une pause après échec. Les données guidées ont un budget mémoire de 16 Mo, les résultats vérifiés un autre de 16 Mo.

Les calculs courts et les réseaux déjà en cache conservent le moteur local. Un trajet valide est rendu sans télécharger deux emprises plus larges pour tenter de raccourcir un détour légal. Un échec de téléchargement arrête aussi les répétitions sur des zones plus grandes. Le délai Overpass des téléchargements locaux de routage passe de 25 à 6 secondes. Le secours OSM direct borné est conservé lorsque le guide est indisponible. Si les accès ne peuvent pas être vérifiés, le calcul échoue en conservant les points.

Tests de régression : diagonale de 25 km, deux requêtes ciblées au lieu d’un rectangle, cache, déduplication, expiration, source de secours, absence de téléchargement après un résultat valide, accès privés, interdictions vélo, sens uniques et disponibilité du routeur pendant une autre vérification. Ces tests utilisent des réponses réseau simulées ; ils ne mesurent pas les délais réels des fournisseurs depuis le VPS.

Mise à jour habituelle, sans migration, nouveau secret ni changement des scripts du navigateur. La commande de version doit afficher `6.18.1`.

## 6.19.0 — Emporter un itinéraire sur Garmin ou COROS

Un bouton **Garmin / COROS** est disponible dans la bibliothèque et sur le panneau d’un itinéraire enregistré. La fiche propose le partage natif du fichier GPX si le navigateur le permet, le téléchargement et les étapes d’import pour les deux applications. Elle reste accessible avec la bibliothèque repliée et dans la carte en plein écran. Les noms, les altitudes disponibles et le type vélo restent ceux de l’export GPX existant.

Ce transfert ne nécessite aucune clé et ne change pas la visibilité des itinéraires. Il ne constitue pas une synchronisation automatique : l’utilisateur enregistre le fichier dans Garmin Connect ou COROS puis synchronise son appareil compatible. La connexion des comptes et l’envoi direct demanderont des accès partenaires approuvés. Le [guide GPS](deploy/GPS.md) réunit les sources officielles, les démarches à effectuer et le dossier à compléter pour préparer ces intégrations.

Le GPX à partager est chargé lors de l’ouverture de la fiche pour préserver l’activation du clic mobile. Fermeture et changement de parcours annulent le chargement précédent ; une réponse tardive est ignorée. Annulation du menu natif, refus de partage, session expirée et format inattendu gardent un état explicite, sans annoncer un envoi au GPS ni forcer un téléchargement. Les scripts sont actualisés en `v=6.19.0` ; aucune migration ni variable supplémentaire.

## 6.20.0 — Réseau OSM stocké pour le routage

Les étapes couvertes peuvent maintenant être calculées depuis le PostgreSQL/PostGIS existant, sans OSRM ni Overpass à chaque clic. Le moteur conserve les identifiants de nœuds, les accès, les sens uniques et les revêtements OSM. Le service d’import `routing-import`, lancé volontairement, prépare l’extrait national par lots et publie sa révision de manière atomique. L’ancien réseau reste actif pendant son remplacement. Une fenêtre spatiale bornée et des caches limités évitent de charger le pays entier dans le processus applicatif ; l’outil d’import est plafonné à 2 Go et un CPU pour le VPS de 4 Go.

**Il faut effectuer l’import initial, pas seulement reconstruire l’application.** Le [guide du routage local](deploy/ROUTING.md) donne les commandes, le contrôle `--require-local`, les mesures du diagnostic, les journaux de requête, les mises à jour et les limites de validation. La Belgique est proposée par défaut. Sans import ou en dehors des données installées, le secours public reste disponible ; ses délais ne sont pas garantis. Les grandes étapes dépassant les bornes locales peuvent encore utiliser un guide public.

La migration ajoute uniquement deux tables et leurs index au PostGIS existant. Aucun changement d’image PostgreSQL, de volume de données utilisateur ni de secret. Les scripts du navigateur restent identiques à 6.19.0. Les tests utilisent un adaptateur SQL en mémoire ; les mesures réelles nécessitent le diagnostic sur le VPS après import.

## 6.20.1 — Import adapté à la mémoire du VPS

Supprimer l’étape `tags-filter` qui gardait en mémoire les références des chemins et remplacer l’index natif en mémoire par un index `sparse_file_array` sur disque. Le flux OPL complet est lu progressivement et seuls les chemins routables sont enregistrés, en conservant leurs véritables identifiants et coordonnées. Le téléchargement précédent est réutilisé ; les anciens fichiers partiels et index temporaires sont nettoyés sous le verrou de préparation.

Le lecteur affiche le signal d’arrêt et identifie un OOM uniquement si le compteur mémoire du conteneur le confirme. Le tas Node est plafonné à 384 Mo et Osmium utilise un worker. Le journal émet un message périodique pendant la construction de l’index. La construction de l’image exécute un contrôle natif du lecteur et du routage sur un petit réseau, avant d’autoriser l’import national. Voir la [procédure de reprise](deploy/ROUTING.md).

## 6.21.0 — Actualisation OSM hebdomadaire

Le script `sudo bash deploy/install-routing-updates.sh` construit l’importeur puis active un minuteur systemd chaque dimanche à 04 h, heure de Belgique. Il ne lance pas d’import à l’installation. Les régions actives en base sont actualisées l’une après l’autre, avec les limites mémoire existantes et conservation de l’ancien réseau en cas d’échec. Aucun code Git n’est récupéré automatiquement et l’application n’est pas redémarrée par cette tâche.

Le journal systemd donne le résultat par région et signale les échecs. Les lancements simultanés sont bloqués, la durée totale est bornée à trois heures et le conteneur de la tâche est arrêté en cas d’interruption. L’horaire tient compte de l’heure d’été/hiver et les lancements manqués lorsque le VPS est arrêté ne sont pas rattrapés en journée. Voir les [commandes d’activation, de contrôle et d’arrêt](deploy/ROUTING.md). L’activation sur le VPS reste nécessaire après publication du code.

## 6.21.1 — Correction de l’installation du minuteur OSM

Corriger le rendu de `WorkingDirectory` : systemd traite ses guillemets englobants comme des caractères du chemin et refuse alors le service avec `path is not absolute`. Le chemin unique est maintenant rendu sans ces guillemets, séparément de la liste `RequiresMountsFor`. Les tests couvrent les chemins standards et les caractères spéciaux ; une vérification native est exécutée lorsque le parseur systemd est utilisable. Après récupération du correctif, relancer `sudo bash deploy/install-routing-updates.sh` pour terminer l’activation et afficher la prochaine exécution. Un échec de validation n’avait installé aucune unité.


## 6.22.0 — Accrochage et lecture de la carte

Le seuil distinct de 5 m des chemins restreints disparaît. Un point choisit le chemin OSM admissible le plus proche dans le rayon de 150 m, avec préférence pour le chemin libre en cas d’égalité. Seule la composante restreinte sélectionnée par un point peut servir au routage ; les raccourcis privés voisins restent exclus. Les interdictions explicites aux vélos et les sens uniques restent appliqués. La circulation locale (`destination`) est utilisable normalement à vélo et n’affiche plus de repère d’accès limité, y compris dans les anciennes annotations enregistrées ; les conditions explicites restent signalées.

La file de calcul projette les nouveaux points et les points déplacés sur OSM avant de demander leur routage. Les projections réussies sont réutilisées, les réponses périmées sont ignorées et une absence de chemin proche empêche le calcul de l’étape concernée. Les étapes déjà calculées gardent leur géométrie ; les corrections manuelles conservent leurs points libres. Plusieurs clics pendant un calcul continuent d’être traités dans l’ordre.

Les secteurs apparaissent sous l’itinéraire avec des bordures colorées translucides, un centre clair et une cible de clic élargie mais invisible. La ligne d’itinéraire passe de 6 à 4 px. Les bordures des secteurs restent perceptibles sur les chemins communs ; leurs attributs restent disponibles au survol. Un cercle de départ et un drapeau d’arrivée identiques servent au dessin et à la consultation, avec les bornes kilométriques et sans les points de passage après enregistrement. Les notes facultatives sont repliées sous le nom et le filtre hiver en double est retiré.

Le fond IGN Belgique est sélectionné par défaut. Un avertissement directement sur la carte propose OpenStreetMap lorsque la vue sort de sa couverture ou lorsque les tuiles ne répondent pas. Le contrôle géographique utilise un contour simplifié indicatif, sans contraindre le routage. Le fond satellite se superpose à OpenStreetMap avec 30 % de transparence par défaut ; son réglage reste accessible dans les options de fond. Les WMS, CyclOSM et l’ombrage restent disponibles.

La barre d’outils garde un défilement vertical même lorsque le profil réduit la carte : sa règle de débordement prend priorité sur celle de Leaflet et utilise la hauteur réelle de la carte, hors attribution. Sur téléphone, le pictogramme de bibliothèque indique un repli/dépli vertical. Les formulaires restent accessibles par le défilement de la page.

Mise à jour Docker habituelle, sans nouvel import OSM, migration ou secret. Recharger les modules du navigateur en `v=6.22.0`. Les tests vérifient les accès, les projections, les réponses tardives, les cartes superposées, la couverture, les repères et les contrôles ; le rendu tactile réel reste à vérifier dans le navigateur après déploiement.
