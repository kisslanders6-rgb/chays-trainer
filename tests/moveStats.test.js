// Lancer : node tests/moveStats.test.js   — fréquences des coups adverses (moveStats.js) : une partie n'est
// comptée qu'une fois, quelle que soit la façon dont elle arrive ; sans DOM ni réseau
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const store = {};
const ctx = {
    console, renderMoves() {}, renderBoard() {}, clearErrorFx() {}, resetNavCursor() {}, registerActions() {}, reportError() {},
    dataStore: { getJSON: (k, d) => (k in store ? JSON.parse(store[k]) : d), setJSON: (k, v) => { store[k] = JSON.stringify(v); return true; },
                 get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = String(v); return true; }, remove: k => { delete store[k]; return true; } }
};
vm.createContext(ctx);
for (const f of ['js/core/chessEngine.js', 'js/storage.js', 'js/modules/openings/openingsLogic.js', 'js/modules/openings/pgn.js',
                 'js/modules/openings/gameReview.js', 'js/modules/openings/moveStats.js'])
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
const run = code => vm.runInContext(code, ctx);
run("var playerColor = 'w';");

const game = (link, moves, extra = '') => run('pgnMainLine')(`[White "moi"]\n[Black "lui"]\n[Date "2026.10.01"]\n${link}${extra}\n\n${moves} *`);
const SICI = '1. e4 c5 2. Nf3 d6 3. d4';
const freqAfterE4 = () => {
    const k = run('Chess.key(Chess.play(Chess.start(), "e2e4"))');
    return JSON.parse(store.chessTrainer_gameFreq).w[k];
};

t('une partie récupérée deux fois (Chess.com) n\'est comptée qu\'une fois', () => {
    const g = game('[Link "https://www.chess.com/game/live/111"]', SICI);
    const r1 = run('recordGameFrequencies')([g], () => 'w');
    const r2 = run('recordGameFrequencies')([g, g], () => 'w');
    assert.deepStrictEqual([r1.added, r2.added, r2.already], [1, 0, 2]);
    assert.deepStrictEqual(freqAfterE4(), { c7c5: 1 });
});

t('la même partie collée en PGN (même lien, en-têtes différents) est reconnue', () => {
    const g = game('[Link "https://www.chess.com/game/live/111"]', SICI, '\n[Event "Live Chess"]');
    assert.strictEqual(run('recordGameFrequencies')([g], () => 'w').added, 0);
});

t('Lichess : identifiant de partie tiré de Site, quel que soit le camp dans l\'adresse', () => {
    const a = game('[Site "https://lichess.org/AbCd1234"]', '1. e4 e5');
    const b = game('[Site "https://lichess.org/AbCd1234/white"]', '1. e4 e5');
    assert.strictEqual(run('gameId')(a.headers, a.sans), run('gameId')(b.headers, b.sans));
    assert.strictEqual(run('recordGameFrequencies')([a, b], () => 'w').added, 1);
    assert.deepStrictEqual(freqAfterE4(), { c7c5: 1, e7e5: 1 });
});

t('partie sans lien : empreinte des joueurs, de la date et des coups', () => {
    const a = game('', '1. e4 e6'), b = game('', '1. e4 e6');
    assert.strictEqual(run('recordGameFrequencies')([a, b], () => 'w').added, 1);
    assert.strictEqual(run('recordGameFrequencies')([game('', '1. e4 c6')], () => 'w').added, 1);   // autre partie
});

t('seuls les coups ADVERSES sont comptés, et seulement pour la couleur jouée', () => {
    const f = JSON.parse(store.chessTrainer_gameFreq);
    assert(Object.keys(f.w).every(k => k.split(' ')[1] === 'b'), 'positions blanches comptées');
    assert.deepStrictEqual(f.b, {});
});

t('part d\'une réponse : utilisée par le tirage de l\'Entraînement', () => {
    const k = run('Chess.key(Chess.play(Chess.start(), "e2e4"))');
    assert.strictEqual(run('freqShare')('w', k, 'c7c5'), 0.25);                 // c5, e5, e6, c6 : une fois chacun
    run('appSettings = { freqWeight: true, elo: "" };');
    const e = { move: 'g1f3', path: ['e2e4', 'c7c5', 'g1f3'], attempts: 0, failures: 0 };
    assert.strictEqual(run('freqFactor')(e, 'w'), 0.6 + 1.4 * 0.25);
    run('appSettings.freqWeight = false;');
    assert.strictEqual(run('freqFactor')(e, 'w'), 1);
});

console.log(`\n${n} tests réussis.`);
