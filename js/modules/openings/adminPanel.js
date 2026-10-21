/**
 * modules/openings/adminPanel.js
 * ──────────────────────────────────────────────────────────────────────────
 * Panneau « Base de données d'ouvertures » : onglets de répertoire, liste des entrées,
 * modification / suppression / ajout manuel, fermeture des fenêtres Base, PGN, Analyse d'une partie et Corbeille.
 */

'use strict';

// ─── PANNEAU ADMIN ────────────────────────────────────────────────────────────

function formatLinePrefix(sans) {
    if (!sans.length) return '(position de départ)';
    let out = '';
    sans.forEach((san, i) => {
        if (i % 2 === 0) out += (Math.floor(i / 2) + 1) + '. ';
        out += san + ' ';
    });
    return out.trim();
}

function showAdmin() {
    renderAdminTabs();
    renderAdminEntries();
    document.getElementById('admin-overlay').classList.remove('hidden');
}

function renderAdminTabs() {
    const tabsEl = document.getElementById('admin-tabs');
    const list   = loadRepertoireList();
    tabsEl.innerHTML = list.map(name => `
    <div class="admin-tab ${name === currentRepertoire ? 'active' : ''}" role="button" tabindex="0"
         data-action="adminRepertoire" data-arg="${escapeHtml(name)}">${escapeHtml(name)}</div>`).join('');
}

registerActions({
    adminRepertoire: name => switchAdminRepertoire(name),
    adminSave: (key, el) => saveEntry(key, el.parentElement.querySelector('input').value),
    adminDelete: key => deleteEntry(key)
});

function switchAdminRepertoire(name) {
    if (name === currentRepertoire) return;
    currentRepertoire = name;
    loadDB();
    renderAdminTabs();
    renderAdminEntries();
}

function _adminRow(key, e, inputId, prefix) {
    const pct    = e.attempts ? Math.round(100 * e.failures / e.attempts) : 0;
    return `
        <div class="line-group">
          <div class="line-group-header"><span class="line-group-prefix">${prefix}</span></div>
          <div class="line-row">
            <span class="line-row-arrow">→ Réponse mémorisée :</span>
            <span class="line-row-move">${escapeHtml(e.san)}</span>
            <span title="erreurs / essais" style="font-size:11px;color:var(--text-dim);">${e.failures}/${e.attempts} · ${pct}%</span>
            <input id="${inputId}" value="${escapeHtml(e.move)}" title="Coup en notation UCI" aria-label="Coup en notation UCI">
            <button class="mini-btn mini-btn-ok" data-action="adminSave" data-arg="${escapeHtml(key)}" title="Enregistrer" aria-label="Enregistrer">✓</button>
            <button class="mini-btn mini-btn-del" data-action="adminDelete" data-arg="${escapeHtml(key)}" title="Supprimer" aria-label="Supprimer">✕</button>
          </div>
        </div>`;
}

function renderAdminEntries() {
    const el   = document.getElementById('admin-entries');
    const keys = Object.keys(openingDB);
    const info = `<div class="panel-sub">Répertoire actif : <strong style="color:var(--accent)">${escapeHtml(currentRepertoire)}</strong> · couleur <strong>${playerColor === 'w' ? 'Blancs' : 'Noirs'}</strong>. ${typeof isCloudBackedUp === 'function' && isCloudBackedUp()
        ? 'La base est enregistrée sur cet appareil et synchronisée avec votre compte.'
        : "La base est enregistrée dans ce navigateur, sur cet appareil uniquement : connectez-vous pour la synchroniser, ou téléchargez une sauvegarde (.json)."} Le PGN sert à échanger vos lignes avec d'autres logiciels (sans statistiques).</div>`;

    if (!keys.length) {
        el.innerHTML = info + "<div class=\"empty-note\">Base vide pour ce répertoire — jouez des parties pour l'enrichir.</div>";
        return;
    }

    const known   = keys.filter(k => openingDB[k].path).sort((a, b) => openingDB[a].path.length - openingDB[b].path.length);
    const orphans = keys.filter(k => !openingDB[k].path);

    let html = info;
    html += known.map((k, i) => {
        const sans = _pathToSans(openingDB[k].path);
        return _adminRow(k, openingDB[k], `edit-${i}`, formatLinePrefix(sans.slice(0, -1)));
    }).join('');

    if (orphans.length) {
        html += `<div class="panel-sub" style="margin-top:10px;">Entrées sans ligne connue (elles se rattachent automatiquement quand vous rejouez la ligne dans « Jouer ») :</div>`;
        html += orphans.map((k, i) => _adminRow(k, openingDB[k], `edit-orphan-${i}`,
            `<span style="font-size:10px;word-break:break-all;">${k}</span>`)).join('');
    }
    el.innerHTML = html;
}

