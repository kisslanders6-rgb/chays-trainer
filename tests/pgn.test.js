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

// Ligne lue → texte compact : « e4 e5 Nf3 [Nc3 Nc6]* » (* = variante implicite).
const shape = line => line.map(m => m.san + m.vars.map(v => ` [${shape(v)}]${v.implicit ? '*' : ''}`).join('')).join(' ');
const parse = text => shape(run('(t => _pgnParseLine(_pgnTokenize(t), { i: 0 }, true))')(text));

t('variante implicite : une réponse écrite après le coup adverse, sans parenthèses', () => {
    assert.strictEqual(parse('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 3... f5 4. Nc3 *'), 'e4 e5 Nf3 Nc6 Bb5 a6 [f5 Nc3]*');
    reset();
    const r = run('importPgnText')('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 3... f5 4. Nc3 *');
    assert.strictEqual(r.errors.length, 0, JSON.stringify(r.errors));
    assert.strictEqual(r.conflicts.length, 0);
    assert.strictEqual(r.implicit.length, 1);
    assert.strictEqual(r.implicit[0].san, 'f5');
    assert(run('Object.values(openingDB).some(e => e.san === "Nc3")'), 'réponse 4.Nc3 non importée');
});

t('variante implicite : alternative à un coup blanc, puis retour plus haut', () => {
    assert.strictEqual(parse('1. e4 c5 2. Nf3 2. Nc3 Nc6'), 'e4 c5 Nf3 [Nc3 Nc6]*');
    assert.strictEqual(parse('1. e4 e5 2. Nf3 Nc6 2... d6 3. d4 1... c5 2. Nf3'), 'e4 e5 [c5 Nf3]* Nf3 Nc6 [d6 d4]*');
});

t('numérotation standard : variantes entre parenthèses inchangées, numéro en avance ignoré', () => {
    assert.strictEqual(parse('1. d4 d5 2. Nf3 Nf6 3. Nbd2 (3. e3) 3... e6 (3... c5 4. e3) 4. e3'), 'd4 d5 Nf3 Nf6 Nbd2 [e3] e6 [c5 e3] e3');
    assert.strictEqual(parse('1. e4 e5 5. Nf3'), 'e4 e5 Nf3');
    assert.strictEqual(parse('1. e4 (1. d4 d5 1... Nf6 2. c4) 1... e5'), 'e4 [d4 d5 [Nf6 c4]*] e5');
});

console.log(`\n${n} tests réussis.`);
