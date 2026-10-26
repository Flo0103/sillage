# Routage local sur le VPS — 6.20.0

## Pourquoi changer la source de données

La vidéo du 26 octobre montre une attente supérieure à dix secondes avant le premier chemin calculé, puis les points suivants attendent la file. Jusqu’ici, le serveur dépendait de requêtes publiques OSRM et Overpass au moment de chaque calcul. Des délais de réponse, essais de secours et téléchargements successifs pouvaient se cumuler. Les améliorations des caches n’enlevaient pas cette dépendance à froid.

La version 6.20 peut conserver le réseau OSM dans le PostgreSQL/PostGIS existant. Pour les étapes couvertes, le moteur charge seulement une fenêtre géographique indexée et calcule avec son graphe dirigé. Les clics ne déclenchent alors aucun appel OSRM ni Overpass. Les véritables identifiants de nœuds OSM, les revêtements, les sens uniques et les règles d’accès restent ceux du moteur de Sillage.

L’import initial est nécessaire : **une mise à jour du code seule ne rend pas le routage local**. Sans réseau installé, le secours public existant continue de fonctionner. Le premier pays proposé est la Belgique, qui couvre Spa et les Hautes Fagnes.

## Installation sur le VPS de 4 Go

Dans `~/sillage`, après le `git pull` habituel :

```bash
sudo docker compose up -d --build --wait &&
sudo docker compose run --rm --build routing-import &&
sudo docker compose exec app node server/check-routing.js --require-local
```

La deuxième commande construit l’outil Osmium, télécharge l’extrait de Belgique, filtre les routes/chemins et les importe par petits lots. Ce travail peut prendre plusieurs minutes. Ce n’est pas le temps d’un calcul d’itinéraire : c’est la préparation initiale des données. Le journal indique le téléchargement, le filtrage puis le nombre de chemins importés. Attendre la fin du processus.

L’outil d’import est plafonné à **2 Go de RAM et un CPU**. Il conserve les coordonnées directement sur les chemins et ne charge pas une table nationale de nœuds dans Node. Le moteur applicatif garde ses bornes : 25 000 chemins par lecture, 32 Mo de cache brut, 150 000 nœuds / 250 000 arêtes par réseau préparé et 250 000 arêtes en cache. Ces limites visent un VPS de 4 Go ; la consommation réelle totale et le temps de l’import restent à contrôler sur le VPS. Prévoir quelques Go libres sur disque pour l’extrait, les tables, les index et le journal PostgreSQL. L’extrait national PBF est de l’ordre de plusieurs centaines de Mo.

L’import crée uniquement les tables `routing_networks` et `routing_ways` et leurs index. Il n’effectue aucune migration d’image PostgreSQL et ne remplace pas le volume de données existant. Les comptes, sorties, secteurs et itinéraires restent dans leurs tables actuelles.

Chaque import charge une nouvelle révision inactive. L’ancien réseau reste utilisable pendant le chargement. La nouvelle révision devient active après validation de l’intégralité du flux, calcul de l’emprise et mise à jour des statistiques PostgreSQL. Un échec conserve la révision précédemment active. Les révisions retirées restent une journée pour laisser finir les requêtes qui les utilisent ; les imports suivants nettoient les révisions périmées.

## Vérifier la vraie source et les temps

Le diagnostic doit afficher :

- `Sillage 6.20.0` ;
- `mode: stored`, avec la région `belgium` et un nombre de chemins supérieur à zéro ;
- `source: PostGIS · belgium` ;
- `timings.offline: true` pour les trajets de test ;
- `milliseconds`, `readMs` et `computeMs` pour distinguer le temps total, la lecture des chemins et le calcul.

Le contrôle `--require-local` échoue si le réseau n’est pas installé ou si un calcul utilise une source publique. Il ne suffit pas que le conteneur soit Healthy. Le diagnostic utilise le même assemblage de services que l’application.

Pour observer un tracé réel dans l’application :

```bash
sudo docker compose logs --tail=40 app
```

Chaque calcul réussi écrit un événement JSON `routing` avec `durationMs`, la source, les temps et l’utilisation du cache, sans coordonnées, nom de parcours ni identifiant de membre. La réponse HTTP porte également un en-tête `Server-Timing`. Le statut authentifié est disponible sur `/api/routing/status`.

## Mises à jour et autres régions

L’extrait téléchargé est conservé dans le volume `routing_downloads` pour permettre de recommencer un import sans le télécharger à nouveau. Pour récupérer un nouvel extrait et remplacer la révision :

```bash
sudo docker compose run --rm routing-import --refresh
```

Un autre extrait européen Geofabrik peut être ajouté sans enlever la Belgique :

```bash
sudo docker compose run --rm -e ROUTING_REGION=luxembourg routing-import
```

`ROUTING_REGION` reprend le chemin du téléchargement Geofabrik sous `europe/`, sans `-latest.osm.pbf`. Les tailles varient fortement ; les limites du VPS doivent être prises en compte avant un import plus important. Le rafraîchissement reste volontaire, aucun téléchargement national ne se lance en arrière-plan à partir des clics sur la carte.

Une étape trop étendue ou trop détaillée pour la fenêtre locale peut encore utiliser le guide du routeur public, puis vérifier les chemins sur les données stockées. En dehors des régions importées, le mécanisme public de secours subsiste et ses délais peuvent varier. Les limites géographiques et les limites du moteur local ne sont pas supprimées par l’import.

Les profils d’altitude utilisent toujours leur source et leur cache existants. Ils sont enrichis après le calcul du tracé et leur disponibilité ne prouve pas que le routage est local.

## Validation et limites des mesures

Les tests automatisés couvrent un calcul de plusieurs kilomètres sans appels Internet, le cache, l’accrochage initial, la révision des données, les accès, les sens uniques et le cycle d’import. Le graphe minimal réel de la rue du Jeu de Paume sert à vérifier l’aller/retour de ses identifiants, géométries et revêtements à travers le format d’import. Les tests SQL utilisent un adaptateur en mémoire : **l’import national dans un vrai PostGIS, la construction du conteneur et la latence réelle sur le VPS n’ont pas pu être exécutés dans l’environnement de travail, dont le socket Docker et les connexions réseau sont inaccessibles**. Le diagnostic après import est donc indispensable avant de conclure sur les performances réelles.

Sources et attribution : © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright), extraits [Geofabrik Belgique](https://download.geofabrik.de/europe/belgium.html). Traitement par [Osmium tags-filter](https://docs.osmcode.org/osmium/latest/osmium-tags-filter.html), [add-locations-to-ways](https://docs.osmcode.org/osmium/latest/osmium-add-locations-to-ways.html) et [format OPL](https://osmcode.org/opl-file-format/).
