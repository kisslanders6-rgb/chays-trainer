// Lancer : node tests/syncEngine.test.js   — deux « appareils » simulés partagent un faux serveur Supabase
const vm = require('vm'), fs = require('fs'), assert = require('assert');
const makeBackend = require('./_fakeBackend.js');
let n = 0; const t = async (name, fn) => { globalThis.__netDown = false; await fn(); n++; console.log('ok  ', name); };
const J = x => JSON.stringify(x);
const eq = (a, b, m) => assert.strictEqual(J(a), J(b), m);
const E = (move, a, f, extra) => Object.assign({ move, san: move, attempts: a, failures: f }, extra || {});
const DBW = 'openingDB_Général_w', LIST = 'chessTrainer_repertoires';

function device(be) {
    const mem = new Map(), timers = [];
    const ctx = {
        localStorage: { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
                        get length() { return mem.size; }, key: i => [...mem.keys()][i] },
        fetch: be.fetch, AbortController, URL, URLSearchParams, console,
        location: { hash: '', pathname: '/', search: '', origin: 'https://t', protocol: 'https:' }, history: { replaceState() {} },
        document: { addEventListener() {}, hidden: false, getElementById: () => null },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; }, setInterval: () => 0
    };
    vm.createContext(ctx);
    const load = f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
    load('js/core/storageAdapter.js'); load('js/core/syncModel.js');
    vm.runInContext("const CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'anon' };", ctx);
    load('js/core/cloudClient.js'); load('js/core/cloudAdapter.js'); load('js/core/auth.js');
    vm.runInContext(`let playerColor = 'w'; function migrateLegacyPaths() {} function askConfirm() {}
        globalThis.__calls = []; globalThis.__status = [];
        function renderRepertoireList() { __calls.push('repList'); } function initStats() { __calls.push('stats'); }
        function initTraining() { __calls.push('training'); } function refreshTree() { __calls.push('tree'); }
        function updateTrashBadges() { __calls.push('trash'); }
        const AccountUI = { setSyncStatus(l, t) { __status.push([l, t]); } };`, ctx);
    load('js/storage.js'); load('js/core/syncEngine.js');
    const run = s => vm.runInContext(s, ctx);
    return {
        ctx, mem, timers, run,
        signIn: (e, p) => run(`Auth.signIn(${J(e)}, ${J(p)})`),
        intent: s => run(`SyncIntent.set({ user: Auth.user().id, strategy: '${s}', at: 1 })`),
        sync: () => run('SyncEngine.syncNow()'),
        put: (k, o) => run(`dataStore.set(${J(k)}, ${J(J(o))})`),
        del: k => run(`dataStore.remove(${J(k)})`),
        get: k => { const r = mem.get(k); return r == null ? null : JSON.parse(r); },
        dirty: () => Object.keys(run('SyncMeta.dirtySnapshot()')),
        status: () => run('SyncEngine.status()'), calls: () => [...run('__calls')],
        activeTimers: () => timers.filter(x => x.fn).map(x => x.ms)
    };
}
const setup = async (opts, emails = ['ana@test.fr']) => {
    const be = makeBackend(opts); const users = emails.map(e => be.addUser(e, 'motdepasse1'));
    const A = device(be); await A.signIn(emails[0], 'motdepasse1'); return { be, A, uid: users[0].id };
};
const remote = (be, uid, key) => { const d = be.doc(uid, key); return d ? JSON.parse(JSON.stringify(d.data)) : null; };

