// Lancer : node tests/screens/trainingAfter.test.js   — fin d'exercice de l'Entraînement : pause, Suivant, Modifier le coup, Analyser.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 450) => new Promise(r => setTimeout(r, ms));

(async () => {
    const { w, errors } = await bootApp({ before(win) { win.scrollTo = () => {}; } });
    const run = s => w.eval(s);
    const $ = s => w.document.querySelector(s);
    const E2 = 12, E4 = 28, D2 = 11, D4 = 27;
    run(`(() => {
        const pos = Chess.start(), key = Chess.key(pos);
        const db = { [key]: { move: 'e2e4', san: 'e4', attempts: 5, failures: 0, path: ['e2e4'], ply: 1, due: 0, interval: 3, created: 1 } };
        dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
        window.__start = key;
        window.askConfirm = (msg, ok) => { window.__asked = msg; ok(); };
        appSettings.trainNext = 'wait';
        startTraining('w');
    })()`);
    await tick();
    const act = () => { const b = $('#status-bar .status-act'); return b ? b.dataset.act : null; };
    const tools = () => [...w.document.querySelectorAll('.tr-after')].map(b => b.disabled);

    await t('réussite, préférence « Toujours attendre » : arrêt, Suivant dans la barre, Analyser et Modifier actifs', async () => {
        assert.deepStrictEqual(tools(), [true, true], 'inactifs pendant l\'exercice');
        run(`executePlayerMove(${E2}, ${E4}, null)`);
        await tick(100);
        assert.strictEqual(run('trainingState.pause && trainingState.pause.key'), run('__start'));
        assert.strictEqual(act(), 'Suivant');
        assert.deepStrictEqual(tools(), [false, false]);
        await tick(1600);
        assert(run('trainingState.pause'), 'rien ne s\'enchaîne seul');
    });

    await t('Modifier le coup : retour avant la réponse, le nouveau coup remplace l\'ancien après confirmation, rien n\'est compté', async () => {
        run('trainingEditMove()');
        assert.strictEqual(run('positionKey()'), run('__start'));
        assert.strictEqual(act(), 'Annuler');
        assert.deepStrictEqual(tools(), [true, true]);
        run(`executePlayerMove(${D2}, ${D4}, null)`);
        assert(/Remplacer e4 par d4/.test(run('__asked')) || /Remplacer .*4 par .*4/.test(run('__asked')), run('__asked'));
        const e = JSON.parse(JSON.stringify(run('openingDB[__start]')));
        assert.strictEqual(e.move, 'd2d4');
        assert.strictEqual(e.attempts, 0);
        assert.deepStrictEqual(e.path, ['d2d4']);
        assert.strictEqual(run('trainingState.editing'), null);
        assert.strictEqual(act(), 'Suivant');
        assert(run('JSON.stringify(loadTrash())').includes('e2e4'), 'l\'ancien coup est dans la corbeille');
    });

    await t('Analyser : l\'Analyse s\'ouvre, Quitter reprend l\'entraînement', async () => {
        run('trainingAnalyse()');
        assert.strictEqual(run('gameMode'), 'analysis');
        run('quitAnalysis()');
        await tick();
        assert.strictEqual(run('gameMode'), 'training');
        assert.strictEqual(run('trainingState.pause'), null, 'exercice suivant posé');
    });

    await t('Entrée à l\'arrêt : exercice suivant', async () => {
        await tick();
        run(`executePlayerMove(${D2}, ${D4}, null)`);
        await tick(100);
        assert(run('trainingState.pause'));
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.strictEqual(run('trainingState.pause'), null);
        assert.deepStrictEqual(errors, []);
    });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
