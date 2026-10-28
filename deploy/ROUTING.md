# Routage local sur le VPS — 6.21.1

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

La deuxième commande construit l’outil Osmium, vérifie son fonctionnement sur un petit réseau de test, télécharge l’extrait de Belgique, lit les coordonnées avec un index sur disque et importe seulement les routes/chemins par petits lots. Ce travail peut prendre plusieurs minutes. Ce n’est pas le temps d’un calcul d’itinéraire : c’est la préparation initiale des données. Le journal indique le téléchargement, la préparation de l’index puis le nombre de chemins importés ; un message périodique confirme que la préparation continue avant le premier lot. Attendre la fin du processus.

L’outil d’import est plafonné à **2 Go de RAM et un CPU**, avec un tas Node limité à 384 Mo et un seul worker Osmium. Depuis 6.20.1, il utilise `sparse_file_array` pour les coordonnées des nœuds : l’index temporaire est stocké sur disque. Il n’exécute plus `tags-filter` avec conservation des références, dont les listes de nœuds en mémoire pouvaient dépasser le budget. Node retient uniquement les chemins routables lus dans le flux OPL. L’index est retiré après import ou erreur ; un index abandonné lors d’un arrêt complet du conteneur est nettoyé au lancement suivant sous le verrou de préparation. L’extrait PBF téléchargé est conservé.

Le moteur applicatif garde ses bornes : 25 000 chemins par lecture, 32 Mo de cache brut, 150 000 nœuds / 250 000 arêtes par réseau préparé et 250 000 arêtes en cache. Ces limites visent un VPS de 4 Go ; la consommation réelle totale et le temps de l’import restent à contrôler sur le VPS. Prévoir quelques Go libres sur disque pour l’extrait, l’index temporaire, les tables et le journal PostgreSQL. L’extrait national PBF est de l’ordre de plusieurs centaines de Mo.

L’import crée uniquement les tables `routing_networks` et `routing_ways` et leurs index. Il n’effectue aucune migration d’image PostgreSQL et ne remplace pas le volume de données existant. Les comptes, sorties, secteurs et itinéraires restent dans leurs tables actuelles.

Chaque import charge une nouvelle révision inactive. L’ancien réseau reste utilisable pendant le chargement. La nouvelle révision devient active après validation de l’intégralité du flux, calcul de l’emprise et mise à jour des statistiques PostgreSQL. Un échec conserve la révision précédemment active. Les révisions retirées restent une journée pour laisser finir les requêtes qui les utilisent ; les imports suivants nettoient les révisions périmées.

## Vérifier la vraie source et les temps

Le diagnostic doit afficher :

- `Sillage 6.21.1` ;
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

## Mise à jour automatique hebdomadaire — 6.21.0

Après récupération du code, activer le minuteur une fois sur le VPS Ubuntu :

```bash
sudo bash deploy/install-routing-updates.sh
```

Le script vérifie les unités systemd, construit l’image d’import avec son contrôle natif Osmium, installe le service et active le minuteur. Il affiche ensuite la prochaine exécution. Il est réexécutable après une mise à jour du dépôt. L’activation ne lance aucun téléchargement ni import national immédiatement.

Si l’installation de 6.21.0 s’est arrêtée sur `WorkingDirectory= path is not absolute`, récupérer 6.21.1 puis relancer ce même script. `WorkingDirectory` prend un chemin unique sans guillemets englobants ; `RequiresMountsFor` utilise une liste de chemins avec sa propre syntaxe. Le rendu distingue maintenant ces deux cas et conserve les espaces, guillemets et pourcentages du chemin réel. Cet échec de validation survenait avant l’installation des unités et n’activait pas le minuteur. Les messages `CPUAccounting … has been removed` provenant d’unités système ne sont pas la cause de cet échec.

L’horaire est **chaque dimanche à 04 h, Europe/Brussels**, avec adaptation automatique à l’heure d’été/hiver et une précision d’une minute. Si le VPS est éteint à cet instant, la tâche attend le dimanche suivant : pas de rattrapage imprévu en journée. L’horaire peut être affiché en UTC par le serveur.

La tâche lit la liste des régions actives en base et actualise chacune avec `--refresh`, une seule à la fois. La Belgique et les éventuelles autres régions installées sont donc entretenues ensemble. Elle exige un premier réseau installé ; elle ne crée pas de nouvelle région à partir d’une simple configuration. Les limites de l’importeur restent celles décrites plus haut. L’ancien réseau de chaque région reste actif jusqu’à la publication complète de sa révision.

