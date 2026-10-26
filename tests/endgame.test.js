// Lancer : node tests/endgame.test.js   — module Finales (noyau, catalogue, défense de Philidor), sans DOM
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const jeq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);   // objets issus du contexte vm

const ctx = { console, setTimeout, clearTimeout, registerActions() {}, escapeHtml: s => String(s), ico: () => '', dataStore: { getJSON: () => ({}), setJSON() {} } };
vm.createContext(ctx);
for (const f of ['js/modules/endgame/egCore.js', 'js/modules/endgame/egExercises.js', 'js/modules/endgame/egJudge.js',
                 'js/modules/endgame/egOpponent.js', 'js/modules/endgame/endgame.js'])
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

t('pièces mineures : seuls les coups qui ne perdent pas sont acceptés (cavalier, Fou de la mauvaise couleur)', () => {
    for (const [id, want] of [['mineur-cavalier', ['d3b4', 'd3c5', 'd3e5']], ['mineur-fou-couleur', ['e6e7', 'e6f5', 'e6f6', 'e6f7']]]) {
        const ex = ENDGAME_BY_ID[id], st = EG.fromFen(ex.fen);
        const ok = EG.legalMoves(st).filter(m => EG.pawnMoveValue(st, m, ex.horizon) >= 0).map(_egUci).sort();
        jeq(ok, want, id);
    }
});

t('fourchette : une Dame promue qu\'un cavalier prend par échec double ne compte pas comme un gain', () => {
    // b8=D ?? Nd7+ puis Nxb8 : la promotion n'est pas gagnante.
    const st = EG.fromFen('8/1P6/5K2/2n5/8/8/8/7k w - - 0 1');
    assert.strictEqual(EG.pawnMoveValue(st, _egParseUci('b7b8q'), 2), 0);
    const quiet = EG.fromFen('8/1P6/8/8/8/8/6n1/K5k1 w - - 0 1');                // cavalier trop loin : gain
    assert.strictEqual(EG.pawnMoveValue(quiet, _egParseUci('b7b8q'), 2), 1);
});

t('Vancura : roi hors du coin, Tour qui quitte la 6e ou échange perdant refusés ; attaque latérale acceptée', () => {
    const ex = ENDGAME_BY_ID['rook-vancura'], st = EG.fromFen(ex.fen);
    const verdict = u => ctx._egVancuraCheck(st, _egParseUci(u));
    ['f6b6', 'f6e6', 'g7h7'].forEach(u => assert.strictEqual(verdict(u), null, u));
    ['g7f7', 'f6f8', 'f6a6'].forEach(u => assert(verdict(u) && verdict(u).msg, u));
});

t('catalogue : exercices jugés décrits par des données (plan, objectif, limite), niveaux 1 à 5, catégories connues', () => {
    const cats = ctx.ENDGAME_CATEGORIES.map(c => c.id);
    ctx.ENDGAME_EXERCISES.forEach(ex => {
        assert(cats.includes(ex.cat), ex.id + ' : catégorie');
        assert(ex.level >= 1 && ex.level <= 5, ex.id + ' : niveau');
        if (!ex.kind) assert(ex.plan.length && ['win', 'draw'].includes(ex.goal), ex.id);
    });
    ['rook-lucena', 'rook-philidor', 'rook-vancura'].forEach(id => assert(!ENDGAME_BY_ID[id].kind, id + ' doit être jugé par les tables'));
    assert(ctx.ENDGAME_EXERCISES.filter(e => !e.kind).length >= 25);
});

// ─── Juge commun et adversaire calculé (sans réseau : API Syzygy et moteur simulés) ──
const { EndgameJudge, EndgameOpponent, _egJudgedOutcome } = ctx;
const tests = [];
const at = (name, fn) => tests.push([name, fn]);

at('juge : roi + pion contre roi tranché hors ligne par la base exacte, coups classés', async () => {
    const v = await EndgameJudge.probe(ENDGAME_BY_ID['kpk-opposition'].fen);
    assert.strictEqual(v.source, 'kpk'); assert.strictEqual(v.exact, true); assert.strictEqual(v.wdl, 2);
    const wins = v.moves.filter(m => m.wdl === 2).map(m => m.uci);
    jeq(wins, ['c5d5']);                                                 // un seul coup gagne : l'opposition
    const j = await EndgameJudge.judgeMove(ENDGAME_BY_ID['kpk-opposition'].fen, 'c5b5');
    assert.strictEqual(EndgameJudge.result(j.after), 0);
});

at('juge : tables Syzygy lues une seule fois (cache), catégories converties pour le camp qui joue', async () => {
    let calls = 0;
    ctx.fetch = async url => { calls++; assert(url.startsWith('https://tablebase.lichess.ovh/standard?fen=')); return { ok: true, status: 200, json: async () => ({
        category: 'draw', dtz: 0, moves: [
            { uci: 'a6b6', san: 'Rb6', category: 'draw', dtz: 0, zeroing: false },
            { uci: 'e8d8', san: 'Rd8', category: 'win', dtz: 13, zeroing: false },
            { uci: 'a6a1', san: 'Ta1', category: 'cursed-win', dtz: 60, zeroing: false }] }) }; };
    const fen = ENDGAME_BY_ID['rook-philidor'].fen;
    const v = await EndgameJudge.probe(fen);
    assert.strictEqual(v.source, 'syzygy'); assert.strictEqual(v.wdl, 0);
    jeq(v.moves.map(m => m.wdl), [0, -2, -1]);
    await EndgameJudge.probe(fen);
    assert.strictEqual(calls, 1, 'seconde lecture : cache');
    const j = await EndgameJudge.judgeMove(fen, 'e8d8');
    jeq([j.before, j.after, j.exact], [0, -2, true]);
    assert.strictEqual(EndgameJudge.result(-1), 0, 'gain annulé par la règle des 50 coups : nulle');
    delete ctx.fetch; EndgameJudge.reset();
});

