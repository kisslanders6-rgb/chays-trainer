/**
 * modules/stats/stats.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Statistiques : une pastille par position de mon camp, calculée à
 * partir des erreurs commises dans le menu « Jouer ».
 *   taux d'erreur = failures / attempts
 * Un clic sur une pastille affiche la position exacte sur l'échiquier.
 * En tête : activité dans le temps (série de jours, 30 derniers jours) d'après le journal
 * d'activité (storage.js), et nombre de positions dont la révision est due.
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

// ─── ACTIVITÉ DANS LE TEMPS ───────────────────────────────────────────────────
const STATS_DAYS = 30;

// Jours consécutifs avec au moins un essai, en remontant depuis aujourd'hui (ou hier si rien aujourd'hui).
function _streak(act) {
    let n = 0, t = Date.now();
    if (!(act[dayStamp(t)] || {}).a) t -= DAY_MS;
    while ((act[dayStamp(t)] || {}).a) { n++; t -= DAY_MS; }
    return n;
}

function _activityHTML(db) {
    const act  = readActivity();
    const days = [];
    for (let i = STATS_DAYS - 1; i >= 0; i--) {
        const t = Date.now() - i * DAY_MS, d = act[dayStamp(t)] || { a: 0, f: 0 };
        days.push({ t, a: d.a, f: d.f });
    }
    const total = days.reduce((s, d) => s + d.a, 0);
    const due   = Object.values(db).filter(e => isDue(e)).length;
    if (!total && !Object.keys(db).length) return '';

    const max  = Math.max(1, ...days.map(d => d.a));
    const fmt  = t => new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    const bars = days.map(d => {
        const ok = d.a - d.f;
        return `<div class="act-col" title="${fmt(d.t)} : ${d.a} essai${d.a > 1 ? 's' : ''}${d.f ? `, ${d.f} erreur${d.f > 1 ? 's' : ''}` : ''}">` +
               `<span class="act-err" style="height:${100 * d.f / max}%"></span><span class="act-ok" style="height:${100 * ok / max}%"></span></div>`;
    }).join('');
    const streak = _streak(act);
    const active = days.filter(d => d.a).length;
    return `
        <div class="act-card">
          <div class="act-head">
            <div class="act-kpi"><b>${streak}</b> jour${streak > 1 ? 's' : ''} d'affilée</div>
            <div class="act-kpi"><b>${active}</b>/${STATS_DAYS} jours actifs</div>
            <div class="act-kpi ${due ? 'due' : ''}"><b>${due}</b> à réviser</div>
          </div>
          <div class="act-chart" role="img" aria-label="Essais par jour sur ${STATS_DAYS} jours (tous répertoires)">${bars}</div>
          <div class="act-legend"><span><i class="act-dot ok"></i>réussites</span><span><i class="act-dot err"></i>erreurs</span><span class="act-note">30 derniers jours · tous répertoires</span></div>
        </div>`;
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
    const activity = _activityHTML(db);

    if (!rows.length) {
        body.innerHTML = activity + `<div class="empty-tab"><div class="empty-tab-icon">${ico('bar-chart', 'ico-xl')}</div>
            <div>Aucune donnée</div>
            <div class="empty-tab-sub">Jouez votre répertoire « ${escapeHtml(currentRepertoire)} » avec les ${statsColor === 'w' ? 'Blancs' : 'Noirs'} pour voir apparaître vos statistiques.</div></div>`;
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
        `<button class="stats-chip ${id === 'all' ? 'all' : ''} ${statsFilter === id ? 'active' : ''}" style="--c:${color}" aria-pressed="${statsFilter === id}" data-action="statsFilter" data-arg="${id}">
            <i class="stats-chip-dot"></i>${label} <b>${n}</b></button>`;
    const filters = '<div class="stats-filters">' +
        chip('all', 'Toutes', rows.length, 'var(--accent)') +
        Object.keys(_LEVELS).map(l => counts[l] ? chip(l, _LEVELS[l].label, counts[l], _LEVELS[l].color) : '').join('') +
        '</div>';

    const sort = `
        <div class="seg seg-sm" role="group" aria-label="Tri">
          <button class="seg-btn ${statsSort === 'worst' ? 'active' : ''}" data-action="statsSort" data-arg="worst">Pires d'abord</button>
          <button class="seg-btn ${statsSort === 'line'  ? 'active' : ''}" data-action="statsSort" data-arg="line">Ordre du répertoire</button>
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
        <div class="stat-badge" style="--c:${_statColor(rate)};--p:${ok ? 100 : pct}" role="button" tabindex="0" data-action="statsPreview" data-arg="${escapeHtml(k)}" title="${_LEVELS[lv].label} · voir la position">
          <div class="stat-ring"><div class="stat-ring-inner">
            <span class="stat-pct">${label}</span><span class="stat-lbl">${sub}</span>
          </div></div>
          <div class="stat-move">${escapeHtml(_moveLabel(e))}</div>
          <div class="stat-n">${e.failures} erreur${e.failures > 1 ? 's' : ''} / ${e.attempts} essai${e.attempts > 1 ? 's' : ''}</div>
        </div>`;
    }).join('');

    body.innerHTML = activity + kpis + bar + filters + sort +
        `<div class="stats-grid">${badges}</div>`;
}

registerActions({ statsFilter: f => setStatsFilter(f), statsSort: s => setStatsSort(s), statsPreview: k => openStatsPreview(k) });

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
    setStatus(`Aperçu · ${_moveLabel(e)}`, 'info', `${pct} % d'erreur (${e.failures}/${e.attempts})`);
}
