// Lancer : node tests/board/captures.test.js   — pièces prises et avantage matériel (captures.js) : calcul pur, promotion,
// lignes de l'écran de jeu, navigation, retournement, réglage. Charge index.html entier dans jsdom, comme boot.test.js.
const { bootApp } = require('../_app.js');
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const ROOT = path.join(__dirname, '..', '..');

async function boot() {
    const { dom, errors } = await bootApp();
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s) };
}

(async () => {
    const { w, errors, $ } = await boot();
    const C = (a, b) => JSON.parse(JSON.stringify(w.eval(`Captures.compute(${JSON.stringify(a)}, ${JSON.stringify(b)})`)));
    const start = ['K', 'Q', 'R', 'N', 'P', 'P', 'k', 'q', 'r', 'n', 'p', 'p', ''];

    await t('calcul : pièces manquantes par camp, « diff » positif quand les Blancs mènent', () => {
        const r = C(start, ['K', 'Q', 'R', 'N', 'P', 'P', 'k', 'r', 'n', 'p', 'p', '', '']);
        assert.deepStrictEqual(r.taken.w, { q: 1 }, 'les Blancs ont pris la Dame');
        assert.deepStrictEqual(r.taken.b, {});
        assert.strictEqual(r.diff, 9);
        const e = C(start, start);
        assert.strictEqual(e.diff, 0);
        assert.deepStrictEqual(e.taken, { w: {}, b: {} });
    });

    await t('promotion : le pion promu n\'est pas une prise, mais le matériel compte', () => {
        const r = C(start, ['K', 'Q', 'Q', 'R', 'N', 'P', 'k', 'q', 'r', 'n', 'p', 'p', '']);
        assert.deepStrictEqual(r.taken.b, { }, 'aucun pion blanc pris');
        assert.strictEqual(r.diff, 8, 'Dame en plus, pion en moins');
    });

    await t('écran de jeu : ordre pions, Fous, Cavaliers ; « +N » du seul côté en avance ; les coups et ◀ suivent', () => {
        w.eval(`startGame('w')`);
        const play = ucis => w.eval(`(() => { const i = s => (Number(s[1]) - 1) * 8 + s.charCodeAt(0) - 97;
            ${JSON.stringify(ucis)}.forEach(u => Chess && executeMoveForTest(i(u.slice(0, 2)), i(u.slice(2, 4)))); })()`);
        w.eval(`window.executeMoveForTest = (f, t) => applyMove(f, t, null, null)`);
        assert.strictEqual($('#cap-top').querySelectorAll('.cap-pc').length, 0, 'départ : rien de pris');
        assert(!$('#cap-bot .cap-diff'));
        play(['e2e4', 'd7d5', 'e4d5']);
        w.eval('renderBoard()');
        const bot = $('#cap-bot'), top = $('#cap-top');
        assert.strictEqual(bot.querySelectorAll('.cap-pc').length, 1, 'les Blancs, en bas, ont pris un pion');
        assert(bot.querySelector('.cap-pc.is-b img'), 'pion noir, image du jeu actif');
        assert.strictEqual(bot.querySelector('.cap-diff').textContent, '+1');
        assert(!top.querySelector('.cap-diff'), 'pas de « +N » pour les Noirs');
        assert(/Blancs : 1 pion pris, avantage de 1/.test(bot.getAttribute('aria-label')), bot.getAttribute('aria-label'));
        w.eval('navPrev()');
        assert.strictEqual($('#cap-bot').querySelectorAll('.cap-pc').length, 0, '◀ : la prise n\'a pas encore eu lieu');
        w.eval('navNext()');
        assert.strictEqual($('#cap-bot').querySelectorAll('.cap-pc').length, 1);
    });

    await t('retourner : chaque ligne suit son camp', () => {
        w.eval('flipBoard()');
        assert.strictEqual($('#cap-top .cap-who').textContent, 'Blancs');
        assert.strictEqual($('#cap-top').querySelectorAll('.cap-pc').length, 1);
        assert.strictEqual($('#cap-bot .cap-who').textContent, 'Noirs');
        w.eval('flipBoard()');
    });

    await t('réglage « Pièces prises » : attribut data-captures, présent dans les Paramètres, synchronisé', () => {
        assert.strictEqual(w.document.documentElement.getAttribute('data-captures'), 'on');
        w.eval(`setPref('captures', false)`);
        assert.strictEqual(w.document.documentElement.getAttribute('data-captures'), 'off');
        w.eval(`setPref('captures', true)`);
        assert(w.eval(`'captures' in SYNCED_PREFS`));
        w.showSettings('apparence');
        assert($('#settings-overlay [data-key="captures"]'), 'interrupteur');
        w.closeSettings();
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
