// Lancer : node tests/domain/gameQuality.test.js   — évaluations des parties (GameEval, moteur simulé) et qualité de jeu (GameQuality), identiques pour les deux sites.
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, `${a} ≠ ${b}`);
const plain = v => JSON.parse(JSON.stringify(v));

const MATE = 10000;
const ctx = { console, Date, Math, JSON, Number, Set, Map, Array, WeakMap, String, Promise };
vm.createContext(ctx);
['openingReport.js', 'gameQuality.js', 'gameEval.js'].forEach(f => vm.runInContext(readVars(scriptPath(f)), ctx));
const Q = ctx.GameQuality, E = ctx.GameEval, R = ctx.OpeningReport;

const game = (ev, over = {}) => ({ color: 'w', result: 'w', me: 1500, opp: 1500, at: Date.UTC(2026, 9, 15), ev, div: [0, 0], ...over });

// Faux échiquier : une position est le nombre de coups joués ; deux coups légaux au plus.
const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6'];
ctx.Chess = {
    start: () => ({ ply: 0, moves: [] }),
    legalMoves: p => p.ended ? [] : ['a' + p.ply, 'b' + p.ply],
    san: (p, u) => (u[0] === 'a' ? (p.sans || SANS)[p.ply] + '+' : 'zz'),
    play: (p, u) => ({ ply: p.ply + 1, sans: p.sans }),
    fen: p => `${p.ply < 3 ? 'nbrqNBRQnbrqNBRQ' : 'nN'}/x w - - 0 1 ${p.ply}`
};
ctx.GameArchive = { MATE, saved: [], saveEvals: async list => { ctx.GameArchive.saved.push(list.length); } };
let asked = [], cancelAt = -1;
ctx.Engine = { analyse: (fen, o) => { asked.push({ fen, o }); const i = asked.length - 1; return { stop() {}, done: Promise.resolve(i === cancelAt ? { best: null, lines: [], cancelled: true } : { best: 'x', cancelled: false, lines: [{ score: i === 2 ? { mate: 3 } : { cp: 10 * i } }] }) }; } };
const reset = () => { asked = []; cancelAt = -1; ctx.GameArchive.saved = []; };

