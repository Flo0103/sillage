# Historique des versions

Notes historiques conservées depuis l’ancien README. Les procédures courantes figurent dans le [README](README.md) et les [guides de déploiement](deploy/OVH.md).

## Détours par un pont entre deux points proches (6.26.15)

Corriger l’arrêt prématuré de la recherche pour des points séparés de moins de 2 km à vol d’oiseau. Une rivière, une voie ferrée ou une enceinte peut imposer un détour de plusieurs kilomètres et sortir le pont ou le passage de la fenêtre locale. L’absence de liaison dans ce cadre déclenche désormais une recherche guidée, même pour une petite étape ; le trajet est reconstruit sur les chemins OSM et reste soumis aux interdictions vélo, aux sens uniques et à la politique d’accès explicite. Un petit trajet déjà routable garde sa réponse locale immédiate.

Le guide public peut chercher un chemin voisin jusqu’à 1 km lorsque son graphe ne connaît pas le chemin du départ. Ce rayon ne sert qu’à trouver le détour : les vrais points sont ensuite accrochés et reliés sur OSM avec leur tolérance initiale (150 m par défaut), sans déplacement vers le départ proposé par le guide.

Si les deux sources Overpass sont en panne, le détour peut aussi être vérifié avec un corridor de petites zones de l’API OSM directe : 24 zones maximum, requêtes espacées, cache partagé, mêmes contraintes vélo et sens uniques. Le corridor ne remplit pas de faux rectangles de couverture.

Une vérification distante indisponible est signalée comme une erreur temporaire. L’absence de chemin dans les données chargées n’est plus présentée automatiquement comme un problème de sens de circulation. Étendre le diagnostic externe facultatif avec un franchissement de la Meuse à Maastricht, en plus d’Aachen. Ajouter un cas de régression où le trajet complet ne fonctionnait qu’avec des passages intermédiaires.

Aucune migration, configuration supplémentaire ou réimportation OSM.

## Routage à froid et requêtes simultanées (6.26.14)

Corriger un blocage reproduit sous la limite réelle du serveur : poser l’arrivée pendant l’accrochage du départ déclenchait trois requêtes, dont deux pour le même point. La troisième recevait un 429 et mettait le tracé en pause. Les calculs cartographiques partagent désormais une file de deux requêtes maximum, avec déduplication des accrochages en cours et priorité au tracé. L’enrichissement ne peut occuper qu’un créneau à la fois. Annuler un résultat côté interface ne libère pas prématurément le créneau d’un calcul encore actif sur le serveur ; les réponses devenues obsolètes restent ignorées.

Afficher l’accrochage, le calcul et les erreurs directement sur la carte, avec un bouton Réessayer, aussi sur mobile et en plein écran. Les détails du formulaire ne sont plus nécessaires pour voir une pause. Conserver les protections serveur, le routage incrémental et les règles d’accès OSM.

Étendre le diagnostic de routage avec `--from latitude,longitude`, `--to latitude,longitude` et `--online` pour tester les données publiques sans base ni compte. Ajouter un diagnostic GitHub facultatif avec les fournisseurs réels à Aachen ; il reste séparé des tests déterministes. Aucun nouvel import OSM ni migration.

## Routage hors des régions téléchargées (6.26.13)

Corriger la sélection de source pour l’accrochage et le routage. Aachen, pourtant située dans le rectangle géographique de l’extrait Belgique, utilise les chemins OSM en ligne lorsque ses routes ne sont pas installées. La Flandre et Bruxelles restent couvertes par l’import Belgique. Un point hors zone, un passage entre régions ou une liaison locale manquante ne restent plus bloqués sur un graphe PostGIS partiel.

