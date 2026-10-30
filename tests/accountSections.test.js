// Lancer : node tests/accountSections.test.js   — Compte « carte d'identité » (lot 7) : trois rubriques, jauge du
// mot de passe (PwMeter), atelier d'avatar (AvatarStudio), état de la synchronisation, Zone sensible.
let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (e) { console.log('jsdom absent : « npm i jsdom » puis relancez (test d\'interface ignoré).'); process.exit(0); }
const fs = require('fs'), assert = require('assert');
const makeBackend = require('./_fakeBackend.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const flush = async () => { for (let i = 0; i < 6; i++) await tick(0); };

async function boot(backend) {
    const dom = new JSDOM(`<!DOCTYPE html><body><div class="app"><nav class="topnav"><div class="topnav-right"></div></nav>
        <div id="help-overlay" class="overlay hidden"></div><div id="confirm-overlay" class="overlay hidden"></div></div></body>`,
        { url: 'https://chays.test/app/', runScripts: 'dangerously' });
    const w = dom.window;
    w.fetch = backend.fetch; w.__exports = 0;
    w.eval(`window.askConfirm = (m, ok) => ok(); window.exportDB = () => { window.__exports++; }; window.ico = n => '<svg class="ico" data-i="' + n + '"></svg>';`);
    w.matchMedia = () => ({ matches: false, addEventListener() {} });
    const add = code => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
    ['js/core/utils.js', 'js/core/storageAdapter.js', 'js/core/syncModel.js', 'js/core/settings.js', 'js/core/panelKit.js'].forEach(f => add(fs.readFileSync(f, 'utf8')));
    add("const CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'anon' };");
    ['js/core/cloudClient.js', 'js/core/cloudAdapter.js', 'js/core/auth.js', 'js/core/accountUI.js'].forEach(f => add(fs.readFileSync(f, 'utf8')));
    await tick(20);
    return w;
}
const $  = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];
const click = (w, sel) => $(w, sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const typeIn = (w, sel, val) => { const e = $(w, sel); e.value = val; e.dispatchEvent(new w.Event('input', { bubbles: true })); };
const text = (w, sel) => ($(w, sel) || { textContent: '' }).textContent;
const section = (w, id) => click(w, `[data-pn="section"][data-key="${id}"]`);

(async () => {
    const be = makeBackend(); be.addUser('ana@test.fr', 'motdepasse1');
    const w = await boot(be);

    // ─── Hors connexion ───────────────────────────────────────────────────────
    await t('création de compte : plus de phrase « 8 caractères minimum », la jauge la remplace', async () => {
        click(w, '#account-btn'); click(w, '[data-act="view:signup"]');
        assert(!/8 caractères minimum/.test($(w, '#account-overlay').textContent));
        assert(!$(w, '#account-overlay .set-hint'));
        assert($(w, '.acct-pwm')); assert.strictEqual($(w, 'input[name=password]').getAttribute('aria-describedby'), 'acct-pwm');
    });

    const checkMeter = (label) => {
        for (let k = 0; k <= 10; k++) {
            typeIn(w, 'input[name=password]', 'x'.repeat(k));
            const on = $$(w, '.acct-pwm i.on').length, b = $(w, '.account-submit');
            assert.strictEqual($$(w, '.acct-pwm i').length, 8, label);
            assert.strictEqual(on, Math.min(k, 8), `${label} : ${k} caractères`);
            assert.strictEqual($(w, '.acct-pwm').classList.contains('is-done'), k >= 8);
            assert.match(text(w, '.acct-pwm b'), new RegExp(`${Math.min(k, 8)}/8`));
            assert.strictEqual($(w, '.acct-pwm').getAttribute('aria-valuenow'), String(Math.min(k, 8)));
            assert.strictEqual(b.disabled, k < 8, `${label} : bouton à ${k} caractères`);
            if (k < 8) assert.match(b.title, /8 caractères minimum/); else assert.strictEqual(b.getAttribute('title'), null);
        }
    };
    await t('PwMeter (création) : 0 à 8 encoches selon la longueur, bouton désactivé sous 8 avec la raison en infobulle', async () => {
        checkMeter('création');
    });
    await t('erreur en ligne sous le champ, effacée à la saisie ; la vérification à l\'envoi est gardée', async () => {
        typeIn(w, 'input[name=email]', 'pas-un-mail'); typeIn(w, 'input[name=password]', 'court');
        $(w, '[data-form="auth"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
        assert.match(text(w, '[data-field="email"] .acct-ferr'), /invalide/);
        typeIn(w, 'input[name=email]', 'ana@test.fr');
        assert(!$(w, '[data-field="email"] .acct-ferr')); assert.strictEqual($(w, 'input[name=email]').getAttribute('aria-invalid'), null);
        $(w, '[data-form="auth"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
        assert.match(text(w, '[data-field="password"] .acct-ferr'), /8 caractères minimum/);
    });
    await t('connexion : une colonne, Google puis « ou », e-mail, mot de passe, un seul bouton plein ; pas de jauge', async () => {
        click(w, '[data-act="view:auth"]');
        assert.strictEqual($$(w, '#account-overlay .btn-primary').length, 1);
        assert(!$(w, '.acct-pwm')); assert($(w, '[data-field="password"] [data-act="view:recover"]'));
        assert.strictEqual($(w, '.account-submit').disabled, false);
    });

    // ─── Compte connecté ──────────────────────────────────────────────────────
    await t('exactement trois rubriques : Profil, Synchronisation, Sécurité (« Données du compte » disparaît)', async () => {
        await w.eval('Auth').signIn('ana@test.fr', 'motdepasse1'); await flush();
        click(w, '#account-btn');
        assert.deepStrictEqual($$(w, '.pn-nav [data-pn="section"]').map(b => b.dataset.key), ['profil', 'synchronisation', 'securite']);
        const labels = $$(w, '.pn-nav [data-pn="section"] span').map(s => s.firstChild.textContent.trim());
        assert.deepStrictEqual(labels, ['Profil', 'Synchronisation', 'Sécurité']);
        assert.strictEqual(text(w, '.pn-nav [data-key="profil"] small'), 'Pseudo, avatar');
        assert(!/Données du compte|niveau/i.test($(w, '.pn-nav').textContent));
    });
    await t('Exporter dans Synchronisation ; déconnexion et suppression dans Sécurité', async () => {
        section(w, 'profil');
        ['export', 'signout', 'signout-erase', 'delete-ask'].forEach(a => assert(!$(w, `.pn-content [data-act="${a}"]`), `Profil sans ${a}`));
        section(w, 'synchronisation');
        assert($(w, '.pn-content [data-act="export"]')); assert(!$(w, '.pn-content [data-act="signout"]')); assert(!$(w, '.pn-content [data-act="delete-ask"]'));
        click(w, '.pn-content [data-act="export"]'); assert.strictEqual(w.__exports, 1);
        section(w, 'securite');
        ['signout', 'signout-erase', 'delete-ask'].forEach(a => assert($(w, `.pn-content [data-act="${a}"]`), a));
        assert(!$(w, '.pn-content [data-act="export"]'));
        assert.match($(w, '.acct-danger').previousElementSibling.textContent, /Zone sensible/);
    });
    await t('Zone sensible : confirmation forte (SUPPRIMER), bouton désactivé tant que le mot n\'est pas tapé', async () => {
        click(w, '[data-act="delete-ask"]');
        const b = () => $(w, '[data-act="delete-account"]');
        assert.strictEqual(b().disabled, true); assert.match(b().title, /SUPPRIMER/);
        typeIn(w, '#account-delete-confirm', 'SUPPR'); assert.strictEqual(b().disabled, true);
        typeIn(w, '#account-delete-confirm', 'supprimer'); assert.strictEqual(b().disabled, false);
        click(w, '[data-act="delete-cancel"]'); assert(!$(w, '#account-delete-confirm'));
    });
    await t('Synchronisation : l\'état en grand suit setSyncStatus (ok, en cours, hors ligne, erreur), une seule action pleine', async () => {
        section(w, 'synchronisation');
        const A = w.eval('AccountUI');
        for (const [lv, title] of [['busy', 'en cours'], ['offline', 'Hors ligne'], ['error', 'échec'], ['ok', 'À jour']]) {
            A.setSyncStatus(lv, 'Texte ' + lv);
            assert.strictEqual($(w, '#account-sync-hero').dataset.level, lv);
            assert(text(w, '#account-sync-hero b').includes(title), lv);
            assert.strictEqual(text(w, '#account-sync-text'), 'Texte ' + lv);
            assert.match(text(w, '[data-act="sync-now"]'), lv === 'error' ? /Réessayer/ : /Synchroniser maintenant/);
        }
        assert.match(text(w, '#account-sync-hero'), /Dernière synchronisation : à l’instant/);
        assert.strictEqual($$(w, '#account-overlay .btn-primary').length, 1);
    });
    await t('Profil : carte d\'identité (avatar, pseudo, e-mail) sans le classement, puis l\'atelier', async () => {
        w.eval("appSettings.pseudo = 'Ana'; appSettings.elo = '1650';");
        section(w, 'profil');
        const card = $(w, '.pn-content > .acct-id');
        assert(card && card === $(w, '.pn-content > .account-msg').nextElementSibling, 'carte en tête');
        assert($(w, '.acct-id .avatar.acct-id-avatar'));
        assert.strictEqual(text(w, '#acct-name'), 'Ana'); assert.strictEqual(text(w, '#acct-sub'), 'ana@test.fr');
        assert(!/Elo|1650/.test(card.textContent));
        assert($(w, '.acct-id + .pn-h + .acct-studio'));
        assert($(w, '[data-key="dailyGoal"]')); assert($(w, '[data-key="lichessUser"]')); assert($(w, '[data-key="chesscomUser"]'));
    });
    await t('AvatarStudio : 18 motifs, 7 couleurs avec « Échiquier » en tête ; choisir un motif écrit la préférence existante', async () => {
        assert.strictEqual($$(w, '.acct-tiles .acct-tile').length, 18);
        const sw = $$(w, '.acct-swatches .acct-swatch');
        assert.strictEqual(sw.length, 7); assert.strictEqual(sw[0].dataset.v, 'theme'); assert.match(sw[0].title, /Échiquier/);
        assert.match(sw[0].querySelector('i').getAttribute('style'), /--theme-dark-deep.*--theme-light-refined/);
        click(w, '.acct-tile[data-v="av-fox"]');
        assert.strictEqual(w.eval('appSettings.avatarGlyph'), 'av-fox');
        assert.strictEqual(JSON.parse(w.localStorage.getItem('chessTrainer_prefs')).avatarGlyph.v, 'av-fox');
        assert.strictEqual($(w, '.acct-tile[aria-checked="true"]').dataset.v, 'av-fox');
        click(w, '.acct-swatch[data-v="nuit"]');
        assert.strictEqual(w.eval('appSettings.avatarColor'), 'nuit');
        assert.match(text(w, '.acct-studio-h'), /Nuit/);
        assert.match($(w, '#account-btn .avatar').getAttribute('style'), /#2c3f62/);              // barre du haut à jour
    });
    await t('AvatarStudio : segment Photo (choisir une photo), retour au motif', async () => {
        click(w, '[data-act="studio:photo"]');
        assert.strictEqual($(w, '[data-act="studio:photo"]').getAttribute('aria-selected'), 'true');
        assert($(w, '[data-act="photo-pick"]')); assert(!$(w, '.acct-tiles'));
        click(w, '[data-act="studio:motif"]'); assert($(w, '.acct-tiles'));
    });
    await t('.avatar : seule --size change (section du lot 7 de css/account.css)', async () => {
        const css = fs.readFileSync('css/account.css', 'utf8');
        const lot = css.slice(css.indexOf("─── COMPTE CARTE D'IDENTITÉ (LOT 7) ───"));
        assert(lot.length > 100, 'section du lot 7 présente');
        const rules = [...lot.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => /avatar\b/.test(sel));
        assert(rules.length >= 4);
        rules.forEach(([, sel, body]) => {
            const props = body.split(';').map(d => d.split(':')[0].trim()).filter(Boolean);
            assert.deepStrictEqual(props, ['--size'], sel.trim());
        });
        // Les avatars de la fenêtre ne reçoivent en ligne que leurs couleurs.
        $$(w, '#account-overlay .avatar').forEach(a => assert.match(a.getAttribute('style'), /^background:[^;]+;color:[^;]+$/));
    });
    await t('grille des motifs : 6 × 3 par PanelKit.balancedCols, sur téléphone comme sur ordinateur', async () => {
        const P = w.eval('PanelKit');
        [300, 340, 420, 560].forEach(width => assert.strictEqual(P.balancedCols(18, width, 44, 6), 6, String(width)));
    });
    await t('nouveau mot de passe : même jauge, bouton désactivé sous 8 caractères', async () => {
        w.eval('AccountUI').open('newpw');
        assert($(w, '[data-form="newpw"] .acct-pwm'));
        checkMeter('nouveau mot de passe');
    });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error('ÉCHEC :', e.stack || e.message); process.exit(1); });
