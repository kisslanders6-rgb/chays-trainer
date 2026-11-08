// Lancer : node tests/shell/gameCard.test.js   — carte de contexte de l'écran de jeu sur téléphone.
const { bootApp, mainCss } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

async function boot(phone) {
    const { dom, errors } = await bootApp({ before(w) {
        w.matchMedia = q => ({ matches: phone && /max-width: 599px/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    } });
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s) };
}

(async () => {
    const { w, errors, $ } = await boot(true);
    const model = () => JSON.parse(w.eval('JSON.stringify(GameCard.model())'));
    const labels = m => m.tiles.map(x => x[1]).join(',');
    const mode = m => w.eval(`gameMode = '${m}'; applyModeUI(); Bus.emit('ui:refresh');`);
    w.eval(`startGame('w')`);

    await t('Jouer : pas d’anneau, trois chiffres dont l’état de la position', () => {
        const m = model();
        assert(!m.ring);
        assert.strictEqual(labels(m), 'Positions,Coup,Position');
        assert.strictEqual(m.tiles[1][0], 1, 'premier coup');
        assert.strictEqual(m.tiles[2][0], 'Nouvelle', 'répertoire vide');
        assert($('#gc-ring').hidden && !$('#gc-tiles').hidden);
    });

    await t('Entraînement : position sur le total ; justes, erreurs, série', () => {
        w.eval(`trainingState.session = { kind: 'daily', label: 'Révision', items: [{}, {}, {}, {}], results: new Map([['a', { ok: true }], ['b', { ok: true }], ['c', { ok: false }]]), cur: 3, i: 3 };
            trainingState.combo = 2`);
        mode('training');
        const m = model();
        assert.deepStrictEqual([m.ring.value, m.ring.max, m.ring.sub], [4, 4, 'sur 4']);
        assert.deepStrictEqual(m.tiles.map(x => x[0]), [2, 1, 2]);
        assert(!$('#gc-ring').hidden && $('#gc-ring .ring'));
    });

    await t('contre-la-montre et ligne complète gardent leur barre, sans carte', () => {
        w.eval(`trainingState.session = { kind: 'timed', end: Date.now() + 1000, score: 0, results: new Map() }`);
        assert.strictEqual(model(), null);
        w.eval(`trainingState.session = null`);
        assert.strictEqual(model(), null, 'hors séance guidée');
    });

    await t('aperçu des Statistiques : maîtrise ; essais, échecs, révision, relus dans la bonne couleur', () => {
        w.eval(`readDBFor = (r, c) => c === 'b' ? { k: { attempts: 13, failures: 8, mastery: 34, due: 0, interval: 0 } } : {};
            statsPreviewTarget = { color: 'b', key: 'k' }`);
        mode('preview');
        const m = model();
        assert.deepStrictEqual([m.ring.value, m.ring.sub], [34, 'maîtrise']);
        assert.deepStrictEqual(m.tiles.slice(0, 2).map(x => x[0]), [13, 8]);
    });

    await t('un titre long reste petit ; Finales et Analyse toujours', () => {
        mode('play');
        w.eval(`setStatus('À vous')`);
        assert(!$('#game-card').classList.contains('is-long'));
        w.eval(`setStatus('Aucun indice : cette position n’est pas encore dans la base.')`);
        assert($('#game-card').classList.contains('is-long'));
        mode('endgame');
        w.eval(`setStatus('Rf4')`);
        assert($('#game-card').classList.contains('is-long'));
    });

    await t('la carte ne change rien hors téléphone (display: contents), l’anneau cache la barre, les chiffres dès 800 px', () => {
        const css = mainCss();
        assert(/\.game-card \{ display: contents; \}/.test(css));
        assert(/min-height: 701px\)[\s\S]*\.tr-progress \{ display: none; \}/.test(css), 'anneau à la place de la barre');
        assert(/min-height: 800px\)[\s\S]*\.gc-tiles:not\(\[hidden\]\) \{ display: grid;/.test(css), 'chiffres sur grand écran');
    });

    await t('aucune erreur', () => assert.deepStrictEqual(errors, []));

    const desk = await boot(false);
    await t('sur ordinateur : carte vide', () => {
        desk.w.eval(`startGame('w'); Bus.emit('ui:refresh')`);
        assert(desk.$('#gc-ring').hidden && desk.$('#gc-tiles').hidden);
    });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
