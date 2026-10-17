// Lancer : node tests/endgame.test.js   — module Finales (noyau, catalogue, défense de Philidor), sans DOM
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const jeq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);   // objets issus du contexte vm

const ctx = { console, registerActions() {}, escapeHtml: s => String(s), ico: () => '', dataStore: { getJSON: () => ({}), setJSON() {} } };
vm.createContext(ctx);
for (const f of ['js/modules/endgame/egCore.js', 'js/modules/endgame/egExercises.js', 'js/modules/endgame/endgame.js'])
    vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: f });
const { EG, ENDGAME_BY_ID, _egPhilidorCheck, _egParseUci, _egUci } = ctx;

// Rejoue une suite de coups UCI (promotion « q » acceptée) depuis un FEN.
function play(fen, line) {
    let st = EG.fromFen(fen);
    line.split(' ').forEach(u => {
        const m = _egParseUci(u);
        assert(EG.legalMoves(st).includes(m), 'coup illégal : ' + u);
        st = EG.make(st, m);
    });
    return st;
}

t('catalogue : chaque exercice démarre légalement, avec le verdict et la solution annoncés', () => {
    const bad = ctx.endgameSelfTest().filter(r => !r.ok);
    jeq(bad.map(r => r.id + ' : ' + r.problems.join(' ; ')), []);
});

t('Philidor n\'est plus en bêta', () => assert(!ENDGAME_BY_ID['rook-philidor'].beta));

t('Philidor : au départ, seules Tb6 et Tg6 sont acceptées', () => {
    const st = EG.fromFen(ENDGAME_BY_ID['rook-philidor'].fen);
    const ok = EG.legalMoves(st).filter(m => !_egPhilidorCheck(st, m)).map(_egUci).sort();
    jeq(ok, ['a6b6', 'a6g6']);
});

t('Philidor : après e8=D+, prendre la Dame (…Txe8, Txe8 Rxe8 : nulle) est accepté', () => {
    const fen = ENDGAME_BY_ID['rook-philidor'].fen;
    const st = play(fen, 'a6b6 e5e6 b6b1 h3h8 e8e7 h8h7 e7e8 e6e7 b1c1 d5d6 c1e1 h7h8 e8f7 e7e8q');
    const take = EG.legalMoves(st).find(m => _egUci(m) === 'e1e8');
    assert(take, 'Txe8 doit être légal');
    const r = _egPhilidorCheck(st, take);
    assert(r && r.capture, 'Txe8 doit être jugé comme l\'élimination du pion');
    const other = EG.legalMoves(st).find(m => _egUci(m) !== 'e1e8' && _egUci(m) !== 'f7e8');
    if (other) assert(_egPhilidorCheck(st, other).msg, 'laisser la Dame doit être refusé');
});

t('recherche de preuve : un mat (même par promotion) compte comme un gain', () => {
    // Mat du couloir : Blancs Rg1, Ta1 ; Noirs Rh8, pions g7 h7 → Ta8#
    const st = EG.fromFen('7k/6pp/8/8/8/8/8/R5K1 w - - 0 1');
    assert.strictEqual(EG.forcesPromotion(st, 1), true);                 // Ta8#
});

t('finales de pions : la percée ne se gagne que par 1.b6, Réti ne s\'annule que par 1.Rg7', () => {
    for (const [id, want] of [['pions-percee', 'b5b6'], ['pions-reti', 'h8g7']]) {
        const ex = ENDGAME_BY_ID[id], st = EG.fromFen(ex.fen);
        const good = EG.legalMoves(st).filter(m => { const v = EG.pawnMoveValue(st, m, ex.horizon); return ex.goal === 'win' ? v === 1 : v >= 0; });
        jeq(good.map(_egUci), [want], id);
    }
});

console.log(`\n${n} tests réussis.`);