Vérifier les nœuds réels des trajets guidés avant de réutiliser un couloir stocké. Ajouter le secours des cadres locaux vides et conserver l’emprise commune lors de lectures dédupliquées. Le calcul distant reconstruit le même graphe dirigé : interdictions vélo, sens uniques et accès privés autorisés uniquement par un point explicite restent appliqués. Le chemin local rapide et les caches sont conservés. Le statut expose les emprises installées ; l’accrochage initial indique aussi sa source et son caractère local ou distant.

Validation : cas synthétiques situés à Aachen, hors de toutes les emprises, en Flandre et à travers une limite d’extrait ; étapes longues, caches, fenêtres vides dédupliquées et contrôles des accès / sens. Les changements de sécurité et d’interface déjà présents sur main sont conservés. Aucun import national ni migration supplémentaire.

## Secteurs plus fins et transparents (6.26.12)

Les secteurs passent à 2,5 px et 45 % d’opacité, avec un contour gris foncé de 4,5 px à 35 % d’opacité. L’itinéraire sous-jacent reste ainsi plus visible. Le survol est également allégé (contour de 5,5 px à 50 %, couleur de 3,2 px à 60 %). Les échantillons de légende suivent ce trait plus fin et transparent.

Validation : tests d’interface, notamment largeur du secteur inférieure à celle de l’itinéraire, transparence, superposition et zone de clic. Aucune migration ni nouvelle configuration.

## Consultation après sauvegarde et lisibilité des secteurs (6.26.11)

Enregistrer un secteur nouveau ou modifié ouvre sa consultation, sans activer un nouveau dessin. Le secteur sauvegardé et ses attributs restent affichés ; le bouton Modifier permet de reprendre son édition.

Les secteurs ont un contour gris foncé plus large et un trait coloré légèrement transparent. Le survol renforce les deux traits. Les légendes d’accès limité reprennent le cercle clair avec « ! » de la carte, pour les secteurs comme pour les itinéraires.

Le panneau Carte et légendes sépare Fond de carte et relief, Filtres, Itinéraire · style et légende et Secteurs · style et légende. Les sections de style sont repliables, et chaque sélecteur précède sa légende. Changer le style des secteurs conserve le secteur consulté et l’état replié du panneau.

Validation : tests d’interface pour le retour en consultation, l’absence de dessin au clic après sauvegarde, la reprise de l’édition, les sections repliables, le style des traits et les symboles de légende. Aucune migration ni nouvelle configuration.

## Symboles des secteurs et fonds de carte (6.26.10)

Le triangle des secteurs très techniques apparaît au-dessus du trait, sur fond papier clair. La légende reprend exactement le même symbole. Les secteurs qui contiennent un passage à accès limité utilisent le cercle d’avertissement des itinéraires, avec les mêmes libellés et règles d’affichage. Les restrictions analysées sont désormais conservées lors de l’enregistrement et de la modification d’un secteur ; celles qui avaient déjà été supprimées par les anciennes versions nécessitent une nouvelle analyse en édition, puis un enregistrement.

Le panneau « Carte et légendes » propose « Aucun fond de carte ». L’ombrage reste indépendant et peut être conservé seul. La transparence du fond satellite et la valeur initiale de son curseur passent à 50 %.

Validation : tests d’interface pour les symboles, les filtres, les déplacements et les changements de fond sans modification du dessin ; tests du modèle et de l’API pour la conservation et la validation des restrictions d’accès.

## Consultation des secteurs, suppression latérale et analyse des conversions (6.26.9)

Le panneau de droite propose désormais la suppression du secteur, de la sortie ou de l’itinéraire personnel affiché, en plus des actions des miniatures. Il utilise les mêmes confirmations et les mêmes contrôles de propriété. Sur mobile, ces actions restent accessibles dans le panneau de détails ; supprimer l’élément consulté referme ce panneau.

Sélectionner un secteur personnel sur la carte ou dans la bibliothèque ouvre sa consultation, comme pour un itinéraire. Les extrémités sont fixes, les points intermédiaires et l’édition de la ligne restent désactivés. « Modifier le secteur » active explicitement la correction de la géométrie et des attributs. Les secteurs publics d’un autre membre restent en consultation, sans modification ni suppression.

