# Sillage — Atlas de terrain

Une identité construite autour du gravel : un vélo, le chemin parcouru et ses points de repère. L’interface reste un outil de cartographie. Le dessin donne du caractère aux marges, aux aperçus et aux pages de compte, sans recouvrir les données de la carte.

## Signature et dessin

Le signe associe deux roues circulaires, un guidon gravel et un cadre dessiné comme un chemin sinueux. Les roues sont légèrement agrandies (rayon 16 sur une grille de 100). Deux bornes ouvertes marquent les virages du cadre, avec une réserve transparente au centre pour rester lisibles sur tous les fonds. Les roues reprennent les deux bornes des pictogrammes de secteur et d’itinéraire. Le dessin reste ouvert et sans détail décoratif. Sa version couleur associe olive et terre cuite ; la version monochrome conserve exactement les mêmes formes. Dans le bandeau sombre, le trait prend la couleur crème du texte et la roue avant un accent argile clair. L’icône d’application reprend ce dessin sur un carré olive aux angles adoucis. La signature en minuscules utilise des contours issus de Bricolage Grotesque, avec un espacement ajusté, conservés en SVG pour rester nets et identiques au chargement. Ne pas étirer la signature, ajouter d’ombre au signe ou recolorer les lettres avec les palettes de données.

La planche de relief est un dessin vectoriel original d’un terrain fictif : lignes de niveau, croix de calage, chemin et bornes. Elle accompagne la connexion et la marge du carnet. Elle n’est ni une carte réelle ni une donnée de navigation. Les coins de calage des aperçus, les numéros de chapitre et les filets prolongent ce langage.

Un **secteur gravel** désigne un bout de chemin noté ; un **itinéraire** est un parcours complet. L’onglet « Sorties & secteurs » réunit les traces importées et les secteurs. La signature éditoriale est « Le carnet du gravel ». Les noms des API et des données historiques restent compatibles.

Les pictogrammes sont des dessins SVG sans police d’icônes. Le secteur est un trait court entre deux cercles ouverts. L’itinéraire relie les mêmes bornes par un chemin sinueux. Cette famille se retrouve dans les onglets et les outils de création. Leur trait de 1,6 px, leurs terminaisons arrondies et leurs formats de 18 à 22 px restent cohérents. Éviter les émojis dans les commandes et les symboles typographiques à la place de dessins.

## Typographie

- **Hanken Grotesk, 400–700** : lecture, commandes, formulaires. Une interface lisible en 13–14 px, avec des champs à 16 px sur téléphone.
- **Bricolage Grotesque, 500–800** : titres, noms de parcours et grandes valeurs. Casse naturelle, espacement légèrement resserré, sans capitales condensées.
- **IBM Plex Mono, 500** : graduations, unités, petits index et repères. Cette police accompagne les données ; elle ne remplace pas les textes longs ni les formulaires.

Les trois fichiers WOFF2 latins sont servis par Sillage, sans requête à Google Fonts. Les accents français et les polices système de secours sont conservés. Les licences SIL Open Font License se trouvent dans `dist/fonts`.

## Couleurs

| Usage | Couleur |
| --- | --- |
| Encre / texte | `#2f382b` |
| Pin / bandeau | `#2f3e2d` |
| Olive / action | `#48583b` |
| Sauge / repères | `#75815b` |
| Papier | `#fbf9f1` |
| Toile / marge | `#eeeade` |
| Sable / signe et import | `#e2d2b7` |
| Argile / accent | `#a96747` |

Les couleurs de plaisir, technicité, altitude, pente et surface gardent leur signification propre. Les single tracks et les surfaces non asphaltées conservent leurs pointillés. Un accent de marque ne doit pas changer le sens d’une légende.

## Composition et états

Une ligne de laiton sépare le bandeau du terrain. La bibliothèque est une marge de carnet avec registre et repères. L’éditeur ressemble à une page claire, avec index, sections séparées et valeurs lisibles. Les aperçus de carte vont jusqu’aux bords de leur cadre ; le profil miniature est placé dessous. Les surfaces détaillées utilisent des filets proportionnels à leur part connue, avec pourcentage et distance en texte.

Le profil d’altitude garde les données et les échelles existantes. Les graduations utilisent Plex Mono ; les extrema portent de petites étiquettes et le curseur suit le parcours. Le remplissage coloré reste translucide.

Les panneaux défilent indépendamment sur ordinateur. Sur téléphone, l’éditeur passe sous la carte. Conserver les états de focus visibles, noms accessibles des pictogrammes, commandes clavier, messages d’erreur, contrastes de lecture et préférences de mouvement réduit.

## Fichiers et maintenance

`dist/style.css` contient les fondations, composants, états et adaptations mobiles dans un seul ordre. Les actifs graphiques et les polices portent un suffixe de version et un cache immuable : changer leur nom lors d’une prochaine modification. Les nouveaux fichiers sont `sillage-logo-v3.svg`, `sillage-logo-mono-v3.svg`, `sillage-mark-v3.svg` / `.png`, `sillage-sector-v1.svg` et `sillage-itinerary-v1.svg`. Les actifs `v1` anciens restent servis pour les pages en cache, sans être utilisés comme nouveau logo. Les fichiers autorisés avant connexion sont listés explicitement dans `server/app.js` ; ne pas transformer cette liste en accès général à un répertoire.
