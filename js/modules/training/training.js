/**
 * modules/training/training.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Entraînement : révision de TOUT le répertoire actif, par tirage aléatoire pondéré.
 * Chaque position reçoit un poids (cf. _trainingWeight) ; sa probabilité de sortie est
 * poids / somme des poids de l'univers. Les positions fragiles ou oubliées sortent souvent,
 * les positions maîtrisées ou vues récemment rarement — mais jamais avec une probabilité nulle.
 *
 * Pour chaque position : l'échiquier se place 2 demi-coups avant, rejoue
 * automatiquement ces deux coups (contexte), puis me rend la main.
 *   - succès : attempts + 1 et lastReviewed mis à jour (failures inchangé → le taux d'erreur baisse)
 *   - erreur : coup refusé, on réessaie ; l'entraînement ne modifie pas les
 *     compteurs (les stats reflètent les erreurs du menu « Jouer »).
 */

'use strict';

const TRAIN_STEP_MS = 750;

const trainingState = { busy: false, timers: [], lastKey: null, current: null, ok: 0, reason: '' };

function _later(fn, ms) { trainingState.timers.push(setTimeout(fn, ms)); }

function stopTraining() {
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    trainingState.busy   = false;
}

// ─── ÉCRAN D'ACCUEIL DU MODULE ────────────────────────────────────────────────

function initTraining() {
    const panel = document.getElementById('training-panel');
    if (!panel) return;
    panel.innerHTML = '<div class="train-cards">' + ['w', 'b'].map(c => {
        const db    = readDBFor(currentRepertoire, c);
        const total = Object.keys(db).length;
        const weak  = Object.values(db).filter(e => e.failures > 0).length;
        const sub   = !total ? 'Répertoire vide'
                    : `${total} position${total > 1 ? 's' : ''} · ${weak ? `${weak} avec erreur${weak > 1 ? 's' : ''}` : 'aucune erreur'}`;
        return `<div class="train-card ${total ? '' : 'disabled'}" ${total ? `onclick="startTraining('${c}')"` : ''}>
            <div class="train-card-icon">${pieceGlyph(c === 'w' ? 'K' : 'k')}</div>
            <div class="train-card-title">${c === 'w' ? 'BLANCS' : 'NOIRS'}</div>
            <div class="train-card-sub">${sub}</div></div>`;
    }).join('') + '</div>';
}

// ─── BOUCLE D'ENTRAÎNEMENT ────────────────────────────────────────────────────

// Univers de révision : toutes les positions du répertoire, avec ou sans erreur.
function _trainingPool() {
    return Object.keys(openingDB);
}

function startTraining(color) {
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
const DAY_MS            = 86400000;

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
    return Math.pow(_failureFactor(e) * _forgetFactor(e, now), TRAIN_SHARPNESS);
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

function nextDrill() {
    stopTraining();
    if (!_trainingPool().length) { setStatus('Aucune position dans ce répertoire.', 'info'); return; }

    const key   = _pickDrill();
    const entry = openingDB[key];
    trainingState.current = key;
    trainingState.reason  = _drillReason(entry);
    trainingState.lastKey = key;
    trainingState.busy    = true;

    if (entry.path && entry.path.length) {
        const n     = entry.path.length - 1;            // coups avant ma réponse
        const start = Math.max(0, n - 2);
        const ctx   = entry.path.slice(start, n);
        loadPositionFromPath(entry.path.slice(0, start));
        setStatus(`Mise en situation… · ${trainingState.reason}`, 'info');
        ctx.forEach((u, i) => _later(() => {
            const m = _parseUci(u);
            playMoveSound(m.from, m.to);
            animateNextMove(m.from, m.to);
            applyMove(m.from, m.to, m.promo);
            renderBoard();
        }, TRAIN_STEP_MS * (i + 1)));
        _later(_drillReady, TRAIN_STEP_MS * ctx.length + 300);
    } else {
        loadPositionFromPath([]);
        parseFEN(key);
        renderBoard();
        _drillReady();
    }
}

function _drillReady() {
    const key = trainingState.current;
    if (positionKey() !== key) {                         // sécurité : position exacte de la clé
        loadPositionFromPath([]);
        parseFEN(key);
        renderBoard();
    }
    trainingState.busy = false;
    setStatus(`À vous de jouer · ${trainingState.reason}${trainingState.ok ? ` (${trainingState.ok} réussi${trainingState.ok > 1 ? 's' : ''})` : ''}`, 'info');
}

// Appelé par executePlayerMove() en mode entraînement.
function answerTrainingMove(entry, from, to, promo, movStr) {
    if (entry && movStr === entry.move) {
        const before = entry.attempts ? Math.round(100 * entry.failures / entry.attempts) : 0;
        entry.attempts++;
        entry.lastReviewed = Date.now();
        saveDB();
        const after = Math.round(100 * entry.failures / entry.attempts);
        const msg   = entry.failures === 0 ? '✓ Bien joué ! Toujours à 100% de réussite'
                                            : `✓ Bien joué ! Taux d'erreur : ${before}% → ${after}%`;
        trainingState.busy = true;
        trainingState.ok++;
        _commitMove(from, to, promo, null, msg, 'ok');
        _later(nextDrill, 1400);
    } else {
        _rejectMove(to, "✗ Ce n'est pas le bon coup — réessayez.");
    }
}