La conversion d’une sortie en itinéraire lance immédiatement une analyse du relief et des surfaces côté serveur, sans bloquer l’affichage ni recalculer le routage. Les résultats sont enregistrés et apparaissent automatiquement pendant la consultation. Le calcul continue si le navigateur change de sélection ou ferme la page ; une analyse interrompue par un redémarrage du serveur est relancée à la prochaine ouverture. L’écriture porte seulement sur les analyses, avec vérification de la géométrie d’origine : elle ne recrée pas un itinéraire supprimé et ne remplace pas des modifications plus récentes. La provenance et la confidentialité sont conservées.

Validation : tests d’interface, API, analyse et conservation des liens, plus contrôle PostgreSQL / PostGIS de l’enregistrement asynchrone. Les nouveaux cas couvrent les droits de suppression, l’édition explicite, les résultats tardifs, les pannes d’analyse et les modifications concurrentes. Aucune migration de données.

## Tous les résultats filtrés sur la carte (6.26.8)

Le bouton « Afficher tous les résultats sur la carte » affiche et cadre les itinéraires, secteurs ou sorties correspondant aux filtres actifs, y compris les sorties des pages suivantes. Sur mobile, la bibliothèque se replie pour rendre la carte accessible. L’affichage suit ensuite les changements de recherche, de type, de visibilité, de distance, de dénivelé et de zone sans recadrage automatique répété. « Masquer les résultats » restaure les secteurs et traces habituellement affichés ; le tracé en cours est conservé.

Pour Strava, la vue carte lit tous les aperçus correspondants dans l’index privé local, sans pagination et sans importer les activités ni lancer d’appel supplémentaire à Strava. Un historique encore incomplet et les résultats sans aperçu sont signalés. Les réponses de chargement devenues périmées sont ignorées après un changement de filtre ou un masquage. Les tracés groupés des sorties et itinéraires utilisent des aperçus allégés ; leur ouverture charge le tracé complet. Les secteurs gardent leur géométrie originale et leurs avertissements techniques.

Validation : tests d’interface, bibliothèque Strava et sorties, couvrant toutes les pages, les filtres combinés, la conservation du brouillon, le cadrage mobile, les changements de zone, les chargements périmés et la confidentialité de l’index. Aucune migration de données.

## Liste des itinéraires avec miniatures (6.26.7)

Chaque itinéraire trouvé dispose désormais de sa propre carte avec une miniature du tracé, son auteur, sa distance, son dénivelé disponible et sa visibilité, avec la même présentation que les sorties et les secteurs. Un clic, Entrée ou Espace affiche le résultat sur la carte. Le profil de relief et les actions GPX, Garmin / COROS, copie et suppression accompagnent l’itinéraire sélectionné, sans ajouter un aperçu en double sous la liste.

Les filtres, les aperçus OSM chargés à la visibilité et l’accès rapide à la carte sur mobile sont conservés. Les résultats inchangés gardent leurs miniatures montées. Validation : tests d’interface et de bibliothèque des sorties, dont une régression sur les vignettes multiples, l’ouverture clavier, les actions personnelles / publiques et les changements de filtres. Aucune migration de données.

## Recherche mobile et vignettes des secteurs (6.26.6)

Sur mobile, le panneau de bibliothèque occupe au maximum 65 % de la hauteur de l’écran et défile indépendamment de la carte. Le bouton « Afficher la carte » reste visible en haut du panneau, même au milieu d’une longue liste Strava. Il replie la bibliothèque sans perdre la recherche, les résultats ni le tracé en cours ; la réouverture conserve la position dans la liste.

