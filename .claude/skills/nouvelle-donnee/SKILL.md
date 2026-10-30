---
name: nouvelle-donnee
description: Procédure pour ajouter ou modifier une donnée persistante de Chays Trainer sans la perdre en synchronisation. À utiliser dès qu'une tâche ajoute, renomme ou supprime un champ d'entrée du répertoire (à côté de move, san, due, prio…), une clé localStorage `chessTrainer_*`, une préférence (réglage dans les Paramètres), ou change ce qui est synchronisé avec Supabase, même si la demande ne parle que d'une fonctionnalité (« retenir le dernier filtre », « mémoriser l'option », « garder la date de… »).
---

# Ajouter une donnée persistante

Dans ce projet, une donnée qui n'est pas déclarée au bon endroit **disparaît sans erreur** : `normalizeEntry` jette les champs inconnus à la lecture, la fusion de `syncModel.js` reconstruit les entrées champ par champ, et une clé absente de `kindOf` ne quitte jamais l'appareil. Les tests ne le voient que si on en écrit un. D'où cette procédure.

Commencer par décider de quel type est la donnée, puis suivre la section correspondante.

## A. Champ d'une entrée du répertoire

Une entrée = ma réponse unique dans une position (`js/storage.js`).

1. `newEntry` : valeur initiale, si le champ doit exister dès l'enregistrement.
2. `normalizeEntry` : recopier le champ avec sa validation (`Number.isFinite(e.x) && e.x > 0`, etc.). Sans ça il est effacé à chaque lecture.
3. `js/core/syncModel.js`, `combineSameMove(b, l, r)` : décider de la règle de fusion entre deux appareils et l'écrire. Elle doit rester **symétrique** (`merge(b,l,r)` = `merge(b,r,l)`). Modèles existants : `created` → le plus ancien ; `prio`, `due` → ceux du passage le plus récent ; compteurs → base + deltas.
4. Mettre à jour le commentaire d'en-tête de `syncModel.js` (ligne `openingDB_…`) et la phrase « Une entrée = … » de CLAUDE.md.
5. Tests : `tests/syncModel.test.js` (fusion dans les deux ordres, champ conservé) et, si le champ a un effet sur la révision, `tests/training.test.js`.

## B. Nouvelle clé de stockage

1. Nom : `chessTrainer_<nom>`. Lecture et écriture toujours via `dataStore` (`js/core/storageAdapter.js`), jamais `localStorage` en direct.
2. Synchronisée ou locale ? Synchronisée si l'utilisateur s'attend à la retrouver sur un autre appareil (progression, répertoire, choix d'apparence) ; locale si elle dépend de l'appareil (taille d'écran, cache, photo réduite, état d'interface).
3. Si synchronisée : ajouter la clé dans `kindOf` de `syncModel.js` avec un type existant ou un nouveau type, écrire sa fonction de fusion (symétrique, à trois points), l'ajouter à l'en-tête. Test dans `tests/syncModel.test.js` et, si le flux complet change, `tests/syncEngine.test.js`.
4. Si elle remplace une ancienne clé : conversion au démarrage puis suppression de l'ancienne (voir comment `settings.js` traite `chessTrainer_theme`), avec un test dans `tests/migration.test.js`.
5. CLAUDE.md : liste des clés synchronisées ou des « clés seulement locales notables ».

## C. Préférence (réglage)

Dans `js/core/settings.js` :

1. Synchronisée → `SYNCED_PREFS` (stockée datée `{ v, at }` dans `chessTrainer_prefs`, la plus récente gagne). Propre à l'appareil → `LOCAL_PREFS` (`chessTrainer_settings`).
2. Donner `ok` (validation : `_bool`, `_oneOf([...])`, `_text(max)`) et `def` (défaut). Une valeur invalide reprend le défaut, ce qui protège contre des données d'un autre appareil plus ancien.
3. Ajouter le contrôle dans `js/core/settingsUI.js` (ou `accountUI.js` pour le profil) : `tests/settings.test.js` échoue si une préférence n'a pas de réglage. Pas de phrase d'aide sous le réglage : l'explication va dans `tip` (infobulle du libellé) et les synonymes dans `search`. Une préférence de `LOCAL_PREFS` reçoit seule le repère « appareil » (`PanelKit.localMark`, `tests/settingsLocalMark.test.js`).
4. Lire la valeur via `appSettings.<nom>` (ou `trainingSettings` pour les options d'entraînement).
5. Si la préférence agit avant le premier rendu (thème, échiquier), garder cohérent le script en ligne en tête d'`index.html`.

## Avant de finir

- `npm test`.
- Vérifier à la main un aller-retour : écrire la donnée, recharger la page, la relire.
- Mentionner dans la réponse quelle règle de fusion a été choisie et pourquoi : c'est une décision de produit que l'utilisateur doit pouvoir contester.
