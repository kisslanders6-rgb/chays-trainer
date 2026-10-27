---
name: cloture-lot
description: Vérifications et commit de fin de travail sur Chays Trainer. À utiliser dès que l'utilisateur demande de commiter, de « finir » ou « clore » un lot, de préparer un commit ou une PR, de pousser, ou demande « c'est bon, on peut commiter ? », même s'il ne parle pas de vérification. Couvre la récupération d'origin/main, npm test, les invariants à ne pas oublier (CLAUDE.md, VERSION de sw.js, verdicts des finales, SQL Supabase) et le format du message de commit en français.
---

# Clore un lot

Un lot de Chays Trainer touche souvent une dizaine de fichiers. Les oublis coûteux ne se voient pas dans le diff : une clé non déclarée à la synchronisation, un cache qui garde l'ancienne image, un verdict de finale périmé. Cette liste existe pour les rattraper avant le commit, pas après.

## 1. Partir de la bonne base

L'utilisateur commite parfois directement sur GitHub (web). Avant tout commit :

```bash
git fetch origin && git status -sb
```

Si `main` est en retard sur `origin/main`, le dire et intégrer (`git pull --rebase` si l'arbre est propre, sinon demander) avant de continuer.

## 2. Passer en revue le diff contre les invariants

Lire `git diff --stat` puis le diff, et vérifier chaque point qui s'applique :

| Si le diff… | Alors vérifier |
|---|---|
| ajoute ou renomme une clé `localStorage`, un champ d'entrée, une préférence | la skill `nouvelle-donnee` a été suivie (normalizeEntry, combineSameMove, syncModel, réglage UI, test) |
| remplace une image existante (`assets/…`) | `VERSION` incrémentée dans `sw.js` |
| ajoute un script | il est dans `index.html`, à sa place dans l'ordre de chargement |
| modifie une FEN ou ajoute un exercice de finale jugé (sans `kind`) | `node scripts/check-endgames.mjs` relancé (réseau requis), bloc `ENDGAME_VERDICTS` à jour |
| modifie `supabase/schema.sql` | prévenir l'utilisateur qu'il doit exécuter le SQL lui-même dans Supabase (dire quelle partie) |
| modifie `style.css` sur les couleurs d'échiquier ou d'accent | `tests/theme.test.js` passe (contrastes 4,5:1) |
| ajoute un nom global | un seul par script (`globals.test.js`) |
| insère du texte en HTML | `escapeHtml`, et jamais `escapeHtml(formatSan(…))` |
| ajoute une règle métier | un test correspondant dans `tests/` |
| ajoute une clé, un nom global, un onglet ou une règle métier | **CLAUDE.md mis à jour dans le même commit** (section concernée, et « État et chantiers » si c'est un lot) |

Signaler à l'utilisateur ce qui manque plutôt que de le corriger en silence quand la correction change le comportement.

## 3. Tester

```bash
npm test
```

Tout doit passer. En cas d'échec, montrer la sortie de l'échec, corriger, relancer. Si le changement est visible dans l'application, le vérifier aussi dans l'aperçu (`.claude/launch.json`, port 8080) : console sans erreur, écran concerné affiché.

## 4. Message de commit

En français, dans le style des commits existants :

- Titre : les deux ou trois changements principaux, séparés par des virgules, sans point final. Ex. « Finales jugées par Syzygy et le moteur, adversaire calculé, Statistiques reliées à l'Entraînement ».
- Ligne vide, puis une puce `- ` par changement visible pour l'utilisateur ou par règle nouvelle, avec les noms de fichiers ou de fonctions entre parenthèses quand ils aident.
- Les tests ajoutés en dernière puce (« Tests : … »).
- Terminer par la ligne d'attribution demandée par l'environnement.

Utiliser un heredoc pour garder les accents et les guillemets « ».

## 5. Après le commit

Ne pas pousser sans que l'utilisateur l'ait demandé. Rappeler ce qui reste à faire de son côté (SQL Supabase à exécuter, vérification sur téléphone…). Si le lot fait partie de la feuille de route, mettre à jour la mémoire `feuille-de-route-decisions`.
