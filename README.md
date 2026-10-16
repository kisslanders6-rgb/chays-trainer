# Chays Trainer

Entraîneur d'échecs en français, sans dépendance ni étape de compilation : un répertoire d'ouvertures appris par répétition espacée, et des finales théoriques jugées coup par coup.

- **Jouer** : vous jouez vos coups et ceux de l'adversaire. Dans une position inconnue, votre coup devient l'unique réponse enregistrée. Ensuite, il faut la retrouver.
- **Entraînement** : les positions fragiles, oubliées ou dont la révision est due reviennent en priorité. L'échiquier rejoue les trois coups précédents pour remettre la position en contexte.
- **Statistiques** : taux d'erreur par position, activité sur 30 jours, série de jours, révisions dues.
- **Finales** : mats élémentaires, finales de pions (vérifiées par une base exacte roi + pion contre roi) et défense de Philidor.
- Import et export **PGN** et **JSON**, corbeille de 30 jours, flèches et cercles au clic droit, analyse de la position sur Lichess, mode hors ligne (PWA), synchronisation facultative entre appareils (Supabase).

## Lancer l'application

Ouvrez simplement `index.html` dans un navigateur. Pour le mode hors ligne (service worker), servez le dossier en HTTP :

```bash
python3 -m http.server 8080
```

puis ouvrez <http://localhost:8080>. La commande `npm start` fait la même chose.

## Structure

```
index.html            page unique ; l'ordre des <script> compte (dépendances)
style.css             styles de l'application
css/account.css       fenêtre « Compte »
sw.js                 service worker : cache construit à partir d'index.html
js/
  app.js              navigation, thème, paramètres, répertoires, fenêtres de saisie
  storage.js          répertoires, bases d'ouvertures, répétition espacée, journal d'activité, import/export JSON
  core/               briques communes : utils (échappement HTML, actions data-action), stockage,
                      synchronisation (syncModel, cloudAdapter, cloudClient, auth, syncEngine, accountUI),
                      moteur d'échecs, pièces, icônes, sons, corbeille, sauvegarde, mobile
  modules/openings/   mode Jouer : logique, échiquier, flèches, arbre, panneau Base, PGN
  modules/training/   entraînement
  modules/stats/      statistiques
  modules/endgame/    finales : noyau (egCore), catalogue (egExercises), séance (endgame)
supabase/schema.sql   table et règles d'accès pour la synchronisation
tests/                tests Node (aucun réseau : serveur Supabase simulé)
scripts/              outils de maintenance
```

Les données restent dans le navigateur (`localStorage`). Toutes les lectures et écritures passent par `dataStore` (`js/core/storageAdapter.js`).

## Synchronisation (facultative)

1. Créez un projet Supabase, puis exécutez `supabase/schema.sql` dans l'éditeur SQL.
2. Renseignez `url` et `anonKey` dans `js/core/cloudConfig.js`. Cette clé est publique : la sécurité repose sur les règles RLS du schéma. N'y mettez jamais la clé `service_role`.
3. Pour vérifier la connexion, ouvrez `tests/cloud-smoke.html` (servi en HTTP).

Sans configuration, le bouton « Compte » n'apparaît pas et l'application fonctionne entièrement en local.

## Tests

```bash
npm install
npm test
```

Les tests couvrent les règles de fusion de la synchronisation, le client Supabase, l'authentification, le moteur de synchronisation et la fenêtre de compte (avec jsdom). Ils tournent aussi à chaque push (GitHub Actions, `.github/workflows/tests.yml`).

## Maintenance

- **Images** : si vous remplacez une image existante (pièces, textures, logos), incrémentez `VERSION` dans `sw.js` pour que le cache se mette à jour. Le code (HTML, JS, CSS) est toujours rechargé depuis le réseau quand c'est possible.
- **Logos** : après avoir modifié un logo teinté, lancez `sh scripts/build-logo-data.sh`. Ce script régénère la copie embarquée utilisée quand `index.html` est ouvert directement depuis le disque.
- **Nouveau script** : ajoutez-le dans `index.html`. Le service worker le mettra en cache automatiquement.

## Crédits

Jeux de pièces issus du projet open source Lichess. Auteurs et licences : `assets/pieces/CREDITS.md`. Icônes inspirées de Lucide (licence ISC).