Un verrou hôte empêche deux lancements de cette tâche. Le verrou PostgreSQL de préparation protège aussi contre un import manuel simultané. Le service réutilise l’image construite à l’installation, sans récupération de code Git, sans construction nocturne et sans redémarrage de l’application ou de la base. Si l’image manque ou si la base ne répond pas, il échoue explicitement. L’exécution est limitée à trois heures ; un arrêt termine le conteneur appartenant à cette tâche. Une région en échec conserve son ancien réseau, les autres sont traitées et le bilan global marque le service en échec.

Vérifier la prochaine exécution et le dernier résultat :

```bash
sudo systemctl list-timers --all sillage-routing-update.timer --no-pager
sudo journalctl -u sillage-routing-update.service -n 80 --no-pager
```

Le journal contient les étapes d’import et un bilan JSON des régions actualisées ou en échec. Une session SSH peut être fermée sans interrompre le service. Pour lancer volontairement une mise à jour immédiate, puis suivre son journal :

```bash
sudo systemctl start --no-block sillage-routing-update.service
sudo journalctl -u sillage-routing-update.service -f
```

Quitter `journalctl` avec Ctrl+C arrête seulement l’affichage. Pour interrompre la tâche, utiliser `sudo systemctl stop sillage-routing-update.service`. Pour désactiver les prochains lancements, utiliser `sudo systemctl disable --now sillage-routing-update.timer` ; cela ne supprime aucune donnée.

La planification n’est pas activée par un simple `git pull` ou `docker compose up` : le script d’installation doit être exécuté sur le VPS. Les tests locaux vérifient la séquence des régions, les échecs, les verrous, le nettoyage du conteneur, le rendu des unités et l’horaire été/hiver avec le parseur systemd. Un test natif vérifie aussi les unités rendues et le rejet de l’ancien chemin entre guillemets lorsqu’un environnement systemd compatible est disponible ; il est explicitement ignoré si le bac à sable interdit le socket interne du parseur. Les appels Docker sont simulés et le gestionnaire systemd de production n’est pas exécuté dans l’environnement de travail ; le script effectue la validation native des unités sur le VPS avant installation.

## Validation et limites des mesures

Les tests automatisés couvrent un calcul de plusieurs kilomètres sans appels Internet, le cache, l’accrochage initial, la révision des données, les accès, les sens uniques et le cycle d’import. Le graphe minimal réel de la rue du Jeu de Paume sert à vérifier l’aller/retour de ses identifiants, géométries et revêtements à travers le format d’import. Les tests SQL utilisent un adaptateur en mémoire : **l’import national dans un vrai PostGIS, la construction du conteneur et la latence réelle sur le VPS n’ont pas pu être exécutés dans l’environnement de travail, dont le socket Docker et les connexions réseau sont inaccessibles**. Le diagnostic après import est donc indispensable avant de conclure sur les performances réelles.

