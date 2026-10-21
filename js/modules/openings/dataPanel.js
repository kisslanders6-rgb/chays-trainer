/**
 * modules/openings/dataPanel.js
 * ──────────────────────────────────────────────────────────────────────────
 * Panneau « Données » : tout ce qui fait entrer ou sortir des fichiers, au même endroit.
 *   - sauvegarde complète (.json) : télécharger / restaurer
 *   - répertoire actif : importer un PGN, exporter en PGN, analyser une partie
 *   - corbeille
 * Ouvert depuis les Paramètres et le menu ⋮ des répertoires (accueil). La consultation et
 * l'édition des coups se font dans l'onglet Arbre (treeView.js).
 * Gère aussi la fermeture (clic extérieur, Échap) des fenêtres Données, PGN, Analyse et Corbeille.
 */

'use strict';

function showData() {
    renderDataPanel();
    document.getElementById('data-overlay').classList.remove('hidden');
}

function closeData() {
    document.getElementById('data-overlay').classList.add('hidden');
}

function renderDataPanel() {
    const el = document.getElementById('data-body');
    if (!el) return;
    const synced = typeof isCloudBackedUp === 'function' && isCloudBackedUp();
    const nTrash = loadTrash().length;
    const card = (action, icon, title, sub, extra = '') => `
        <button class="data-card" data-action="${action}"${extra}>
          <span class="data-ico">${ico(icon)}</span>
          <span class="data-txt"><b>${title}</b><small>${sub}</small></span>
        </button>`;

    el.innerHTML = `
        <div class="data-section">
          <div class="data-label">Sauvegarde complète</div>
          <div class="data-hint">${synced ? 'Vos données sont synchronisées avec votre compte ; un fichier reste utile comme copie de secours.'
                                          : 'Sans compte, vos données ne vivent que dans ce navigateur : gardez une copie.'}</div>
          <div class="data-grid">
            ${card('dataExportJson', 'download', 'Télécharger (.json)', 'Répertoires, statistiques, planning, finales')}
            ${card('dataImportJson', 'upload', 'Restaurer (.json)', 'Fusionne un fichier avec vos données')}
          </div>
        </div>
        <div class="data-section">
          <div class="data-label">Répertoire « ${escapeHtml(currentRepertoire)} »</div>
          <div class="data-hint">Le PGN échange vos lignes avec d'autres logiciels (sans statistiques).</div>
          <div class="data-grid">
            ${card('dataImportPgn', 'upload', 'Importer un PGN', 'Ajoute des lignes, variantes comprises')}
            ${card('dataExportPgn', 'download', 'Exporter en PGN', 'Blancs et Noirs, toutes les lignes')}
            ${card('dataReview', 'target', 'Analyser mes parties', 'Chess.com, Lichess ou PGN collé : déviations au répertoire')}
            ${card('dataTrash', 'trash', `Corbeille${nTrash ? ` (${nTrash})` : ''}`, 'Éléments supprimés, gardés 30 jours')}
          </div>
        </div>`;
}

registerActions({
    dataExportJson: () => { exportDB(); renderDataPanel(); },
    dataImportJson: () => importDBPrompt(),
    dataImportPgn:  () => { closeData(); showPgnImport(); },
    dataExportPgn:  () => exportPgn(),
    dataReview:     () => { closeData(); showGameReview(); },
    dataTrash:      () => { closeData(); showTrash(); }
});

// ─── RÉPERTOIRE CIBLE D'UN IMPORT ─────────────────────────────────────────────
// Les imports écrivent dans openingDB (répertoire actif, couleur playerColor). Depuis l'accueil, la base
// en mémoire peut être celle d'un autre répertoire : on la recharge. En partie (« Jouer »), une autre
// couleur relance la partie ; dans un autre mode (entraînement, finale…), on revient d'abord à l'accueil.

function _gameScreenShown() {
    const gs = document.getElementById('game-screen');
    return !!gs && gs.style.display !== 'none' && !gs.classList.contains('hidden');
}

function useRepertoireColor(color) {
    if (_gameScreenShown() && gameMode === 'play') {
        if (color !== playerColor) startGame(color);
        return;
    }
    if (_gameScreenShown()) goHome();
    playerColor = color;
    loadDB();
}

// Mode « Jouer » avec la couleur voulue (même répertoire), sans perdre la partie en cours si elle convient.
// Depuis l'accueil ou un autre mode (entraînement, finale…) : une partie neuve est ouverte.
function openPlay(color) {
    if (_gameScreenShown() && gameMode === 'play') {
        if (color !== playerColor) { playerColor = color; loadDB(); showGameScreen(color); }
        return;
    }
    if (_gameScreenShown()) goHome();
    startGame(color);
}

// ─── FERMETURE : clic extérieur et touche Échap ───────────────────────────────

(function initOverlayDismiss() {
    const close = {                                     // résolus à l'appel : pgn.js et gameReview.js se chargent après
        'data-overlay': () => closeData(), 'pgn-overlay': () => closePgnImport(),
        'review-overlay': () => closeGameReview(), 'trash-overlay': () => closeTrash()
    };
    Object.keys(close).forEach(id => {
        const overlay = document.getElementById(id);
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) close[id](); });
    });

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const hidden = id => document.getElementById(id).classList.contains('hidden');
        if (!hidden('help-overlay') || !hidden('settings-overlay')) return;   // aide / paramètres gèrent leur propre Échap
        if (!hidden('confirm-overlay')) { document.getElementById('confirm-cancel-btn').click(); return; }
        const open = ['trash-overlay', 'pgn-overlay', 'review-overlay', 'data-overlay'].find(id => !hidden(id));
        if (open) close[open]();
    });
})();