(async () => {
    await t('sans choix de première synchronisation : le moteur attend, rien n\'est envoyé', async () => {
        const { be, A, uid } = await setup(); A.put(DBW, { a: E('e2e4', 1, 0) });
        const r = await A.sync(); assert.strictEqual(r.waiting, true);
        assert.strictEqual(remote(be, uid, DBW), null); assert.match(A.status().text, /choix/);
    });
    await t('déconnecté : aucune requête, aucun marquage', async () => {
        const be = makeBackend(); be.addUser('ana@test.fr', 'motdepasse1'); const A = device(be);
        const r = await A.sync(); assert.strictEqual(r.skipped, 'inactive'); assert.strictEqual(be.log.length, 0);
    });

    await t('« Envoyer » : le serveur devient la copie de cet appareil (documents en trop supprimés), seuls les documents synchronisables partent', async () => {
        const { be, A, uid } = await setup();
        A.put(DBW, { a: E('e2e4', 3, 1), b: E('d2d4', 1, 0) }); A.put(LIST, ['Général', 'X']);
        A.put('chessTrainer_trash', [{ id: 't1', deletedAt: 5, count: 1, type: 'move', data: {} }]); A.put('chessTrainer_endgames', { kqk: { tries: 2, wins: 1, perfect: false, best: 9, last: 3 } });
        A.run(`dataStore.set('chessTrainer_theme', 'light')`); A.run(`dataStore.set('chessTrainer_settings', '{"sound":false}')`);
        be.addDoc(uid, 'openingDB_Ancien_b', { z: E('c2c4', 1, 0) });
        A.intent('upload'); const r = await A.sync();
        eq(remote(be, uid, DBW), A.get(DBW)); assert.strictEqual(remote(be, uid, 'openingDB_Ancien_b'), null);
        eq(remote(be, uid, LIST), ['Général', 'X']); assert(remote(be, uid, 'chessTrainer_trash')); assert(remote(be, uid, 'chessTrainer_endgames'));
        eq([...be.docs.get(uid).keys()].sort(), [DBW, 'chessTrainer_endgames', LIST, 'chessTrainer_trash'].sort());   // ni thème ni réglages
        eq(A.dirty(), []); assert.strictEqual(A.run('SyncIntent.get().done'), true); assert(r.pushed.includes(DBW));
        assert.strictEqual(A.run(`SyncMeta.version('${DBW}')`), 1); assert(A.run(`SyncMeta.base('${DBW}')`));
        assert.match(A.status().text, /À jour/); eq(A.status().level, 'ok');
    });

    await t('« Récupérer » : l\'appareil devient la copie du serveur (documents locaux en trop supprimés), préférences d\'appareil intactes, mémoire de l\'appli rechargée', async () => {
        const { be, A, uid } = await setup();
        be.addDoc(uid, DBW, { r1: E('c2c4', 2, 1), r2: E('g1f3', 1, 0) }); be.addDoc(uid, LIST, ['Général', 'Distant']);
        A.put(DBW, { vieux: E('e2e4', 9, 9) }); A.put('openingDB_SeulementLocal_w', { q: E('a2a3', 1, 0) });
        A.run(`dataStore.set('chessTrainer_theme', 'light')`);
        A.run(`currentRepertoire = 'Général'; playerColor = 'w'; loadDB();`);
        A.intent('download'); await A.sync();
        eq(Object.keys(A.get(DBW)).sort(), ['r1', 'r2']); assert.strictEqual(A.mem.has('openingDB_SeulementLocal_w'), false);
        assert.strictEqual(A.mem.get('chessTrainer_theme'), 'light');
        eq(Object.keys(A.run('openingDB')).sort(), ['r1', 'r2']);                                    // base chargée en mémoire = stockage
        assert(A.calls().includes('repList')); assert(A.calls().includes('stats'));
        eq(A.dirty(), []);
    });

    await t('« Fusionner » : positions communes sommées, positions distinctes toutes conservées, copies identiques', async () => {
        const { be, A, uid } = await setup();
        A.put(DBW, { a: E('e2e4', 3, 1), b: E('d2d4', 1, 0) }); be.addDoc(uid, DBW, { a: E('e2e4', 2, 1), c: E('c2c4', 1, 0) });
        A.intent('merge'); await A.sync();
        const L = A.get(DBW); eq(Object.keys(L).sort(), ['a', 'b', 'c']); assert.strictEqual(L.a.attempts, 5); assert.strictEqual(L.a.failures, 2);
        eq(remote(be, uid, DBW), L);
    });

    await t('deux appareils : modifications concurrentes (compteurs + ajouts) convergent vers le même état sur A, B et le serveur', async () => {
        const { be, A, uid } = await setup(); A.put(DBW, { a: E('e2e4', 5, 2) }); A.intent('upload'); await A.sync();
        const B = device(be); await B.signIn('ana@test.fr', 'motdepasse1'); B.intent('download'); await B.sync();
        eq(B.get(DBW), A.get(DBW));
        A.put(DBW, { a: E('e2e4', 7, 2), x: E('c2c4', 1, 0) });                                        // A : +2 essais, ajoute x
        B.put(DBW, { a: E('e2e4', 6, 3), y: E('g1f3', 1, 0) });                                        // B : +1 essai +1 erreur, ajoute y
        await A.sync(); await B.sync(); await A.sync();
        const fin = remote(be, uid, DBW); eq(A.get(DBW), fin); eq(B.get(DBW), fin);
        eq(Object.keys(fin).sort(), ['a', 'x', 'y']); assert.strictEqual(fin.a.attempts, 8); assert.strictEqual(fin.a.failures, 3);   // 5 + 2 + 1, 2 + 0 + 1
        eq(A.dirty(), []); eq(B.dirty(), []);
    });

    await t('suppression propagée à l\'autre appareil, mémoire rechargée', async () => {
        const { be, A, uid } = await setup(); A.put('openingDB_Autre_w', { a: E('e2e4', 1, 0) }); A.intent('upload'); await A.sync();
        const B = device(be); await B.signIn('ana@test.fr', 'motdepasse1'); B.intent('download'); await B.sync(); assert(B.mem.has('openingDB_Autre_w'));
        A.del('openingDB_Autre_w'); await A.sync(); assert.strictEqual(remote(be, uid, 'openingDB_Autre_w'), null);
        await B.sync(); assert.strictEqual(B.mem.has('openingDB_Autre_w'), false); assert.strictEqual(B.run(`SyncMeta.base('openingDB_Autre_w')`), null);
    });

    await t('suppression d\'un côté + modification de l\'autre : la modification gagne partout', async () => {
        const { be, A, uid } = await setup(); A.put('openingDB_K_w', { a: E('e2e4', 1, 0) }); A.intent('upload'); await A.sync();
        const B = device(be); await B.signIn('ana@test.fr', 'motdepasse1'); B.intent('download'); await B.sync();
        A.del('openingDB_K_w'); B.put('openingDB_K_w', { a: E('e2e4', 4, 1) });
        await B.sync(); await A.sync();
        assert.strictEqual(A.get('openingDB_K_w').a.attempts, 4); eq(remote(be, uid, 'openingDB_K_w'), A.get('openingDB_K_w'));
    });

    await t('conflit de version pendant l\'envoi : relecture, nouvelle fusion, rien de perdu', async () => {
        const { be, A, uid } = await setup(); A.put(DBW, { a: E('e2e4', 1, 0) }); A.intent('upload'); await A.sync();
        A.put(DBW, { a: E('e2e4', 1, 0), mien: E('d2d4', 1, 0) }); let injected = false;
        be.opts.onRest = (method, key) => { if (method === 'PATCH' && key === DBW && !injected) { injected = true; be.bump(uid, DBW, { a: E('e2e4', 1, 0), autre: E('c2c4', 1, 0) }); } };
        await A.sync(); be.opts.onRest = null;
        assert(injected); eq(Object.keys(A.get(DBW)).sort(), ['a', 'autre', 'mien']); eq(remote(be, uid, DBW), A.get(DBW));
    });

    await t('réseau coupé : rien n\'est perdu, statut « hors ligne », essais espacés 15 s → 30 s → 60 s → 2 min → 5 min (plafond) ; reprise et remise à zéro', async () => {
        const { be, A, uid } = await setup(); A.put(DBW, { a: E('e2e4', 1, 0) }); A.intent('upload'); await A.sync();
        A.put(DBW, { a: E('e2e4', 2, 0) }); globalThis.__netDown = true;
        const drain = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
        const r = await A.sync(); assert.strictEqual(r.error, 'network'); eq(A.status().level, 'offline'); eq(A.dirty(), [DBW]);
        const delays = [A.activeTimers().pop()];
        for (let i = 0; i < 5; i++) { A.timers.filter(x => x.fn).pop().fn(); await drain(); delays.push(A.activeTimers().pop()); }   // le minuteur d'essai se déclenche
        eq(delays, [15000, 30000, 60000, 120000, 300000, 300000]);
        globalThis.__netDown = false; A.timers.filter(x => x.fn).pop().fn(); await drain();
        assert.strictEqual(remote(be, uid, DBW).a.attempts, 2); eq(A.dirty(), []); eq(A.status().level, 'ok');
        A.put(DBW, { a: E('e2e4', 3, 0) }); globalThis.__netDown = true; await A.sync(); assert.strictEqual(A.activeTimers().pop(), 15000);   // compteur remis à zéro
    });

    await t('modification faite pendant la synchro : jamais écrasée, puis fusionnée au passage suivant', async () => {
        const { be, A, uid } = await setup(); A.put(DBW, { a: E('e2e4', 1, 0) }); A.intent('upload'); await A.sync();
        be.bump(uid, DBW, { a: E('e2e4', 1, 0), distant: E('c2c4', 1, 0) });                            // un autre appareil a modifié
        let done = false;
        be.opts.onRest = (method, key) => { if (method === 'GET' && key === DBW && !done) { done = true; A.put(DBW, { a: E('e2e4', 1, 0), local: E('d2d4', 1, 0) }); } };
        const r1 = await A.sync(); be.opts.onRest = null;
        assert(r1.raced.includes(DBW)); assert(A.get(DBW).local); assert(!A.get(DBW).distant);        // la saisie locale est intacte
        await A.sync(); eq(Object.keys(A.get(DBW)).sort(), ['a', 'distant', 'local']); eq(remote(be, uid, DBW), A.get(DBW));
    });

    await t('valeur locale illisible : ignorée, jamais traitée comme une suppression', async () => {
        const { be, A, uid } = await setup(); A.put(DBW, { a: E('e2e4', 1, 0) }); A.intent('upload'); await A.sync();
        A.mem.set(DBW, '{corrompu'); A.run(`SyncMeta.markDirty('${DBW}')`);
        const r = await A.sync(); assert(r.skipped.includes(DBW)); assert(remote(be, uid, DBW));
    });

    await t('modifications faites déconnecté : rattrapées à la reconnexion en comparant à la base', async () => {
        const { be, A, uid } = await setup(); A.put(DBW, { a: E('e2e4', 1, 0) }); A.intent('upload'); await A.sync();
        await A.run('Auth.signOut()'); A.run(`dataStore.set('${DBW}', ${J(J({ a: E('e2e4', 1, 0), horsligne: E('d2d4', 1, 0) }))})`);
        eq(A.dirty(), []);                                                                              // adaptateur retiré : pas de marque
        await A.signIn('ana@test.fr', 'motdepasse1'); await A.sync();
        assert(remote(be, uid, DBW).horsligne);
    });

    await t('jeton refusé en cours de route : rafraîchi, reprise sans perte', async () => {
        const { be, A, uid } = await setup(); A.put(DBW, { a: E('e2e4', 1, 0) }); A.intent('upload'); await A.sync();
        A.put(DBW, { a: E('e2e4', 3, 0) }); be.sessions.clear();
        const r = await A.sync(); assert.strictEqual(r.error, 'auth'); assert.strictEqual(r.retrying, true);
        const r2 = await A.sync(); assert(!r2.error); assert.strictEqual(remote(be, uid, DBW).a.attempts, 3);
    });

    await t('planification : modification → passage dans 4 s ; changement d\'état suivi par l\'interface', async () => {
        const { A } = await setup(); A.intent('upload'); await A.sync(); A.timers.length = 0;
        A.put(DBW, { a: E('e2e4', 1, 0) }); assert(A.activeTimers().includes(4000));
        const seq = [...A.run('__status')].map(x => x[0]); assert(seq.includes('busy') && seq.includes('ok'));
    });

    await t('après le premier passage, le choix initial ne s\'applique plus : un « upload » terminé n\'écrase plus le serveur', async () => {
        const { be, A, uid } = await setup(); A.put(DBW, { a: E('e2e4', 1, 0) }); A.intent('upload'); await A.sync();
        be.bump(uid, 'openingDB_NouveauDistant_b', { z: E('c2c4', 1, 0) });
        await A.sync(); assert(remote(be, uid, 'openingDB_NouveauDistant_b')); assert(A.mem.has('openingDB_NouveauDistant_b'));
    });

    await t('interrogation légère : sans changement, aucune lecture de contenu (clés et versions seulement)', async () => {
        const { be, A } = await setup(); A.put(DBW, { a: E('e2e4', 1, 0) }); A.intent('upload'); await A.sync();
        await A.sync(); const k = be.log.length; await A.sync();
        const calls = be.log.slice(k).filter(l => l.includes('/rest/v1/'));
        assert(calls.every(l => l.startsWith('GET') && l.includes('select=key%2Cversion') || l.includes('select=key,version')), calls.join('\n')); assert.strictEqual(calls.length, 1);
    });

    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error('ÉCHEC :', e.stack || e.message); process.exit(1); });
