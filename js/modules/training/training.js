/**
 * modules/training/training.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Entraînement : révision du répertoire actif, par tirage aléatoire pondéré.
 * Chaque position reçoit un poids (cf. _trainingWeight) ; sa probabilité de sortie est
 * poids / somme des poids de l'univers. Les positions fragiles ou oubliées sortent souvent,
 * les positions maîtrisées ou vues récemment rarement — mais jamais avec une probabilité nulle.
 *
 * Pour chaque position : l'échiquier se place 3 demi-coups avant, rejoue
 * automatiquement ces trois coups (contexte), puis me rend la main.
 *   - succès : attempts + 1 et planning de révision mis à jour (recordReview, storage.js)
 *   - erreur : coup refusé, attempts + 1 et failures + 1 (comme dans « Jouer »), on réessaie.
 *
 * Options (persistées, défauts = comportement historique) :
 *   - Profondeur max  : 0 = illimitée ; sinon seules les positions avec ply <= maxPlies sont tirées.
 *   - Départ          : fromStart 0 = position tirée au sort (ci-dessus) ;
 *                       1 = ligne complète, de la position initiale jusqu'à la fin de la variante.
 *   - Exercice        : seqLen 1 = coup unique ; 3 / 5 = nombre de coups à enchaîner ; 999 = fin de variante
 *                       (sans objet en ligne complète, qui va toujours jusqu'au bout).
 *     Après chaque bon coup, l'ordinateur rejoue une réponse adverse enregistrée dans les `path` du
 *     répertoire — de préférence celle qui mène aux positions les plus à réviser — et la position
 *     suivante est interrogée (erreurs comptées sur la position exacte).
 *   - Solution        : 2e appui sur Indice (cf. showHint) ; surligne le coup attendu, aucune réussite comptée.
 *   - Blancs et Noirs mélangés : la couleur est tirée à pile ou face avant chaque exercice (chaque variante),
 *     parmi les couleurs qui ont des positions ; la position est ensuite choisie comme d'habitude.
 */

'use strict';

const TRAIN_STEP_MS = 750;
const TRAIN_CONTEXT_PLIES = 3;   // demi-coups rejoués avant que la main soit rendue

// Afficher la solution compte comme un échec sur la position (attempts + 1, failures + 1), une seule fois.
// Mettre à false pour que la solution ne modifie aucune statistique.
const TRAIN_SOLUTION_PENALTY = true;

const TRAIN_SETTINGS_KEY = 'chessTrainer.trainingSettings';
const TRAIN_SEQ_END      = 999;

const trainingState = {
    busy: false, timers: [], lastKey: null, current: null, ok: 0, reason: '', mixed: false,
    seq: { len: 1, done: 0, assisted: false },
    solutionFor: null
};

// ─── OPTIONS (persistées) ─────────────────────────────────────────────────────

function _loadTrainingSettings() {
    const d = { maxPlies: 0, seqLen: 1, fromStart: 0 };
    try {
        const s = dataStore.getJSON(TRAIN_SETTINGS_KEY, null) || {};
        if (Number.isFinite(s.maxPlies) && s.maxPlies >= 0) d.maxPlies = s.maxPlies;
        if (Number.isFinite(s.seqLen)   && s.seqLen   >= 1) d.seqLen   = s.seqLen;
        if (s.fromStart === 1) d.fromStart = 1;
    } catch (_) { /* stockage indisponible : valeurs par défaut */ }
    return d;
}

const trainingSettings = _loadTrainingSettings();

function setTrainingOption(name, value) {
    trainingSettings[name] = Number(value);
    dataStore.setJSON(TRAIN_SETTINGS_KEY, trainingSettings);
    initTraining();
}

function _entryDepth(e) { return e.ply || (e.path && e.path.length) || null; }

function _isEligible(e) {
    if (!trainingSettings.maxPlies) return true;
    const d = _entryDepth(e);
    return d !== null && d <= trainingSettings.maxPlies;
}

function _later(fn, ms) { trainingState.timers.push(setTimeout(fn, ms)); }

function stopTraining() {
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    trainingState.busy   = false;
}

// ─── ÉCRAN D'ACCUEIL DU MODULE ────────────────────────────────────────────────

