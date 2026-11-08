// Lancer : node tests/board/gameModes.test.js   — ce que l'échiquier fait dans chaque mode (Jouer, aperçu, Entraînement, Finales, Analyse) : coup, clic, indice, navigation.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

(async () => {
    const { w, errors } = await bootApp();
    const run = s => w.eval(s);
    const E2 = 12, E4 = 28;

    run(`startGame('w');
        window.__log = [];
        const __stub = (name, ret) => { window[name] = (...a) => { __log.push([name, ...a]); return ret; }; };
        ['analysisMove', 'answerEndgameMove', 'answerTrainingMove', 'endgameHint', 'showTrainingSolution', 'analysisPositionChanged', 'executeOpponentMove'].forEach(x => __stub(x));
        window.__live = false;
        window.trainingBackToLive = () => { __log.push(['back']); return window.__live; };`);
    const mode = (m, { busy = false, live = false } = {}) => run(`gameMode = '${m}'; trainingState.busy = ${busy}; endgameState.busy = ${busy}; window.__live = ${live}; __log.length = 0; selected = null; legalMoves = [];`);
    const log = () => JSON.parse(JSON.stringify(run('__log')));
    const names = () => log().map(x => x[0]);
    const entries = () => run('Object.keys(openingDB).length');

    await t('coup joué : chaque mode reçoit le coup, rien n\'est enregistré hors de Jouer', () => {
        const before = entries();
        mode('analysis');  run(`executePlayerMove(${E2}, ${E4}, null)`); assert.deepStrictEqual(log(), [['analysisMove', E2, E4, null]]);
        mode('endgame');   run(`executePlayerMove(${E2}, ${E4}, null)`); assert.deepStrictEqual(log(), [['answerEndgameMove', E2, E4, null]]);
        mode('training');  run(`executePlayerMove(${E2}, ${E4}, null)`);
        const a = log()[0]; assert.strictEqual(a[0], 'answerTrainingMove'); assert.strictEqual(a[5], 'e2e4');
        assert.strictEqual(entries(), before);
        mode('play');      run(`executePlayerMove(${E2}, ${E4}, null)`); assert.deepStrictEqual(log(), []);
        assert.strictEqual(entries(), before + 1, 'Jouer enregistre le coup');
        run(`resetGame()`);
    });

    await t('clic sur l\'échiquier : aperçu et cinématiques l\'ignorent, la séance revient d\'abord au présent', () => {
        const click = () => { run(`handleClick(${E2})`); return run('selected'); };
        mode('preview');                      assert.strictEqual(click(), null);
        mode('endgame', { busy: true });      assert.strictEqual(click(), null);
        mode('training', { busy: true });     assert.strictEqual(click(), null); assert.deepStrictEqual(names(), []);
        mode('training', { live: true });     assert.strictEqual(click(), null); assert.deepStrictEqual(names(), ['back']);
        mode('training');                     assert.strictEqual(click(), E2);
        mode('endgame');                      assert.strictEqual(click(), E2);
        mode('play');                         assert.strictEqual(click(), E2);
    });

    await t('camp adverse : Analyse joue les deux camps, les autres modes passent par le coup adverse', () => {
        run(`playerColor = 'b'`);
        const both = () => { run(`handleClick(${E2}); handleClick(${E4})`); return names(); };
        mode('analysis'); assert.deepStrictEqual(both(), ['analysisMove']);
        mode('play');     assert.deepStrictEqual(both(), ['executeOpponentMove']);
        run(`playerColor = 'w'`);
    });

    await t('glisser une pièce : mêmes interdictions que le clic', () => {
        const can = () => run('_canInteract()');
        mode('preview');                  assert.strictEqual(can(), false);
        mode('endgame', { busy: true });  assert.strictEqual(can(), false);
        mode('training', { busy: true }); assert.strictEqual(can(), false);
        mode('training');                 assert.strictEqual(can(), true);
        mode('play');                     assert.strictEqual(can(), true);
    });

    await t('indice et solution : confiés au mode, ignorés en aperçu et en cinématique', () => {
        mode('endgame');                  run('showHint()');     assert.deepStrictEqual(names(), ['endgameHint']);
        mode('training');                 run('showSolution()'); assert.deepStrictEqual(names(), ['showTrainingSolution']);
        run(`setStatus('témoin')`);
        const status = () => w.document.getElementById('status-text').textContent;
        mode('preview');                  run('showHint()'); assert.strictEqual(status(), 'témoin');
        mode('training', { busy: true }); run('showHint()'); assert.strictEqual(status(), 'témoin'); assert.deepStrictEqual(names(), []);
        mode('training');                 run('showHint()'); assert.deepStrictEqual(names(), ['back']);
    });

    await t('navigation : gelée pendant une cinématique, barre figée en Finales, Analyse prévenue', () => {
        mode('play');
        run(`loadPositionFromPath(['e2e4', 'e7e5', 'g1f3'])`);
        const cursor = () => run('navCursor');
        mode('training', { busy: true }); run('navPrev()');   assert.strictEqual(cursor(), -1);
        run('goToMove(0)');                                   assert.strictEqual(cursor(), -1);
        mode('endgame');                  run('goToMove(0)'); assert.strictEqual(cursor(), -1);
        mode('training');                 run('goToMove(0)'); assert.strictEqual(cursor(), 0);
        run('navNext(); navNext()');                          assert.strictEqual(cursor(), -1);
        mode('analysis');                 run('navPrev()');   assert.deepStrictEqual(names(), ['analysisPositionChanged']);
    });

    await t('reçu de coup et blocage de l\'indice : réservés à Jouer', () => {
        mode('training'); assert.strictEqual(run('_hintBlocked()'), '');
        mode('endgame');  assert.strictEqual(run('_hintBlocked()'), '');
        run(`gameMode = 'play'; resetGame()`);
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error('ÉCHEC :', e.stack || e.message); process.exit(1); });
