/**
 * modules/training/trainingUI.js
 * ──────────────────────────────────────────────────────────────────────────
 * Onglet Entraînement : un menu d'exercices « Rampe » (le moteur est dans training.js).
 *   - Barre de contexte : répertoire, Blancs / Noirs / Les deux (comme l'onglet Statistiques), et la puce
 *     retirable du filtre d'ouverture posé par les Statistiques (openTrainingFrom).
 *   - Trois blocs : bilan de la dernière séance (anneau du premier coup, puces, « avant → après » repliable),
 *     « Révision du jour » (carte Velours : nombre dû, durée estimée, 7 prochains jours), puis la liste des
 *     exercices (Points faibles, Ligne complète, À confirmer, Contre-la-montre, Mode libre et ses réglages)
 *     et la maîtrise par couleur.
 *   - Un seul bouton plein, choisi par _trPrimary : erreurs de la séance qui vient de finir (« Ensuite » du bilan), sinon positions
 *     à réviser aujourd'hui (reviewPlan),
 *     sinon l'exercice mis en avant (_trFocus), sinon Points faibles. Les autres actions sont tonales.
 *   - Filtre d'ouverture : les exercices ne portent que sur les positions de cette ouverture, jusqu'à ce
 *     qu'il soit retiré.
 *   - « Plateau » (920 px et plus) : un grand échiquier d'aperçu à gauche montre la position par laquelle
 *     commence l'exercice survolé ou focalisé (par défaut celui de l'action principale). Caché en dessous.
 */

'use strict';

const TRAIN_SECONDS_PER_POSITION = 30;      // pour la durée estimée de la séance
const TRAIN_WEAK_MAX   = 20;                // positions par séance « Points faibles » / « À confirmer »
let _trColor   = 'mix';                     // 'mix' | 'w' | 'b' ; « Les deux » à chaque lancement
let _trLineOpen = false;                    // liste des ouvertures (Ligne complète) dépliée
let _trFreeOpen = false;                    // réglages du mode libre dépliés
let _trOpening = null;                      // { key, name } : ouverture choisie depuis les Statistiques
let _trFocus = null;                        // exercice mis en avant à l'arrivée depuis les Statistiques
let _trPreviews = {};                       // aperçus du Plateau par exercice : { r, after, title, line, side, dot }
let _trPreviewKind = null;                  // exercice affiché sur le Plateau

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
    _trFreeOpen = false;
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

// Révisions prévues sur 7 jours pour la portée affichée (programme du répertoire, reviewPlan : les nouvelles
// positions y sont étalées au rythme de l'objectif quotidien).
const _trInScope = rows => { const ids = new Set(rows.map(r => r.color + '|' + r.key)); return (c, k) => ids.has(c + '|' + k); };
// Nouveautés à traiter (journal des parties) : proposées après un bilan.
const _trNews = () => (typeof HomePanels !== 'undefined' ? HomePanels.novelties().length : 0);

function _trForecast(rows, now, plan = reviewPlan(currentRepertoire, now)) {
    return plan.forecast(_trInScope(rows), 7).map((n, i) => ({ t: _dayStart(now, i), n }));
}

// ─── ACTION PRINCIPALE ────────────────────────────────────────────────────────
// Un seul bouton plein dans le menu. state : { due, retry, focus, avail: { weak, unsure, timed, free } }
// (nombres de positions à réviser aujourd'hui, d'erreurs de la dernière séance, exercice mis en avant, exercices disponibles).
// Comme la capsule « Suite » : erreurs du bilan d'abord, puis révisions. Renvoie 'retry', 'due', l'exercice mis en avant, 'weak', un autre exercice disponible, ou null.
const TRAIN_PRIMARY_KINDS = ['weak', 'unsure', 'timed', 'free'];
function _trPrimary(state) {
    const { due = 0, retry = 0, focus = null, avail = {} } = state || {};
    if (retry > 0) return 'retry';                      // erreurs de la séance qui vient de finir : pendant que c'est frais
    if (due > 0) return 'due';
    if (focus && TRAIN_PRIMARY_KINDS.includes(focus) && avail[focus]) return focus;
    return TRAIN_PRIMARY_KINDS.find(k => avail[k]) || null;
}