Les secteurs trouvés affichent chacun leur vignette cartographique avec leur nom, leur auteur et leurs caractéristiques. Un clic, Entrée ou Espace ouvre le secteur sur la carte ; les avertissements techniques et la suppression des secteurs personnels restent disponibles. Les aperçus OSM conservent leur chargement à la visibilité.

Validation : 121 tests d’interface et 8 tests de bibliothèque des sorties réussis sous Node 24. La vérification visuelle sur navigateur reste à effectuer : Chromium ne démarre pas dans cet environnement (restriction système sur `setsockopt`). Aucune migration de données. Après fusion, suivre la procédure habituelle du README et recharger la page.

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

Dans ces petites emprises, Overpass dispose de huit secondes avant la tentative de secours OSM direct (dix secondes). Les emprises plus grandes restent sur Overpass et conservent les limites du moteur public décrites en 6.4. Cela ne prouve…7147 tokens truncated…00e9tats de création/consultation et le retour aux éléments personnels après réinitialisation.


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

## 6.23.0 — Tracé et prise en main

Les secteurs passent au-dessus de l’itinéraire avec un trait de 3 px, une opacité de 62 % et sans centre opaque. Leur zone de survol reste assez large pour consulter les attributs, mais se place sous les poignées de l’itinéraire pour conserver l’insertion et le glissement du tracé. Le départ est un cercle vert et l’arrivée un cercle à damier, tous deux de 24 px, comme les points de passage, en dessin comme en consultation. Sur une boucle fermée, un léger décalage visuel permet de distinguer les deux cercles sans déplacer les coordonnées.

La croix d’arrêt demande confirmation avant d’abandonner un dessin ou des modifications. Elle est désactivée pendant un enregistrement. Le bouton **Enregistrer l’itinéraire / le secteur**, directement sur la carte, ouvre le formulaire existant dans une boîte de dialogue native, aussi en plein écran. Aucun formulaire n’est dupliqué : le nom, les notes, les attributs, les validations et les requêtes restent ceux de l’éditeur. Revenir à la carte ou appuyer sur Échap conserve le dessin et ses champs ; un échec de sauvegarde laisse le formulaire ouvert. Sur mobile, sa hauteur suit l’espace réellement visible, y compris lorsque le clavier s’ouvre. Le formulaire est rétabli à sa place après fermeture et un enregistrement réussi ne demande pas de quitter le plein écran.

Une visite guidée en six étapes présente la bibliothèque, les outils, le dessin et les corrections, la légende, le profil et l’enregistrement. Elle s’affiche une fois par compte et par navigateur, après la connexion. Le navigateur mémorise la visite terminée ou passée dans `localStorage` ; effacer ces données la fait réapparaître. Le blocage du stockage n’empêche pas l’utilisation de l’application. La commande **Découvrir Sillage · visite guidée** dans l’aide « ? » permet de la relancer. La visite n’ajoute aucune donnée et restaure l’état de la bibliothèque et de la légende à sa fermeture. Elle utilise un dialogue accessible au clavier, une cible visuelle, une progression et des annonces des étapes.

Mise à jour Docker habituelle, puis rechargement des modules `v=6.23.0`. Aucun import OSM, migration ou secret supplémentaire. Les tests couvrent les sauvegardes en plein écran natif et simulé, le retour au dessin, les erreurs, la hauteur du clavier, la confirmation d’arrêt, les symboles, les couches et le cycle de la visite. Les interactions DOM/Leaflet et les dialogues sont simulés dans ces tests ; le rendu tactile et le plein écran réels restent à vérifier après déploiement dans le navigateur.


## 6.24.0 — Sens inverse et sorties indépendantes

Le bouton à deux flèches dans les outils de la carte inverse le sens de l’itinéraire. Les points et les portions changent d’ordre. Les portions routées sont recalculées dans le sens opposé avec les règles OSM actuelles, notamment les sens uniques ; les portions manuelles gardent leur géométrie inversée, leurs surfaces et leur profil retourné. Annuler/rétablir conserve l’état précédent. Sur un itinéraire public d’un autre membre, l’inversion prépare une copie privée au lieu de modifier celui de son auteur.

