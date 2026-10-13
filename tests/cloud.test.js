// Lancer : node tests/cloud.test.js   (serveur Supabase SIMULÉ en mémoire : aucun réseau)
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const jeq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));   // objets issus du contexte vm : comparaison par JSON
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

// ─── Faux PostgREST : mêmes règles que supabase/schema.sql (RLS, version serveur, filtres, Range) ───
function makeServer() {
    const tables = new Map();                                  // user → Map(key → row)
    const log = { calls: 0 };
    const tokens = { 'tok-u1': 'u1', 'tok-u2': 'u2' };
    async function fetch(url, opt) {
        log.calls++;
        if (opt.signal && opt.signal.aborted) throw new Error('abort');
        if (globalThis.__netDown) throw new TypeError('Failed to fetch');
        const u = new URL(url), h = opt.headers || {};
        const user = tokens[(h.Authorization || '').replace('Bearer ', '')];
        const res = (status, body, extra) => ({ status, ok: status >= 200 && status < 300, text: async () => body === undefined ? '' : JSON.stringify(body), headers: extra || {} });
        if (!h.apikey) return res(401, { message: 'No API key' });
        if (!user) return res(401, { message: 'JWT expired' });
        const tb = tables.get(user) || tables.set(user, new Map()).get(user);
        const eq = name => { const v = u.searchParams.get(name); return v && v.startsWith('eq.') ? v.slice(3) : null; };
        const key = eq('key'), ver = eq('version');
        const rows = () => [...tb.values()].filter(r => (key === null || r.key === key) && (ver === null || String(r.version) === ver));
        const out = r => ({ key: r.key, data: r.data, version: r.version, updated_at: r.updated_at });
        if (opt.method === 'GET') {
            let all = rows().sort((a, b) => (a.key < b.key ? -1 : 1)).map(out);
            const rg = h.Range && /^(\d+)-(\d+)$/.exec(h.Range);
            if (rg) { const from = +rg[1], to = +rg[2]; if (from > 0 && from >= all.length) return res(416, { message: 'range' }); all = all.slice(from, to + 1); }
            return res(rg ? 206 : 200, all);
        }
        if (opt.method === 'POST') {
            const b = JSON.parse(opt.body);
            if (tb.has(b.key)) return res(409, { code: '23505', message: 'duplicate key' });
            const row = { user_id: user, key: b.key, data: b.data, version: 1, updated_at: 'now', device: b.device };
            tb.set(b.key, row);
            return res(201, [out(row)]);
        }
        if (opt.method === 'PATCH') {
            const hit = rows();
            hit.forEach(r => { const b = JSON.parse(opt.body); r.data = b.data; r.device = b.device; r.version += 1; });   // trigger documents_bump
            return res(200, hit.map(out));
        }
        if (opt.method === 'DELETE') {
            const hit = rows(); hit.forEach(r => tb.delete(r.key));
            return res(200, hit.map(out));
        }
        return res(405, {});
    }
    return { fetch, tables, log };
}

function makeContext(server) {
    const mem = new Map();
    const ctx = {
        localStorage: { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
                        get length() { return mem.size; }, key: i => [...mem.keys()][i] },
        fetch: server.fetch, AbortController, URL, setTimeout, clearTimeout, console
    };
    vm.createContext(ctx);
    ['js/core/storageAdapter.js', 'js/core/syncModel.js', 'js/core/cloudAdapter.js', 'js/core/cloudClient.js']
        .forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
    ctx.mem = mem; ctx.run = s => vm.runInContext(s, ctx);
    return ctx;
}

