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
            window.askConfirmChoice = (msg, labels, withBackup, without) => { window.__confirms.push(msg); (window.__backupFirst ? withBackup : without)(); };
            window.exportDB = () => { window.__exports++; }; window.ico = () => '';`);
    const add = code => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
    w.matchMedia = () => ({ matches: false, addEventListener() {} });
    ['js/core/utils.js', 'js/core/storageAdapter.js', 'js/core/syncModel.js', 'js/core/settings.js', 'js/core/panelKit.js'].forEach(f => add(fs.readFileSync(f, 'utf8')));
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
        click(w, '[data-act="view:signup"]'); assert.match(text(w, '.account-submit'), /Créer mon compte/); assert(!$(w, '[data-act="view:recover"]'));
        assert.match(text(w, '.account-auth-title'), /Créer un compte/); assert.match(text(w, '.account-switch'), /Déjà un compte/);
        click(w, '[data-act="view:auth"]'); assert.match(text(w, '.account-auth-title'), /Se connecter/);
    });
    await t('validation : e-mail invalide, mot de passe vide → message, aucun appel réseau', async () => {
        const k = be.log.length;
        type(w, 'input[name=email]', 'pas-un-mail'); type(w, 'input[name=password]', 'x'); submit(w, '[data-form="auth"]');
        assert.match(text(w, '[data-field="email"] .acct-ferr'), /invalide/);                     // erreur en ligne, sous le champ
        assert.strictEqual($(w, 'input[name=email]').getAttribute('aria-invalid'), 'true');
        type(w, 'input[name=email]', 'ana@test.fr'); type(w, 'input[name=password]', ''); submit(w, '[data-form="auth"]');
        assert(!$(w, '[data-field="email"] .acct-ferr'));
        assert.match(text(w, '[data-field="password"] .acct-ferr'), /mot de passe/i); assert.strictEqual(be.log.length, k);
    });
    await t('afficher / masquer le mot de passe', async () => {
        click(w, '[data-act="eye"]'); assert.strictEqual($(w, 'input[name=password]').type, 'text'); assert.match(text(w, '[data-act="eye"]'), /Masquer/);
        click(w, '[data-act="eye"]'); assert.strictEqual($(w, 'input[name=password]').type, 'password');
    });
    await t('mauvais mot de passe → message d\'erreur affiché dans la fenêtre', async () => {
        type(w, 'input[name=email]', 'ana@test.fr'); type(w, 'input[name=password]', 'faux-faux'); submit(w, '[data-form="auth"]'); await flush();
        assert.match(text(w, '[data-field="password"] .acct-ferr'), /incorrect/); assert.strictEqual($(w, '.account-submit').disabled, false);
    });
    await t('après l\'erreur : l\'autre vue est proposée, l\'e-mail déjà rempli ; retour à la connexion', async () => {
        assert.match(text(w, '[data-act="swap"]'), /Créer un compte avec cette adresse/);
        click(w, '[data-act="swap"]');
        assert.match(text(w, '.account-auth-title'), /Créer un compte/); assert.strictEqual($(w, 'input[name=email]').value, 'ana@test.fr');
        click(w, '[data-act="view:auth"]'); assert.strictEqual($(w, 'input[name=email]').value, 'ana@test.fr');
    });
    await t('lien par e-mail : une option de la connexion, pas une vue à part', async () => {
        click(w, '[data-act="link:on"]'); assert($(w, '[data-form="link"]')); assert(!$(w, 'input[name=password]'));
        click(w, '[data-act="link:off"]'); assert($(w, '[data-form="auth"]'));
    });
    await t('nouveau compte : création et première connexion à moins d\'une minute, nom proposé', async () => {
        const A = w.eval('AccountUI');
        assert.strictEqual(A.isNewUser({ created_at: '2026-10-26T10:00:00Z', last_sign_in_at: '2026-10-26T10:00:20Z' }), true);
        assert.strictEqual(A.isNewUser({ created_at: '2026-10-20T10:00:00Z', last_sign_in_at: '2026-10-26T10:00:20Z' }), false);
        assert.strictEqual(A.suggestedName({ email: 'ana@test.fr', user_metadata: { full_name: 'Ana Lopez' } }), 'Ana Lopez');
        assert.strictEqual(A.suggestedName({ email: 'ana@test.fr', user_metadata: {} }), 'ana');
    });
    await t('connexion réussie (cloud vide, appareil vide) → vue Compte, e-mail, pastille verte, intention « merge » silencieuse', async () => {
        type(w, 'input[name=password]', 'motdepasse1'); submit(w, '[data-form="auth"]'); await flush();
        assert.match(text(w, '#acct-name'), /ana@test\.fr/);
        click(w, '[data-pn="section"][data-key="synchronisation"]'); assert.match(text(w, '#account-sync-text'), /Connecté/);
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
        click(w, '#account-btn'); click(w, '[data-pn="section"][data-key="securite"]'); click(w, '[data-act="signout"]'); await flush();
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
        assert.strictEqual(w2.__exports, 0);                                       // aucune sauvegarde téléchargée sans demande
    });

    const mkBoth = async opts => {
        const be2 = makeBackend(); const u = be2.addUser('ana@test.fr', 'motdepasse1'); be2.addDoc(u.id, 'openingDB_Général_w', { x: { move: 'c2c4' }, y: { move: 'g1f3' }, z: { move: 'b1c3' } });
        return bootA(Object.assign({ backend: be2, store: { openingDB_Général_w: JSON.stringify({ a: { move: 'e2e4' }, b: { move: 'd2d4' } }) } }, opts));
    };
    await t('première synchro — les deux côtés ont des données → fenêtre de choix avec les deux comptes de positions', async () => {
        const w2 = await mkBoth(); await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        assert(visible(w2)); assert.match(text(w2, '.acct-vs'), /2.*Cet appareil.*3.*Compte/s);
        assert.strictEqual(w2.document.querySelectorAll('.account-choice').length, 3); assert(!w2.localStorage.getItem('chessTrainer_syncIntent'));
        assert.strictEqual($(w2, '.account-choice[aria-checked="true"]').dataset.act, 'choose:merge');       // fusion choisie d'avance
        assert.strictEqual(w2.document.querySelectorAll('#account-overlay .btn-primary').length, 1);        // une seule action pleine
        click(w2, '[data-act="choose:upload"]'); assert(!w2.localStorage.getItem('chessTrainer_syncIntent'));  // choisir une carte n'envoie rien
        assert.strictEqual($(w2, '.account-choice[aria-checked="true"]').dataset.act, 'choose:upload');
    });
    await t('choix « Fusionner » : intention enregistrée, tout marqué à envoyer, événement émis, aucune confirmation', async () => {
        const w2 = await mkBoth(); await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        let evt = null; w2.addEventListener('chays-sync-intent', e => { evt = e.detail; });
        click(w2, '[data-act="choose:merge"]'); click(w2, '[data-act="strategy-go"]');
        assert.strictEqual(JSON.parse(w2.localStorage.getItem('chessTrainer_syncIntent')).strategy, 'merge'); assert.strictEqual(evt.strategy, 'merge');
        assert('openingDB_Général_w' in w2.eval('SyncMeta').dirtySnapshot()); assert.strictEqual(w2.__confirms.length, 0); assert.strictEqual(w2.__exports, 0);
        assert($(w2, '#acct-name'));
    });
    await t('choix « Envoyer cet appareil » : demande confirmation avant d\'appliquer', async () => {
        const w2 = await mkBoth({ confirmAnswer: false }); await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        click(w2, '[data-act="choose:upload"]'); click(w2, '[data-act="strategy-go"]'); assert.strictEqual(w2.__confirms.length, 1); assert(!w2.localStorage.getItem('chessTrainer_syncIntent'));
    });
    await t('choix « Récupérer mon compte » : confirmation, sauvegarde locale seulement si demandée, rien n\'est marqué à envoyer', async () => {
        for (const backupFirst of [true, false]) {
            const w2 = await mkBoth(); w2.__backupFirst = backupFirst;
            await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
            click(w2, '[data-act="choose:download"]'); click(w2, '[data-act="strategy-go"]');
            assert.strictEqual(w2.__confirms.length, 1); assert.strictEqual(w2.__exports, backupFirst ? 1 : 0);
            assert.strictEqual(JSON.parse(w2.localStorage.getItem('chessTrainer_syncIntent')).strategy, 'download'); assert.deepStrictEqual(Object.keys(w2.eval('SyncMeta').dirtySnapshot()), []);
        }
    });
    await t('« Plus tard » : fenêtre fermée, aucune intention ; le choix est reproposé à la prochaine ouverture de session', async () => {
        const w2 = await mkBoth(); await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        click(w2, '[data-act="close"]'); assert(!visible(w2)); assert(!w2.localStorage.getItem('chessTrainer_syncIntent'));
        await w2.eval('AccountUI').ensureIntent(); assert(visible(w2)); assert($(w2, '.account-choices'));
    });
    await t('intention déjà enregistrée pour ce compte : aucune nouvelle question', async () => {
        const w2 = await mkBoth(); await w2.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush(); click(w2, '[data-act="strategy-go"]');
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
        click(w2, '#account-btn'); click(w2, '[data-pn="section"][data-key="securite"]');
        let threw = null; try { click(w2, '[data-act="signout-erase"]'); await flush(); } catch (e) { threw = e; }
        assert.match(w2.__confirms[0], /1 modification non synchronisée sera définitivement perdue/);
        assert.strictEqual(w2.localStorage.getItem('openingDB_Général_w'), null); assert.strictEqual(w2.localStorage.getItem('chessTrainer_session'), null);
        assert.strictEqual(w2.localStorage.getItem('chessTrainer_syncMeta'), null);
        assert.strictEqual(w2.localStorage.getItem('chessTrainer_theme'), 'light');                  // préférence d'appareil conservée
        assert(!w2.eval('Auth').isSignedIn());
    });

    await t('inscription avec confirmation : message de succès, retour sur « Connexion »', async () => {
        const w2 = await bootA({ backend: makeBackend({ confirmEmail: true }) });
        click(w2, '#account-btn'); click(w2, '[data-act="view:signup"]');
        type(w2, 'input[name=email]', 'new@test.fr'); type(w2, 'input[name=password]', 'court'); submit(w2, '[data-form="auth"]');
        assert.match(text(w2, '[data-field="password"] .acct-ferr'), /8 caractères/);
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
        const w2 = dom.window; w2.fetch = be2.fetch; w2.eval('window.ico=()=>"";'); w2.matchMedia = () => ({ matches: false, addEventListener() {} });
        w2.localStorage.setItem('chessTrainer_authFlow', JSON.stringify({ kind: 'recovery', at: Date.now() }));   // démarche lancée sur cet appareil
        const add = code => { const s = w2.document.createElement('script'); s.textContent = code; w2.document.body.appendChild(s); };
        ['js/core/utils.js', 'js/core/storageAdapter.js', 'js/core/syncModel.js', 'js/core/settings.js', 'js/core/panelKit.js'].forEach(f => add(fs.readFileSync(f, 'utf8')));
        add("const CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'anon' };");
        ['js/core/cloudClient.js', 'js/core/cloudAdapter.js', 'js/core/auth.js', 'js/core/accountUI.js'].forEach(f => add(fs.readFileSync(f, 'utf8')));
        await tick(40); await flush();
        assert(visible(w2)); assert($(w2, '[data-form="newpw"]'));
        type(w2, 'input[name=password]', 'nouveau-mdp-9'); submit(w2, '[data-form="newpw"]'); await flush();
        assert.match(text(w2, '.account-msg'), /modifié/); assert.strictEqual(be2.users.get('ana@test.fr').password, 'nouveau-mdp-9');
    });
    await t('lien non demandé sur cet appareil : le compte est nommé, refus → pas connecté ; accord → connecté, rien n\'est envoyé sans choix', async () => {
        for (const yes of [false, true]) {
            const be2 = makeBackend(); const u = be2.addUser('pirate@test.fr', 'x'); const tok = be2.token(u);
            const dom = new JSDOM(`<!DOCTYPE html><body><div class="app"><nav><div class="topnav-right"></div></nav><div id="help-overlay" class="overlay hidden"></div></div></body>`,
                { url: `https://chays.test/app/#access_token=${tok.access_token}&refresh_token=${tok.refresh_token}&expires_in=3600`, runScripts: 'dangerously' });
            const w2 = dom.window; w2.fetch = be2.fetch; w2.eval('window.ico=()=>"";'); w2.matchMedia = () => ({ matches: false, addEventListener() {} });
            let asked = ''; w2.confirm = m => { asked = m; return yes; };
            w2.localStorage.setItem('openingDB_Général_w', JSON.stringify({ k1: { move: 'e2e4', san: 'e4', attempts: 0, failures: 0 } }));
            const add = code => { const s = w2.document.createElement('script'); s.textContent = code; w2.document.body.appendChild(s); };
            ['js/core/utils.js', 'js/core/storageAdapter.js', 'js/core/syncModel.js', 'js/core/settings.js', 'js/core/panelKit.js'].forEach(f => add(fs.readFileSync(f, 'utf8')));
            add("const CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'anon' };");
            ['js/core/cloudClient.js', 'js/core/cloudAdapter.js', 'js/core/auth.js', 'js/core/accountUI.js'].forEach(f => add(fs.readFileSync(f, 'utf8')));
            await tick(40); await flush(); await tick(40); await flush();
            assert.match(asked, /pirate@test\.fr/);
            assert.strictEqual(w2.eval('Auth.isSignedIn()'), yes);
            assert.strictEqual(w2.eval('SyncIntent.get()'), null);                            // aucun envoi automatique des données de l'appareil
            if (yes) assert($(w2, '[data-act="choose:upload"]'));                           // le choix est proposé
        }
    });
    await t('échappement : un e-mail contenant du HTML s\'affiche comme texte (pas d\'injection)', async () => {
        const be2 = makeBackend(); be2.addUser('<img src=x onerror=alert(1)>@t.fr', 'motdepasse1');
        const w2 = await bootA({ backend: be2 }); await w2.eval('Auth').signIn('<img src=x onerror=alert(1)>@t.fr', 'motdepasse1'); await flush(); click(w2, '#account-btn');
        assert.strictEqual(w2.document.querySelector('#acct-name img'), null); assert.match(text(w2, '#acct-name'), /<img src=x/);
    });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error('ÉCHEC :', e.stack || e.message); process.exit(1); });
