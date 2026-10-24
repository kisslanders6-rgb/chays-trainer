/**
 * modules/stats/stats.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Statistiques : les positions de mon camp, regroupées par ligne d'ouverture (les
 * STATS_LINE_PLIES premiers demi-coups du chemin enregistré), les lignes les plus fragiles en tête.
 * Chaque ligne montre sa répartition par niveau et ses révisions dues ; ouverte, elle liste ses
 * positions en lignes compactes, des plus fragiles aux plus sûres.
 *   taux d'erreur = failures / attempts
 * Un clic sur une position affiche la position exacte sur l'échiquier.
 * En tête : activité dans le temps (série de jours, 30 derniers jours) d'après le journal
 * d'activité (storage.js), et nombre de positions dont la révision est due.
 *
 * Trois niveaux, utilisés partout (couleur des positions, répartition, filtres) :
 *   maîtrisée      aucune erreur
 *   fragile        taux d'erreur ≤ STATS_FRAGILE_MAX
 *   à retravailler taux d'erreur >  STATS_FRAGILE_MAX
 */

'use strict';

const STATS_FRAGILE_MAX = 0.34;
const STATS_LINE_PLIES  = 4;       // profondeur du regroupement par ligne
const STATS_LINE_ROWS   = 30;      // positions affichées par ligne avant « Afficher les autres »

const _LEVELS = {
    mastered: { label: 'Maîtrisées',     color: 'var(--ok)' },
    fragile:  { label: 'Fragiles',       color: '#d9a21b' },
    weak:     { label: 'À retravailler', color: 'var(--err)' }
};

let statsColor  = 'w';
let statsFilter = 'all';     // 'all' | 'mastered' | 'fragile' | 'weak'
let statsOpen   = null;      // lignes ouvertes (Set de clés) ; null : la plus fragile s'ouvre
let statsAll    = new Set(); // lignes dont toutes les positions sont affichées
let statsScope  = '';        // répertoire + couleur : les lignes ouvertes se réinitialisent quand il change

function setStatsColor(c) {
    statsColor = c;
    initStats();
}

function setStatsFilter(f) {
    statsFilter = (f !== 'all' && statsFilter === f) ? 'all' : f;   // recliquer sur un filtre actif le retire
    initStats();
}

function toggleStatsLine(key) {
    if (statsOpen.has(key)) statsOpen.delete(key); else statsOpen.add(key);
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
    if (!e.ply) return formatSan(e.san);
    const n = Math.ceil(e.ply / 2), san = formatSan(e.san, e.ply % 2 === 1 ? 'w' : 'b');
    return e.ply % 2 === 1 ? `${n}. ${san}` : `${n}... ${san}`;
}

// Ligne d'ouverture d'une position : clé (premiers demi-coups UCI) et libellé lisible (« 1. e4 c5 2. Nf3 d6 »).
const _lineLabels = {};
function _lineOf(e) {
    if (!e.path || !e.path.length) return { key: '', label: 'Autres positions' };
    if (e.path.length - 1 < STATS_LINE_PLIES) return { key: '#debut', label: 'Premiers coups' };
    const pre = e.path.slice(0, STATS_LINE_PLIES);
    const key = pre.join(' ');
    if (!(key in _lineLabels)) {
        try { _lineLabels[key] = formatLinePrefix(_pathToSans(pre)); } catch (err) { _lineLabels[key] = key; }
    }
    return { key, label: _lineLabels[key] };
}