// Bouton qui lance une séance : plein (primary) ou tonal.
const _trBtn = (primary, action, arg, label, icon, extra = '') =>
    `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-soft'}" data-action="${action}"${arg != null ? ` data-arg="${arg}"` : ''}${extra}>${ico(icon)}<span>${label}</span></button>`;

// ─── BILAN DE LA DERNIÈRE SÉANCE ──────────────────────────────────────────────
// Anneau du premier coup, puces (erreurs, niveaux montés, descendus), actions, puis la liste « avant → après »
// (repliée sur téléphone, dépliée sur bureau).

// « Ensuite » : jusqu'à trois suites, la première pleine quand le bilan porte l'action principale.
// next : { due, minutes, news } (positions à réviser aujourd'hui, nouveautés à traiter).
function _trNextItems(nMiss, next = {}) {
    const out = [];
    if (nMiss) out.push({ action: 'trainingRetry', icon: 'rotate-ccw', label: nMiss > 1 ? `Revoir les ${nMiss} erreurs` : 'Revoir l’erreur', meta: 'Tout de suite, pendant que c’est frais', tone: 'err' });
    if (next.due) out.push({ action: 'trainingEx', arg: 'due', icon: 'play', label: 'Révision du jour', meta: `${next.due} à réviser · ≈ ${next.minutes} min`, tone: 'accent' });
    if (next.news) out.push({ action: 'suiteNews', icon: 'folder-open', label: next.news > 1 ? `Répondre à ${next.news} nouveautés` : 'Répondre à une nouveauté', meta: 'Coups adverses vus dans vos parties', tone: 'new' });
    return out.slice(0, 3);
}
function _trNextHTML(items, primary) {
    if (!items.length) return '';
    return `<div class="trr-next" role="group" aria-label="Ensuite"><span class="st-eyebrow">Ensuite</span>${items.map((it, i) => `
        <button type="button" class="trr-next-row${primary && i === 0 ? ' is-primary' : ''}" data-action="${it.action}"${it.arg ? ` data-arg="${it.arg}"` : ''} style="--c:var(--${it.tone === 'accent' ? 'accent' : it.tone})">
            <span class="trr-ic">${ico(it.icon)}</span><span class="trr-t"><b>${it.label}</b><small>${it.meta}</small></span>${ico('chevron-right')}
        </button>`).join('')}</div>`;
}

