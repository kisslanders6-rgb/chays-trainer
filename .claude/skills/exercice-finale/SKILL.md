---
name: exercice-finale
description: Créer, corriger ou vérifier un exercice de l'onglet Finales de Chays Trainer (catalogue js/modules/endgame/egExercises.js). À utiliser dès que l'utilisateur veut ajouter une finale (Lucena, Philidor, opposition, Dame contre Tour…), changer une FEN, un objectif, un niveau ou un texte d'exercice, ou quand endgameSelfTest échoue, même s'il donne juste une position ou un nom de finale.
---

# Exercice de finale

Le catalogue est `ENDGAME_EXERCISES` dans `js/modules/endgame/egExercises.js`, catégories dans `ENDGAME_CATEGORIES` (`mats`, `pions`, `tours`, `dame`…). `endgameSelfTest()` (lancé par `npm test`) refuse tout exercice incohérent : lire ses messages, ils disent quoi corriger.

## 1. Choisir le type d'exercice

- **Avec `kind`** (`'mate'`, `'kpk'`, `'pawns'`) : juge local, pas de réseau. Réservé aux mats élémentaires et aux finales de pions déjà couvertes par ces juges.
- **Sans `kind`** : exercice **jugé**. Chaque coup est comparé par `EndgameJudge.probe` (KPK locale, puis Syzygy jusqu'à 7 pièces, puis Stockfish au-delà, verdict « estimé »). C'est le cas par défaut pour toute nouvelle finale de pièces.

## 2. Écrire l'entrée

Prendre pour modèle un exercice voisin de la même catégorie. Champs :

- `id` unique en kebab-case préfixé par la catégorie (`tours-lucena-…`), `cat`, `player` (`'w'`/`'b'`, doit être le camp au trait dans la FEN), `level` 1 à 5.
- `goal` : `'win'` (alors `keep` ou `maxMoves` obligatoire) ou `'draw'` (alors `hold`, le nombre de coups à tenir, obligatoire). `'mate'` seulement avec `kind: 'mate'`.
- `fen` : légale, un roi par camp, aucun pion sur la 1re ou la 8e rangée.
- `title` en français, `plan` (tableau de phrases courtes, impératif, vouvoiement), `theory` (un paragraphe). Notation française dans les textes (R D T F C). Si la position dépasse 7 pièces, dire dans `theory` que le verdict est estimé par le moteur.
- Optionnels : `solution` (UCI, doit faire partie des coups jugés corrects), `unique: true` (un seul bon coup attendu), `rules` (contrainte de défense).

## 3. Figer le verdict (exercices jugés)

Après tout ajout ou toute modification de FEN :

```bash
node scripts/check-endgames.mjs
```

Le script interroge l'API Syzygy de Lichess (réseau requis) ou Stockfish au-delà de 7 pièces, vérifie que le verdict correspond à `goal`, puis réécrit le bloc `ENDGAME_VERDICTS` en fin de fichier. Ne jamais éditer ce bloc à la main : `endgameSelfTest` compare la FEN figée à celle du catalogue. `--check` vérifie sans écrire.

Si le verdict ne correspond pas à l'objectif (une « nulle » qui est en fait gagnée), ne pas changer l'objectif sans prévenir : c'est le signe que la position ne montre pas ce que l'exercice veut enseigner. Proposer une FEN corrigée et l'expliquer.

## 4. Vérifier

- `npm test` (`tests/endgame.test.js` et `endgameSelfTest`).
- Ouvrir l'exercice dans l'aperçu : la position s'affiche du bon côté, un bon coup est accepté, un coup qui dégrade le résultat est compté comme erreur, l'adversaire répond.
- Si la catégorie gagne un nouveau thème, mettre à jour sa `desc` dans `ENDGAME_CATEGORIES`.
