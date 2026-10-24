// Lancer : node tests/training.test.js   — séances guidées de l'Entraînement (training.js), sans DOM
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const store = {}, navigations = [];
const db = { w: { kw: { move: 'e2e4', attempts: 4, failures: 3, path: ['e2e4'] } }, b: {} };
const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: { getElementById: () => null },
    dataStore: { getJSON: (k, d) => (k in store ? store[k] : d), setJSON: (k, v) => { store[k] = v; } },
    currentRepertoire: 'Général', gameMode: 'play', playerColor: 'w',
    readDBFor: (rep, c) => db[c],
    _level: e => (e.failures * 2 > e.attempts ? 'weak' : 'mastered'),
    goHome: tab => navigations.push(tab)
};
vm.createContext(ctx);
const f = 'js/modules/training/training.js';
vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: f });
const { trainingState } = ctx;

// Séance en cours, telle que startSession la laisse (sans écran de jeu).
const session = withResult => {
    ctx.gameMode = 'training';
    trainingState.lastSummary = null;
    trainingState.session = {
        kind: 'weak', label: 'Points faibles', returnTab: 'training', items: [{ color: 'w', key: 'kw', res: null }],
        i: 0, cur: 0, results: new Map(), line: null, colors: ['w'], started: Date.now(), end: 0, score: 0
    };
    if (withResult) trainingState.session.results.set('kw', { key: 'kw', color: 'w', ok: false, lvBefore: 'weak' });
};

t('écran de jeu quitté par le logo : séance close, bilan gardé, aucune navigation', () => {
    session(true);
    navigations.length = 0;
    ctx.abandonSession();
    assert.strictEqual(trainingState.session, null);
    assert.strictEqual(trainingState.lastSummary.early, true);
    assert.strictEqual(trainingState.lastSummary.total, 1);
    assert.deepStrictEqual(navigations, []);
});

t('écran de jeu quitté avant tout coup : séance close, pas de bilan', () => {
    session(false);
    ctx.abandonSession();
    assert.strictEqual(trainingState.session, null);
    assert.strictEqual(trainingState.lastSummary, null);
});

t('séance close : la profondeur max du mode libre s\'applique de nouveau', () => {
    ctx.trainingSettings.maxPlies = 4;
    session(false);
    assert.strictEqual(ctx._isEligible({ ply: 10 }), true);           // séance guidée : liste posée telle quelle
    ctx.abandonSession();
    assert.strictEqual(ctx._isEligible({ ply: 10 }), false);
    ctx.trainingSettings.maxPlies = 0;
});

t('« Quitter » en cours de séance : bilan puis retour à l\'onglet d\'origine', () => {
    session(true);
    navigations.length = 0;
    ctx.quitTraining();
    assert.strictEqual(trainingState.session, null);
    assert.strictEqual(trainingState.lastSummary.early, true);
    assert.deepStrictEqual(navigations, ['training']);
});

console.log(`\n${n} tests réussis.`);
