// Lancer : node tests/screens/autoReview.test.js   — parties relues toutes seules (AutoReview, refonte lot 5) : les dernières parties
// du compte relié passent par la même analyse qu'« Analyser mes parties » ; une nouveauté devient l'étape « Après vos parties »
// d'Aujourd'hui ; au plus une fois toutes les 6 heures ; sans pseudo, rien n'est tenté. Réseau simulé (Chess.com).
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

(async () => {
    const { dom, errors } = await bootApp();
    const w = dom.window, $ = s => w.document.querySelector(s);
    // Répertoire : 1. e4 aux Blancs ; après 1. e4 e5, 2. Cf3. Une partie arrive avec 1. e4 c6 : nouveauté, rien à répondre.
    w.eval(`(() => {
        const db = {}, put = (pre, move) => { const pos = Chess.replay(pre); db[Chess.key(pos)] = { move, san: Chess.san(pos, move), attempts: 3, failures: 0, path: pre.concat(move), ply: pre.length + 1, due: Date.now() + 864e5, interval: 3 }; };
        put([], 'e2e4'); put(['e2e4', 'e7e5'], 'g1f3');
        dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
        dataStore.set(dbKeyFor(currentRepertoire, 'b'), '{}');
        window.__fetches = 0;
        const end = Math.floor(Date.now() / 1000);
        window.fetch = async url => { window.__fetches++; return /archives$/.test(url)
            ? { status: 200, ok: true, json: async () => ({ archives: ['https://api.chess.com/pub/player/moi/games/2026/11'] }) }
            : { status: 200, ok: true, json: async () => ({ games: [{ rules: 'chess', end_time: end, pgn: '[White "Moi"]\\n[Black "Ondine"]\\n\\n1. e4 c6 2. d4 d5 *' }] }) }; };
    })()`);

    await t('sans pseudo relié : rien n\'est tenté', async () => {
        w.eval(`appSettings.chesscomUser = ''; appSettings.lichessUser = ''`);
        assert.strictEqual(await w.eval('AutoReview.run({ force: true })'), null);
        assert.strictEqual(w.__fetches, 0);
    });

    await t('pseudo relié : la partie est relue, la nouveauté devient l\'étape « Après vos parties »', async () => {
        w.eval(`appSettings.chesscomUser = 'Moi'; switchHomeTab('play'); dataStore.setJSON(AutoReview.KEY, 0)`);
        const res = await w.eval('AutoReview.run()');
        assert.strictEqual(res.games, 1);
        assert.strictEqual(res.novelties, 1);
        assert.strictEqual(w.eval('HomePanels.novelties().length'), 1, 'au journal, comme une analyse à la main');
        const step = $('#hp-today .hp-step[data-arg="news"]');
        assert(step, 'étape « Après vos parties » dans le plan du jour');
        assert.strictEqual(step.querySelector('.hp-step-n').textContent, '1');
    });

    await t('au plus une fois toutes les 6 heures ; « force » passe outre', async () => {
        const before = w.__fetches;
        assert.strictEqual(await w.eval('AutoReview.run()'), null, 'trop tôt');
        assert.strictEqual(w.__fetches, before);
        assert(await w.eval('AutoReview.run({ force: true })'));
        assert(w.__fetches > before);
        assert.strictEqual(w.eval('HomePanels.novelties().length'), 1, 'relire la même partie ne la double pas');
    });

    await t('réseau en panne : silence, rien d\'écrit', async () => {
        w.eval(`window.fetch = () => Promise.reject(new Error('coupé')); dataStore.setJSON(AutoReview.KEY, 0)`);
        const res = await w.eval('AutoReview.run()');
        assert.strictEqual(res.games, 0);
    });

    await t('aucune erreur JS', () => { assert.deepStrictEqual(errors, []); });
    w.close();
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