// Résumé d'une couleur pour l'écran d'accueil : volumes, niveaux (mêmes seuils que les Statistiques),
// révisions dues et prochaine échéance.
function _trainingSummary(color) {
    const all = Object.values(readDBFor(currentRepertoire, color));
    const pool = all.filter(_isEligible), now = Date.now();
    const lv = { mastered: 0, fragile: 0, weak: 0 };
    pool.forEach(e => { lv[e.attempts ? _level(e) : 'mastered']++; });
    const due  = pool.filter(e => isDue(e, now)).length;
    const next = pool.length && !due ? Math.min(...pool.map(dueOf)) : 0;
    return { all: all.length, total: pool.length, due, next, lv,
             mastery: pool.length ? Math.round(100 * lv.mastered / pool.length) : 0 };
}

function _inLabel(t) {
    const min = Math.max(1, Math.round((t - Date.now()) / 60000));
    if (min < 60)   return `dans ${min} min`;
    if (min < 1440) return `dans ${Math.round(min / 60)} h`;
    const d = Math.round(min / 1440);
    return `dans ${d} jour${d > 1 ? 's' : ''}`;
}

// ─── ÉCRAN « SÉANCE DU JOUR » ─────────────────────────────────────────────────
// Une action principale (commencer la séance), la charge des 7 prochains jours, la maîtrise par couleur ;
// les trois options sont rangées dans des puces qui ouvrent leur réglage.
const TRAIN_SECONDS_PER_POSITION = 30;      // pour la durée estimée de la séance
let _trColor = null;                        // 'mix' | 'w' | 'b' ; null : choisi d'après les positions
let _trOpenOpt = null;                      // option dont le réglage est déplié

// Révisions prévues sur 7 jours (jours du calendrier : robuste aux changements d'heure).
function _trForecast(now) {
    const d0 = new Date(now);
    const days = Array.from({ length: 8 }, (_, i) => ({ t: new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime(), n: 0 }));
    ['w', 'b'].forEach(c => Object.values(readDBFor(currentRepertoire, c)).filter(_isEligible).forEach(e => {
        const d = dueOf(e);
        if (d <= now) { days[0].n++; return; }
        const i = days.findIndex((day, k) => k < 7 && d >= day.t && d < days[k + 1].t);
        if (i >= 0) days[i].n++;
    }));
    return days.slice(0, 7);
}