Les vignettes ouvrent directement les sorties enregistrées et les activités Strava, par clic ou au clavier. Les anciens boutons d’ouverture sont supprimés. Les liens d’attribution restent utilisables. La sortie de référence reste sur la carte quand on ouvre un secteur personnel ou public. Son panneau propose **Transformer en itinéraire**, aussi depuis le bouton de panneau en plein écran. Cette action crée un itinéraire privé en conservant chaque point de la sortie, découpé en portions manuelles modifiables ; elle n’impose pas un recalcul OSM de tout le parcours. Le menu d’un point permet ensuite de router localement une portion. La sortie d’origine reste enregistrée.

Supprimer une sortie conserve les secteurs et les itinéraires associés. La migration remplace l’ancienne cascade du lien `portions.source_ride_id` par `ON DELETE SET NULL` et utilise ce même comportement pour les nouvelles copies d’itinéraires. Les noms, géométries, attributs et profils restent en place. Le panneau de confirmation décrit ce comportement et la suppression de la sortie de référence ne réinitialise plus le secteur en cours d’édition.

Les copies provenant de l’API Strava restent privées, y compris après suppression manuelle de la sortie source ou création d’une copie supplémentaire. La provenance d’activité est conservée séparément du lien à la sortie. La déconnexion, la révocation ou un événement de suppression Strava continuent d’effacer les données Strava correspondantes, avec un verrou par compte pour coordonner création et révocation. Les sorties GPX et les dessins indépendants restent distincts de cette purge. L’export du compte inclut la provenance des itinéraires et des secteurs.

La visite guidée comporte sept étapes et un lien vers la connexion Strava dans Mon compte. Ses descriptions courtes incluent les pictogrammes des boutons. Sur mobile, une carte compacte reste en bas et laisse la cible visible au-dessus ; le masque est plus léger et les actions restent disponibles lorsque le texte doit défiler. La visite peut toujours être relancée depuis « ? ». Les secteurs conservent leur trait fin au-dessus de l’itinéraire, avec un contour sombre discret pour mieux lire leurs couleurs sur les différents fonds.

Après le `git pull` habituel, reconstruire et contrôler la migration sur le VPS :

```bash
sudo docker compose up -d --build --wait &&
sudo docker compose exec app node server/check-db.js
```

Le contrôle vérifie PostGIS, les géométries et les index, puis les liens aux sorties des secteurs et itinéraires. La migration est transactionnelle et réexécutable ; elle conserve les données existantes. Aucun import OSM ni nouvelle clé. Recharger les modules `v=6.24.0`. Les tests couvrent les opérations de tracé, les copies et leur visibilité, les suppressions, les événements Strava et le cycle de migration sur adaptateurs SQL ; la validation native PostGIS et le rendu tactile restent à effectuer sur le VPS et dans le navigateur.


## Bibliothèque et recherche de sorties (6.25.0)

Le bouton de carte **Bibliothèque** utilise un livre ouvert, un libellé permanent et un chevron adapté au repli horizontal sur ordinateur ou vertical sur mobile. Il est séparé des outils de dessin. Les deux sources **Mes sorties** et **Strava** partagent le champ de recherche, les filtres et une liste de vignettes directement cliquables, paginée par vingt. Les sélecteurs de sortie imbriqués disparaissent. Les aperçus GPX sont privés, simplifiés à 500 points et chargés seulement lorsque leurs cartes entrent dans la zone visible, avec deux requêtes simultanées au maximum.

