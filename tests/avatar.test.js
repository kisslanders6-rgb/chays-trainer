// Lancer : node tests/avatar.test.js   — avatars du profil (18 motifs, couleur de l'échiquier) et photo (avatarPhoto.js, sans réseau)
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const store = {}, calls = [];
const ctx = {
    console, Promise, JSON, Date, URL: { createObjectURL: () => 'blob:x' },
    appSettings: { avatarPhoto: '' },
    dataStore: { getJSON: (k, d) => (k in store ? JSON.parse(store[k]) : d), setJSON: (k, v) => { store[k] = JSON.stringify(v); }, remove: k => { delete store[k]; } },
    setPref: (k, v) => { ctx.appSettings[k] = v; },
    reportError() {},
    CLOUD_CONFIG: { url: 'https://x.supabase.co', anonKey: 'anon' },
    Auth: { isSignedIn: () => false, user: () => null, session: () => null },
    fetch: async (url, o) => { calls.push([url, o && o.method]); return { ok: false }; }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/core/avatarPhoto.js', 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx);
const { AvatarPhoto } = ctx;
const settings = fs.readFileSync('js/core/settings.js', 'utf8'), icons = fs.readFileSync('js/core/icons.js', 'utf8');

(async () => {
    await t('18 avatars : 2 monogrammes, 6 pièces, 10 pictogrammes présents dans icons.js ; couleur « theme »', () => {
        const glyphs = eval(settings.match(/const AVATAR_GLYPHS\s*=\s*(\[[^\]]+\])/)[1]);
        assert.strictEqual(glyphs.length, 18);
        assert.deepStrictEqual(glyphs.slice(0, 8), ['initial', 'initials', 'k', 'q', 'r', 'b', 'n', 'p']);
        glyphs.filter(g => g.startsWith('av-')).forEach(g => assert(icons.includes(`'${g}':`), g));
        assert(/AVATAR_COLORS\s*=\s*\['theme'/.test(settings));
    });

    await t('préférence avatarPhoto : chemin {uid}/avatar-{ts}.webp ou vide', () => {
        const mem = new Map(), sctx = { localStorage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), get length() { return mem.size; }, key: i => [...mem.keys()][i] },
                                        document: { documentElement: { setAttribute() {} } }, Date, JSON };
        vm.createContext(sctx);
        ['js/core/storageAdapter.js', 'js/core/settings.js'].forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), sctx));
        const ok = v => vm.runInContext(`SYNCED_PREFS.avatarPhoto.ok(${JSON.stringify(v)})`, sctx);
        assert(ok('') && ok('0b3c8e8a-1d2f-4c5b-9a7e-6f1d2c3b4a5e/avatar-1793040000000.webp'));
        assert(!ok('autre/avatar-1.webp') && !ok('../x.webp') && !ok('0b3c8e8a-1d2f-4c5b-9a7e-6f1d2c3b4a5e/avatar.png'));
    });

    await t('sans compte : la copie locale « local » s\'affiche ; une fois connecté, elle ne s\'affiche plus', () => {
        assert.strictEqual(AvatarPhoto.src(), null);
        store.chessTrainer_avatarLocal = JSON.stringify({ path: 'local', data: 'data:image/webp;base64,AAA' });
        assert.strictEqual(AvatarPhoto.src(), 'data:image/webp;base64,AAA');
        ctx.Auth.isSignedIn = () => true;
        assert.strictEqual(AvatarPhoto.src(), null);
    });

    await t('avec un compte : la copie de 128 px du chemin synchronisé, sinon téléchargement (session requise)', async () => {
        const uid = '0b3c8e8a-1d2f-4c5b-9a7e-6f1d2c3b4a5e', path = uid + '/avatar-1793040000000.webp';
        ctx.Auth = { isSignedIn: () => true, user: () => ({ id: uid }), session: () => ({ access_token: 'jwt' }), refreshIfNeeded: async () => {} };
        ctx.appSettings.avatarPhoto = path;
        store.chessTrainer_avatarLocal = JSON.stringify({ path, data: 'data:image/webp;base64,BBB' });
        assert.strictEqual(AvatarPhoto.src(), 'data:image/webp;base64,BBB');
        ctx.appSettings.avatarPhoto = uid + '/avatar-1793040000001.webp';                  // photo changée sur un autre appareil
        assert.strictEqual(AvatarPhoto.src(), null);
        await new Promise(r => setTimeout(r, 0));
        assert(calls.some(([u]) => u === `https://x.supabase.co/storage/v1/object/authenticated/avatars/${uid}/avatar-1793040000001.webp`));
    });

    await t('retirer : préférence vidée, copie locale effacée, fichier en ligne supprimé (son dossier seulement)', async () => {
        AvatarPhoto.remove();
        await new Promise(r => setTimeout(r, 0));
        assert.strictEqual(ctx.appSettings.avatarPhoto, '');
        assert(!('chessTrainer_avatarLocal' in store));
        assert(calls.some(([u, m]) => u === 'https://x.supabase.co/storage/v1/object/avatars' && m === 'DELETE'));
    });

    await t('schema.sql : seau privé « avatars », règles limitées au dossier de l\'utilisateur, suppression avec le compte', () => {
        const sql = fs.readFileSync('supabase/schema.sql', 'utf8');
        assert(/values \('avatars', 'avatars', false/.test(sql));
        assert.strictEqual((sql.match(/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/g) || []).length, 5);
        assert(/delete from storage\.objects where bucket_id = 'avatars'/.test(sql));
    });

    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