function initTraining() {
    const panel = document.getElementById('training-panel');
    if (!panel) return;

    const sums = { w: _trainingSummary('w'), b: _trainingSummary('b') };
    const due = sums.w.due + sums.b.due, total = sums.w.total + sums.b.total;
    const sides = ['w', 'b'].filter(c => sums[c].total);
    if (!_trColor || (_trColor !== 'mix' && !sums[_trColor].total) || (_trColor === 'mix' && sides.length < 2)) {
        _trColor = sides.length === 2 ? 'mix' : sides[0] || 'mix';
    }

    // ── Réglages : trois puces, une seule dépliée à la fois ──
    const full = trainingSettings.fromStart === 1;
    const OPTS = {
        fromStart: { label: 'Départ', rows: [[0, 'Position ciblée'], [1, 'Début de partie']] },
        maxPlies:  { label: 'Profondeur', rows: [[0, 'Toutes'], [5, '≤ 5'], [10, '≤ 10'], [20, '≤ 20']] },
        seqLen:    { label: 'Exercice', rows: [[1, '1 coup'], [3, '3 coups'], [5, '5 coups'], [TRAIN_SEQ_END, 'Variante']] }
    };
    const current = name => (OPTS[name].rows.find(([v]) => Number(v) === Number(trainingSettings[name])) || OPTS[name].rows[0])[1];
    const names = full ? ['fromStart', 'maxPlies'] : ['fromStart', 'maxPlies', 'seqLen'];
    const chips = names.map(n => `<button class="trs-chip ${_trOpenOpt === n ? 'open' : ''}" aria-expanded="${_trOpenOpt === n}" data-action="trainingOpt" data-arg="${n}">
            ${OPTS[n].label} : <b>${current(n)}</b>${ico('chevron-down')}</button>`).join('')
        + (full ? '<span class="trs-note">Toute la ligne, jusqu\'à la fin de la variante</span>' : '');
    const open = _trOpenOpt && names.includes(_trOpenOpt) ? `
        <div class="tr-seg trs-seg" role="radiogroup" aria-label="${OPTS[_trOpenOpt].label}">
            ${OPTS[_trOpenOpt].rows.map(([v, txt]) => `<button class="tr-seg-btn ${Number(v) === Number(trainingSettings[_trOpenOpt]) ? 'active' : ''}" role="radio" aria-checked="${Number(v) === Number(trainingSettings[_trOpenOpt])}"
                data-action="trainingOption" data-arg="${_trOpenOpt}=${v}">${txt}</button>`).join('')}
        </div>` : '';
    const settings = `<div class="trs-settings">${chips}</div>${open}`;

    if (!total) {
        const any = sums.w.all + sums.b.all;
        panel.innerHTML = `<div class="trs-empty">
            <b>${any ? 'Aucune position dans cette limite' : 'Rien à réviser pour l\'instant'}</b>
            <span>${any ? 'Augmentez la profondeur pour inclure vos positions.' : `Jouez vos lignes dans « Jouer » : elles apparaîtront ici pour être révisées.`}</span>
        </div>` + settings;
        return;
    }

    // ── Séance du jour ──
    const upToDate = Math.round(100 * (total - due) / total);
    const minutes = Math.max(1, Math.round(due * TRAIN_SECONDS_PER_POSITION / 60));
    const streak = typeof _streak === 'function' ? _streak(readActivity()) : 0;
    const today = (readActivity()[dayStamp(Date.now())] || { a: 0 }).a;
    const colorBtn = (c, label) => `<button class="trs-color ${_trColor === c ? 'active' : ''}" aria-pressed="${_trColor === c}" data-action="trainingColor" data-arg="${c}">${label}</button>`;
    const colors = sides.length === 2 ? colorBtn('mix', 'Les deux') + colorBtn('w', 'Blancs') + colorBtn('b', 'Noirs')
                                      : colorBtn(sides[0], sides[0] === 'w' ? 'Blancs' : 'Noirs');
    const title = !due ? 'Tout est à jour'
        : sides.length === 2 ? `${sums.w.due} Blancs, ${sums.b.due} Noirs`
        : `${due} position${due > 1 ? 's' : ''}`;
    const next = Math.min(...sides.map(c => sums[c].next || Infinity));
    const hero = `
        <section class="trs-hero">
            <div class="trs-ring" style="--p:${upToDate}" title="${upToDate} % du répertoire est à jour">
                <div><b>${due || ico('check')}</b><span>${due ? 'à réviser' : 'à jour'}</span></div>
            </div>
            <div class="trs-hero-main">
                <span class="trs-eyebrow">${due ? `Séance du jour · environ ${minutes} min` : `Prochaine révision ${Number.isFinite(next) && next ? _inLabel(next) : 'bientôt'}`}</span>
                <h2 class="trs-title">${title}</h2>
                <div class="trs-colors" role="group" aria-label="Couleur">${colors}</div>
                <button class="btn btn-primary trs-start" data-action="startTraining" data-arg="${_trColor}">${due ? 'Commencer la séance' : 'S\'entraîner quand même'} ${ico('chevron-right')}</button>
            </div>
        </section>`;

    // ── 7 prochains jours ──
    const days = _trForecast(Date.now()), max = Math.max(1, ...days.map(d => d.n));
    const dayName = (t, i) => i === 0 ? 'auj.' : i === 1 ? 'dem.' : new Date(t).toLocaleDateString('fr-FR', { weekday: 'short' });
    const forecast = `<div class="trs-bars" role="img" aria-label="Révisions prévues sur 7 jours">${days.map((d, i) =>
        `<div title="${d.n} révision${d.n > 1 ? 's' : ''}"><span class="trs-bar-n">${d.n || ''}</span><i class="${i ? '' : 'today'}" style="height:${Math.round(100 * d.n / max)}%"></i><span>${dayName(d.t, i)}</span></div>`).join('')}</div>`;
    const mastery = sides.map(c => {
        const sm = sums[c], seg = ['mastered', 'fragile', 'weak'].filter(l => sm.lv[l]).map(l => `<i class="tr-bar-seg ${l}" style="flex:${sm.lv[l]}"></i>`).join('');
        return `<div class="trs-mastery"><span>${c === 'w' ? 'Blancs' : 'Noirs'}</span><span class="tr-bar">${seg}</span><b>${sm.mastery} %</b></div>`;
    }).join('');
    const plan = `
        <section class="trs-plan">
            <span class="trs-eyebrow">Prochains jours</span>
            ${forecast}
            ${mastery}
            <div class="trs-foot">${ico('target')} ${streak} jour${streak > 1 ? 's' : ''} d'affilée · ${today} essai${today > 1 ? 's' : ''} aujourd'hui</div>
        </section>`;

    panel.innerHTML = hero + plan + settings;
}

