// Lancer : node tests/analysisMarks.test.js   — Analyse, brouillon annoté : marques de l'arbre (analysisMarks),
// compteur du bouton « Ajouter au répertoire (N) » et aperçu de fusion qui n'écrit rien avant la confirmation.
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const jeq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

const actions = {}, timers = [];
const ctx = {
    console, registerActions: o => Object.assign(actions, o),
    document: { addEventListener() {}, getElementById: () => null, hidden: false },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    ico: name => `<svg class="ico"><use href="#i-${name}"/></svg>`
};
vm.createContext(ctx);
for (const f of ['js/core/chessEngine.js', 'js/core/engine.js', 'js/modules/analysis/analysis.js'])
    vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: f });
const run = s => vm.runInContext(s, ctx);
const key = path => run(`Chess.key(Chess.replay(${JSON.stringify(path)}))`);
const marks = (lines, color, db, replace = []) => run('(l, c, d, r) => analysisMarks(l, c, d, new Set(r))')(lines, color, db, replace);
const plan = (lines, color, db, replace = []) => run('(l, c, d, r) => analysisMergePlan(l, c, d, new Set(r))')(lines, color, db, replace);
const writes = p => p.items.filter(i => i.status === 'new' || i.status === 'replace').length;

// Brouillon des Noirs : 1. e4 c5 2. Cf3 d6 3. d4, et la variante 2. Cc3 Cc6.
const MAIN = ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4'];
const VAR  = ['e2e4', 'c7c5', 'b1c3', 'b8c6'];
const j = p => p.join(',');

t('marques : nouveau, connu, conflit gardé ; coups adverses jamais marqués', () => {
    const db = { [key(['e2e4'])]: { move: 'c7c5', san: 'c5' }, [key(['e2e4', 'c7c5', 'b1c3'])]: { move: 'e7e6', san: 'e6' } };
    const m = marks([MAIN, VAR], 'b', db);
    assert.strictEqual(m[j(MAIN.slice(0, 2))], 'same');
    assert.strictEqual(m[j(MAIN.slice(0, 4))], 'new');
    assert.strictEqual(m[j(VAR)], 'conflict');
    // e4, Cf3, d4, Cc3 : coups des Blancs, adverses ici
    [1, 3, 5].forEach(i => assert.strictEqual(m[j(MAIN.slice(0, i))], undefined, `coup adverse ${MAIN[i - 1]} marqué`));
    assert.strictEqual(m[j(VAR.slice(0, 3))], undefined);
    jeq(Object.values(m).sort(), ['conflict', 'new', 'same']);
});

t('marques : « Remplacer » coché donne « à remplacer » et la ligne continue', () => {
    const k = key(['e2e4', 'c7c5', 'g1f3']);
    const db = { [k]: { move: 'b8c6', san: 'Nc6' } };
    const line = MAIN.concat(['c5d4', 'f3d4', 'g8f6']);
    const kept = marks([line], 'b', db);
    assert.strictEqual(kept[j(line.slice(0, 4))], 'conflict');
    assert.strictEqual(kept[j(line)], undefined, 'au-delà d\'un conflit gardé : rien n\'est fusionné, pas de marque');
    const m = marks([line], 'b', db, [k]);
    assert.strictEqual(m[j(line.slice(0, 4))], 'replace');
    assert.strictEqual(m[j(line)], 'new');
});

t('marques : deux coups différents à mon trait dans la même position, seul le premier est marqué', () => {
    const m = marks([['e2e4', 'e7e5'], ['e2e4', 'c7c5']], 'b', {});
    assert.strictEqual(m['e2e4,e7e5'], 'new');
    assert.strictEqual(m['e2e4,c7c5'], undefined);
});

t('marques des Blancs : mes coups seulement', () => {
    const m = marks([MAIN], 'w', { [key([])]: { move: 'e2e4', san: 'e4' } });
    jeq(Object.keys(m), ['e2e4', 'e2e4,c7c5,g1f3', 'e2e4,c7c5,g1f3,d7d6,d2d4']);
    jeq(Object.values(m), ['same', 'new', 'new']);
});

