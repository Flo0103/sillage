# Sillage — carnet gravel

Application en français pour importer des sorties GPX, isoler des portions et les noter. Déployable sur un VPS OVH avec Docker Compose, Caddy et PostgreSQL.

## Fonctionnement

- Connexion par identifiant et mot de passe ; comptes sur invitation, inscriptions publiques fermées.
- Sorties et portions conservées en PostgreSQL et séparées par utilisateur ; le fichier GPX original est aussi conservé pour les nouveaux imports et peut être téléchargé.
- Choisir deux points sur un GPX déclenche automatiquement l’accrochage OpenStreetMap.
- La portion orange se dessine sur un calque au-dessus du GPX bleu.
- Mode manuel point à point, avec annulation du dernier point et possibilité de repartir d’un tracé vide.
- Nom facultatif, plaisir sur cinq, technicité, revêtement dont « Grosses pierres / blocs », roulabilité hivernale et commentaire.
- Fonds OpenStreetMap et satellite Esri, avec attribution.
- Export des portions en GeoJSON et transfert des anciennes notes locales v1 vers le compte connecté.
- Aucune trace de démonstration : la carte s’ouvre autour de Spa, sans parcours préchargé.

## Installation / mise à jour

Voir [le guide OVH](deploy/OVH.md), y compris la migration depuis v1, la création des comptes et les sauvegardes. Cette version nécessite le serveur ; ouvrir simplement `dist/index.html` ou utiliser un serveur statique ne suffit plus.

```sh
bash deploy/configure.sh
# Compléter le domaine et l’email dans .env si nécessaire.
sudo docker compose up -d --build
sudo docker compose exec app node server/users.js flo
```

Le pilote `pg` est installé dans l’image Docker ; la version directe est fixée dans `package.json`. Aucun secret n’est inclus dans le dépôt. Les mots de passe utilisateurs sont hachés avec scrypt et sel aléatoire ; sessions aléatoires côté serveur, cookie HttpOnly, Secure et SameSite=Strict, contrôles d’origine et limitation des tentatives de connexion. Les requêtes SQL utilisent des paramètres et filtrent les données par utilisateur connecté.

## Tests

Node 22 ou supérieur :

```sh
npm test
```

Les tests de modèle et d’API fonctionnent sans dépendance externe ; l’adaptateur SQL de test est en mémoire. Le serveur nécessite `npm install` et un PostgreSQL configuré via PGHOST, PGPORT, PGUSER, PGPASSWORD et PGDATABASE. Pour du développement local HTTP seulement, définir APP_ORIGIN avec l’origine exacte et COOKIE_SECURE=false. En production, HTTPS et les cookies Secure restent activés.

## Limites et services externes

Accrochage approximatif à vérifier, limité à 15 km et aux données OSM disponibles. Overpass peut être lent ou indisponible : le GPS reste visible et le mode manuel est disponible. L’algorithme interpole les longues arêtes OSM, puis relie des ancres espacées de 120 m ; il ne garantit pas les restrictions d’accès, sens de circulation ou le bon choix entre chemins parallèles. Les segments manuels sont droits entre chaque point, sans accrochage automatique. Les GPX à plusieurs segments utilisent le segment le plus long pour éviter de relier des interruptions.

Leaflet est chargé depuis unpkg ; polices depuis Google Fonts ; tuiles depuis OpenStreetMap ou Esri World Imagery (couverture et date variables). La zone sélectionnée est transmise à Overpass pour l’accrochage. Les imports GPX sont limités à 25 Mo / 100 000 points (original complet conservé, segment le plus long affiché) ; 100 sorties récentes sont affichées. Les coordonnées sont stockées en JSONB, sans PostGIS. Les sessions expirent après sept jours. Il n’y a pas encore de récupération de mot de passe par email, de réimport GeoJSON ni de connexion Strava.

## Correctif 2.1

