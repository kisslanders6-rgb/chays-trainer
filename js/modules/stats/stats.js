/**
 * modules/stats/stats.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Statistiques, organisé autour de la prochaine action :
 *   1. « Aujourd'hui » : révisions dues de la portée choisie, avec un bouton qui lance la révision
 *      directement sur l'échiquier (training.js, startReviewQueue) ; les essais comptent comme partout.
 *   2. « Maîtrise » : part des positions maîtrisées et répartition par niveau ; la légende filtre la liste.
 *   3. « Points faibles » : les positions au plus fort taux d'erreur, avec leur échiquier.
 *   4. « Par ouverture » : positions regroupées par ouverture nommée (openingNames.js), triables et filtrables ;
 *      chaque position se révise ou s'affiche en aperçu.
 *   5. « Régularité » (tous répertoires) : série, calendrier de 5 semaines, réussite par semaine.
 * Portée : répertoire actif, Blancs, Noirs ou les deux (barre collante en tête de l'onglet).
 *
 * Six niveaux, utilisés partout (Statistiques, Entraînement, arbre du répertoire) ; r = failures / attempts :
 *   à retravailler  r > 50 %
 *   fragile         30 % < r ≤ 50 %
 *   en progrès      15 % < r ≤ 30 %
 *   solide          0 < r ≤ 15 %
 *   à confirmer     aucune erreur, moins de STATS_CONFIRM_TRIES essais
 *   maîtrisée       aucune erreur en STATS_CONFIRM_TRIES essais ou plus, ou « solide » réussie plusieurs
 *                   révisions d'affilée (intervalle de révision ≥ STATS_SOLID_DAYS jours, cf. recordReview)
 */

'use strict';

const STATS_WEAK_MIN      = 0.5;
const STATS_FRAGILE_MIN   = 0.3;
const STATS_PROGRESS_MIN  = 0.15;
const STATS_CONFIRM_TRIES = 3;
const STATS_SOLID_DAYS    = 7;
const STATS_LINE_ROWS     = 30;     // positions affichées par ouverture avant « Afficher les autres »
const STATS_WEAK_CARDS    = 3;
const STATS_REVIEW_EXTRA  = 10;     // positions proposées quand rien n'est dû
const STATS_SECONDS_PER_POSITION = 30;
const STATS_DAYS          = 30;
const STATS_HEAT_WEEKS    = 5;
const STATS_TREND_WEEKS   = 8;

// Du plus fragile au plus sûr (ordre des barres, des filtres et des listes).
const STATS_LEVELS = {
    weak:     { label: 'À retravailler', one: 'À retravailler', rule: 'plus d\'une erreur sur deux' },
    fragile:  { label: 'Fragiles',       one: 'Fragile',        rule: 'de 30 à 50 % d\'erreurs' },
    progress: { label: 'En progrès',     one: 'En progrès',     rule: 'de 15 à 30 % d\'erreurs' },
    solid:    { label: 'Solides',        one: 'Solide',         rule: 'moins de 15 % d\'erreurs' },
    unsure:   { label: 'À confirmer',    one: 'À confirmer',    rule: `aucune erreur, moins de ${STATS_CONFIRM_TRIES} essais` },
    mastered: { label: 'Maîtrisées',     one: 'Maîtrisée',      rule: `aucune erreur en ${STATS_CONFIRM_TRIES} essais ou plus, ou solide et réussie plusieurs révisions d'affilée` }
};
const STATS_LEVEL_ORDER = Object.keys(STATS_LEVELS);

let statsColor  = 'w';       // 'w' | 'b' | 'all'
let statsFilter = 'all';     // 'all' ou un niveau
let statsSort   = 'weak';    // 'weak' | 'due' | 'order' | 'size'
let statsOpen   = null;      // ouvertures dépliées (Set de clés) ; null : la plus fragile s'ouvre
let statsAll    = new Set(); // ouvertures dont toutes les positions sont affichées
let statsScope  = '';        // répertoire + couleur : les ouvertures dépliées se réinitialisent quand il change

