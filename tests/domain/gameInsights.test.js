// Lancer : node tests/domain/gameInsights.test.js   — calculs du bilan et du temps : tranches d'Elo, créneaux, sessions, fins de partie, records, horloges.
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ctx = { console, Date, Math, JSON, Number, Set, Map, Array };
vm.createContext(ctx);
vm.runInContext(readVars(scriptPath('openingReport.js')), ctx);
vm.runInContext(readVars(scriptPath('gameInsights.js')), ctx);
const I = ctx.GameInsights, R = ctx.OpeningReport;
const plain = v => JSON.parse(JSON.stringify(v));
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, `${a} ≠ ${b}`);
const MIN = 60e3, DAY = 864e5, T0 = new Date(2026, 9, 5, 18, 0, 0).getTime();     // un lundi
const game = (result, over = {}) => ({ result, me: 1500, opp: 1500, at: T0 + 5 * MIN, start: T0, color: 'w', rated: true, site: 'chesscom', speed: 'blitz', ...over });

t('écart d\'Elo : cinq tranches, de l\'adversaire le plus fort au plus faible, avec l\'Elo d\'avant', () => {
    const b = plain(I.byGap([game('w', { opp: 1700 }), game('l', { opp: 1600 }), game('d'), game('w', { opp: 1400 }), game('w', { opp: 1200 }), game('w', { me: 1520, opp: 1700, me0: 1500, opp0: 1650 })]));
    assert.deepStrictEqual(b.map(x => x.n), [2, 1, 1, 1, 1]);
    assert.strictEqual(b[1].score, 0);
});

t('créneaux : jour commençant lundi, tranche de 4 h ; meilleur et moins bon à 5 parties au moins', () => {
    const good = Array.from({ length: 5 }, () => game('w')), bad = Array.from({ length: 5 }, () => game('l', { start: T0 + DAY - 12 * 3600e3 })), rare = [game('w', { start: T0 + 2 * DAY })];
    const h = plain(I.heat([...good, ...bad, ...rare]));
    assert.strictEqual(h.grid[0][4].n, 5);
    assert.deepStrictEqual([h.best.day, h.best.slot, h.best.t.score], [0, 4, 100]);
    assert.deepStrictEqual([h.worst.day, h.worst.slot, h.worst.t.score], [1, 1, 0]);
    assert.strictEqual(h.grid[2][4].n, 1);
});

t('sessions : coupure après 30 min, rang plafonné à la cinquième, défaites d\'affilée dans la session', () => {
    const at = m => ({ start: T0 + m * MIN, at: T0 + (m + 5) * MIN });
    const s = plain(I.sessions([game('l', at(0)), game('l', at(10)), game('w', at(20)), game('w', at(30)), game('w', at(40)), game('w', at(50)), game('w', at(120))]));
    assert.strictEqual(s.count, 2);
    assert.deepStrictEqual(s.ranks.map(x => x.n), [2, 1, 1, 1, 2]);
    assert.deepStrictEqual(s.after.map(x => x.n), [1, 1, 0]);
    assert.strictEqual(s.after[1].score, 100);
});

t('fins de partie : part des gains et des défaites, nulles à part, partie sans fin connue ignorée', () => {
    const e = plain(I.ends([game('w', { end: 'time' }), game('w', { end: 'mate' }), game('l', { end: 'resign' }), game('d', { end: 'draw' }), game('w')]));
    assert.strictEqual(e.wins.n, 2); assert.strictEqual(e.wins.time, 50); assert.strictEqual(e.losses.resign, 100); assert.strictEqual(e.draws, 1);
});

t('records : meilleur Elo, plus longue série, plus forte baisse depuis un sommet', () => {
    const r = plain(I.records([game('w', { at: 1, me: 1500 }), game('w', { at: 2, me: 1560 }), game('l', { at: 3, me: 1480 }), game('w', { at: 4, me: 1490 }), game('w', { at: 5, me: 1500 }), game('w', { at: 6, me: 1510 }), game('w', { at: 7, me: 1520, rated: false })]));
    assert.deepStrictEqual([r.best, r.bestAt, r.streak, r.drop], [1560, 2, 3, 80]);
    assert.strictEqual(I.records([]), null);
});

