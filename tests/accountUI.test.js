// Lancer : npm i jsdom (une fois) puis  node tests/accountUI.test.js   — interface testée dans un faux navigateur
let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (e) { console.log('jsdom absent : « npm i jsdom » puis relancez (test d\'interface ignoré).'); process.exit(0); }
const fs = require('fs'), assert = require('assert');
const makeBackend = require('./_fakeBackend.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const flush = async () => { for (let i = 0; i < 6; i++) await tick(0); };

function boot({ backend, store = {}, confirmAnswer = true } = {}) {
    const dom = new JSDOM(`<!DOCTYPE html><body><div class="app"><nav class="topnav"><div class="topnav-right"><button id="settings-btn"></button></div></nav>
        <div id="help-overlay" class="overlay hidden"></div>
        <div id="confirm-overlay" class="overlay hidden"><div id="confirm-text"></div><button id="confirm-ok-btn"></button><button id="confirm-cancel-btn"></button></div></div></body>`,
        { url: 'https://chays.test/app/', runScripts: 'dangerously' });
    const w = dom.window;
    Object.entries(store).forEach(([k, v]) => w.localStorage.setItem(k, v));
    w.fetch = backend.fetch;
    w.__confirms = []; w.__exports = 0; w.__reloads = 0;
    w.eval(`window.askConfirm = (msg, ok) => { window.__confirms.push(msg); ${confirmAnswer ? 'ok();' : ''} };
            window.exportDB = () => { window.__exports++; }; window.ico = () => '';`);
    const add = code => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
    ['js/core/storageAdapter.js', 'js/core/syncModel.js'].forEach(f => add(fs.readFileSync(f, 'utf8')));
    add("const CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'anon' };");
    ['js/core/cloudClient.js', 'js/core/cloudAdapter.js', 'js/core/auth.js', 'js/core/accountUI.js'].forEach(f => add(fs.readFileSync(f, 'utf8')));
    // location.reload n'est pas implémenté par jsdom : on compte les appels via un espion posé sur Auth.signOut → wipeLocal → reload
    return w;
}
const bootA = async o => { const w = boot(o); await tick(20); return w; };   // attend DOMContentLoaded
const $  = (w, s) => w.document.querySelector(s);
const type = (w, sel, val) => { const e = $(w, sel); e.value = val; };
const click = (w, sel) => $(w, sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const submit = (w, sel) => $(w, sel).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
const text = (w, sel) => ($(w, sel) || { textContent: '' }).textContent;
const visible = w => !$(w, '#account-overlay').classList.contains('hidden');

(async () => {
    await t('service non configuré : aucune interface ajoutée', async () => {
        const dom = new JSDOM('<body><div class="app"><nav><div class="topnav-right"></div></nav><div id="help-overlay"></div></div></body>', { url: 'https://chays.test/', runScripts: 'dangerously' });
        const w = dom.window; w.fetch = () => {}; w.eval('window.ico=()=>""');
        ['js/core/storageAdapter.js', 'js/core/syncModel.js'].forEach(f => { const s = w.document.createElement('script'); s.textContent = fs.readFileSync(f, 'utf8'); w.document.body.appendChild(s); });
        const s0 = w.document.createElement('script'); s0.textContent = "const CLOUD_CONFIG = { url: '', anonKey: '' };"; w.document.body.appendChild(s0);
        ['js/core/cloudClient.js', 'js/core/cloudAdapter.js', 'js/core/auth.js', 'js/core/accountUI.js'].forEach(f => { const s = w.document.createElement('script'); s.textContent = fs.readFileSync(f, 'utf8'); w.document.body.appendChild(s); });
        assert.strictEqual(w.document.getElementById('account-btn'), null); assert.strictEqual(w.document.getElementById('account-overlay'), null);
    });

    const be = makeBackend(); be.addUser('ana@test.fr', 'motdepasse1');
    const w = await bootA({ backend: be });

    await t('bouton « Compte » injecté en tête de la barre du haut, fenêtre fermée', async () => {
        const b = $(w, '.topnav-right').firstElementChild; assert.strictEqual(b.id, 'account-btn'); assert(!visible(w));
        assert.match(b.title, /non connecté/);
    });
    await t('la fenêtre est placée avant l\'aide et la confirmation (elles passent au-dessus)', async () => {
        const ids = [...w.document.querySelectorAll('.app > *')].map(e => e.id); 
        assert(ids.indexOf('account-overlay') < ids.indexOf('help-overlay') && ids.indexOf('help-overlay') < ids.indexOf('confirm-overlay'));
    });
    await t('ouverture : formulaire de connexion, onglets Connexion / Créer un compte', async () => {
        click(w, '#account-btn'); assert(visible(w));
        assert($(w, '[data-form="auth"]')); assert.match(text(w, '.account-submit'), /Se connecter/); assert($(w, '[data-act="view:recover"]'));
        click(w, '[data-act="mode:signup"]'); assert.match(text(w, '.account-submit'), /Créer mon compte/); assert(!$(w, '[data-act="view:recover"]'));
        click(w, '[data-act="mode:signin"]');
    });
    await t('validation : e-mail invalide, mot de passe vide → message, aucun appel réseau', async () => {
        const k = be.log.length;
        type(w, 'input[name=email]', 'pas-un-mail'); type(w, 'input[name=password]', 'x'); submit(w, '[data-form="auth"]');
        assert.match(text(w, '.account-msg'), /invalide/);
        type(w, 'input[name=email]', 'ana@test.fr'); type(w, 'input[name=password]', ''); submit(w, '[data-form="auth"]');
        assert.match(text(w, '.account-msg'), /mot de passe/i); assert.strictEqual(be.log.length, k);
    });
    await t('afficher / masquer le mot de passe', async () => {
        click(w, '[data-act="eye"]'); assert.strictEqual($(w, 'input[name=password]').type, 'text'); assert.match(text(w, '[data-act="eye"]'), /Masquer/);
        click(w, '[data-act="eye"]'); assert.strictEqual($(w, 'input[name=password]').type, 'password');
    });
    await t('mauvais mot de passe → message d\'erreur affiché dans la fenêtre', async () => {
        type(w, 'input[name=email]', 'ana@test.fr'); type(w, 'input[name=password]', 'faux-faux'); submit(w, '[data-form="auth"]'); await flush();
        assert.match(text(w, '.account-msg'), /incorrect/); assert.strictEqual($(w, '.account-submit').disabled, false);
    });
    await t('connexion réussie (cloud vide, appareil vide) → vue Compte, e-mail, pastille verte, intention « merge » silencieuse', async () => {
        type(w, 'input[name=password]', 'motdepasse1'); submit(w, '[data-form="auth"]'); await flush();
        assert.match(text(w, '.account-email'), /ana@test\.fr/); assert.match(text(w, '#account-sync-text'), /Connecté/);
        assert($(w, '#account-btn').classList.contains('has-session')); assert.match($(w, '#account-btn').title, /ana@test\.fr/);
        assert.strictEqual(JSON.parse(w.localStorage.getItem('chessTrainer_syncIntent')).strategy, 'merge');
    });
    await t('setSyncStatus (futur moteur) : texte et pastille mis à jour', async () => {
        w.eval('AccountUI').setSyncStatus('busy', 'Synchronisation…');
        assert.match(text(w, '#account-sync-text'), /Synchronisation/); assert.strictEqual($(w, '#account-btn').dataset.sync, 'busy');
        w.eval('AccountUI').setSyncStatus('ok', 'À jour');
    });
    await t('Échap ferme la fenêtre ; clic sur le fond aussi', async () => {
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); assert(!visible(w));
        click(w, '#account-btn'); $(w, '#account-overlay').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true })); assert(!visible(w));
    });
    await t('déconnexion simple : retour au formulaire, données locales intactes', async () => {
        w.localStorage.setItem('openingDB_Général_w', '{"p":{"move":"e2e4"}}');
        click(w, '#account-btn'); click(w, '[data-act="signout"]'); await flush();
        assert($(w, '[data-form="auth"]')); assert.strictEqual(w.localStorage.getItem('openingDB_Général_w'), '{"p":{"move":"e2e4"}}');
        assert.match($(w, '#account-btn').title, /non connecté/);
    });

    await t('première synchro — appareil avec données, cloud vide → « upload » automatique + tout marqué à envoyer', async () => {
        const be2 = makeBackend(); be2.addUser('ana@test.fr', 'motdepasse1');
        const w2 = await bootA({ backend: be2, store: { openingDB_Général_w: JSON.stringify({ a: { move: 'e2e4' }, b: { move: 'd2d4' } }) } });
        await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        assert.strictEqual(JSON.parse(w2.localStorage.getItem('chessTrainer_syncIntent')).strategy, 'upload');
        assert('openingDB_Général_w' in w2.eval('SyncMeta').dirtySnapshot()); assert.match(text(w2, '.account-toast span'), /2 positions/);
    });
    await t('première synchro — appareil vide, cloud avec données → « download » automatique (rien à perdre)', async () => {
        const be2 = makeBackend(); const u = be2.addUser('ana@test.fr', 'motdepasse1'); be2.addDoc(u.id, 'openingDB_Général_w', { x: { move: 'c2c4' } });
        const w2 = await bootA({ backend: be2 });
        await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        assert.strictEqual(JSON.parse(w2.localStorage.getItem('chessTrainer_syncIntent')).strategy, 'download');
        assert.deepStrictEqual(Object.keys(w2.eval('SyncMeta').dirtySnapshot()), []); assert.match(text(w2, '.account-toast span'), /1 position/);
    });

    const mkBoth = async opts => {
        const be2 = makeBackend(); const u = be2.addUser('ana@test.fr', 'motdepasse1'); be2.addDoc(u.id, 'openingDB_Général_w', { x: { move: 'c2c4' }, y: { move: 'g1f3' }, z: { move: 'b1c3' } });
        return bootA(Object.assign({ backend: be2, store: { openingDB_Général_w: JSON.stringify({ a: { move: 'e2e4' }, b: { move: 'd2d4' } }) } }, opts));
    };
    await t('première synchro — les deux côtés ont des données → fenêtre de choix avec les deux comptes de positions', async () => {
        const w2 = await mkBoth(); await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        assert(visible(w2)); assert.match(text(w2, '.panel-sub'), /2 positions/); assert.match(text(w2, '.panel-sub'), /3 positions/);
        assert.strictEqual(w2.document.querySelectorAll('.account-choice').length, 3); assert(!w2.localStorage.getItem('chessTrainer_syncIntent'));
    });
    await t('choix « Fusionner » : intention enregistrée, tout marqué à envoyer, événement émis, aucune confirmation', async () => {
        const w2 = await mkBoth(); await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        let evt = null; w2.addEventListener('chays-sync-intent', e => { evt = e.detail; });
        click(w2, '[data-act="strategy:merge"]');
        assert.strictEqual(JSON.parse(w2.localStorage.getItem('chessTrainer_syncIntent')).strategy, 'merge'); assert.strictEqual(evt.strategy, 'merge');
        assert('openingDB_Général_w' in w2.eval('SyncMeta').dirtySnapshot()); assert.strictEqual(w2.__confirms.length, 0); assert.strictEqual(w2.__exports, 0);
        assert($(w2, '.account-email'));
    });
    await t('choix « Envoyer cet appareil » : demande confirmation avant d\'appliquer', async () => {
        const w2 = await mkBoth({ confirmAnswer: false }); await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        click(w2, '[data-act="strategy:upload"]'); assert.strictEqual(w2.__confirms.length, 1); assert(!w2.localStorage.getItem('chessTrainer_syncIntent'));
    });
    await t('choix « Récupérer mon compte » : confirmation + sauvegarde JSON automatique, rien n\'est marqué à envoyer', async () => {
        const w2 = await mkBoth(); await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        click(w2, '[data-act="strategy:download"]');
        assert.strictEqual(w2.__confirms.length, 1); assert.strictEqual(w2.__exports, 1);
        assert.strictEqual(JSON.parse(w2.localStorage.getItem('chessTrainer_syncIntent')).strategy, 'download'); assert.deepStrictEqual(Object.keys(w2.eval('SyncMeta').dirtySnapshot()), []);
    });
    await t('« Plus tard » : fenêtre fermée, aucune intention ; le choix est reproposé à la prochaine ouverture de session', async () => {
        const w2 = await mkBoth(); await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        click(w2, '[data-act="close"]'); assert(!visible(w2)); assert(!w2.localStorage.getItem('chessTrainer_syncIntent'));
        await w2.eval('AccountUI').ensureIntent(); assert(visible(w2)); assert($(w2, '.account-choices'));
    });
    await t('intention déjà enregistrée pour ce compte : aucune nouvelle question', async () => {
        const w2 = await mkBoth(); await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush(); click(w2, '[data-act="strategy:merge"]');
        w2.document.getElementById('account-overlay').classList.add('hidden'); await w2.eval('AccountUI').ensureIntent(); assert(!visible(w2));
    });
    await t('autre compte sur l\'appareil : avertissement affiché dans le choix', async () => {
        const be2 = makeBackend(); be2.addUser('ana@test.fr', 'motdepasse1'); const bob = be2.addUser('bob@test.fr', 'motdepasse2');
        be2.addDoc(bob.id, 'openingDB_Général_w', { x: { move: 'c2c4' } });
        const w2 = await bootA({ backend: be2, store: { openingDB_Général_w: JSON.stringify({ a: { move: 'e2e4' } }) } });
        await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush(); await w2.eval('Auth').signOut();
        await w2.eval('Auth').signIn('bob@test.fr', 'motdepasse2'); await flush();
        assert.match(text(w2, '.pgn-note.warn'), /autre compte/);
    });

    await t('« Se déconnecter et effacer » : confirmation (avec le nombre de modifications perdues), puis effacement des données synchronisées', async () => {
        const be2 = makeBackend(); be2.addUser('ana@test.fr', 'motdepasse1');
        const w2 = await bootA({ backend: be2 });
        let reloaded = 0; try { Object.defineProperty(w2.location, 'reload', { value: () => { reloaded++; } }); } catch (e) {}
        await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        w2.eval('dataStore').set('openingDB_Général_w', '{"p":1}'); w2.eval('dataStore').set('chessTrainer_theme', 'light');
        click(w2, '#account-btn'); 
        let threw = null; try { click(w2, '[data-act="signout-erase"]'); await flush(); } catch (e) { threw = e; }
        assert.match(w2.__confirms[0], /1 modification non synchronisée sera définitivement perdue/);
        assert.strictEqual(w2.localStorage.getItem('openingDB_Général_w'), null); assert.strictEqual(w2.localStorage.getItem('chessTrainer_session'), null);
        assert.strictEqual(w2.localStorage.getItem('chessTrainer_syncMeta'), null);
        assert.strictEqual(w2.localStorage.getItem('chessTrainer_theme'), 'light');                  // préférence d'appareil conservée
        assert(!w2.eval('Auth').isSignedIn());
    });

    await t('inscription avec confirmation : message de succès, retour sur « Connexion »', async () => {
        const w2 = await bootA({ backend: makeBackend({ confirmEmail: true }) });
        click(w2, '#account-btn'); click(w2, '[data-act="mode:signup"]');
        type(w2, 'input[name=email]', 'new@test.fr'); type(w2, 'input[name=password]', 'court'); submit(w2, '[data-form="auth"]');
        assert.match(text(w2, '.account-msg'), /8 caractères/);
        type(w2, 'input[name=password]', 'motdepasse1'); submit(w2, '[data-form="auth"]'); await flush();
        assert.match(text(w2, '.account-msg'), /confirmation.*new@test\.fr/); assert.match(text(w2, '.account-submit'), /Se connecter/);
    });
    await t('mot de passe oublié : vue dédiée, message neutre, retour', async () => {
        const w2 = await bootA({ backend: makeBackend() });
        click(w2, '#account-btn'); click(w2, '[data-act="view:recover"]'); assert($(w2, '[data-form="recover"]'));
        type(w2, 'input[name=email]', 'qui@test.fr'); submit(w2, '[data-form="recover"]'); await flush();
        assert.match(text(w2, '.account-msg'), /Si un compte existe/); click(w2, '[data-act="view:auth"]'); assert($(w2, '[data-form="auth"]'));
    });
    await t('lien de réinitialisation : la fenêtre « Nouveau mot de passe » s\'ouvre toute seule', async () => {
        const be2 = makeBackend(); const u = be2.addUser('ana@test.fr', 'motdepasse1'); const tok = be2.token(u);
        const dom = new JSDOM(`<!DOCTYPE html><body><div class="app"><nav><div class="topnav-right"></div></nav><div id="help-overlay" class="overlay hidden"></div></div></body>`,
            { url: `https://chays.test/app/#access_token=${tok.access_token}&refresh_token=${tok.refresh_token}&type=recovery`, runScripts: 'dangerously' });
        const w2 = dom.window; w2.fetch = be2.fetch; w2.eval('window.ico=()=>"";');
        const add = code => { const s = w2.document.createElement('script'); s.textContent = code; w2.document.body.appendChild(s); };
        ['js/core/storageAdapter.js', 'js/core/syncModel.js'].forEach(f => add(fs.readFileSync(f, 'utf8')));
        add("const CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'anon' };");
        ['js/core/cloudClient.js', 'js/core/cloudAdapter.js', 'js/core/auth.js', 'js/core/accountUI.js'].forEach(f => add(fs.readFileSync(f, 'utf8')));
        await tick(40); await flush();
        assert(visible(w2)); assert($(w2, '[data-form="newpw"]'));
        type(w2, 'input[name=password]', 'nouveau-mdp-9'); submit(w2, '[data-form="newpw"]'); await flush();
        assert.match(text(w2, '.account-msg'), /modifié/); assert.strictEqual(be2.users.get('ana@test.fr').password, 'nouveau-mdp-9');
    });
    await t('échappement : un e-mail contenant du HTML s\'affiche comme texte (pas d\'injection)', async () => {
        const be2 = makeBackend(); be2.addUser('<img src=x onerror=alert(1)>@t.fr', 'motdepasse1');
        const w2 = await bootA({ backend: be2 }); await w2.eval('Auth').signIn('<img src=x onerror=alert(1)>@t.fr', 'motdepasse1'); await flush(); click(w2, '#account-btn');
        assert.strictEqual(w2.document.querySelector('.account-email img'), null); assert.match(text(w2, '.account-email'), /<img src=x/);
    });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error('ÉCHEC :', e.stack || e.message); process.exit(1); });