function _level(e) {
    if (!e.failures) return e.attempts >= STATS_CONFIRM_TRIES ? 'mastered' : 'unsure';
    const r = e.failures / e.attempts;
    if (r > STATS_WEAK_MIN)     return 'weak';
    if (r > STATS_FRAGILE_MIN)  return 'fragile';
    if (r > STATS_PROGRESS_MIN) return 'progress';
    return e.attempts >= STATS_CONFIRM_TRIES && (e.interval || 0) >= STATS_SOLID_DAYS ? 'mastered' : 'solid';
}

// Repère de niveau : couleur ET forme (lisible sans distinguer les couleurs), cf. .lv-mark.
const _lvMark = l => `<i class="lv-mark lv-${l}" aria-hidden="true"></i>`;

// Barre de répartition ; counts : { niveau: nombre }.
function levelBarHTML(counts, cls) {
    return `<span class="lv-bar ${cls || ''}" aria-hidden="true">${STATS_LEVEL_ORDER.filter(l => counts[l])
        .map(l => `<i class="lv-${l}" style="flex:${counts[l]}" title="${STATS_LEVELS[l].label} : ${counts[l]}"></i>`).join('')}</span>`;
}

const _plural = (n, one, many) => `${n} ${n > 1 ? many || one + 's' : one}`;
const _sideName = c => ({ w: 'Blancs', b: 'Noirs', all: 'Blancs et Noirs' })[c];

// Repère du coup : « 4. e4 » (Blancs) ou « 4… e5 » (Noirs) ; masked : « 4. ? ».
function _moveLabel(e, masked) {
    if (!e.ply) return masked ? '?' : formatSan(e.san);
    const n = Math.ceil(e.ply / 2), w = e.ply % 2 === 1, san = masked ? '?' : formatSan(e.san, w ? 'w' : 'b');
    return w ? `${n}. ${san}` : `${n}… ${san}`;
}

// Échéance lisible : « dans 3 h », « dans 4 j ».
function _dueIn(t) {
    const min = Math.max(1, Math.round((t - Date.now()) / 60000));
    if (min < 60)   return `dans ${min} min`;
    if (min < 1440) return `dans ${Math.round(min / 60)} h`;
    return `dans ${Math.round(min / 1440)} j`;
}

// ─── POSITIONS ET OUVERTURES ──────────────────────────────────────────────────

function _statsRows() {
    const rows = [];
    (statsColor === 'all' ? ['w', 'b'] : [statsColor]).forEach(side => {
        const db = readDBFor(currentRepertoire, side);
        Object.keys(db).forEach(k => {
            const e = db[k];
            if (e.attempts > 0) rows.push({ k, e, side, lv: _level(e), path: e.path && e.path.length ? e.path : null });
        });
    });
    return rows;
}

const _lineLabels = {};
function _movesLabel(path) {
    const key = path.join(' ');
    if (!(key in _lineLabels)) {
        try { _lineLabels[key] = formatLinePrefix(_pathToSans(path)); } catch (err) { _lineLabels[key] = key; }
    }
    return _lineLabels[key];
}

// Ouverture de chaque position : l'entrée nommée la plus précise de son chemin. Une position dont toutes les
// suites enregistrées (même couleur) relèvent d'une seule ouverture plus précise rejoint cette ouverture :
// les coups communs d'une ligne restent avec elle, et seuls les vrais troncs communs forment leur propre groupe.
function _assignOpenings(rows) {
    rows.forEach(r => {
        r.op  = r.path ? openingNameOf(r.path) : null;
        r.pre = r.path ? r.path.join(' ') + ' ' : null;
    });
    rows.forEach(r => {
        if (!r.path) return;
        const deeper = new Map();
        rows.forEach(q => {
            if (q !== r && q.side === r.side && q.op && q.path && q.path.length > r.path.length && q.pre.startsWith(r.pre))
                deeper.set(q.op.name, q.op);
        });
        if (deeper.size !== 1) return;
        const only = deeper.values().next().value;
        if (!r.op || only.path.length > r.op.path.length) r.op = only;
    });
    rows.forEach(r => {
        if (r.op) { r.gName = r.op.name; r.gPath = r.op.path; }
        else if (r.path) { r.gPath = r.path.slice(0, 4); r.gName = _movesLabel(r.gPath); }
        else { r.gName = 'Autres positions'; r.gPath = []; }
        r.gKey = r.side + '|' + r.gName;
    });
}