registerActions({
    trainingOption: arg => { const [name, value] = arg.split('='); setTrainingOption(name, value); },
    trainingOpt: name => { _trOpenOpt = _trOpenOpt === name ? null : name; initTraining(); },
    trainingColor: c => { _trColor = c; initTraining(); },
    startTraining: c => startTraining(c)
});

// ─── BOUCLE D'ENTRAÎNEMENT ────────────────────────────────────────────────────

// Univers de révision : positions du répertoire respectant la profondeur maximale choisie.
function _trainingPool() {
    return Object.keys(openingDB).filter(k => _isEligible(openingDB[k]));
}

// Couleur tirée à pile ou face pour l'exercice suivant (mode mélangé) ; null si aucune position.
function _pickTrainingColor() {
    const colors = ['w', 'b'].filter(c => Object.values(readDBFor(currentRepertoire, c)).some(_isEligible));
    return colors.length ? colors[Math.floor(Math.random() * colors.length)] : null;
}

// Changement de couleur depuis le badge de la barre du haut (quitte le mode mélangé).
function switchTrainingColor(color) {
    if (!Object.values(readDBFor(currentRepertoire, color)).some(_isEligible)) {
        setStatus(`Aucune position ${color === 'w' ? 'Blancs' : 'Noirs'} à réviser dans ce répertoire.`, 'info');
        return;
    }
    startTraining(color);
}

// color : 'w' | 'b' | 'mix' (Blancs et Noirs mélangés).
function startTraining(color) {
    trainingState.mixed = color === 'mix';
    if (trainingState.mixed) color = _pickTrainingColor();
    if (!color) { trainingState.mixed = false; initTraining(); return; }
    playerColor = color;
    gameMode    = 'training';
    loadDB();
    if (!_trainingPool().length) { gameMode = 'play'; initTraining(); return; }
    trainingState.ok = 0;
    trainingState.lastKey = null;
    showGameScreen(color);
    nextDrill();
}

// ─── POIDS DE TIRAGE (répétition espacée, sélection probabiliste continue) ──
//   poids = ( facteur d'échec × facteur d'oubli ) ^ TRAIN_SHARPNESS
//
//   facteur d'échec = PLANCHER_ÉCHEC + erreur relative × volume
//     erreur relative = (échecs + 0,6) / (essais + 2)  → lissée : 3/3 pèse plus que 1/1,
//                                                         100 % de réussite sur beaucoup d'essais → proche de 0
//     volume          = 1 + 0,25 × ln(1 + échecs)        → davantage d'échecs = davantage de poids
//   facteur d'oubli = PLANCHER_ÂGE + (1 − e^(−jours / 3))
//     ≈ 0 juste après un passage, ≈ 0,63 à 3 jours, ≈ 0,9 à 7 jours ; sans lastReviewed : 30 jours.
//   Les deux planchers garantissent un poids toujours strictement positif.

const TRAIN_FAIL_FLOOR  = 0.04;
const TRAIN_AGE_FLOOR   = 0.03;
const TRAIN_TAU_DAYS    = 3;
const TRAIN_UNSEEN_DAYS = 30;
const TRAIN_SHARPNESS   = 1.5;      // > 1 : accentue l'écart entre positions prioritaires et acquises
const TRAIN_NOT_DUE     = 0.25;     // facteur appliqué aux positions dont la révision n'est pas encore due

function _ageDays(e, now) {
    return e.lastReviewed ? Math.max(0, (now - e.lastReviewed) / DAY_MS) : TRAIN_UNSEEN_DAYS;
}

function _failureFactor(e) {
    const err    = (e.failures + 0.6) / (e.attempts + 2);
    const volume = 1 + 0.25 * Math.log(1 + e.failures);
    return TRAIN_FAIL_FLOOR + err * volume;
}

function _forgetFactor(e, now) {
    return TRAIN_AGE_FLOOR + (1 - Math.exp(-_ageDays(e, now) / TRAIN_TAU_DAYS));
}

