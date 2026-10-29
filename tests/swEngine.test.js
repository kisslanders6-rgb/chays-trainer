// Lancer : node tests/swEngine.test.js   — service worker : fichiers du moteur servis sans le fragment du premier chargement.
// Le moteur complet reçoit l'adresse blob: de son .wasm dans le fragment du script (« stockfish-19.js#blob:… »).
// Une réponse sortie telle quelle du cache garde l'adresse du premier chargement : le Worker y lirait un blob: révoqué.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const ORIGIN = 'https://chays.test';
const stores = new Map();
function fakeCache() {
    const m = new Map(), bare = u => String(u.url || u).split('#')[0];
    return {
        m,
        match: async u => { const r = m.get(bare(u)); return r ? r.clone() : undefined; },
        put: async (u, res) => { m.set(bare(u), res); },
        keys: async () => [...m.keys()].map(url => ({ url })),
        delete: async u => m.delete(bare(u))
    };
}
let fetched = [];
const listeners = {};
const ctx = {
    self: { location: { origin: ORIGIN }, addEventListener: (k, fn) => { listeners[k] = fn; }, skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async k => { if (!stores.has(k)) stores.set(k, fakeCache()); return stores.get(k); }, keys: async () => [...stores.keys()], match: async () => undefined, delete: async () => true },
    fetch: async u => {
        fetched.push(String(u));
        // Comme un navigateur : la réponse réseau garde l'adresse demandée, fragment compris.
        const res = new Response('/* moteur */', { status: 200, headers: { 'Content-Type': 'text/javascript' } });
        Object.defineProperty(res, 'url', { value: String(u) });
        return res;
    },
    URL, Response, Request, Promise, console
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('sw.js', 'utf8'), ctx);

function request(url) {
    let p = null;
    listeners.fetch({ request: { method: 'GET', mode: 'cors', url }, respondWith: r => { p = r; } });
    return p;
}

(async () => {
    const js = `${ORIGIN}/engine/19.0.1/stockfish-19.js`;
    await t('premier chargement : rangé sans fragment, réponse neuve sans adresse', async () => {
        const res = await request(`${js}#blob%3A${encodeURIComponent(ORIGIN)}%2Fun`);
        assert(res, 'le service worker répond');
        assert.strictEqual(res.url, '', 'le Worker garde l\'adresse demandée');
        assert.strictEqual(await res.text(), '/* moteur */');
        assert.deepStrictEqual(fetched, [js], 'demandé au réseau sans fragment');
        assert.deepStrictEqual((await (await ctx.caches.open('chays-engine')).keys()).map(r => r.url), [js]);
    });
    await t('chargement suivant : servi du cache, toujours sans l\'adresse du premier', async () => {
        fetched = [];
        const res = await request(`${js}#blob%3A${encodeURIComponent(ORIGIN)}%2Fdeux`);
        assert.strictEqual(res.url, '');
        assert.deepStrictEqual(fetched, [], 'pas de nouvel appel réseau');
        assert.strictEqual(res.headers.get('Content-Type'), 'text/javascript', 'en-têtes conservés (type, COEP)');
    });
    await t('engine.js : purge le script rangé avec un fragment par un ancien service worker', async () => {
        const src = fs.readFileSync('js/core/engine.js', 'utf8');
        assert(/await dropStaleScript\(full\);[\s\S]*?URL\.createObjectURL/.test(src), 'purge avant de créer le Worker');
    });
    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
