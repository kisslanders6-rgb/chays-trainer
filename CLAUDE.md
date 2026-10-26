# Chays Trainer : cadrage pour les assistants

À lire en début de session. Le README décrit l'application pour les humains ; ce fichier donne ce qu'il faut savoir pour modifier le code sans casser d'invariant. Mettez-le à jour dans le même commit quand vous ajoutez une clé de stockage, un nom global, un onglet ou une règle métier.

## Ce que fait l'application

Entraîneur d'échecs en français, PWA **sans dépendance d'exécution ni étape de compilation** : HTML, CSS et JS classiques chargés par `index.html`, dans un ordre qui compte (dépendances). Données dans `localStorage`, toujours via `dataStore` (`js/core/storageAdapter.js`). Synchronisation facultative avec Supabase (`supabase/schema.sql`, `js/core/sync*.js`, `cloud*.js`, `auth.js`). Déploiement statique (Vercel).

- **Jouer** (`js/modules/openings/`) : on joue ses coups et ceux de l'adversaire. Dans une position inconnue, mon coup devient l'unique réponse enregistrée. Rien n'y est compté (ni statistiques ni révisions).
- **Entraînement** (`js/modules/training/`) : répétition espacée, exercices (révision du jour, points faibles, ligne complète, à confirmer, contre-la-montre, mode libre), séances avec bilan. Seul cet onglet fait évoluer statistiques et révisions.
- **Statistiques** (`js/modules/stats/`) : maîtrise en six niveaux, ouvertures nommées, régularité.
- **Finales** (`js/modules/endgame/`) : moteur maison `EG` (`egCore.js`), base exacte roi + pion contre roi, catalogue `egExercises.js`.
- **Analyser mes parties** (`gameReview.js`, `onlineGames.js`) : parties Lichess / Chess.com / PGN collé, arrêt au premier coup hors répertoire. Mon coup différent : erreur comptée une fois par partie. Coup adverse non couvert : nouveauté, rien de compté.
- **Fenêtres** Paramètres, Aide, Compte : socle commun `js/core/panelKit.js`.

## Modèle de données (invariants)

- Une position = `positionKey` : « pièces trait roques passant ». Le répertoire est indexé par position : les transpositions sont naturelles.
- Base d'un répertoire et d'une couleur : `{ [positionKey]: entrée }`, lue par `readDBFor(rep, couleur)`. Une entrée = MA réponse unique `{ move (UCI), san (anglais), attempts, failures, path, ply, due, interval }` (`newEntry`, `js/storage.js`). Les coups adverses ne sont jamais des entrées : ils ouvrent des branches ; `oppSeen` garde ceux qui ont été repérés.
- Les coups sont stockés en notation anglaise ; `formatSan(san, couleur)` les affiche selon la préférence (fr, en, figurines).
- Préférences (`js/core/settings.js`) : `SYNCED_PREFS` (chaque champ daté, la plus récente gagne entre appareils) et `LOCAL_PREFS` (propres à l'appareil). Défauts d'apparence : Noyer (`walnut`) + Maestro pour les nouvelles installations ; une installation antérieure garde Vert classique + Merida (`keepOldLookDefaults`).
- Clés synchronisées : liste dans `js/core/syncModel.js`. Toute nouvelle clé à synchroniser doit y être déclarée, sinon elle reste sur l'appareil.
- Clés seulement locales notables : `chessTrainer_reviewedGames` (parties déjà comptées, non synchronisée), `chessTrainer.trainingSettings` et `chessTrainer.timedRecord` (convention de nom avec un point, historique), `chessTrainer_looksDefaults`.

## Pièges connus

- **Thème inversé** : `chessTrainer_theme` et l'attribut `data-theme` de `<html>` gardent des noms historiques inversés : `'light'` = thème SOMBRE, `'dark'` = thème CLAIR. Passer par `themeMode()` / `setThemeMode()`, jamais par la valeur brute. (Renommage prévu dans la feuille de route.)
- Pour calculer sur une autre position que celle affichée : API `Chess` (`Chess.replay`, `Chess.play`, `Chess.san`, `Chess.key`, `Chess.snapshot`), jamais l'état global `board` / `turn`. Les lectures PGN passent par `_withEngineSnapshot`.
- PGN (`pgn.js`) : les numéros de coup sont lus. Un numéro qui revient en arrière (`12. Cf3 Cd7 12... Cf6`) ouvre une **variante implicite** (`implicit: true`), comme des parenthèses.
- Un seul nom global par script (de préférence un objet, comme `Chess`, `EG`, `SyncModel`) : `npm test` refuse un nom déclaré deux fois.
- Nouveau script : l'ajouter dans `index.html` ; `sw.js` le met en cache tout seul. Image remplacée : incrémenter `VERSION` dans `sw.js`.
- Le script en ligne en tête d'`index.html` applique thème et échiquier avant le premier rendu : le garder cohérent avec `settings.js`.
- Panneaux (`css/panels.css`) : `.pn-content` est une colonne flex qui défile ; ses enfants ont `flex-shrink: 0`, sinon les volets en `overflow: hidden` sont écrasés.

## Conventions

- Français partout : interface, commentaires, messages de commit. Notation française à l'écran (C F T D R).
- En-tête de fichier qui explique le rôle du module ; sections `// ─── TITRE ───` ; commentaires courts, en phrases.
- Pas de framework, pas de bundler. `jsdom` sert uniquement aux tests.
- Les actions de l'interface passent par `onclick` dans `index.html` ou par `data-action` + `registerActions` (`js/core/utils.js`).
- Échapper tout texte inséré en HTML (`escapeHtml`).

## Tests

`npm test` (`tests/run.js`, Node, aucun réseau : serveur Supabase simulé). `boot.test.js` charge `index.html` entier dans jsdom ; `globals.test.js` vérifie les noms globaux. Chaque règle métier (PGN, révision, synchronisation, finales, préférences) a son test : en ajouter un avec toute nouvelle règle. Les tests tournent à chaque push (`.github/workflows/tests.yml`).

Prévisualisation locale : `.claude/launch.json` (serveur Node sur le port 8080) ou `npm start`.

## État et chantiers

- Fait : notation standard, Jouer sans comptage, onglet Adversaire, refonte Finales « Velours », lot 1 de la feuille de route (Aide, variantes implicites PGN, « Les deux » par défaut, Noyer + Maestro).
- Feuille de route et décisions validées (26 octobre 2026) : artefact « Feuille de route Chays Trainer ». Lots suivants : journal des parties analysées et statut « Traitée depuis », Stockfish embarqué et mode Analyse, finales jugées par Syzygy et moteur, apparence, compte.
- Décision en attente : choix de l'icône (artefact des 48 icônes).