// Plus fragiles d'abord : taux d'erreur, puis nombre d'essais, puis ordre du coup.
const _byWorst = (a, b) => (b.e.failures / b.e.attempts) - (a.e.failures / a.e.attempts) || b.e.attempts - a.e.attempts || (a.e.ply || 0) - (b.e.ply || 0);

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
    const now = Date.now(), due = rows.filter(r => isDue(r.e, now)).length;

    // ── Résumé : quatre chiffres + barre de répartition ──
    const kpi = (n, l) => `<div class="stats-kpi"><span class="stats-kpi-n">${n}</span><span class="stats-kpi-l">${l}</span></div>`;
    const kpis = '<div class="stats-kpis st-kpis">' + kpi(success + ' %', 'de réussite')
        + kpi(rows.length, `position${rows.length > 1 ? 's' : ''} jouée${rows.length > 1 ? 's' : ''}`)
        + kpi(due, 'à réviser') + kpi(counts.weak, 'à retravailler') + '</div>';
    const barOf = list => Object.keys(_LEVELS).map(l => { const n = list.filter(r => r.lv === l).length;
        return n ? `<span class="stats-bar-seg" style="--c:${_LEVELS[l].color};flex:${n}" title="${_LEVELS[l].label} : ${n}"></span>` : ''; }).join('');
    const bar = `<div class="stats-bar" role="img" aria-label="Répartition des positions par niveau">${barOf(rows)}</div>`;

    // ── Filtres (la légende de la barre sert de filtre) ──
    const chip = (id, label, n, color) =>
        `<button class="stats-chip ${id === 'all' ? 'all' : ''} ${statsFilter === id ? 'active' : ''}" style="--c:${color}" aria-pressed="${statsFilter === id}" data-action="statsFilter" data-arg="${id}">
            <i class="stats-chip-dot"></i>${label} <b>${n}</b></button>`;
    const filters = '<div class="stats-filters">' +
        chip('all', 'Toutes', rows.length, 'var(--accent)') +
        Object.keys(_LEVELS).map(l => counts[l] ? chip(l, _LEVELS[l].label, counts[l], _LEVELS[l].color) : '').join('') +
        '</div>';

    // ── Lignes d'ouverture ──
    const scope = currentRepertoire + '|' + statsColor;
    if (scope !== statsScope) { statsScope = scope; statsOpen = null; statsAll = new Set(); }
    const groups = {};
    rows.filter(r => statsFilter === 'all' || r.lv === statsFilter).forEach(r => {
        const { key, label } = _lineOf(r.e);
        (groups[key] = groups[key] || { key, label, items: [] }).items.push(r);
    });
    const share = (g, l) => g.items.filter(r => r.lv === l).length / g.items.length;
    const list = Object.values(groups).sort((a, b) =>
        share(b, 'weak') - share(a, 'weak') || share(b, 'fragile') - share(a, 'fragile') || b.items.length - a.items.length);
    if (!statsOpen || (statsOpen.size && ![...statsOpen].some(k => groups[k]))) {     // première vue, ou lignes ouvertes disparues
        statsOpen = new Set(list.length ? [list[0].key] : []);
    }

    const lines = list.map(g => {
        const open = statsOpen.has(g.key), items = g.items.slice().sort(_byWorst);
        const mastery = Math.round(100 * share(g, 'mastered')), gDue = items.filter(r => isDue(r.e, now)).length;
        const shown = open ? (statsAll.has(g.key) ? items : items.slice(0, STATS_LINE_ROWS)) : [];
        const rowsHTML = shown.map(({ k, e, lv }) => {
            const rate = e.failures / e.attempts, d = isDue(e, now);
            return `<div class="st-row" role="button" tabindex="0" style="--c:${_LEVELS[lv].color}" data-action="statsPreview" data-arg="${escapeHtml(k)}" title="${_LEVELS[lv].label} · voir la position">
                <span class="st-move">${escapeHtml(_moveLabel(e))}</span>
                <span class="st-rate" aria-hidden="true"><i style="width:${Math.max(4, Math.round(rate * 100))}%"></i></span>
                <span class="st-n">${e.failures}/${e.attempts}</span>
                <span class="st-due ${d ? 'on' : ''}" title="${d ? 'À réviser' : 'Pas encore due'}"></span></div>`;
        }).join('');
        const more = open && items.length > shown.length
            ? `<button class="st-more" data-action="statsMore" data-arg="${escapeHtml(g.key)}">Afficher les ${items.length - shown.length} autres positions</button>` : '';
        return `<section class="st-line ${open ? 'open' : ''}">
            <button class="st-line-head" aria-expanded="${open}" data-action="statsLine" data-arg="${escapeHtml(g.key)}">
                <span class="st-line-name">${escapeHtml(g.label)}</span>
                <span class="stats-bar st-line-bar" aria-hidden="true">${barOf(g.items)}</span>
                <span class="st-line-meta">${g.items.length} pos. · ${mastery} %${gDue ? ` · <b>${gDue} à réviser</b>` : ''}${ico('chevron-right')}</span>
            </button>
            ${open ? `<div class="st-rows">${rowsHTML}${more}</div>` : ''}
        </section>`;
    }).join('');

    body.innerHTML = activity + kpis + bar + filters + `<div class="st-lines">${lines}</div>`;
}

registerActions({
    statsFilter: f => setStatsFilter(f),
    statsLine: k => toggleStatsLine(k),
    statsMore: k => { statsAll.add(k); initStats(); },
    statsPreview: k => openStatsPreview(k)
});

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
