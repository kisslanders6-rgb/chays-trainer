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

    await t('étendue selon data-side, jamais en partie', () => {
        assert(bloc.includes('html[data-side="wide"]:not(:has(.topnav .in-game)) { --side-w: 240px; }'));
        assert(/\.topnav:has\(\.in-game\) \.topnav-wm \{ display: none; \}/.test(bloc), 'en partie : rail, sans le nom');
        assert(!/min-width: 1440px/.test(bloc), 'le seuil automatique vit dans sideBarMode et le script de tête');
    });

    await t('séance guidée : ni onglets ni logo pour quitter', () => {
        assert(bloc.includes('html[data-session] #topnav-tabs-setup { display: none; }'));
        assert(bloc.includes('html[data-session] .topnav-brand { pointer-events: none; }'));
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

    // Démarre l'application avec la barre latérale ; rail : largeur non lisible dans jsdom, donc rail sauf feuille ajoutée.
    async function side({ hover = true, wide = false, storage } = {}) {
        const { dom, errors } = await bootApp({ storage, before: w => {
            const mq = { matches: true, addEventListener() {} };
            w.matchMedia = q => q === '(min-width: 1100px)' ? mq : { matches: q === '(hover: hover)' ? hover : false, addEventListener() {} };
            w.scrollTo = () => {};
            if (wide) w.getComputedStyle = (g => (el, p) => { const s = g(el, p); return el === w.document.documentElement ? { getPropertyValue: q => q === '--side-w' ? '240px' : s.getPropertyValue(q) } : s; })(w.getComputedStyle.bind(w));
        } });
        const w = dom.window, doc = w.document;
        return { w, doc, errors, $: s => doc.querySelector(s), tick: () => new Promise(r => w.setTimeout(r, 0)) };
    }
    const openMenus = doc => [...doc.querySelectorAll('.sb-menu.open')].map(m => m.dataset.menu);
    const entry = (doc, key) => doc.querySelector(`.sb-it[data-key="${key}"]`);

    await t('un menu par rubrique, avec les vraies destinations', async () => {
        const { doc, errors } = await side();
        assert.deepStrictEqual(errors, []);
        assert.deepStrictEqual([...doc.querySelectorAll('.sb-menu')].map(m => m.dataset.menu), ['play', 'stats', 'training', 'endgame']);
        assert.strictEqual(doc.querySelectorAll('.sb-menu[data-menu="endgame"] .sb-it').length, 6, 'une entrée par catégorie');
        assert.strictEqual(entry(doc, 'endgame.pions').querySelector('em').textContent, '17');
        assert.deepStrictEqual([...doc.querySelectorAll('.sb-menu[data-menu="stats"] .sb-it')].map(b => b.dataset.key), ['stats.overview', 'stats.openings', 'stats.games', 'stats.regularity'], 'les onglets de la page, sans sous-niveau');
        assert(!doc.querySelector('.sb-kids, .sb-chev'), 'ni accordéon ni chevron');
    });

    await t('barre étendue : seul le sous-menu de l’onglet actif est déplié, et il le reste', async () => {
        const { doc, $, tick } = await side({ wide: true });
        await tick();
        assert.deepStrictEqual(openMenus(doc), ['play']);
        $('#nav-tab-stats').click();
        await tick();
        assert($('#nav-tab-stats').classList.contains('active'), 'le clic change d’onglet');
        assert.deepStrictEqual(openMenus(doc), ['stats']);
        $('#nav-tab-stats').click();
        await tick();
        assert.deepStrictEqual(openMenus(doc), ['stats'], 'un second clic ne replie rien');
        entry(doc, 'stats.openings').click();
        assert.deepStrictEqual(openMenus(doc), ['stats'], 'choisir une entrée ne change rien à la barre');
    });

    await t('rail à la souris : le clic change d’onglet ; au toucher, il ouvre le volet sans changer d’onglet', async () => {
        const souris = await side({ hover: true });
        souris.$('#nav-tab-stats').click();
        assert(souris.$('#nav-tab-stats').classList.contains('active'));
        assert.deepStrictEqual(openMenus(souris.doc), []);

        const doigt = await side({ hover: false });
        doigt.$('#nav-tab-stats').click();
        assert(!doigt.$('#nav-tab-stats').classList.contains('active'));
        assert.deepStrictEqual(openMenus(doigt.doc), ['stats']);
        doigt.$('.sb-menu.open .sb-title').click();
        assert(doigt.$('#nav-tab-stats').classList.contains('active'), 'le titre du volet mène à l’onglet');
        assert.deepStrictEqual(openMenus(doigt.doc), []);
    });

    await t('une entrée mène à l’onglet et appelle l’action existante ; un toucher ailleurs ferme le volet', async () => {
        const { doc, w, $ } = await side({ hover: false });
        $('#nav-tab-endgame').click();
        assert.deepStrictEqual(openMenus(doc), ['endgame']);
        let saut = null;
        const prev = w.eval('UI_ACTIONS.egJump');
        w.eval('UI_ACTIONS').egJump = id => { saut = id; prev(id); };
        entry(doc, 'endgame.tours').click();
        assert.strictEqual(saut, 'tours');
        assert($('#nav-tab-endgame').classList.contains('active'));
        assert.deepStrictEqual(openMenus(doc), []);
        $('#nav-tab-training').click();
        assert.deepStrictEqual(openMenus(doc), ['training']);
        doc.body.click();
        assert.deepStrictEqual(openMenus(doc), []);
    });

    await t('Parties : l’entrée ouvre l’onglet de la page, marquée comme choisie', async () => {
        const { doc, w } = await side({ wide: true });
        const panes = [];
        const prev = w.eval('UI_ACTIONS.statsPane');
        w.eval('UI_ACTIONS').statsPane = p => { panes.push(p); prev(p); };
        entry(doc, 'stats.games').click();
        assert.deepStrictEqual(panes, ['games']);
        assert(entry(doc, 'stats.games').classList.contains('on'));
    });

    await t('Reprendre n’apparaît que si une partie peut reprendre', async () => {
        const { doc, $, w, tick } = await side({ wide: true });
        assert.strictEqual(entry(doc, 'play.resume').hidden, !doc.querySelector('[data-action="resumeLastPlay"]'));
        $('#resume-slot').innerHTML = '<button data-action="resumeLastPlay"></button>';
        $('#nav-tab-stats').click(); await tick(); $('#nav-tab-play').click(); await tick();
        assert.strictEqual(entry(doc, 'play.resume').hidden, false);
        assert(w);
    });

    await t('préférence : automatique par défaut, le bouton et B la changent, propre à l’appareil, relue au lancement', async () => {
        const large = q => q === '(min-width: 1100px)' || q === '(min-width: 1440px)';
        const boot = async storage => bootApp({ storage, before: w => {
            w.matchMedia = q => ({ matches: large(q), addEventListener() {} });
            w.scrollTo = () => {};
        } });
        const { dom } = await boot();
        const w = dom.window, doc = w.document, root = doc.documentElement;
        assert.strictEqual(w.eval('appSettings.sideBar'), 'auto');
        assert.strictEqual(root.getAttribute('data-side'), 'wide', 'automatique : étendue dès 1 440 px');
        w.eval('setPref("sideBar", "rail")');
        assert.strictEqual(root.getAttribute('data-side'), 'rail');
        assert.strictEqual(JSON.parse(w.localStorage.getItem('chessTrainer_settings')).sideBar, 'rail');
        assert(!/sideBar/.test(w.localStorage.getItem('chessTrainer_prefs') || ''), 'jamais synchronisée');

        const relu = await boot({ chessTrainer_settings: JSON.stringify({ sideBar: 'rail' }) });
        assert.strictEqual(relu.dom.window.document.documentElement.getAttribute('data-side'), 'rail', 'relue au lancement');
        const bad = await boot({ chessTrainer_settings: JSON.stringify({ sideBar: 'x' }) });
        assert.strictEqual(bad.dom.window.eval('appSettings.sideBar'), 'auto', 'valeur invalide : le défaut');

        const wide = await side({ wide: true });
        wide.$('#side-toggle').click();
        assert.strictEqual(wide.w.eval('appSettings.sideBar'), 'rail', 'étendue : le bouton replie');
        assert.strictEqual(wide.$('#side-toggle').title, 'Replier la barre');

        const rail = await side();
        rail.doc.dispatchEvent(new rail.w.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
        assert.strictEqual(rail.w.eval('appSettings.sideBar'), 'wide', 'B hors partie');
        assert.strictEqual(rail.$('#side-toggle').title, 'Étendre la barre');
    });

    await t('quitter une partie par le menu garde le rail ; seul le bouton l’étend, sans toucher à la préférence', async () => {
        const { dom } = await bootApp({ before: w => {
            w.matchMedia = q => ({ matches: q === '(min-width: 1100px)' || q === '(min-width: 1440px)' || q === '(hover: hover)', addEventListener() {} });
            w.scrollTo = () => {};
        } });
        const w = dom.window, doc = w.document, root = doc.documentElement;
        assert.strictEqual(root.getAttribute('data-side'), 'wide');
        w.eval('startGame("w")');
        assert(!doc.getElementById('game-screen').classList.contains('hidden'), 'en partie');
        entry(doc, 'stats.openings').click();
        assert(doc.getElementById('game-screen').classList.contains('hidden'), 'la partie est quittée');
        assert.strictEqual(root.getAttribute('data-side'), 'rail', 'pas de saut à 240 px');
        assert.strictEqual(w.eval('SideBar.held()'), true);
        doc.getElementById('side-toggle').click();
        assert.strictEqual(root.getAttribute('data-side'), 'wide', 'le bouton l’étend');
        assert.strictEqual(w.eval('appSettings.sideBar'), 'auto', 'préférence inchangée');
        assert.strictEqual(doc.getElementById('side-toggle').querySelector('use').getAttribute('href'), '#i-panel-open', 'icône de panneau');
    });

    await t('sous 1 100 px, B ne fait rien', async () => {
        const { dom } = await bootApp();
        const w = dom.window;
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
        assert.strictEqual(w.eval('appSettings.sideBar'), 'auto');
    });

    await t('séance : data-session suit la séance guidée', async () => {
        const { doc, w } = await side();
        w.eval('gameMode = "training"; trainingState.session = { kind: "due", items: [{}], cur: 0, i: 0 }; try { Suite.refresh(); } catch (e) {}');
        assert(doc.documentElement.hasAttribute('data-session'));
        w.eval('trainingState.session = null; gameMode = "play"; Suite.refresh();');
        assert(!doc.documentElement.hasAttribute('data-session'));
    });

    await t('sous 1 100 px : plus aucun menu, les onglets redeviennent ce qu’ils étaient', async () => {
        let mq;
        const { dom } = await bootApp({ before: w => { mq = listener(w, true); w.scrollTo = () => {}; } });
        const doc = dom.window.document;
        assert(doc.querySelector('.sb-menu') && doc.querySelector('.topnav-pill #side-toggle'), 'menus et bouton dans la pilule');
        mq.cb({ matches: false });
        assert(!doc.querySelector('.sb-menu') && !doc.querySelector('#side-toggle'));
        assert(!doc.querySelector('#nav-tab-play').hasAttribute('tabindex'));
        assert.strictEqual(doc.querySelector('#nav-tab-play').nextElementSibling.id, 'nav-tab-stats', 'filets entre onglets intacts');
    });

    console.log(`\n${n} tests passés`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
