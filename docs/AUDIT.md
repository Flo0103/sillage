# Audit technique et proposition de déploiement

État historique de l'audit initial. Les renforcements suivants (limites de requêtes, connexion, Leaflet local, CSP et dépendances verrouillées) et leur procédure de mise à jour sont décrits dans [Sécurité](SECURITE.md).

Audit du 27 octobre 2026 sur `Flo0103/sillage`, base `7732126c49353b2b1780fc3396caf262fc588f21` (6.26.2). Examen du code, de la configuration et des tests ; aucun accès aux données ou aux mesures du VPS de production.

## Priorités

P1 : confidentialité ou fiabilité à traiter en premier. P2 : performance et maintenance à planifier après mesure. Les corrections ci-dessous sont préparées sur une branche de revue, sans déploiement en production.

| Priorité | Constat et conséquence | État / action proposée |
| --- | --- | --- |
| P1 | Un import Strava télécharge les données puis les insère sans revérifier la connexion. Une déconnexion ou une révocation pendant le téléchargement peut être suivie d’une réinsertion. | Corrigé : révision de connexion, vérification et insertion sous le même verrou que la purge. Une réponse périmée renvoie 409. |
| P1 | Le callback OAuth consomme l’état et vérifie la session avant l’appel réseau, puis enregistre inconditionnellement la connexion. Une déconnexion pendant cet appel n’annule pas l’enregistrement. | Corrigé : état à usage unique et session revérifiés après l’échange, sous verrou, avant l’écriture. |
| P1 | Une erreur 401 reçue par une ancienne requête purge les données du compte même si sa connexion Strava a été remplacée. | Corrigé : la purge automatique vérifie la révision qui a produit la requête. |
| P1 | Remplacer l’athlète Strava met à jour les jetons, sans retirer immédiatement les données de l’ancien athlète. | Corrigé : purge des données Strava de l’ancien athlète et enregistrement de la nouvelle connexion dans une même transaction. Les GPX indépendants sont conservés. |
| P1 | Aucun workflow GitHub Actions n’était présent. Les migrations étaient surtout couvertes par des adaptateurs SQL simulés. | Ajout de tests Node 22 / 24 et d’un test sur PostgreSQL 17 / PostGIS 3.6 : migrations répétées, ancienne cascade, géométries et import invalidé. Les trois contrôles ont réussi dans GitHub Actions. |
| P1 | `backup.sh` écrivait directement le fichier final, identifié à la seconde. Un échec laissait une archive partielle portant un nom normal ; deux lancements rapprochés pouvaient écraser la même archive. Le script avait déjà `pipefail`. | Corrigé : nom unique, fichier temporaire, suppression sur erreur, contrôle gzip et renommage final. Les essais de restauration et la copie hors VPS restent à organiser. |
| P1 | Aucun `package-lock.json`. Les deux Dockerfile utilisent `npm install`, donc les dépendances transitives peuvent varier entre deux constructions. | À terminer avec un accès npm fonctionnel : générer et valider le lockfile, le copier dans les deux images, passer à `npm ci --omit=dev --ignore-scripts`, puis utiliser `npm ci` en CI. Aucun lockfile fabriqué manuellement. |
| P2 | `/api/plans` et `/api/catalog` renvoient les JSON complets, géométries comprises. `/api/rides` charge toutes les métadonnées ; l’overlay parcourt toutes les sorties du compte. La pagination de l’interface ne borne pas ces lectures. | Introduire une pagination serveur, des réponses de résumé et des détails à la demande. Conserver les contrôles de propriétaire / visibilité et mesurer sur une grande bibliothèque. |
| P2 | Les modules et le CSS sont servis avec `no-store`, même lorsqu’ils portent une version. | Étudier une empreinte de contenu et une revalidation privée des ressources authentifiées. Garder les réponses personnelles hors du cache public. Mesurer les octets et les temps de chargement avant de changer la politique. |
| P2 | `dist/app.js` et les tests frontaux concentrent beaucoup de comportements dans de longues lignes. `dist/` contient les sources effectivement exécutées, malgré son nom habituel de dossier généré. | Extraire progressivement contrôles de carte, état d’édition et orchestration de bibliothèque, en gardant les tests existants. Documenter puis automatiser le formatage dans une modification séparée pour faciliter la revue. |
| P2 | Le rendu est principalement testé avec DOM et Leaflet simulés. Leaflet reste téléchargé depuis un CDN externe. | Ajouter des parcours navigateur réels sur ordinateur et téléphone : connexion, dessin, plein écran, annulation, sauvegarde et téléchargement GPX. Prévoir l’auto-hébergement de Leaflet ou une intégrité SRI validée. |
| P2 | Aucune politique n’interdisait l’affichage de l’application dans une iframe. | Corrigé : `X-Frame-Options: DENY` et CSP `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, sans modifier les accès aux cartes. |
| P2 | Le pool PostgreSQL n’a pas de délai de connexion explicite ni de gestionnaire d’erreur de client inactif. Les limites de requêtes et de charge doivent être évaluées avec les imports et le routage. | Prévoir un traitement des erreurs du pool, des délais adaptés à chaque opération et des mesures de saturation. Éviter un délai SQL global trop court pour les migrations et les imports nationaux. |
| P3 | Le README mélangeait présentation, détails techniques et plus de trente notes de versions, dont plusieurs descriptions périmées. | Corrigé : point d’entrée court, référence technique dédiée, historique conservé dans `CHANGELOG.md`, descriptions des polices et de l’index Strava actualisées. |

## Détails des corrections Strava

Une colonne additive `strava_connections.revision`, de type UUID et non nullable, est créée au démarrage. Une reconnexion et un événement de suppression d’activité renouvellent cette révision. Un simple renouvellement des jetons OAuth la conserve.

L’import télécharge les métadonnées et la trace sans garder de transaction ouverte. Pour écrire, il prend le verrou de provenance du compte, compare l’athlète et la révision, puis insère la sortie dans la même transaction. La purge utilise le même verrou. La suppression d’une activité invalide aussi les imports simultanés d’autres activités du compte : ces imports doivent être relancés ; aucun tracé partiel n’est enregistré.

Le callback vérifie l’état et la session avant l’échange, puis les vérifie de nouveau lors de l’écriture. Une déconnexion efface les états OAuth en attente. Le changement d’athlète retire les anciens imports, dessins dérivés et métadonnées Strava dans la transaction de remplacement ; les données GPX indépendantes restent distinctes.

## Validation

- Avant correction : 377 tests réussis, zéro échec, un contrôle systemd ignoré pour la restriction `SO_PASSCRED` de l’environnement.
- Les nouveaux tests appliqués au code initial reproduisent quatre échecs : import après déconnexion, callback après déconnexion, 401 tardif et absence de purge au changement d’athlète.
- Après correction : 385 tests réussis, zéro échec, le même contrôle systemd ignoré. Les cas de concurrence utilisent des réponses réseau suspendues, sans appel réel à Strava.
- Syntaxe des 73 fichiers JavaScript et des scripts shell vérifiée. Les tests de sauvegarde exécutent le vrai script et gzip avec une commande Docker simulée.
- Les trois contrôles [GitHub Actions](https://github.com/Flo0103/sillage/actions/runs/40564849382) ont réussi sur le commit applicatif `715a8380cae0e3c662513a81fda8bd8f8453029b` : Node 22, Node 24 et PostgreSQL 17 / PostGIS 3.6. Le test natif valide les migrations avec des données puis le script de production contrôle le schéma après nettoyage. Il n’a pas été exécuté localement : le socket Docker n’est pas accessible et l’installation npm n’a pas abouti dans cet environnement.
- L’application réellement déployée, les quotas Strava, la restauration d’une archive et les gestes tactiles ne sont pas validés par ces contrôles locaux.

Repère de performance local, sans changement du moteur : sur la grille synthétique de 14 000 nœuds, 80 couples différents donnent environ 254 ms à froid, 1,05 ms de médiane à chaud et 6,66 ms au 95e percentile. Ces chiffres excluent HTTP, PostgreSQL, les téléchargements et l’affichage ; ils ne mesurent pas l’expérience sur le VPS. Ils justifient de mesurer les lectures et les transferts de bibliothèques avant de réécrire le moteur de routage.

## Déploiement proposé

### Lot 1 : confidentialité et exploitation

Promouvoir les corrections Strava, les sauvegardes atomiques, les en-têtes de sécurité et la documentation après revue et réussite des contrôles CI, en particulier du test PostGIS natif. Finaliser le verrouillage des dépendances avant de figer l’image à promouvoir.

1. Tester d’abord sur une préproduction avec une base isolée. Vérifier que la colonne de révision est créée et que le contrôle `server/check-db.js` réussit.
2. Réaliser une sauvegarde privée et en conserver une copie hors du VPS. Vérifier sa restauration sur une base séparée, ainsi que la disponibilité de la clé de chiffrement Strava pour la reprise.
3. Construire l’image, conserver l’identifiant de l’image précédente et celui de la nouvelle, puis basculer pendant une courte fenêtre de maintenance. Ne pas lancer l’ancien et le nouveau code applicatif simultanément pendant la migration de ce correctif.
4. Contrôler la connexion, un import GPX, un import Strava, la déconnexion, le téléchargement et les droits d’un autre membre. Avec un compte de test, vérifier la déconnexion pendant un import et la suppression d’activité. Ne pas changer d’athlète sur un compte réel pour ce contrôle : cette action purge ses anciennes données Strava.
5. Surveiller les journaux et les réponses 409 / 5xx après la bascule.

Après récupération du commit revu, les commandes habituelles sur le VPS sont :

```sh
sudo bash deploy/backup.sh
sudo docker compose build app
sudo docker compose up -d --wait
sudo docker compose exec -T app node server/check-db.js
sudo docker compose ps
```

La migration ajoute une colonne ; aucun réimport OSM et aucune nouvelle clé ne sont nécessaires. Elle ne supprime pas les connexions existantes. La suppression des anciennes données Strava intervient uniquement lors d’un changement effectif d’athlète ou d’une révocation / déconnexion.

Un retour à l’image précédente peut ignorer la nouvelle colonne, mais réintroduit les défauts corrigés. Il ne restaure pas les données volontairement purgées lors d’un changement d’athlète. Une restauration de base constitue une opération distincte, à décider après diagnostic.

### Lot 2 : performance et maintenabilité

Mesurer les temps et tailles de réponses des bibliothèques, le temps SQL, la mémoire et le routage sur des jeux de données représentatifs. Introduire ensuite pagination serveur et chargement des détails, puis séparer les gros modules. Définir des budgets de performance à partir de ces mesures, sans annoncer un gain non mesuré.

### Lot 3 : confiance avant publication

Ajouter les parcours navigateur réels, tester régulièrement la restauration, surveiller la disponibilité depuis l’extérieur du VPS et verrouiller les versions des actions / images avec un processus de mise à jour. Activer la protection de branche et les contrôles requis une fois la CI confirmée.

