/**
 * modules/training/trainingUI.js
 * ──────────────────────────────────────────────────────────────────────────
 * Onglet Entraînement : un menu d'exercices (le moteur est dans training.js).
 *   - Barre de contexte : répertoire, Blancs / Noirs / Les deux (comme l'onglet Statistiques).
 *   - Bilan de la dernière séance, s'il y en a un : réussites du premier coup, erreurs à revoir,
 *     niveaux avant → après ; « Revoir les erreurs » relance une séance sur elles.
 *   - « Révision du jour » (carte Velours) : les positions dues ; à côté, les révisions des 7 prochains jours.
 *   - Autres exercices : Points faibles, Ligne complète (choix de l'ouverture), À confirmer,
 *     Contre-la-montre, Mode libre (tirage sans fin, réglé dans sa carte et dans Paramètres).
 *   - Filtre d'ouverture posé par les Statistiques (openTrainingFrom) : les exercices ne portent
 *     que sur les positions de cette ouverture, jusqu'à ce qu'il soit retiré.
 */

'use strict';

const TRAIN_SECONDS_PER_POSITION = 30;      // pour la durée estimée de la séance
const TRAIN_WEAK_MAX   = 20;                // positions par séance « Points faibles » / « À confirmer »
let _trColor   = 'mix';                     // 'mix' | 'w' | 'b' ; « Les deux » à chaque lancement
let _trLineOpen = false;                    // liste des ouvertures (Ligne complète) dépliée
let _trOpening = null;                      // { key, name } : ouverture choisie depuis les Statistiques
let _trFocus = null;                        // exercice mis en avant à l'arrivée depuis les Statistiques

const _trSides = () => _trColor === 'mix' ? ['w', 'b'] : [_trColor];

// Positions de la portée choisie : { color, key, e, lv }.
function _trRows() {
    const rows = [];
    _trSides().forEach(color => {
        const db = readDBFor(currentRepertoire, color);
        Object.keys(db).forEach(key => rows.push({ color, key, e: db[key], lv: _level(db[key]) }));
    });
    if (!_trOpening) return rows;
    // Positions déjà jouées : même regroupement que les Statistiques. Positions nouvelles : regroupées avec tout le répertoire.
    const tag = () => rows.map(r => ({ side: r.color, k: r.key, e: r.e, path: r.e.path && r.e.path.length ? r.e.path : null, r }));
    const played = tag().filter(x => x.e.attempts > 0), all = tag();
    _assignOpenings(played);
    _assignOpenings(all);
    return played.filter(x => x.gKey === _trOpening.key).map(x => x.r)
        .concat(all.filter(x => !x.e.attempts && x.gKey === _trOpening.key).map(x => x.r));
}

