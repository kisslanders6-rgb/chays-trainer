// Lancer : node tests/domain/repairPaths.test.js   — chemins manquants (rebuildPaths, repairPaths, storage.js) : une entrée sans
// `path` retrouve la ligne la plus courte du répertoire, transpositions comprises ; une position injoignable reste sans chemin ;
// les chemins retrouvés sont enregistrés dès que la base change, et l'aperçu de Progrès range enfin la position dans son ouverture.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

(async () => {
    const { dom, errors } = await bootApp();
    const w = dom.window;
    // Base sans aucun chemin : entrées posées par leur position seulement.
    const put = (color, lines) => w.eval(`(() => {
        const db = {};
        ${JSON.stringify(lines)}.forEach(([pre, move]) => {
            const pos = Chess.replay(pre);
            db[Chess.key(pos)] = { move, san: Chess.san(pos, move), attempts: 2, failures: 0, due: Date.now(), interval: 1 };
        });
        dataStore.set(dbKeyFor(currentRepertoire, '${color}'), JSON.stringify(db));
    })()`);
    const pathOf = (color, pre) => w.eval(`(() => { const e = readDBFor(currentRepertoire, '${color}')[Chess.key(Chess.replay(${JSON.stringify(pre)}))]; return e && e.path ? e.path.join(' ') : null; })()`);

    await t('Blancs : chaque réponse retrouve sa ligne, la plus courte, à travers les coups adverses', () => {
        put('w', [
            [[], 'e2e4'],
            [['e2e4', 'e7e5'], 'g1f3'],
            [['e2e4', 'e7e5', 'g1f3', 'b8c6'], 'f1c4'],
            [['e2e4', 'c7c5'], 'g1f3'],
            [['d2d4', 'd7d5'], 'c2c4']                       // jamais atteinte : je joue 1. e4
        ]);
        const fixed = w.eval(`rebuildPaths(readDBFor(currentRepertoire, 'w'), 'w')`);
        assert.strictEqual(fixed, 4, 'quatre entrées joignables complétées en mémoire');
        assert.strictEqual(w.eval(`repairPaths(currentRepertoire)`), 4, 'puis enregistrées');
        assert.strictEqual(pathOf('w', []), 'e2e4');
        assert.strictEqual(pathOf('w', ['e2e4', 'e7e5']), 'e2e4 e7e5 g1f3');
        assert.strictEqual(pathOf('w', ['e2e4', 'e7e5', 'g1f3', 'b8c6']), 'e2e4 e7e5 g1f3 b8c6 f1c4');
        assert.strictEqual(pathOf('w', ['e2e4', 'c7c5']), 'e2e4 c7c5 g1f3');
        assert.strictEqual(pathOf('w', ['d2d4', 'd7d5']), null, 'injoignable : reste sans chemin');
        assert.strictEqual(w.eval(`readDBFor(currentRepertoire, 'w')[Chess.key(Chess.replay(['e2e4', 'c7c5']))].ply`), 3);
    });

    await t('base inchangée : un second appel ne relit rien ; une base arrivée ensuite est réparée', () => {
        assert.strictEqual(w.eval(`repairPaths(currentRepertoire)`), 0);
        w.eval(`(() => { const db = readDBFor(currentRepertoire, 'w'), pos = Chess.replay(['e2e4', 'e7e5', 'g1f3', 'g8f6']);
            db[Chess.key(pos)] = { move: 'b1c3', san: 'Nc3', attempts: 1, failures: 0, due: Date.now(), interval: 1 };
            dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db)); })()`);
        assert.strictEqual(w.eval(`repairPaths(currentRepertoire)`), 1, 'la nouvelle entrée (synchronisée, importée) retrouve sa ligne');
        assert.strictEqual(pathOf('w', ['e2e4', 'e7e5', 'g1f3', 'g8f6']), 'e2e4 e7e5 g1f3 g8f6 b1c3');
    });

    await t('Noirs : l\'adversaire commence ; une transposition prend la ligne la plus courte ; un chemin existant n\'est pas touché', () => {
        put('b', [
            [['e2e4'], 'c7c5'],
            [['d2d4'], 'g8f6'],
            [['d2d4', 'g8f6', 'c2c4'], 'e7e6'],
            [['c2c4'], 'g8f6'],
            [['c2c4', 'g8f6', 'd2d4'], 'e7e6']               // même position que 1. d4 Cf6 2. c4 : une seule entrée
        ]);
        w.eval(`(() => { const db = readDBFor(currentRepertoire, 'b'), k = Chess.key(Chess.replay(['e2e4']));
            db[k].path = ['e2e4', 'c7c5']; db[k].ply = 2; db[k].keep = 1; dataStore.set(dbKeyFor(currentRepertoire, 'b'), JSON.stringify(db)); })()`);
        const db = w.eval(`(() => { const db = readDBFor(currentRepertoire, 'b'); window.__n = rebuildPaths(db, 'b'); return JSON.stringify(db); })()`);
        assert.strictEqual(w.__n, 3, 'les trois entrées sans chemin');
        const at = pre => JSON.parse(db)[w.eval(`Chess.key(Chess.replay(${JSON.stringify(pre)}))`)];
        assert.deepStrictEqual(at(['d2d4']).path, ['d2d4', 'g8f6']);
        assert.strictEqual(at(['d2d4', 'g8f6', 'c2c4']).path.length, 4, 'transposition : quatre demi-coups, par 1. d4 ou par 1. c4');
        assert.deepStrictEqual(at(['e2e4']).path, ['e2e4', 'c7c5'], 'chemin existant gardé');
    });

    await t('Progrès : une position réparée se range dans son ouverture nommée', () => {
        w.eval(`switchHomeTab('stats'); statsColor = 'w'; initStats()`);
        const names = w.eval(`(() => { const rows = _statsRows(); _assignOpenings(rows); return rows.map(r => r.gName).join('|'); })()`);
        assert(!/^(Autres positions\|?)+$/.test(names), names);
    });

    await t('aucune erreur JS', () => { assert.deepStrictEqual(errors, []); });
    w.close();
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
