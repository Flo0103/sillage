# Sillage v2 sur le VPS OVH

Sillage utilise désormais Caddy (HTTPS), un serveur Node.js et PostgreSQL 17. Les ports de l’application et de PostgreSQL ne sont pas exposés sur Internet. Chaque compte dispose de ses propres sorties et portions. Les inscriptions publiques sont fermées.

## Mise à jour depuis la version GPX locale

**Avant tout, conserver les anciennes notes** : elles sont dans le navigateur qui a servi à les créer. Si possible utiliser « Exporter » avant la mise à jour. Ne pas effacer les données de ce navigateur. Le transfert vers PostgreSQL sera proposé après connexion au même domaine avec ce même navigateur.

Dans le terminal connecté au VPS :

```sh
cd ~/sillage
GIT_SSH_COMMAND="ssh -i $HOME/.ssh/sillage_github -o IdentitiesOnly=yes" git pull --ff-only
bash deploy/configure.sh
sudo docker compose config --quiet
sudo docker compose build app
sudo docker compose up -d
sudo docker compose ps
```

`configure.sh` conserve le domaine, l’adresse email et un éventuel mot de passe PostgreSQL existant. Il génère un mot de passe PostgreSQL aléatoire dans `.env` s’il n’y en a pas. Ne pas partager ce fichier. Ne pas modifier ensuite ce mot de passe sans modifier aussi celui du rôle PostgreSQL.

Le démarrage attend que PostgreSQL puis l’application soient prêts. La première construction télécharge Node et le pilote PostgreSQL. En cas d’erreur, garder son message et consulter :

```sh
sudo docker compose logs --tail=80 app db web
```

### Créer le premier compte

Remplacer `flo` par l’identifiant souhaité :

```sh
sudo docker compose exec app node server/users.js flo
```

Saisir deux fois un mot de passe de 12 caractères minimum. La saisie est masquée. Il ne faut ni envoyer le mot de passe dans la conversation ni le passer dans une commande.

Ouvrir ensuite **https://sillage.gravelspa.be** et se connecter. Pour ajouter d’autres utilisateurs, relancer cette commande avec un autre identifiant. Pour changer un mot de passe oublié, utiliser l’identifiant existant : cela renouvelle son mot de passe et déconnecte ses sessions.

### Anciennes notes locales

Après connexion, cliquer sur « Transférer mes anciennes notes locales ». Confirmer que le compte connecté est bien celui auquel les notes doivent appartenir. L’import est relançable sans doublons et conserve les anciennes copies locales. Les GPX précédemment importés n’étaient pas conservés par la version v1 ; il faut les réimporter. Les exports GeoJSON v1 restent lisibles dans un logiciel SIG, mais leur réimport dans l’application n’est pas implémenté.

## Installation neuve

VPS Ubuntu/Debian avec Docker Engine et Compose, 2 Go de RAM minimum conseillé. Cloner ce dépôt privé avec une clé de déploiement GitHub en lecture seule. Configurer un enregistrement DNS A `sillage.gravelspa.be` vers l’IPv4 du VPS, et ouvrir TCP 80/443. Ne pas ajouter d’AAAA sans IPv6 fonctionnelle. Garder SSH accessible.

```sh
cd ~/sillage
cp .env.example .env
nano .env
bash deploy/configure.sh
sudo docker compose config --quiet
sudo docker compose up -d --build
sudo docker compose exec app node server/users.js flo
```

Configurer `SILLAGE_DOMAIN` (sans https://) et `ACME_EMAIL` avant lancement. Caddy crée et renouvelle les certificats. Les volumes Caddy existants sont réutilisés lors de la migration v1.

## Mises à jour suivantes

```sh
cd ~/sillage
sudo bash deploy/backup.sh
GIT_SSH_COMMAND="ssh -i $HOME/.ssh/sillage_github -o IdentitiesOnly=yes" git pull --ff-only
sudo docker compose config --quiet
sudo docker compose up -d --build --force-recreate
```

Vérifier l’interface et `sudo docker compose ps`. Les tables sont créées au démarrage sans suppression des données existantes. Cette v2 constitue la première version du schéma PostgreSQL.

## Sauvegarde et restauration

Les données des utilisateurs sont dans le volume `sillage_postgres_data`. **Ne pas utiliser `docker compose down -v`**, qui supprimerait les volumes. Le dossier `backups/` est ignoré par Git et par la construction Docker. Les sauvegardes contiennent des données personnelles et des hachages de mots de passe : conserver une copie protégée hors du VPS.

```sh
sudo bash deploy/backup.sh
```

Pour restaurer une sauvegarde choisie dans une base vide (opération d’administration, ne pas faire sur une base remplie sans plan de restauration) :

```sh
gunzip -c backups/NOM-DE-LA-SAUVEGARDE.sql.gz | sudo docker compose exec -T db psql -U sillage -d sillage
```

Conserver aussi `.env` et la configuration du VPS dans un emplacement sécurisé. Les certificats sont dans `caddy_data`. Programmer une sauvegarde régulière après avoir vérifié une première restauration sur une instance de test.

## Validation à faire après déploiement

1. La racine redirige vers la connexion quand on est déconnecté.
2. Créer deux comptes, enregistrer une portion avec le premier ; le second ne doit pas la voir.
3. Importer un GPX ; choisir deux points ; le résultat OSM orange doit rester au-dessus du GPX bleu.
4. Basculer en manuel et tracer plusieurs points, puis annuler le dernier.
5. Enregistrer sans nom avec « Grosses pierres / blocs » et un état hiver.
6. Recharger puis se reconnecter depuis un autre appareil : la portion doit être présente.
7. Basculer le fond de carte vers « Satellite · Esri ».
8. Importer les anciennes notes locales puis relancer l’import : aucun doublon.

Les tests Node vérifient la validation, les mots de passe, les géométries et le routage API avec un adaptateur mémoire. Ils ne remplacent pas la vérification sur un vrai PostgreSQL et dans un navigateur. L’environnement de développement ne permettait pas la construction Docker ni un test PostgreSQL complet.

## Correctif 2.1 : GPX originaux et affichage

Appliquer la procédure de mise à jour ci-dessus : sauvegarde, `git pull`, puis reconstruction avec `sudo docker compose up -d --build`. Les colonnes GPX sont ajoutées automatiquement au démarrage, sans suppression des sorties ni des comptes. Recharger la page après mise à jour. Aucun compte à recréer. Les anciennes sorties restent accessibles ; leur bouton GPX reconstruit la géométrie lorsque le fichier original n’a jamais été stocké. Les nouveaux imports conservent aussi le fichier d’origine complet (altitude, dates et autres extensions comprises).