// Plus fragiles d'abord : niveau, taux d'erreur, nombre d'essais, ordre du coup.
const _rate = r => r.e.failures / r.e.attempts;
const _byWorst = (a, b) => STATS_LEVEL_ORDER.indexOf(a.lv) - STATS_LEVEL_ORDER.indexOf(b.lv)
    || _rate(b) - _rate(a) || b.e.attempts - a.e.attempts || (a.e.ply || 0) - (b.e.ply || 0);

function _countLevels(list) {
    const c = {};
    STATS_LEVEL_ORDER.forEach(l => { c[l] = 0; });
    list.forEach(r => { c[r.lv]++; });
    return c;
}

// ─── ÉCHIQUIER MINIATURE ──────────────────────────────────────────────────────

// Position AVANT mon coup, orientée de mon côté ; le dernier coup adverse est surligné.
function _miniBoardHTML(r) {
    let cells = null, last = [];
    _withEngineSnapshot(() => {
        try {
            parseFEN(INIT_FEN);
            if (r.path) {
                const before = r.path.slice(0, -1);
                before.forEach(u => _applyUciRaw(u));
                const lm = before[before.length - 1];
                if (lm) last = [squareToIdx(lm.slice(0, 2)), squareToIdx(lm.slice(2, 4))];
            } else parseFEN(r.k);
            cells = board.slice();
        } catch (err) { cells = null; }
    });
    if (!cells) return '';
    let html = '';
    for (let i = 0; i < 64; i++) {
        const row = Math.floor(i / 8), col = i % 8;
        const sq = r.side === 'w' ? (7 - row) * 8 + col : row * 8 + (7 - col);
        const dark = (Math.floor(sq / 8) + sq % 8) % 2 === 0;
        const p = cells[sq];
        html += `<span class="${dark ? 'd' : 'l'}${last.includes(sq) ? ' hl' : ''}">${p && PIECE_SVG[p] ? PIECE_SVG[p] : ''}</span>`;
    }
    return `<div class="st-mini" role="img" aria-label="Position avant votre coup">${html}</div>`;
}

// ─── RÉGULARITÉ (tous répertoires) ────────────────────────────────────────────

// Jours consécutifs avec au moins un essai, en remontant depuis aujourd'hui (ou hier si rien aujourd'hui).
function _streak(act) {
    let n = 0, t = Date.now();
    if (!(act[dayStamp(t)] || {}).a) t -= DAY_MS;
    while ((act[dayStamp(t)] || {}).a) { n++; t -= DAY_MS; }
    return n;
}

// Jour à minuit, décalé de `days` jours (jours du calendrier : robuste aux changements d'heure).
const _dayStart = (t, days) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (days || 0)).getTime(); };

