// Lancer : node tests/app/critical.test.js   — parcours qui récupèrent ou effacent des données (corbeille, arbre) et noms venus de l'extérieur (jamais du HTML).
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const J = x => JSON.stringify(x);
const E = (move, extra) => Object.assign({ move, san: move, attempts: 1, failures: 0 }, extra || {});
const NASTY = '<img src=x onerror="window.__xss=1"><b id="pwn">x</b>';

(async () => {
    const { w, errors } = await bootApp();
    const run = s => w.eval(s);
    const lastId = () => run('loadTrash()[0].id');
    const reps = () => JSON.parse(J(run('loadRepertoireList()')));
    const setDb = (rep, color, db) => run(`dataStore.set(dbKeyFor(${J(rep)}, '${color}'), ${J(J(db))})`);
    const getDb = (rep, color) => JSON.parse(J(run(`readDBFor(${J(rep)}, '${color}')`)));
    const K1 = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
    const K2 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -';

    await t('corbeille : un répertoire supprimé revient avec ses bases, sa note et sa place', () => {
        run(`addRepertoire('Alpha'); addRepertoire('Beta')`);
        setDb('Alpha', 'w', { [K1]: E('e2e4') }); run(`setRepertoireNote('Alpha', 'ma note')`);
        const place = reps().indexOf('Alpha');
        assert.strictEqual(run(`deleteRepertoire('Alpha')`), true);
        assert(!reps().includes('Alpha')); assert.deepStrictEqual(getDb('Alpha', 'w'), {});
        const r = run(`restoreTrashItem('${lastId()}')`);
        assert.strictEqual(r.ok, true); assert.strictEqual(reps().indexOf('Alpha'), place);
        assert.strictEqual(getDb('Alpha', 'w')[K1].move, 'e2e4'); assert.strictEqual(run(`repertoireNote('Alpha')`), 'ma note');
        assert.strictEqual(run('loadTrash().length'), 0);
    });

    await t('corbeille : nom repris entre-temps, jamais de fusion', () => {
        setDb('Beta', 'w', { [K1]: E('d2d4') });
        run(`deleteRepertoire('Beta'); addRepertoire('Beta')`);
        setDb('Beta', 'w', { [K1]: E('c2c4') });
        const r = run(`restoreTrashItem('${lastId()}')`);
        assert.strictEqual(r.rep, 'Beta (restauré)');
        assert.strictEqual(getDb('Beta', 'w')[K1].move, 'c2c4', 'le nouveau répertoire est intact');
        assert.strictEqual(getDb('Beta (restauré)', 'w')[K1].move, 'd2d4');
        run(`deleteRepertoire('Beta (restauré)')`); run(`deleteRepertoire('Beta')`); run(`addRepertoire('Beta'); addRepertoire('Beta (restauré)')`);
        const rr = run(`restoreTrashItem('${run('loadTrash()[0].id')}')`);
        assert.strictEqual(rr.rep, 'Beta (restauré 2)');
    });

    await t('corbeille : position occupée depuis, le coup reste à la corbeille, le reste revient', () => {
        run(`currentRepertoire = 'Beta'; playerColor = 'w'; dataStore.remove(TRASH_KEY); openingDB = { [${J(K1)}]: ${J(E('e2e4'))}, [${J(K2)}]: ${J(E('g1f3'))} }; saveDB();`);
        assert.strictEqual(run(`trashEntries([${J(K1)}, ${J(K2)}])`), true);
        const item = JSON.parse(J(run('loadTrash()[0]'))); assert.strictEqual(item.type, 'branch'); assert.strictEqual(item.count, 2);
        setDb('Beta', 'w', { [K1]: E('d2d4') });
        const r = run(`restoreTrashItem('${item.id}')`);
        assert.strictEqual(r.ok, true); assert.match(r.message, /1 coup\(s\) restauré/);
        const db = getDb('Beta', 'w'); assert.strictEqual(db[K1].move, 'd2d4', 'jamais écrasé'); assert.strictEqual(db[K2].move, 'g1f3');
        const left = JSON.parse(J(run('loadTrash()[0]'))); assert.strictEqual(left.type, 'move'); assert.strictEqual(left.count, 1); assert.deepStrictEqual(Object.keys(left.data.entries), [K1]);
    });

    await t('corbeille : répertoire disparu depuis, recréé à la restauration ; purge après 30 jours', () => {
        const id = lastId();
        run(`saveRepertoireList(loadRepertoireList().filter(x => x !== 'Beta')); dataStore.remove(dbKeyFor('Beta', 'w'));`);
        assert.strictEqual(run(`restoreTrashItem('${id}')`).ok, true); assert(reps().includes('Beta'));
        run(`saveTrash([{ id: 'vieux', type: 'move', deletedAt: Date.now() - 31 * DAY_MS, data: {} }, { id: 'recent', type: 'move', deletedAt: Date.now() - DAY_MS, data: {} }])`);
        assert.strictEqual(run('purgeExpiredTrash()'), 1);
        assert.deepStrictEqual(JSON.parse(J(run('loadTrash().map(x => x.id)'))), ['recent']);
        run('saveTrash([])');
    });

    await t('arbre : supprimer un coup propose d\'emporter ses suites, tout part à la corbeille et en revient', () => {
        run(`currentRepertoire = DEFAULT_REPERTOIRE; playerColor = 'w'; loadDB(); startGame('w');
             executePlayerMove(squareToIdx('e2'), squareToIdx('e4'), null);
             executeOpponentMove(squareToIdx('e7'), squareToIdx('e5'));
             executePlayerMove(squareToIdx('g1'), squareToIdx('f3'), null);`);
        const keys = JSON.parse(J(run('Object.keys(openingDB)')));
        assert.strictEqual(keys.length, 2);
        const root = keys.find(k => run(`openingDB[${J(k)}].move`) === 'e2e4');
        run(`window.__done = null; confirmDeleteEntry(${J(root)}, 'msg', x => { window.__done = x; })`);
        const ov = w.document.getElementById('confirm-overlay'); assert(!ov.classList.contains('hidden'));
        w.document.getElementById('confirm-ok-btn').click();
        assert.strictEqual(w.__done, 1, 'une suite orpheline emportée');
        assert.strictEqual(run('Object.keys(openingDB).length'), 0);
        const it = JSON.parse(J(run('loadTrash()[0]'))); assert.strictEqual(it.type, 'branch'); assert.strictEqual(it.count, 2);
        run(`restoreTrashItem('${it.id}'); loadDB();`);
        assert.strictEqual(run('Object.keys(openingDB).length'), 2);
    });

    await t('arbre : « ce coup seulement » garde les suites ; annuler ne touche à rien', () => {
        const keys = JSON.parse(J(run('Object.keys(openingDB)')));
        const root = keys.find(k => run(`openingDB[${J(k)}].move`) === 'e2e4');
        run(`confirmDeleteEntry(${J(root)}, 'msg', () => {})`);
        w.document.getElementById('confirm-cancel-btn').click();
        assert.strictEqual(run('Object.keys(openingDB).length'), 2);
        run(`confirmDeleteEntry(${J(root)}, 'msg', () => {})`);
        w.document.getElementById('confirm-alt-btn').click();
        assert.strictEqual(run('Object.keys(openingDB).length'), 1);
        run('saveTrash([])');
    });

    await t('noms venus de l\'extérieur : répertoire, note, adversaire, partie collée, parties en ligne, corbeille restent du texte', async () => {
        const clean = where => {
            assert.strictEqual(w.__xss, undefined, where);
            assert.strictEqual(w.document.querySelector('#pwn'), null, where);
            assert.strictEqual(w.document.querySelector('img[src="x"]'), null, where);
        };
        run(`addRepertoire(${J(NASTY)}); setRepertoireNote(${J(NASTY)}, ${J(NASTY)}); saveTrash([{ id: 't1', type: 'move', deletedAt: Date.now(), rep: ${J(NASTY)}, color: 'w', label: ${J(NASTY)}, count: 1, data: { entries: {} } }]);`);
        run(`goHome('play'); selectRepertoire(${J(NASTY)});`);
        run(`const l = readLedger(); l['lichess:abc'] = { src: 'lichess', at: Date.now(), first: Date.now(), last: Date.now(), vs: ${J(NASTY)}, v: { [currentRepertoire + '|w']: { kind: 'novelty', ply: 0, by: 'opp', at: Date.now(), path: ['e2e4'] } }, counted: {} }; writeLedger(l); HomePanels.render();`);
        clean('accueil');
        ['stats', 'training', 'endgame', 'play'].forEach(tab => { run(`switchHomeTab('${tab}')`); clean(tab); });
        run('showTrash()'); clean('corbeille'); run('closeTrash()');
        const pgn = `[White "${NASTY.replace(/"/g, '')}"]\n[Black "${NASTY.replace(/"/g, '')}"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0\n`;
        run('showGameReview()'); w.document.getElementById('review-text').value = pgn; run('runGameReview()'); clean('partie collée');
        const site = `[Site "https://lichess.org/z9"]\n[White "moi"]\n[Black "${NASTY.replace(/"/g, '')}"]\n[Result "1-0"]\n[UTCDate "2026.10.27"]\n[Opening "${NASTY.replace(/"/g, '')}"]\n\n1. e4 c5 1-0\n`;
        w.fetch = () => Promise.resolve({ ok: true, status: 200, text: async () => site });
        run(`setReviewTab('online')`);
        w.document.getElementById('online-site-lichess').click();
        w.document.getElementById('online-user').value = 'moi';
        await run('runOnlineFetch()');
        clean('parties en ligne');
        assert(w.document.querySelector('.online-opp').textContent.includes('<img'), 'le nom reste lisible en texte');
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error('ÉCHEC :', e.stack || e.message); process.exit(1); });
