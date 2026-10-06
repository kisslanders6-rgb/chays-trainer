/**
 * modules/training/training.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Entraînement : drill ciblé en boucle sur les positions du répertoire
 * actif ayant le plus fort taux d'échec (failures / attempts).
 *
 * Pour chaque position : l'échiquier se place 2 demi-coups avant, rejoue
 * automatiquement ces deux coups (contexte), puis me rend la main.
 *   - succès : attempts + 1 (failures inchangé → le taux d'erreur baisse)
 *   - erreur : coup refusé, on réessaie ; l'entraînement ne modifie pas les
 *     compteurs (les stats reflètent les erreurs du menu « Jouer »).
 */

'use strict';

const TRAIN_STEP_MS = 750;

const trainingState = { busy: false, timers: [], lastKey: null, current: null, ok: 0 };

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
        const n     = Object.values(db).filter(e => e.failures > 0 && e.attempts > 0).length;
        const sub   = n ? `${n} position${n > 1 ? 's' : ''} à retravailler`
                        : (total ? 'Aucune erreur enregistrée' : 'Répertoire vide');
        return `<div class="train-card ${n ? '' : 'disabled'}" ${n ? `onclick="startTraining('${c}')"` : ''}>
            <div class="train-card-icon">${c === 'w' ? '♔' : '♚'}</div>
            <div class="train-card-title">${c === 'w' ? 'BLANCS' : 'NOIRS'}</div>
            <div class="train-card-sub">${sub}</div></div>`;
    }).join('') + '</div>';
}

// ─── BOUCLE D'ENTRAÎNEMENT ────────────────────────────────────────────────────

function _trainingPool() {
    return Object.keys(openingDB).filter(k => openingDB[k].failures > 0 && openingDB[k].attempts > 0);
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

function _pickDrill() {
    const pool = _trainingPool().map(k => ({
        k, r: openingDB[k].failures / openingDB[k].attempts, f: openingDB[k].failures, rnd: Math.random()
    })).sort((a, b) => b.r - a.r || b.f - a.f || a.rnd - b.rnd);
    // Évite de reposer deux fois de suite la même position quand il y a le choix.
    return (pool.length > 1 && pool[0].k === trainingState.lastKey) ? pool[1].k : pool[0].k;
}

function nextDrill() {
    stopTraining();
    if (!_trainingPool().length) { setStatus('Aucune position à retravailler.', 'info'); return; }

    const key   = _pickDrill();
    const entry = openingDB[key];
    trainingState.current = key;
    trainingState.lastKey = key;
    trainingState.busy    = true;

    if (entry.path && entry.path.length) {
        const n     = entry.path.length - 1;            // coups avant ma réponse
        const start = Math.max(0, n - 2);
        const ctx   = entry.path.slice(start, n);
        loadPositionFromPath(entry.path.slice(0, start));
        setStatus('Mise en situation…', 'info');
        ctx.forEach((u, i) => _later(() => {
            const m = _parseUci(u);
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
    setStatus(`Entraînement · à vous de jouer${trainingState.ok ? ` (${trainingState.ok} réussi${trainingState.ok > 1 ? 's' : ''})` : ''}`, 'info');
}

// Appelé par executePlayerMove() en mode entraînement.
function answerTrainingMove(entry, from, to, promo, movStr) {
    if (entry && movStr === entry.move) {
        const before = Math.round(100 * entry.failures / entry.attempts);
        entry.attempts++;
        saveDB();
        const after = Math.round(100 * entry.failures / entry.attempts);
        trainingState.busy = true;
        trainingState.ok++;
        _commitMove(from, to, promo, null, `✓ Bien joué ! Taux d'erreur : ${before}% → ${after}%`, 'ok');
        _later(nextDrill, 1400);
    } else {
        _rejectMove(to, "✗ Ce n'est pas le bon coup — réessayez.");
    }
}
