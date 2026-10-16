// Lancer : node tests/auth.test.js   (backend Supabase SIMULÉ : aucun réseau)
const vm = require('vm'), fs = require('fs'), assert = require('assert');
const makeBackend = require('./_fakeBackend.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const jeq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));

function boot({ backend, mem = new Map(), hash = '', configured = true, protocol = 'https:' } = {}) {
    const timers = [];
    const loc = { hash, protocol, pathname: '/app/', search: '', origin: protocol === 'file:' ? 'null' : 'https://chays.test' };
    const ctx = {
        localStorage: { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
                        get length() { return mem.size; }, key: i => [...mem.keys()][i] },
        fetch: backend.fetch, AbortController, URL, URLSearchParams, console,
        location: loc, history: { replaceState: (a, b, u) => { loc.hash = ''; ctx.__replaced = u; } },
        document: { addEventListener() {} },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; }
    };
    vm.createContext(ctx);
    const load = f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
    load('js/core/storageAdapter.js'); load('js/core/syncModel.js');
    vm.runInContext(`const CLOUD_CONFIG = ${configured ? "{ url: 'https://x.supabase.co', anonKey: 'anon' }" : "{ url: '', anonKey: '' }"};`, ctx);
    load('js/core/cloudClient.js'); load('js/core/cloudAdapter.js');
    ctx.run = s => vm.runInContext(s, ctx); ctx.mem = mem; ctx.timers = timers; ctx.load = load;
    ctx.events = []; ctx.boot = () => { load('js/core/auth.js'); ctx.run('Auth.onChange((e, d) => globalThis.__ev.push(e))'); };
    ctx.__ev = ctx.events;
    return ctx;
}
const refreshTimer = c => c.timers.filter(x => x.fn && x.ms !== 15000).pop();