function _trainingWeight(e, now) {
    return Math.pow(_failureFactor(e) * _forgetFactor(e, now), TRAIN_SHARPNESS) * (isDue(e, now) ? 1 : TRAIN_NOT_DUE);
}

// Probabilités de sortie : poids normalisés sur l'univers. Si le répertoire compte plusieurs
// positions, celle qui vient de sortir est exclue AVANT normalisation (jamais deux fois de suite).
function _trainingDistribution(excludeKey) {
    const now   = Date.now();
    let items   = _trainingPool().map(k => ({ key: k, w: _trainingWeight(openingDB[k], now) }));
    if (items.length > 1) items = items.filter(x => x.key !== excludeKey);
    const total = items.reduce((sum, x) => sum + x.w, 0);
    items.forEach(x => { x.p = x.w / total; });
    return items;
}

function _pickDrill() {
    const dist = _trainingDistribution(trainingState.lastKey);
    let r = Math.random();
    for (const x of dist) { r -= x.p; if (r <= 0) return x.key; }
    return dist[dist.length - 1].key;
}

// Raison affichée au début de l'exercice.
function _ageLabel(e, now) {
    if (!e.lastReviewed) return 'non revu depuis longtemps';
    const min = (now - e.lastReviewed) / 60000;
    if (min < 60)   return `revu il y a ${Math.max(1, Math.round(min))} min`;
    if (min < 1440) return `revu il y a ${Math.round(min / 60)} h`;
    const d = Math.floor(min / 1440);
    if (d < 14)     return `non revu depuis ${d} jour${d > 1 ? 's' : ''}`;
    const w = Math.floor(d / 7);
    return `non revu depuis ${w} semaine${w > 1 ? 's' : ''}`;
}

function _drillReason(e) {
    const now = Date.now();
    if (e.failures === 0 || !e.attempts) return `Entretien · 100% de réussite · ${_ageLabel(e, now)}`;
    const pct = Math.round(100 * e.failures / e.attempts);
    if (pct >= 50)                return `Position critique · ${pct}% d'erreur`;
    if (_ageDays(e, now) >= 2)    return `À réviser · ${_ageLabel(e, now)}`;
    return `À consolider · ${pct}% d'erreur · ${_ageLabel(e, now)}`;
}

// Retrouve la ligne menant à une clé de position en rejouant les chemins des autres entrées
// (la position d'une entrée sans `path` est un ancêtre des entrées plus profondes).
// Renvoie un tableau UCI (peut être vide = position initiale) ou null si introuvable.
function _findPathToKey(key) {
    return _withEngineSnapshot(() => {
        parseFEN(INIT_FEN);
        if (positionKey() === key) return [];
        for (const k of Object.keys(openingDB)) {
            const p = openingDB[k].path;
            if (!p || !p.length) continue;
            parseFEN(INIT_FEN);
            try {
                for (let i = 0; i < p.length; i++) {
                    _applyUciRaw(p[i]);
                    if (positionKey() === key) return p.slice(0, i + 1);
                }
            } catch (_) { /* chemin corrompu : on passe au suivant */ }
        }
        return null;
    });
}

function nextDrill() {
    stopTraining();
    if (trainingState.mixed) {
        const c = _pickTrainingColor();
        if (c && c !== playerColor) { playerColor = c; loadDB(); showGameScreen(c); }
    }
    if (!_trainingPool().length) { setStatus('Aucune position dans ce répertoire.', 'info'); return; }
    if (trainingSettings.fromStart === 1 && _startFullLine()) return;     // sinon : repli sur une position ciblée

    const key   = _pickDrill();
    const entry = openingDB[key];
    trainingState.current     = key;
    trainingState.reason      = _drillReason(entry);
    trainingState.lastKey     = key;
    trainingState.busy        = true;
    trainingState.solutionFor = null;
    trainingState.seq         = { len: trainingSettings.seqLen, done: 0, assisted: false };

    // Chemin absent ou vide : reconstitution via les autres entrées, puis auto-réparation de l'entrée.
    let fullPath = (entry.path && entry.path.length) ? entry.path : null;
    if (!fullPath) {
        const pre = _findPathToKey(key);
        if (pre) {
            fullPath = pre.concat(entry.move);
            entry.path = fullPath;
            entry.ply  = fullPath.length;
            saveDB();
        }
    }

    if (fullPath) {
        const n     = fullPath.length - 1;               // coups avant ma réponse
        const start = Math.max(0, n - TRAIN_CONTEXT_PLIES);
        const ctx   = fullPath.slice(start, n);
        loadPositionFromPath(fullPath.slice(0, start));
        setStatus('Mise en situation…', 'info', trainingState.reason);
        ctx.forEach((u, i) => _later(() => {
            const m = _parseUci(u);
            playMoveSound(m.from, m.to);
            animateNextMove(m.from, m.to);
            applyMove(m.from, m.to, m.promo);            // applyMove appelle renderMoves()
            renderBoard();
        }, TRAIN_STEP_MS * (i + 1)));
        _later(_drillReady, TRAIN_STEP_MS * ctx.length + 300);
    } else {
        // Dernier recours : aucune ligne connue → position posée directement (historique vide inévitable).
        loadPositionFromPath([]);
        parseFEN(key);
        renderMoves();
        renderBoard();
        _drillReady();
    }
}