function _trSummaryHTML(s, primary, next) {
    if (!s) return '';
    const side = r => r.color === 'w' ? 'Blancs' : 'Noirs';
    const where = r => { const op = r.e.path ? openingNameOf(r.e.path) : null; return side(r) + (op ? ' · ' + escapeHtml(op.name) : ''); };
    const chip = l => `<span class="lv-chip lv-${l}">${STATS_LEVELS[l].one}</span>`;
    const rank = l => STATS_LEVEL_ORDER.indexOf(l);
    const missed = s.rows.filter(r => !r.ok);
    const up = s.rows.filter(r => rank(r.lvAfter) > rank(r.lvBefore)).length;
    const down = s.rows.filter(r => rank(r.lvAfter) < rank(r.lvBefore)).length;
    const timed = s.kind === 'timed';
    const pct = s.total ? Math.round(100 * s.ok / s.total) : 0;
    const title = timed ? (s.newRecord ? 'Nouveau record !' : `${s.score} bon${s.score > 1 ? 's' : ''} coup${s.score > 1 ? 's' : ''}`)
        : s.early ? 'Séance interrompue' : pct >= 80 ? 'Très bonne séance' : pct >= 60 ? 'Bonne séance' : 'Séance utile';
    const ring = timed
        ? Ring.html({ value: s.score, max: Math.max(1, s.record, s.score), size: 64, stroke: 6, label: String(s.score), ariaLabel: `${s.score} bons coups, record ${s.record}` })
        : Ring.html({ value: s.ok, max: s.total, size: 64, stroke: 6, label: `${s.ok}/${s.total}`, ariaLabel: `${s.ok} sur ${s.total} du premier coup` });
    const act = readActivity(), goalHit = (act[dayStamp(Date.now())] || { a: 0 }).a >= appSettings.dailyGoal;
    const badges = [
        goalHit ? `<span class="vbadge is-accent">${ico('check')}Objectif du jour atteint</span>` : '',
        missed.length ? `<span class="vbadge is-err">${missed.length} à revoir</span>` : '',
        up ? `<span class="vbadge is-ok">${ico('chevron-up')}${up} niveau${up > 1 ? 'x' : ''} monté${up > 1 ? 's' : ''}</span>` : '',
        down ? `<span class="vbadge is-warn">${ico('chevron-down')}${down} descendu${down > 1 ? 's' : ''}</span>` : ''
    ].join('');
    const nMiss = missed.length;
    const acts = timed ? _trBtn(false, 'trainingEx', 'timed', 'Rejouer', 'rotate-ccw')
        : s.kind === 'line' ? _trBtn(false, 'trainingReplayLine', null, 'Rejouer la ligne', 'play') : '';
    const ensuite = timed ? '' : _trNextHTML(_trNextItems(nMiss, next), primary);
    // Ratées d'abord, puis les niveaux qui ont bougé.
    const rows = s.rows.slice().sort((a, b) => (a.ok - b.ok) || (Math.abs(rank(b.lvAfter) - rank(b.lvBefore)) - Math.abs(rank(a.lvAfter) - rank(a.lvBefore))));
    const list = rows.filter(r => !r.ok || r.lvAfter !== r.lvBefore).slice(0, 12).map(r => `
        <li class="trr-move">${ico(r.ok ? 'check' : 'x', r.ok ? 'is-ok' : 'is-err')}<span class="sr-only">${r.ok ? 'Réussie' : 'Ratée'}</span>
            <span class="trr-move-san">${_moveLabel(r.e, false, true)}</span><span class="trr-move-op">${where(r)}</span>
            <span class="trr-move-lv">${r.lvAfter !== r.lvBefore ? `<i class="lv-mark lv-${r.lvBefore}" title="${STATS_LEVELS[r.lvBefore].one}"></i><span class="trr-arr" aria-label="devient">→</span>` : ''}${chip(r.lvAfter)}</span></li>`).join('');
    const wide = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 600px)').matches;
    return `
        <section class="trr-bilan edge-card" data-focus="retry" aria-label="Bilan de la dernière séance">
            <div class="trr-bilan-head">${ring}
                <div class="trr-bilan-t"><span class="st-eyebrow">${escapeHtml(s.label)}${s.line ? ' · ' + escapeHtml(s.line.name) : ''} · ${s.minutes} min</span>
                    <b>${title}</b><small>${timed ? `Record : ${s.record}` : 'du premier coup'}</small></div>
                <button type="button" class="icon-btn trr-close" data-action="trainingCloseSummary" aria-label="Fermer le bilan" title="Fermer le bilan">${ico('x')}</button>
            </div>
            ${badges ? `<div class="trr-badges">${badges}</div>` : ''}
            ${acts ? `<div class="trr-acts">${acts}</div>` : ''}
            ${ensuite}
            ${list ? `<details class="trr-detail"${wide ? ' open' : ''}><summary>${ico('chevron-down')}<span>Avant → après</span></summary><ul class="trr-moves">${list}</ul></details>` : ''}
        </section>`;
}

// ─── PLATEAU (APERÇU) ──────────────────────────────────────────────────────────
// La position par laquelle commence chaque exercice, dessinée en grand à gauche du menu (920 px et plus).
// Survoler ou focaliser un exercice change l'aperçu ; rien n'est lancé.

const TRAIN_PREVIEW_DOT = { due: 'accent', retry: 'err', weak: 'err', unsure: 'muted', line: 'accent', timed: 'warn', free: 'accent', empty: 'muted' };

