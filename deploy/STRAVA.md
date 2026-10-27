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

Dans Sillage, ouvrez **Bibliothèque**, choisissez **Une sortie · GPX / Strava**, puis **Strava** et **Connecter mon compte Strava**. Le même lien est disponible dans **Mon compte**. Vous êtes redirigé vers la page officielle Strava pour vous connecter et autoriser Sillage. Le Client ID et le Client Secret sont configurés une seule fois sur le VPS ; les membres n’ont pas de clé à saisir.

Après autorisation, la liste Strava s’ouvre directement. La recherche par nom, les curseurs de distance et de dénivelé et le filtre de zone s’appliquent à cette liste. Dans les filtres, choisissez **Gravel** ou **Tous mes vélos / VTT**. Cliquez sur une vignette pour afficher la sortie sur la carte ; l’import n’est réalisé qu’à cette ouverture. Les résultats sont paginés par vingt.

Au premier accès, Sillage parcourt progressivement l’historique Strava, y compris les pages sans gravel, par lots de 200 activités. L’index de métadonnées est privé et conservé en PostgreSQL par utilisateur : revenir dans la bibliothèque ne recommence pas le chargement. Tant que l’historique n’est pas complet, la progression et le caractère partiel des résultats sont indiqués. **Mettre en pause** arrête après le lot en cours ; **Reprendre l’historique** continue au curseur enregistré, y compris après un quota Strava atteint. Quitter cette liste suspend aussi le chargement. Aucune limite de 300 activités n’est appliquée.

Les recherches lisent l’index en base et ne relancent pas le parcours de l’historique chez Strava. **Actualiser** vérifie les nouvelles activités ; cette vérification est aussi déclenchée lors d’un retour dans la liste après quinze minutes. Le quota de l’application Strava peut interrompre le premier chargement d’un historique très long ; le bouton de reprise reste disponible. Les aperçus de la liste viennent des polylignes résumées ; les traces complètes restent importées à la demande.

Autorisez la lecture des activités, y compris privées, pour obtenir la trace complète. Aucune permission d’écriture n’est demandée. Le filtre initial est `GravelRide` ; élargissez aux vélos / VTT pour une sortie classée autrement dans Strava. Le sélecteur séparé de **Mon compte** reste disponible.

Choisir une activité importe ses coordonnées GPS dans son compte Sillage et ouvre cette trace sur la carte. Une activité déjà importée n’est pas dupliquée. L’API fournit les coordonnées, pas le fichier GPX original : le téléchargement GPX correspondant est une reconstruction des coordonnées, sans altitude ni horodatage.

## Confidentialité et révocation

L’accord API Strava limite l’affichage de ces données à l’athlète qui les a fournies : https://www.strava.com/legal/api . Les sorties importées via l’API **et les portions créées à partir de ces sorties** restent privées. La publication est bloquée côté serveur et dans l’interface ; les autres GPX et les portions personnelles non issues de l’API conservent leur fonctionnement habituel.

Les jetons sont chiffrés avec AES-256-GCM, liés à l’utilisateur, et renouvelés côté serveur. Ils ne sont jamais envoyés au navigateur. L’état OAuth est à usage unique et lié à la session d’origine et à un cookie nonce dédié, compatible avec la redirection externe tout en conservant le cookie principal SameSite=Strict.

« Déconnecter et supprimer mes imports Strava » retire les connexions, l’index de recherche, les sorties et les dessins issus de Strava de ce compte. Les autres GPX sont conservés. Les webhooks retirent également les données lors d’une révocation côté Strava ou de la suppression d’une activité. Une réponse Strava 401 lors d’une consultation provoque aussi cette suppression locale. Les sauvegardes privées ont leur propre cycle de rétention et doivent être gérées en conséquence.

La connexion réelle doit être testée avec votre application et vos autorisations après configuration. Les tests automatisés utilisent des réponses Strava simulées.

## Dessin OSM avec une sortie Strava comme repère privé

Le bouton « Créer un nouveau segment indépendant » conserve l’affichage privé de la sortie et remet le formulaire à zéro. Les points du nouveau segment sont posés par le membre sur la carte ; le suivi GPX est désactivé. Le segment enregistré utilise uniquement ces points, le résultat du routage OSM et les attributs saisis, sans nom, identifiant ou lien vers l’activité Strava. Cette séparation technique ne permet pas d’affirmer que Strava exempte le redessin visuel de ses restrictions : ce cas n’est pas explicitement confirmé dans ses textes. Les imports et segments réellement issus du suivi GPX Strava restent privés.