function _seqLabel() {
    const s = trainingState.seq;
    if (s.len <= 1) return '';
    return ` · coup ${s.done + 1}${s.len < TRAIN_SEQ_END ? '/' + s.len : ''}`;
}

function _drillReady() {
    const key = trainingState.current;
    if (positionKey() !== key) {
        const entry = openingDB[key];
        if (entry && entry.path && entry.path.length) {
            // Resynchronisation complète ET historique reconstruit (jamais vidé).
            loadPositionFromPath(entry.path.slice(0, -1));
        }
        if (positionKey() !== key) {
            // Sans toucher à moveHistory : on ne force que l'état du moteur.
            const prevHistory = moveHistory;
            parseFEN(key);
            moveHistory = prevHistory;
            selected = null; legalMoves = []; hintPiece = null; awaitingPromotion = null;
        }
        renderMoves();
        renderBoard();
    }
    trainingState.busy = false;
    setStatus(`À vous de jouer${_seqLabel()}`, 'info',
              trainingState.reason + (trainingState.ok ? ` · ${trainingState.ok} réussi${trainingState.ok > 1 ? 's' : ''}` : ''));
}

// ─── LIGNE COMPLÈTE (depuis la position initiale) ─────────────────────────────
// Blancs : la main est rendue tout de suite. Noirs : l'ordinateur joue d'abord un coup du répertoire.
// Puis la séquence continue jusqu'à la fin de la variante (cf. _continueSequence).
// Renvoie false si aucune ligne ne part de la position initiale (entrées sans chemin connu).
function _startFullLine() {
    trainingState.reason      = 'Ligne complète';
    trainingState.seq         = { len: TRAIN_SEQ_END, done: 0, assisted: false };
    trainingState.solutionFor = null;
    trainingState.busy        = true;
    loadPositionFromPath([]);
    trainingState.current = trainingState.lastKey = positionKey();
    if (playerColor === 'w') {
        if (!openingDB[trainingState.current] || !_isEligible(openingDB[trainingState.current])) return false;
        _later(_drillReady, 300);
        return true;
    }
    const opp = _pickOppContinuation([]);
    if (!opp) return false;
    setStatus('Ligne complète · l\'adversaire commence…', 'info');
    _playOpponentReply(opp);
    return true;
}

// ─── SÉQUENCE : RÉPONSE ADVERSE ENREGISTRÉE ───────────────────────────────────

// Coups adverses UCI qui prolongent la ligne jouée et mènent à une position de mon répertoire
// (une entrée dont le `path` vaut ligne + coup adverse + mon coup). Tirage pondéré : chaque branche
// pèse autant que la position la plus prioritaire qu'elle contient (cf. _trainingWeight), pour
// guider vers ce qui est à réviser. null = fin de la variante (ou limite de profondeur).
function _pickOppContinuation(line) {
    const n = line.length, valid = new Set(), weight = new Map(), now = Date.now();
    for (const k in openingDB) {
        const e = openingDB[k], p = e.path;
        if (!p || p.length < n + 2 || !_isEligible(e)) continue;
        let match = true;
        for (let i = 0; i < n; i++) if (p[i] !== line[i]) { match = false; break; }
        if (!match) continue;
        if (p.length === n + 2) valid.add(p[n]);
        weight.set(p[n], Math.max(weight.get(p[n]) || 0, _trainingWeight(e, now)));
    }
    const arr = [...valid];
    if (!arr.length) return null;
    let r = Math.random() * arr.reduce((s, u) => s + weight.get(u), 0);
    for (const u of arr) { r -= weight.get(u); if (r <= 0) return u; }
    return arr[arr.length - 1];
}

