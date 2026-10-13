// Lancer : node tests/syncModel.test.js
const assert = require('assert');
const { SyncModel: S } = require('../js/core/syncModel.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const E = (move, a, f, extra = {}) => Object.assign({ move, san: move, attempts: a, failures: f }, extra);
const DB = 'openingDB_Général_w', OPP = 'openingOpp_Général_w';

t('portée : clés synchronisées vs locales', () => {
    ['chessTrainer_repertoires', 'chessTrainer_trash', 'chessTrainer_endgames', DB, OPP].forEach(k => assert(S.isSynced(k), k));
    ['chessTrainer_theme', 'chessTrainer_settings', 'chessTrainer_backupState', 'chessTrainer_backupNag',
     'chessTrainer.trainingSettings'].forEach(k => assert(!S.isSynced(k), k));
});

t('compteurs : base + delta local + delta distant', () => {
    const r = S.merge(DB, { p: E('e2e4', 3, 1) }, { p: E('e2e4', 5, 1) }, { p: E('e2e4', 4, 2) });
    assert.strictEqual(r.p.attempts, 6); assert.strictEqual(r.p.failures, 2);
});
t('un seul côté a changé → ce côté', () => {
    const b = { p: E('e2e4', 3, 1) };
    assert.deepStrictEqual(S.merge(DB, b, b, { p: E('e2e4', 9, 2) }), { p: E('e2e4', 9, 2) });
    assert.deepStrictEqual(S.merge(DB, b, { p: E('e2e4', 9, 2) }, b), { p: E('e2e4', 9, 2) });
});
t('suppression propagée (base présente, local supprimé, distant inchangé)', () => {
    const b = { p: E('e2e4', 3, 1), q: E('d2d4', 1, 0) };
    assert.deepStrictEqual(S.merge(DB, b, { q: b.q }, b), { q: b.q });
});
t('suppression d\'un côté + modification de l\'autre → la modification gagne', () => {
    const b = { p: E('e2e4', 3, 1) };
    assert.deepStrictEqual(S.merge(DB, b, {}, { p: E('e2e4', 4, 1) }), { p: E('e2e4', 4, 1) });
});
t('réponse remplacée d\'un côté : le remplacement gagne sur les compteurs', () => {
    const b = { p: E('e2e4', 10, 3) };
    const r = S.merge(DB, b, { p: E('d2d4', 1, 0, { lastReviewed: 50 }) }, { p: E('e2e4', 12, 3) });
    assert.strictEqual(r.p.move, 'd2d4'); assert.strictEqual(r.p.attempts, 1);
});
t('remplacée des deux côtés : la plus récente, égalité déterministe', () => {
    const l = E('d2d4', 1, 0, { lastReviewed: 100 }), r = E('c2c4', 1, 0, { lastReviewed: 200 });
    assert.strictEqual(S.merge(DB, { p: E('e2e4', 5, 1) }, { p: l }, { p: r }).p.move, 'c2c4');
    const x = E('d2d4', 1, 0, { lastReviewed: 5 }), y = E('c2c4', 1, 0, { lastReviewed: 5 });
    assert.strictEqual(S.merge(DB, null, { p: x }, { p: y }).p.move, S.merge(DB, null, { p: y }, { p: x }).p.move);
});
t('ajoutée indépendamment, même coup : compteurs additionnés ; lastReviewed = max', () => {
    const r = S.merge(DB, null, { p: E('e2e4', 1, 0, { lastReviewed: 10 }) }, { p: E('e2e4', 2, 1, { lastReviewed: 30 }) });
    assert.strictEqual(r.p.attempts, 3); assert.strictEqual(r.p.failures, 1); assert.strictEqual(r.p.lastReviewed, 30);
});
t('failures ne dépasse jamais attempts', () => {
    const r = S.merge(DB, { p: E('e2e4', 4, 0) }, { p: E('e2e4', 4, 4) }, { p: E('e2e4', 4, 4) });
    assert(r.p.failures <= r.p.attempts);
});

t('réponses adverses : ajouts des deux côtés, suppression propagée', () => {
    const b = { k: ['e7e5', 'c7c5'] };
    const r = S.merge(OPP, b, { k: ['e7e5', 'e7e6'] }, { k: ['e7e5', 'c7c5', 'g8f6'] });
    assert.deepStrictEqual(r.k.slice().sort(), ['e7e5', 'e7e6', 'g8f6']);          // c7c5 supprimé en local
});
t('réponses adverses : liste vidée → clé supprimée', () => {
    assert.deepStrictEqual(S.merge(OPP, { k: ['a'] }, { k: [] }, { k: ['a'], z: ['b'] }), { z: ['b'] });
});

t('répertoires : ajouts croisés + suppression', () => {
    const r = S.merge('chessTrainer_repertoires', ['Général', 'A'], ['Général', 'B'], ['Général', 'A', 'C']);
    assert.deepStrictEqual(r, ['Général', 'B', 'C']);                                // A supprimé en local
});

t('corbeille : union, suppression définitive propagée, restauration partielle', () => {
    const it = (id, c, d = 1) => ({ id, deletedAt: d, count: c, type: 'branch', data: {} });
    const b = [it('a', 3, 5), it('b', 1, 4)];
    const r = S.merge('chessTrainer_trash', b, [it('a', 1, 5), it('n', 2, 9)], [it('a', 3, 5), it('b', 1, 4), it('m', 1, 8)]);
    assert.deepStrictEqual(r.map(x => x.id), ['n', 'm', 'a']);                       // b supprimé en local ; tri récent→ancien
    assert.strictEqual(r.find(x => x.id === 'a').count, 1);                          // partielle locale conservée
});

t('finales : tries/wins additionnés, perfect OU, best minimum', () => {
    const P = (tries, wins, perfect, best, last) => ({ tries, wins, perfect, best, last });
    const r = S.merge('chessTrainer_endgames', { x: P(2, 1, false, 9, 1) },
        { x: P(3, 2, false, 7, 5), y: P(1, 0, false, 0, 2) }, { x: P(4, 1, true, 8, 9) });
    assert.deepStrictEqual(r.x, P(5, 2, true, 7, 9)); assert.ok(r.y);
});

t('mergeRaw : JSON invalide traité comme absent, résultat chaîne', () => {
    assert.strictEqual(S.mergeRaw('chessTrainer_repertoires', null, '{cassé', '["Général"]'), '["Général"]');
    assert.strictEqual(S.mergeRaw(DB, null, null, null), null);
});

// ─── Propriétés : symétrie, idempotence, convergence (tirages aléatoires reproductibles) ──
let seed = 12345; const rnd = m => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
const pick = a => a[rnd(a.length)];
const gen = {
    entry: () => { const a = rnd(6); return E(pick(['e2e4', 'd2d4', 'c2c4']), a, rnd(a + 1), rnd(2) ? { lastReviewed: rnd(5) + 1 } : {}); },
    db:    () => { const o = {}; ['p', 'q', 'r'].forEach(k => { if (rnd(3)) o[k] = gen.entry(); }); return o; },
    opp:   () => { const o = {}; ['k', 'm'].forEach(k => { const l = ['a', 'b', 'c', 'd'].filter(() => rnd(2)); if (l.length) o[k] = l; }); return o; },
    list:  () => ['Général', 'A', 'B', 'C'].filter((x, i) => i === 0 || rnd(2)),
    trash: () => ['a', 'b', 'c'].filter(() => rnd(2)).map(id => ({ id, deletedAt: rnd(9), count: rnd(4) + 1, type: 'branch', data: {} })),
    endgames: () => { const o = {}; ['x', 'y'].forEach(k => { if (rnd(2)) o[k] = { tries: rnd(5), wins: rnd(3), perfect: !!rnd(2), best: rnd(8), last: rnd(9) }; }); return o; }
};
const keyOf = { db: DB, opp: OPP, list: 'chessTrainer_repertoires', trash: 'chessTrainer_trash', endgames: 'chessTrainer_endgames' };
Object.keys(keyOf).forEach(kind => t(`propriétés (${kind}) : symétrie, idempotence, convergence × 400`, () => {
    const key = keyOf[kind];
    for (let i = 0; i < 400; i++) {
        const b = rnd(5) ? gen[kind]() : null, l = gen[kind](), r = gen[kind]();
        const m1 = S.merge(key, b, l, r), m2 = S.merge(key, b, r, l);
        assert(S.same(m1, m2), `asymétrique ${kind}: ${JSON.stringify({ b, l, r })}`);
        assert(S.same(S.merge(key, m1, m1, m1), m1), 'idempotence');
        assert(S.same(S.merge(key, b, l, l), l), 'merge(b,l,l)=l');
        // Les deux appareils repartent de la valeur fusionnée : plus rien à fusionner.
        assert(S.same(S.merge(key, m1, m1, m2), m1), 'convergence');
    }
}));

console.log(`\n${n} tests réussis.`);
