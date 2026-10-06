/**
 * modules/stats/stats.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Statistiques : une pastille par position de mon camp, calculée à
 * partir des erreurs commises dans le menu « Jouer ».
 *   taux d'erreur = failures / attempts
 * Un clic sur une pastille affiche la position exacte sur l'échiquier.
 */

'use strict';

let statsColor = 'w';

function setStatsColor(c) {
    statsColor = c;
    initStats();
}

function _statColor(rate) {
    if (rate === 0)    return 'var(--ok)';
    if (rate <= 0.34)  return '#d9a21b';
    return 'var(--err)';
}

// Repère du coup : « 4. e4 » (Blancs) ou « 4... e5 » (Noirs).
function _moveLabel(e) {
    if (!e.ply) return e.san;
    const n = Math.ceil(e.ply / 2);
    return e.ply % 2 === 1 ? `${n}. ${e.san}` : `${n}... ${e.san}`;
}

function initStats() {
    const body = document.getElementById('stats-body');
    if (!body) return;

    ['w', 'b'].forEach(c => {
        const seg = document.getElementById('stats-seg-' + c);
        if (seg) seg.classList.toggle('active', c === statsColor);
    });

    const db   = readDBFor(currentRepertoire, statsColor);
    const rows = Object.keys(db).map(k => ({ k, e: db[k] })).filter(r => r.e.attempts > 0);

    if (!rows.length) {
        body.innerHTML = `<div class="empty-tab"><div class="empty-tab-icon">📊</div>
            <div>Aucune donnée</div>
            <div class="empty-tab-sub">Jouez votre répertoire « ${currentRepertoire} » avec les ${statsColor === 'w' ? 'Blancs' : 'Noirs'} pour voir apparaître vos statistiques.</div></div>`;
        return;
    }

    rows.sort((a, b) =>
        (b.e.failures / b.e.attempts) - (a.e.failures / a.e.attempts)
        || b.e.attempts - a.e.attempts
        || (a.e.ply || 0) - (b.e.ply || 0));

    const totA = rows.reduce((s, r) => s + r.e.attempts, 0);
    const totF = rows.reduce((s, r) => s + r.e.failures, 0);
    const weak = rows.filter(r => r.e.failures > 0).length;

    const badges = rows.map(({ k, e }) => {
        const rate  = e.failures / e.attempts;
        const pct   = Math.round(rate * 100);
        const ok    = e.failures === 0;
        const label = ok ? '100%' : pct + '%';
        const sub   = ok ? 'de réussite' : "d'erreur";
        return `
        <div class="stat-badge" style="--c:${_statColor(rate)};--p:${ok ? 100 : pct}" onclick="openStatsPreview('${k}')" title="Voir la position">
          <div class="stat-ring"><div class="stat-ring-inner">
            <span class="stat-pct">${label}</span><span class="stat-lbl">${sub}</span>
          </div></div>
          <div class="stat-move">${_moveLabel(e)}</div>
          <div class="stat-n">${e.failures} erreur${e.failures > 1 ? 's' : ''} / ${e.attempts} essai${e.attempts > 1 ? 's' : ''}</div>
        </div>`;
    }).join('');

    body.innerHTML = `
        <div class="stats-summary">
          <span><strong>${rows.length}</strong> position${rows.length > 1 ? 's' : ''}</span>
          <span><strong>${weak}</strong> à retravailler</span>
          <span>Erreur globale : <strong>${Math.round(100 * totF / totA)}%</strong></span>
        </div>
        <div class="stats-grid">${badges}</div>`;
}

// Aperçu en lecture seule de la position AVANT mon coup.
function openStatsPreview(key) {
    const e = readDBFor(currentRepertoire, statsColor)[key];
    if (!e) return;
    playerColor = statsColor;
    gameMode    = 'preview';
    showGameScreen(statsColor);
    if (e.path) {
        loadPositionFromPath(e.path.slice(0, -1));
    } else {
        loadPositionFromPath([]);
        parseFEN(key);
        renderBoard();
    }
    const pct = e.attempts ? Math.round(100 * e.failures / e.attempts) : 0;
    setStatus(`Aperçu · ${_moveLabel(e)} · ${pct}% d'erreur (${e.failures}/${e.attempts})`, 'info');
}
