// Lancer : node tests/engine.test.js   — moteur d'échecs (chessEngine.js) : coups légaux, notation SAN, clé de position, sans DOM
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ctx = { console, renderMoves() {} };
vm.createContext(ctx);
const f = 'js/core/chessEngine.js';
vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^(const|let) (\w+)(\s*)=/gm, 'var $2$3='), ctx, { filename: f });
const E = ctx;

// Coups légaux de la position courante (UCI), promotions détaillées.
function moves() {
    const out = [];
    for (let from = 0; from < 64; from++) {
        const p = E.board[from];
        if (!p || E.isWhite(p) !== (E.turn === 'w')) continue;
        for (const to of E.getLegalMoves(from)) {
            const promos = E.isPromotion(from, to) ? ['q', 'r', 'b', 'n'] : [''];
            promos.forEach(pr => out.push(E.moveToStr(from, to, pr)));
        }
    }
    return out;
}
const save = () => ({ board: E.board.slice(), turn: E.turn, cr: { ...E.castlingRights }, ep: E.enPassant });
const restore = s => { E.board = s.board.slice(); E.turn = s.turn; E.castlingRights = { ...s.cr }; E.enPassant = s.ep; };
function play(uci) {
    const from = E.squareToIdx(uci.slice(0, 2)), to = E.squareToIdx(uci.slice(2, 4)), pr = uci[4];
    const t0 = E.turn;
    E.applyMoveRaw(from, to);
    if (pr) E.board[to] = t0 === 'w' ? pr.toUpperCase() : pr;
    E.turn = t0 === 'w' ? 'b' : 'w';
}
function perft(depth) {
    if (!depth) return 1;
    let total = 0;
    for (const u of moves()) { const s = save(); play(u); total += perft(depth - 1); restore(s); }
    return total;
}
// SAN d'un coup UCI depuis un FEN.
function san(fen, uci) {
    E.parseFEN(fen);
    return E.toAlgebraic(E.squareToIdx(uci.slice(0, 2)), E.squareToIdx(uci.slice(2, 4)), uci[4] || null);
}

// Comptes de référence (chessprogramming.org, « Perft Results »).
const PERFT = [
    ['position initiale', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902]],
    ['Kiwipete (roques, clouages, passant)', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039]],
    ['position 3 (passant à la découverte)', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
    ['position 4 (promotions, échecs)', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486]]
];
PERFT.forEach(([name, fen, counts]) => t(`perft : ${name}`, () => {
    counts.forEach((want, i) => { E.parseFEN(fen); assert.strictEqual(perft(i + 1), want, `profondeur ${i + 1}`); });
}));

t('SAN : coups simples, prises, roques, promotion', () => {
    assert.strictEqual(san(E.INIT_FEN, 'e2e4'), 'e4');
    assert.strictEqual(san(E.INIT_FEN, 'g1f3'), 'Nf3');
    assert.strictEqual(san('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2', 'e4d5'), 'exd5');
    assert.strictEqual(san('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1'), 'O-O');
    assert.strictEqual(san('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1c1'), 'O-O-O');
    assert.strictEqual(san('8/4P3/8/8/8/8/k7/4K3 w - - 0 1', 'e7e8q'), 'e8=Q');
    assert.strictEqual(san('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', 'e5f6'), 'exf6');
});

t('SAN : ambiguïtés levées par la colonne, la rangée, ou les deux', () => {
    assert.strictEqual(san('4k3/8/8/8/8/2N3N1/8/4K3 w - - 0 1', 'c3e4'), 'Nce4');
    assert.strictEqual(san('4k3/8/8/8/8/2N3N1/8/4K3 w - - 0 1', 'g3e4'), 'Nge4');
    assert.strictEqual(san('4k3/8/8/8/R7/8/8/R3K3 w - - 0 1', 'a1a2'), 'R1a2');
    assert.strictEqual(san('4k3/8/8/8/R7/8/8/R3K3 w - - 0 1', 'a4a2'), 'R4a2');
    assert.strictEqual(san('2k5/8/8/8/4Q2Q/8/8/K6Q w - - 0 1', 'h4e1'), 'Qh4e1');
    // Le second cavalier est cloué : aucune ambiguïté réelle.
    assert.strictEqual(san('4k3/8/8/8/4r3/8/2N1N3/4K3 w - - 0 1', 'c2d4'), 'Nd4');
    // Prise de pion : la colonne de départ suffit toujours.
    assert.strictEqual(san('4k3/8/8/3p4/2P1P3/8/8/4K3 w - - 0 1', 'c4d5'), 'cxd5');
});

t('SAN : échec et mat signalés', () => {
    assert.strictEqual(san('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', 'a1a8'), 'Ra8+');
    assert.strictEqual(san('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8'), 'Ra8#');
    assert.strictEqual(san('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2', 'd8h4'), 'Qh4#');
    assert.strictEqual(san('8/4P3/8/8/8/8/8/k3K3 w - - 0 1', 'e7e8q'), 'e8=Q');
    assert.strictEqual(san('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', 'e1c1'), 'O-O-O');
    assert.strictEqual(san('3k4/8/8/8/8/8/8/R3K3 w Q - 0 1', 'e1c1'), 'O-O-O+');
});

t('SAN : le calcul laisse la position intacte', () => {
    E.parseFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    const before = JSON.stringify(save());
    moves().forEach(u => E.toAlgebraic(E.squareToIdx(u.slice(0, 2)), E.squareToIdx(u.slice(2, 4)), u[4] || null));
    assert.strictEqual(JSON.stringify(save()), before);
});

t('clé de position : roques et prise en passant (seulement si elle est jouable)', () => {
    E.parseFEN(E.INIT_FEN);
    assert.strictEqual(E.positionKey(), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
    E.parseFEN('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    assert.strictEqual(E.positionKey().split(' ')[3], '-', 'aucun pion noir ne peut prendre en e3');
    E.parseFEN('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    assert.strictEqual(E.positionKey().split(' ')[3], 'e3');
    E.parseFEN('r3k2r/8/8/8/8/8/8/R3K2R w Kq - 0 1');
    assert.strictEqual(E.positionKey().split(' ')[2], 'Kq');
    E.parseFEN('8/8/8/8/8/8/8/R3K2R w - - 0 1');
    assert.strictEqual(E.positionKey().split(' ')[2], '-');
});

t('clé de position : une clé relue par parseFEN redonne la même clé', () => {
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
     'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'].forEach(fen => {
        E.parseFEN(fen);
        const k = E.positionKey();
        E.parseFEN(k);
        assert.strictEqual(E.positionKey(), k);
    });
});

console.log(`\n${n} tests réussis.`);
