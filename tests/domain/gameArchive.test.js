// Lancer : node tests/domain/gameArchive.test.js   — parties Chess.com et Lichess normalisées, calculs, archive sans doublon (réseau simulé).
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const mem = {};
const dataStore = { get: k => (k in mem ? mem[k] : null), getJSON: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), setJSON: (k, v) => { mem[k] = JSON.stringify(v); } };
const appSettings = { chesscomUser: 'Moi', lichessUser: '', eloSite: '', eloSpeed: '' };
const ctx = { console, Date, Math, JSON, Number, Set, Map, Promise, RegExp, Array, encodeURIComponent, dataStore, appSettings, TextDecoder };
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
    await t('archive 2 : Chess.com garde tous les coups, horloges, début, fin de partie et cadence exacte', () => {
        const pgn = '[UTCDate "2026.10.31"]\n[UTCTime "19:32:56"]\n\n1. e4 {[%clk 0:03:00]} 1... c5 {[%clk 0:02:58.5]} 2. Nf3 {[%clk 1:00:00]} 1-0';
        const g = A.fromChesscom({ ...CC, pgn, time_control: '180+2', accuracies: { white: 84.5, black: 70 } }, 'moi');
        assert.strictEqual(g.v, A.SCHEMA);
        assert.deepStrictEqual([...g.clk], [18000, 17850, 360000]);
        assert.deepStrictEqual([...g.tc], [180, 2]);
        assert.strictEqual(g.start, Date.UTC(2026, 9, 31, 19, 32, 56));
        assert.strictEqual(g.end, 'resign');
        assert.strictEqual(g.oppAccuracy, 70);
        const long = Array.from({ length: 50 }, (_, i) => `${i + 1}. Nf3 Nf6`).join(' ');
        assert.strictEqual(A.fromChesscom({ ...CC, pgn: long }, 'moi').sans.length, 100, 'plus de limite à 60 demi-coups');
        assert.strictEqual(A.fromChesscom({ ...CC, time_class: 'daily', time_control: '1/604800', pgn }, 'moi').clk, undefined, 'pas d\'horloge par correspondance');
        assert.strictEqual(A.fromChesscom({ ...CC, white: { ...CC.white, result: 'timeout' }, black: { ...CC.black, result: 'win' } }, 'moi').end, 'time');
        assert.strictEqual(A.fromChesscom({ ...CC, white: { ...CC.white, result: 'repetition' }, black: { ...CC.black, result: 'repetition' } }, 'moi').end, 'draw');
    });
    await t('archive 2 : Lichess garde Elo avant et après, horloges, fin, évaluations et phases', () => {
        const g = A.fromLichess({ ...LI, createdAt: 1700000000000, clock: { initial: 300, increment: 3 }, clocks: [30003, 30003, 30100, 20000], division: { middle: 25 },
            analysis: [{ eval: 18 }, { mate: 3 }, { mate: -2 }],
            players: { white: { user: { id: 'lui' }, rating: 1600, ratingDiff: 5, analysis: { inaccuracy: 1, mistake: 2, blunder: 3, acpl: 40, accuracy: 90 } }, black: { user: { id: 'moi' }, rating: 1550, ratingDiff: -5, analysis: { inaccuracy: 4, mistake: 5, blunder: 6, acpl: 92, accuracy: 77, phases: { opening: 73, middlegame: 71 } } } } }, 'moi');
        assert.deepStrictEqual([g.me0, g.me, g.opp0, g.opp], [1550, 1545, 1600, 1605]);
        assert.deepStrictEqual([g.start, g.end], [1700000000000, 'mate']);
        assert.deepStrictEqual([...g.tc], [300, 3]);
        assert.deepStrictEqual([...g.clk], [30003, 30003, 30100], 'une horloge par coup, sans la valeur finale');
        assert.deepStrictEqual([...g.err], [4, 5, 6, 92]);
        assert.deepStrictEqual([...g.oppErr], [1, 2, 3, 40]);
        assert.strictEqual(g.oppAccuracy, 90);
        assert.strictEqual(g.phases.opening, 73);
        assert.deepStrictEqual([...g.ev], [18, 9997, -9998]);
        assert.deepStrictEqual([...g.div], [25, 0]);
    });
    await t('Lichess : partie annulée ou jamais commencée écartée', () => {
        ['aborted', 'noStart', 'started', 'created'].forEach(status => assert.strictEqual(A.fromLichess({ ...LI, status }, 'moi'), null, status));
        assert.strictEqual(A.fromLichess({ ...LI, status: 'timeout' }, 'moi').end, 'abandon');
    });
    await t('Elo d\'avant : déduit de ma partie classée précédente, même site et cadence ; adversaire corrigé d\'autant', () => {
        const G2 = (at, me, extra) => ({ site: 'chesscom', user: 'moi', speed: 'blitz', rated: true, at, me, opp: 1500, ...extra });
        const l = A.withPreGame([G2(1, 1500), G2(2, 1508), G2(3, 1600), G2(4, 1610, { speed: 'rapid' }), G2(5, 1590, { me0: 1580, opp0: 1400 })]);
        assert.strictEqual(l[0].me0, undefined, 'première partie : rien à déduire');
        assert.deepStrictEqual([l[1].me0, l[1].opp0], [1500, 1508]);
        assert.strictEqual(l[2].me0, undefined, 'saut trop grand : ignoré');
        assert.strictEqual(l[3].me0, undefined, 'autre cadence');
        assert.deepStrictEqual([l[4].me0, l[4].opp0], [1580, 1400], 'Elo fourni par le site gardé');
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
    await t('archive d\'une version antérieure : signalée, retéléchargée et remplacée, sans doublon', async () => {
        assert.strictEqual(A.outdated([{ v: 1 }, { v: A.SCHEMA }]), true);
        assert.strictEqual(A.outdated([{}]), true, 'partie sans version');
        assert.strictEqual(A.outdated([{ v: A.SCHEMA }]), false);
        assert.strictEqual(await A.sync('chesscom', 'moi'), 0, 'déjà à jour : rien à réécrire');
    });
    await t('Lichess : lu en flux, progression pendant la réception, requête complète', async () => {
        let asked = '';
        const enc = new TextEncoder(), a = JSON.stringify({ ...LI, id: 'g1' }) + '\n', b = JSON.stringify({ ...LI, id: 'g2' }) + '\n';
        const chunks = [enc.encode(a + b.slice(0, 20)), enc.encode(b.slice(20))];
        ctx.fetch = async url => { asked = url; let i = 0; return { status: 200, ok: true, body: { getReader: () => ({ read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true } }) } }; };
        const seen = [];
        assert.strictEqual(await A.sync('lichess', 'Moi', n => seen.push(n)), 2);
        assert(/clocks=true/.test(asked) && /evals=true/.test(asked) && /division=true/.test(asked) && /accuracy=true/.test(asked));
        assert.strictEqual(seen[0], 1, 'la première partie est comptée dès son arrivée');
        assert.strictEqual(seen[seen.length - 1], 2);
        ctx.fetch = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ ...LI, id: 'g3' }) + '\n' });
        assert.strictEqual(await A.sync('lichess', 'Moi'), 1, 'sans flux : lecture entière');
    });
    await t('historique : Lichess remonte avant la plus ancienne partie, Chess.com avant son mois', async () => {
        let asked = '';
        ctx.fetch = async url => { asked = url; return { status: 200, ok: true, text: async () => JSON.stringify({ ...LI, id: 'vieux', createdAt: 1600000000000, lastMoveAt: 1600000000500 }) + '\n' }; };
        assert.strictEqual(await A.backfill('lichess', 'Moi'), 1);
        assert(/until=1700000500000|until=1700000499999/.test(asked), asked);
        const urls = [];
        ctx.fetch = async url => { urls.push(url);
            if (/archives$/.test(url)) return { status: 200, ok: true, json: async () => ({ archives: ['https://a/2023/10', 'https://a/2023/11', 'https://a/2023/12', 'https://a/2024/01'] }) };
            return { status: 200, ok: true, json: async () => ({ games: /2023\/10/.test(url) ? [{ ...CC, uuid: 'ancien', end_time: 1697000000 }] : [] }) };
        };
        assert.strictEqual(await A.backfill('chesscom', 'moi'), 1);
        assert(!urls.some(u => /2024\/01|2023\/12/.test(u)), 'mois plus récents que la plus ancienne partie : ignorés');
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
        assert.deepStrictEqual(JSON.parse(JSON.stringify(JSON.parse(mem.chessTrainer_eloLevels))), { chesscom: { blitz: { r: 1500, n: 2 } }, lichess: { bullet: { r: 1545, n: 4 } } });
        appSettings.eloSpeed = 'bullet';
        assert.strictEqual(A.level().speed, 'blitz');
        assert.strictEqual(A.level().r, 1500);
        appSettings.chesscomUser = ' ';
        assert.strictEqual(A.level(), null);
    });
    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