Sources et attribution : © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright), extraits [Geofabrik Belgique](https://download.geofabrik.de/europe/belgium.html). Traitement par [add-locations-to-ways](https://docs.osmcode.org/osmium/latest/osmium-add-locations-to-ways.html), [index sur disque](https://docs.osmcode.org/osmium/latest/osmium-index-types.html) et [format OPL](https://osmcode.org/opl-file-format/).

## Reprise après `osmium a échoué (null)` — 6.20.1

Le code `null` signifiait que le processus avait été interrompu par un signal, mais l’ancien message ne l’affichait pas. Le filtrage de 6.20.0 conservait les références de nœuds en mémoire ; un dépassement mémoire est une cause probable de l’arrêt observé sur le VPS de 4 Go, sans être confirmé par la capture seule. Le nouveau lecteur affiche le signal exact et ne conclut à un OOM que si `SIGKILL` s’accompagne d’une hausse du compteur OOM du conteneur.

Après récupération de 6.20.1, reconstruire et relancer `routing-import` avec les commandes d’installation ci-dessus. Le PBF déjà téléchargé est réutilisé. L’ancien fichier de filtrage partiel est supprimé. L’ancien réseau actif reste conservé jusqu’à validation et publication complète du nouvel import.

La construction de l’image lance `node server/check-osmium.js` avec le vrai binaire Osmium, un index temporaire et un petit réseau utilisant de grands identifiants OSM. Elle vérifie les géométries, les raccords, les surfaces et les sens uniques avant tout import national. Le succès est indiqué par `OSMIUM_CHECK_OK`. Ce test ne mesure pas la mémoire nécessaire à l’extrait national. Les tests locaux de supervision simulent également les interruptions, le compteur OOM, l’absence du binaire et l’arrêt du lecteur.


## Continuer hors des régions téléchargées (6.26.13)

L’import par défaut couvre la **Belgique**, donc aussi la Flandre et Bruxelles. Aachen est en Allemagne : ses chemins ne font pas partie de cet extrait. Les limites d’un extrait servent à choisir la source rapide, elles ne limitent pas les lieux où un membre peut tracer. Il n’est pas nécessaire d’importer un nouveau pays pour y continuer un itinéraire.

Au premier point comme aux étapes suivantes, le moteur utilise les données PostGIS quand les chemins sont présents près des points choisis. Sinon il utilise directement les données OSM en ligne. Cela évite de charger une fenêtre belge partielle pour un clic à Aachen, même si cette ville est comprise dans le rectangle de l’extrait. Le statut `/api/routing/status` indique aussi `bounds` pour chaque extrait, dans l’ordre sud, ouest, nord, est ; ce rectangle ne prouve pas la couverture réelle de ses routes.

Une liaison manquante dans le graphe installé peut aussi être recalculée sur les données OSM distantes. Un guide public dont certains nœuds manquent dans le couloir stocké est vérifié à partir des chemins en ligne. Les cadres PostGIS vides disposent du même secours. Le moteur ne retourne jamais le seul dessin OSRM comme résultat vérifié : il reconstruit le graphe dirigé et garde la politique des accès explicites, l’interdiction `bicycle=no`, les exceptions vélo et les sens uniques. Un point sur une interdiction vélo explicite n’est pas déplacé automatiquement pour la contourner.

Les calculs en zone installée conservent leur chemin rapide, leurs caches et leur fonctionnement sans Internet. Hors zone, le réseau et la disponibilité / les quotas des services publics restent nécessaires. Aucun téléchargement national, migration ou réimport OSM n’est déclenché par cette correction. La réponse et les journaux distinguent les données PostGIS des données Overpass / OSM API via `osmSource` et `timings.offline`, y compris à l’accrochage initial.


## Diagnostic d’un tracé à froid (6.26.14)

Les calculs du navigateur sont limités à deux requêtes simultanées, comme l’admission serveur ; les demandes identiques d’accrochage partagent la même requête. Les calculs d’altitude ou de surface ne peuvent occuper tous les créneaux. Les réponses devenues obsolètes gardent leur créneau jusqu’à la fin réelle du calcul distant, sans modifier le tracé courant. Le message d’état et Réessayer sont visibles sur la carte.

Pour tester les fournisseurs à Aachen sans lire les comptes ni le réseau stocké :

```bash
sudo docker compose exec -T app node server/check-routing.js --online --from 50.7715,6.075 --to 50.7715,6.087
```

Sans `--online`, les mêmes points testent le choix de source de la production. Sans coordonnées personnalisées, le diagnostic historique à Spa reste disponible. Les journaux du diagnostic indiquent hôte amont, statut HTTP, durée, source du tracé et résultat aller / retour. Le workflow **Diagnostic OSM en ligne** effectue aussi ce test sur GitHub avec des points publics à Aachen. Il est facultatif, car la disponibilité des fournisseurs publics ne doit pas bloquer les tests déterministes.


## Ponts et autres détours entre deux points proches (6.26.15)

Une petite distance à vol d’oiseau ne garantit pas un trajet court : le pont le plus proche peut se situer hors de la fenêtre OSM locale. Après échec de cette fenêtre, le moteur cherche aussi un guide pour les étapes de moins de 2 km, puis vérifie le parcours sur OSM. Le guide n’accorde aucune permission supplémentaire et un point interdit aux vélos reste refusé. Si la vérification externe échoue, l’application indique une indisponibilité temporaire plutôt qu’une impossibilité de circulation non démontrée.

Le diagnostic facultatif **Diagnostic OSM en ligne** couvre Aachen et Maastricht. Pour tester le franchissement de la Meuse sans la base :

```bash
sudo docker compose exec -T app node server/check-routing.js --online --from 50.825,5.685 --to 50.823,5.711
```

Ces points publics à Maastricht servent au diagnostic ; ils ne proviennent pas d’un tracé privé enregistré. Les tests déterministes reproduisent également une rivière avec un pont hors des trois fenêtres locales, pour comparer le routage direct à celui avec points de passage.
