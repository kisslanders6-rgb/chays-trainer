// Lancer : node tests/domain/openingReport.test.js   — calculs de la fiche d'ouverture : score attendu, points perdus, performance, couverture, diagnostic.
const { scriptPath, readVars } = require('../_app.js');
const vm = require('vm'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ctx = { console, Date, Math, JSON, Number, Set, Map };
vm.createContext(ctx);
vm.runInContext(readVars(scriptPath('openingReport.js')), ctx);
const R = ctx.OpeningReport;
const plain = v => JSON.parse(JSON.stringify(v));
const game = (result, over = {}) => ({ result, me: 1500, opp: 1500, at: Date.UTC(2026, 9, 15), color: 'w', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], ...over });
const near = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

t('Elo égaux : 50 % attendus ; 400 points d\'écart : 10 contre 1', () => {
    near(R.expected(1500, 1500), .5);
    near(R.expected(1900, 1500), 10 / 11);
});

t('résumé : score, écart à l\'attendu et points perdus', () => {
    const s = R.summarize([game('l'), game('l'), game('d'), game('w')]);
    assert.deepStrictEqual([s.n, s.w, s.d, s.l], [4, 1, 1, 2]);
    near(s.score, 37.5); near(s.expected, 50); near(s.delta, -12.5); near(s.lost, .5);
});

t('performance : Elo moyen des adversaires à 50 %, bornée à 95 %, absente sous 3 parties', () => {
    assert.strictEqual(R.summarize([game('w'), game('l'), game('d'), game('d')]).perf, 1500);
    assert.strictEqual(R.summarize([game('w'), game('w'), game('w')]).perf, Math.round(1500 + 400 * Math.log10(19)));
    assert.strictEqual(R.summarize([game('w'), game('w')]).perf, null);
});

t('Elo inconnu : compté au score, jamais à l\'attendu', () => {
    const s = R.summarize([game('w', { opp: undefined })]);
    assert.strictEqual(s.score, 100);
    assert.strictEqual(s.expected, null);
    assert.strictEqual(s.delta, null);
    assert.strictEqual(s.lost, 0);
});

t('mois : autant de cases que demandé, le plus ancien d\'abord, mois vides compris', () => {
    const now = Date.UTC(2026, 10, 9, 12), list = [game('w', { at: Date.UTC(2026, 10, 2, 12) }), game('l', { at: Date.UTC(2026, 8, 12, 12) })];
    const m = plain(R.months(list, 3, now));
    assert.deepStrictEqual(m.map(x => x.n), [1, 0, 1]);
    assert.strictEqual(m[0].score, 0);
    assert.strictEqual(m[2].score, 100);
});

const row = (result, dev, path = ['e2e4', 'e7e5', 'g1f3', 'b8c6'], played = null) => ({ g: game(result), a: { dev, path, played } });

t('détail : suivi, couverture ; une fin de ligne préparée n\'est pas une réponse manquante', () => {
    const d = R.detail([
        row('w', null),
        row('l', { by: 'me', ply: 2, key: 'K', expected: { uci: 'g1f3', san: 'Nf3' } }, ['e2e4', 'e7e5'], { uci: 'b1c3', san: 'Nc3' }),
        row('l', { by: 'opp', ply: 3, endOfLine: false }),
        row('d', { by: 'opp', ply: 3, endOfLine: true })
    ]);
    assert.strictEqual(d.followed, 75);
    assert.strictEqual(d.coverage, 75);
    assert.deepStrictEqual(plain(d.hist), { 2: { me: 2 - 1, gap: 1 } });
    near(d.left.score, 0);
    assert.strictEqual(d.swaps.length, 1);
    assert.deepStrictEqual([d.swaps[0].played, d.swaps[0].expected, d.swaps[0].n], ['Nc3', 'Nf3', 1]);
});

t('réponses adverses : seuls les coups de l\'adversaire, part calculée à la position, état de la dernière sortie', () => {
    const d = R.detail([
        row('w', null),
        row('w', null),
        row('l', { by: 'opp', ply: 1, endOfLine: false }, ['e2e4', 'c7c5'])
    ]);
    const sans = plain(d.replies).map(r => [r.uci, r.n, Math.round(r.share), r.state]);
    assert.deepStrictEqual(sans, [['e7e5', 2, 67, 'covered'], ['b8c6', 2, 100, 'covered'], ['c7c5', 1, 33, 'missing']]);
    assert.strictEqual(R.detail([row('w', null)], 2).replies.length, 1, 'minPly écarte les coups de la ligne qui nomme l\'ouverture');
});

t('diagnostic : quatre verdicts, aucun sans assez de parties, d\'Elo ou de maîtrise', () => {
    assert.strictEqual(R.diagnose(10, -2, 40), 'learn');
    assert.strictEqual(R.diagnose(10, 2, 40), 'consolidate');
    assert.strictEqual(R.diagnose(10, -4, 80), 'losing');
    assert.strictEqual(R.diagnose(10, -2, 80), 'keep');
    assert.strictEqual(R.diagnose(4, -9, 40), null);
    assert.strictEqual(R.diagnose(10, null, 40), null);
    assert.strictEqual(R.diagnose(10, -9, null), null);
});

console.log(`\n${n} tests réussis.`);
