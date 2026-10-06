/**
 * modules/endgame/endgame.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Finales : positions théoriques et logique spécifique aux finales
 * (ROI + Tour vs Roi, finales de pions, etc.).
 * Ce module sera développé dans une prochaine version.
 */

'use strict';

/**
 * Catalogue de positions de finales théoriques.
 * Chaque entrée fournit une FEN de départ et un objectif pédagogique.
 */
const ENDGAME_POSITIONS = [
    // Exemples à enrichir
    // { id: 'kr_vs_k',   fen: '8/8/8/8/8/8/1K6/R6k w - - 0 1', label: 'Tour + Roi vs Roi' },
    // { id: 'kq_vs_k',   fen: '8/8/8/8/8/8/1K6/Q6k w - - 0 1', label: 'Dame + Roi vs Roi' },
    // { id: 'kp_vs_k',   fen: '8/8/4k3/8/4P3/8/4K3/8 w - - 0 1', label: 'Finale de pion' },
];

/**
 * Initialise le module Finales.
 * Appelé par switchHomeTab('endgame').
 */
function initEndgame() {
    // Emplacement réservé — implémentation à venir.
}

/**
 * Lance une position de finale spécifique depuis ENDGAME_POSITIONS.
 * @param {string} id - Identifiant de la position
 */
function startEndgame(id) {
    const pos = ENDGAME_POSITIONS.find(p => p.id === id);
    if (!pos) return;
    parseFEN(pos.fen);
    moveHistory      = [];
    selected         = null; legalMoves = [];
    lastFrom         = -1; lastTo = -1;
    hintPiece        = null;
    awaitingPromotion = null;
    resetNavCursor();
    renderMoves();
    setStatus(`Finale : ${pos.label}`, 'info');
    renderBoard();
}