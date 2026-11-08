// Lancer : node tests/shortcuts.test.js   — raccourcis clavier (core/shortcuts.js) : onglets, thème, sons, touches par mode,
// garde-fous (champ de saisie, modificateur, fenêtre ouverte, séance guidée). Charge index.html entier dans jsdom, comme boot.test.js.
const { bootApp } = require('./_app.js');
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const ROOT = path.join(__dirname, '..');

async function boot() {
    const { dom, errors } = await bootApp();
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s) };
}

(async () => {
    const { w, errors, $ } = await boot();
    const press = (key, opts = {}, target = w.document.body) => {
        const code = opts.code || '';
        target.dispatchEvent(new w.KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...opts }));
    };
    const activeTab = () => w.document.querySelector('.topnav-tab.active').id;
    const seed = () => w.eval(`(() => {
        const line = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'], db = {};
        [0, 2, 4].forEach(i => {
            const pos = Chess.replay(line.slice(0, i)), e = newEntry(line[i], Chess.san(pos, line[i]), line.slice(0, i + 1));
            e.attempts = 4; e.failures = 0; e.lastReviewed = Date.now() - 864e5; e.due = Date.now() - 864e5; e.interval = 3;
            db[Chess.key(pos)] = e;
        });
        dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
        dataStore.set(dbKeyFor(currentRepertoire, 'b'), '{}');
    })()`);

    await t('1 à 4 : onglets, par la position de la touche (AZERTY sans Maj) et le pavé numérique', () => {
        press('é', { code: 'Digit2' });
        assert.strictEqual(activeTab(), 'nav-tab-stats');
        press('4', { code: 'Numpad4' });
        assert.strictEqual(activeTab(), 'nav-tab-endgame');
        press('&', { code: 'Digit1' });
        assert.strictEqual(activeTab(), 'nav-tab-play');
    });

    await t('D : mode clair ou sombre ; M : coupe et remet les sons', () => {
        const before = w.document.documentElement.getAttribute('data-theme');
        press('d');
        assert.notStrictEqual(w.document.documentElement.getAttribute('data-theme'), before);
        press('d');
        const s = w.eval('appSettings.sound');
        press('m');
        assert.strictEqual(w.eval('appSettings.sound'), !s);
        press('m');
        assert.strictEqual(w.eval('appSettings.sound'), s);
    });

    await t('garde-fous : rien dans un champ, avec Ctrl ou Cmd, derrière une fenêtre, ni la touche maintenue', () => {
        const theme = () => w.document.documentElement.getAttribute('data-theme');
        const before = theme(), input = w.document.createElement('input');
        w.document.body.appendChild(input);
        press('d', {}, input);
        input.remove();
        press('d', { ctrlKey: true });
        press('d', { metaKey: true });
        press('d', { repeat: true });
        assert.strictEqual(theme(), before);
        w.showSettings();
        press('d');
        assert.strictEqual(theme(), before, 'fenêtre ouverte');
        press('/');
        assert.strictEqual(w.document.activeElement, $('#settings-overlay [data-pn="search"]'), '/ : la recherche des Paramètres');
        w.closeSettings();
    });

    await t('hors séance : L lance la Révision du jour ; en séance, 1 à 4 n\'agissent pas et Q quitte', () => {
        seed();
        w.eval(`goHome('training')`);
        press('l');
        assert.strictEqual(w.eval('gameMode'), 'training');
        assert(w.eval('!!trainingState.session'), 'séance lancée');
        press('&', { code: 'Digit1' });
        assert(w.eval('!!trainingState.session'), 'séance pas quittée par mégarde');
        press('q');
        assert(!w.eval('trainingState.session'), 'Q quitte');
    });

    await t('E : revoir les erreurs du bilan, seulement s\'il y en a', () => {
        seed();
        w.eval(`goHome('training')`);
        press('e');
        assert(!w.eval('trainingState.session'), 'pas de bilan : rien');
        w.eval(`(() => {
            const db = readDBFor(currentRepertoire, 'w'), keys = Object.keys(db);
            const rows = keys.map((k, i) => ({ key: k, color: 'w', ok: i > 0, lvBefore: 'progress', lvAfter: _level(db[k]), e: db[k] }));
            trainingState.lastSummary = { kind: 'due', label: 'Révision du jour', minutes: 1, total: rows.length, ok: 2, rows, returnTab: 'training' };
        })()`);
        press('e');
        return new Promise(r => setTimeout(r, 80)).then(() => {
            assert.strictEqual(w.eval('trainingState.session && trainingState.session.kind'), 'retry');
            press('q');
        });
    });

    await t('Jouer : V change de camp, N recommence, ↑ ↓ vont au début et à la position actuelle, Z annule le coup enregistré', () => {
        seed();
        w.eval(`startGame('w')`);
        press('v');
        assert.strictEqual(w.eval('playerColor'), 'b');
        press('v');
        assert.strictEqual(w.eval('playerColor'), 'w');
        const play = uci => w.eval(`(() => { const i = s => (Number(s[1]) - 1) * 8 + s.charCodeAt(0) - 97; executePlayerMove(i('${uci.slice(0, 2)}'), i('${uci.slice(2, 4)}')); })()`);
        play('e2e4');
        assert.strictEqual(w.eval('moveHistory.length'), 1);
        press('ArrowUp');
        assert.notStrictEqual(w.eval('navCursor'), -1, '↑ : début de la ligne');
        press('ArrowDown');
        assert.strictEqual(w.eval('navCursor'), -1, '↓ : position actuelle');
        press('n');
        assert.strictEqual(w.eval('moveHistory.length'), 0, 'N : recommencer');
        w.eval(`dataStore.set(dbKeyFor(currentRepertoire, 'w'), '{}'); dataStore.set('chessTrainer_trash', '[]'); startGame('w')`);
        play('d2d4');
        const known = () => Object.keys(w.eval(`readDBFor(currentRepertoire, 'w')`)).length;
        assert.strictEqual(known(), 1, 'coup enregistré');
        press('z');
        assert.strictEqual(known(), 0, 'Z : le reçu est annulé');
        press('z', { shiftKey: true });
        assert.strictEqual(known(), 1, 'Maj+Z : rétabli');
    });

    await t('touches par mode : Entraînement S et P, Analyse A B + − Maj+S Q, Finales N P T Q', () => {
        const calls = [];
        w.__c = n => calls.push(n);
        ['showTrainingSolution', 'nextDrill', 'analysisToggleEngine', 'quitAnalysis', 'retryEndgame', 'nextEndgame'].forEach(f => w.eval(`window.${f} = () => __c('${f}')`));
        w.eval(`showGameScreen('w')`);
        w.eval(`gameMode = 'training'`);
        press('s'); press('p');
        w.eval(`gameMode = 'analysis'`);
        const lines = w.eval('appSettings.engineLines');
        const panel = $('#analysis-panel');
        panel.innerHTML = '<button data-action="analysisPlayLine" id="pl"></button><button data-action="analysisOpenMerge" id="mg" disabled></button>';
        $('#pl').onclick = () => calls.push('best');
        $('#mg').onclick = () => calls.push('merge');
        press('a'); press('b');
        press('s', { shiftKey: true });
        assert(!calls.includes('merge'), 'bouton désactivé : rien à ajouter');
        press('s');
        press('q');
        w.eval(`window.analysisSettingsChanged = () => {}`);
        const dir = lines < 5 ? '+' : '-';
        press(dir);
        assert.strictEqual(w.eval('appSettings.engineLines'), lines + (dir === '+' ? 1 : -1));
        press(dir === '+' ? '-' : '+');
        w.eval(`gameMode = 'endgame'`);
        press('n'); press('p');
        assert.deepStrictEqual(calls, ['showTrainingSolution', 'nextDrill', 'analysisToggleEngine', 'best', 'quitAnalysis', 'retryEndgame', 'nextEndgame']);
        w.eval(`gameMode = 'play'; goHome('play')`);
    });

    await t('liste affichée : chaque nouvelle touche est décrite aux Paramètres et dans l\'Aide', () => {
        const all = JSON.stringify(w.eval('KEYBOARD_SHORTCUTS'));
        ['"D"', '"M"', '"↑"', '"↓"', '"C"', '"X"', '"Z"', '"N"', '"V"', '"L"', '"E"', '"S"', '"P"', '"Q"', '"A"', '"B"', '"T"', '"/"', '1 · 2'].forEach(k => assert(all.includes(k), k));
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
