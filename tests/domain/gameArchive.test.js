// Lancer : node tests/domain/gameArchive.test.js   — parties Chess.com et Lichess normalisées, calculs, archive sans doublon (réseau simulé).
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const mem = {};
const dataStore = { get: k => (k in mem ? mem[k] : null), getJSON: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), setJSON: (k, v) => { mem[k] = JSON.stringify(v); } };
const appSettings = { chesscomUser: 'Moi', lichessUser: '', eloSite: '', eloSpeed: '' };
const ctx = { console, Date, Math, JSON, Number, Set, Map, Promise, encodeURIComponent, dataStore, appSettings };
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
    const G = (site, speed, at, me, rated = true) => ({ site, speed, at, me, rated });
    await t('niveau : dernier Elo par site et cadence, parties non classées et cadences inconnues écartées', () => {
        const l = JSON.parse(JSON.stringify(A.eloLevels([G('chesscom', 'blitz', 2, 1510), G('chesscom', 'blitz', 1, 1500), G('chesscom', 'blitz', 3, 1700, false), G('lichess', 'rapid', 1, 1800), G('lichess', 'x', 1, 9)])));
        assert.deepStrictEqual(l, { chesscom: { blitz: { r: 1510, n: 2 } }, lichess: { rapid: { r: 1800, n: 1 } } });
    });
    await t('niveau : le choix mémorisé gagne, sinon Chess.com et la cadence la plus jouée', () => {
        const lv = { chesscom: { blitz: { r: 1500, n: 2 }, bullet: { r: 1400, n: 9 } }, lichess: { rapid: { r: 1800, n: 1 }, blitz: { r: 1600, n: 1 } } }, both = ['chesscom', 'lichess'];
        const p = (...a) => { const r = A.pickElo(lv, ...a); return r && `${r.site} ${r.speed} ${r.r}`; };
        assert.strictEqual(p(both, '', ''), 'chesscom bullet 1400');
        assert.strictEqual(p(both, 'chesscom', 'blitz'), 'chesscom blitz 1500');
        assert.strictEqual(p(both, 'lichess', 'blitz'), 'lichess blitz 1600', 'la cadence suit au changement de site');
        assert.strictEqual(p(both, 'lichess', 'bullet'), 'lichess rapid 1800', 'cadence absente du site : repli sans erreur');
        assert.strictEqual(p(['lichess'], 'chesscom', 'blitz'), 'lichess blitz 1600', 'site délié : ignoré');
        assert.strictEqual(p([], '', ''), null);
    });
    await t('niveau : résumé écrit par all(), relu sans IndexedDB, nul sans compte relié', async () => {
        await A.all();
        assert.deepStrictEqual(JSON.parse(JSON.stringify(JSON.parse(mem.chessTrainer_eloLevels))), { chesscom: { blitz: { r: 1500, n: 1 } } });
        appSettings.eloSpeed = 'bullet';
        assert.strictEqual(A.level().speed, 'blitz');
        assert.strictEqual(A.level().r, 1500);
        appSettings.chesscomUser = ' ';
        assert.strictEqual(A.level(), null);
    });
    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