t('volume : Elo gagné dans le mois depuis l\'Elo d\'avant ; comparaison à quatre mois au moins', () => {
    const now = new Date(2026, 10, 15).getTime(), m = (mo, day, me, over) => game('w', { at: new Date(2026, mo, day).getTime(), me, ...over });
    const few = plain(I.volume([m(9, 2, 1500, { me0: 1490 }), m(9, 3, 1520)], 3, now));
    assert.deepStrictEqual(few.months.map(x => x.n), [0, 2, 0]);
    assert.strictEqual(few.months[1].delta, 30);
    assert.strictEqual(few.high, null);
    const list = [], add = (mo, count, gain) => { for (let i = 0; i < count; i++) list.push(m(mo, i + 1, 1500 + gain * i / (count - 1))); };
    add(7, 10, 50); add(8, 10, 30); add(9, 5, -10); add(10, 5, 0);
    const v = plain(I.volume(list, 4, now));
    near(v.high, 40); near(v.low, -5);
});

const clocked = (result, clk, over = {}) => game(result, { tc: [100, 0], clk, ...over });

t('avance à l\'horloge : dernier coup de chacun dans les demi-coups, part du temps initial, null sans horloge', () => {
    const g = clocked('w', [9000, 8000, 7000, 5000]);
    near(R.clockLead(g, 4), 20);
    near(R.clockLead(g, 3), -10);
    near(R.clockLead({ ...g, color: 'b' }, 4), -20);
    assert.strictEqual(R.clockLead(game('w'), 4), null);
    assert.strictEqual(R.clockLead(g, 1), null);
});

t('courbe : temps moyen en %, moi et l\'adversaire, coups atteints par assez de parties seulement', () => {
    const long = clocked('w', [9000, 8000, 7000, 6000, 5000, 4000]), list = [long, long, long, clocked('w', [9000, 8000])];
    const c = plain(I.timeCurve(list));
    assert.strictEqual(c.games, 4);
    assert.deepStrictEqual(c.points.map(p => p.move), [1, 2, 3]);
    near(c.points[1].me, 70); near(c.points[1].opp, 60);
    assert.strictEqual(I.timeCurve([game('w')]).points.length, 0, 'sans horloge : rien');
});

t('zeitnot : coups sous 10 % du temps, moi et l\'adversaire, score avec ou sans', () => {
    const z = plain(I.zeitnot([clocked('l', [5000, 5000, 900, 5000]), clocked('w', [5000, 800, 5000, 700])]));
    assert.strictEqual(z.share, 25);
    assert.strictEqual(z.oppShare, 50);
    assert.deepStrictEqual([z.withIt.n, z.withIt.score, z.without.n, z.without.score], [1, 0, 1, 100]);
});

t('coup 20 : cinq tranches selon l\'avance, partie trop courte ignorée', () => {
    const clk = (me, opp) => { const a = new Array(40).fill(5000); a[38] = me; a[39] = opp; return a; };
    const l = plain(I.leadAtMove([clocked('l', clk(1000, 5000)), clocked('w', clk(5000, 1000)), clocked('d', clk(5000, 5000)), clocked('w', [1, 2])]));
    assert.deepStrictEqual(l.map(x => x.n), [1, 0, 1, 0, 1]);
});

t('sortie du répertoire : avance moyenne et score selon l\'avance', () => {
    const e = plain(I.exitClock([{ g: clocked('w', [9000, 7000]), a: { path: ['a', 'b'] } }, { g: clocked('l', [7000, 9000, 5000, 7000]), a: { path: ['a', 'b', 'c', 'd'] } }, { g: game('w'), a: { path: ['a', 'b'] } }]));
    assert.strictEqual(e.n, 2);
    near(e.lead, 0);
    assert.strictEqual(e.ahead.score, 100);
    assert.strictEqual(e.behind.score, 0);
});

t('premier coup hors répertoire : temps passé, incrément compris, comparé au rythme suivant', () => {
    const inc = over => clocked('w', [10000, 10000, 9000, 10000, 8000, 10000, 7900, 10000, 7800, 10000, 7700], { tc: [100, 1], ...over });
    const r = { g: inc(), a: { dev: { by: 'me', ply: 2 } } };
    const th = plain(I.thinking([r]));
    assert.strictEqual(th.n, 1);
    near(th.first, 11);
    assert.deepStrictEqual([th.thought.n, th.quick.n], [1, 0]);
    near(th.usual, (11 + 2 + 2 + 2) / 4);
    assert.strictEqual(I.thinking([{ g: game('w'), a: { dev: { by: 'me', ply: 2 } } }]).n, 0);
    assert.strictEqual(I.thinking([{ g: inc(), a: { dev: null } }]).n, 0, 'jamais sorti du répertoire');
    const opp = plain(I.thinking([{ g: inc({ color: 'w' }), a: { dev: { by: 'opp', ply: 1 } } }]));
    assert.strictEqual(opp.n, 1, 'sortie de l\'adversaire : mon coup suivant');
});

console.log(`\n${n} tests réussis.`);