function saveEntry(key, newMoveStr) {
    newMoveStr = (newMoveStr || '').trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(newMoveStr)) {
        alert('Format invalide. Utilisez la notation UCI, ex: e2e4 ou e7e8q (promotion).');
        return;
    }
    const old = openingDB[key];
    if (!old) return;
    if (newMoveStr !== old.move) {
        const san = _sanForKeyMove(key, newMoveStr);
        if (!san) { alert('Ce coup est impossible depuis cette position.'); return; }
        const apply = extra => {
            if (!trashEntries([key].concat(extra), 'coup remplacé')) return;      // ancien coup + branches orphelines conservés 30 jours
            extra.forEach(k => { delete openingDB[k]; });
            // Nouvelle réponse = nouvelles statistiques.
            const upd = { move: newMoveStr, san, attempts: 1, failures: 0, lastReviewed: Date.now() };
            if (old.path) { upd.path = old.path.slice(0, -1).concat(newMoveStr); upd.ply = upd.path.length; }
            openingDB[key] = upd;
            saveDB();
            noteChange(1 + extra.length);
            renderAdminEntries();
        };
        const orphans = findOrphans(key, newMoveStr);
        if (!orphans.length) { apply([]); return; }
        askConfirmChoice(_orphanMessage('modification', orphans.length),
            { cascade: `Modifier et nettoyer les ${orphans.length} coup(s) orphelin(s)`, solo: 'Modifier ce coup seulement' },
            () => apply(orphans), () => apply([]));
        return;
    }
    renderAdminEntries();
}

function deleteEntry(key) {
    const orphans = findOrphans(key, null);
    const done    = extra => { if (!_deleteEntries([key].concat(extra))) return; renderAdminEntries(); };
    if (!orphans.length) {
        askConfirm('Placer cette entrée dans la corbeille ? Elle restera restaurable pendant 30 jours.', () => done([]));
    } else {
        askConfirmChoice(_orphanMessage('suppression', orphans.length),
            { cascade: `Supprimer aussi les ${orphans.length} coup(s) orphelin(s)`, solo: 'Supprimer ce coup seulement' },
            () => done(orphans), () => done([]));
    }
}

function addManualEntry() {
    const fen  = prompt('Position (clé FEN, ex: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b) :');
    if (!fen) return;
    const key = fen.trim();
    if (key.split(' ')[1] !== playerColor) {
        alert(`Cette base est celle des ${playerColor === 'w' ? 'Blancs' : 'Noirs'} : la position doit être au trait des ${playerColor === 'w' ? 'Blancs (… w)' : 'Noirs (… b)'}.`);
        return;
    }
    if (openingDB[key]) { alert('Cette position existe déjà : une seule réponse est autorisée. Modifiez-la dans la liste.'); return; }
    const move = prompt('Coup en notation UCI (ex: e7e5) :');
    if (!move) return;
    const m = move.trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)) { alert('Format de coup invalide.'); return; }
    const san = _sanForKeyMove(key, m);
    if (!san) { alert('Ce coup est impossible depuis cette position.'); return; }
    openingDB[key] = { move: m, san, attempts: 1, failures: 0, lastReviewed: Date.now() };
    saveDB();
    noteChange(1);
    renderAdminEntries();
}

// Saut instantané en haut / en bas du panneau Base (l'en-tête reste visible).
function adminScroll(where) {
    const panel = document.querySelector('#admin-overlay .panel');
    panel.scrollTop = where === 'top' ? 0 : panel.scrollHeight;
}

function closeAdmin() {
    document.getElementById('admin-overlay').classList.add('hidden');
    if (typeof refreshTree === 'function') refreshTree();
}

// ─── OVERLAY BASE : fermeture par clic extérieur et touche Échap ──────────────

(function initOverlayDismiss() {
    ['admin-overlay', 'pgn-overlay', 'review-overlay', 'trash-overlay'].forEach(id => {
        const overlay = document.getElementById(id);
        overlay.addEventListener('mousedown', e => {
            if (e.target !== overlay) return;
            if (id === 'pgn-overlay') closePgnImport(); else if (id === 'review-overlay') closeGameReview(); else if (id === 'trash-overlay') closeTrash(); else closeAdmin();
        });
    });

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const hidden = id => document.getElementById(id).classList.contains('hidden');
        if (!hidden('help-overlay') || !hidden('settings-overlay')) return;   // aide / paramètres gèrent leur propre Échap
        if (!hidden('confirm-overlay')) { document.getElementById('confirm-cancel-btn').click(); return; }
        if (!hidden('trash-overlay')) { closeTrash(); return; }
        if (!hidden('pgn-overlay')) { closePgnImport(); return; }
        if (!hidden('review-overlay')) { closeGameReview(); return; }
        if (!hidden('admin-overlay')) closeAdmin();
    });
})();