Les filtres Strava interrogent désormais un index privé PostgreSQL, au lieu des 300 activités déjà chargées dans le navigateur. Deux tables additives, `strava_library_state` et `strava_library_activities`, sont créées au démarrage. Un curseur daté, le numéro de page et l’état de synchronisation sont conservés par utilisateur et athlète. Le chargement progresse par lots de 200 activités brutes, même sur une page sans vélo / gravel, avec une progression explicite, pause et reprise après interruption ou quota. L’index ne télécharge pas les traces complètes : il contient les métadonnées et aperçus nécessaires à la recherche des sorties vélo, ainsi que les identifiants / dates des autres activités pour reconnaître le chevauchement lors d’une actualisation. Il ne partage aucune activité entre utilisateurs.

Une recherche ou un changement de filtre ne consomme pas de nouvel appel Strava : les requêtes de synchronisation de l’historique sont indépendantes. Les nouveaux résultats apparaissent progressivement pendant le premier chargement ; l’interface indique clairement lorsque l’historique est encore partiel. Une actualisation de tête récupère les nouvelles activités sans réinitialiser le curseur de l’historique. Un seul lot est exécuté par utilisateur à la fois, au plus deux utilisateurs par processus, et les départs de requêtes Strava sont espacés d’une seconde. Aucun appel réseau n’est exécuté en retenant une transaction SQL ouverte dans l’indexeur. Les aperçus inchangés restent montés entre les lots.

La déconnexion, la révocation et la suppression d’activité Strava purgent aussi les données de cet index ; un résultat en vol ne réinsère pas un lot invalidé. L’export complet du compte inclut ses métadonnées vélo indexées. La suppression manuelle d’une sortie Sillage conserve l’index Strava, les secteurs et les itinéraires, comme auparavant pour ces dessins.

Après le `git pull`, lancer `sudo docker compose up -d --build --wait`, puis `sudo docker compose exec app node server/check-db.js` et recharger la page. Aucune nouvelle clé ni réimportation OSM. Les modules sont servis en `v=6.25.0`.

Validation : 367 tests passent, aucun échec, un contrôle systemd ignoré pour la restriction existante SO_PASSCRED. Les nouveaux cas couvrent un historique de plus de 300 activités, les pages sans gravel, pagination et filtres, actualisation, quota / reprise, concurrence, révocation en vol, aperçus différés et requêtes périmées. Les tests SQL, DOM et Leaflet sont simulés ; la connexion Strava réelle, les migrations PostgreSQL / PostGIS natives et le rendu tactile restent à contrôler sur le VPS et dans le navigateur.


## Outils de dessin et fermeture des détails (6.26.0)

La croix demande une confirmation uniquement pour un tracé commencé ou une modification réelle non enregistrée. Ouvrir un secteur personnel, consulter un itinéraire, passer en édition sans rien changer ou annuler une correction ne déclenche plus cette alerte. La comparaison conserve une référence des champs, de la géométrie, des passages et de leurs modes, sans inclure les analyses automatiques de surface ou d’altitude. Un premier point reste protégé ; une création sans point se ferme directement. Effacer le tracé d’un secteur existant reste une modification protégée. Annuler/rétablir conserve aussi la référence de l’itinéraire enregistré.

La disquette ouvre le même formulaire d’enregistrement depuis les outils de la carte, y compris sur mobile et en plein écran. Le bouton flottant disparaît. Cliquer sur Enregistrer dans le formulaire soumet en place, sans l’ouvrir dans une fenêtre ni déplacer le panneau ; seule la commande de la barre ouvre cette fenêtre. Le crayon **Mode manuel de tracé** remplace la case Sans routage pour les prochains points dans la même barre. Il ne modifie que les prochains points, avec état visuel et case accessible au clavier. Quand la carte mobile manque de hauteur, les outils passent automatiquement à deux colonnes ; le défilement reste possible sur une carte très courte et la légende garde sa place à côté.

