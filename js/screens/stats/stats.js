/**
 * screens/stats/stats.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Statistiques : agir d'abord, comprendre ensuite (refonte de novembre 2026).
 * Les Statistiques observent, l'Entraînement agit : les boutons d'action ouvrent l'exercice d'Entraînement
 * correspondant, déjà filtré (openTrainingFrom, trainingUI.js), sans lancer de séance.
 *   « À faire » : trois constats au plus. Aujourd'hui (révisions dues ; seule action pleine de la page : Révision
 *      du jour, Points faibles quand tout est à jour), l'ouverture qui coûte le plus de points, ce que disent les parties.
 *   Puis quatre onglets, à toutes les largeurs (statsPane) :
 *   1. Maîtrise : part des positions maîtrisées et répartition par niveau (la barre et la légende filtrent la liste
 *      des ouvertures), prévision sur 7 jours, points faibles en miniature (la ligne ouvre l'aperçu).
 *      « À confirmer » (trop peu d'essais) est un état à part, hors des barres de niveaux.
 *   2. Ouvertures : liste « miroir » (préparation à gauche, écart à l'attendu à droite) et une seule fiche
 *      (statsOpenings.js) ; chaque position s'affiche en aperçu ou se travaille seule (▶, seule action qui lance
 *      une révision) ; « Réviser cette ouverture » ouvre la Révision du jour filtrée sur elle.
 *   3. Parties : Elo, Bilan, Temps, Qualité, Positions, Répertoire (statsGames.js, statsInsights.js).
 *   4. Régularité, tous répertoires : série, calendrier (12 semaines, grille fluide), réussite par semaine.
 * Une seule barre de filtres, collante : répertoire et couleur ; période, site et cadence sur Ouvertures et Parties.
 *
 * Six niveaux, utilisés partout (Statistiques, Entraînement, arbre du répertoire) ; m = score de maîtrise (masteryOf, storage.js) :
 *   à retravailler  m < 50
 *   fragile         50 ≤ m < 70
 *   en progrès      70 ≤ m < 85
 *   solide          m ≥ 85
 *   à confirmer     aucune erreur, moins de STATS_CONFIRM_TRIES essais
 *   maîtrisée       aucune erreur en STATS_CONFIRM_TRIES essais ou plus, ou « solide » réussie plusieurs
 *                   révisions d'affilée (intervalle de révision ≥ STATS_SOLID_DAYS jours, cf. recordReview)
 */

'use strict';

const STATS_WEAK_CARDS    = 3;
const STATS_DAYS          = 30;
const STATS_HEAT_WEEKS    = 12;     // calendrier : une colonne par semaine, de largeur partagée
const STATS_WEAK_PAGE     = 30;     // « Points faibles › Tout voir » : positions montrées avant « Afficher les autres »
const STATS_FORECAST_DAYS = 7;
const STATS_TREND_WEEKS   = 8;

// « À confirmer » est un état (trop peu d'essais pour juger), pas un niveau de maîtrise : il reste hors des barres.
const STATS_STATE = 'unsure';
const STATS_MASTERY_LEVELS = STATS_LEVEL_ORDER.filter(l => l !== STATS_STATE);

let statsColor  = 'all';     // 'w' | 'b' | 'all' ; « Les deux » à chaque lancement
let statsFilter = 'all';     // 'all' ou un niveau
let statsPane   = 'overview'; // onglet affiché : 'overview' (Maîtrise) | 'openings' | 'games' | 'regularity'
let statsWeak   = null;      // vue complète « Points faibles » : { shown, y } (y : défilement de la page quittée), sinon null

// Repère de niveau : couleur ET forme (lisible sans distinguer les couleurs), cf. .lv-mark.
const _lvMark = l => `<i class="lv-mark lv-${l}" aria-hidden="true"></i>`;

const _lvPair = (l, n) => I18n.pair(I18n.t(STATS_LEVELS[l].label), n);

