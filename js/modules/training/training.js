/**
 * modules/training/training.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Entraînement : drill ciblé en boucle sur les positions du répertoire
 * actif ayant le plus fort taux d'échec (failures / attempts).
 *
 * Pour chaque position : l'échiquier se place 2 demi-coups avant, rejoue
 * automatiquement ces deux coups (contexte), puis me rend la main.
 *   - sélection : score de priorité (taux d'erreur lissé × fraîcheur, cf. _priorityScore)
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
        const n     = Object.values(db).filter(e => e.failures > 0).length;
        const sub   = !total ? 'Répertoire vide'
                    : n      ? `${n} position${n > 1 ? 's' : ''} à retravailler · ${total} au total`
                             : `Tout est maîtrisé · révision libre (${total})`;
        return `<div class="train-card ${total ? '' : 'disabled'}" ${total ? `onclick="startTraining('${c}')"` : ''}>
            <div class="train-card-icon">${c === 'w' ? '♔' : '♚'}</div>
            <div class="train-card-title">${c === 'w' ? 'BLANCS' : 'NOIRS'}</div>
            <div class="train-card-sub">${sub}</div></div>`;
    }).join('') + '</div>';
}

// ─── BOUCLE D'ENTRAÎNEMENT ────────────────────────────────────────────────────

// Toutes les positions du répertoire sont éligibles ; celles sans erreur ont un score
// très réduit (TRAIN_MASTERED_FACTOR) et n'apparaissent donc que rarement.
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

// ─── SCORE DE PRIORITÉ (répétition espacée) ──────────────────────────────────
//   score = (0,15 + erreur lissée) × (0,05 + fraîcheur)
//   - erreur lissée : (échecs + 0,6) / (essais + 2). Le lissage donne plus de poids
//     à 3 échecs sur 3 (≈ 0,72) qu'à 1 échec sur 1 (≈ 0,53).
//   - positions sans aucune erreur : score × 0,15 (révision occasionnelle).
//   - fraîcheur     : 1 − e^(−jours / 3). ≈ 0 juste après un passage, ≈ 0,63 à 3 jours,
//     ≈ 0,9 à 7 jours. Sans lastReviewed (ancienne entrée) : traité comme 30 jours.

const TRAIN_TAU_DAYS    = 3;
const TRAIN_UNSEEN_DAYS = 30;
const TRAIN_MASTERED_FACTOR = 0.15;   // positions à 0 erreur : score × 0,15 → poids ÷ ~45 (tirage au carré)
const DAY_MS            = 86400000;

function _ageDays(e, now) {
    return e.lastReviewed ? Math.max(0, (now - e.lastReviewed) / DAY_MS) : TRAIN_UNSEEN_DAYS;
}

function _priorityScore(e, now) {
    const err   = (e.failures + 0.6) / (e.attempts + 2);
    const fresh = 1 - Math.exp(-_ageDays(e, now) / TRAIN_TAU_DAYS);
    const score = (0.15 + err) * (0.05 + fresh);
    return e.failures === 0 ? score * TRAIN_MASTERED_FACTOR : score;
}

// Choix pondéré par score² : les positions prioritaires reviennent souvent,
// les autres restent possibles. Jamais deux fois de suite la même s'il y a le choix.
function _pickDrill() {
    const now  = Date.now();
    let pool   = _trainingPool().map(k => ({ k, w: Math.pow(_priorityScore(openingDB[k], now), 2) }));
    if (pool.length > 1) pool = pool.filter(x => x.k !== trainingState.lastKey);
    let r = Math.random() * pool.reduce((s, x) => s + x.w, 0);
    for (const x of pool) { r -= x.w; if (r <= 0) return x.k; }
    return pool[pool.length - 1].k;
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
    const now  = Date.now();
    if (e.failures === 0)             return `Révision · 100% de réussite · ${_ageLabel(e, now)}`;
    const pct  = Math.round(100 * e.failures / e.attempts);
    if (pct >= 50)                    return `Position critique · ${pct}% d'erreur`;
    if (_ageDays(e, now) >= 2)        return `À réviser · ${_ageLabel(e, now)}`;
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
