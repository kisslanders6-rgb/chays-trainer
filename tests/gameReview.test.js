// Lancer : node tests/gameReview.test.js   — « Analyser une partie » : lecture PGN et détection de la déviation, sans DOM
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const jeq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);   // objets issus du contexte vm

const store = {};
const ctx = {
    console, renderMoves() {}, renderBoard() {}, clearErrorFx() {}, resetNavCursor() {},
    dataStore: { getJSON: (k, d) => (k in store ? JSON.parse(store[k]) : d), setJSON: (k, v) => { store[k] = JSON.stringify(v); } }
};
vm.createContext(ctx);
for (const f of ['js/core/chessEngine.js', 'js/storage.js', 'js/modules/openings/openingsLogic.js', 'js/modules/openings/pgn.js', 'js/modules/openings/gameReview.js'])
    vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: f });
vm.runInContext('saveDB = function () {};', ctx);

// Base d'un répertoire construite en rejouant des lignes UCI : mes coups deviennent des entrées.
function repertoire(color, lines) {
    return vm.runInContext(`(function (color, lines) {
        const db = {};
        lines.forEach(l => _withEngineSnapshot(() => {
            parseFEN(INIT_FEN);
            const path = [];
            l.split(' ').forEach(u => {
                if (turn === color && !db[positionKey()]) db[positionKey()] = { move: u, san: '', attempts: 1, failures: 0 };
                path.push(u); _applyUciRaw(u);
            });
        }));
        return db;
    })`, ctx)(color, lines);
}

const ITA = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3';
const db  = repertoire('w', [ITA, 'e2e4 c7c5 g1f3']);
const sans = pgn => ctx.pgnMainLine(pgn).sans;

const CHESSCOM = `[Event "Live Chess"]
[Site "Chess.com"]
[White "moi"]
[Black "lui"]
[Result "1-0"]
[Link "https://www.chess.com/game/live/123"]

1. e4 {[%clk 0:02:59.9]} 1... e5 {[%clk 0:02:58]} 2. Nf3 {[%clk 0:02:57]} 2... Nc6 3. Bc4 Bc5 4. d3 Nf6 5. O-O 1-0`;

t('PGN Chess.com : en-têtes, horloges et numéros « 1... » sont ignorés', () => {
    const g = ctx.pgnMainLine(CHESSCOM);
    jeq(g.sans, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'O-O']);
    assert.strictEqual(g.headers.Link, 'https://www.chess.com/game/live/123');
});

t('mon coup hors répertoire : déviation « me », réponse attendue fournie', () => {
    const r = ctx.detectDeviation(sans(CHESSCOM), 'w', db, {});
    assert.strictEqual(r.moves.length, 9, 'toute la partie reste navigable');
    assert.strictEqual(r.deviation.ply, 6);
    assert.strictEqual(r.deviation.by, 'me');
    assert.strictEqual(r.deviation.expected.uci, 'c2c3');
    assert(db[r.deviation.key], 'la clé désigne l\'entrée à pénaliser');
});

t('coup adverse hors répertoire : nouveauté adverse, rien d\'attendu', () => {
    const r = ctx.detectDeviation(sans('1. e4 e6 2. d4 d5 *'), 'w', db, {});
    jeq([r.deviation.ply, r.deviation.by, r.deviation.endOfLine, r.deviation.known], [1, 'opp', false, false]);
});

t('réponse adverse déjà repérée mais non couverte : known', () => {
    const key = vm.runInContext('_withEngineSnapshot(() => { parseFEN(INIT_FEN); _applyUciRaw("e2e4"); return positionKey(); })', ctx);
    const r = ctx.detectDeviation(sans('1. e4 e6 *'), 'w', db, { [key]: ['e7e6'] });
    assert.strictEqual(r.deviation.known, true);
});

t('au bout de la ligne : endOfLine', () => {
    const r = ctx.detectDeviation(sans('1. e4 c5 2. Nf3 d6 3. d4 *'), 'w', db, {});
    jeq([r.deviation.ply, r.deviation.by, r.deviation.endOfLine], [3, 'opp', true]);
});

t('partie 100 % théorique : pas de déviation', () => {
    const r = ctx.detectDeviation(sans('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 *'), 'w', db, {});
    assert.strictEqual(r.deviation, null);
    assert.strictEqual(r.moves.length, 7);
});

t('transposition : un autre ordre de coups reste dans le répertoire', () => {
    // 1. e4 Cc6 2. Cf3 e5 rejoint la position de l'Italienne après 2... Cc6 : 3. Fc4 reste la réponse.
    const dbT = repertoire('w', [ITA, 'e2e4 b8c6 g1f3']);
    const r = ctx.detectDeviation(sans('1. e4 Nc6 2. Nf3 e5 3. Bc4 Bc5 4. c3 *'), 'w', dbT, {});
    assert.strictEqual(r.deviation, null);
    const r2 = ctx.detectDeviation(sans('1. e4 Nc6 2. Nf3 e5 3. Bb5 *'), 'w', dbT, {});
    jeq([r2.deviation.ply, r2.deviation.by, r2.deviation.expected.uci], [4, 'me', 'f1c4']);
});

t('Noirs : mon coup différent est une erreur', () => {
    const dbB = repertoire('b', ['e2e4 c7c5']);
    const r = ctx.detectDeviation(sans('1. e4 e5 *'), 'b', dbB, {});
    jeq([r.deviation.ply, r.deviation.by, r.deviation.expected.uci], [1, 'me', 'c7c5']);
});

t('coup illégal : lecture arrêtée, déviation antérieure conservée', () => {
    const r = ctx.detectDeviation(sans('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Ke5 *'), 'w', db, {});
    jeq([r.moves.length, r.illegal.ply, r.illegal.san, r.deviation.ply], [7, 7, 'Ke5', 6]);
});

t('erreur comptée une seule fois par partie', () => {
    vm.runInContext('currentRepertoire = "Test"; playerColor = "w";', ctx);
    ctx.openingDB = repertoire('w', [ITA]);
    vm.runInContext('openingDB = this.openingDB;', ctx);
    const g = ctx.pgnMainLine(CHESSCOM);
    const r = ctx.detectDeviation(g.sans, 'w', ctx.openingDB, {});
    const sig = ctx._gameSignature(g.headers, g.sans);
    assert.strictEqual(ctx.recordReviewMistake(r.deviation, sig), 'counted');
    assert.strictEqual(ctx.recordReviewMistake(r.deviation, sig), 'already');
    const e = ctx.openingDB[r.deviation.key];
    jeq([e.attempts, e.failures, e.interval], [2, 1, 0]);
});

console.log(`\n${n} tests réussis.`);
