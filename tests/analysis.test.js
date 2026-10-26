// Lancer : node tests/analysis.test.js   — mode Analyse : plan de fusion du brouillon (analysis.js) et lecture
// des lignes UCI du moteur (engine.js), sans DOM ni Worker
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const jeq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

const ctx = { console, registerActions() {}, document: { addEventListener() {} } };
vm.createContext(ctx);
for (const f of ['js/core/chessEngine.js', 'js/core/engine.js', 'js/modules/analysis/analysis.js'])
    vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: f });
const run = s => vm.runInContext(s, ctx);
const key = path => run(`Chess.key(Chess.replay(${JSON.stringify(path)}))`);
const plan = (lines, color, db, replace = []) => run('(l, c, d, r) => analysisMergePlan(l, c, d, new Set(r))')(lines, color, db, replace);

const LINE = ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4'];

t('fusion : mes coups nouveaux, coup déjà connu, coups adverses notés', () => {
    const db = { [key([])]: { move: 'e2e4', san: 'e4' } };
    const p = plan([LINE], 'w', db);
    jeq(p.items.map(i => i.san + ':' + i.status), ['e4:same', 'Nf3:new', 'd4:new']);
    jeq(p.items[2].path, LINE);
    jeq(p.opp.map(o => o[1]), ['c7c5', 'd7d6']);
});

t('conflit : la réponse existante est gardée et la ligne s\'arrête', () => {
    const db = { [key([])]: { move: 'e2e4', san: 'e4' }, [key(['e2e4', 'c7c5'])]: { move: 'b1c3', san: 'Nc3' } };
    const p = plan([LINE], 'w', db);
    jeq(p.items.map(i => i.san + ':' + i.status), ['e4:same', 'Nf3:conflict']);
    assert.strictEqual(p.items[1].keptSan, 'Nc3');
});

t('conflit avec « Remplacer » : la ligne continue', () => {
    const db = { [key(['e2e4', 'c7c5'])]: { move: 'b1c3', san: 'Nc3' } };
    const p = plan([LINE], 'w', db, [key(['e2e4', 'c7c5'])]);
    jeq(p.items.map(i => i.san + ':' + i.status), ['e4:new', 'Nf3:replace', 'd4:new']);
});

t('toutes les branches : positions communes une seule fois, Noirs', () => {
    const p = plan([LINE, ['e2e4', 'c7c5', 'b1c3', 'b8c6']], 'b', {});
    jeq(p.items.map(i => i.san), ['c5', 'd6', 'Nc6']);
});

t('lignes UCI : score et WDL ramenés au point de vue des Blancs, bornes ignorées', () => {
    const parse = run('Engine._parseInfo');
    const l = parse('info depth 20 seldepth 28 multipv 2 score cp 35 wdl 400 500 100 nodes 900 nps 5000 pv e7e5 g1f3', false);
    jeq([l.depth, l.multipv, l.score, l.wdl, l.pv], [20, 2, { cp: -35 }, [100, 500, 400], ['e7e5', 'g1f3']]);
    jeq(parse('info depth 9 score mate 3 pv h5f7', true).score, { mate: 3 });
    assert.strictEqual(parse('info depth 9 score cp 10 lowerbound pv e2e4', true), null);
    assert.strictEqual(parse('info string NNUE evaluation enabled', true), null);
});

console.log(`\n${n} tests réussis.`);
