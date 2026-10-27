---
name: apparence-ajout
description: Ajouter ou modifier un échiquier, un jeu de pièces ou un style de flèches dans Chays Trainer. À utiliser dès que l'utilisateur veut un nouveau thème d'échiquier (bois, marbre, couleur…), de nouvelles pièces (un set de Lichess, des SVG fournis), un style de flèche, ou change les couleurs d'un échiquier existant, même formulé comme « je voudrais un échiquier plus clair » ou « ajoute les pièces X ».
---

# Nouvel élément d'apparence

Chaque élément d'apparence est déclaré à plusieurs endroits qui doivent rester alignés ; en oublier un donne un choix invisible, un aperçu vide ou une image qui ne se charge pas hors ligne. Trouver les endroits exacts avec un échiquier ou un jeu existant comme repère :

```bash
grep -rn "cherry" js css style.css sw.js tests index.html
grep -rn "celtic" js css sw.js tests assets/pieces/CREDITS.md
```

## Échiquier

1. `js/core/settings.js` : ajouter l'id à `BOARD_THEMES`.
2. `js/core/settingsUI.js` : libellé français dans `BOARD_LABELS`.
3. `style.css` : `--board-light`, `--board-dark`, `--board-border` sous `html[data-board="<id>"]`. **Ne pas écrire d'accent** : `--ui-accent` et `--board-ring` sont dérivés de `--board-dark` (« HARMONISATION »).
4. Échiquier texturé : générer `assets/boards/<id>.webp` avec `npm i --no-save sharp && node scripts/gen-boards.mjs <id>` (ajouter son tirage dans le script), puis l'ajouter partout où figurent les autres textures : listes `html:is([data-board=…])` de `style.css`, fond `#board`, vignette `.theme-swatch`, `css/panels.css` (`.pn-board`), et la liste d'images de `sw.js`.
5. `tests/theme-matrix.html` : ajouter l'id à `BOARDS`.
6. `npm test` : `tests/theme.test.js` vérifie le contraste 4,5:1 de l'accent dérivé en clair et en sombre. S'il échoue, ajuster `--board-dark`, pas la formule.
7. Contrôle visuel : ouvrir `tests/theme-matrix.html` dans l'aperçu, en clair et en sombre.

## Jeu de pièces

1. **Licence d'abord** : la vérifier et la noter avant d'intégrer quoi que ce soit. Refuser un jeu sans licence claire.
2. SVG dans `assets/pieces/<id>/` (`wK.svg`… `bP.svg`, 12 fichiers), crédit dans `assets/pieces/CREDITS.md`.
3. `js/core/pieces.js` : entrée dans `PIECE_SETS` (`_def(id, libellé, auteur, licence)`, l'ordre est celui des Paramètres).
4. `js/core/settings.js` : id dans `PIECE_SET_IDS` (même liste que les clés de `PIECE_SETS`).
5. `sw.js` : id dans `SETS` pour la mise en cache hors ligne.
6. Vérifier les figurines dans la notation (`formatSan`, variables `--fig-*` posées par `applyPieceSet`) : un coup comme « Cf3 » doit afficher le cavalier du nouveau jeu.

## Style de flèches

1. `js/core/settings.js` : id dans `ARROW_STYLE_IDS` et libellé français dans `ARROW_STYLE_LABELS`.
2. `js/modules/openings/annotations.js` : rendu dans `drawArrows` (fonction pure, sans état global), en gérant `knight` (saut en L).
3. L'aperçu d'Apparence utilise la même fonction : le vérifier.
4. `tests/arrows.test.js` : un cas pour le nouveau style.

## Dans tous les cas

- Une image **remplacée** (même nom de fichier) impose d'incrémenter `VERSION` dans `sw.js`.
- Ne pas changer les défauts (Noyer + Maestro, ou Sauge + Merida pour les anciennes installations) sans que l'utilisateur le demande.
- Terminer par une capture de l'échiquier dans l'aperçu.
