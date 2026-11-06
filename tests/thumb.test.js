// Lancer : node tests/thumb.test.js   — téléphone sous le pouce : glisser sur la barre de coups, action principale de l'accueil
// dans #hp-dock. Charge index.html entier dans jsdom, avec un écran de téléphone simulé (matchMedia).
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

async function boot(phone) {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
        url: 'http://localhost/index.html', runScripts: 'dangerously', resources: new DiskLoader(), pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(w) {
            w.localStorage.setItem('chessTrainer_onboarded', '1');
            w.matchMedia = q => ({ matches: phone && /max-width: 599px/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
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
    await t('accueil : l’action principale est dans #hp-dock, une seule, et son action marche encore', () => {
        w.eval('renderHomeSummary()');
        const dock = $('#hp-dock');
        assert.strictEqual(dock.hidden, false);
        assert.strictEqual(dock.querySelectorAll('.hp-cta').length, 1);
        assert.strictEqual(w.document.querySelectorAll('#hp-today .hp-cta').length, 0);
        assert(/Commencer avec les Blancs/.test(dock.textContent), 'répertoire vide');
        w.eval(`UI_ACTIONS.homePick('b')`);
        assert(/Commencer avec les Noirs/.test(dock.textContent), 'le choix de couleur suit');
        dock.querySelector('.hp-cta').click();
        assert.strictEqual(w.eval('gameMode + playerColor'), 'playb');
        w.eval(`goHome('play')`);
    });
    await t('sur ordinateur : rien ne bouge, le dock reste vide', async () => {
        const d = await boot(false);
        d.w.eval('renderHomeSummary()');
        assert.strictEqual(d.$('#hp-dock').hidden, true);
        assert.strictEqual(d.w.document.querySelectorAll('#hp-today .hp-cta').length, 1);
        assert.deepStrictEqual(d.errors, []);
    });
    await t('Corriger passe dans « Plus » ; la barre et sa place sont déclarées', () => {
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        assert(/class="btn btn-tool tb-more" onclick="undoMove\(\)"/.test(html));
        assert(/\.side-panel \{ padding-bottom: calc\(var\(--thumb-h\)/.test(css));
    });
    await t('aucune erreur', () => assert.deepStrictEqual(errors, []));
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
