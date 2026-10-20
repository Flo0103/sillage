# Sillage — carnet gravel

Application web statique en français. Depuis ce dossier :

```sh
python3 -m http.server 8080 --directory dist
```

Ouvrir http://localhost:8080 dans un navigateur connecté à Internet.

## Utilisation

1. Exporter une activité Strava en GPX puis l’importer.
2. Cliquer deux fois sur la trace pour choisir une portion.
3. Facultatif : « Accrocher à OSM » ; contrôler visuellement le résultat doré.
4. Donner un nom, une note sur cinq, une technicité, un revêtement et un commentaire.
5. Retrouver les portions dans « Mes portions » et les sauvegarder en GeoJSON.

Les données sont enregistrées dans le localStorage de ce navigateur et de cette origine. Elles ne sont pas synchronisées entre appareils. L’export GeoJSON est une sauvegarde utilisable dans un logiciel SIG ; son réimport dans cette version n’est pas implémenté.

## Carte et accrochage

Leaflet 1.9.4 est chargé depuis unpkg ; fond de carte OpenStreetMap avec attribution. L’accrochage envoie la zone géographique de la portion à l’API publique Overpass ; aucun compte ni jeton n’est requis. En cas de panne, la trace GPS est conservée. L’algorithme récupère les chemins OSM, relie leurs nœuds et calcule des plus courts chemins entre des ancres GPS espacées d’environ 120 mètres. Limite : 15 km par portion pour la requête OSM. Il rejette les graphes déconnectés, les ancres trop éloignées et les détours excessifs.

Cet accrochage est une approximation à vérifier, et non un moteur de navigation : il ne garantit pas les autorisations locales, les restrictions conditionnelles, le sens de circulation ou le bon choix de chemins parallèles. La trace initiale affichée est synthétique et identifiée comme démonstration. Les GPX à plusieurs segments utilisent le segment le plus long pour éviter de relier artificiellement des interruptions.

## Hébergement OVH

La configuration Docker Compose et Caddy est fournie pour un VPS OVH : [guide de déploiement](deploy/OVH.md). HTTPS est automatique une fois le domaine et le VPS configurés. Aucun achat ni déploiement de VPS n’a été effectué.

## État et validation

Connexion API Strava différée à la demande de l’utilisateur. Pas de serveur applicatif, de compte, ni de synchronisation. Vérification syntaxique JavaScript et tests du calcul de distance / des plus courts chemins réalisés. L’interface n’a pas encore été vérifiée dans un navigateur. La configuration Caddy/Compose doit être validée sur le VPS avec les commandes du guide avant lancement.