(async () => {
    // ═══ CloudClient ═══
    const srv = makeServer(), c = makeContext(srv);
    c.run(`globalThis.CLOUD_CONFIG = { url: 'https://x.supabase.co/', anonKey: 'anon' }`);
    const C = c.run('CloudClient');

    await t('sans session → erreur auth, sans appel réseau', async () => {
        const r = await C.listDocs(); jeq([r.ok, r.error], [false, 'auth']); assert.strictEqual(srv.log.calls, 0);
    });
    await t('sans configuration → erreur config', async () => {
        const s2 = makeServer(), c2 = makeContext(s2);
        c2.run(`globalThis.CLOUD_CONFIG = { url: '', anonKey: '' }`);
        c2.run(`CloudClient.setSession({ access_token: 'tok-u1' })`);
        assert.strictEqual((await c2.run('CloudClient.listDocs()')).error, 'config');
    });

    C.setSession({ access_token: 'tok-u1', user: { id: 'u1' } });

    await t('création → version 1 ; recréer → conflit', async () => {
        const r = await C.createDoc('openingDB_Général_w', { p: { move: 'e2e4' } });
        assert(r.ok); assert.strictEqual(r.doc.version, 1);
        jeq(await C.createDoc('openingDB_Général_w', {}), { ok: false, conflict: true });
    });
    await t('mise à jour avec la bonne version → version + 1', async () => {
        const r = await C.updateDoc('openingDB_Général_w', { p: { move: 'd2d4' } }, 1);
        assert(r.ok); assert.strictEqual(r.doc.version, 2); jeq(r.doc.data, { p: { move: 'd2d4' } });
    });
    await t('mise à jour avec une version périmée → conflit, rien d\'écrit', async () => {
        jeq(await C.updateDoc('openingDB_Général_w', { z: 1 }, 1), { ok: false, conflict: true });
        jeq((await C.getDoc('openingDB_Général_w')).doc.data, { p: { move: 'd2d4' } });
    });
    await t('suppression : version périmée → conflit ; bonne version → supprimé', async () => {
        jeq(await C.deleteDoc('openingDB_Général_w', 1), { ok: false, conflict: true });
        jeq(await C.deleteDoc('openingDB_Général_w', 2), { ok: true });
        assert.strictEqual((await C.getDoc('openingDB_Général_w')).doc, null);
    });
    await t('clés avec accents, espaces, %, /, & : aller-retour exact', async () => {
        for (const k of ['openingDB_Défense Sicilienne_b', 'openingDB_100% / A&B_w', 'openingOpp_a,b(c)_w']) {
            assert((await C.createDoc(k, [1])).ok, k);
            assert.strictEqual((await C.getDoc(k)).doc.key, k);
            assert((await C.updateDoc(k, [2], 1)).ok, k);
        }
    });
    await t('liste paginée : 2 500 documents tous renvoyés', async () => {
        const tb = srv.tables.get('u1');
        for (let i = 0; i < 2500; i++) tb.set('bulk' + String(i).padStart(4, '0'), { user_id: 'u1', key: 'bulk' + String(i).padStart(4, '0'), data: i, version: 1, updated_at: 'now' });
        const r = await C.listDocs();
        assert(r.ok); assert.strictEqual(r.docs.filter(d => d.key.startsWith('bulk')).length, 2500);
    });
    await t('isolation entre utilisateurs (RLS simulée)', async () => {
        C.setSession({ access_token: 'tok-u2' });
        assert.strictEqual((await C.listDocs()).docs.length, 0);
        assert.strictEqual((await C.getDoc('bulk0001')).doc, null);
        C.setSession({ access_token: 'tok-u1' });
    });
    await t('jeton expiré → erreur auth ; réseau coupé → erreur network', async () => {
        C.setSession({ access_token: 'périmé' });
        assert.strictEqual((await C.listDocs()).error, 'auth');
        C.setSession({ access_token: 'tok-u1' });
        globalThis.__netDown = true;
        assert.strictEqual((await C.updateDoc('k', 1, 1)).error, 'network');
        globalThis.__netDown = false;
    });
    await t('identifiant d\'appareil stable et local', async () => {
        const id = c.mem.get('chessTrainer_deviceId'); assert(id);
        await C.createDoc('dev_test', 1); assert.strictEqual(srv.tables.get('u1').get('dev_test').device, id);
    });

    // ═══ SyncMeta + adaptateur de suivi ═══
    const s2 = makeServer(), m = makeContext(s2), M = m.run('SyncMeta');
    const DB = 'openingDB_Général_w';

    await t('adaptateur : écriture d\'une clé synchronisée → dirty ; clé locale → jamais', async () => {
        m.run('installSyncingAdapter()');
        m.run(`dataStore.set('${DB}', '{"a":1}')`); m.run(`dataStore.set('chessTrainer_theme', 'light')`);
        m.run(`dataStore.set('chessTrainer_settings', '{}')`); m.run(`dataStore.set('chessTrainer.trainingSettings', '{}')`);
        jeq(Object.keys(M.dirtySnapshot()), [DB]);
    });
    await t('valeur inchangée → pas de nouveau marquage ; changée → nouveau tampon', async () => {
        const a = M.dirtySnapshot()[DB];
        m.run(`dataStore.set('${DB}', '{"a":1}')`); assert.strictEqual(M.dirtySnapshot()[DB], a);
        m.run(`dataStore.set('${DB}', '{"a":2}')`); assert(M.dirtySnapshot()[DB] > a);
    });
    await t('suppression d\'une clé existante → dirty ; clé absente → rien', async () => {
        m.run(`dataStore.set('chessTrainer_trash', '[]')`); M.clearDirty('chessTrainer_trash', M.dirtySnapshot()['chessTrainer_trash']);
        m.run(`dataStore.remove('chessTrainer_trash')`); assert('chessTrainer_trash' in M.dirtySnapshot());
        M.clearDirty('chessTrainer_trash', M.dirtySnapshot()['chessTrainer_trash']);
        m.run(`dataStore.remove('openingDB_inconnu_w')`); assert(!('openingDB_inconnu_w' in M.dirtySnapshot()));
    });
    await t('clearDirty : ignoré si la clé a été modifiée pendant l\'envoi', async () => {
        const stamp = M.dirtySnapshot()[DB];
        m.run(`dataStore.set('${DB}', '{"a":3}')`);                       // modifiée pendant le push
        assert.strictEqual(M.clearDirty(DB, stamp), false); assert(DB in M.dirtySnapshot());
        assert.strictEqual(M.clearDirty(DB, M.dirtySnapshot()[DB]), true); assert(!(DB in M.dirtySnapshot()));
    });
    await t('le suivi persiste (relecture depuis le stockage) et l\'écriture « moteur » ne marque rien', async () => {
        m.run(`LocalStorageAdapter.set('${DB}', '{"depuis":"serveur"}')`);
        assert(!(DB in M.dirtySnapshot()));
        M.setVersion(DB, 7); M.setBase(DB, '{"depuis":"serveur"}');
        assert.strictEqual(M.version(DB), 7); assert.strictEqual(M.base(DB), '{"depuis":"serveur"}');
        M.setVersion(DB, null); M.setBase(DB, null);
        assert.strictEqual(M.version(DB), null); assert.strictEqual(M.base(DB), null);
    });
    await t('abonnement onDirty notifié', async () => {
        const seen = []; M.onDirty(k => seen.push(k));
        m.run(`dataStore.set('openingOpp_Général_w', '{"k":["a"]}')`);
        jeq(seen, ['openingOpp_Général_w']);
    });
    await t('markAllDirty : toutes les clés synchronisables, aucune clé locale', async () => {
        m.run(`LocalStorageAdapter.set('openingDB_X_b', '{}')`);
        M.markAllDirty();
        const d = Object.keys(M.dirtySnapshot());
        assert(d.includes('openingDB_X_b') && d.includes(DB)); assert(!d.some(k => k.includes('theme') || k.includes('syncMeta')));
    });
    await t('changement de compte : bases / versions / dirty remis à zéro', async () => {
        M.setBase(DB, 'x'); M.setVersion(DB, 3);
        assert.strictEqual(M.bindOwner('u1'), false);                     // première liaison : on conserve
        assert.strictEqual(M.version(DB), 3);
        assert.strictEqual(M.bindOwner('u1'), false);
        assert.strictEqual(M.bindOwner('u2'), true);                      // autre compte : remise à zéro
        assert.strictEqual(M.version(DB), null); assert.strictEqual(M.base(DB), null); jeq(M.dirtySnapshot(), {});
        assert.strictEqual(M.owner(), 'u2');
    });
    await t('désinstallation : retour au stockage local pur (plus aucun marquage)', async () => {
        m.run('uninstallSyncingAdapter()');
        m.run(`dataStore.set('openingDB_Y_w', '{}')`);
        assert(!('openingDB_Y_w' in M.dirtySnapshot()));
        assert.strictEqual(m.run('dataStore.adapter.name'), 'local');
    });

    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error('ÉCHEC :', e.message); process.exit(1); });
