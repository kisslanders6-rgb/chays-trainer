// Lancer : node tests/domain/seenPositions.test.js   — positions vues en partie (SeenPositions) et filtre « Vu en partie » de l'Entraînement.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

(async () => {
    const { w, errors } = await bootApp({ before(win) { win.scrollTo = () => {}; } });
    const run = s => w.eval(s);
    const $ = s => w.document.querySelector(s);
    const LINE = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8'.split(' ');

    await t('scan : seules les positions où j\'avais le trait, une fois par partie, sur 40 demi-coups au plus', () => {
        const r = JSON.parse(run(`(() => {
            const g = (color, sans) => ({ color, sans });
            const s = SeenPositions.scan([g('w', ['e4', 'e5', 'Nf3']), g('w', ['e4', 'c5']), g('b', ['e4', 'e5']), g('w', []), g('w', ['Zz9'])]);
            const start = Chess.key(Chess.start()), afterE4 = Chess.key(Chess.play(Chess.start(), 'e2e4'));
            const afterE5 = Chess.key(Chess.replay(['e2e4', 'e7e5']));
            return JSON.stringify({ wStart: s.w.get(start), wAfterE5: s.w.get(afterE5) || 0, wAfterE4: s.w.get(afterE4) || 0, bAfterE4: s.b.get(afterE4), bStart: s.b.get(start) || 0 });
        })()`));
        assert.deepStrictEqual(r, { wStart: 3, wAfterE5: 1, wAfterE4: 0, bAfterE4: 1, bStart: 0 });
    });

    // Six positions aux Blancs, toutes fragiles ; cinq vues en partie.
    run(`(() => {
        const line = ${JSON.stringify(LINE)}, db = {}, keys = [];
        for (let k = 0; k < line.length; k += 2) {
            const path = line.slice(0, k + 1), pos = Chess.replay(path.slice(0, -1)), key = Chess.key(pos);
            db[key] = { move: path[k], san: Chess.san(pos, path[k]), attempts: 4, failures: 3, path, ply: path.length, due: Date.now() + 864e5, interval: 1, created: 1 };
            keys.push(key);
        }
        dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
        dataStore.set(dbKeyFor(currentRepertoire, 'b'), JSON.stringify({}));
        window.__keys = keys;
        SeenPositions._set({ w: new Map(keys.slice(0, 5).map(k => [k, 2])), b: new Map() });
        switchHomeTab('training');
        initTraining();
    })()`);

    await t('menu : par défaut, Points faibles ne compte que les positions vues, la puce le dit', () => {
        assert.strictEqual(run('appSettings.trainSeen'), true);
        assert.strictEqual(run(`trainingSeenOnly(['w', 'b'])`), true);
        assert.strictEqual($('#training-seen').getAttribute('aria-pressed'), 'true');
        assert(/Vu en partie · 5/.test($('#training-seen').textContent));
        assert.strictEqual($('[data-focus="weak"] .trr-n').textContent, '5');
    });

    await t('mode libre : le tirage exclut la position jamais vue', () => {
        run(`playerColor = 'w'; loadDB();`);
        const pool = JSON.parse(run('JSON.stringify(_trainingPool())'));
        assert.strictEqual(pool.length, 5);
        assert(!pool.includes(run('__keys[5]')));
    });

    await t('la puce bascule la préférence : tout le répertoire', () => {
        $('#training-seen').click();
        assert.strictEqual(run('appSettings.trainSeen'), false);
        assert.strictEqual($('#training-seen').getAttribute('aria-pressed'), 'false');
        assert.strictEqual($('[data-focus="weak"] .trr-n').textContent, '6');
        assert.strictEqual(JSON.parse(run('JSON.stringify(_trainingPool())')).length, 6);
        run(`setPref('trainSeen', true)`);
    });

    await t('moins de 5 positions vues : filtre suspendu, puce désactivée', () => {
        run(`SeenPositions._set({ w: new Map(__keys.slice(0, 2).map(k => [k, 1])), b: new Map() }); initTraining();`);
        assert.strictEqual(run(`trainingSeenOnly(['w', 'b'])`), false);
        assert.strictEqual($('#training-seen').disabled, true);
        assert.strictEqual($('[data-focus="weak"] .trr-n').textContent, '6');
        assert.deepStrictEqual(errors, []);
    });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
