/**
 * board/modes.js
 * ──────────────────────────────────────────────────────────────────────────
 * Fiche de chaque mode de l'échiquier : ce qui diffère d'un mode à l'autre pour un coup, un clic, l'indice ou la navigation.
 * Jouer et l'aperçu sont décrits ici ; Entraînement, Finales et Analyse s'enregistrent depuis leur écran.
 *   inputBlocked()      l'échiquier ignore clics et glissés (aperçu, cinématique)
 *   backToLive()        true si toucher l'échiquier a seulement ramené au présent
 *   navBlocked()        ◀ ▶ gelés
 *   playsBothSides      les deux camps passent par onMove
 *   onMove(de, à, promo)  le coup est confié au mode (sinon : règle de Jouer)
 *   onHint(), onSolution()  indice et solution confiés au mode
 *   sessionCursor       séance : la navigation ne tronque rien, l'indice porte sur le présent
 *   movesLocked         barre de coups et flèches ← → inactives
 *   hintToSolution      un deuxième appui sur Indice montre la solution
 *   hintNote, solutionNote, solutionCost()  compléments de texte
 *   onNavigate()        la position affichée a changé
 *   engineArrows()      flèches ajoutées par le moteur
 */

'use strict';

const GameModes = (function () {
    const NO = () => false;
    const DEFAULTS = { inputBlocked: NO, backToLive: NO, navBlocked: NO, playsBothSides: false, sessionCursor: false, movesLocked: false, hintToSolution: false,
                       hintNote: '', solutionNote: '', solutionCost: () => '' };
    const table = {};
    const register = (name, hooks) => { table[name] = Object.assign({}, DEFAULTS, hooks); };

    register('play', { hintToSolution: true, hintNote: ' — Jouer ne compte rien' });
    register('preview', { inputBlocked: () => true });

    return { register, current: () => table[gameMode] || table.play };
})();