function _regularityHTML() {
    const act = readActivity(), now = Date.now(), today = _dayStart(now);
    const dayAt = t => act[dayStamp(t)] || { a: 0, f: 0 };
    let active = 0;
    for (let i = 0; i < STATS_DAYS; i++) if (dayAt(_dayStart(today, -i)).a) active++;
    const streak = _streak(act);

    // Calendrier : STATS_HEAT_WEEKS semaines du lundi au dimanche, la semaine en cours en dernier.
    const monday = _dayStart(today, -((new Date(today).getDay() + 6) % 7));
    const first  = _dayStart(monday, -7 * (STATS_HEAT_WEEKS - 1));
    const fmt = t => new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    let heat = '<span></span>' + ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span class="st-heat-d">${d}</span>`).join('');
    for (let w = 0; w < STATS_HEAT_WEEKS; w++) {
        heat += '<span></span>';
        for (let d = 0; d < 7; d++) {
            const t = _dayStart(first, w * 7 + d), a = dayAt(t).a;
            const cls = t > today ? 'future' : !a ? '' : a < 10 ? 'h1' : a < 25 ? 'h2' : 'h3';
            heat += `<i class="${cls}${t === today ? ' today' : ''}" title="${t > today ? '' : `${fmt(t)} : ${_plural(a, 'essai')}`}"></i>`;
        }
    }

    // Réussite par semaine (semaines sans essai : pas de point).
    const weeks = [];
    for (let w = STATS_TREND_WEEKS - 1; w >= 0; w--) {
        let a = 0, f = 0;
        for (let d = 0; d < 7; d++) { const x = dayAt(_dayStart(monday, -7 * w + d)); a += x.a; f += x.f; }
        weeks.push(a ? Math.round(100 * (a - f) / a) : null);
    }
    const pts = weeks.map((v, i) => ({ v, i })).filter(p => p.v !== null);
    let chart = '';
    if (pts.length >= 2) {
        const W = 260, H = 96, pl = 4, pr = 30, pt = 16, pb = 18;
        const lo = Math.max(0, Math.floor((Math.min(...pts.map(p => p.v)) - 5) / 10) * 10);
        const hi = Math.min(100, Math.max(lo + 20, Math.ceil((Math.max(...pts.map(p => p.v)) + 2) / 10) * 10));
        const x = i => pl + i * (W - pl - pr) / (STATS_TREND_WEEKS - 1), y = v => pt + (hi - v) * (H - pt - pb) / (hi - lo);
        const line = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
        const end = pts[pts.length - 1];
        const area = `${line}L${x(end.i).toFixed(1)},${H - pb}L${x(pts[0].i).toFixed(1)},${H - pb}Z`;
        const grid = [lo, (lo + hi) / 2, hi].map(v => `<line class="g" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${W - pr + 4}" y="${y(v) + 3}">${Math.round(v)} %</text>`).join('');
        const startLbl = new Date(_dayStart(monday, -7 * (STATS_TREND_WEEKS - 1))).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        chart = `<div class="st-trend"><span class="st-sub">Réussite par semaine</span>
            <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Réussite par semaine sur ${STATS_TREND_WEEKS} semaines, ${end.v} % cette semaine">
              ${grid}<path class="ar" d="${area}"/><path class="ln" d="${line}"/>
              ${pts.map(p => `<circle class="pt${p === end ? ' end' : ''}" cx="${x(p.i)}" cy="${y(p.v)}" r="${p === end ? 3.5 : 2.5}"/>`).join('')}
              <text class="vl" x="${x(end.i) - 5}" y="${y(end.v) - 8}" text-anchor="end">${end.v} %</text>
              <text class="ax" x="${x(0)}" y="${H - 4}">${startLbl}</text><text class="ax" x="${x(STATS_TREND_WEEKS - 1)}" y="${H - 4}" text-anchor="end">cette sem.</text>
            </svg></div>`;
    }

    // Maîtrise par couleur (répertoire actif).
    const bySide = ['w', 'b'].map(c => {
        const list = Object.values(readDBFor(currentRepertoire, c)).filter(e => e.attempts > 0);
        if (!list.length) return '';
        const pct = Math.round(100 * list.filter(e => _level(e) === 'mastered').length / list.length);
        return `<div class="st-cmp"><span>${c === 'w' ? 'Blancs' : 'Noirs'}</span><span class="st-cmp-bar"><i style="width:${pct}%"></i></span><b>${pct} %</b></div>`;
    }).join('');

    return `
        <div class="st-reg-kpis"><div><b>${_plural(streak, 'jour')}</b><span>d'affilée</span></div><div><b>${active} / ${STATS_DAYS}</b><span>jours actifs</span></div></div>
        <div class="st-heat" role="img" aria-label="Essais par jour sur ${STATS_HEAT_WEEKS} semaines">${heat}</div>
        <div class="st-heat-leg">moins <i></i><i class="h1"></i><i class="h2"></i><i class="h3"></i> plus</div>
        ${chart}
        ${bySide ? `<div class="st-cmps"><span class="st-sub">Maîtrise par couleur · ${escapeHtml(currentRepertoire)}</span>${bySide}</div>` : ''}`;
}

// ─── RENDU ────────────────────────────────────────────────────────────────────

