// Lancer : node tests/shell/sidebar.test.js   — barre latérale (à partir de 1 100 px) : règles CSS et déplacement de la puce de partie.
const { ROOT, bootApp, mainCss } = require('../_app.js');
const assert = require('assert'), fs = require('fs'), path = require('path');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

(async () => {
    const home = fs.readFileSync(path.join(ROOT, 'css/home.css'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const i = home.indexOf('BARRE LATÉRALE (à partir de 1 100 px)'), bloc = home.slice(i);

    await t('colonne fixe dès 1 100 px, la hauteur de la barre rendue au contenu', () => {
        assert(i > 0);
        assert(/@media \(min-width: 1100px\) \{\s+:root \{ --topnav-h: 0px; --side-w: 64px; \}/.test(bloc), 'rail par défaut, plus de hauteur réservée');
        assert(/\.topnav \{\s+position: fixed; inset: 0 auto 0 0; width: var\(--side-w\)/.test(bloc));
        assert(/\.app \{ margin-left: var\(--side-w\); width: calc\(100% - var\(--side-w\)\); \}/.test(bloc), 'le contenu commence après la barre');
    });

    await t('étendue dès 1 440 px, sauf en partie', () => {
        assert(/@media \(min-width: 1440px\) \{[\s\S]*:root:not\(:has\(\.topnav \.in-game\)\) \{ --side-w: 240px; \}/.test(bloc));
        assert(/\.topnav:has\(\.in-game\) \.topnav-wm \{ display: none; \}/.test(bloc), 'en partie : rail, sans le nom');
    });

    await t('la feuille de la barre latérale passe après les hauteurs de la barre du haut', () => {
        assert(mainCss().includes(':root { --topnav-h: 80px; }') && !home.includes('--topnav-h: 80px'));
        assert(html.indexOf('css/layout.css') < html.indexOf('css/home.css'), 'sinon --topnav-h reviendrait à 80 px');
    });

    // matchMedia simulé : jsdom n'en fournit pas.
    function listener(w, matches) {
        const mq = { matches, cb: null, addEventListener(_, f) { this.cb = f; } };
        w.matchMedia = q => q === '(min-width: 1100px)' ? mq : { matches: false, addEventListener() {} };
        return mq;
    }

    await t('la puce de partie va dans le panneau de jeu, et revient sous 1 100 px', async () => {
        let mq;
        const { dom, errors } = await bootApp({ before: w => { mq = listener(w, true); } });
        const $ = s => dom.window.document.querySelector(s);
        assert.deepStrictEqual(errors, []);
        assert($('#game-meta-slot #game-rep') && $('#game-meta-slot #game-side') && $('#game-meta-slot #stats-back'), 'dans le panneau');
        assert.strictEqual($('#topnav-tabs-game').children.length, 0);
        mq.cb({ matches: false });
        assert($('#topnav-tabs-game #game-rep') && !$('#game-meta-slot').children.length, 'de retour dans la barre');
        mq.cb({ matches: true });
        assert($('#game-meta-slot #game-rep'));
    });

    await t('chaque onglet garde son nom en infobulle, le rail ne montrant que les icônes', async () => {
        const { dom } = await bootApp();
        const tabs = [...dom.window.document.querySelectorAll('#topnav-tabs-setup div.topnav-tab')];
        assert.strictEqual(tabs.length, 4);
        tabs.forEach(tab => assert.strictEqual(tab.title, tab.querySelector('span').textContent));
    });

    console.log(`\n${n} tests passés`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
