# Chays Trainer : cadrage pour les assistants

À lire en début de session. Le README décrit l'application pour les humains ; ce fichier donne les invariants communs. Le détail de chaque domaine est à côté de son code : `js/core/CLAUDE.md`, `js/domain/CLAUDE.md`, `js/board/CLAUDE.md`, `js/screens/CLAUDE.md`, `js/shell/CLAUDE.md`, `css/CLAUDE.md` (thèmes). Mettez à jour le bon fichier dans le même commit quand vous ajoutez une clé de stockage, un nom global, un onglet ou une règle métier.

## Ce que fait l'application

Entraîneur d'échecs en français, PWA **sans dépendance d'exécution ni étape de compilation** : HTML, CSS et JS classiques chargés par `index.html`, dans un ordre qui compte. Données dans `localStorage`, toujours via `dataStore` (`js/core/storageAdapter.js`). Synchronisation facultative avec Supabase (`supabase/schema.sql`, `js/domain/sync/`). Déploiement statique (Vercel, `.vercelignore`).

## Architecture

Cinq couches, chacune ne s'appuie que sur celles du dessous ; `tests/app/layers.test.js` le vérifie (liens encore tolérés : `tests/app/layers.baseline.json`, ils ne peuvent que baisser).

- `js/core` : socle (échappement, actions, `Bus`, fenêtres `askConfirm` / `askText`, traduction, composants).
- `js/domain` : règles et données, sans écran (`chess/`, `repertoire/` dont `review.js` et `levels.js`, `sync/`, `endgames/`, `games/`, moteur, préférences, sons).
- `js/board` : l'écran de jeu de tous les modes.
- `js/screens` : un dossier par écran.
- `js/shell` : navigation, barres, accueil.

`Bus.on` / `Bus.emit` (`js/core/bus.js`) : les données annoncent, les écrans réagissent (`viewRefresh.js` décide quoi redessiner). Ne pas appeler un écran depuis `domain`.

`GameModes` (`js/board/modes.js`) : une fiche par mode de l'échiquier (coup, clic, indice, navigation). Un nouveau mode remplit sa fiche depuis son écran (`GameModes.register`), sans nouveau test sur `gameMode` dans `js/board`.

## Modèle de données (invariants)

