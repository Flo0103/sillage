# Sillage — atlas gravel

Application web en français pour retrouver ses sorties vélo, noter les chemins et préparer ses itinéraires. Hébergement sur VPS avec Docker Compose, Caddy, Node.js et PostgreSQL 17 / PostGIS 3.6.

## Ce que permet Sillage

- Importer ses GPX, conserver les originaux et rechercher ses sorties dans une bibliothèque paginée.
- Connecter Strava et parcourir progressivement son historique vélo / gravel.
- Dessiner et modifier des secteurs et des itinéraires, avec routage OSM, corrections manuelles, annuler / rétablir et export GPX.
- Consulter le relief, les revêtements, les restrictions d’accès et plusieurs fonds cartographiques.
- Sur mobile, utiliser les outils compacts en haut à droite, une bibliothèque repliée au démarrage et un profil de relief réduit.
- Gérer des comptes sur invitation, partager des dessins entre membres et exporter ses secteurs, itinéraires et sorties en GeoJSON (ZIP) ou GeoPackage (GPKG).

Les GPX et les données Strava restent privés. Les secteurs indépendants sont publics entre membres par défaut ; les itinéraires sont privés par défaut. Les données dérivées de Strava conservent leur provenance et leur confidentialité après suppression de la sortie source.

## Installation et exploitation

Le [guide OVH](deploy/OVH.md) décrit l’installation complète, le domaine HTTPS et la création du premier administrateur.

| Besoin | Documentation |
| --- | --- |
| Activation de Strava et des webhooks | [Connexion Strava](deploy/STRAVA.md) |
| Import et mise à jour du réseau OSM | [Routage](deploy/ROUTING.md) |
| Export vers Garmin / COROS | [Transfert GPS](deploy/GPS.md) |
| Confidentialité, PostGIS, services externes et limites | [Référence technique](docs/TECHNIQUE.md) |
| Problèmes repérés, priorités et plan de déploiement proposé | [Audit technique](docs/AUDIT.md) |
| Protections, limites et mise à jour de sécurité | [Sécurité](docs/SECURITE.md) |
| Évolutions des versions précédentes | [Historique](CHANGELOG.md) |
| Identité visuelle | [Guide graphique](design/IDENTITY.md) |

Pour une mise à jour existante, sauvegarder la base avant la reconstruction :

```sh
sudo bash deploy/backup.sh
sudo docker compose up -d --build --wait
sudo docker compose exec -T app node server/check-db.js
```

Le code doit avoir été récupéré et revu avant ces commandes. Voir les conditions et les contrôles du [lot proposé](docs/AUDIT.md#déploiement-proposé). Une ancienne installation sans PostGIS suit la procédure spécifique du guide OVH.

Les sauvegardes sont privées et ne portent leur nom final qu’après la réussite de `pg_dump` et du contrôle gzip. Elles restent sur le VPS : une copie hors du serveur et un essai de restauration restent nécessaires.

## Développement et validation

Node.js 22.13 minimum ou 24 (SQLite intégré pour les GeoPackages). Les tests utilisent des adaptateurs SQL / DOM simulés, un serveur HTTP local et les ressources Leaflet verrouillées ; ils ne nécessitent aucun accès aux services cartographiques.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm audit --audit-level=high
npm run bench:routing
```

Le test d’intégration nécessite le pilote `pg` et une **base PostgreSQL / PostGIS jetable**. Il modifie temporairement une contrainte pour reproduire une ancienne migration ; ne pas le lancer sur la production.

```sh
npm ci --ignore-scripts --no-audit --no-fund
# Définir PGHOST, PGPORT, PGUSER, PGDATABASE et PGPASSWORD pour la base de test.
npm run test:db
```

GitHub Actions est configuré pour exécuter les tests sous Node 22 et 24 et les migrations sur PostgreSQL 17 / PostGIS 3.6. La vérification sur navigateur réel, la connexion Strava réelle et les essais de restauration complètent ces contrôles.

## Organisation du code

- `dist/` : sources directement servies au navigateur, sans étape de compilation.
- `server/` : serveur HTTP, accès aux données, migrations, Strava et services de routage.
- `test/` : tests unitaires, adaptateurs simulés, benchmark et intégration PostGIS.
- `deploy/` : configuration Docker / Caddy, sauvegardes et exploitation du réseau OSM.
- `docs/` : référence technique et audit ; `CHANGELOG.md` conserve l’historique.

Le pilote PostgreSQL et Leaflet sont fixés à des versions précises. `package-lock.json` verrouille leurs dépendances et leur intégrité ; Docker et la CI utilisent `npm ci`. Leaflet est servi localement, avec sa licence et ses ressources, et comparé au paquet npm dans les tests. Le contrôle npm inclut Leaflet, même s’il n’est pas installé dans les images de production.


