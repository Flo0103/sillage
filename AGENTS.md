# Instructions pour les agents de code

Ce fichier est la source unique des consignes pour tous les agents qui travaillent sur Sillage : Codex le lit directement, Claude Code l’importe depuis `CLAUDE.md`. Modifier les règles ici, jamais en double ailleurs.

## Projet

Sillage est une application web en français pour retrouver ses sorties vélo, noter les chemins et préparer des itinéraires gravel. Node.js sans framework ni étape de compilation, PostgreSQL 17 / PostGIS 3.6, Leaflet, déploiement Docker Compose + Caddy sur un VPS unique. Voir le [README](README.md) pour le détail.

- `dist/` : fichiers servis tels quels au navigateur (aucun build).
- `server/` : serveur HTTP, données, migrations, Strava, routage OSM.
- `test/` : tests `node:test`, adaptateurs SQL / DOM simulés, benchmark, intégration PostGIS.
- `deploy/` : Docker, Caddy, sauvegardes, import OSM. `docs/` : référence technique, audit, sécurité.

## Commandes

```sh
npm ci --ignore-scripts --no-audit --no-fund   # Node 22.13 minimum ou 24
npm test                                        # obligatoire avant toute PR, sans service externe
npm audit --audit-level=high
```

`npm run test:db` exige une base PostgreSQL / PostGIS **jetable** (variables `PG*`) : ne jamais le lancer contre la production. `npm run bench:routing` mesure le routage.

### Base et serveur de test dans l’environnement cloud Codex

Si le dossier `/workspace/.sillage-cloud` existe, le script d’installation de l’environnement y a préparé une base PostGIS jetable (même image que la CI) et un test de bout en bout. Rien n’est démarré d’avance : lancer ces commandes dans la tâche, en plus de `npm test`, dès qu’elle touche `server/`, les migrations, l’authentification, la confidentialité ou les exports.

```sh
source /workspace/.sillage-cloud/dev.env
bash /workspace/.sillage-cloud/start-db.sh                # démarre la base locale
npm run test:db                                           # migrations, géométries, confidentialité Strava
node server/check-db.js                                   # schéma, comme en production
node server/index.js > /tmp/sillage.log 2>&1 &            # serveur local (migrations au démarrage)
for i in $(seq 30); do curl -fs "$APP_ORIGIN/healthz" >/dev/null && break; sleep 1; done
node /workspace/.sillage-cloud/smoke.mjs                  # connexion, sortie créée / lue / GPX / supprimée, déconnexion
kill %1
```

Indiquer le résultat dans la PR. Si le dossier n’existe pas (Claude Code, poste local), ces contrôles sont faits par la CI « Validation » sur la PR.

## Règles de code

- Diff minimal. Respecter le style compact existant ; ne jamais reformater un fichier entier ni lancer de formateur global : cela crée des conflits avec le travail des autres agents.
- Aucune nouvelle dépendance npm sans demande explicite. Leaflet est servi depuis `dist/vendor/leaflet-1.9.4/` et vérifié contre le paquet verrouillé : ne pas modifier ce dossier.
- Interface, messages d’erreur et documentation en français, avec l’apostrophe typographique ’.
- Confidentialité : les GPX et les données issues de Strava restent privés, contrôle appliqué côté serveur (voir `docs/TECHNIQUE.md`). Tout changement de visibilité ou d’export est accompagné de tests.
- Ajouter ou adapter les tests dans `test/`. Un nouveau fichier de test doit être ajouté au script `test` de `package.json`.
- Ne jamais lire, créer ni committer de `.env` ou de secret.

## Travail en parallèle (Codex et Claude Code)

Plusieurs agents peuvent travailler en même temps. Pour éviter qu’ils se marchent dessus :

1. **Une tâche = une branche = une PR.** Ne jamais committer ni pousser sur `main`.
2. **Préfixe par agent** : `codex/<sujet>` pour Codex, `claude/<sujet>` pour Claude Code. Ne pas modifier la branche d’un autre agent sans demande explicite.
3. **Partir de `main` à jour** : `git fetch origin` puis créer la branche depuis `origin/main`.
4. **En local, un dossier par agent** avec `git worktree`, jamais deux agents dans le même dossier :
   ```sh
   git worktree add ../sillage-claude -b claude/<sujet> origin/main
   git worktree add ../sillage-codex  -b codex/<sujet>  origin/main
   ```
5. **Avant d’ouvrir ou de mettre à jour une PR** : `git fetch origin && git rebase origin/main`, puis `npm test`.
6. **Signaler les chevauchements** : si une autre PR ouverte modifie les mêmes fichiers (souvent `dist/app.js`, `dist/style.css`, `server/app.js`), le dire dans la description de la PR.

### Version et historique : uniquement à la publication

Le numéro de version figure dans `package.json`, `package-lock.json`, `CHANGELOG.md` et les paramètres `?v=` de `dist/`. Deux branches qui le changent entrent forcément en conflit. Donc, dans une branche de tâche :

- **ne pas** changer la version, les `?v=`, `package-lock.json` (hors ajout de dépendance demandé) ni `CHANGELOG.md` ;
- **rédiger** à la place une section « Notes de version » dans la description de la PR, dans le style du `CHANGELOG.md` : ce qui change, puis « Validation : … » et les migrations ou configurations nécessaires (ou « Aucune migration ni configuration supplémentaire »).

La publication se fait ensuite sur `main`, une seule à la fois, après la fusion d’une ou plusieurs PR, sur une branche `release/<version>` ou par le mainteneur :

1. Choisir la version (`6.26.x` pour une correction, `6.x.0` pour une fonctionnalité) et la mettre dans `package.json` et `package-lock.json` (deux occurrences).
2. Ajouter en tête de `CHANGELOG.md` une section `## <Titre> (<version>)` qui reprend les notes de version des PR fusionnées.
3. Mettre `?v=<version>` sur chaque référence à un fichier de `dist/` modifié depuis la version précédente. Le fichier qui contient une référence modifiée est lui-même modifié : propager jusqu’aux pages HTML.
4. `npm test`, puis commit `<Résumé> (<version>)`.

## Pull requests

- Titre en français, sans numéro de version.
- Description : résumé, notes de version, validation effectuée (commandes et résultat), migrations / configuration / impact Strava ou confidentialité.
- La CI « Validation » (Node 22 et 24, migrations PostGIS) doit passer avant la fusion.

## Interdit sans demande explicite

Pousser sur `main`, fusionner une PR, forcer la mise à jour (`push --force`) d’une branche partagée, déployer, modifier les fichiers `deploy/` liés à la production, toucher à la base de production.