// Aperçu d'une position du répertoire (avant mon coup) : { r, after, title, line, side }.
function _trPreviewOf(row, over) {
    if (!row) return null;
    const path = row.e.path && row.e.path.length ? row.e.path : null, op = path ? openingNameOf(path) : null;
    return { r: { side: row.color, path, k: row.key }, after: false, title: over + ' · ' + (op ? op.name : 'Position de départ'),
             line: path && path.length > 1 ? _movesLabel(path.slice(0, -1), true) : '', side: row.color === 'w' ? 'Blancs au trait' : 'Noirs au trait' };
}

function _trStageHTML(kind) {
    const p = _trPreviews[kind];
    if (!p) return '';
    const board = _miniBoardHTML(p.r, p.after, { label: 'Aperçu : ' + p.title });
    return `<div class="trr-stage-b">${board}<span class="trr-stage-pill"><i class="is-${TRAIN_PREVIEW_DOT[kind] || 'accent'}"></i><span>${escapeHtml(p.title)}</span></span></div>
        <div class="trr-stage-cap"><span class="trr-stage-line">${p.line || ''}</span><span>${escapeHtml(p.side || '')}</span></div>`;
}

function _trShowPreview(kind) {
    const stage = document.getElementById('trr-stage');
    if (!stage || !_trPreviews[kind] || kind === _trPreviewKind) return;
    _trPreviewKind = kind;
    stage.innerHTML = _trStageHTML(kind);
    document.querySelectorAll('#training-panel [data-focus]').forEach(el => el.classList.toggle('is-preview', el.dataset.focus === kind));
}

// Survol et focus dans le menu : écouteurs posés une seule fois sur le panneau (pas d'empilement à chaque rendu).
function _trBindPreview(panel) {
    if (panel.dataset.preview) return;
    panel.dataset.preview = '1';
    const pick = e => { const el = e.target.closest && e.target.closest('[data-focus]'); if (el && panel.contains(el)) _trShowPreview(el.dataset.focus); };
    panel.addEventListener('pointerover', pick);
    panel.addEventListener('focusin', pick);
}

// ─── ONGLET ───────────────────────────────────────────────────────────────────

// Filtre d'ouverture : puce retirable dans la barre de contexte.
function _trRenderFilter() {
    const scope = document.querySelector('#home-tab-training .st-scope');
    if (!scope) return;
    let el = document.getElementById('training-filter');
    if (!_trOpening) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('span'); el.id = 'training-filter'; el.className = 'trr-filter'; scope.appendChild(el); }
    el.innerHTML = `${ico('git-branch')}<span>${escapeHtml(_trOpening.name)}</span>
        <button type="button" class="trr-filter-x" data-action="trainingAllOpenings" aria-label="Retirer le filtre d'ouverture" title="Toutes les ouvertures">${ico('x')}</button>`;
}

// Stepper − / + sur les valeurs proposées aussi dans les Paramètres.
const TRAIN_FREE_STEPS = { maxPlies: [[0, 'Toutes'], [5, '≤ 5'], [10, '≤ 10'], [20, '≤ 20']], seqLen: [[1, '1'], [3, '3'], [5, '5'], [TRAIN_SEQ_END, 'Variante']] };
function _trStep(name, dir) {
    const vals = TRAIN_FREE_STEPS[name].map(o => o[0]), v = trainingSettings[name];
    const next = dir > 0 ? vals.find(x => x > v) : vals.slice().reverse().find(x => x < v);
    return next == null ? null : next;
}