Login isolé de la grille de l’application, champs contenus sur mobile et desktop. Contrôles de visibilité facultatifs et versions explicites des fichiers CSS/JS pour éviter les mélanges après une mise à jour. Carte de hauteur explicite, recalcul de taille à chaque changement de dimensions, endpoint OSM canonique et message unique en cas d’échec de tuiles. Les pannes du fournisseur restent possibles ; le sélecteur permet de changer de fond.

Les nouvelles colonnes PostgreSQL `rides.gpx_xml` et `rides.file_name` sont ajoutées sans effacer les sorties existantes. Le bouton ↓ GPX télécharge l’original pour les nouveaux imports, ou un GPX reconstruit depuis les coordonnées pour les anciennes sorties (sans altitude ni horodatage non conservés auparavant).

## Correctif 2.1.1 : blocage des tuiles OSM

Le serveur envoyait une politique `same-origin` qui supprimait le Referer des requêtes vers OSM. Elle est remplacée par `strict-origin-when-cross-origin`, également précisée sur les images Leaflet. Seule l’origine du site est transmise aux domaines tiers. Les requêtes vont toujours directement vers l’URL OSM canonique, sans proxy, cache-busting, contournement de blocage ni téléchargement massif. Le cache des tuiles reste géré par le navigateur selon les en-têtes OSM.

Référence : https://operations.osmfoundation.org/policies/tiles/ . Un blocage lié au navigateur, au réseau ou au fournisseur peut subsister ; le réglage local ne prouve pas à lui seul la levée d’un blocage externe.

## Version 3 : catalogue, comptes et fonds de carte

La carte s’ouvre sur les segments, sans charger automatiquement un GPX. « Mes sorties » propose un sélecteur des traces déjà enregistrées, l’import et le téléchargement GPX. Passer à « Carte des segments » masque le GPX et montre les segments filtrés : personnels, publics des autres membres, roulables en hiver (oui / non / selon conditions / non renseigné). Les couleurs sont choisies par note de plaisir ou revêtement, avec une légende.

Les **nouveaux segments sont publics par défaut pour les utilisateurs connectés**. Une case permet de les rendre privés dès la création. Les segments créés avant la migration restent privés ; leur propriétaire peut les publier via « Modifier le partage et l’hiver ». Les GPX complets restent privés. Chaque propriétaire peut modifier la visibilité et l’état hiver de ses segments ; voir un segment public ne donne aucun droit de le modifier ou d’accéder au GPX de son auteur.

« Mon compte » permet de changer son mot de passe avec vérification du mot de passe actuel (les autres sessions sont révoquées) et de gérer ses fonds WMS. Les URLs WMS sont des services HTTPS publics compatibles EPSG:3857 ; nom technique des couches et version WMS sont à renseigner. Les configurations restent dans le compte, et les images sont chargées directement par le navigateur, sans proxy WMS ni requête arbitraire du serveur. Aucun identifiant HTTP n’est accepté dans l’URL.

Le fond **IGN Belgique · Topo** utilise le service WMTS officiel CartoWeb (`https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png`). Attribution IGN / TomTom affichée. Licence non commerciale : https://ngi.be/fr/conditions-dutilisation-pour-le-service-cartoweb-be/ . Les autres usages peuvent nécessiter une autorisation ou licence IGN. Le fond choisi ne change pas l’accrochage OSM.

### Administration

L’administrateur est désigné explicitement une fois depuis le VPS :

```sh
sudo docker compose exec app node server/admin.js TON_IDENTIFIANT
```

Remplacer `TON_IDENTIFIANT` par un compte existant. Le lien « Admin » apparaît après rechargement. Les administrateurs peuvent créer/révoquer des invitations, générer un lien de réinitialisation de mot de passe, activer/désactiver, promouvoir/rétrograder et supprimer des comptes. La suppression efface les sorties, segments et configurations de l’utilisateur ; la désactivation conserve les données. Il est impossible de supprimer/désactiver/rétrograder son propre compte dans l’interface, ou de supprimer le dernier administrateur actif.