(async () => {
    await t('pourcentage de gain et précision : formules de Lichess, bornées', () => {
        near(Q.win(0), 50);
        assert(Q.win(5000) < 99 && Q.win(5000) > 97, 'un mat compte comme 1000 centipions');
        near(Q.win(1000), Q.win(MATE));
        near(Q.moveAccuracy(0), 100);
        assert(Q.moveAccuracy(100) < 5);
    });

    await t('classement d\'un coup : imprécision, erreur, gaffe, moi et l\'adversaire séparés', () => {
        // Blancs : 20 → 20, puis une gaffe (−400 environ) ; Noirs jouent juste.
        const g = game([20, 20, -400, -400, -400, -400], { div: [0, 0] });
        const p = plain(Q.perGame(g));
        assert.strictEqual(p.me.blunder, 1);
        assert.strictEqual(p.opp.blunder, 0);
        assert.strictEqual(p.me.n, 3);
        assert.strictEqual(p.opp.n, 3);
    });

    await t('côté Noirs : la même baisse se lit de leur point de vue', () => {
        const p = plain(Q.perGame(game([20, 400, 400, 400], { color: 'b' })));
        assert.deepStrictEqual([p.me.blunder, p.opp.blunder, p.me.n], [1, 0, 2], 'l\'évaluation monte pour les Blancs : faute des Noirs');
        const up = plain(Q.perGame(game([20, -400, -400, -400], { color: 'b' })));
        assert.strictEqual(up.me.blunder, 0, 'elle baisse pour les Blancs : pas de faute des Noirs');
    });

    await t('phases : limites du site ou repli au demi-coup 24', () => {
        const ev = new Array(30).fill(20), p = plain(Q.perGame(game(ev, { div: [5, 11] })));
        assert.deepStrictEqual(p.me.phases.map(x => x.n), [2, 3, 10]);
        const none = plain(Q.perGame(game(new Array(30).fill(20), { div: undefined })));
        assert.deepStrictEqual(none.me.phases.map(x => x.n), [12, 3, 0]);
    });

    await t('bilan : erreurs pour 40 coups, précision, parties sans évaluations ignorées', () => {
        const q = plain(Q.quality([game([20, 20, -400, -400]), game([20, 20, 20, 20]), { color: 'w', result: 'w' }]));
        assert.strictEqual(q.games, 2);
        near(q.me.blunder, 10);
        near(q.opp.blunder, 0);
        assert(q.me.accuracy < q.opp.accuracy);
    });

    await t('précision : celle du site prime ; sinon moyenne arithmétique et harmonique, une gaffe pèse lourd', () => {
        const ev = [20, 20, 20, 20, -600, -600, -600, -600];
        const own = plain(Q.perGame(game(ev)));
        assert(own.accuracy < own.me.acc / own.me.n, 'plus sévère que la moyenne simple');
        const q = plain(Q.quality([game(ev, { accuracy: 88, oppAccuracy: 71 }), game(ev, { accuracy: 92 })]));
        near(q.me.accuracy, 90);
        assert(q.opp.accuracy > 71 && q.opp.accuracy < 100, 'site pour la première partie, calcul pour la seconde');
    });

    await t('conversion et résistance : à partir du coup 5, score des parties concernées', () => {
        const long = v => new Array(14).fill(v);
        const q = plain(Q.quality([game(long(300), { result: 'w' }), game(long(300), { result: 'l' }), game(long(-300), { result: 'd' })]));
        assert.deepStrictEqual([q.conversion.n, q.conversion.score], [2, 50]);
        assert.deepStrictEqual([q.resistance.n, q.resistance.score], [1, 50]);
        const early = plain(Q.quality([game([300, 300, 20, 20], { result: 'w' })]));
        assert.strictEqual(early.conversion.n, 0, 'un avantage d\'ouverture avant le coup 5 ne compte pas');
    });

    await t('fautes punies : après une erreur, le coup suivant garde-t-il le gain ?', () => {
        const q = plain(Q.quality([game([20, 400, 400, 20, 20, 20])]));
        assert.strictEqual(q.chances, 1, 'erreur noire en 1…, puis mon coup');
        assert.strictEqual(q.punished, 100);
        const mine = plain(Q.quality([game([20, 20, -400, 20, 20, 20])]));
        assert.deepStrictEqual([mine.errors, mine.unpunished], [1, 100], 'ma gaffe, puis l\'adversaire rend l\'avantage');
    });

    await t('courbe : évaluation de mon point de vue après chaque coup, bornée', () => {
        const q = plain(Q.quality([game([0, 100, 0, 5000, 0, 100], { color: 'b' }), game([0, 100, 0, 5000, 0, 100], { color: 'b' }), game([0, 100, 0, 5000, 0, 100], { color: 'b' })]));
        assert.deepStrictEqual(q.curve.map(p => p.cp), [-100, -600, -100]);
    });

    await t('sortie du répertoire : de mon point de vue, cinq tranches, parties sans évaluation ignorées', () => {
        const row = (ev, color, result) => ({ g: game(ev, { color, result }), a: { path: ['a', 'b'] } });
        const b = plain(Q.exitBuckets([row([0, 200], 'w', 'w'), row([0, 200], 'b', 'l'), row([0, 10], 'w', 'd'), { g: { color: 'w', result: 'w' }, a: { path: ['a', 'b'] } }]));
        assert.deepStrictEqual(b.map(x => x.n), [1, 0, 1, 0, 1]);
        assert.strictEqual(R.exitEval(game([0, 200]), 2), 200);
        assert.strictEqual(R.exitEval(game([0, 5000]), 2), 1000);
        assert.strictEqual(R.exitEval({ color: 'w' }, 2), null);
    });

    await t('diagnostic : sortie mauvaise, à remplacer ; bonne, à jouer en entier ; sans évaluation, sue mais perdante', () => {
        assert.strictEqual(R.diagnose(10, -9, 80, -40), 'replace');
        assert.strictEqual(R.diagnose(10, -9, 80, 40), 'through');
        assert.strictEqual(R.diagnose(10, -9, 80), 'losing');
        assert.strictEqual(R.diagnose(10, -9, 80, null), 'losing');
        assert.strictEqual(R.diagnose(10, -1, 80, -40), 'keep');
    });

    const toEval = over => ({ sans: SANS, at: 1, site: 'chesscom', ...over });

    await t('file : Chess.com d\'abord, récentes en tête ; évaluées, illisibles ou trop courtes écartées', () => {
        const q = plain(E.pending([toEval({ site: 'lichess', at: 9, id: 'l' }), toEval({ at: 1, id: 'c1' }), toEval({ at: 5, id: 'c5' }), toEval({ ev: [1], id: 'x' }), toEval({ evFail: true, id: 'y' }), toEval({ sans: ['e4'], id: 'z' })]));
        assert.deepStrictEqual(q.map(g => g.id), ['c5', 'c1', 'l']);
    });

    await t('phases calculées : milieu à 10 pièces ou au demi-coup 24, finale à 6 pièces', () => {
        assert.deepStrictEqual(plain(E.divide([14, 12, 10, 9, 6, 4])), [3, 5]);
        assert.deepStrictEqual(plain(E.divide(new Array(30).fill(14))), [24, 0]);
    });

    await t('évaluation : profondeur 12, un mat à +3 encodé comme Lichess, gardée dans l\'archive', async () => {
        reset();
        const g = toEval({});
        await E.run([g], { shouldRun: () => true });
        assert.strictEqual(asked.length, 8);
        assert.strictEqual(asked[0].o.depth, E.DEPTH);
        assert.strictEqual(g.ev.length, 8);
        assert.strictEqual(g.ev[2], MATE - 3);
        assert.strictEqual(g.evBy, 'sf12');
        assert.strictEqual(g.div.length, 2);
        assert.deepStrictEqual(ctx.GameArchive.saved, [1]);
    });

    await t('positions déjà vues : pas de second calcul', async () => {
        reset();
        await E.run([toEval({})], { shouldRun: () => true });
        assert.strictEqual(asked.length, 0, 'mêmes positions que la partie précédente');
    });

    await t('arrêt : la partie en cours n\'est pas enregistrée à moitié', async () => {
        reset();
        ctx.Chess.fen = p => `arret/${p.ply} w - - 0 1`;
        let calls = 0;
        const g = toEval({});
        await E.run([g], { shouldRun: () => ++calls < 4 });
        assert.strictEqual(g.ev, undefined);
        assert.deepStrictEqual(ctx.GameArchive.saved, []);
        assert.strictEqual(E.running(), false);
    });

    await t('moteur repris par un autre calcul : arrêt propre', async () => {
        reset();
        cancelAt = 1;
        ctx.Chess.fen = p => `repris/${p.ply} w - - 0 1`;
        const g = toEval({}), g2 = toEval({ at: 0 });
        await E.run([g, g2], { shouldRun: () => true });
        assert.strictEqual(g.ev, undefined);
        assert.strictEqual(g2.ev, undefined);
        assert.strictEqual(E.running(), false);
    });

    await t('partie illisible : marquée pour ne pas être reprise, la suite continue', async () => {
        reset();
        ctx.Chess.fen = p => `illisible/${p.ply} w - - 0 1`;
        const bad = toEval({ sans: ['Qh8', ...SANS.slice(1)], at: 9 }), ok = toEval({ at: 1 });
        await E.run([bad, ok], { shouldRun: () => true });
        assert.strictEqual(bad.evFail, true);
        assert.strictEqual(ok.ev.length, 8);
    });

    await t('position finale sans coup légal : mat pour celui qui vient de jouer, pat nul, sans moteur', async () => {
        reset();
        ctx.Chess.fen = p => `fin/${p.ply} w - - 0 1`;
        const real = ctx.Chess.legalMoves;
        ctx.Chess.legalMoves = p => p.ply === 8 ? [] : real(p);
        const white = toEval({ sans: SANS.slice(0, 7).concat('Nf6'), at: 2 });
        await E.run([white], { shouldRun: () => true });
        assert.strictEqual(white.ev[7], -MATE, 'les Noirs viennent de mater');
        assert.strictEqual(asked.length, 7);
        const pat = toEval({ at: 1, end: 'stalemate' });
        await E.run([pat], { shouldRun: () => true });
        assert.strictEqual(pat.ev[7], 0);
        ctx.Chess.legalMoves = real;
    });

    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
