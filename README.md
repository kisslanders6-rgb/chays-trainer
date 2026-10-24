# Chays Trainer

Entraîneur d'échecs en français, sans dépendance ni étape de compilation : un répertoire d'ouvertures appris par répétition espacée, et des finales théoriques jugées coup par coup.

- **Jouer** : vous jouez vos coups et ceux de l'adversaire. Dans une position inconnue, votre coup devient l'unique réponse enregistrée. Ensuite, il faut la retrouver. Jouer sert à construire : rien n'y est compté, un nouveau coup est proposé dès la prochaine séance d'Entraînement. L'onglet **Adversaire** montre les réponses les plus jouées par vos adversaires (vos parties Chess.com et Lichess, chacune comptée une fois) et, avec un jeton personnel Lichess, par les joueurs Lichess de votre niveau.
- **Entraînement** : un menu d'exercices (révision du jour, points faibles, ligne complète, à confirmer, contre-la-montre, mode libre). Chaque séance a une barre de progression, reprend les erreurs en fin de séance et se termine par un bilan. L'échiquier rejoue les trois coups précédents pour remettre la position en contexte.
- **Statistiques** : révisions dues avec lancement direct sur l'échiquier, maîtrise en six niveaux, points faibles, positions regroupées par ouverture nommée, régularité (série, calendrier, réussite par semaine).
- **Analyser mes parties** : récupère vos dernières parties Chess.com ou Lichess (pseudo, API publiques) ou un PGN collé ; chaque partie s'arrête sur le premier coup sorti du répertoire. Votre coup : erreur comptée sur la position. Coup adverse : nouveauté signalée.
- **Finales** : mats élémentaires, finales de pions (vérifiées par une base exacte roi + pion contre roi), pièces mineures (cavalier contre pion, Fou de la mauvaise couleur), Lucena, défenses de Philidor et de Vancura.
- Une présentation en quatre écrans au premier lancement (relançable depuis Aide › Premiers pas).
- Import et export **PGN** (notation standard : désambiguïsation, `+` et `#`) et **JSON**, corbeille de 30 jours, flèches et cercles au clic droit, analyse de la position sur Lichess, mode hors ligne (PWA), synchronisation facultative entre appareils (Supabase).

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
css/home.css          signature (Fraunces + IBM Plex Mono), barre du haut, accueil « Nocturne » (sombre) / « Studio » (clair)
css/splash.css        écran de lancement
sw.js                 service worker : cache construit à partir d'index.html
js/core/splash.js     moment de sortie de l'écran de lancement ; introTimeline.js : vol du logo vers la barre du haut
js/
  app.js              navigation, thème, paramètres, répertoires, fenêtres de saisie
  storage.js          répertoires, bases d'ouvertures, répétition espacée, journal d'activité, import/export JSON
  core/               briques communes : utils (échappement HTML, actions data-action, reportError), stockage,
                      synchronisation (syncModel, cloudAdapter, cloudClient, auth, syncEngine, accountUI),
                      moteur d'échecs (chessEngine : état affiché + API Chess sans état partagé), pièces, icônes,
                      sons, corbeille, sauvegarde, présentation (onboarding), mobile
  modules/openings/   mode Jouer : logique, échiquier, flèches, arbre (édition des coups), panneau Données, PGN, analyse d'une partie,
                      fréquences des coups adverses (moveStats)
  modules/training/   entraînement
  modules/stats/      statistiques
  modules/endgame/    finales : noyau (egCore), catalogue (egExercises), séance (endgame)