Les invitations sont des liens à transmettre soi-même, valables sept jours et utilisables une fois. Seul un hachage du jeton est stocké en base ; le lien complet n’est montré qu’à sa création. Le jeton est dans le fragment de l’URL, retiré de la barre d’adresse après lecture, et transmis uniquement à l’API en POST. Une invitation ne peut pas attribuer de droits administrateur. Aucun email n’est envoyé par Sillage.

### Déploiement de cette version

Sauvegarder la base, récupérer le code puis reconstruire les services selon le guide OVH. Les tables et colonnes sont ajoutées automatiquement ; aucun compte n’est administrateur avant la commande explicite ci-dessus. Les tests utilisent un adaptateur SQL mémoire et une simulation DOM. Les services WMS/IGN et l’affichage doivent être vérifiés dans un navigateur après déploiement ; l’environnement de développement ne permet pas de valider le service distant dans un navigateur ni un vrai PostgreSQL.

## Correctif 3.0.1 : fond IGN

Le préréglage IGN utilise les tuiles WMTS CartoWeb en Web Mercator (ordre z/y/x) à la place de requêtes WMS GetMap. Les zooms natifs sont limités à 7–17 et rééchantillonnés au-delà. Les WMS ajoutés par l’utilisateur restent indépendants. Les échecs IGN produisent un seul message de carte au lieu de notifications répétées. La disponibilité réelle du service distant et la levée d’un blocage réseau doivent être vérifiées depuis le navigateur utilisateur.

Un filtrage institutionnel classant le domaine `insufficient-content` nécessite une autorisation ou recatégorisation par l’administrateur réseau ; changer le fond de carte ne modifie pas ce filtrage. Aucun proxy, autre domaine ou mécanisme de contournement n’est ajouté.

## Version 3.1 : accrochage plus rapide et réglable

- Index spatial par cellules pour chercher les candidats proches, A* à la place de Dijkstra et préparation du graphe réutilisée dans la page. Les longues arêtes OSM sont toujours interpolées.
- Cache en mémoire de dix minutes côté serveur (maximum 32 Mo de réponses brutes, 16 zones) et une zone en mémoire côté navigateur. Les sélections incluses dans une zone déjà chargée la réutilisent. Les requêtes simultanées identiques partagent le téléchargement ; au maximum deux requêtes Overpass sont exécutées en parallèle par instance. Aucune anticipation ni interrogation systématique n’est ajoutée. Le cache porte uniquement sur le réseau routier public OSM, jamais sur les fichiers GPX ou les notes des utilisateurs.
- Tolérance par défaut de 150 m, ajustable à 75 m (précis) ou 250 m (très souple). La marge de recherche OSM suit cette valeur. Un léger décalage GPS ou quelques ancres intermédiaires isolées peuvent être acceptés ; les extrémités doivent appartenir à une même composante du graphe. Aucun raccordement artificiel n’est ajouté entre des chemins déconnectés.
- Les modes souples peuvent écarter une ancre isolée, ou jusqu’à 15 % des ancres sur une trace plus longue, sans en ignorer plus de deux consécutives. Les grands détours restent rejetés. Un message indique le décalage maximal des ancres retenues et leur éventuelle mise à l’écart. Vérifier le tracé avant enregistrement, surtout à 250 m et près de chemins parallèles.

Mesure locale illustrative : sur une trace synthétique de 8,5 km dans une grille de 170 chemins, ancien calcul 372 ms, nouveau calcul 193 ms, nouvelle tentative avec graphe préparé 3 ms. Cela mesure le calcul sur cette machine, pas l’attente du service public Overpass, ni les performances sur un téléphone. Les premières requêtes réseau peuvent rester lentes ; les erreurs et réponses partielles ne sont pas mises en cache.
