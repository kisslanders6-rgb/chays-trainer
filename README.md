# Chays Trainer

Entraîneur d'échecs en français, sans dépendance ni étape de compilation : un répertoire d'ouvertures appris par répétition espacée, et des finales théoriques jugées coup par coup.

- **Jouer** : vous jouez vos coups et ceux de l'adversaire. Dans une position inconnue, votre coup devient l'unique réponse enregistrée. Ensuite, il faut la retrouver. Jouer sert à construire : rien n'y est compté, un nouveau coup est proposé dès la prochaine séance d'Entraînement. L'onglet **Adversaire** montre les réponses les plus jouées par vos adversaires (vos parties Chess.com et Lichess, chacune comptée une fois) et, avec un jeton personnel Lichess, par les joueurs Lichess de votre niveau.
- **Entraînement** : un menu d'exercices (révision du jour, points faibles, ligne complète, à confirmer, contre-la-montre, mode libre). Chaque séance a une barre de progression, reprend les erreurs en fin de séance et se termine par un bilan. L'échiquier rejoue les trois coups précédents pour remettre la position en contexte.
- **Statistiques** : révisions dues (lien vers l'exercice de l'Entraînement, filtré), maîtrise par niveau et état « À confirmer », points faibles, positions regroupées par ouverture nommée, régularité (série, calendrier, réussite par semaine).
- **Analyse** : la position de l'écran Jouer avec **Stockfish 19** embarqué (WebAssembly, multi-thread quand la page est isolée) : évaluation, lignes multiples, flèches, évaluation Lichess immédiate pour les positions connues. Les coups explorés forment un brouillon séparé ; « Ajouter au répertoire » montre ce qui sera fusionné (conflits signalés, remplacement seulement sur demande).
- **Analyser mes parties** : récupère vos dernières parties Chess.com ou Lichess (pseudo, API publiques) ou un PGN collé ; chaque partie s'arrête sur le premier coup sorti du répertoire. Votre coup : erreur comptée sur la position (une fois par partie, sur tous les appareils). Coup adverse : nouveauté signalée. Déviation couverte par une réponse ajoutée après la partie : « Traitée depuis », rien de compté.
- **Finales** : 43 exercices en six catégories (mats, pions, tours, dame, pièces mineures, Tour + Fou contre Tour). Les mats et les finales roi + pion sont jugés hors ligne par un calcul exact ; les autres par les tables Syzygy de Lichess (jusqu'à 7 pièces, réponses gardées sur l'appareil), ou par Stockfish au-delà (verdict « estimé »). L'adversaire calcule : « Résistance maximale » ou « Humain ». Les FEN et leurs verdicts se vérifient avec `node scripts/check-endgames.mjs`.
- Une présentation en quatre écrans au premier lancement (relançable depuis Aide › Premiers pas).
- **Apparence** : 13 échiquiers (dont Noyer, Érable, Marbre, Tournoi, Cerisier), 12 jeux de pièces, six styles de flèches ; les couleurs de l'interface sont tirées de l'échiquier, avec des contrastes vérifiés en clair et en sombre (`tests/theme.test.js`, page `tests/theme-matrix.html`).
- **Compte** : connexion ou création de compte (e-mail ou Google), photo de profil ou l'un des 18 avatars.
- Import et export **PGN** (notation standard : désambiguïsation, `+` et `#`) et **JSON**, corbeille de 30 jours, flèches et cercles au clic droit, ouverture de la position sur Lichess, mode hors ligne (PWA), synchronisation facultative entre appareils (Supabase).

## Lancer l'application

Ouvrez simplement `index.html` dans un navigateur. Pour le mode hors ligne (service worker) et le moteur d'analyse, servez le dossier en HTTP :

```bash
python3 -m http.server 8080
```

puis ouvrez <http://localhost:8080>. La commande `npm start` fait la même chose.

Le moteur tourne sur un seul fil de calcul sans en-têtes particuliers. Pour le multi-thread, le serveur doit envoyer `Cross-Origin-Opener-Policy: same-origin` et `Cross-Origin-Embedder-Policy: credentialless` (déjà configurés pour Vercel dans `vercel.json`).

## Moteur d'analyse

`engine/manifest.json` décrit le moteur (version, fichiers, tailles, empreintes) ; `js/core/engine.js` ne lit que ce manifeste.

- **Réseau léger** (par défaut) : moteurs « lite » de Stockfish, environ 1,8 Mo chacun, embarqués dans `engine/<version>/`.
- **Réseau complet** (Paramètres › Moteur d'analyse › Réseau neuronal) : nettement plus fort. Son `.wasm` (99 Mo) n'est pas dans le dépôt : il est téléchargé à la demande depuis unpkg (qui autorise CORS et CORP), vérifié par son empreinte sha256 notée dans le manifeste, puis gardé dans le cache du moteur, hors ligne compris. S'il n'est pas téléchargé, ou si unpkg ne répond pas, le réseau léger est utilisé. Un bouton le supprime de l'appareil.

- **Mise à jour automatique** : chaque lundi, `.github/workflows/engine-update.yml` vérifie le paquet npm `stockfish` ; une version publiée depuis au moins 14 jours est embarquée, testée, puis proposée en pull request. Il faut autoriser une fois les Actions à créer des pull requests (Settings › Actions › General).
- **À la main** : `node scripts/update-engine.mjs [version]`, puis `npm test`.
- Le service worker garde le moteur dans un cache à part, rempli au premier usage, et supprime les fichiers d'une ancienne version.

Stockfish est un logiciel libre sous licence GPL v3 ; la licence est jointe dans `engine/<version>/COPYING.txt`.

## Structure

```
index.html            page unique ; l'ordre des <script> compte (dépendances)
style.css             styles de l'application
css/account.css       fenêtre « Compte »
css/home.css          signature (Fraunces + IBM Plex Mono), barre du haut, accueil « Nocturne » (sombre) / « Studio » (clair)
css/splash.css        écran de lancement
sw.js                 service worker : cache construit à partir d'index.html ; moteur dans un cache à part
vercel.json           en-têtes d'isolation (moteur multi-thread) et cache du moteur
engine/               moteur Stockfish embarqué (manifest.json + engine/<version>/)
js/core/splash.js     moment de sortie de l'écran de lancement ; introTimeline.js : vol du logo vers la barre du haut
js/
  app.js              navigation, thème, paramètres, répertoires, fenêtres de saisie
  storage.js          répertoires, bases d'ouvertures, répétition espacée, journal d'activité, import/export JSON
  core/               briques communes : utils (échappement HTML, actions data-action, reportError), stockage,
                      synchronisation (syncModel, cloudAdapter, cloudClient, auth, syncEngine, accountUI),
                      moteur d'échecs (chessEngine : état affiché + API Chess sans état partagé), pièces, icônes,
                      sons, corbeille, sauvegarde, présentation (onboarding), mobile
  core/engine.js      moteur d'analyse (Worker UCI, file d'attente) ; modules/analysis/ : mode Analyse
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

1. Créez un projet Supabase, puis exécutez `supabase/schema.sql` dans l'éditeur SQL. Relancez-le après une mise à jour : il est sans risque à répéter, et la version d'octobre 2026 ajoute le seau privé `avatars` des photos de profil.
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

Moteur Stockfish (GPL v3), compilé en WebAssembly par stockfish.js (Nathan Rugg, Chess.com). Jeux de pièces issus du projet open source Lichess. Auteurs et licences : `assets/pieces/CREDITS.md`. Icônes inspirées de Lucide (licence ISC).
