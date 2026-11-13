/**
 * shell/viewRefresh.js
 * ──────────────────────────────────────────────────────────────────────────
 * Quels écrans redessiner quand les données changent sans passer par eux (synchronisation, corbeille, import).
 * Seul endroit qui connaît à la fois les événements du bus et les écrans.
 */

'use strict';

function _viewHidden(id) { const el = document.getElementById(id); return !el || el.classList.contains('hidden'); }

function refreshViews(keys) {
    if (!keys.length) return;
    const attempt = fn => { try { fn(); } catch (e) { reportError('synchro : rafraîchissement de l\'affichage', e); } };
    if ((keys.includes('chessTrainer_repertoires') || keys.includes('chessTrainer_repNotes')) && typeof loadRepertoireList === 'function') attempt(() => {
        if (!loadRepertoireList().includes(currentRepertoire)) currentRepertoire = DEFAULT_REPERTOIRE;
        if (typeof renderRepertoireList === 'function') renderRepertoireList();
    });
    if (typeof initStats === 'function')    attempt(initStats);
    if (typeof initTraining === 'function') attempt(initTraining);
    if (keys.includes('chessTrainer_endgames') && typeof initEndgame === 'function' && !_viewHidden('home-tab-endgame')) attempt(initEndgame);
    if (keys.includes('chessTrainer_trash') && typeof updateTrashBadges === 'function') attempt(() => {
        updateTrashBadges(); if (!_viewHidden('trash-overlay') && typeof renderTrash === 'function') renderTrash();
    });
    if (!_viewHidden('data-overlay') && typeof renderDataPanel === 'function') attempt(renderDataPanel);
    if (typeof refreshTree === 'function') attempt(refreshTree);
    if (keys.includes('chessTrainer_prefs') && typeof applySyncedPrefs === 'function') attempt(applySyncedPrefs);
}

Bus.on('data:changed', refreshViews);

// Positions vues en partie recalculées (lancement, parties récupérées) : le menu de l'Entraînement recompte.
Bus.on('seen:ready', () => { if (typeof initTraining === 'function' && !_viewHidden('home-tab-training')) initTraining(); });

// Parties relues au lancement (AutoReview, lot 5) : le plan d'Aujourd'hui et les écrans affichés se mettent à jour.
Bus.on('games:reviewed', () => {
    if (typeof renderHomeSummary === 'function') renderHomeSummary();
    if (typeof initStats === 'function' && !_viewHidden('home-tab-stats')) initStats();
    if (typeof OpeningsTab !== 'undefined') OpeningsTab.refresh();
});

Bus.on('data:imported', () => {
    renderRepertoireList();
    if (typeof refreshTree === 'function') refreshTree();
});

Bus.on('trash:restored', r => {
    if (r.type === 'repertoire') renderRepertoireList();
    else {
        if (r.rep === currentRepertoire && r.color === playerColor && document.getElementById('game-screen').style.display !== 'none') loadDB();
        if (typeof refreshTree === 'function') refreshTree();
    }
    initStats(); initTraining();
});