at('juge : au-delà de 7 pièces, repli sur le moteur, verdict estimé (seuils +2,5 et 0,6)', async () => {
    let asked = null;
    ctx.Engine = { analyse: (fen, opts) => { asked = opts; return { stop() {}, done: Promise.resolve({ cancelled: false, best: 'c8c2',
        lines: [{ pv: ['c8c2'], score: { cp: -30 } }, { pv: ['g8f8'], score: { cp: -280 } }] }) }; } };
    const fen = ENDGAME_BY_ID['tours-4c3'].fen;                          // Noirs au trait : scores des Blancs inversés
    const v = await EndgameJudge.probe(fen);
    jeq([v.source, v.exact, v.wdl], ['engine', false, 0]);
    jeq(v.moves.map(m => m.wdl), [0, 2]);
    jeq(asked, { multipv: 3, depth: 18 });
    jeq([EndgameJudge.classify({ cp: 250 }), EndgameJudge.classify({ cp: 60 }), EndgameJudge.classify({ cp: 100 }), EndgameJudge.classify({ mate: -3 })], [2, 0, 1, -2]);
    delete ctx.Engine; EndgameJudge.reset();
});

at('adversaire : résistance maximale = meilleur coup ; en nulle, il pousse ; humain = même résultat, au hasard', async () => {
    const fen = '8/8/8/8/8/8/8/8 w - - 0 1';
    const probe = moves => { EndgameJudge.probe = async () => ({ source: 'syzygy', exact: true, wdl: Math.max(...moves.map(m => m.wdl)), moves }); };
    const orig = EndgameJudge.probe;
    probe([{ uci: 'a1a2', wdl: 2 }, { uci: 'b1b2', wdl: 2 }, { uci: 'c1c2', wdl: 0 }]);
    assert.strictEqual((await EndgameOpponent.pick(fen, 'max')).uci, 'a1a2');
    assert.strictEqual((await EndgameOpponent.pick(fen, 'human', () => 0.99)).uci, 'b1b2');
    probe([{ uci: 'a1a2', san: 'Ra2', wdl: 0 }, { uci: 'e4e5', san: 'e5', wdl: 0, zeroing: true }, { uci: 'h1h8', san: 'Th8+', wdl: 0 }, { uci: 'b1b2', wdl: -2 }]);
    assert.strictEqual((await EndgameOpponent.pick(fen, 'max')).uci, 'e4e5');
    probe([{ uci: 'a1a2', wdl: -2 }, { uci: 'b1b2', wdl: -2 }, { uci: 'c1c2', wdl: -2 }, { uci: 'd1d2', wdl: -2 }]);
    assert.strictEqual((await EndgameOpponent.pick(fen, 'human', () => 0.99)).uci, 'c1c2', 'en perte : parmi les trois plus tenaces');
    EndgameJudge.probe = orig;
});

at('coup jugé : erreur si le verdict se dégrade (explication de Philidor), réussite par prise ou après « hold » coups', async () => {
    const phil = ENDGAME_BY_ID['rook-philidor'], st = EG.fromFen(phil.fen);
    const bad = _egJudgedOutcome(phil, st, _egParseUci('a6a1'), { before: 0, after: -2 }, 1);
    assert.strictEqual(bad.state, 'fail'); assert(/6e rangée/.test(bad.msg), bad.msg);
    const ok = _egJudgedOutcome(phil, st, _egParseUci('a6b6'), { before: 0, after: 0 }, 1);
    jeq([ok.state, ok.note], ['continue', '']);
    assert.strictEqual(_egJudgedOutcome(phil, st, _egParseUci('a6b6'), { before: 0, after: 0 }, 12).state, 'success');
    const advice = _egJudgedOutcome(phil, st, _egParseUci('e8d8'), { before: 0, after: 0 }, 1);
    assert(advice.state === 'continue' && advice.note, 'coup juste mais hors méthode : conseil');
    const race = ENDGAME_BY_ID['tours-pion-course'];                     // until: 'capture' : la prise du pion conclut
    const rs = EG.fromFen('8/8/8/8/8/2k5/2p5/2R1K3 w - - 0 1');
    assert.strictEqual(_egJudgedOutcome(race, rs, _egParseUci('c1c2'), { before: 2, after: 0 }, 5).state, 'fail', 'Txc2 ?? Rxc2 : nulle');
    assert.strictEqual(_egJudgedOutcome(race, rs, _egParseUci('e1d1'), { before: 2, after: 2 }, 5).state, 'continue');
    const q = ENDGAME_BY_ID['dame-pion-centre'], qs = EG.fromFen('8/8/8/8/8/8/3p4/K2Qk3 w - - 0 1');
    assert.strictEqual(_egJudgedOutcome(q, qs, _egParseUci('d1d2'), { before: 2, after: 2 }, 3).state, 'success');
    const slow = _egJudgedOutcome(q, EG.fromFen(q.fen), _egParseUci('h1h2'), { before: 2, after: 2 }, q.maxMoves);
    jeq([slow.state, slow.undoable], ['fail', false]);
    const lost = _egJudgedOutcome(q, EG.fromFen(q.fen), _egParseUci('h1d1'), { before: 2, after: 0 }, 1);
    assert.strictEqual(lost.state, 'fail');
    assert.strictEqual(_egJudgedOutcome(q, EG.fromFen(q.fen), _egParseUci('h1h2'), null, 1).state, 'continue', 'sans verdict : coup accepté');
});

(async () => {
    for (const [name, fn] of tests) { await fn(); n++; console.log('ok  ', name); }
    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
