// Lancer : node tests/pgn.test.js   — import et export PGN du répertoire (pgn.js), aller-retour compris, sans DOM
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const store = {};
const ctx = {
    console, renderMoves() {}, renderBoard() {}, clearErrorFx() {}, resetNavCursor() {}, registerActions() {},
    dataStore: { getJSON: (k, d) => (k in store ? JSON.parse(store[k]) : d), setJSON: (k, v) => { store[k] = JSON.stringify(v); return true; },
                 get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = String(v); return true; }, remove: k => { delete store[k]; return true; } }
};
vm.createContext(ctx);
for (const f of ['js/core/chessEngine.js', 'js/storage.js', 'js/modules/openings/openingsLogic.js', 'js/modules/openings/pgn.js'])
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
const run = code => vm.runInContext(code, ctx);
run("var playerColor = 'w';");

const reset = () => { Object.keys(store).forEach(k => delete store[k]); run('openingDB = {}; oppSeen = {};'); };
const entries = () => run('JSON.stringify(Object.keys(openingDB).sort().map(k => k + " → " + openingDB[k].move))');

const PGN = `[Event "Essai"]
[Result "*"]

1. d4 d5 2. Nf3 Nf6 3. Nbd2 e6 (3... c5 4. e3) 4. e3 *

[Event "Essai 2"]
[Result "*"]

1. d4 f6 2. e4 g5 (2... Kf7 3. Nf3) 3. Qh5# 1-0

1. d4 d6 2. Nf3 Kd7 3. Ne5+ *`;

t('import : coups ambigus et échecs lus, variantes comprises', () => {
    reset();
    const r = run('importPgnText')(PGN);
    assert.strictEqual(r.errors.length, 0, JSON.stringify(r.errors));
    assert.strictEqual(r.added, 10);
    const sans = run('Object.values(openingDB).map(e => e.san).sort()');
    ['Nbd2', 'Ne5+', 'Qh5#'].forEach(s => assert(sans.includes(s), s + ' absent de ' + sans.join(' ')));
});

t('export : SAN standard (désambiguïsation, + et #)', () => {
    const { pgn, games } = run('repertoirePgn')('Général');
    assert.strictEqual(games, 1);
    ['Nbd2', 'Ne5+', 'Qh5#'].forEach(s => assert(new RegExp(`\\b${s.replace(/[+#]/, '\\$&')}(\\s|\\)|$)`).test(pgn), s + ' absent de :\n' + pgn));
    assert(!/\bNd2\b/.test(pgn), 'Nd2 ambigu exporté');
});

t('aller-retour : exporter puis réimporter redonne exactement le même répertoire', () => {
    const { pgn } = run('repertoirePgn')('Général');
    const before = entries();
    reset();
    const r = run('importPgnText')(pgn);
    assert.strictEqual(r.errors.length, 0, JSON.stringify(r.errors));
    assert.strictEqual(entries(), before);
});

t('import : un SAN ambigu (Nd2 avec deux cavaliers) est refusé, pas deviné', () => {
    reset();
    const r = run('importPgnText')('1. d4 d5 2. Nf3 Nf6 3. Nd2 *');
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.errors[0].san, 'Nd2');
});

console.log(`\n${n} tests réussis.`);