supabase/schema.sql   table et règles d'accès pour la synchronisation
tests/                tests Node (aucun réseau : serveur Supabase simulé)
scripts/              outils de maintenance
```

Les données restent dans le navigateur (`localStorage`). Toutes les lectures et écritures passent par `dataStore` (`js/core/storageAdapter.js`) ; une écriture refusée (stockage plein) est signalée à l'écran, et la carte Sauvegarde indique la part du stockage occupée.

Une position est identifiée par « pièces trait roques passant » (`positionKey`). Les données de l'ancien format (« pièces trait ») sont converties au démarrage, et à la lecture pour celles reçues d'un appareil pas encore mis à jour.

## Synchronisation (facultative)

1. Créez un projet Supabase, puis exécutez `supabase/schema.sql` dans l'éditeur SQL.
2. Renseignez `url` et `anonKey` dans `js/core/cloudConfig.js`. Cette clé est publique : la sécurité repose sur les règles RLS du schéma. N'y mettez jamais la clé `service_role`.
3. Pour vérifier la connexion, ouvrez `tests/cloud-smoke.html` (servi en HTTP).
4. Authentication → URL Configuration : mettez l'adresse de l'application (ex. `https://chays-trainer.vercel.app`) en « Site URL » et dans « Redirect URLs ».
5. Connexion avec Google (facultatif) : Authentication → Sign In / Providers → Google, avec un identifiant OAuth créé dans Google Cloud Console. Le bouton « Continuer avec Google » apparaît dès que le fournisseur est activé.

Le schéma limite chaque compte à 500 documents et 20 Mo, et fournit `delete_my_account()` (bouton « Supprimer mon compte »).

Sont synchronisés : répertoires, statistiques et planning de révision, corbeille, progression des finales, journal d'activité, ainsi que le thème de l'échiquier, le style des pièces et celui des flèches (le choix le plus récent l'emporte). Le mode clair / sombre et les sons restent propres à chaque appareil.

Sans configuration, le bouton « Compte » n'apparaît pas et l'application fonctionne entièrement en local.

## Tests

```bash
npm install
npm test
```

Les tests couvrent le moteur d'échecs (perft, SAN), l'import / export PGN (aller-retour), la conversion des anciennes clés, les fréquences des coups adverses, les finales, les règles de fusion de la synchronisation, le client Supabase, l'authentification, le moteur de synchronisation et la fenêtre de compte. `boot.test.js` charge `index.html` entier dans jsdom (aucune erreur au démarrage) et `globals.test.js` vérifie qu'aucun nom global n'est déclaré dans deux scripts. Ils tournent aussi à chaque push (GitHub Actions, `.github/workflows/tests.yml`).

## Maintenance

- **Images** : si vous remplacez une image existante (pièces, textures, logos), incrémentez `VERSION` dans `sw.js` pour que le cache se mette à jour. Le code (HTML, JS, CSS) est toujours rechargé depuis le réseau quand c'est possible.
- **Identité** : le logo maître est `assets/brand/chays-logo.svg` (calques `#piece` : socle, corps, couronne, gravure ; `#texte` : CHAYS, TRAINER), l'icône `assets/brand/chays-icone.svg`. Après une modification de l'icône, lancez `swift scripts/export-icons.swift` (macOS) pour régénérer les PNG d'`assets/icons/`, puis incrémentez `VERSION` dans `sw.js`. Le logo est aussi copié en ligne dans `index.html` (écran de lancement et emblème de la barre du haut / de l'accueil). L'ancienne identité « Ch » est archivée dans `assets/archive/identite-ch-2026-10/`.
- **Nouveau script** : ajoutez-le dans `index.html`. Le service worker le mettra en cache automatiquement. Exposez de préférence un seul nom global (un objet, comme `Chess`, `EG` ou `SyncModel`) ; `npm test` refuse un nom déclaré deux fois.
- **Calculs d'échecs** : pour travailler sur une autre position que celle affichée, passez par `Chess` (`Chess.replay`, `Chess.play`, `Chess.san`, `Chess.key`…) plutôt que par l'état global `board` / `turn`.

## Crédits

Jeux de pièces issus du projet open source Lichess. Auteurs et licences : `assets/pieces/CREDITS.md`. Icônes inspirées de Lucide (licence ISC).
