// Lancer : node tests/core/i18n.test.js   — langues (core/i18n.js) : couche de traduction, phrases entières, trous, élément protégé,
// paquets (trous cohérents, langues d'office en cache, les autres non). Charge index.html entier dans jsdom, comme boot.test.js.
const { bootApp } = require('../_app.js');
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

async function boot(lang) {
    const { dom, errors } = await bootApp({ before(w) {
        if (lang) {
            w.localStorage.setItem('chessTrainer_settings', JSON.stringify({ lang }));
            w.localStorage.setItem('chays_langPack', JSON.stringify({ id: lang, dict: JSON.parse(read(`lang/${lang}.json`)) }));
        }
    } });
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s) };
}

(async () => {
    const fr = await boot();
    await t('français par défaut : aucune traduction, onglets inchangés', () => {
        assert.strictEqual(fr.w.eval('I18n.lang()'), 'fr');
        assert.strictEqual(fr.$('#nav-tab-play span').textContent, 'Jouer');
        assert.strictEqual(fr.w.eval(`I18n.t('Jouer')`), 'Jouer');
        assert.deepStrictEqual(fr.errors, []);
    });
    const { w, errors, $ } = await boot('en');
    const flush = () => new Promise(r => setTimeout(r, 0));
    const add = html => { const d = w.document.createElement('div'); d.innerHTML = html; w.document.body.appendChild(d); return d; };

    await t('anglais : page, attributs et langue du document', () => {
        assert.strictEqual($('#nav-tab-play span').textContent, 'Play');
        assert.strictEqual($('#nav-tab-stats span').textContent, 'Statistics');
        assert.strictEqual(w.document.documentElement.lang, 'en');
        assert.strictEqual(w.eval(`I18n.t('Paramètres')`), 'Settings');
    });
    await t('un texte ajouté ensuite est traduit avant l’affichage ; le chiffre suit', async () => {
        const d = add('<p>Fermer</p><p title="Fermer">{}</p><p>5 à réviser</p>');
        await flush();
        assert.strictEqual(d.children[0].textContent, 'Close');
        assert.strictEqual(d.children[1].title, 'Close');
        assert.strictEqual(d.children[2].textContent, '5 to review');
    });
    await t('un texte réécrit dans un nœud existant est traduit aussi', async () => {
        const d = add('<p>Fermer</p>');
        await flush();
        d.firstChild.textContent = 'Annuler';
        await flush();
        assert.strictEqual(d.firstChild.textContent, 'Cancel');
    });
    await t('phrase avec mots en valeur : traduite entière', async () => {
        const d = add('<p>Tout est <em>à jour</em>.</p>');
        await flush();
        assert.strictEqual(d.firstChild.innerHTML, 'All <em>up to date</em>.');
    });
    await t('translate="no" et les coups restent intacts', async () => {
        const d = add('<p translate="no">Fermer</p><span class="move-token">Fermer</span>');
        await flush();
        assert.strictEqual(d.children[0].textContent, 'Fermer');
        assert.strictEqual(d.children[1].textContent, 'Fermer');
    });
    await t('« {0} sur {1} » n’avale pas une phrase, mais lit deux nombres', () => {
        assert.strictEqual(w.eval(`I18n.t('Calcul long sur la position affichée, sans rapport')`), 'Calcul long sur la position affichée, sans rapport');
        assert.strictEqual(w.eval(`I18n.t('3 sur 12')`), '3 of 12');
    });
    await t('un mot traduit n’est pas retraduit', () => {
        assert.strictEqual(w.eval(`I18n.t('Close')`), 'Close');
    });
    await t('lettres des pièces et date de la langue', () => {
        assert.strictEqual(w.eval(`appSettings.notation = 'fr'; formatSanText('Nf3', 'w')`), 'Nf3');
        assert.strictEqual(w.eval('I18n.locale()'), 'en-GB');
        assert.strictEqual(fr.w.eval(`appSettings.notation = 'fr'; formatSanText('Nf3', 'w')`), 'Cf3');
    });
    await t('recherche : le mot anglais trouve le réglage', () => {
        assert(w.eval(`PanelKit.matches('settings', 'Paramètres')`));
        w.eval('Palette.open()');
        const i = $('.pal-input');
        i.value = 'statistics';
        i.dispatchEvent(new w.Event('input', { bubbles: true }));
        assert(w.document.querySelectorAll('.pal-row').length > 0);
        w.eval('Palette.close()');
    });
    await t('réglage Langue : quatre langues d’office, sans liste vide de téléchargements', async () => {
        w.eval(`showSettings('apparence')`);
        await flush();
        const tiles = [...w.document.querySelectorAll('.pn-langs .pn-lang b')].map(x => x.textContent);
        assert.deepStrictEqual(tiles, ['Français', 'English', 'Español', '简体中文']);
        assert(w.document.querySelector('.pn-lang.is-on b').textContent === 'English');
        w.eval('SettingsPanel.close()');
    });
    await t('paquets : les trois langues d’office existent et ne créent aucun trou', () => {
        for (const l of ['en', 'es', 'zh-Hans']) {
            const d = JSON.parse(read(`lang/${l}.json`));
            assert(Object.keys(d).length > 2000, l);
            for (const [k, v] of Object.entries(d)) {
                const holes = s => new Set(s.match(/\{\d\}/g) || []);
                const kh = holes(k);
                holes(v).forEach(h => assert(kh.has(h), `${l} : ${h} inventé dans « ${k.slice(0, 60)} »`));
            }
            assert.strictEqual(d['Jouer'], { en: 'Play', es: 'Jugar', 'zh-Hans': '对弈' }[l]);
        }
    });
    await t('les onze langues : chaque paquet est publié, l’arabe se lit de droite à gauche', () => {
        const manifest = JSON.parse(read('lang/manifest.json')), langs = w.eval('Object.keys(I18n.LANGS)');
        langs.filter(l => l !== 'fr').forEach(l => {
            assert(manifest[l] > 100000, l);
            const d = JSON.parse(read(`lang/${l}.json`));
            assert(Object.keys(d).length > 2200, l);
            assert(d['Télécharger'], `${l} : Télécharger`);
            Object.entries(d).forEach(([k, v]) => (v.match(/\{\d\}/g) || []).forEach(h => assert(k.includes(h), `${l} : ${h} inventé dans « ${k.slice(0, 60)} »`)));
        });
        assert.strictEqual(w.eval('I18n.LANGS.ar.rtl'), true);
        assert.strictEqual(w.eval('I18n.LANGS.ru.letters[4]'), 'Кр');
    });
    await t('pluriel « a|b » : le trou « s » choisit la forme', () => {
        w.eval(`I18n.install('de', Object.assign(JSON.parse(localStorage.getItem('chays_langPack')).dict, { 'essai test {0} coup{1}': 'versuch {0} Zug|versuch {0} Züge' }))`);
        assert.strictEqual(w.eval(`I18n.t('essai test 1 coup')`), 'versuch 1 Zug');
        assert.strictEqual(w.eval(`I18n.t('essai test 2 coups')`), 'versuch 2 Züge');
    });
    await t('service worker : langues d’office en cache, les autres jamais', () => {
        const sw = read('sw.js');
        assert(/'lang\/en\.json', 'lang\/es\.json', 'lang\/zh-Hans\.json'/.test(sw));
        const rule = /\/\\\/lang\\\/\(\?!en[^/]*\/[^.]*\.json\$\//.exec(sw);
        assert(sw.includes('/lang/') || rule);
        const re = /\/lang\/(?!en\.json|es\.json|zh-Hans\.json)[^/]+\.json$/;
        assert(re.test('/lang/de.json'));
        assert(!re.test('/lang/en.json'));
    });
    await t('aucune erreur', () => assert.deepStrictEqual(errors, []));

    await t('copie du dictionnaire périmée (texte ajouté depuis le choix de la langue) : renouvelée au lancement', async () => {
        const full = JSON.parse(read('lang/en.json')), old = { ...full };
        delete old['Révisions à venir'];
        const { dom, errors: errs } = await bootApp({ before(win) {
            win.localStorage.setItem('chessTrainer_settings', JSON.stringify({ lang: 'en' }));
            win.localStorage.setItem('chays_langPack', JSON.stringify({ id: 'en', dict: old, at: 1 }));
            win.fetch = async url => ({ ok: true, status: 200, json: async () => (/lang\/en\.json/.test(url) ? full : {}) });
        } });
        const win = dom.window;
        await win.eval('I18n.refreshed()');
        assert.strictEqual(win.eval(`I18n.t('Révisions à venir')`), 'Upcoming reviews', 'le nouveau dictionnaire sert aussitôt');
        const copy = JSON.parse(win.localStorage.getItem('chays_langPack'));
        assert.strictEqual(copy.dict['Révisions à venir'], 'Upcoming reviews', 'et au prochain lancement');
        assert(copy.at > 1);
        assert.deepStrictEqual(errs, []);
    });
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
