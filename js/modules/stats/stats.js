/**
 * modules/stats/stats.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Statistiques, organisé autour de la prochaine action :
 * Les Statistiques observent, l'Entraînement agit : les boutons d'action ouvrent l'exercice d'Entraînement
 * correspondant, déjà filtré (openTrainingFrom, trainingUI.js), sans lancer de séance.
 *   1. « Aujourd'hui » : révisions dues de la portée choisie ; lien vers Entraînement › Révision du jour.
 *   2. « Maîtrise » : part des positions maîtrisées et répartition par niveau ; la légende filtre la liste.
 *      « À confirmer » (trop peu d'essais) est un état à part, hors des barres de niveaux.
 *   3. « Points faibles » : liste des positions au plus fort taux d'erreur ; lien vers Entraînement › Points faibles.
 *   4. « Par ouverture » : positions regroupées par ouverture nommée (openingNames.js), triables et filtrables ;
 *      chaque position s'affiche en aperçu ou se travaille seule ; « Réviser cette ouverture » ouvre la
 *      Révision du jour filtrée sur elle.
 *   5. « Régularité, tous répertoires » : série, calendrier de 5 semaines, réussite par semaine.
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
const STATS_SECONDS_PER_POSITION = 30;
const STATS_DAYS          = 30;
const STATS_HEAT_WEEKS    = 12;     // calendrier : une colonne par semaine, il défile sur petit écran
const STATS_PHONE_LINES   = 5;      // téléphone : ouvertures montrées avant « Tout voir »
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
// « À confirmer » est un état (trop peu d'essais pour juger), pas un niveau de maîtrise : il reste hors des barres.
const STATS_STATE = 'unsure';
const STATS_MASTERY_LEVELS = STATS_LEVEL_ORDER.filter(l => l !== STATS_STATE);

let statsColor  = 'all';     // 'w' | 'b' | 'all' ; « Les deux » à chaque lancement
let statsFilter = 'all';     // 'all' ou un niveau
let statsSort   = 'weak';    // 'weak' | 'due' | 'order' | 'size'
let statsOpen   = null;      // ouvertures dépliées (Set de clés) ; null : la plus fragile s'ouvre
let statsAll    = new Set(); // ouvertures dont toutes les positions sont affichées
let statsPane   = 'overview'; // téléphone : onglet affiché ('overview' | 'openings' | 'regularity')
let statsAllLines = false;   // téléphone : toutes les ouvertures affichées
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
    return `<span class="lv-bar ${cls || ''}" aria-hidden="true">${STATS_MASTERY_LEVELS.filter(l => counts[l])
        .map(l => `<i class="lv-${l}" style="flex:${counts[l]}" title="${STATS_LEVELS[l].label} : ${counts[l]}"></i>`).join('')}</span>`;
}

const _plural = (n, one, many) => `${n} ${n > 1 ? many || one + 's' : one}`;
const _sideName = c => ({ w: 'Blancs', b: 'Noirs', all: 'Blancs et Noirs' })[c];

// Repère du coup : « 4. e4 » (Blancs) ou « 4… e5 » (Noirs) ; masked : « 4. ? ». html : figurines dessinées.
function _moveLabel(e, masked, html) {
    const fmt = html ? formatSan : formatSanText;
    if (!e.ply) return masked ? '?' : fmt(e.san);
    const n = Math.ceil(e.ply / 2), w = e.ply % 2 === 1, san = masked ? '?' : fmt(e.san, w ? 'w' : 'b');
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

// Position AVANT mon coup (after : APRÈS tout le chemin), orientée de mon côté ; le dernier coup est surligné.
function _miniBoardHTML(r, after) {
    let cells = null, last = [];
    _withEngineSnapshot(() => {
        try {
            parseFEN(INIT_FEN);
            if (r.path) {
                const before = after ? r.path : r.path.slice(0, -1);
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
    // Une colonne par semaine (lundi en haut), précédée des initiales des jours.
    let heat = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span class="st-heat-d">${d}</span>`).join('');
    for (let w = 0; w < STATS_HEAT_WEEKS; w++) {
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
        chart = `<div class="st-trend"><span class="st-sub st-trend-h"><span>Réussite par semaine</span><b>${end.v} % cette semaine</b></span>
            <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Réussite par semaine sur ${STATS_TREND_WEEKS} semaines, ${end.v} % cette semaine">
              ${grid}<path class="ar" d="${area}"/><path class="ln" d="${line}"/>
              ${pts.map(p => `<circle class="pt${p === end ? ' end' : ''}" cx="${x(p.i)}" cy="${y(p.v)}" r="${p === end ? 3.5 : 2.5}"/>`).join('')}
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
        <div class="st-heat-scroll"><div class="st-heat" role="img" aria-label="Essais par jour sur ${STATS_HEAT_WEEKS} semaines">${heat}</div></div>
        <div class="st-heat-leg">moins <i></i><i class="h1"></i><i class="h2"></i><i class="h3"></i> plus</div>
        ${chart}
        ${bySide ? `<div class="st-cmps"><span class="st-sub">Maîtrise par couleur · ${escapeHtml(currentRepertoire)}</span>${bySide}</div>` : ''}`;
}

// ─── RENDU ────────────────────────────────────────────────────────────────────

function _renderStatsScope() {
    ColorScope.render(document.getElementById('stats-color'), { options: ['w', 'b', 'all'], value: statsColor, onChange: setStatsColor });
    const rep = document.getElementById('stats-rep');
    if (rep) rep.innerHTML = repertoireDropdownHTML('statsRep');
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
    const reg  = Object.keys(readActivity()).length ? `<aside class="st-side" data-pane="regularity"><section class="st-sec"><div class="st-h"><h3>Régularité, tous répertoires</h3></div><div class="st-reg">${_regularityHTML()}</div></section></aside>` : '';

    if (!rows.length) {
        body.className = 'st-body';
        body.innerHTML = `<div class="st-main"><div class="empty-tab"><div class="empty-tab-icon">${ico('bar-chart', 'ico-xl')}</div>
            <div>Aucune donnée</div>
            <div class="empty-tab-sub">Jouez votre répertoire « ${escapeHtml(currentRepertoire)} »${statsColor === 'all' ? '' : ` avec les ${_sideName(statsColor)}`} pour voir apparaître vos statistiques.</div></div></div>` + reg;
        return;
    }

    const now = Date.now();
    const counts = _countLevels(rows);
    if (statsFilter !== 'all' && !counts[statsFilter]) statsFilter = 'all';     // le filtre actif s'est vidé

    // ── Aujourd'hui ──
    // Même décompte que l'Entraînement › Révision du jour : les positions jamais révisées sont dues aussi.
    const due = rows.filter(r => isDue(r.e, now));
    const dueWeak = due.filter(r => r.lv === 'weak').length;
    const fresh = (statsColor === 'all' ? ['w', 'b'] : [statsColor])
        .reduce((n, side) => n + Object.values(readDBFor(currentRepertoire, side)).filter(e => !e.attempts && isDue(e, now)).length, 0);
    const dueAll = due.length + fresh;
    const endTomorrow = _dayStart(now, 2);
    const tomorrow = rows.filter(r => { const d = dueOf(r.e); return d > now && d < endTomorrow; }).length;
    const next = dueAll ? 0 : Math.min(...rows.map(r => dueOf(r.e)));
    const minutes = Math.max(1, Math.round(dueAll * STATS_SECONDS_PER_POSITION / 60));
    const today = `
        <div class="vel-card vel-dark st-today">
            <span class="st-eyebrow">Aujourd'hui · ${_sideName(statsColor)}</span>
            ${dueAll ? `
            <div class="st-big"><b>${dueAll}</b><span>${dueAll > 1 ? 'positions à réviser' : 'position à réviser'}</span></div>
            <div class="st-today-sub">Environ ${minutes} min${dueWeak ? ` · dont <b>${dueWeak} à retravailler</b>` : ''}${fresh ? ` · ${_plural(fresh, 'nouvelle', 'nouvelles')}` : ''}</div>
            <button class="st-cta" data-action="statsGoTraining" data-arg="due">Révision du jour ${ico('chevron-right')}</button>` : `
            <div class="st-big st-big-text"><b>À jour</b></div>
            <div class="st-today-sub">Prochaine révision ${_dueIn(next)}.</div>
            <button class="st-cta" data-action="statsGoTraining" data-arg="weak">Points faibles ${ico('chevron-right')}</button>`}
            <span class="st-foot">Demain : ${_plural(tomorrow, 'position')}</span>
        </div>`;

    // ── Téléphone : trois chiffres et onglets collants (css/screens.css, requête de conteneur) ──
    const tabs = [['overview', 'Aperçu'], ['openings', 'Ouvertures'], ['regularity', 'Régularité']].filter(([p]) => p !== 'regularity' || reg);
    if (!tabs.some(([p]) => p === statsPane)) statsPane = 'overview';
    const phoneHead = `<div class="st-phone st-kpis" role="group" aria-label="En bref">
            <div><b>${dueAll}</b><span>à réviser</span></div>
            <div><b>${Math.round(100 * counts.mastered / rows.length)} %</b><span>maîtrisées</span></div>
            <div><b>${_streak(readActivity())} j</b><span>d'affilée</span></div></div>
        <div class="st-phone st-tabs" role="tablist" aria-label="Sections">${tabs.map(([p, l]) =>
            `<button type="button" role="tab" class="st-tab" aria-selected="${statsPane === p}" data-action="statsPane" data-arg="${p}">${l}</button>`).join('')}</div>`;

    // ── Maîtrise ──
    const totA = rows.reduce((s, r) => s + r.e.attempts, 0), totF = rows.reduce((s, r) => s + r.e.failures, 0);
    const mastery = Math.round(100 * counts.mastered / rows.length);
    const lg = (l, cls) => `<button class="st-lg ${cls || ''} ${statsFilter === l ? 'active' : ''}" aria-pressed="${statsFilter === l}" data-action="statsLegend" data-arg="${l}" ${counts[l] ? '' : 'disabled'}>
            ${_lvMark(l)}<span>${STATS_LEVELS[l].label}</span><b>${counts[l]}</b></button>`;
    const legend = STATS_MASTERY_LEVELS.map(l => lg(l)).join('');
    const state = `<div class="st-state">${lg(STATS_STATE, 'st-lg-state')}<small>${STATS_LEVELS[STATS_STATE].rule} : pas encore de niveau</small></div>`;
    const masteryCard = `
        <div class="vel-card vel-light st-mastery">
            <span class="st-eyebrow">Maîtrise · ${_plural(rows.length, 'position')}</span>
            <div class="st-big"><b>${mastery} %</b><span>maîtrisées</span></div>
            ${levelBarHTML(counts, 'st-mbar')}
            <div class="st-legend" role="group" aria-label="Filtrer la liste par niveau">${legend}</div>
            ${state}
            <span class="st-foot">Réussite : ${Math.round(100 * (totA - totF) / totA)} % sur ${_plural(totA, 'essai')}</span>
        </div>`;

    // ── Points faibles ──
    const weakest = rows.filter(r => r.lv === 'weak' || r.lv === 'fragile').sort((a, b) => _rate(b) - _rate(a) || b.e.attempts - a.e.attempts).slice(0, STATS_WEAK_CARDS);
    _assignOpenings(rows);
    const arg = r => escapeHtml(r.side + ':' + r.k);
    const weakN = counts.weak + counts.fragile;
    const weakHTML = !weakest.length ? '' : `
        <section class="st-sec">
            <div class="st-h"><h3>Points faibles</h3>${counts.weak ? `<button class="st-link" data-action="statsLegend" data-arg="weak">Tout voir</button>` : ''}</div>
            <div class="st-wlist">${weakest.map(r => `
                <div class="st-wrow">
                    <span class="st-wrow-txt"><b>${r.e.ply ? escapeHtml(_moveLabel(r.e, true)) : 'Coup à retrouver'}</b><small>${statsColor === 'all' ? (r.side === 'w' ? 'Blancs · ' : 'Noirs · ') : ''}${escapeHtml(r.gName)}</small></span>
                    <span class="st-errs lv-${r.lv}"><span class="st-n">${r.e.failures} err. / ${r.e.attempts}</span></span>
                    <button class="st-ibtn" data-action="statsPreview" data-arg="${arg(r)}" title="Voir la position" aria-label="Voir la position">${ico('eye')}</button>
                </div>`).join('')}</div>
            <button class="st-golink" data-action="statsGoTraining" data-arg="weak">S'exercer : Entraînement › Points faibles (${_plural(weakN, 'position')}) ${ico('chevron-right')}</button>
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

    const chips = [['all', 'Toutes', rows.length], ...STATS_MASTERY_LEVELS.map(l => [l, STATS_LEVELS[l].label, counts[l]]), [STATS_STATE, STATS_LEVELS[STATS_STATE].label, counts[STATS_STATE]]].map(([id, label, n]) =>
        `${id === STATS_STATE ? '<span class="stats-chip-sep" aria-hidden="true"></span>' : ''}<button class="stats-chip ${statsFilter === id ? 'active' : ''} ${id === 'all' ? 'all' : 'lv-' + id}${id === STATS_STATE ? ' is-state' : ''}" aria-pressed="${statsFilter === id}" data-action="statsFilter" data-arg="${id}" ${n ? '' : 'disabled'}>
            ${id === 'all' ? '' : _lvMark(id)}${label} <b>${n}</b></button>`).join('');
    const sortSel = dropdownHTML({ label: 'Trier', aria: 'Trier les ouvertures', value: statsSort, action: 'statsSort', cls: 'dd-sm dd-end st-sort',
        options: [['weak', 'Plus fragiles'], ['due', 'Plus de révisions dues'], ['order', 'Ordre des coups'], ['size', 'Plus de positions']] });

    const lines = list.map(g => {
        const open = statsOpen.has(g.key), items = g.items.slice().sort(_byWorst);
        const shown = open ? (statsAll.has(g.key) ? items : items.slice(0, STATS_LINE_ROWS)) : [];
        const rowsHTML = shown.map(r => {
            const d = isDue(r.e, now), pct = Math.round(100 * _rate(r));
            return `<div class="st-row">
                <span class="st-move">${_moveLabel(r.e, false, true)}</span>
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
            ${open ? `<div class="st-rows">${g.path.length ? `<div class="st-line-pos">${_miniBoardHTML({ side: g.side, path: g.path }, true)}</div>` : ''}${g.due ? `<button class="st-golink" data-action="statsGoTraining" data-arg="${escapeHtml('due:' + g.key)}">Réviser cette ouverture ${ico('chevron-right')}</button>` : ''}<div class="st-row st-row-hd" aria-hidden="true"><span>Coup</span><span>Niveau</span><span>Erreurs</span><span>Révision</span><span></span></div>${rowsHTML}${more}</div>` : ''}
        </section>`;
    }).join('');

    body.innerHTML = `
        <div class="st-main">
            <section class="st-now" data-pane="overview">${today}${masteryCard}</section>
            <div data-pane="overview">${weakHTML}</div>
            <section class="st-sec" id="stats-lines" data-pane="openings">
                <div class="st-h"><div class="st-h-title"><h3>Par ouverture</h3><span class="st-sub">${_plural(list.length, 'ouverture')} · ${_sideName(statsColor)}</span></div>${sortSel}</div>
                <div class="stats-filters" role="group" aria-label="Filtrer par niveau">${chips}</div>
                <div class="st-lines${statsAllLines ? '' : ' is-capped'}">${lines || '<div class="empty-tab">Aucune position à ce niveau.</div>'}</div>
                ${!statsAllLines && list.length > STATS_PHONE_LINES ? `<button class="st-more st-phone" data-action="statsAllLines">Tout voir : ${_plural(list.length, 'ouverture')}</button>` : ''}
            </section>
        </div>${reg}`;
    body.className = 'st-body pane-' + statsPane;
    body.insertAdjacentHTML('afterbegin', phoneHead);
    const hs = body.querySelector('.st-heat-scroll');
    if (hs) hs.scrollLeft = hs.scrollWidth;                     // la semaine en cours, à droite
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

// Les Statistiques observent, l'Entraînement agit : les boutons d'action ouvrent l'exercice correspondant,
// déjà filtré (couleur, et ouverture pour « Réviser cette ouverture »). arg : 'due' | 'weak' | 'due:<ouverture>'.
function statsGoTraining(arg) {
    const i = arg.indexOf(':');
    if (i < 0) { openTrainingFrom({ color: statsColor, focus: arg }); return; }
    const key = arg.slice(i + 1), side = key.slice(0, key.indexOf('|'));
    openTrainingFrom({ color: side, opening: { key, name: key.slice(key.indexOf('|') + 1) }, focus: arg.slice(0, i) });
}

registerActions({
    statsColor: c => setStatsColor(c),
    statsRep: name => { if (name !== currentRepertoire) selectRepertoire(name); },
    statsFilter: f => { statsFilter = (f !== 'all' && statsFilter === f) ? 'all' : f; initStats(); },
    statsLegend: f => {
        statsFilter = statsFilter === f ? 'all' : f;
        statsOpen = null;                                           // la première ouverture concernée s'ouvre
        initStats();
        const sec = document.getElementById('stats-lines');
        if (sec && statsFilter !== 'all') sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    statsSort: v => { statsSort = v; initStats(); },
    statsLine: k => { if (statsOpen.has(k)) statsOpen.delete(k); else statsOpen.add(k); initStats(); },
    statsMore: k => { statsAll.add(k); initStats(); },
    statsPane: p => { statsPane = p; initStats(); window.scrollTo({ top: 0 }); },
    statsAllLines: () => { statsAllLines = true; initStats(); },
    statsInfo: () => {
        const box = document.getElementById('stats-info'), btn = document.getElementById('stats-info-btn');
        box.hidden = !box.hidden;
        btn.setAttribute('aria-expanded', String(!box.hidden));
    },
    statsGoTraining: arg => statsGoTraining(arg),
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