function initTraining() {
    if (typeof Suite !== 'undefined') Suite.refresh();
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
    _trRenderFilter();

    const rows = _trRows(), now = Date.now();
    const s = trainingState.lastSummary;
    const retry = s && s.kind !== 'timed' ? s.rows.filter(r => !r.ok).length : 0;
    if (!rows.length) {
        _trPreviews = { empty: { r: { side: _trColor === 'b' ? 'b' : 'w', path: null, k: INIT_FEN }, after: true,
            title: _trOpening ? 'Aucune position de cette ouverture' : 'Répertoire vide', line: '', side: '' } };
        _trPreviewKind = 'empty';
        panel.innerHTML = `<div class="trr is-empty${s ? ' has-bilan' : ''}">
            <section class="trr-stage is-empty" id="trr-stage" aria-label="Aperçu de la position">${_trStageHTML('empty')}</section>
            ${_trSummaryHTML(s, false, { news: _trNews() })}
            <div class="trr-empty edge-card">
                <b>Rien à réviser pour l’instant</b>
                <span>${_trOpening ? 'Aucune position de cette ouverture' : 'Aucune position'}${_trColor === 'mix' ? '' : ` avec les ${_trColor === 'w' ? 'Blancs' : 'Noirs'}`} dans ce répertoire.</span>
                <div class="trr-empty-acts">${_trBtn(true, 'trainingAddLine', null, 'Ajouter une ligne', 'plus')}${_trBtn(false, 'homeImportPgn', null, 'Importer un PGN', 'upload')}</div>
            </div></div>`;
        return;
    }

    const plan = reviewPlan(currentRepertoire, now);
    const due = rows.filter(r => plan.today(r.color, r.key));
    const weak = rows.filter(r => r.lv === 'weak' || r.lv === 'fragile').length;
    const unsure = rows.filter(r => r.lv === 'unsure').length;
    const primary = _trPrimary({ due: due.length, retry, focus: _trFocus, avail: { weak: weak > 0, unsure: unsure > 0, timed: true, free: true } });
    const freeOpen = _trFreeOpen || primary === 'free';

    // ── Révision du jour ──
    const minutes = Math.max(1, Math.round(due.length * TRAIN_SECONDS_PER_POSITION / 60));
    const next = due.length ? 0 : plan.next(_trInScope(rows));
    const fresh = due.filter(r => !r.e.attempts).length, again = due.length - fresh;
    const act = readActivity(), streak = _streak(act), today = (act[dayStamp(now)] || { a: 0 }).a, goal = appSettings.dailyGoal;
    const scopeName = { w: 'Blancs', b: 'Noirs', mix: 'Blancs et Noirs' }[_trColor] + (_trOpening ? ' · ' + escapeHtml(_trOpening.name) : '');
    const days = _trForecast(rows, now, plan), max = Math.max(1, ...days.map(d => d.n));
    const dayName = (t, i) => i === 0 ? 'auj.' : i === 1 ? 'dem.' : new Date(t).toLocaleDateString('fr-FR', { weekday: 'short' });
    const forecast = `<div class="trr-fc" role="img" aria-label="Révisions prévues sur 7 jours : ${days.map(d => d.n).join(', ')}">${days.map((d, i) =>
        `<div title="${d.n} révision${d.n > 1 ? 's' : ''}"><b>${d.n || ''}</b><i style="height:${Math.max(3, Math.round(36 * d.n / max))}px"></i><span>${dayName(d.t, i)}</span></div>`).join('')}</div>`;
    const hero = `
        <section class="vel-card vel-dark trr-day edge-card${_trFocus === 'due' ? ' is-focus' : ''}" data-focus="due" aria-label="Révision du jour">
            <span class="st-eyebrow">Révision du jour · ${scopeName}</span>
            ${due.length ? `<div class="trr-big"><b>${due.length}</b><span>à réviser aujourd’hui · ≈ ${minutes} min</span></div>
                <div class="trr-split">${[fresh ? `${fresh} nouvelle${fresh > 1 ? 's' : ''}` : '', again ? `${again} à revoir` : ''].filter(Boolean).join(' · ')}</div>`
                         : `<div class="trr-big is-text"><b>À jour</b><span>Prochaine révision ${Number.isFinite(next) && next ? _inLabel(next) : 'bientôt'}</span></div>`}
            ${forecast}
            ${due.length ? _trBtn(primary === 'due', 'trainingEx', 'due', 'Commencer', 'play') : ''}
            <span class="trr-foot"><span>${streak} jour${streak > 1 ? 's' : ''} d'affilée</span><span>${Math.min(today, goal)} / ${goal} aujourd'hui</span></span>
        </section>`;

    // ── Exercices ──
    const openings = _trOpenings();
    const record = Number(dataStore.getJSON(TRAIN_RECORD_KEY, 0)) || 0;
    const freeOpts = [trainingSettings.fromStart ? 'début' : 'ciblée', trainingSettings.maxPlies ? `≤ ${trainingSettings.maxPlies}` : 'toutes',
                      trainingSettings.seqLen >= TRAIN_SEQ_END ? 'variante' : `${trainingSettings.seqLen} coup${trainingSettings.seqLen > 1 ? 's' : ''}`].join(' · ');
    const row = (kind, icon, lvl, title, n, small, opts = {}) => `
        <button type="button" class="trr-row${_trFocus === kind ? ' is-focus' : ''}" data-focus="${kind}" data-action="${opts.expanded != null ? 'trainingToggle' : 'trainingEx'}" data-arg="${kind}"
            ${lvl ? `style="--c:var(--lv-${lvl})"` : ''} ${n === 0 ? `disabled title="${opts.empty}"` : ''} ${opts.expanded != null ? `aria-expanded="${opts.expanded}"` : ''}>
            <span class="trr-ic">${ico(icon)}</span>
            <span class="trr-t"><b>${title}</b>${small ? `<small>${small}</small>` : ''}</span>
            ${n != null ? `<span class="trr-n">${n}</span>` : ''}${ico(opts.expanded == null ? 'chevron-right' : opts.expanded ? 'chevron-up' : 'chevron-down')}
        </button>`;
    const lineList = _trLineOpen ? `
        <div class="trr-sub" role="group" aria-label="Choisir une ouverture">
            ${openings.length ? openings.map((o, i) => `<button type="button" class="trr-line" data-action="trainingLine" data-arg="${i}">
                <span class="trr-t"><b>${_trColor === 'mix' ? `<span class="trr-side">${o.color === 'w' ? 'Blancs' : 'Noirs'}</span>` : ''}${escapeHtml(o.name)}</b><small>${_movesLabel(o.path, true)}</small></span>
                <span class="trr-n">${o.n} pos.</span>${ico('play')}</button>`).join('')
              : '<div class="trr-note">Aucune ouverture reconnue dans ce répertoire.</div>'}
        </div>` : '';
    // Mode libre : la carte porte ses réglages (aussi dans Paramètres › Jeu).
    const stepper = (name, label) => {
        const cur = TRAIN_FREE_STEPS[name].find(o => o[0] === trainingSettings[name]);
        const btn = (dir, txt, aria) => { const v = _trStep(name, dir);
            return `<button type="button" class="trr-step-btn" data-action="trainingOpt" data-arg="${name}:${v}" aria-label="${aria}" ${v == null ? 'disabled' : ''}>${txt}</button>`; };
        return `<div class="trr-opt"><span id="trr-opt-${name}">${label}</span>
            <span class="trr-step" role="group" aria-labelledby="trr-opt-${name}">${btn(-1, '−', 'Moins')}<output aria-live="polite">${cur ? cur[1] : trainingSettings[name]}</output>${btn(1, '+', 'Plus')}</span></div>`;
    };
    const freePanel = freeOpen ? `
        <div class="trr-sub trr-free" role="group" aria-label="Réglages du mode libre">
            <div class="trr-opt"><span id="trr-opt-fromStart">Partir du début de partie</span>
                <button type="button" class="pn-switch" role="switch" aria-checked="${!!trainingSettings.fromStart}" aria-labelledby="trr-opt-fromStart"
                    data-action="trainingOpt" data-arg="fromStart:${trainingSettings.fromStart ? 0 : 1}"></button></div>
            ${stepper('maxPlies', 'Jusqu’où')}
            ${stepper('seqLen', 'Coups à enchaîner')}
            ${_trBtn(primary === 'free', 'trainingEx', 'free', 'Lancer le mode libre', 'play')}
        </div>` : '';
    const label = { weak: 'Points faibles', unsure: 'À confirmer', timed: 'Contre-la-montre' }[primary];
    const count = { weak: Math.min(weak, TRAIN_WEAK_MAX), unsure: Math.min(unsure, TRAIN_WEAK_MAX) }[primary];
    const cta = label ? `<div class="trr-cta">${_trBtn(true, 'trainingEx', primary, label + (count ? ` · ${count} position${count > 1 ? 's' : ''}` : ''), 'play')}</div>` : '';
    const exercises = `
        <section class="trr-ex" aria-labelledby="trr-ex-h">
            <div class="trr-h"><h3 id="trr-ex-h">Exercices</h3></div>
            <div class="trr-list edge-card">
                ${row('weak', 'target', 'weak', 'Points faibles', Math.min(weak, TRAIN_WEAK_MAX), '', { empty: 'Aucune position fragile ni à retravailler' })}
                ${row('line', 'git-branch', '', 'Ligne complète', openings.length, '', { empty: 'Aucune ouverture reconnue', expanded: _trLineOpen })}
                ${lineList}
                ${row('unsure', 'check', 'unsure', 'À confirmer', Math.min(unsure, TRAIN_WEAK_MAX), '', { empty: 'Aucune position à confirmer' })}
                ${row('timed', 'lightbulb', 'progress', 'Contre-la-montre', null, `3 min · ${record ? `record ${record}` : 'pas encore de record'}`)}
                ${row('free', 'shuffle', '', 'Mode libre', null, freeOpts, { expanded: freeOpen })}
                ${freePanel}
                ${cta}
            </div>
        </section>`;

    // ── Maîtrise par couleur ──
    const mastery = _trSides().filter(has).map(c => {
        const list = rows.filter(r => r.color === c), counts = {};
        if (!list.length) return '';
        STATS_LEVEL_ORDER.forEach(l => { counts[l] = list.filter(r => r.lv === l).length; });
        return `<div class="trr-m"><span>${c === 'w' ? 'Blancs' : 'Noirs'}</span>${levelBarHTML(counts, 'tr-bar')}<b>${Math.round(100 * counts.mastered / list.length)} %</b></div>`;
    }).join('');
    const mast = `
        <section class="trr-mast" aria-labelledby="trr-mast-h">
            <div class="trr-h"><h3 id="trr-mast-h">Maîtrise</h3><span>${rows.length} position${rows.length > 1 ? 's' : ''}</span></div>
            <div class="trr-mast-in edge-card">${mastery}${unsure ? `<div class="trr-m"><span></span><span class="lv-chip lv-unsure">${unsure} à confirmer</span></div>` : ''}</div>
        </section>`;

    // ── Plateau : la position de départ de chaque exercice ──
    const sorted = (list, cmp = _trOrder) => list.slice().sort(cmp);
    const start = (title, line) => ({ r: { side: _trColor === 'b' ? 'b' : 'w', path: null, k: INIT_FEN }, after: true, title, line: escapeHtml(line), side: '' });
    const firstLine = openings[0];
    const missed = s && s.kind !== 'timed' ? s.rows.find(r => !r.ok) : null;
    _trPreviews = {
        due:    _trPreviewOf(sorted(due, (a, b) => dueOf(a.e) - dueOf(b.e))[0], 'La plus en retard'),
        retry:  missed ? _trPreviewOf(missed, 'Ratée') : null,
        weak:   _trPreviewOf(sorted(rows.filter(r => r.lv === 'weak' || r.lv === 'fragile'))[0], 'Point faible'),
        unsure: _trPreviewOf(sorted(rows.filter(r => r.lv === 'unsure'), (a, b) => a.e.attempts - b.e.attempts)[0], 'À confirmer'),
        line:   firstLine ? { r: { side: firstLine.color, path: firstLine.path, k: null }, after: true, title: 'Ligne complète · ' + firstLine.name,
                              line: _movesLabel(firstLine.path, true), side: firstLine.color === 'w' ? 'Blancs' : 'Noirs' } : null,
        timed:  start('Contre-la-montre · positions au hasard', 'Tout le répertoire · 3 min'),
        free:   start('Mode libre', freeOpts)
    };
    const shown = [primary, 'due', 'weak', 'line'].find(k => k && _trPreviews[k]) || 'timed';
    _trPreviewKind = shown;
    const stage = `<section class="trr-stage" id="trr-stage" aria-label="Aperçu de la position">${_trStageHTML(shown)}</section>`;

    panel.innerHTML = `<div class="trr${s ? ' has-bilan' : ''}">${stage}${_trSummaryHTML(s, primary === 'retry', { due: due.length, minutes, news: _trNews() })}${hero}${exercises}${mast}</div>`;
    panel.querySelectorAll('[data-focus]').forEach(el => el.classList.toggle('is-preview', el.dataset.focus === shown));
    _trBindPreview(panel);
}

