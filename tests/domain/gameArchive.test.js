// Lancer : node tests/domain/gameArchive.test.js   — parties Chess.com et Lichess normalisées, calculs, archive sans doublon (réseau simulé).
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const ctx = { console, Date, Math, JSON, Number, Set, Map, Promise, encodeURIComponent };
vm.createContext(ctx);
vm.runInContext(readVars(scriptPath('gameArchive.js')), ctx);
const A = ctx.GameArchive;

const CC = { rules: 'chess', uuid: 'u1', end_time: 1700000000, time_class: 'blitz', rated: true, accuracies: { white: 84.5, black: 70 }, url: 'x',
    pgn: '[Event "Live"]\n[White "Moi"]\n\n1. e4 {[%clk 0:03:00]} 1... c5 2. Nf3 (2. c3 d5) d6 $1 1-0',
    white: { username: 'Moi', rating: 1500, result: 'win' }, black: { username: 'Lui', rating: 1480, result: 'resigned' } };
const LI = { id: 'abc', variant: 'standard', status: 'mate', speed: 'ultraBullet', rated: true, lastMoveAt: 1700000500000, winner: 'white', moves: 'e4 e5 Nf3',
    players: { white: { user: { id: 'lui', name: 'Lui' }, rating: 1600, ratingDiff: 5 }, black: { user: { id: 'moi', name: 'Moi' }, rating: 1550, ratingDiff: -5, analysis: { accuracy: 77 } } } };

(async () => {
    await t('PGN : commentaires, variantes, numéros et résultat retirés', () => {
        assert.deepStrictEqual([...A.sansFromPgn(CC.pgn)], ['e4', 'c5', 'Nf3', 'd6']);
    });
    await t('Chess.com : couleur, résultat, Elo, précision', () => {
        const g = A.fromChesscom(CC, 'MOI');
        assert.strictEqual(g.color, 'w'); assert.strictEqual(g.result, 'w'); assert.strictEqual(g.me, 1500); assert.strictEqual(g.opp, 1480);
        assert.strictEqual(g.accuracy, 84.5); assert.strictEqual(g.speed, 'blitz'); assert.strictEqual(g.at, 1700000000000);
    });
    await t('Chess.com : nulle reconnue ; variante et partie d\'un autre joueur écartées', () => {
        assert.strictEqual(A.fromChesscom({ ...CC, white: { ...CC.white, result: 'repetition' } }, 'moi').result, 'd');
        assert.strictEqual(A.fromChesscom({ ...CC, rules: 'chess960' }, 'moi'), null);
        assert.strictEqual(A.fromChesscom(CC, 'quelquun'), null);
    });
    await t('Lichess : couleur, défaite, cadence regroupée, précision', () => {
        const g = A.fromLichess(LI, 'Moi');
        assert.strictEqual(g.color, 'b'); assert.strictEqual(g.result, 'l'); assert.strictEqual(g.speed, 'bullet'); assert.strictEqual(g.accuracy, 77);
        assert.strictEqual(A.fromLichess({ ...LI, winner: undefined }, 'moi').result, 'd');
        assert.strictEqual(A.fromLichess({ ...LI, variant: 'chess960' }, 'moi'), null);
    });
    await t('bilan et courbe : score avec les nulles à moitié, Elo des seules parties classées de la cadence', () => {
        const games = [{ result: 'w' }, { result: 'd' }, { result: 'l' }, { result: 'w' }];
        const b = A.tally(games);
        assert.strictEqual(b.score, 63); assert.strictEqual(b.n, 4);
        const series = A.eloSeries([{ rated: true, speed: 'blitz', me: 2, at: 2 }, { rated: true, speed: 'blitz', me: 1, at: 1 }, { rated: false, speed: 'blitz', me: 9, at: 3 }, { rated: true, speed: 'rapid', me: 9, at: 4 }], 'blitz');
        assert.deepStrictEqual(series.map(p => p.r), [1, 2]);
    });
    await t('mise à jour : pas de doublon, le pseudo inconnu remonte', async () => {
        let calls = 0;
        ctx.fetch = async url => {
            calls++;
            if (/nobody/.test(url)) return { status: 404, ok: false };
            if (/archives$/.test(url)) return { status: 200, ok: true, json: async () => ({ archives: ['https://a/2026/10'] }) };
            return { status: 200, ok: true, json: async () => ({ games: [CC] }) };
        };
        assert.strictEqual(await A.sync('chesscom', 'moi'), 1);
        assert.strictEqual(await A.sync('chesscom', 'moi'), 0);
        assert.strictEqual((await A.all()).length, 1);
        await assert.rejects(A.sync('chesscom', 'nobody'), /user/);
        assert(calls >= 5);
    });
    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
