/**
 * modules/stats/stats.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Statistiques : une pastille par position de mon camp, calculée à
 * partir des erreurs commises dans le menu « Jouer ».
 *   taux d'erreur = failures / attempts
 * Un clic sur une pastille affiche la position exacte sur l'échiquier.
 *
 * Trois niveaux, utilisés partout (couleur de la pastille, répartition, filtres) :
 *   maîtrisée      aucune erreur
 *   fragile        taux d'erreur ≤ STATS_FRAGILE_MAX
 *   à retravailler taux d'erreur >  STATS_FRAGILE_MAX
 */

'use strict';

const STATS_FRAGILE_MAX = 0.34;

const _LEVELS = {
    mastered: { label: 'Maîtrisées',     color: 'var(--ok)' },
    fragile:  { label: 'Fragiles',       color: '#d9a21b' },
    weak:     { label: 'À retravailler', color: 'var(--err)' }
};

let statsColor  = 'w';
let statsFilter = 'all';     // 'all' | 'mastered' | 'fragile' | 'weak'
let statsSort   = 'worst';   // 'worst' (pires d'abord) | 'line' (ordre du répertoire)

function setStatsColor(c) {
    statsColor = c;
    initStats();
}

function setStatsFilter(f) {
    statsFilter = (f !== 'all' && statsFilter === f) ? 'all' : f;   // recliquer sur un filtre actif le retire
    initStats();
}

function setStatsSort(s) {
    statsSort = s;
    initStats();
}

function _level(e) {
    if (!e.failures) return 'mastered';
    return e.failures / e.attempts <= STATS_FRAGILE_MAX ? 'fragile' : 'weak';
}

function _statColor(rate) {
    if (rate === 0)                 return _LEVELS.mastered.color;
    if (rate <= STATS_FRAGILE_MAX)  return _LEVELS.fragile.color;
    return _LEVELS.weak.color;
}

// Repère du coup : « 4. e4 » (Blancs) ou « 4... e5 » (Noirs).
function _moveLabel(e) {
    if (!e.ply) return e.san;
    const n = Math.ceil(e.ply / 2);
    return e.ply % 2 === 1 ? `${n}. ${e.san}` : `${n}... ${e.san}`;
}

function _sortRows(rows) {
    if (statsSort === 'line') {
        rows.sort((a, b) => (a.e.ply || 1e9) - (b.e.ply || 1e9));
    } else {
        rows.sort((a, b) =>
            (b.e.failures / b.e.attempts) - (a.e.failures / a.e.attempts)
            || b.e.attempts - a.e.attempts
            || (a.e.ply || 0) - (b.e.ply || 0));
    }
    return rows;
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
        body.innerHTML = `<div class="empty-tab"><div class="empty-tab-icon">${ico('bar-chart', 'ico-xl')}</div>
            <div>Aucune donnée</div>
            <div class="empty-tab-sub">Jouez votre répertoire « ${_esc(currentRepertoire)} » avec les ${statsColor === 'w' ? 'Blancs' : 'Noirs'} pour voir apparaître vos statistiques.</div></div>`;
        return;
    }

    // Répartition par niveau et totaux (calculés sur TOUTES les positions, filtre ou non).
    const counts = { mastered: 0, fragile: 0, weak: 0 };
    rows.forEach(r => { r.lv = _level(r.e); counts[r.lv]++; });
    const totA = rows.reduce((s, r) => s + r.e.attempts, 0);
    const totF = rows.reduce((s, r) => s + r.e.failures, 0);
    const success = Math.round(100 * (totA - totF) / totA);

    if (statsFilter !== 'all' && !counts[statsFilter]) statsFilter = 'all';   // le filtre actif s'est vidé

    // ── Résumé : trois chiffres + barre de répartition ──
    const kpis = `
        <div class="stats-kpis">
          <div class="stats-kpi"><span class="stats-kpi-n">${success}%</span><span class="stats-kpi-l">de réussite</span></div>
          <div class="stats-kpi"><span class="stats-kpi-n">${rows.length}</span><span class="stats-kpi-l">position${rows.length > 1 ? 's' : ''} jouée${rows.length > 1 ? 's' : ''}</span></div>
          <div class="stats-kpi"><span class="stats-kpi-n">${totA}</span><span class="stats-kpi-l">essai${totA > 1 ? 's' : ''}</span></div>
        </div>`;
    const bar = '<div class="stats-bar" role="img" aria-label="Répartition des positions par niveau">' +
        Object.keys(_LEVELS).filter(l => counts[l]).map(l =>
            `<span class="stats-bar-seg" style="--c:${_LEVELS[l].color};flex:${counts[l]}" title="${_LEVELS[l].label} : ${counts[l]}"></span>`).join('') +
        '</div>';

    // ── Filtres (la légende de la barre sert de filtre) ──
    const chip = (id, label, n, color) =>
        `<button class="stats-chip ${id === 'all' ? 'all' : ''} ${statsFilter === id ? 'active' : ''}" style="--c:${color}" aria-pressed="${statsFilter === id}" onclick="setStatsFilter('${id}')">
            <i class="stats-chip-dot"></i>${label} <b>${n}</b></button>`;
    const filters = '<div class="stats-filters">' +
        chip('all', 'Toutes', rows.length, 'var(--accent)') +
        Object.keys(_LEVELS).map(l => counts[l] ? chip(l, _LEVELS[l].label, counts[l], _LEVELS[l].color) : '').join('') +
        '</div>';

    const sort = `
        <div class="seg seg-sm" role="group" aria-label="Tri">
          <button class="seg-btn ${statsSort === 'worst' ? 'active' : ''}" onclick="setStatsSort('worst')">Pires d'abord</button>
          <button class="seg-btn ${statsSort === 'line'  ? 'active' : ''}" onclick="setStatsSort('line')">Ordre du répertoire</button>
        </div>`;

    // ── Pastilles ──
    const shown = _sortRows(rows.filter(r => statsFilter === 'all' || r.lv === statsFilter));
    const badges = shown.map(({ k, e, lv }) => {
        const rate  = e.failures / e.attempts;
        const pct   = Math.round(rate * 100);
        const ok    = e.failures === 0;
        const label = ok ? '100%' : pct + '%';
        const sub   = ok ? 'de réussite' : "d'erreur";
        return `
        <div class="stat-badge" style="--c:${_statColor(rate)};--p:${ok ? 100 : pct}" onclick="openStatsPreview('${k}')" title="${_LEVELS[lv].label} · voir la position">
          <div class="stat-ring"><div class="stat-ring-inner">
            <span class="stat-pct">${label}</span><span class="stat-lbl">${sub}</span>
          </div></div>
          <div class="stat-move">${_moveLabel(e)}</div>
          <div class="stat-n">${e.failures} erreur${e.failures > 1 ? 's' : ''} / ${e.attempts} essai${e.attempts > 1 ? 's' : ''}</div>
        </div>`;
    }).join('');

    body.innerHTML = kpis + bar + filters + sort +
        `<div class="stats-grid">${badges}</div>`;
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