// ─── LANCEMENT DES EXERCICES ──────────────────────────────────────────────────

function startTrainingExercise(kind) {
    const rows = _trRows(), now = Date.now(), items = (list, cmp = _trOrder) => list.sort(cmp).map(r => ({ color: r.color, key: r.key }));
    const prioFirst = (a, b) => (b.e.prio ? 1 : 0) - (a.e.prio ? 1 : 0) || _trOrder(a, b);     // « Traitée depuis » jamais réussie
    if (kind === 'line') { _trLineOpen = !_trLineOpen; initTraining(); return; }
    if (kind === 'free') { startTraining(_trColor); return; }
    if (kind === 'timed') { startSession({ kind: 'timed', label: 'Contre-la-montre', colors: _trSides() }); return; }
    const pick = {
        due:    () => { const plan = reviewPlan(currentRepertoire, now); return rows.filter(r => plan.today(r.color, r.key)); },
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

// Bouton occupé le temps de préparer la séance (aria-busy), puis lancement à l'image suivante.
// Sans bouton (appel direct, tests) : lancement immédiat.
function _trLaunch(el, fn) {
    if (!el || !el.isConnected) { fn(); return; }
    el.setAttribute('aria-busy', 'true');
    el.disabled = true;
    const label = el.querySelector('span');
    if (label) label.textContent = 'Préparation…';
    setTimeout(() => {
        fn();
        if (el.isConnected) { el.removeAttribute('aria-busy'); el.disabled = false; }
    }, 30);
}

registerActions({
    trainingColor: c => { _trColor = c; _trLineOpen = false; _trFocus = null; initTraining(); },
    trainingRep: name => { if (name !== currentRepertoire) selectRepertoire(name); },
    trainingEx: (kind, el) => _trLaunch(el, () => { if (kind !== 'line') trainingState.lastSummary = null; startTrainingExercise(kind); }),
    trainingToggle: kind => {
        if (kind === 'line') _trLineOpen = !_trLineOpen;
        if (kind === 'free') _trFreeOpen = !_trFreeOpen;
        initTraining();
    },
    trainingLine: (i, el) => { const o = _trOpenings()[Number(i)]; if (o) _trLaunch(el, () => _startLine({ color: o.color, path: o.path, name: o.name })); },
    trainingReplayLine: (a, el) => { const s = trainingState.lastSummary; if (s && s.line) _trLaunch(el, () => _startLine(s.line)); },
    trainingRetry: (a, el) => {
        const s = trainingState.lastSummary;
        if (!s) return;
        const items = s.rows.filter(r => !r.ok).map(r => ({ color: r.color, key: r.key }));
        if (!items.length) return;
        _trLaunch(el, () => {
            trainingState.lastSummary = null;
            if (!startSession({ kind: 'retry', label: 'Erreurs à revoir', items })) initTraining();
        });
    },
    trainingCloseSummary: () => { trainingState.lastSummary = null; initTraining(); },
    trainingAllOpenings: () => { _trOpening = null; _trFocus = null; initTraining(); },
    trainingAddLine: () => { if (_trColor === 'w' || _trColor === 'b') startGame(_trColor); else switchHomeTab('play'); },
    trainingOpt: arg => { const [name, v] = arg.split(':'); if (v !== 'null') { _trFreeOpen = true; setTrainingOption(name, v); } }
});
