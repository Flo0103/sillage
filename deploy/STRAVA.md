# Activer Strava dans Sillage

La connexion est facultative : tant que la configuration est absente, l’import GPX et toutes les autres fonctionnalités restent disponibles.

## 1. Créer l’application Strava

Ouvrir https://www.strava.com/settings/api et enregistrer une application Sillage.

- Site web : `https://sillage.gravelspa.be`
- Authorization Callback Domain : `sillage.gravelspa.be` (sans protocole ni chemin)
- Callback utilisé par Sillage : `https://sillage.gravelspa.be/api/strava/callback`

La capacité autorisée de l’application et une éventuelle validation par Strava peuvent limiter les comptes qui pourront se connecter. Documentation OAuth officielle : https://developers.strava.com/docs/authentication/ .

## 2. Renseigner les identifiants sur le VPS

Après la mise à jour vers PostGIS, éditer **le fichier existant**, sans écraser ses autres valeurs :

```sh
cd ~/sillage
nano .env
```

Ajouter ou compléter :

```ini
STRAVA_CLIENT_ID=VOTRE_CLIENT_ID
STRAVA_CLIENT_SECRET=VOTRE_CLIENT_SECRET
```

Conserver `POSTGRES_PASSWORD`, `STRAVA_TOKEN_KEY` et `STRAVA_WEBHOOK_SECRET`. Ces dernières clés sont générées une seule fois par `deploy/configure.sh`, puis conservées. Ne pas partager le fichier `.env` ni le Client Secret dans une conversation ou dans GitHub.

```sh
sudo bash deploy/configure.sh
sudo docker compose up -d app
sudo docker compose exec app node server/strava-subscribe.js
```

La dernière commande abonne Strava aux événements de révocation et de suppression d’activité. Elle exige que Sillage soit accessible en HTTPS. Elle conserve un abonnement identique déjà présent et refuse de remplacer automatiquement un abonnement appartenant à une autre configuration. Aucun secret n’est affiché par le script.

## 3. Se connecter et choisir une sortie

Dans Sillage → « Mes sorties » → menu « Retrouver une sortie » → « Mes sorties Strava » → « Connecter mon compte Strava ». Le même bouton reste accessible dans « Mon compte ». Le bouton ouvre la page officielle de connexion et d’autorisation Strava : utilisez vos identifiants habituels chez Strava. Sillage ne demande jamais votre mot de passe Strava. La configuration Client ID / Client Secret est réalisée une seule fois pour l’application sur le VPS, pas par chaque membre.

Après autorisation, le panneau « Mes sorties Strava » s’ouvre directement. Choisissez Gravel ou toutes les sorties vélo / VTT, puis une sortie dans le menu déroulant pour voir son aperçu ; « Ouvrir cette sortie » importe la trace dans la bibliothèque et l’affiche sur la carte. Les sorties plus anciennes se chargent à la demande. Le sélecteur séparé dans « Mon compte » reste disponible.

Autoriser la lecture des activités, y compris privées, pour obtenir la trace complète. Aucune permission d’écriture n’est demandée. Le filtre initial est `GravelRide` ; « Toutes mes sorties vélo » permet de retrouver une sortie enregistrée comme vélo ou VTT. Les pages suivent l’historique Strava, avec un bouton pour chercher plus loin : une page sans gravel ne signifie pas nécessairement qu’il n’y en a aucune dans l’historique.

Choisir une activité importe ses coordonnées GPS dans son compte Sillage et ouvre cette trace sur la carte. Une activité déjà importée n’est pas dupliquée. L’API fournit les coordonnées, pas le fichier GPX original : le téléchargement GPX correspondant est une reconstruction des coordonnées, sans altitude ni horodatage.

## Confidentialité et révocation

L’accord API Strava limite l’affichage de ces données à l’athlète qui les a fournies : https://www.strava.com/legal/api . Les sorties importées via l’API **et les portions créées à partir de ces sorties** restent privées. La publication est bloquée côté serveur et dans l’interface ; les autres GPX et les portions personnelles non issues de l’API conservent leur fonctionnement habituel.

Les jetons sont chiffrés avec AES-256-GCM, liés à l’utilisateur, et renouvelés côté serveur. Ils ne sont jamais envoyés au navigateur. L’état OAuth est à usage unique et lié à la session d’origine et à un cookie nonce dédié, compatible avec la redirection externe tout en conservant le cookie principal SameSite=Strict.

« Déconnecter et supprimer mes imports Strava » retire les connexions, sorties et portions issues de Strava de ce compte. Les autres GPX sont conservés. Les webhooks retirent également les données lors d’une révocation côté Strava ou de la suppression d’une activité. Une réponse Strava 401 lors d’une consultation provoque aussi cette suppression locale. Les sauvegardes privées ont leur propre cycle de rétention et doivent être gérées en conséquence.

La connexion réelle doit être testée avec votre application et vos autorisations après configuration. Les tests automatisés utilisent des réponses Strava simulées.