// Arrivée depuis les Statistiques : couleur, ouverture éventuelle et exercice à mettre en avant
// ('due' : Révision du jour, 'weak' : Points faibles). Rien n'est lancé : l'utilisateur choisit.
function openTrainingFrom({ color, opening, focus }) {
    _trColor = color === 'all' || !color ? 'mix' : color;
    _trOpening = opening || null;
    _trFocus = focus || null;
    _trLineOpen = false;
    trainingState.lastSummary = null;
    switchHomeTab('training');
    const el = document.querySelector(`#training-panel [data-focus="${_trFocus}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// Blancs d'abord, puis les plus fragiles (ordre des séances guidées).
const _trOrder = (a, b) => (a.color === b.color ? 0 : a.color === 'w' ? -1 : 1)
    || STATS_LEVEL_ORDER.indexOf(a.lv) - STATS_LEVEL_ORDER.indexOf(b.lv)
    || (b.e.failures / (b.e.attempts || 1)) - (a.e.failures / (a.e.attempts || 1));

// Ouvertures nommées de la portée (Ligne complète) : { color, name, path, n }.
function _trOpenings() {
    const rows = _trRows().map(r => ({ side: r.color, k: r.key, e: r.e, path: r.e.path && r.e.path.length ? r.e.path : null }));
    _assignOpenings(rows);
    const groups = new Map();
    rows.filter(r => r.op).forEach(r => {
        const g = groups.get(r.gKey) || { color: r.side, name: r.gName, path: r.gPath, n: 0 };
        g.n++;
        groups.set(r.gKey, g);
    });
    return [...groups.values()].sort((a, b) => (a.color === b.color ? 0 : a.color === 'w' ? -1 : 1) || a.path.join(' ').localeCompare(b.path.join(' ')));
}

// Révisions prévues sur 7 jours (jours du calendrier : robuste aux changements d'heure).
function _trForecast(rows, now) {
    const days = Array.from({ length: 8 }, (_, i) => ({ t: _dayStart(now, i), n: 0 }));
    rows.forEach(r => {
        const d = dueOf(r.e);
        if (d <= now) { days[0].n++; return; }
        const i = days.findIndex((day, k) => k < 7 && d >= day.t && d < days[k + 1].t);
        if (i >= 0) days[i].n++;
    });
    return days.slice(0, 7);
}

// ─── BILAN DE LA DERNIÈRE SÉANCE ──────────────────────────────────────────────

function _trSummaryHTML(s) {
    if (!s) return '';
    const label = r => {
        const op = r.e.path ? openingNameOf(r.e.path) : null;
        return `<span><span class="trb-move">${_moveLabel(r.e, false, true)}</span><small>${r.color === 'w' ? 'Blancs' : 'Noirs'}${op ? ' · ' + escapeHtml(op.name) : ''}</small></span>`;
    };
    const lv = l => `${_lvMark(l)}<span>${STATS_LEVELS[l].one}</span>`;
    const missed = s.rows.filter(r => !r.ok);
    const rank = l => STATS_LEVEL_ORDER.indexOf(l);
    const moved = s.rows.filter(r => r.lvAfter !== r.lvBefore).sort((a, b) => (rank(b.lvAfter) - rank(b.lvBefore)) - (rank(a.lvAfter) - rank(a.lvBefore)));
    const pct = s.total ? Math.round(100 * s.ok / s.total) : 0;
    const timed = s.kind === 'timed';
    const title = timed ? (s.newRecord ? 'Nouveau record !' : `${s.score} bon${s.score > 1 ? 's' : ''} coup${s.score > 1 ? 's' : ''}`)
        : s.early ? 'Séance interrompue' : pct >= 80 ? 'Très bonne séance' : pct >= 60 ? 'Bonne séance' : 'Séance utile';
    const sub = timed ? `Record : ${s.record} bon${s.record > 1 ? 's' : ''} coup${s.record > 1 ? 's' : ''}. ${missed.length ? `${missed.length} erreur${missed.length > 1 ? 's' : ''} en route.` : ''}`
        : missed.length ? `${missed.length} position${missed.length > 1 ? 's' : ''} ratée${missed.length > 1 ? 's' : ''} au premier essai : elle${missed.length > 1 ? 's reviendront' : ' reviendra'} vite en révision.` : 'Aucune erreur au premier essai.';
    return `
        <section class="trb" aria-label="Bilan de la dernière séance">
            <div class="vel-card vel-dark trb-hero">
                <div class="trb-ring" style="--p:${timed ? 100 : pct}"><div><b>${timed ? s.score : `${s.ok}/${s.total}`}</b><span>${timed ? 'bons coups' : 'du premier coup'}</span></div></div>
                <div class="trb-main">
                    <span class="st-eyebrow">${escapeHtml(s.label)}${s.line ? ' · ' + escapeHtml(s.line.name) : ''} · ${s.minutes} min</span>
                    <b class="trb-title">${title}</b>
                    <span class="trb-sub">${sub}</span>
                    <span class="trb-acts">
                        ${missed.length && !timed ? `<button class="st-cta" data-action="trainingRetry">Revoir ${missed.length > 1 ? `les ${missed.length} erreurs` : 'l\'erreur'} ${ico('play')}</button>` : ''}
                        ${s.kind === 'line' ? `<button class="st-cta" data-action="trainingReplayLine">Rejouer la ligne ${ico('play')}</button>` : ''}
                        ${timed ? `<button class="st-cta" data-action="trainingEx" data-arg="timed">Rejouer ${ico('play')}</button>` : ''}
                        <button class="trb-close" data-action="trainingCloseSummary">Fermer</button>
                    </span>
                </div>
            </div>
            ${missed.length ? `<div class="trb-card"><div class="st-h"><h3>À revoir</h3><span class="st-sub">${missed.length} erreur${missed.length > 1 ? 's' : ''}</span></div>
                <div class="trb-list">${missed.slice(0, 8).map(r => `<div class="trb-row"><span class="trb-ic ko" aria-label="Ratée">✗</span>${label(r)}<span class="trb-lv">${lv(r.lvAfter)}</span></div>`).join('')}</div></div>` : ''}
            ${moved.length ? `<div class="trb-card"><div class="st-h"><h3>Niveaux</h3><span class="st-sub">avant → après</span></div>
                <div class="trb-list">${moved.slice(0, 8).map(r => `<div class="trb-row"><span class="trb-ic ${r.ok ? 'ok' : 'ko'}" aria-label="${r.ok ? 'Réussie' : 'Ratée'}">${r.ok ? '✓' : '✗'}</span>${label(r)}<span class="trb-lv">${_lvMark(r.lvBefore)}<span class="trb-arr">→</span>${lv(r.lvAfter)}</span></div>`).join('')}</div></div>` : ''}
        </section>`;
}

// ─── ONGLET ───────────────────────────────────────────────────────────────────

function initTraining() {
    const panel = document.getElementById('training-panel');
    if (!panel) return;

    const has = c => Object.keys(readDBFor(currentRepertoire, c)).length > 0;
    const sides = ['w', 'b'].filter(has);
    if (_trColor !== 'mix' && !has(_trColor) && sides.length) _trColor = 'mix';      // la couleur choisie n'a rien à réviser

    // Barre de contexte
    ColorScope.render(document.getElementById('training-color'), { options: ['w', 'b', 'mix'], value: _trColor,
        onChange: c => UI_ACTIONS.trainingColor(c) });
    const rep = document.getElementById('training-rep');
    if (rep) rep.innerHTML = repertoireDropdownHTML('trainingRep');

    const rows = _trRows(), now = Date.now();
    const summary = _trSummaryHTML(trainingState.lastSummary);
    const filter = _trOpening ? `<div class="trs-filter" role="status"><span>Ouverture : <b>${escapeHtml(_trOpening.name)}</b></span>
        <button class="st-link" data-action="trainingAllOpenings">Toutes les ouvertures</button></div>` : '';
    if (!rows.length) {
        panel.innerHTML = summary + filter + `<div class="trs-empty">
            <b>Rien à réviser pour l'instant</b>
            <span>Jouez vos lignes dans « Jouer »${_trColor === 'mix' ? '' : ` avec les ${_trColor === 'w' ? 'Blancs' : 'Noirs'}`} : elles apparaîtront ici pour être révisées.</span>
        </div>`;
        return;
    }

    // ── Révision du jour ──
    const due = rows.filter(r => isDue(r.e, now));
    const minutes = Math.max(1, Math.round(due.length * TRAIN_SECONDS_PER_POSITION / 60));
    const next = due.length ? 0 : Math.min(...rows.map(r => dueOf(r.e)));
    const act = readActivity(), streak = _streak(act), today = (act[dayStamp(now)] || { a: 0 }).a;
    const scopeName = { w: 'Blancs', b: 'Noirs', mix: 'Blancs et Noirs' }[_trColor] + (_trOpening ? ' · ' + escapeHtml(_trOpening.name) : '');
    const hero = `
        <div class="vel-card vel-dark trs-day${_trFocus === 'due' ? ' is-focus' : ''}" data-focus="due">
            <span class="st-eyebrow">Révision du jour · ${scopeName}</span>
            ${due.length ? `
            <div class="st-big"><b>${due.length}</b><span>${due.length > 1 ? 'positions dues' : 'position due'}</span></div>
            <div class="st-today-sub">Environ ${minutes} min · les erreurs reviennent en fin de séance</div>
            <button class="st-cta" data-action="trainingEx" data-arg="due">Commencer ${ico('play')}</button>` : `
            <div class="st-big st-big-text"><b>À jour</b></div>
            <div class="st-today-sub">Prochaine révision ${Number.isFinite(next) && next ? _inLabel(next) : 'bientôt'}. Les exercices ci-dessous restent disponibles.</div>`}
            <span class="st-foot">${streak} jour${streak > 1 ? 's' : ''} d'affilée · ${Math.min(today, appSettings.dailyGoal)} / ${appSettings.dailyGoal} position${appSettings.dailyGoal > 1 ? 's' : ''} aujourd'hui${today >= appSettings.dailyGoal ? ' · objectif atteint' : ''}</span>
        </div>`;

    // ── 7 prochains jours + maîtrise par couleur ──
    const days = _trForecast(rows, now), max = Math.max(1, ...days.map(d => d.n));
    const dayName = (t, i) => i === 0 ? 'auj.' : i === 1 ? 'dem.' : new Date(t).toLocaleDateString('fr-FR', { weekday: 'short' });
    const mastery = _trSides().filter(has).map(c => {
        const list = rows.filter(r => r.color === c), counts = {};
        STATS_LEVEL_ORDER.forEach(l => { counts[l] = list.filter(r => r.lv === l).length; });
        return `<div class="trs-mastery"><span>${c === 'w' ? 'Blancs' : 'Noirs'}</span>${levelBarHTML(counts, 'tr-bar')}<b>${Math.round(100 * counts.mastered / list.length)} %</b></div>`;
    }).join('');
    const plan = `
        <section class="trs-plan">
            <span class="trs-eyebrow">Prochains jours</span>
            <div class="trs-bars" role="img" aria-label="Révisions prévues sur 7 jours">${days.map((d, i) =>
                `<div title="${d.n} révision${d.n > 1 ? 's' : ''}"><span class="trs-bar-n">${d.n || ''}</span><i class="${i ? '' : 'today'}" style="height:${Math.round(100 * d.n / max)}%"></i><span>${dayName(d.t, i)}</span></div>`).join('')}</div>
            ${mastery}
        </section>`;

    // ── Autres exercices ──
    const weak = rows.filter(r => r.lv === 'weak' || r.lv === 'fragile').length;
    const unsure = rows.filter(r => r.lv === 'unsure').length;
    const openings = _trOpenings();
    const record = Number(dataStore.getJSON(TRAIN_RECORD_KEY, 0)) || 0;
    const freeOpts = [trainingSettings.fromStart ? 'début de partie' : 'position ciblée', trainingSettings.maxPlies ? `≤ ${trainingSettings.maxPlies} coups` : 'toute profondeur',
                      trainingSettings.seqLen >= TRAIN_SEQ_END ? 'variante' : trainingSettings.seqLen > 1 ? `${trainingSettings.seqLen} coups` : '1 coup'].join(', ');
    const card = (kind, icon, lvl, title, text, meta, n, extra) => `
        <button class="trx ${extra || ''}${_trFocus === kind ? ' is-focus' : ''}" data-focus="${kind}" data-action="trainingEx" data-arg="${kind}" ${n === 0 ? 'disabled' : ''} ${kind === 'line' ? `aria-expanded="${_trLineOpen}"` : ''}>
            <span class="trx-ic ${lvl ? 'lv-' + lvl : ''}">${ico(icon)}</span>
            <b>${title}</b><span class="trx-txt">${text}</span><span class="trx-meta">${meta}</span>
        </button>`;
    const lineList = _trLineOpen ? `
        <div class="trx-lines" role="group" aria-label="Choisir une ouverture">
            ${openings.length ? openings.map((o, i) => `<button class="trx-line" data-action="trainingLine" data-arg="${i}">
                <span><b>${_trColor === 'mix' ? `<span class="st-line-side">${o.color === 'w' ? 'Blancs' : 'Noirs'}</span>` : ''}${escapeHtml(o.name)}</b><small>${escapeHtml(_movesLabel(o.path))}</small></span>
                <span class="trx-line-n">${o.n} pos.</span>${ico('play')}</button>`).join('')
              : '<div class="trs-note">Aucune ouverture reconnue dans ce répertoire : jouez vos lignes dans « Jouer ».</div>'}
        </div>` : '';
    // Mode libre : la carte porte ses réglages (aussi dans Paramètres › Jeu).
    const seg = (name, label, opts) => `<div class="trx-opt"><span id="trx-opt-${name}">${label}</span>
        <div class="seg trx-seg" role="radiogroup" aria-labelledby="trx-opt-${name}">${opts.map(([v, t]) =>
            `<button class="seg-btn${trainingSettings[name] === v ? ' active' : ''}" role="radio" aria-checked="${trainingSettings[name] === v}" data-action="trainingOpt" data-arg="${name}:${v}">${t}</button>`).join('')}</div></div>`;
    const freeCard = `
        <div class="trx trx-free" data-focus="free">
            <div class="trx-free-head">
                <span class="trx-ic">${ico('shuffle')}</span>
                <span><b>Mode libre</b><span class="trx-txt">Tirage sans fin, les plus fragiles plus souvent. Vous arrêtez quand vous voulez.</span></span>
                <button class="btn btn-primary trx-go" data-action="trainingEx" data-arg="free" ${rows.length ? '' : 'disabled'}>${ico('play')}<span>Commencer</span></button>
            </div>
            <div class="trx-opts" role="group" aria-label="Réglages du mode libre">
                ${seg('fromStart', 'D’où partir', [[0, 'Position ciblée'], [1, 'Début de partie']])}
                ${seg('maxPlies', 'Jusqu’où', [[0, 'Toutes'], [5, '≤ 5'], [10, '≤ 10'], [20, '≤ 20']])}
                ${seg('seqLen', 'Coups à enchaîner', [[1, '1'], [3, '3'], [5, '5'], [TRAIN_SEQ_END, 'Variante']])}
            </div>
            <span class="trx-meta">${freeOpts}</span>
        </div>`;
    const exercises = `
        <section class="st-sec">
            <div class="st-h"><h3>Autres exercices</h3><span class="st-sub">chacun se termine par un bilan</span></div>
            <div class="trx-grid">
                ${card('weak', 'target', 'weak', 'Points faibles', 'Les positions à retravailler et fragiles, les plus ratées d\'abord.', `${Math.min(weak, TRAIN_WEAK_MAX)} position${weak > 1 ? 's' : ''}`, weak, 'big')}
                ${card('line', 'git-branch', '', 'Ligne complète', 'Une ouverture jouée du premier coup jusqu\'au bout de la variante.', `${openings.length} ouverture${openings.length > 1 ? 's' : ''}`, openings.length)}
                ${card('unsure', 'check', 'unsure', 'À confirmer', 'Les positions jouées moins de 3 fois, pour les ancrer.', `${Math.min(unsure, TRAIN_WEAK_MAX)} position${unsure > 1 ? 's' : ''}`, unsure)}
                ${card('timed', 'lightbulb', 'progress', 'Contre-la-montre', 'Un maximum de bons coups en 3 minutes. Une erreur coûte 10 s.', record ? `Record : ${record} coup${record > 1 ? 's' : ''}` : 'Pas encore de record', rows.length)}
                ${freeCard}
            </div>
            ${lineList}
            ${TRAIN_SOLUTION_PENALTY ? '<p class="trs-note">L\'indice (la pièce à jouer) ne compte pas. Voir la solution compte comme une erreur.</p>' : ''}
        </section>`;

    panel.innerHTML = summary + filter + `<div class="trs-top">${hero}${plan}</div>` + exercises;
}

// ─── LANCEMENT DES EXERCICES ──────────────────────────────────────────────────

function startTrainingExercise(kind) {
    const rows = _trRows(), now = Date.now(), items = (list, cmp = _trOrder) => list.sort(cmp).map(r => ({ color: r.color, key: r.key }));
    const prioFirst = (a, b) => (b.e.prio ? 1 : 0) - (a.e.prio ? 1 : 0) || _trOrder(a, b);     // « Traitée depuis » jamais réussie
    if (kind === 'line') { _trLineOpen = !_trLineOpen; initTraining(); return; }
    if (kind === 'free') { startTraining(_trColor); return; }
    if (kind === 'timed') { startSession({ kind: 'timed', label: 'Contre-la-montre', colors: _trSides() }); return; }
    const pick = {
        due:    () => rows.filter(r => isDue(r.e, now)),
        weak:   () => rows.filter(r => r.lv === 'weak' || r.lv === 'fragile').sort(_trOrder).slice(0, TRAIN_WEAK_MAX),
        unsure: () => rows.filter(r => r.lv === 'unsure').sort((a, b) => a.e.attempts - b.e.attempts).slice(0, TRAIN_WEAK_MAX)
    }[kind];
    const label = { due: 'Révision du jour', weak: 'Points faibles', unsure: 'À confirmer' }[kind];
    if (pick) startSession({ kind, label, items: items(pick(), kind === 'due' ? prioFirst : _trOrder) });
}

// Accueil Jouer : « Commencer la révision » lance la Révision du jour du répertoire actif, les deux couleurs,
// sans filtre d'ouverture (la séance est celle de l'Entraînement : elle compte).
function startDailyReview() {
    _trColor = 'mix';
    _trOpening = null;
    _trFocus = null;
    trainingState.lastSummary = null;
    startTrainingExercise('due');
}

function _startLine(line) {
    trainingState.lastSummary = null;
    startSession({ kind: 'line', label: 'Ligne complète', line });
}

registerActions({
    trainingColor: c => { _trColor = c; _trLineOpen = false; _trFocus = null; initTraining(); },
    trainingRep: name => { if (name !== currentRepertoire) selectRepertoire(name); },
    trainingEx: kind => { if (kind !== 'line') trainingState.lastSummary = null; startTrainingExercise(kind); },
    trainingLine: i => { const o = _trOpenings()[Number(i)]; if (o) _startLine({ color: o.color, path: o.path, name: o.name }); },
    trainingReplayLine: () => { const s = trainingState.lastSummary; if (s && s.line) _startLine(s.line); },
    trainingRetry: () => {
        const s = trainingState.lastSummary;
        if (!s) return;
        const items = s.rows.filter(r => !r.ok).map(r => ({ color: r.color, key: r.key }));
        trainingState.lastSummary = null;
        startSession({ kind: 'retry', label: 'Erreurs à revoir', items });
    },
    trainingCloseSummary: () => { trainingState.lastSummary = null; initTraining(); },
    trainingAllOpenings: () => { _trOpening = null; _trFocus = null; initTraining(); },
    trainingOpt: arg => { const [name, v] = arg.split(':'); setTrainingOption(name, v); }
});
