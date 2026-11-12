// Lancer : node tests/shell/tabTransition.test.js   — changement d'onglet (identité « Noyer gravé ») : seul le contenu
// arrive (fondu et montée de 8 px, 220 ms), jamais au premier affichage, sur le même onglet ou en animations réduites.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

(async () => {
    const { dom, errors } = await bootApp();
    const w = dom.window, calls = [];
    w.HTMLElement.prototype.animate = function (kf, opt) { calls.push({ id: this.id, kf, opt }); return { finished: Promise.resolve(), cancel() {} }; };

    await t('nouvel onglet : le contenu arrive, les barres ne bougent pas', () => {
        w.eval(`switchHomeTab('play')`);
        calls.length = 0;
        w.eval(`switchHomeTab('stats')`);
        assert.strictEqual(calls.length, 1, 'une seule animation');
        assert.strictEqual(calls[0].id, 'home-tab-stats');
        assert.strictEqual(calls[0].opt.duration, 220);
        assert.strictEqual(JSON.stringify(calls[0].kf[0]), JSON.stringify({ opacity: 0, transform: 'translateY(8px)' }));
    });

    await t('même onglet ou animations réduites : rien', () => {
        calls.length = 0;
        w.eval(`switchHomeTab('stats')`);
        assert.strictEqual(calls.length, 0, 'même onglet');
        w.eval(`appSettings.motion = 'reduced'; switchHomeTab('training')`);
        assert.strictEqual(calls.length, 0, 'animations réduites');
        w.eval(`appSettings.motion = 'system'; switchHomeTab('play')`);
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