// Joue le coup adverse puis rend la main, ou termine l'exercice si la position atteinte n'est pas
// au répertoire.
function _playOpponentReply(opp) {
    _later(() => {
        const m   = _parseUci(opp);
        const san = toAlgebraic(m.from, m.to, m.promo);
        playMoveSound(m.from, m.to);
        animateNextMove(m.from, m.to);
        applyMove(m.from, m.to, m.promo);
        selected = null; legalMoves = []; hintPiece = null;
        renderBoard();
        if (openingDB[positionKey()]) {
            trainingState.solutionFor = null;
            trainingState.busy = false;
                    setStatus(`Adversaire : ${san}`, 'info', `À vous de jouer${_seqLabel()}`);
        } else {
            setStatus('Fin de la variante.', 'ok');
            _finishDrill();
        }
    }, TRAIN_STEP_MS);
}

function _finishDrill() {
    if (!trainingState.seq.assisted) trainingState.ok++;
    _later(nextDrill, 1400);
}

function _continueSequence() {
    const s = trainingState.seq;
    if (s.done < s.len) {
        const line = moveHistory.map(m => moveToStr(m.from, m.to, m.promo));
        const opp  = _pickOppContinuation(line);
        if (opp) { _playOpponentReply(opp); return; }
        if (s.len > 1) setStatus('✓ Fin de la variante.', 'ok');
    }
    _finishDrill();
}

// ─── SOLUTION ─────────────────────────────────────────────────────────────────

function showTrainingSolution() {
    if (gameMode !== 'training' || trainingState.busy || turn !== playerColor) return;
    if (navCursor !== -1) _syncEngineToNavCursor();

    const key   = positionKey();
    const entry = openingDB[key];
    if (!entry) { setStatus('Aucune solution connue pour cette position.', 'info'); return; }

    if (trainingState.solutionFor !== key) {
        trainingState.solutionFor   = key;
        trainingState.seq.assisted  = true;
        if (TRAIN_SOLUTION_PENALTY) {
            entry.attempts++;
            entry.failures++;
            recordReview(entry, false);
            saveDB();
        }
    }
    revealSolution(entry);
    setStatus(`Solution : ${entry.san}`, 'hint', 'Jouez-le pour continuer (aucune réussite comptée).');
}

// ─── RÉPONSE DU JOUEUR ────────────────────────────────────────────────────────

// Appelé par executePlayerMove() en mode entraînement (le coup n'est pas encore appliqué).
function answerTrainingMove(entry, from, to, promo, movStr) {
    const key      = positionKey();
    const revealed = trainingState.solutionFor === key;

    if (entry && movStr === entry.move) {
        let msg = '✓ Solution jouée', detail = 'Aucune réussite comptée.';
        if (!revealed) {
            const before = entry.attempts ? Math.round(100 * entry.failures / entry.attempts) : 0;
            entry.attempts++;
            recordReview(entry, true);
            saveDB();
            const after = Math.round(100 * entry.failures / entry.attempts);
            msg    = '✓ Bien joué !';
            detail = entry.failures === 0 ? 'Toujours à 100 % de réussite.' : `Taux d'erreur : ${before} % → ${after} %`;
        }
        trainingState.busy = true;
        _commitMove(from, to, promo, null, msg, revealed ? 'info' : 'ok', detail);
        trainingState.seq.done++;
        _continueSequence();
    } else if (entry && !revealed) {                   // erreur : comptée sur la position exacte, comme en mode « Jouer »
        entry.attempts++;
        entry.failures++;
        recordReview(entry, false);
        saveDB();
        const pct = Math.round(100 * entry.failures / entry.attempts);
        _rejectMove(to, '✗ Pas le bon coup', `Taux d'erreur : ${pct} %. Réessayez, ou appuyez sur Indice.`);
    } else {
        _rejectMove(to, revealed ? "✗ Ce n'est pas le coup de la solution" : '✗ Pas le bon coup', 'Réessayez.');
    }
}