function _renderStatsScope() {
    ['w', 'b', 'all'].forEach(c => {
        const seg = document.getElementById('stats-seg-' + c);
        if (seg) { seg.classList.toggle('active', c === statsColor); seg.setAttribute('aria-pressed', c === statsColor); }
    });
    const sel = document.getElementById('stats-rep');
    if (sel) {
        sel.innerHTML = loadRepertoireList().map(n => `<option value="${escapeHtml(n)}"${n === currentRepertoire ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('');
    }
    const info = document.getElementById('stats-info');
    if (info && !info.innerHTML) {
        info.innerHTML = `<p>Chaque position est celle où c'est à vous de jouer. Les chiffres viennent de vos coups dans « Jouer » et « Entraînement ».</p>
            <ul>${STATS_LEVEL_ORDER.map(l => `<li>${_lvMark(l)}<span><b>${STATS_LEVELS[l].one}</b> : ${STATS_LEVELS[l].rule}</span></li>`).join('')}</ul>`;
    }
}

function initStats() {
    const body = document.getElementById('stats-body');
    if (!body) return;
    _renderStatsScope();

    const rows = _statsRows();
    const reg  = Object.keys(readActivity()).length ? `<aside class="st-side"><section class="st-sec"><div class="st-h"><h3>Régularité</h3><span class="st-sub">Tous répertoires</span></div><div class="st-reg">${_regularityHTML()}</div></section></aside>` : '';

    if (!rows.length) {
        body.innerHTML = `<div class="st-main"><div class="empty-tab"><div class="empty-tab-icon">${ico('bar-chart', 'ico-xl')}</div>
            <div>Aucune donnée</div>
            <div class="empty-tab-sub">Jouez votre répertoire « ${escapeHtml(currentRepertoire)} »${statsColor === 'all' ? '' : ` avec les ${_sideName(statsColor)}`} pour voir apparaître vos statistiques.</div></div></div>` + reg;
        return;
    }

    const now = Date.now();
    const counts = _countLevels(rows);
    if (statsFilter !== 'all' && !counts[statsFilter]) statsFilter = 'all';     // le filtre actif s'est vidé

    // ── Aujourd'hui ──
    const due = rows.filter(r => isDue(r.e, now));
    const dueWeak = due.filter(r => r.lv === 'weak').length;
    const endTomorrow = _dayStart(now, 2);
    const tomorrow = rows.filter(r => { const d = dueOf(r.e); return d > now && d < endTomorrow; }).length;
    const next = due.length ? 0 : Math.min(...rows.map(r => dueOf(r.e)));
    const minutes = Math.max(1, Math.round(due.length * STATS_SECONDS_PER_POSITION / 60));
    const today = `
        <div class="vel-card vel-dark st-today">
            <span class="st-eyebrow">Aujourd'hui · ${_sideName(statsColor)}</span>
            ${due.length ? `
            <div class="st-big"><b>${due.length}</b><span>${due.length > 1 ? 'positions à réviser' : 'position à réviser'}</span></div>
            <div class="st-today-sub">Environ ${minutes} min${dueWeak ? ` · dont <b>${dueWeak} à retravailler</b>` : ''}</div>
            <button class="st-cta" data-action="statsReview" data-arg="due">Réviser maintenant ${ico('play')}</button>` : `
            <div class="st-big st-big-text"><b>À jour</b></div>
            <div class="st-today-sub">Prochaine révision ${_dueIn(next)}.</div>
            <button class="st-cta" data-action="statsReview" data-arg="weak">Revoir les plus fragiles ${ico('play')}</button>`}
            <span class="st-foot">Demain : ${_plural(tomorrow, 'position')}</span>
        </div>`;

    // ── Maîtrise ──
    const totA = rows.reduce((s, r) => s + r.e.attempts, 0), totF = rows.reduce((s, r) => s + r.e.failures, 0);
    const mastery = Math.round(100 * counts.mastered / rows.length);
    const legend = STATS_LEVEL_ORDER.map(l => `<button class="st-lg ${statsFilter === l ? 'active' : ''}" aria-pressed="${statsFilter === l}" data-action="statsLegend" data-arg="${l}" ${counts[l] ? '' : 'disabled'}>
            ${_lvMark(l)}<span>${STATS_LEVELS[l].label}</span><b>${counts[l]}</b></button>`).join('');
    const masteryCard = `
        <div class="vel-card vel-light st-mastery">
            <span class="st-eyebrow">Maîtrise · ${_plural(rows.length, 'position')}</span>
            <div class="st-big"><b>${mastery} %</b><span>maîtrisées</span></div>
            ${levelBarHTML(counts, 'st-mbar')}
            <div class="st-legend" role="group" aria-label="Filtrer la liste par niveau">${legend}</div>
            <span class="st-foot">Réussite : ${Math.round(100 * (totA - totF) / totA)} % sur ${_plural(totA, 'essai')}</span>
        </div>`;

    // ── Points faibles ──
    const weakest = rows.filter(r => r.lv === 'weak' || r.lv === 'fragile').sort((a, b) => _rate(b) - _rate(a) || b.e.attempts - a.e.attempts).slice(0, STATS_WEAK_CARDS);
    _assignOpenings(rows);
    const arg = r => escapeHtml(r.side + ':' + r.k);
    const weakHTML = !weakest.length ? '' : `
        <section class="st-sec">
            <div class="st-h"><h3>Points faibles</h3>${counts.weak ? `<button class="st-link" data-action="statsLegend" data-arg="weak">Tout voir</button>` : ''}</div>
            <div class="st-weak">${weakest.map(r => `
                <article class="st-wcard">
                    ${_miniBoardHTML(r)}
                    <span class="st-wcard-line">${statsColor === 'all' ? (r.side === 'w' ? 'Blancs · ' : 'Noirs · ') : ''}${escapeHtml(r.gName)}</span>
                    <span class="st-wcard-move"><b>${escapeHtml(_moveLabel(r.e, true))}</b><span>${_plural(r.e.failures, 'erreur')} / ${r.e.attempts}</span></span>
                    <span class="st-wcard-acts">
                        <button class="btn btn-primary st-btn" data-action="statsTrain" data-arg="${arg(r)}">${ico('play')}<span>S'entraîner</span></button>
                        <button class="btn st-btn st-ibtn" data-action="statsPreview" data-arg="${arg(r)}" title="Voir la position" aria-label="Voir la position">${ico('eye')}</button>
                    </span>
                </article>`).join('')}</div>
        </section>`;

    // ── Par ouverture ──
    const scope = currentRepertoire + '|' + statsColor;
    if (scope !== statsScope) { statsScope = scope; statsOpen = null; statsAll = new Set(); }
    const groups = {};
    rows.forEach(r => { (groups[r.gKey] = groups[r.gKey] || { key: r.gKey, side: r.side, name: r.gName, path: r.gPath, all: [], items: [] }).all.push(r); });
    Object.values(groups).forEach(g => { g.items = g.all.filter(r => statsFilter === 'all' || r.lv === statsFilter); g.counts = _countLevels(g.all); g.due = g.all.filter(r => isDue(r.e, now)).length; });
    const share = (g, l) => g.counts[l] / g.all.length;
    const sorters = {
        weak:  (a, b) => share(b, 'weak') - share(a, 'weak') || share(b, 'fragile') - share(a, 'fragile') || share(b, 'progress') - share(a, 'progress') || b.all.length - a.all.length,
        due:   (a, b) => b.due - a.due || sorters.weak(a, b),
        order: (a, b) => a.side.localeCompare(b.side) || a.path.join(' ').localeCompare(b.path.join(' ')),
        size:  (a, b) => b.all.length - a.all.length
    };
    const list = Object.values(groups).filter(g => g.items.length).sort(sorters[statsSort] || sorters.weak);
    if (!statsOpen || (statsOpen.size && ![...statsOpen].some(k => groups[k]))) statsOpen = new Set(list.length ? [list[0].key] : []);

    const chips = [['all', 'Toutes', rows.length], ...STATS_LEVEL_ORDER.map(l => [l, STATS_LEVELS[l].label, counts[l]])].map(([id, label, n]) =>
        `<button class="stats-chip ${statsFilter === id ? 'active' : ''} ${id === 'all' ? 'all' : 'lv-' + id}" aria-pressed="${statsFilter === id}" data-action="statsFilter" data-arg="${id}" ${n ? '' : 'disabled'}>
            ${id === 'all' ? '' : _lvMark(id)}${label} <b>${n}</b></button>`).join('');
    const sortSel = `<label class="st-sort"><span>Trier</span> <select data-change="statsSort" aria-label="Trier les ouvertures">${[['weak', 'Plus fragiles'], ['due', 'Plus de révisions dues'], ['order', 'Ordre des coups'], ['size', 'Plus de positions']]
        .map(([v, t]) => `<option value="${v}"${statsSort === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;

    const lines = list.map(g => {
        const open = statsOpen.has(g.key), items = g.items.slice().sort(_byWorst);
        const shown = open ? (statsAll.has(g.key) ? items : items.slice(0, STATS_LINE_ROWS)) : [];
        const rowsHTML = shown.map(r => {
            const d = isDue(r.e, now), pct = Math.round(100 * _rate(r));
            return `<div class="st-row">
                <span class="st-move">${escapeHtml(_moveLabel(r.e))}</span>
                <span class="st-lvl">${_lvMark(r.lv)}${STATS_LEVELS[r.lv].one}</span>
                <span class="st-errs lv-${r.lv}" title="${pct} % d'erreurs"><span class="st-rate" aria-hidden="true"><i style="width:${Math.max(3, pct)}%"></i></span><span class="st-n">${r.e.failures} err. / ${r.e.attempts}</span></span>
                <span class="st-when ${d ? 'on' : ''}">${d ? 'Due' : _dueIn(dueOf(r.e))}</span>
                <span class="st-acts">
                    <button class="st-ibtn pri" data-action="statsTrain" data-arg="${arg(r)}" title="S'entraîner sur cette position" aria-label="S'entraîner sur ${escapeHtml(_moveLabel(r.e))}">${ico('play')}</button>
                    <button class="st-ibtn" data-action="statsPreview" data-arg="${arg(r)}" title="Voir la position" aria-label="Voir ${escapeHtml(_moveLabel(r.e))}">${ico('eye')}</button>
                </span></div>`;
        }).join('');
        const more = open && items.length > shown.length
            ? `<button class="st-more" data-action="statsMore" data-arg="${escapeHtml(g.key)}">Afficher les ${items.length - shown.length} autres positions</button>` : '';
        const mastery = Math.round(100 * share(g, 'mastered'));
        return `<section class="st-line ${open ? 'open' : ''}">
            <button class="st-line-head" aria-expanded="${open}" data-action="statsLine" data-arg="${escapeHtml(g.key)}">
                <span class="st-line-name"><b>${statsColor === 'all' ? `<span class="st-line-side">${g.side === 'w' ? 'Blancs' : 'Noirs'}</span>` : ''}${escapeHtml(g.name)}</b>
                    ${g.path.length && g.name !== _movesLabel(g.path) ? `<small>${escapeHtml(_movesLabel(g.path))}</small>` : ''}</span>
                <span class="st-line-bar">${levelBarHTML(g.counts)}<span>${mastery} % · ${g.all.length} pos.</span></span>
                <span class="st-due ${g.due ? '' : 'none'}">${g.due ? g.due + ' à réviser' : 'à jour'}</span>
                ${ico('chevron-right')}
            </button>
            ${open ? `<div class="st-rows"><div class="st-row st-row-hd" aria-hidden="true"><span>Coup</span><span>Niveau</span><span>Erreurs</span><span>Révision</span><span></span></div>${rowsHTML}${more}</div>` : ''}
        </section>`;
    }).join('');

    body.innerHTML = `
        <div class="st-main">
            <section class="st-now">${today}${masteryCard}</section>
            ${weakHTML}
            <section class="st-sec" id="stats-lines">
                <div class="st-h"><div class="st-h-title"><h3>Par ouverture</h3><span class="st-sub">${_plural(list.length, 'ouverture')} · ${_sideName(statsColor)}</span></div>${sortSel}</div>
                <div class="stats-filters" role="group" aria-label="Filtrer par niveau">${chips}</div>
                <div class="st-lines">${lines || '<div class="empty-tab">Aucune position à ce niveau.</div>'}</div>
            </section>
        </div>${reg}`;
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────

function setStatsColor(c) {
    statsColor = c;
    statsFilter = 'all';
    initStats();
}

function _parseStatsArg(arg) {
    const i = arg.indexOf(':');
    return { side: arg.slice(0, i), key: arg.slice(i + 1) };
}

// Révision sur l'échiquier : positions dues de la portée (ou les plus fragiles si rien n'est dû),
// Blancs puis Noirs, les plus fragiles d'abord.
function startStatsReview(kind) {
    const rows = _statsRows(), now = Date.now();
    let pick = kind === 'due' ? rows.filter(r => isDue(r.e, now)) : rows.slice().sort(_byWorst).filter(r => r.lv !== 'mastered').slice(0, STATS_REVIEW_EXTRA);
    if (!pick.length) pick = rows.slice().sort(_byWorst).slice(0, STATS_REVIEW_EXTRA);
    pick.sort((a, b) => (a.side === b.side ? 0 : a.side === 'w' ? -1 : 1) || _byWorst(a, b));
    startReviewQueue(pick.map(r => ({ color: r.side, key: r.k })), 'stats');
}

registerActions({
    statsColor: c => setStatsColor(c),
    statsRep: (_, el) => { if (el.value !== currentRepertoire) selectRepertoire(el.value); },
    statsFilter: f => { statsFilter = (f !== 'all' && statsFilter === f) ? 'all' : f; initStats(); },
    statsLegend: f => {
        statsFilter = statsFilter === f ? 'all' : f;
        statsOpen = null;                                           // la première ouverture concernée s'ouvre
        initStats();
        const sec = document.getElementById('stats-lines');
        if (sec && statsFilter !== 'all') sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    statsSort: (_, el) => { statsSort = el.value; initStats(); },
    statsLine: k => { if (statsOpen.has(k)) statsOpen.delete(k); else statsOpen.add(k); initStats(); },
    statsMore: k => { statsAll.add(k); initStats(); },
    statsInfo: () => {
        const box = document.getElementById('stats-info'), btn = document.getElementById('stats-info-btn');
        box.hidden = !box.hidden;
        btn.setAttribute('aria-expanded', String(!box.hidden));
    },
    statsReview: kind => startStatsReview(kind),
    statsTrain: arg => { const { side, key } = _parseStatsArg(arg); startReviewQueue([{ color: side, key }], 'stats'); },
    statsPreview: arg => { const { side, key } = _parseStatsArg(arg); openStatsPreview(side, key); }
});

// La bulle d'aide se ferme au clic ailleurs ou avec Échap.
document.addEventListener('pointerdown', e => {
    const box = document.getElementById('stats-info');
    if (box && !box.hidden && !e.target.closest('#stats-info, #stats-info-btn')) {
        box.hidden = true;
        document.getElementById('stats-info-btn').setAttribute('aria-expanded', 'false');
    }
});
document.addEventListener('keydown', e => {
    const box = document.getElementById('stats-info');
    if (e.key === 'Escape' && box && !box.hidden) { box.hidden = true; document.getElementById('stats-info-btn').setAttribute('aria-expanded', 'false'); }
});

// Aperçu en lecture seule de la position AVANT mon coup ; le coup attendu reste masqué.
let statsPreviewTarget = null;
function openStatsPreview(side, key) {
    const e = readDBFor(currentRepertoire, side)[key];
    if (!e) return;
    statsPreviewTarget = { color: side, key };
    playerColor = side;
    gameMode    = 'preview';
    showGameScreen(side);
    if (e.path) {
        loadPositionFromPath(e.path.slice(0, -1));
    } else {
        loadPositionFromPath([]);
        parseFEN(key);
        renderBoard();
    }
    const pct = e.attempts ? Math.round(100 * e.failures / e.attempts) : 0;
    setStatus(`Aperçu · ${_moveLabel(e, true)}`, 'info', `${STATS_LEVELS[_level(e)].one} · ${pct} % d'erreurs (${e.failures}/${e.attempts}). Appuyez sur « S'entraîner » pour jouer le coup.`);
}

// Bouton « S'entraîner » de l'aperçu.
function trainStatsPreview() {
    if (statsPreviewTarget) startReviewQueue([statsPreviewTarget], 'stats');
}