t('compteur du bouton = écritures du plan ; désactivé avec « Rien à ajouter » quand le plan est vide', () => {
    const db = { [key(['e2e4', 'c7c5', 'b1c3'])]: { move: 'e7e6', san: 'e6' } };
    const p = plan([MAIN, VAR], 'b', db), s = run('analysisPlanSummary')(p, {});
    assert.strictEqual(s.writes, writes(p));
    assert.strictEqual(s.writes, 2);
    jeq([s.fresh, s.conflict, s.replace, s.same, s.opp], [2, 1, 0, 0, 4]);
    const html = run('_anAddHTML')(s);
    assert.match(html, /class="ab-count"[^>]*>2</);
    assert.doesNotMatch(html, /disabled/);

    const r = plan([MAIN, VAR], 'b', db, [key(['e2e4', 'c7c5', 'b1c3'])]), rs = run('analysisPlanSummary')(r, {});
    assert.strictEqual(rs.writes, writes(r));
    assert.strictEqual(rs.writes, 3, 'un remplacement compte comme une écriture');

    const known = { [key(['e2e4'])]: { move: 'c7c5', san: 'c5' }, [key(['e2e4', 'c7c5', 'g1f3'])]: { move: 'd7d6', san: 'd6' } };
    const e = plan([MAIN], 'b', known), es = run('analysisPlanSummary')(e, {});
    assert.strictEqual(es.writes, 0);
    const off = run('_anAddHTML')(es);
    assert.match(off, / disabled/);
    assert.match(off, /title="Rien à ajouter"/);
    assert.doesNotMatch(off, /ab-count/);
    // Réponses adverses déjà repérées : pas comptées de nouveau
    assert.strictEqual(run('analysisPlanSummary')(e, { [key([])]: ['e2e4'] }).opp, 2);
});

t('aperçu de fusion : la base est identique avant et après l\'ouverture, rien n\'est écrit avant la confirmation', async () => {
    const db = { [key(['e2e4'])]: { move: 'c7c5', san: 'c5' }, [key(['e2e4', 'c7c5', 'b1c3'])]: { move: 'e7e6', san: 'e6' } };
    const writesDone = [];
    Object.assign(ctx, {
        gameMode: 'analysis', openingDB: db, oppSeen: {}, moveHistory: [], navCursor: -1,
        appSettings: { engineLines: 3, engineDepth: 30, engineTime: 0, cloudEval: false },
        setStatus() {}, saveDB: () => writesDone.push('db'), saveOpp: () => writesDone.push('opp'), noteChange() {},
        sessionStorage: { setItem() {}, getItem: () => null, removeItem() {} },
        trashEntries: keys => { writesDone.push('trash:' + keys.length); return true; },
        recordOppReply: (k, u) => { (ctx.oppSeen[k] = ctx.oppSeen[k] || []).push(u); return true; },
        newEntry: (move, san, path) => ({ move, san, path }), moveToStr: () => '',
        formatSan: s => s, formatSanText: s => s
    });
    run('var _pathToSans = p => { let pos = Chess.start(); return p.map(u => { const s = Chess.san(pos, u); pos = Chess.play(pos, u); return s; }); }');
    run('analysis.color = "b"; analysis.rep = "Sicilienne"; analysis.tree = { kids: [] }; analysis.lastMerge = null');
    run(`_anInsert(${JSON.stringify(MAIN)}); _anInsert(${JSON.stringify(VAR)})`);
    const before = JSON.stringify(db);
    actions.analysisOpenMerge();
    assert.ok(run('analysis.merge && analysis.merge.all'), 'aperçu ouvert sur toutes les branches');
    actions.analysisToggleReplace(key(['e2e4', 'c7c5', 'b1c3']));
    actions.analysisMergeScope('line');
    actions.analysisMergeScope('all');
    assert.ok(run('_anPreviewHTML()').includes('Ajouter 2 coups'));
    assert.strictEqual(JSON.stringify(db), before, 'aperçu ouvert : base inchangée');
    jeq(writesDone, []);
    actions.analysisCloseMerge();
    assert.strictEqual(JSON.stringify(db), before, 'aperçu fermé : base inchangée');

    actions.analysisOpenConflict(key(['e2e4', 'c7c5', 'b1c3']));
    assert.strictEqual(run('analysis.merge.focus'), key(['e2e4', 'c7c5', 'b1c3']), 'losange ambre : aperçu ouvert sur ce conflit');
    actions.analysisConfirmMerge();
    assert.ok(run('analysis.merging'), 'fusion en cours');
    assert.strictEqual(JSON.stringify(db), before, 'écriture différée d\'une image (aria-busy)');
    timers.splice(0).forEach(fn => fn());
    assert.ok(db[key(['e2e4', 'c7c5', 'g1f3'])], 'coup nouveau écrit après confirmation');
    assert.strictEqual(db[key(['e2e4', 'c7c5', 'b1c3'])].move, 'e7e6', 'conflit non remplacé : coup gardé');
    jeq(writesDone, ['db', 'opp']);
    assert.strictEqual(run('analysis.lastMerge.added.length'), 1);
});

(async () => {
    for (const [name, fn] of tests) { await fn(); n++; console.log('ok  ', name); }
    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