Les secteurs utilisent uniquement des points de passage numérotés, y compris leurs extrémités, qui restent déplaçables et supprimables. Les itinéraires conservent leur cercle de départ vert et leur arrivée à damier. La note de plaisir est expliquée dans le formulaire, les étoiles, les infobulles et la légende : 1 Horrible, 2 Peu agréable, 3 Agréable, 4 Très agréable, 5 Superbe. Un secteur **Très technique** porte un triangle d’alerte sur la carte, un avertissement dans son aperçu et ses détails, et un repère dans la légende. Le symbole ne bloque pas les clics ni la création de points sur le chemin.

Mise à jour habituelle avec `git pull` puis `sudo docker compose up -d --build --wait` et rechargement de la page. Modules `v=6.26.0`, aucune migration supplémentaire ni import OSM. Les contrôles couvrent les fermetures sans changement ou avec retour à l’original, les corrections annulées, la conservation de l’historique, l’enregistrement en place et en fenêtre, les repères et les outils adaptatifs. DOM et Leaflet simulés : le rendu tactile reste à vérifier dans le navigateur après déploiement.

Validation 6.26.0 : 377 tests réussis, aucun échec, un contrôle systemd ignoré pour la restriction SO_PASSCRED existante. Syntaxe JavaScript, structure et identifiants HTML, et graphe des modules vérifiés.


## Disposition des outils mobiles (6.26.1)

Sur téléphone, Bibliothèque, Carte et aide sont alignés sur une même rangée de 40 px. Le bouton Carte garde le nom accessible « Carte et légendes » et ouvre les fonds, les filtres et les palettes dans un panneau défilant. Le zoom, le recentrage et le plein écran forment un groupe de navigation compact en haut à gauche. Les commandes d’itinéraire et de secteur forment un groupe « Tracé » de quatre colonnes, centré en bas au-dessus de l’échelle et des crédits. Les boutons gardent une cible tactile de 44 px. La hauteur de ce groupe est prise en compte dans l’espace disponible pour la légende.

Sur ordinateur, les deux groupes sont également distincts ; la légende reste en bas à gauche. Les outils de tracé restent accessibles par défilement sur une carte courte, y compris en plein écran. La visite guidée cible le groupe de dessin. Aucun changement des calculs, des données ni des formulaires d’enregistrement.

Validation : 377 tests réussis, aucun échec, un contrôle systemd ignoré pour la restriction SO_PASSCRED existante. Le démarrage de Chromium est bloqué par les restrictions système de cet environnement ; le rendu tactile reste à vérifier dans un navigateur après déploiement.

Mise à jour habituelle avec `git pull` puis `sudo docker compose up -d --build --wait`, et rechargement de la page. Aucune migration ni import OSM.

## Carte mobile, bibliothèque et relief (6.26.3 à 6.26.5)

Sur téléphone, les commandes de tracé se placent en haut à droite, sous Carte et l’aide, avec une largeur adaptée aux boutons visibles et des cibles tactiles de 44 px. Le titre « Tracé » et les quatre colonnes réservées disparaissent. Annuler et rétablir restent masqués en consultation lorsque l’historique est vide, puis redeviennent accessibles après une opération. Le panneau Carte ouvert se place au-dessus du zoom et des outils dans un contexte d’empilement limité à la carte ; l’aide et les réglages de point conservent leur priorité.

La bibliothèque démarre repliée sur les écrans jusqu’à 850 px, avant le chargement des données. Son bouton permet de la rouvrir et les changements de vue conservent le choix manuel. Elle reste ouverte par défaut sur ordinateur. Le graphe du relief passe de 176 à 132 px sous 500 px de largeur, avec des espacements mobiles réduits, en conservant graduations, extrema et curseur synchronisé.

La version 6.26.5 conserve les corrections Strava, les protections HTTP, Leaflet hébergé localement et les dépendances verrouillées des versions de main intégrées pendant la résolution des conflits. Les références de ressources mobiles sont actualisées. Aucune nouvelle migration ni modification des données ou du routage. Après fusion, utiliser la procédure du README depuis main, puis recharger la page mobile.