(async () => {
    await t('sans configuration : rien n\'est installé, comportement local pur', async () => {
        const c = boot({ backend: makeBackend(), configured: false }); c.mem.set('chessTrainer_session', '{"access_token":"x","refresh_token":"y","expires_at":9999999999,"user":{"id":"u1","email":"a@b.c"}}');
        c.load('js/core/auth.js');
        assert.strictEqual(c.run('Auth.configured()'), false); assert.strictEqual(c.run('Auth.isSignedIn()'), false);
        assert.strictEqual(c.run('dataStore.adapter.name'), 'local');
    });

    const be = makeBackend(); be.addUser('ana@test.fr', 'motdepasse1');
    const c = boot({ backend: be }); c.boot();

    await t('connexion refusée : mauvais mot de passe / e-mail inconnu → message français', async () => {
        const r = await c.run(`Auth.signIn('ana@test.fr', 'faux')`);
        assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'invalid_credentials'); assert.match(r.message, /incorrect/);
        assert.strictEqual(c.run('Auth.isSignedIn()'), false); assert.strictEqual(c.run('dataStore.adapter.name'), 'local');
    });
    await t('e-mail non confirmé → message dédié', async () => {
        be.addUser('nc@test.fr', 'motdepasse1', false);
        assert.strictEqual((await c.run(`Auth.signIn('nc@test.fr', 'motdepasse1')`)).code, 'email_not_confirmed');
    });
    await t('réseau coupé → message réseau, pas de session', async () => {
        globalThis.__netDown = true; const r = await c.run(`Auth.signIn('ana@test.fr', 'motdepasse1')`); globalThis.__netDown = false;
        assert.strictEqual(r.code, 'network'); assert.strictEqual(c.run('Auth.isSignedIn()'), false);
    });
    await t('connexion réussie : session, jeton cloud, adaptateur de suivi, événement', async () => {
        const r = await c.run(`Auth.signIn('ana@test.fr', 'motdepasse1')`);
        assert.strictEqual(r.ok, true); assert.strictEqual(r.switched, false);
        assert.strictEqual(c.run('Auth.user().email'), 'ana@test.fr');
        assert.strictEqual(c.run('CloudClient.hasSession()'), true);
        assert.strictEqual(c.run('dataStore.adapter.name'), 'syncing');
        assert.strictEqual(c.run('SyncMeta.owner()'), 'u1'); assert.deepStrictEqual([...c.events], ['signed-in']);
        assert(JSON.parse(c.mem.get('chessTrainer_session')).refresh_token);
    });
    await t('le suivi des modifications est actif une fois connecté', async () => {
        c.run(`dataStore.set('openingDB_Général_w', '{"p":1}')`); c.run(`dataStore.set('chessTrainer_theme', 'light')`);
        jeq(Object.keys(c.run('SyncMeta.dirtySnapshot()')), ['openingDB_Général_w']);
    });
    await t('rafraîchissement programmé 60 s avant l\'expiration, puis jeton renouvelé', async () => {
        const tm = refreshTimer(c); assert(tm); assert(Math.abs(tm.ms - (3600 - 60) * 1000) < 3000);
        const before = c.run('Auth.session().access_token');
        const r = await c.run('Auth.refresh()');
        assert(r.ok); assert.notStrictEqual(c.run('Auth.session().access_token'), before);
        assert.strictEqual(c.run('Auth.user().email'), 'ana@test.fr'); assert(c.events.includes('refreshed'));
    });
    await t('rafraîchissements simultanés : un seul appel réseau', async () => {
        const k = be.log.length; await Promise.all([c.run('Auth.refresh()'), c.run('Auth.refresh()'), c.run('Auth.refresh()')]);
        assert.strictEqual(be.log.slice(k).filter(l => l.includes('refresh_token')).length, 1);
    });
    await t('refresh : réseau coupé → session conservée, nouvel essai programmé', async () => {
        globalThis.__netDown = true; const r = await c.run('Auth.refresh()'); globalThis.__netDown = false;
        assert.strictEqual(r.code, 'network'); assert.strictEqual(c.run('Auth.isSignedIn()'), true);
        assert.strictEqual(refreshTimer(c).ms, 30000);
    });
    await t('refresh : jeton refusé → session effacée, retour au local pur, événement expired', async () => {
        globalThis.__refreshDenied = true; const r = await c.run('Auth.refresh()'); globalThis.__refreshDenied = false;
        assert.strictEqual(r.code, 'expired'); assert.strictEqual(c.run('Auth.isSignedIn()'), false);
        assert.strictEqual(c.run('dataStore.adapter.name'), 'local'); assert(c.events.includes('expired'));
        assert.strictEqual(c.mem.has('chessTrainer_session'), false);
        assert.strictEqual(c.run('CloudClient.hasSession()'), false);
    });

    await t('restauration au démarrage : session relue, adaptateur installé immédiatement (synchrone)', async () => {
        const be2 = makeBackend(); const usr = be2.addUser('ana@test.fr', 'motdepasse1'); const tok = be2.token(usr);
        const mem = new Map([['chessTrainer_session', JSON.stringify({ access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: tok.expires_at, user: tok.user })]]);
        const c2 = boot({ backend: be2, mem }); c2.boot();
        assert.strictEqual(c2.run('Auth.isSignedIn()'), true); assert.strictEqual(c2.run('dataStore.adapter.name'), 'syncing');
        assert.strictEqual(c2.run('CloudClient.hasSession()'), true);
        assert.strictEqual(be2.log.filter(l => l.includes('refresh_token')).length, 0);        // pas expiré : aucun appel
    });
    await t('restauration d\'un jeton presque expiré : rafraîchi tout de suite', async () => {
        const be2 = makeBackend(); const usr = be2.addUser('ana@test.fr', 'motdepasse1'); const tok = be2.token(usr);
        const mem = new Map([['chessTrainer_session', JSON.stringify({ access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Math.floor(Date.now() / 1000) + 10, user: tok.user })]]);
        const c2 = boot({ backend: be2, mem }); c2.boot(); await c2.run('Auth.refresh()');
        assert(c2.run('Auth.session().expires_at') > Math.floor(Date.now() / 1000) + 3000);
    });

    await t('changement de compte sur le même appareil : suivi remis à zéro, drapeau « switched »', async () => {
        const be2 = makeBackend(); be2.addUser('ana@test.fr', 'motdepasse1'); be2.addUser('bob@test.fr', 'motdepasse2');
        const c2 = boot({ backend: be2 }); c2.boot();
        await c2.run(`Auth.signIn('ana@test.fr', 'motdepasse1')`);
        c2.run(`dataStore.set('openingDB_Général_w', '{"p":1}')`); c2.run(`SyncMeta.setBase('openingDB_Général_w', 'x'); SyncMeta.setVersion('openingDB_Général_w', 4)`);
        await c2.run('Auth.signOut()');
        assert.strictEqual(c2.run('SyncMeta.owner()'), 'u1');                                    // même compte au retour : on garde le suivi
        const r = await c2.run(`Auth.signIn('bob@test.fr', 'motdepasse2')`);
        assert.strictEqual(r.switched, true); assert.strictEqual(c2.run(`SyncMeta.version('openingDB_Général_w')`), null);
        jeq(c2.run('SyncMeta.dirtySnapshot()'), {});
    });
    await t('retour du même compte : suivi conservé (pas de remise à zéro)', async () => {
        const be2 = makeBackend(); be2.addUser('ana@test.fr', 'motdepasse1');
        const c2 = boot({ backend: be2 }); c2.boot();
        await c2.run(`Auth.signIn('ana@test.fr', 'motdepasse1')`); c2.run(`SyncMeta.setVersion('openingDB_Général_w', 4)`);
        await c2.run('Auth.signOut()');
        const r = await c2.run(`Auth.signIn('ana@test.fr', 'motdepasse1')`);
        assert.strictEqual(r.switched, false); assert.strictEqual(c2.run(`SyncMeta.version('openingDB_Général_w')`), 4);
    });
    await t('déconnexion : session locale effacée même si le réseau est coupé ; retour au local pur', async () => {
        const be2 = makeBackend(); be2.addUser('ana@test.fr', 'motdepasse1');
        const c2 = boot({ backend: be2 }); c2.boot(); await c2.run(`Auth.signIn('ana@test.fr', 'motdepasse1')`);
        globalThis.__netDown = true; await c2.run('Auth.signOut()'); globalThis.__netDown = false;
        assert.strictEqual(c2.run('Auth.isSignedIn()'), false); assert.strictEqual(c2.mem.has('chessTrainer_session'), false);
        assert.strictEqual(c2.run('dataStore.adapter.name'), 'local'); assert(c2.events.includes('signed-out'));
    });
    await t('déconnexion : portée « local » (les autres appareils restent connectés)', async () => {
        const be2 = makeBackend(); be2.addUser('ana@test.fr', 'motdepasse1');
        const c2 = boot({ backend: be2 }); c2.boot(); await c2.run(`Auth.signIn('ana@test.fr', 'motdepasse1')`); await c2.run('Auth.signOut()');
        assert(be2.log.some(l => l === 'POST /auth/v1/logout?scope=local'));
    });

    await t('inscription avec confirmation d\'e-mail : pas de session, besoin de confirmer', async () => {
        const be2 = makeBackend({ confirmEmail: true }); const c2 = boot({ backend: be2 }); c2.boot();
        const r = await c2.run(`Auth.signUp('new@test.fr', 'motdepasse1')`);
        assert.strictEqual(r.ok, true); assert.strictEqual(r.needsConfirmation, true); assert.strictEqual(c2.run('Auth.isSignedIn()'), false);
        assert(be2.log.some(l => l.startsWith('POST /auth/v1/signup?redirect_to=https%3A%2F%2Fchays.test%2Fapp%2F')));
    });
    await t('ouverte en file:// : aucune adresse de retour (Supabase utilise le « Site URL »)', async () => {
        const be2 = makeBackend({ confirmEmail: true }); const c2 = boot({ backend: be2, protocol: 'file:' }); c2.boot();
        await c2.run(`Auth.signUp('new@test.fr', 'motdepasse1')`);
        assert(be2.log.some(l => l === 'POST /auth/v1/signup'));
    });
    await t('inscription sans confirmation : connecté directement', async () => {
        const c2 = boot({ backend: makeBackend() }); c2.boot();
        const r = await c2.run(`Auth.signUp('new@test.fr', 'motdepasse1')`);
        assert.strictEqual(r.ok, true); assert.strictEqual(r.needsConfirmation, false); assert.strictEqual(c2.run('Auth.isSignedIn()'), true);
    });
    await t('inscription : compte existant / mot de passe trop court → messages dédiés', async () => {
        const be2 = makeBackend(); be2.addUser('ana@test.fr', 'motdepasse1'); const c2 = boot({ backend: be2 }); c2.boot();
        assert.strictEqual((await c2.run(`Auth.signUp('ana@test.fr', 'motdepasse1')`)).code, 'user_exists');
        assert.strictEqual((await c2.run(`Auth.signUp('x@test.fr', '123')`)).code, 'weak_password');
    });
    await t('mot de passe oublié : toujours « ok » côté interface ; réseau coupé → erreur', async () => {
        const c2 = boot({ backend: makeBackend() }); c2.boot();
        assert.strictEqual((await c2.run(`Auth.recover('inconnu@test.fr')`)).ok, true);
        globalThis.__netDown = true; assert.strictEqual((await c2.run(`Auth.recover('a@b.c')`)).code, 'network'); globalThis.__netDown = false;
    });

    await t('lien de réinitialisation (#…type=recovery) : connecté, notice « recovery », adresse nettoyée', async () => {
        const be2 = makeBackend(); const usr = be2.addUser('ana@test.fr', 'motdepasse1'); const tok = be2.token(usr);
        const c2 = boot({ backend: be2, hash: `#access_token=${tok.access_token}&refresh_token=${tok.refresh_token}&expires_in=3600&type=recovery` });
        c2.boot(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
        assert.strictEqual(c2.run('Auth.isSignedIn()'), true); assert.strictEqual(c2.run('Auth.takeNotice().kind'), 'recovery');
        assert.strictEqual(c2.run('Auth.takeNotice()'), null); assert.strictEqual(c2.__replaced, '/app/');
        assert.strictEqual((await c2.run(`Auth.updatePassword('motdepasse1')`)).code, 'same_password');
        assert.strictEqual((await c2.run(`Auth.updatePassword('nouveau-mdp-9')`)).ok, true);
        assert.strictEqual(be2.users.get('ana@test.fr').password, 'nouveau-mdp-9');
    });
    await t('lien de confirmation (#…type=signup) : connecté, notice « confirmed »', async () => {
        const be2 = makeBackend(); const usr = be2.addUser('ana@test.fr', 'motdepasse1'); const tok = be2.token(usr);
        const c2 = boot({ backend: be2, hash: `#access_token=${tok.access_token}&refresh_token=${tok.refresh_token}&type=signup` });
        c2.boot(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
        assert.strictEqual(c2.run('Auth.takeNotice().kind'), 'confirmed');
    });
    await t('lien expiré (#error=…otp_expired) : notice d\'erreur lisible, aucune session', async () => {
        const c2 = boot({ backend: makeBackend(), hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired' });
        c2.boot(); const nt = c2.run('Auth.takeNotice()');
        assert.strictEqual(nt.kind, 'error'); assert.match(nt.message, /expiré/); assert.strictEqual(c2.run('Auth.isSignedIn()'), false);
    });
    await t('updatePassword sans session → erreur claire', async () => {
        const c2 = boot({ backend: makeBackend() }); c2.boot();
        assert.strictEqual((await c2.run(`Auth.updatePassword('abcdefgh')`)).code, 'no_session');
    });

    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error('ÉCHEC :', e.stack || e.message); process.exit(1); });