- Une position = `positionKey` : « pièces trait roques passant ». Le répertoire est indexé par position : les transpositions sont naturelles.
- Base d'un répertoire et d'une couleur : `{ [positionKey]: entrée }`, lue par `readDBFor(rep, couleur)`. Une entrée = MA réponse unique `{ move (UCI), san (anglais), attempts, failures, path, ply, due, interval, created?, prio?, relearn?, mastery? }` (`newEntry`, `normalizeEntry`, `js/domain/repertoire/storage.js`). `created` : date d'enregistrement (absente avant octobre 2026). `prio` : réponse « Traitée depuis » jamais réussie, levée par `recordReview(e, true)`. `relearn` : réussites espacées dans la file « À revoir » (0 à 2, absent hors de la file). `mastery` : score de 0 à 100 ; fusion de ces deux champs : ceux du passage le plus récent, à égalité le plus prudent. Tout nouveau champ d'entrée doit être gardé par `normalizeEntry` ET par la fusion de `syncModel.js` (`combineSameMove`), sinon il disparaît. Les coups adverses ne sont jamais des entrées : ils ouvrent des branches ; `oppSeen` garde ceux qui ont été repérés.
- Les coups sont stockés en notation anglaise ; `formatSan(san, couleur)` renvoie du **HTML échappé** (figurines : `<span class="fig">` du jeu actif, variables `--fig-wN`… posées par `applyPieceSet`), `formatSanText` du texte simple (barre d'état, `title`, copie), en lettres même en mode Figurines (plus de glyphes Unicode ♘, rendus en emojis). Toute liste affichée (Nouveautés, parties en ligne, Statistiques, rapport PGN, aperçu de fusion) passe par `formatSan` ou l'option `html` de `formatLinePrefix` / `_plyLabel`. Ne jamais repasser `formatSan` dans `escapeHtml`. Le jeu « Invisibles » repasse aux lettres.
- Préférences (`js/domain/settings.js`) : `SYNCED_PREFS` (chaque champ daté, la plus récente gagne entre appareils) et `LOCAL_PREFS` (propres à l'appareil). Chacune doit avoir son réglage dans `settingsUI.js` ou `accountUI.js` (test). Les options du mode libre sont `freeMaxPlies`, `freeSeqLen`, `freeFromStart` (lues via `trainingSettings`). Entraînement : `trainNext` (`'error'` par défaut : réussite nette enchaînée, arrêt après erreur, indice ou solution ; `'wait'`, `'auto'`) et `trainSeen` (filtre « Vu en partie », vrai par défaut), synchronisées. Le niveau du profil a été retiré. `eloSite` / `eloSpeed` : site et cadence de l'Elo affiché (vides : automatique), communs à Statistiques › Parties et Compte, la plus récente gagne entre appareils ; plus de saisie manuelle de l'Elo. Défauts d'apparence : Noyer (`walnut`) + Maestro + ambiance Buis (`darkBg: 'buis'`) pour les nouvelles installations ; une installation antérieure sans choix garde Tournoi + Merida (avant octobre 2026) et l'ambiance Échiquier (avant novembre 2026) (`keepOldLookDefaults`, paliers notés dans `chessTrainer_looksDefaults`, recopiés dans le script de tête). Catalogue (novembre 2026) : l'ordre de `BOARD_THEMES`, `PIECE_SET_IDS`, `ARROW_STYLE_IDS` est celui des Paramètres, le défaut en tête, puis par famille. Options retirées : `RETIRED_LOOKS` (`settings.js`, recopié pour les échiquiers dans le script de tête) les remplace à la lecture, sans réécrire le choix. Repères de cases : préférences synchronisées `legalStyle` (`data-legal-style`) et `lastStyle` (`data-last`).
- Clés synchronisées : liste dans `js/domain/sync/syncModel.js`. Toute nouvelle clé à synchroniser doit y être déclarée, sinon elle reste sur l'appareil.
- `chessTrainer_timedRecord` (record du contre-la-montre) est synchronisé : le plus grand l'emporte.
- `chessTrainer_repNotes` (description de chaque répertoire, `{ [répertoire]: { v, at } }`, 160 caractères au plus) est synchronisé : la plus récente l'emporte (même fusion que les préférences). `repertoireNote(nom)` / `setRepertoireNote(nom, texte)` (`storage.js`) ; suivie par `renameRepertoire`, `deleteRepertoire` (gardée dans l'élément de corbeille) et la restauration. Saisie : menu ⋮ du répertoire ou toucher la description sous « Jouer » (`editRepNote`, `askText` avec `allowEmpty` / `max`) ; affichée aussi dans la liste de `RepPicker` (`.rp-desc`) et en infobulle de la puce.
- Clés seulement locales notables : `chessTrainer_mode` (clair / sombre / système), `chessTrainer_eloLevels` (dernier Elo par site et cadence, résumé recalculé par `GameArchive.all`, lu sans attendre IndexedDB), `chessTrainer_avatarLocal` (photo de 128 px), `chessTrainer_looksDefaults` (dernier palier de défauts passé : `2026-10`, `2026-11`), `chessTrainer_looksTip` (suggestion Noyer + Maestro déjà vue), `chessTrainer_authFlow` (démarche de compte lancée sur cet appareil, 24 h : sans elle, un lien `#access_token=…` n'est appliqué qu'après confirmation du compte nommé, et les données ne partent qu'après le choix « Première synchronisation »), `chessTrainer_paletteRecent` (cinq derniers choix de la palette), `chessTrainer_gameFilters` (période, site et cadence de Statistiques › Parties), `chessTrainer_reviewedGames` (ancienne liste des erreurs comptées, seulement relue), `chays_langPack` (copie du dictionnaire actif, `{ id, dict, at }`, renouvelée au lancement : `I18n.refreshed()`), `chessTrainer_splashDay` (jour de la dernière animation de lancement complète, « la plume » ; ensuite « la gravure », courte, via `html.splash-quick` posé par le script de tête ; `tests/shell/splash.test.js`). Convention : `chessTrainer_<nom>` ; les anciennes clés `chessTrainer.trainingSettings`, `chessTrainer.timedRecord` et `chessTrainer_theme` sont converties au démarrage puis supprimées.

## Pièges connus

- Pour calculer sur une autre position que celle affichée : API `Chess` (`Chess.replay`, `Chess.play`, `Chess.san`, `Chess.key`, `Chess.snapshot`), jamais l'état global `board` / `turn`. Les lectures PGN passent par `_withEngineSnapshot`.
- `Chess.fen(pos)` donne la FEN d'une position (`displayedFen()` pour celle affichée).
- Un seul nom global par script (de préférence un objet, comme `Chess`, `EG`, `SyncModel`) : `npm test` refuse un nom déclaré deux fois.
- Nouveau script : l'ajouter dans `index.html` ; `sw.js` le met en cache tout seul. Image remplacée : incrémenter `VERSION` dans `sw.js`.
- Icônes de l'app : PNG 192, 512, masquable et iOS par `swift scripts/export-icons.swift` (`assets/brand/chays-icone.svg`) ; `favicon.ico` (16, 32, 48 px, `assets/brand/chays-favicon.svg`) et `icon-mono-512.png` (manifeste `monochrome`) par `swift scripts/export-favicons.swift` ; `assets/icons/icon.svg` est le favicon adaptatif clair / sombre, écrit à la main (croix épaissie, sans gravure). `tests/app/pwaIcons.test.js` vérifie balises, manifeste et cache.
- Le script en ligne en tête d'`index.html` applique thème et échiquier avant le premier rendu : le garder cohérent avec `settings.js`.
- Thèmes, couleurs, Safari 16 : `css/CLAUDE.md`.

## Conventions

- Français partout : code, commentaires, messages de commit ; les autres langues passent par `I18n` (voir Langues). Notation française à l'écran en français (C F T D R), lettres de la langue sinon.
- En-tête de fichier qui explique le rôle du module ; sections `// ─── TITRE ───` ; commentaires courts, en phrases.
- Pas de framework, pas de bundler. `jsdom` sert uniquement aux tests.
- Les actions de l'interface passent par `onclick` dans `index.html` ou par `data-action` + `registerActions` (`js/core/utils.js`).
- Échapper tout texte inséré en HTML (`escapeHtml`).

## Tests

`npm test` (`tests/run.js`, Node, aucun réseau : serveur Supabase simulé). Les tests sont rangés par couche (`tests/core`, `domain`, `board`, `screens`, `shell`), `tests/app` pour le transversal. `tests/_app.js` : `bootApp()` démarre l'application entière dans jsdom, `scriptPath('nom.js')` retrouve un script (jamais de chemin `js/…` en dur). `boot.test.js` charge `index.html` entier ; `globals.test.js` vérifie les noms globaux ; `layers.test.js` le sens des dépendances ; `gameModes.test.js` ce que l'échiquier fait dans chaque mode ; `critical.test.js` corbeille, arbre et noms piégés ; `i18nSource.test.js` affiche ce qui manque aux traductions. Chaque règle métier a son test : en ajouter un avec toute nouvelle règle. Les tests tournent à chaque push (`.github/workflows/tests.yml`).

Prévisualisation locale : `.claude/launch.json` (serveur Node sur le port 8080) ou `npm start`.

Skills du projet (`.claude/skills/`) : `cloture-lot` (vérifications et commit de fin de lot), `nouvelle-donnee` (champ d'entrée, clé de stockage, préférence), `exercice-finale` (catalogue des finales et verdicts), `apparence-ajout` (échiquier, jeu de pièces, style de flèches). Les tenir à jour quand une procédure qu'elles décrivent change.

## État et chantiers

L'historique des lots est dans Git. Décidé pour plus tard (bilan du code, novembre 2026) : migrations éparses, CSP, appels réseau en double, geste de glissement, gardes `typeof`, écritures croisées de l'état de partie, noms en `_` partagés, découpe d'`accountUI.js`, découpe de `style.css`, fenêtres natives.

- Feuille de route et décisions validées (26 octobre 2026) : artefact « Feuille de route Chays Trainer ». Restes à proposer : registre unique des réglages et `chessTrainer_schema` (migrations ordonnées), bouton « Ce coup n'était pas encore dans mon répertoire » (bouton dans `setStatus`), variantes implicites d'un PGN collé proposées comme réponses.
- Analyses de parties : artefact « Atlas des parties » (novembre 2026), 42 statistiques retenues. Les cinq lots sont faits (sélecteur et fiche d'ouverture, archive version 2, Bilan et Temps, Qualité de jeu, Types de positions).
- Arbitrage du 12 novembre 2026 (artefact « Arbitrage Statistiques et Entraînement ») : neuf suggestions, six lots construits (courbe d'Elo et période, icône panneau, rail gardé, fin d'exercice, « Vu en partie », barre latérale à sous-menu actif, palette divergente des niveaux et libellés, traductions et renouvellement du dictionnaire).
- Statistiques : artefact « Refonte des Statistiques » (novembre 2026), version retenue construite (barre de filtres unique, « À faire », quatre onglets, miroir des ouvertures) ; détail dans `js/screens/CLAUDE.md`.
- Identité « Noyer gravé » (artefact « Identité Chays », 12 novembre 2026, direction A choisie en entier) : tout est construit : jetons de durée et de police, couleurs de marque fixes et ambiance Buis, animations unifiées, lancement resserré (1,6 s, puis 0,7 s), transitions d'onglets, « trait gravé » + cloche à la maîtrise (`Engrave`), icônes au trait 1,75 px avec état actif par un fond, « Chays » sous l'icône.
- Icône et logo de marque : dessin actuel gardé, recoloré Noyer. Icônes de l'interface (`js/core/icons.js`) : choix clos le 27 octobre 2026, ne plus proposer d'alternatives.
