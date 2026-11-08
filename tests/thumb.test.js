// Lancer : node tests/thumb.test.js   — téléphone sous le pouce : glisser sur la barre de coups, centre du dock (dock.js)
// à l'accueil et en partie. Charge index.html entier dans jsdom, avec un écran de téléphone simulé (matchMedia).
const { bootApp } = require('./_app.js');
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const ROOT = path.join(__dirname, '..');

async function boot(phone) {
    const { dom, errors } = await bootApp({ before(w) {
        w.matchMedia = q => ({ matches: phone && /max-width: 599px/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    } });
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s) };
}

(async () => {
    const { w, errors, $ } = await boot(true);
    const bar = $('#moves-bar');
    const pointer = (type, x, extra = {}) => {
        const e = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x });
        Object.defineProperty(e, 'pointerId', { value: 1 });
        Object.defineProperty(e, 'pointerType', { value: extra.type || 'touch' });
        (extra.target || bar).dispatchEvent(e);
    };
    const swipe = (from, to, extra) => { pointer('pointerdown', from, extra); pointer('pointermove', to, extra); pointer('pointerup', to, extra); };
    const pos = () => w.eval('_navPos()');
    const line = () => w.eval(`startGame('w'); loadPositionFromPath(['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4']); moveHistory.length`);

    await t('glisser vers la droite recule, vers la gauche avance, un coup tous les 26 px', () => {
        assert.strictEqual(line(), 6);
        assert.strictEqual(pos(), 5);
        swipe(200, 253);
        assert.strictEqual(pos(), 3, '53 px : deux coups en arrière');
        swipe(200, 174);
        assert.strictEqual(pos(), 4, '26 px : un coup en avant');
    });
    await t('une ligne chargée d’un coup : ‹ est disponible tout de suite', () => {
        line();
        assert.strictEqual($('#btn-prev').disabled, false);
    });
    await t('un petit mouvement reste un toucher, et le clic qui suit un glissement ne choisit pas de coup', () => {
        line();
        swipe(200, 205);
        assert.strictEqual(pos(), 5);
        const tok = bar.querySelector('[data-i="1"]');
        pointer('pointerdown', 200, { target: tok }); pointer('pointerup', 202, { target: tok });
        tok.click();
        assert.strictEqual(pos(), 1, 'toucher un coup le choisit');
        line();
        swipe(200, 226);
        assert.strictEqual(pos(), 4);
        bar.querySelector('[data-i="1"]').click();
        assert.strictEqual(pos(), 4, 'clic de fin de glissement ignoré');
        bar.querySelector('[data-i="1"]').click();
        assert.strictEqual(pos(), 1, 'le clic suivant compte');
    });
    await t('ni à la souris, ni tiroir ouvert, ni en Finales', () => {
        line();
        swipe(200, 260, { type: 'mouse' });
        assert.strictEqual(pos(), 5);
        w.eval('setSheetOpen(true)');
        swipe(200, 260);
        assert.strictEqual(pos(), 5);
        w.eval('setSheetOpen(false)');
        w.eval(`gameMode = 'endgame'`);
        swipe(200, 260);
        assert.strictEqual(pos(), 5);
        w.eval(`gameMode = 'play'; goHome('play')`);
    });
    await t('accueil : l’action pleine et la capsule Suite rejoignent le centre du dock, son action marche encore', () => {
        w.eval('renderHomeSummary()');
        const c = $('#nav-center');
        assert(/Commencer/.test(c.textContent), 'répertoire vide : ' + c.textContent);
        assert.strictEqual(w.document.querySelectorAll('#hp-today .hp-cta').length, 1, 'le bouton d’origine reste (caché sur téléphone)');
        assert(!$('#hp-dock'), 'plus de #hp-dock');
        w.eval(`UI_ACTIONS.homePick('b')`);
        assert(/Noirs/.test(c.title), 'le choix de couleur suit');
        w.eval('Dock.runHome()');
        assert.strictEqual(w.eval('gameMode + playerColor'), 'playb');
    });
    await t('en partie : centre jamais désactivé (Arbre sans indice possible), ✕ = quitter', () => {
        const c = $('#dock-center');
        assert.strictEqual(c.hidden, false);
        assert(/Arbre|Indice/.test(c.textContent), c.textContent);
        assert(!c.disabled);
        w.eval('Dock.exit()');
        assert(w.document.getElementById('game-screen').classList.contains('hidden'), 'retour à l’accueil');
    });
    await t('fiche Moi : Compte, Paramètres, Aide, thème et main du pouce ; la main se garde sur l’appareil', () => {
        assert($('#me-btn') && $('#me-btn').hasAttribute('data-backup-dot'), 'le point de sauvegarde passe sur Moi');
        w.eval('MeSheet.open()');
        const sh = $('#me-sheet');
        assert(w.eval('MeSheet.isOpen()'));
        ['settings', 'help'].forEach(a => assert(sh.querySelector(`[data-me="${a}"]`), a));
        assert.strictEqual(sh.querySelectorAll('[data-me="theme"]').length, 3);
        sh.querySelector('[data-me="hand"][data-v="left"]').click();
        assert.strictEqual(w.document.documentElement.dataset.hand, 'left');
        assert.strictEqual(JSON.parse(w.localStorage.getItem('chessTrainer_settings')).thumbHand, 'left', 'préférence locale');
        assert(!/thumbHand/.test(w.localStorage.getItem('chessTrainer_prefs') || ''), 'jamais synchronisée');
        sh.querySelector('[data-me="hand"][data-v="right"]').click();
        sh.querySelector('[data-me="help"]').click();
        assert(!w.eval('MeSheet.isOpen()'), 'une destination referme la fiche');
        w.eval('closeHelp && closeHelp()');
    });
    await t('pages : le centre porte l’action de Statistiques et des Finales ; une catégorie de finale se replie', () => {
        w.eval(`goHome('stats')`);
        const c = $('#nav-center');
        if ($('#home-tab-stats .st-go')) assert(/Réviser|Faiblesses/.test(c.textContent), c.textContent);
        w.eval(`switchHomeTab('endgame')`);
        assert(/Commencer|Au hasard/.test(c.textContent), c.textContent);
        const open = w.document.querySelectorAll('#endgame-panel .eg-sec.is-open');
        assert.strictEqual(open.length, 1, 'une seule catégorie ouverte');
        const id = open[0].id.slice(7);
        w.eval(`UI_ACTIONS.egToggle(${JSON.stringify(id)})`);
        assert.strictEqual(w.document.querySelectorAll('#endgame-panel .eg-sec.is-open').length, 0);
        assert.strictEqual(open[0].querySelector('.eg-sec-tg').getAttribute('aria-expanded'), 'false');
        w.eval(`switchHomeTab('play')`);
    });
    await t('sur ordinateur : rien ne bouge, le centre reste vide', async () => {
        const d = await boot(false);
        d.w.eval('renderHomeSummary()');
        assert.strictEqual(d.$('#nav-center').textContent, '');
        assert.strictEqual(d.w.document.querySelectorAll('#hp-today .hp-cta').length, 1);
        assert.deepStrictEqual(d.errors, []);
    });
    await t('Corriger passe dans « Plus » ; la barre et sa place sont déclarées', () => {
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        assert(/class="btn btn-tool tb-more" onclick="undoMove\(\)"/.test(html));
        assert(/id="dock-center" onclick="Dock\.runGame\(\)"/.test(html) && /class="btn btn-tool dock-more"/.test(html), 'centre et Plus du dock');
        assert(/\.game-main \{ padding-bottom: calc\(var\(--thumb-h\)/.test(css), "l'échiquier se pose sur la barre (Ergonomie, lot 2)");
    });
    await t('aucune erreur', () => assert.deepStrictEqual(errors, []));
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
