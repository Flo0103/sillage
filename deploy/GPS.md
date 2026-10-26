# Itinéraires sur Garmin et COROS

## Disponible en 6.19.0

Après enregistrement, le bouton **Garmin / COROS** apparaît dans le panneau de l’itinéraire et dans la bibliothèque. Il ouvre une fiche de transfert avec deux destinations, les instructions d’import et le téléchargement du GPX.

Sur un navigateur compatible avec le partage de fichiers, le GPX est préparé à l’ouverture de la fiche. Le bouton **Partager le GPX** ouvre le menu natif : choisir Garmin Connect ou COROS si l’application installée y figure. Une annulation conserve la fiche, sans téléchargement forcé. L’application ne peut ni choisir la cible à la place de l’utilisateur, ni confirmer l’enregistrement du parcours ou sa synchronisation sur le GPS.

Sans partage de fichiers, télécharger le GPX puis l’ouvrir avec l’application mobile. Garmin Connect propose aussi un import sur ordinateur dans **Entraînement et planification → Parcours → Importer**. COROS permet d’enregistrer le fichier ouvert dans son application, puis de le synchroniser depuis sa bibliothèque vers un appareil compatible. Les libellés peuvent varier selon la langue et la version de l’application.

Le fichier vient de l’export authentifié existant `/api/plans/:id/gpx`. Il conserve le nom de l’itinéraire, les altitudes disponibles et le type vélo. Aucun lien public, compte partagé, jeton dans l’URL ou modification de visibilité n’est créé. L’auteur peut transférer son itinéraire privé ; un autre membre peut transférer un itinéraire public auquel il a accès. L’utilisateur choisit ensuite de transmettre le fichier à son application.

Sources officielles consultées le 26 octobre 2026 :

- [Garmin : importer un parcours externe](https://support.garmin.com/en-US/?faq=wKuZXCaZRP4mWPX5aRz5h5).
- [COROS : télécharger, importer et utiliser un itinéraire](https://support.coros.com/hc/en-us/articles/24181489692436-Downloading-and-Using-Routes).

## Synchronisation directe : accès à obtenir

Le bouton actuel effectue un transfert GPX assisté. Il n’établit aucune connexion de compte Garmin ou COROS et n’effectue aucun envoi automatique via leurs API.

### Garmin Connect Courses API

L’API Courses permet de publier un parcours dans le compte Garmin Connect autorisé par son propriétaire. Garmin Connect gère ensuite la synchronisation avec les appareils compatibles.

1. Consulter le [programme développeur Garmin Connect](https://developerportal.garmin.com/developer-programs/connect-developer-api) et la [présentation de Courses API](https://developer.garmin.com/gc-developer-program/enterprise/courses-api/).
2. Soumettre une [demande d’accès au programme](https://www.garmin.com/en-US/forms/StarterGarminConnectDeveloperAccess/) pour Sillage en précisant l’envoi de parcours vélo/gravel créés par les utilisateurs, et demander explicitement **Courses API**.
3. Après accord, obtenir la documentation, les conditions, les identifiants et les règles de validation applicables à cette application. L’acceptation et les délais ne sont pas garantis.

### COROS Partner API

Le programme Partner prévoit OAuth 2.0 multi-utilisateur et l’envoi de parcours GPX/KML. La documentation publique demande une plateforme établie et une société enregistrée avec un représentant technique ; il faut vérifier avec COROS si Sillage remplit ces conditions. L’accès MCP sans candidature n’inclut pas l’import/export d’itinéraires GPX et ne remplace donc pas cet accès.

1. Consulter les [conditions et fonctionnalités Partner API](https://support.coros.com/hc/en-us/articles/53181766856724-Partner-API-Access).
2. Suivre la [procédure de candidature COROS](https://support.coros.com/hc/en-us/articles/17085887816340-Submit-an-API-Application), remplir le formulaire indiqué et contacter `api@coros.com` avec les informations demandées.
3. Demander l’accès multi-utilisateur OAuth 2.0 et à **route/push**, pour les itinéraires GPX de Sillage. Obtenir la documentation partenaire et les identifiants après validation.

### Dossier à compléter pour chaque marque

Texte proposé, à adapter avec l’identité réelle de l’éditeur, son statut, le nombre d’utilisateurs et ses coordonnées. Ce document ne soumet aucune candidature et n’envoie aucun message.

> Sillage is a browser-based gravel route planner and route atlas, available at https://sillage.gravelspa.be. Users create and save their own cycling routes, with elevation profiles and GPX export. We would like to let each user authorize their own Garmin Connect / COROS account and explicitly send a saved route to their route library for synchronization with compatible devices. We are requesting course/route upload access. We do not need activity or health-data access for this feature. Please confirm eligibility, onboarding requirements, authentication details and access to the course/route API documentation.
>
> Publisher / legal entity: [complete]
> Technical contact: [complete]
> Current user base: [complete]
> Privacy policy and applicable terms: [complete]

Les URL de retour OAuth envisagées sont `https://sillage.gravelspa.be/api/garmin/callback` et `https://sillage.gravelspa.be/api/coros/callback`. **Ces routes ne sont pas encore implémentées.** Confirmer ces URL et les obligations du fournisseur lors de l’intégration avant une validation de production.

## Suite technique après accord

Prévoir la connexion et la déconnexion de chaque fournisseur dans Mon compte, les états OAuth liés à la session, le chiffrement des jetons par utilisateur, leur renouvellement et leur révocation. L’envoi partira d’un itinéraire enregistré et accessible à l’utilisateur connecté ; il faudra mémoriser l’identifiant distant et la révision envoyée pour éviter les doublons et permettre une mise à jour volontaire. Les quotas et les erreurs seront traités selon la documentation partenaire.

Cette partie reste à implémenter et à tester avec les API approuvées. Aucune variable Garmin/COROS fictive n’est à ajouter au `.env` pour la version actuelle, et aucun mot de passe Garmin/COROS n’est demandé par Sillage.

## Déploiement

Aucune migration ni nouvelle variable d’environnement. Mettre à jour et reconstruire l’application comme d’habitude ; la version doit afficher **6.19.0**. Recharger ensuite la page pour charger les scripts `v=6.19.0`.

Sur téléphone, tester avec Garmin Connect/COROS installés : choisir un itinéraire enregistré, ouvrir la fiche, partager ou télécharger, enregistrer le parcours dans l’application, puis le synchroniser sur un appareil compatible. La compatibilité du menu de partage et l’import effectif doivent être vérifiés sur les téléphones et GPS utilisés.
