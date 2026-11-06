// Lancer : node tests/palette.test.js   — palette de recherche (core/palette.js) : classement, récents, ⌘F et ⌘K, seconde pression
// laissée au navigateur, recherche de la fenêtre ouverte, séance guidée protégée. Charge index.html entier dans jsdom, comme boot.test.js.
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const ROOT = path.join(__dirname, '..');

class DiskLoader extends ResourceLoader {
    fetch(url) {
        const u = new URL(url);
        if (u.hostname !== 'localhost') return Promise.resolve(Buffer.from(''));
        return fs.promises.readFile(path.join(ROOT, decodeURIComponent(u.pathname)));
    }
}

async function boot() {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
        url: 'http://localhost/index.html', runScripts: 'dangerously', resources: new DiskLoader(), pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(w) {
            w.localStorage.setItem('chessTrainer_onboarded', '1');
            w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
            w.Element.prototype.getAnimations = () => [];
            w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
            w.Element.prototype.scrollIntoView = () => {};
            w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
            w.addEventListener('error', e => errors.push(e.message));
        }
    });
    await new Promise(r => dom.window.addEventListener('load', r));
    await new Promise(r => setTimeout(r, 4000));
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s) };
}

(async () => {
    const { w, errors, $ } = await boot();
    const P = w.eval('Palette');
    const press = (key, opts = {}, target = w.document.body) => {
        const e = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
        target.dispatchEvent(e);
        return e;
    };
    const type = q => { const i = $('.pal-input'); i.value = q; i.dispatchEvent(new w.Event('input', { bubbles: true })); };
    const titles = () => [...w.document.querySelectorAll('.pal-row b')].map(x => x.textContent);
    const items = [
        { id: 'a', group: 'Actions', title: 'Corbeille', small: 'Restaurer' },
        { id: 'b', group: 'Réglages', title: 'Échiquier', small: 'Apparence', words: 'Noyer Bois' },
        { id: 'c', group: 'Ouvertures', title: 'Défense sicilienne', small: 'Noirs' },
        { id: 'd', group: 'Positions', title: '1. e4', needsDigit: true, words: 'e4 c5' },
        { id: 'e', group: 'Actions', title: 'Aide', suggest: true }
    ];

    const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));

    await t('recherche sans accents ni casse, tous les mots requis', () => {
        same(P.results('echiquier', items).map(x => x.id), ['b']);
        same(P.results('noyer', items).map(x => x.id), ['b']);
        same(P.results('défense SICIL', items).map(x => x.id), ['c']);
        same(P.results('défense noyer', items), []);
    });
    await t('une position ne se cherche qu’avec un chiffre', () => {
        same(P.results('e', items).filter(x => x.id === 'd'), []);
        same(P.results('e4', items).map(x => x.id), ['d']);
    });
    await t('sans texte : récents puis suggestions, sans doublon ni récent disparu', () => {
        same(P.results('', items, ['c', 'zz', 'e']).map(x => [x.id, x.group]), [['c', 'Récents'], ['e', 'Récents']]);
        same(P.results('', items, []).map(x => x.id), ['e']);
    });
    await t('le répertoire passe avant les autres ouvertures et l’Aide, même moins bien classé', () => {
        const list = [{ id: 'x', group: 'Autres ouvertures', title: 'Sicilienne Alapin' }, { id: 'y', group: 'Ouvertures', title: 'Défense sicilienne' }, { id: 'z', group: 'Aide', title: 'Sicilienne, comment faire' }];
        same(P.results('sicil', list).map(x => x.id), ['y', 'x', 'z']);
    });
    await t('la loupe ouvre la palette, Échap la ferme', () => {
        $('#palette-btn').click();
        assert(P.isOpen());
        assert(titles().length > 0, 'suggestions à l’ouverture');
        press('Escape', {}, $('.pal-input'));
        assert(!P.isOpen());
    });
    await t('Ctrl+F ouvre ; la seconde pression ferme et laisse passer le navigateur', () => {
        assert(press('f', { ctrlKey: true }).defaultPrevented);
        assert(P.isOpen());
        assert(!press('f', { ctrlKey: true }, $('.pal-input')).defaultPrevented);
        assert(!P.isOpen());
    });
    await t('Ctrl+K ouvre et ferme sans jamais laisser passer', () => {
        assert(press('k', { ctrlKey: true }).defaultPrevented);
        assert(press('k', { ctrlKey: true }, $('.pal-input')).defaultPrevented);
        assert(!P.isOpen());
    });
    await t('un F seul ne déclenche pas la palette ; les touches restent dans le champ', () => {
        press('f');
        assert(!P.isOpen());
        press('k', { ctrlKey: true });
        const before = w.document.documentElement.dataset.theme;
        press('d', {}, $('.pal-input'));
        assert.strictEqual(w.document.documentElement.dataset.theme, before, 'D tapé dans le champ ne change pas le thème');
        press('Escape', {}, $('.pal-input'));
    });
    await t('catalogue réel : réglage, finale et ouverture hors répertoire trouvés ; ↓ et Entrée ouvrent', () => {
        press('k', { ctrlKey: true });
        type('noyer');
        assert(titles().includes('Échiquier'), titles().join());
        type('lucena');
        assert(titles().some(x => /Lucena/.test(x)), titles().join());
        type('caro-kann');
        assert(titles().some(x => /Caro/.test(x)), titles().join());
        type('statistiques');
        assert.strictEqual(titles()[0], 'Statistiques');
        press('Enter', {}, $('.pal-input'));
        assert(!P.isOpen());
        assert.strictEqual(w.document.querySelector('.topnav-tab.active').id, 'nav-tab-stats');
        assert.strictEqual(JSON.parse(w.localStorage.getItem('chessTrainer_paletteRecent'))[0], 'act:stats');
        w.eval("switchHomeTab('play')");
    });
    await t('une fenêtre avec recherche garde ⌘F dans son champ', () => {
        w.eval('showSettings()');
        w.document.activeElement.blur();
        const e = press('f', { ctrlKey: true });
        assert(e.defaultPrevented);
        assert(!P.isOpen());
        assert.strictEqual(w.document.activeElement.dataset.pn, 'search');
        assert(!press('f', { ctrlKey: true }, w.document.activeElement).defaultPrevented, 'seconde pression pour le navigateur');
        w.eval('SettingsPanel.close()');
    });
    await t('en séance guidée, rien de ce qui quitte la séance n’est proposé', () => {
        w.eval(`trainingState.session = { kind: 'review', items: [{}], i: 0, cur: 0 }`);
        press('k', { ctrlKey: true });
        type('statistiques');
        assert(![...w.document.querySelectorAll('.pal-row small')].some(x => x.textContent === 'Onglet'), 'pas d’onglet à ouvrir');
        type('noyer');
        assert(titles().includes('Échiquier'), 'les réglages restent');
        press('Escape', {}, $('.pal-input'));
        w.eval('trainingState.session = null');
    });
    await t('chaque icône du catalogue existe dans le sprite', () => {
        const src = fs.readFileSync(path.join(ROOT, 'js/core/palette.js'), 'utf8');
        const names = [...src.matchAll(/a\('[\w-]+', '([\w-]+)'/g), ...src.matchAll(/icon: '([\w-]+)'/g)].map(m => m[1]);
        assert(names.length > 15);
        const sprite = fs.readFileSync(path.join(ROOT, 'js/core/icons.js'), 'utf8');
        names.forEach(x => assert(sprite.includes(`'${x}':`), x));
    });
    await t('aucune erreur au chargement', () => assert.deepStrictEqual(errors, []));
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
