// Lancer : node tests/domain/gamePositions.test.js   — types de positions, sur le vrai moteur d'échecs : dames, roques, structures, finales, déséquilibres, vue Positions.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 500) => new Promise(r => setTimeout(r, ms));

const QUEENS_OFF = 'e4 d5 exd5 Qxd5 Qf3 Qxf3 Nxf3 Nf6 d4 Bf5 Bd3 Bxd3 cxd3 e6 O-O Be7 Nc3 O-O Re1 Nbd7'.split(' ');
const OPPOSITE = 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3 d6 Bg5 h6 Bh4 Qe7 Nc3 Bd7 a3 O-O-O b4 Bb6'.split(' ');
const c = (over = {}) => ({ P: 0, N: 0, B: 0, R: 0, Q: 0, p: 0, n: 0, b: 0, r: 0, q: 0, ...over });

(async () => {
    const { dom, errors } = await bootApp({ before(w) { w.scrollTo = () => {}; } });
    const w = dom.window, $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
    const P = w.eval('GamePositions');
    const plain = v => JSON.parse(JSON.stringify(v));
    const feat = (sans, color = 'w') => plain(P.features({ sans, color }));
    const structure = (fen, color) => P.structureOf(w.eval('Chess').fromFen(`${fen} w - - 0 1`).board, color);

    await t('dames échangées et roques des deux camps', () => {
        const f = feat(QUEENS_OFF);
        assert.deepStrictEqual([f.qt, f.me, f.opp], [1, 'k', 'k']);
    });

    await t('roques opposés, dames restées, vu de chaque camp', () => {
        const f = feat(OPPOSITE, 'b');
        assert.deepStrictEqual([f.qt, f.me, f.opp], [0, 'q', 'k']);
    });

    await t('partie illisible : marquée, sans bloquer', () => {
        assert.strictEqual(feat(['e4', 'Qh8']).bad, 1);
    });

    await t('partie trop courte : ni dames ni structure', () => {
        const f = feat(['e4', 'e5', 'Nf3']);
        assert.strictEqual(f.qt, undefined);
        assert.strictEqual(f.st, undefined);
    });

    await t('structures : du point de vue de chaque camp', () => {
        const iqp = 'r1bq1rk1/pp3ppp/2n1pn2/8/3P4/2N2N2/PP3PPP/R1BQ1RK1';
        assert.strictEqual(structure(iqp, 'w'), 'iqp+');
        assert.strictEqual(structure(iqp, 'b'), 'iqp-');
        assert.strictEqual(structure('r2q1rk1/p3bppp/1p2pn2/8/2PP4/5N2/P4PPP/R1BQ1RK1', 'w'), 'hang+');
        assert.strictEqual(structure('r1bq1rk1/pp2bppp/2p2n2/3p4/3P4/2N1PN2/PP3PPP/R2Q1RK1', 'w'), 'carlsbad');
        assert.strictEqual(structure('r1bq1rk1/pp2ppbp/3p1np1/8/2P1P3/2N1BN2/PP2BPPP/R2Q1RK1', 'b'), 'maroczy');
        assert.strictEqual(structure('r1bqkb1r/pp3ppp/2n1p3/2ppP3/3P4/2P2N2/PP3PPP/RNBQKB1R', 'w'), 'french');
        assert.strictEqual(structure('r1bq1rk1/ppp2pbp/3p1np1/3Pp3/4P3/2N2N2/PP2BPPP/R1BQ1RK1', 'b'), 'kid');
        assert.strictEqual(structure('4k3/pp3ppp/8/8/8/8/PP3PPP/4K3', 'w'), 'open');
        assert.strictEqual(structure('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', 'w'), '');
    });

    const fill = (count, v) => new Array(count).fill(c(v));

    await t('finale : première position simplifiée, classée après les reprises, au demi-coup 20 au moins', () => {
        const many = { N: 2, B: 2, n: 2, b: 2 };
        assert.strictEqual(P.endgameOf([...fill(20, many), ...fill(10, { R: 1, r: 1 })]), 'rook');
        assert.strictEqual(P.endgameOf([...fill(20, many), ...fill(10, { R: 1, r: 1, N: 1, b: 1 })]), 'rookMinor');
        assert.strictEqual(P.endgameOf([...fill(20, many), ...fill(10, { N: 1, b: 1 })]), 'minor');
        assert.strictEqual(P.endgameOf([...fill(20, many), ...fill(10, { Q: 1, q: 1 })]), 'queen');
        assert.strictEqual(P.endgameOf([...fill(20, many), ...fill(10, { P: 3, p: 3 })]), 'pawn');
        assert.strictEqual(P.endgameOf(fill(30, many)), '', 'jamais simplifiée');
        assert.strictEqual(P.endgameOf([...fill(20, many), ...fill(4, { R: 1, r: 1 })]), '', 'terminée aussitôt');
    });

    const base = { P: 6, p: 6, R: 2, r: 2, N: 1, n: 1, B: 1, b: 1, Q: 1, q: 1 };
    const series = (over, plies) => [...fill(14, base), ...fill(plies, { ...base, ...over })];

    await t('déséquilibre : tenu six demi-coups, de mon point de vue, une reprise ne compte pas', () => {
        assert.strictEqual(P.imbalanceOf(series({ R: 1, n: 0 }, 6).concat(fill(10, base)), 'w'), 'exch-', 'ma tour perdue contre un cavalier');
        assert.strictEqual(P.imbalanceOf(series({ r: 1, N: 0 }, 8), 'w'), 'exch+', 'tour adverse prise contre un cavalier');
        assert.strictEqual(P.imbalanceOf(series({ r: 1, N: 0 }, 8), 'b'), 'exch-');
        assert.strictEqual(P.imbalanceOf(series({ n: 0 }, 8), 'w'), 'piece+');
        assert.strictEqual(P.imbalanceOf(series({ p: 5 }, 8), 'w'), 'pawn+');
        assert.strictEqual(P.imbalanceOf(series({ n: 0 }, 3).concat(fill(12, base)), 'w'), 'even', 'trop bref');
    });

    await t('déséquilibre : une pièce d\'avance prime sur un pion gagné avant', () => {
        const l = [...fill(14, base), ...fill(8, { ...base, p: 5 }), ...fill(8, { ...base, p: 5, n: 0 })];
        assert.strictEqual(P.imbalanceOf(l, 'w'), 'piece+');
    });

    await t('bilan : score par type, parties illisibles ou sans calcul ignorées', () => {
        const g = (result, pf) => ({ result, me: 1500, opp: 1500, sans: new Array(40).fill('x'), pf: { v: 1, ...pf } });
        const r = plain(P.report([g('w', { qt: 1, me: 'k', opp: 'k', st: 'open', eg: 'rook', imb: 'even' }), g('l', { qt: 1, me: 'k', opp: 'q', st: 'open' }), g('w', { qt: 0, me: '', opp: 'k' }), g('w', { bad: 1 }), { result: 'w', sans: [] }]));
        assert.strictEqual(r.games, 3);
        assert.deepStrictEqual([r.queens.off.n, r.queens.off.score, r.queens.on.n], [2, 50, 1]);
        assert.deepStrictEqual([r.castling.same.n, r.castling.opposite.n, r.castling.meNone.n], [1, 1, 1]);
        assert.deepStrictEqual(r.structures.map(x => [x.key, x.t.n]), [['open', 2]]);
        assert.deepStrictEqual(r.endgames.map(x => x.key), ['rook']);
    });

    await t('vue Positions : calcul en tâche de fond, cartes, renvoi à la bonne catégorie des Finales', async () => {
        w.eval(`(() => {
            const pgn = ${JSON.stringify(QUEENS_OFF.map((s, i) => (i % 2 ? '' : `${i / 2 + 1}. `) + s).join(' '))};
            const end = Math.floor(Date.now() / 1000), game = i => ({ rules: 'chess', uuid: 'p' + i, end_time: end - i * 7200, time_class: 'blitz', time_control: '180', rated: true, url: 'x', pgn: '[White "Moi"]\\n\\n' + pgn + ' *',
                white: { username: 'Moi', rating: 1500, result: i % 2 ? 'win' : 'resigned' }, black: { username: 'Lui', rating: 1500, result: i % 2 ? 'resigned' : 'win' } });
            window.fetch = async url => /archives$/.test(url) ? { status: 200, ok: true, json: async () => ({ archives: ['https://api.chess.com/pub/player/moi/games/2026/11'] }) } : { status: 200, ok: true, json: async () => ({ games: Array.from({ length: 12 }, (_, i) => game(i)) }) };
            appSettings.chesscomUser = 'Moi'; statsColor = 'all'; statsFilter = 'all';
            const db = {}, p = 'e2e4 e7e5 g1f3'.split(' ');
            db[Chess.key(Chess.start())] = { move: p[0], san: 'e4', attempts: 3, failures: 0, path: p.slice(0, 1), ply: 1, due: Date.now() + 864e5, interval: 3, created: 1 };
            dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
            switchHomeTab('stats'); initStats();
            document.querySelector('#stats-games [data-action="statsGamesSync"]').click();
        })()`);
        await tick(900);
        assert(w.eval('StatsGames.games().every(g => g.pf && !g.pf.bad)'), 'positions calculées et gardées');
        w.eval(`UI_ACTIONS.statsInView('positions')`);
        assert($('#stats-games .si-pos'));
        const h = $$('#stats-games .so-card h5').map(x => x.textContent);
        assert(h.some(x => /roquer/.test(x)), h.join(' | '));
        w.eval(`UI_ACTIONS.statsGoEndgame('tours')`);
        assert(!$('#home-tab-endgame').classList.contains('hidden'));
        w.eval(`switchHomeTab('stats')`);
    });

    assert.deepStrictEqual(errors, []);
    w.close();
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
