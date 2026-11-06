/**
 * core/shortcuts.js
 * ──────────────────────────────────────────────────────────────────────────
 * Raccourcis clavier (point 16), non modifiables : la liste affichée est KEYBOARD_SHORTCUTS (settingsUI.js).
 * Ici : les touches globales et celles de chaque mode ; ← → Espace F R restent dans openingsUI.js,
 * « , » et « ? » dans helpUI.js.
 *
 * Inactifs dans un champ de saisie, avec Ctrl / Cmd / Alt, derrière une fenêtre ouverte ou la liste des répertoires.
 * Les touches 1 à 4 se lisent sur la position de la touche (e.code) : en AZERTY, le chiffre demande Maj.
 * Hors de question de quitter une séance guidée par mégarde : 1 à 4 n'y agissent pas (Q la quitte).
 * Quand une action a un bouton qui sait s'il est disponible, on clique ce bouton plutôt que de refaire ses conditions.
 */

'use strict';

const Shortcuts = (function () {
    const gameVisible = () => {
        const gs = document.getElementById('game-screen');
        return !!gs && gs.style.display !== 'none' && !gs.classList.contains('hidden');
    };
    const clickIf = sel => {
        const b = document.querySelector(sel);
        if (!b || b.disabled) return false;
        b.click();
        return true;
    };
    const say = text => { if (typeof AccountUI !== 'undefined' && AccountUI.notify) AccountUI.notify(text); };
    const statusAct = label => {
        const b = document.querySelector('#status-bar .status-act');
        return b && b.textContent.trim() === label ? b : null;
    };

    // Annuler le coup qu'on vient d'enregistrer (reçu) ; sinon « Corriger », avec sa confirmation.
    function undo() {
        const b = statusAct('Annuler');
        if (b) b.click(); else undoMove();
    }

    function engineLines(delta) {
        const v = appSettings.engineLines + delta;
        if (v >= 1 && v <= 5) setPref('engineLines', v);
    }

    // ─── PAR MODE ─────────────────────────────────────────────────────────────
    const MODES = {
        play: {
            z: e => { if (e.shiftKey) { const b = statusAct('Rétablir'); if (b) b.click(); } else undo(); },
            n: () => resetGame(),
            v: () => startGame(playerColor === 'w' ? 'b' : 'w')
        },
        training: {
            s: () => showTrainingSolution(),
            p: () => nextDrill(),
            q: () => quitTraining()
        },
        analysis: {
            a: () => analysisToggleEngine(),
            b: () => clickIf('#analysis-panel [data-action="analysisPlayLine"]'),
            s: e => { if (e.shiftKey) clickIf('#analysis-panel [data-action="analysisOpenMerge"]'); },
            q: () => quitAnalysis(),
            '+': () => engineLines(1), '=': () => engineLines(1), '-': () => engineLines(-1)
        },
        endgame: {
            n: () => retryEndgame(),
            p: () => nextEndgame(),
            t: () => clickIf('#endgame-card [data-action="egTheory"]'),
            q: () => goHome('endgame')
        }
    };

    function inGame(e, k) {
        // ↑ début de la ligne, ↓ position actuelle : comme ← →, sauf en Finales et pendant un coup de séance.
        if (k === 'arrowup' || k === 'arrowdown') {
            if (gameMode === 'endgame' || (gameMode === 'training' && trainingState.busy)) return false;
            if (!moveHistory.length) return false;
            navGo(k === 'arrowup' ? -1 : moveHistory.length - 1);
            return true;
        }
        if (e.repeat) return false;
        if (k === 'enter' && gameMode === 'training' && trainingState.ctxSkip) {
            if (e.target && e.target.tagName === 'BUTTON') return false;
            trainingState.ctxSkip();
            return true;
        }
        if (k === 'c') { copyGamePgn(document.querySelector('.moves-export')); return true; }
        if (k === 'x') { clearAnnotations(); return true; }
        const fn = (MODES[gameMode] || {})[k];
        if (!fn) return false;
        fn(e);
        return true;
    }

    function atHome(e, k) {
        if (e.repeat) return false;
        if (k === 'l') {
            if (!reviewPlan(currentRepertoire).forecast(null, 1)[0]) return false;
            startDailyReview();
            return true;
        }
        if (k === 'e') {
            const s = trainingState.lastSummary;
            if (!s || s.kind === 'timed' || !s.rows.some(r => !r.ok)) return false;
            UI_ACTIONS.trainingRetry(null, null);
            return true;
        }
        return false;
    }

    function global(e, k) {
        if (e.repeat) return false;
        const tab = { Digit1: 'play', Digit2: 'stats', Digit3: 'training', Digit4: 'endgame',
                      Numpad1: 'play', Numpad2: 'stats', Numpad3: 'training', Numpad4: 'endgame' }[e.code];
        if (tab) {
            if (typeof trainingState !== 'undefined' && trainingState.session) return false;
            switchHomeTab(tab);
            return true;
        }
        if (k === 'd') { toggleTheme(); return true; }
        if (k === 'm') {
            setPref('sound', !appSettings.sound);
            say(appSettings.sound ? 'Sons activés' : 'Sons coupés');
            return true;
        }
        return false;
    }

    function handle(e) {
        if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
        const t = e.target;
        if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        // « / » : la recherche de la fenêtre ouverte (l'Aide a la sienne dans helpUI.js).
        if (e.key === '/') {
            const input = document.querySelector('.overlay:not(.hidden) [data-pn="search"]');
            if (input) { e.preventDefault(); input.focus(); }
            return;
        }
        if (document.querySelector('.overlay:not(.hidden), .rp-layer')) return;
        const k = String(e.key).toLowerCase();
        const done = global(e, k) || (gameVisible() ? inGame(e, k) : atHome(e, k));
        if (done) e.preventDefault();
    }

    document.addEventListener('keydown', handle);
    return { handle };
})();
