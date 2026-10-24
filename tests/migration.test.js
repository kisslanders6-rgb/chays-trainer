// Lancer : node tests/migration.test.js   — conversion des clés de position de l'ancien format (storage.js), sans DOM
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const store = {};
const ctx = {
    console, renderMoves() {}, renderBoard() {}, clearErrorFx() {}, resetNavCursor() {}, registerActions() {}, reportError() {},
    dataStore: { getJSON: (k, d) => (k in store ? JSON.parse(store[k]) : d), setJSON: (k, v) => { store[k] = JSON.stringify(v); return true; },
                 get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = String(v); return true; }, remove: k => { delete store[k]; return true; } }
};
vm.createContext(ctx);
for (const f of ['js/core/chessEngine.js', 'js/storage.js', 'js/modules/openings/openingsLogic.js'])
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
const run = code => vm.runInContext(code, ctx);
run("var playerColor = 'w';");

// Clés (ancien et nouveau format) des positions d'un chemin UCI : avant chaque coup, puis à la fin.
const keysOf = path => run(`(p => _withEngineSnapshot(() => { parseFEN(INIT_FEN); const out = [positionKey()];
    p.forEach(u => { _applyUciRaw(u); out.push(positionKey()); }); return out; }))`)(path);
const legacy = k => k.split(' ').slice(0, 2).join(' ');

// 1.e4 d5 2.e5 f5 : la prise en passant exf6 est jouable → la clé exacte porte « f6 ».
const EP = ['e2e4', 'd7d5', 'e4e5', 'f7f5', 'e5f6'];
// Le roi blanc part puis revient : mêmes pièces qu'au départ, mais plus de roque blanc.
const KING = ['e2e4', 'e7e5', 'e1e2', 'b8c6', 'e2e1', 'g8f6', 'g1f3'];

t('base : clé exacte retrouvée par le chemin (passant, roque perdu)', () => {
    const kEP = keysOf(EP), kK = keysOf(KING);
    assert.strictEqual(kEP[4].split(' ')[3], 'f6');
    assert.strictEqual(kK[6].split(' ')[2], 'kq');
    const db = {
        [legacy(kEP[4])]: { move: 'e5f6', san: 'exf6', attempts: 3, failures: 1, path: EP },
        [legacy(kK[6])]:  { move: 'g1f3', san: 'Nf3', attempts: 1, failures: 0, path: KING },
        [legacy(kEP[0])]: { move: 'e2e4', san: 'e4', attempts: 9, failures: 0 }                     // sans chemin
    };
    store.openingDB_Test_w = JSON.stringify(db);
    const up = run('readDBFor')('Test', 'w');
    assert.deepStrictEqual(Object.keys(up).sort(), [kEP[0], kEP[4], kK[6]].sort());
    assert.strictEqual(up[kEP[4]].attempts, 3);
});

t('base : une entrée déjà au nouveau format l\'emporte sur un doublon ancien', () => {
    const k = keysOf(['e2e4'])[0];
    store.openingDB_Test_w = JSON.stringify({ [k]: { move: 'd2d4', attempts: 1, failures: 0 }, [legacy(k)]: { move: 'e2e4', attempts: 5, failures: 0, lastReviewed: Date.now() } });
    const up = run('readDBFor')('Test', 'w');
    assert.deepStrictEqual(Object.keys(up), [k]);
    assert.strictEqual(up[k].move, 'd2d4');
});

t('réponses adverses : clé exacte retrouvée par le chemin de mon coup', () => {
    const kEP = keysOf(EP);
    store.openingDB_Test_w  = JSON.stringify({ [legacy(kEP[4])]: { move: 'e5f6', attempts: 1, failures: 0, path: EP } });
    store.openingOpp_Test_w = JSON.stringify({ [legacy(kEP[5])]: ['g7f6'] });
    const opp = run('readOppFor')('Test', 'w');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(opp)), { [kEP[5]]: ['g7f6'] });
});

t('migration au démarrage : bases réécrites, SAN recalculés, une seule fois', () => {
    Object.keys(store).forEach(k => delete store[k]);
    store.chessTrainer_repertoires = JSON.stringify(['Général']);
    const path = ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'b1d2'];
    const ks = keysOf(path);
    store['openingDB_Général_w'] = JSON.stringify({ [legacy(ks[4])]: { move: 'b1d2', san: 'Nd2', attempts: 1, failures: 0, path } });
    run('migrateStoredData')();
    const db = JSON.parse(store['openingDB_Général_w']);
    assert.deepStrictEqual(Object.keys(db), [ks[4]]);
    assert.strictEqual(db[ks[4]].san, 'Nbd2');
    assert.strictEqual(store.chessTrainer_dataVersion, '2');
    store['openingDB_Général_w'] = '{}';
    run('migrateStoredData')();
    assert.strictEqual(store['openingDB_Général_w'], '{}', 'deuxième passage : rien ne change');
});

console.log(`\n${n} tests réussis.`);