// Barre de répartition ; counts : { niveau: nombre }. opts.buttons : un bouton par segment, qui filtre la liste
// comme la légende (statsLegend) ; opts.active : niveau du filtre en cours. Sans opts, des <i> décoratifs.
function levelBarHTML(counts, cls, opts) {
    const lv = STATS_MASTERY_LEVELS.filter(l => counts[l]);
    if (!opts || !opts.buttons) return `<span class="lv-bar ${cls || ''}" aria-hidden="true">${lv
        .map(l => `<i class="lv-${l}" style="flex:${counts[l]}" title="${_lvPair(l, counts[l])}"></i>`).join('')}</span>`;
    const on = opts.active && opts.active !== 'all' ? opts.active : '';
    return `<span class="lv-bar lv-bar-btn${on ? ' has-on' : ''} ${cls || ''}" role="group" aria-label="Filtrer la liste par niveau">${lv.map(l =>
        `<button type="button" class="lv-${l}${on === l ? ' on' : ''}" style="flex:${counts[l]}" data-action="statsLegend" data-arg="${l}" aria-pressed="${on === l}" title="${_lvPair(l, counts[l])}" aria-label="${I18n.mark(`${I18n.t(STATS_LEVELS[l].label)}, ${counts[l]}`)}"></button>`).join('')}</span>`;
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

// Plus fragiles d'abord : niveau, taux d'erreur, nombre d'essais, ordre du coup.
const _rate = r => 1 - masteryOf(r.e) / 100;
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
// r = { side: 'w'|'b', path?: [uci…], k?: FEN } ; sans path, la FEN r.k est lue.
// opts = { cls?, label? } : classe ajoutée à .st-mini, libellé lu par les lecteurs d'écran.
function _miniBoardHTML(r, after, opts = {}) {
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
    const cls = opts.cls ? ' ' + escapeHtml(opts.cls) : '', label = escapeHtml(opts.label || (after ? 'Position' : 'Position avant votre coup'));
    return `<div class="st-mini${cls}" role="img" aria-label="${label}">${html}</div>`;
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
    const fmt = t => new Date(t).toLocaleDateString(I18n.locale(), { weekday: 'long', day: 'numeric', month: 'long' });
    // Une colonne par semaine (lundi en haut), précédée des initiales des jours.
    let heat = [0, 1, 2, 3, 4, 5, 6].map(d => `<span class="st-heat-d" translate="no">${new Date(2024, 0, 1 + d).toLocaleDateString(I18n.locale(), { weekday: 'narrow' }).toUpperCase()}</span>`).join('');
    for (let w = 0; w < STATS_HEAT_WEEKS; w++) {
        for (let d = 0; d < 7; d++) {
            const t = _dayStart(first, w * 7 + d), a = dayAt(t).a;
            const cls = t > today ? 'future' : !a ? '' : a < 10 ? 'h1' : a < 25 ? 'h2' : 'h3';
            heat += `<i class="${cls}${t === today ? ' today' : ''}" title="${t > today ? '' : I18n.pair(fmt(t), I18n.t(_plural(a, 'essai')))}"></i>`;
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
        const startLbl = I18n.mark(new Date(_dayStart(monday, -7 * (STATS_TREND_WEEKS - 1))).toLocaleDateString(I18n.locale(), { day: 'numeric', month: 'short' }));
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

    // Deux groupes : l'assiduité (série, calendrier), puis la qualité (réussite, maîtrise par couleur) ; côte à côte sur ordinateur.
    return `<div class="st-reg-a">
        <div class="st-reg-kpis"><div><b>${_plural(streak, 'jour')}</b><span>d'affilée</span></div><div><b>${active} / ${STATS_DAYS}</b><span>jours actifs</span></div></div>
        <div class="st-heat" style="--weeks:${STATS_HEAT_WEEKS}" role="img" aria-label="Essais par jour sur ${STATS_HEAT_WEEKS} semaines">${heat}</div>
        <div class="st-heat-leg">Peu <i></i><i class="h1"></i><i class="h2"></i><i class="h3"></i> Beaucoup</div></div>
        <div class="st-reg-b">${chart}
        ${bySide ? `<div class="st-cmps"><span class="st-sub">Maîtrise par couleur · ${escapeHtml(currentRepertoire)}</span>${bySide}</div>` : ''}</div>`;
}

// ─── RENDU ────────────────────────────────────────────────────────────────────

// Barre de contexte : répertoire et couleur ; période, site et cadence s'y ajoutent sur les onglets qui lisent
// des parties (Ouvertures, Parties). Une seule barre de filtres pour toute la page.
function _renderStatsScope() {
    ColorScope.render(document.getElementById('stats-color'), { options: ['w', 'b', 'all'], value: statsColor, onChange: setStatsColor });
    const rep = document.getElementById('stats-rep');
    if (rep) rep.innerHTML = repertoireDropdownHTML('statsRep');
    _renderStatsFilters();
}

let _statsBare = false;           // page sans essai : la section Parties est visible sans onglet

function _renderStatsFilters() {
    const box = document.getElementById('stats-filters');
    if (!box) return;
    const games = StatsGames.games();
    const show = !statsWeak && !!(games && games.length) && (_statsBare || statsPane === 'games');
    box.innerHTML = show ? StatsInsights.filtersHTML(games) : '';
    box.hidden = !show;
}

const _statsArg = r => escapeHtml(r.side + ':' + r.k);
const _gamesSection = () => `<section class="st-sec st-card edge-card" id="stats-games" data-pane="games">${StatsGames.content()}</section>`;

// Écart à l'attendu en barre divergente autour de zéro (±20 points pleine largeur) ; null : pas assez de parties.
function statsDeltaBar(d) {
    if (d === null || d === undefined) return '<span class="st-dbar is-none" aria-hidden="true"></span>';
    const w = Math.max(3, Math.min(Math.abs(d), 20) / 20 * 50);
    return `<span class="st-dbar ${d >= 0 ? 'up' : 'down'}" aria-hidden="true"><i style="${d >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i></span>`;
}
// Écart de score à l'attendu, en points de pourcentage, écrit « % » partout (arbitrage du 12 novembre 2026).
const _signedPct = d => I18n.mark(`${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString(I18n.locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);

// Une position fragile : miniature, coup masqué, ouverture, maîtrise ; la ligne entière ouvre l'aperçu.
function _weakRowHTML(r) {
    const mv = r.e.ply ? _moveLabel(r.e, true) : 'Coup à retrouver', from = (r.side === 'w' ? 'Blancs · ' : 'Noirs · ');
    return `
                <button type="button" class="st-wrow lv-${r.lv}" data-action="statsPreview" data-arg="${_statsArg(r)}" data-origin="weak" aria-label="Voir la position ${escapeHtml(mv)}, ${escapeHtml(from + r.gName)}">
                    ${_miniBoardHTML(r, false, { cls: 'st-wmini' })}
                    <span class="st-wrow-txt"><b>${escapeHtml(mv)}</b><small>${statsColor === 'all' ? from : ''}${r.gHtml}</small></span>
                    <span class="st-errs"><span class="st-rate" aria-hidden="true"><i style="width:${Math.max(3, Math.round(masteryOf(r.e)))}%"></i></span><span class="st-n">${Math.round(masteryOf(r.e))} / 100</span>${ico('chevron-right')}</span>
                </button>`;
}

// « Points faibles › Tout voir » : toutes les positions à retravailler ou fragiles, les plus fragiles d'abord.
function _renderWeakList(body, rows, weakN, relearnN) {
    const all = rows.filter(r => r.lv === 'weak' || r.lv === 'fragile').sort((a, b) => _rate(b) - _rate(a) || b.e.attempts - a.e.attempts);
    const shown = all.slice(0, statsWeak.shown), rest = all.length - shown.length;
    body.className = 'st-body';
    body.innerHTML = `<div class="st-main"><section class="st-sec st-card st-weak edge-card" id="stats-weak-all">
        <button type="button" class="st-link st-back" data-action="statsWeakBack">${ico('chevron-left')}Statistiques</button>
        <div class="st-h"><h3>Points faibles</h3><span class="st-sub">${_plural(weakN, 'position')}${relearnN ? ` · ${relearnN} dans la file À revoir` : ''}</span></div>
        <div class="st-wlist">${shown.map(_weakRowHTML).join('')}</div>
        ${rest ? `<button type="button" class="st-more" data-action="statsWeakMore">Afficher les ${rest} autres positions</button>` : ''}
        <button type="button" class="btn btn-soft st-golink" data-action="statsGoTraining" data-arg="weak">${ico('flame')}Entraînement › Points faibles ${ico('chevron-right')}</button>
    </section></div>`;
    _renderStatsFilters();
    Bus.emit('ui:refresh');
}

// ─── À FAIRE ──────────────────────────────────────────────────────────────────
// Deux constats au plus, chacun avec son lien : l'ouverture qui coûte le plus de points, ce que disent les parties.
// Une carte sans assez de parties n'existe pas. Plus de carte du jour (lot 2 : elle est dans « Aujourd’hui »).

const _todoCard = (kind, claim, ev, go, label) => `<article class="st-card st-todo-card edge-card">
        <span class="st-eyebrow">${kind}</span><p class="st-claim">${claim}</p>${ev}
        <button type="button" class="btn btn-soft st-todo-go" data-action="statsTodoGo" data-arg="${escapeHtml(go)}">${label} ${ico('chevron-right')}</button></article>`;

function _todoOpeningCard() {
    const o = StatsOpenings.topLoss();
    if (!o) return '';
    return _todoCard('Ouverture · Score face à l\'attendu', `${o.html} <em>${_signedPct(o.delta)}</em>`, statsDeltaBar(o.delta), 'openings|' + o.key, 'Voir la fiche');
}

function _todoGamesCard() {
    const games = StatsGames.games(), MIN = GameInsights.MIN;
    if (!games || !games.length) return '';
    const list = games.filter(g => StatsInsights.keep(g));
    if (list.length < MIN) return '';
    const en = GameInsights.ends(list);
    if (en.losses.n >= MIN && en.losses.time >= 20) {
        const v = Math.round(en.losses.time);
        return _todoCard('Parties', `<em>${v} %</em> de vos défaites se jouent au temps`,
            `<span class="st-dbar is-share" aria-hidden="true"><i style="width:${v}%"></i></span>`, 'games|temps', 'Voir le temps');
    }
    const s = OpeningReport.summarize(list);
    if (s.delta !== null && s.delta <= -3) return _todoCard('Parties', `Score <em>${_signedPct(s.delta)}</em> face à l'attendu`, statsDeltaBar(s.delta), 'games|bilan', 'Voir le bilan');
    return '';
}

function _paintTodo() {
    const box = document.getElementById('stats-todo');
    if (!box) return;
    const cards = [_todoOpeningCard(), _todoGamesCard()].filter(Boolean);
    box.className = `st-todo n-${cards.length}`;
    box.innerHTML = cards.join('');
}

// ─── ONGLETS ──────────────────────────────────────────────────────────────────
// Maîtrise, Ouvertures, Parties, Régularité, à toutes les largeurs : chaque chiffre garde sa place.
// Le compteur d'un onglet dit la taille de ce qu'il contient ; ceux qui dépendent des parties suivent leur arrivée.
function _activeDays() {
    const act = readActivity(), today = _dayStart(Date.now());
    let n = 0;
    for (let i = 0; i < STATS_DAYS; i++) if ((act[dayStamp(_dayStart(today, -i))] || {}).a) n++;
    return n;
}

function _tabCounts(rows) {
    const games = StatsGames.games();
    return { overview: rows.length, openings: StatsOpenings.count(), games: games && games.length ? games.length : '', regularity: `${_activeDays()}/${STATS_DAYS}` };
}

// Ce que compte chaque compteur d'onglet, dit en infobulle.
const STATS_TAB_UNITS = { overview: 'Positions du répertoire', openings: 'Ouvertures', games: 'Parties archivées', regularity: 'Jours actifs sur les 30 derniers' };
function _tabsHTML(tabs, counts) {
    return `<div class="st-tabs" id="stats-tabs" role="tablist" aria-label="Vues">${tabs.map(([p, l]) =>
        `<button type="button" role="tab" class="st-tab" aria-selected="${statsPane === p}" data-action="statsPane" data-arg="${p}">${l}<span class="st-tab-n" id="st-tab-n-${p}" title="${STATS_TAB_UNITS[p]}">${counts[p]}</span></button>`).join('')}</div>`;
}

// Appelé quand les parties arrivent ou sont croisées avec le répertoire : filtres, constats et compteurs.
function statsSyncChrome() {
    if (!document.getElementById('stats-body')) return;
    _renderStatsFilters();
    _paintTodo();
    const games = StatsGames.games(), set = (p, v) => { const el = document.getElementById('st-tab-n-' + p); if (el) el.textContent = v; };
    set('games', games && games.length ? games.length : '');
    set('openings', StatsOpenings.count());
}
Bus.on('games:analysed', statsSyncChrome);

function initStats() {
    const body = document.getElementById('stats-body');
    if (!body) return;

    const rows = _statsRows();
    const hasAct = Object.keys(readActivity()).length > 0;
    const reg = hasAct ? `<section class="st-sec st-card edge-card st-regcard" data-pane="regularity"><div class="st-h"><h3>Régularité</h3><span class="st-sub">tous répertoires</span></div><div class="st-reg">${_regularityHTML()}</div></section>` : '';

    // États vides : aucun essai dans la portée (l'Entraînement les fera apparaître ; Jouer ne compte rien),
    // ou aucune position enregistrée (Ajouter une ligne, vers Jouer). Sans onglet : tout ce qui existe s'affiche.
    if (!rows.length) {
        _statsBare = true;
        _renderStatsScope();
        const sides = statsColor === 'all' ? ['w', 'b'] : [statsColor];
        const stored = sides.reduce((n, side) => n + Object.keys(readDBFor(currentRepertoire, side)).length, 0);
        const side = statsColor === 'all' ? '' : ` avec les ${_sideName(statsColor)}`;
        const empty = stored ? {
            icon: 'bar-chart', title: `Aucun essai pour « ${escapeHtml(currentRepertoire)} »`,
            sub: `${_plural(stored, 'position enregistrée', 'positions enregistrées')}${side}, aucune encore révisée.`,
            btn: `<button type="button" class="btn btn-primary" data-action="statsGoTraining" data-arg="due">Ouvrir l'Entraînement ${ico('chevron-right')}</button>`
        } : {
            icon: 'plus', title: 'Répertoire vide',
            sub: `${statsColor === 'all' ? 'Les Blancs et les Noirs n\'ont' : `Les ${_sideName(statsColor)} n'ont`} aucune position dans « ${escapeHtml(currentRepertoire)} ».`,
            btn: `<button type="button" class="btn btn-primary" data-action="statsAddLine">${ico('plus')}Ajouter une ligne</button>`
        };
        body.className = 'st-body';
        body.innerHTML = `<div class="st-main"><section class="st-card st-empty edge-card"><span class="st-empty-i">${ico(empty.icon)}</span>
            <b>${empty.title}</b><span>${empty.sub}</span>${empty.btn}</section>${_gamesSection()}${reg}</div>`;
        StatsGames.mount();
        return;
    }
    _statsBare = false;

    const now = Date.now();
    const counts = _countLevels(rows);
    if (statsFilter !== 'all' && !counts[statsFilter]) statsFilter = 'all';     // le filtre actif s'est vidé

    // Programme des révisions (reviewPlan), pour la prévision. La carte du jour et son action ont rejoint
    // « Aujourd’hui » (refonte « Chays sans détour », lot 2) : Progrès observe, sans bouton « réviser ».
    const rp = reviewPlan(currentRepertoire, now), inScope = c => statsColor === 'all' || c === statsColor;

    // Prévision : un total par jour (la case du jour compte aussi les retards), sans détail par niveau.
    const fc = rp.forecast(inScope, STATS_FORECAST_DAYS), fcMax = Math.max(1, ...fc), fcSum = fc.reduce((a, b) => a + b, 0);
    const fcDay = i => i ? new Date(_dayStart(now, i)).toLocaleDateString(I18n.locale(), { weekday: 'long' }) : I18n.t('aujourd\'hui');
    const forecastCard = `
        <div class="st-card st-fcard edge-card">
            <div class="st-h"><h3>Révisions à venir</h3></div>
            <div class="st-fc-h"><span>${STATS_FORECAST_DAYS} prochains jours</span><b>${_plural(fcSum, 'position')}</b></div>
            <div class="st-fc" role="img" aria-label="${I18n.pair(I18n.t('Révisions prévues'), fc.map((n, i) => `${fcDay(i)} ${n}`).join(', '))}">${fc.map((n, i) =>
                `<div title="${I18n.pair(fcDay(i), I18n.t(_plural(n, 'position')))}"><b>${n || ''}</b><i style="height:${n ? 4 + Math.round(56 * n / fcMax) : 2}px"${n ? '' : ' class="zero"'}></i><span>${new Date(_dayStart(now, i)).toLocaleDateString(I18n.locale(), { weekday: 'narrow' })}</span></div>`).join('')}</div>
        </div>`;

    // ── Maîtrise ── la barre filtre comme la légende ; la règle de chaque niveau est dans son title.
    const totA = rows.reduce((s, r) => s + r.e.attempts, 0), totF = rows.reduce((s, r) => s + r.e.failures, 0);
    const mastery = Math.round(100 * counts.mastered / rows.length);
    const lg = (l, cls) => `<button type="button" class="st-lg ${cls || ''} ${statsFilter === l ? 'active' : ''}" aria-pressed="${statsFilter === l}" data-action="statsLegend" data-arg="${l}" title="${I18n.pair(I18n.t(STATS_LEVELS[l].one), I18n.t(STATS_LEVELS[l].rule))}" ${counts[l] ? '' : 'disabled'}>
            ${_lvMark(l)}<span>${STATS_LEVELS[l].label}</span><b>${counts[l]}</b></button>`;
    const legend = STATS_MASTERY_LEVELS.map(l => lg(l)).join('');
    const masteryCard = `
        <div class="vel-card vel-light st-mastery edge-card">
            <span class="st-eyebrow">Maîtrise · ${_plural(rows.length, 'position')}</span>
            <div class="st-big"><b>${mastery} %</b><span>maîtrisées</span></div>
            ${levelBarHTML(counts, 'st-mbar', { buttons: true, active: statsFilter })}
            <div class="st-legend" role="group" aria-label="Filtrer la liste par niveau">${legend}</div>
            <div class="st-state">${lg(STATS_STATE, 'st-lg-state')}</div>
            <details class="st-rules"><summary>Comment chaque niveau est décidé</summary>
                <dl>${STATS_MASTERY_LEVELS.concat(STATS_STATE).map(l => `<div>${_lvMark(l)}<dt>${STATS_LEVELS[l].one}</dt><dd>${STATS_LEVELS[l].rule}</dd></div>`).join('')}</dl></details>
            <span class="st-foot">Réussite : ${Math.round(100 * (totA - totF) / totA)} % sur ${_plural(totA, 'essai')}</span>
        </div>`;

    // ── Points faibles ── la ligne entière ouvre l'aperçu ; l'exercice est dans l'Entraînement.
    const weakest = rows.filter(r => r.lv === 'weak' || r.lv === 'fragile').sort((a, b) => _rate(b) - _rate(a) || b.e.attempts - a.e.attempts).slice(0, STATS_WEAK_CARDS);
    _assignOpenings(rows);
    const weakN = counts.weak + counts.fragile, relearnN = rows.filter(r => Number.isInteger(r.e.relearn)).length;
    if (statsWeak) {
        if (weakN) { _renderStatsScope(); _renderWeakList(body, rows, weakN, relearnN); return; }
        statsWeak = null;                                       // plus rien à montrer : retour à la page
    }
    const weakHTML = !weakest.length ? '' : `
        <section class="st-sec st-card st-weak edge-card">
            <div class="st-h"><h3>Points faibles</h3><span class="st-sub">${_plural(weakN, 'position')}${relearnN ? ` · ${relearnN} dans la file À revoir` : ''}</span>${weakN > weakest.length ? `<button type="button" class="st-link" data-action="statsWeakAll">Tout voir</button>` : ''}</div>
            <div class="st-wlist">${weakest.map(_weakRowHTML).join('')}</div>
            <button type="button" class="btn btn-soft st-golink" data-action="statsGoTraining" data-arg="weak">${ico('flame')}Entraînement › Points faibles ${ico('chevron-right')}</button>
        </section>`;

    // ── Par ouverture ── la fiche vit dans l'onglet Ouvertures (lot 3) ; ici, seulement de quoi nourrir le constat « À faire ».
    StatsOpenings.prime({ rows, counts, rp });

    const tabs = [['overview', 'Maîtrise'], ['games', 'Parties'], ['regularity', 'Régularité']].filter(([p]) => p !== 'regularity' || reg);
    if (!tabs.some(([p]) => p === statsPane)) statsPane = 'overview';
    _renderStatsScope();

    body.className = 'st-body pane-' + statsPane;
    body.innerHTML = `
        <section class="st-todo" id="stats-todo" aria-label="À faire"></section>
        ${_tabsHTML(tabs, _tabCounts(rows))}
        <div class="st-main">
            <section class="st-now" data-pane="overview">${masteryCard}${forecastCard}</section>
            <div class="st-weak-wrap" data-pane="overview">${weakHTML}</div>
            ${_gamesSection()}
            ${reg}
        </div>`;
    _paintTodo();
    StatsGames.mount();
    Bus.emit('ui:refresh');             // téléphone : le centre du dock porte l'action de la page
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────

function setStatsColor(c) {
    statsColor = c;
    statsFilter = 'all';
    initStats();
}

// Onglet Ouvertures : la puce du répertoire et le retour depuis l'Analyse passent par ici (liens déjà tolérés vers la coquille).
const statsRepHTML = () => repertoireDropdownHTML('statsRep');
const statsBackToOpenings = () => goHome('openings');

// Progrès et Ouvertures partagent couleur, filtre de niveau et filtres des parties : les deux suivent.
function statsRerender() {
    initStats();
    if (typeof OpeningsTab !== 'undefined') OpeningsTab.refresh();
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
    statsFilter: f => { statsFilter = (f !== 'all' && statsFilter === f) ? 'all' : f; statsRerender(); },
    // Légende de la maîtrise : le niveau filtre les coups des fiches d'ouverture, dans l'onglet Ouvertures (lot 3).
    statsLegend: f => {
        statsFilter = statsFilter === f ? 'all' : f;
        StatsOpenings.reset();                                      // la première ouverture concernée s'ouvre
        initStats();
        if (statsFilter === 'all') return;
        switchHomeTab('openings');
        window.scrollTo({ top: 0 });
    },
    statsWeakAll: () => { statsWeak = { shown: STATS_WEAK_PAGE, y: window.scrollY || 0 }; initStats(); window.scrollTo({ top: 0 }); },
    statsWeakMore: () => { statsWeak.shown += STATS_WEAK_PAGE; initStats(); },
    statsWeakBack: () => { const y = statsWeak ? statsWeak.y : 0; statsWeak = null; initStats(); window.scrollTo({ top: y }); },
    statsPane: p => { statsPane = p; initStats(); window.scrollTo({ top: 0 }); },
    // Action d'un constat « À faire » : 'openings|<clé de l'ouverture>' ou 'games|<vue>'.
    statsTodoGo: arg => {
        const i = arg.indexOf('|'), pane = arg.slice(0, i), what = arg.slice(i + 1);
        if (pane === 'openings') { StatsOpenings.show(what); switchHomeTab('openings'); window.scrollTo({ top: 0 }); return; }
        StatsInsights.show(what);
        statsPane = pane;
        initStats();
        window.scrollTo({ top: 0 });
    },
    statsAddLine: () => startGame(statsColor === 'b' ? 'b' : 'w'),    // répertoire vide : Jouer, où mon coup s'enregistre
    statsGoTraining: arg => statsGoTraining(arg),
    statsGoEndgame: cat => { switchHomeTab('endgame'); requestAnimationFrame(() => jumpEndgameCategory(cat)); },
    statsTrain: arg => { const { side, key } = _parseStatsArg(arg); startReviewQueue([{ color: side, key }], 'stats'); },
    statsPreview: (arg, el) => { const { side, key } = _parseStatsArg(arg); openStatsPreview(side, key, el && el.dataset.origin); }
});

// Aperçu en lecture seule de la position AVANT mon coup ; le coup attendu reste masqué.
// origin : 'weak' (liste « Points faibles ») ou le nom de l'ouverture d'où l'on vient ; avec le défilement,
// il sert au bouton de retour (statsBack), qui rouvre la même liste au même endroit.
let statsPreviewTarget = null;
function openStatsPreview(side, key, origin) {
    const e = readDBFor(currentRepertoire, side)[key];
    if (!e) return;
    const from = typeof OpeningsTab !== 'undefined' && OpeningsTab.visible() ? 'openings' : 'stats';
    statsPreviewTarget = { color: side, key, origin: origin || '', scrollY: window.scrollY || 0, from };
    _renderStatsBack(_level(e), origin);
    _renderPreviewFacts(e);
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
    setStatus(`Aperçu · ${_moveLabel(e, true)}`, 'info', `${STATS_LEVELS[_level(e)].one} · maîtrise ${Math.round(masteryOf(e))} / 100 (${e.failures} err. / ${e.attempts})`);
}

// Trois faits sous la barre d'état (niveau, erreurs, prochaine révision), dans le panneau latéral : montrés
// sur ordinateur seulement (css/screens.css), le détail de la barre d'état suffit sur téléphone. L'élément est
// créé à la première ouverture, avec data-modes="preview" : applyModeUI le cache dans les autres modes.
function _renderPreviewFacts(e) {
    let box = document.getElementById('stats-facts');
    const bar = document.getElementById('status-bar');
    if (!box) {
        if (!bar) return;
        box = document.createElement('div');
        box.id = 'stats-facts';
        box.className = 'st-facts';
        box.dataset.modes = 'preview';
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', 'Cette position');
        bar.after(box);
    }
    const lv = _level(e), d = isDue(e, Date.now());
    box.innerHTML = `<div class="lv-${lv}"><span>Niveau</span><b>${_lvMark(lv)}${STATS_LEVELS[lv].one}</b></div>
        <div title="${e.failures} err. / ${e.attempts}"><span>Maîtrise</span><b class="st-n">${Math.round(masteryOf(e))} / 100</b></div>
        ${Number.isInteger(e.relearn) ? `<div><span>À revoir</span><b class="st-n">${e.relearn} / ${RELEARN_DAYS.length}</b></div>` : ''}
        <div><span>Révision</span><b${d ? ' class="on"' : ''}>${d ? 'Aujourd’hui' : dueInLabel(dueOf(e))}</b></div>`;
}

// Barre du haut pendant l'aperçu : « ‹ Statistiques », puis la catégorie de la position en puce (marque + niveau)
// et la liste quittée (Points faibles ou nom de l'ouverture).
function _renderStatsBack(lv, origin) {
    const btn = document.getElementById('stats-back'), cat = document.getElementById('stats-cat');
    if (!btn || !cat) return;
    const where = origin === 'weak' ? 'Points faibles' : origin || '';
    const label = `Retour à Progrès${where ? ' · ' + where : ''}`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    cat.innerHTML = `<span class="lv-chip lv-${lv}">${_lvMark(lv)}${STATS_LEVELS[lv].one}</span>${where ? `<span class="tp-origin">· ${escapeHtml(where)}</span>` : ''}`;
}

// Une ligne de partie à travailler : ouverte dans Jouer, où la réponse s'enregistre.
function statsOpenLine(color, path) { startGame(color); loadPositionFromPath(path); }

// Quitter l'onglet referme la liste « Tout voir » ; l'aperçu d'une position, lui, y revient (statsBack).
function closeStatsWeak() { statsWeak = null; }

function statsBack() {
    const y = statsPreviewTarget ? statsPreviewTarget.scrollY : 0;
    goHome(statsPreviewTarget && statsPreviewTarget.from === 'openings' ? 'openings' : 'stats');
    requestAnimationFrame(() => window.scrollTo({ top: y }));
}

// Bouton « S'entraîner » de l'aperçu.
function trainStatsPreview() {
    if (statsPreviewTarget) startReviewQueue([statsPreviewTarget], 'stats');
}
