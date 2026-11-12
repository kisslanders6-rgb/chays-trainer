// Lancer : node tests/screens/statsInsights.test.js   — Statistiques › Parties : barre de filtres commune, vues Bilan, Temps et Répertoire, horloge de la fiche d'ouverture.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 500) => new Promise(r => setTimeout(r, ms));

const clk = (m, s) => `{[%clk 0:0${m}:${s}]}`;
const PGN = `1. e4 ${clk(2, 58)} 1... e5 ${clk(2, 50)} 2. Nf3 ${clk(2, 56)} 2... Nc6 ${clk(2, 40)} 3. Bc4 ${clk(2, 54)} 3... Bc5 ${clk(2, 30)} 4. c3 ${clk(2, 50)} 4... Nf6 ${clk(2, 20)} 5. d3 ${clk(2, 40)} 5... d6 ${clk(2, 10)} 6. O-O ${clk(2, 30)} 6... O-O ${clk(2, 0)}`;

(async () => {
    const { dom, errors } = await bootApp({ before(w) { w.scrollTo = () => {}; } });
    const w = dom.window, $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
    w.eval(`(() => {
        const line = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3'.split(' '), db = {}, now = Date.now();
        for (let k = 0; k < line.length; k += 2) {
            const path = line.slice(0, k + 1), pos = Chess.replay(path.slice(0, -1));
            db[Chess.key(pos)] = { move: path[k], san: Chess.san(pos, path[k]), attempts: 6, failures: 1, path, ply: path.length, due: now + 864e5, interval: 3, created: 1 };
        }
        dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
        const end = Math.floor(now / 1000);
        const game = i => ({ rules: 'chess', uuid: 'g' + i, end_time: end - i * 7200, time_class: i % 4 ? 'blitz' : 'rapid', time_control: '180', rated: true, url: 'x',
            pgn: '[White "Moi"]\\n\\n' + ${JSON.stringify(PGN)} + ' *',
            white: { username: 'Moi', rating: 1500 + (i % 2 ? 8 : -8), result: i % 2 ? 'win' : 'timeout' }, black: { username: 'Lui', rating: 1500, result: i % 2 ? 'resigned' : 'win' } });
        window.fetch = async url => /archives$/.test(url)
            ? { status: 200, ok: true, json: async () => ({ archives: ['https://api.chess.com/pub/player/moi/games/2026/11'] }) }
            : { status: 200, ok: true, json: async () => ({ games: Array.from({ length: 24 }, (_, i) => game(i)) }) };
        appSettings.chesscomUser = 'Moi';
        statsColor = 'all'; statsFilter = 'all'; statsPane = 'games';
        switchHomeTab('stats'); initStats();
        document.querySelector('#stats-games [data-action="statsGamesSync"]').click();
    })()`);
    await tick();
    const titles = () => $$('#stats-games .so-card h5').map(h => h.textContent);
    const view = v => $(`#stats-games [data-action="statsInView"][data-arg="${v}"]`).click();
    const pick = (action, value) => w.eval('UI_ACTIONS')[action](value);

    await t('une seule barre de filtres, dans la barre de contexte ; la courbe d\'Elo ne porte plus ses propres sélecteurs', () => {
        assert.strictEqual($$('#home-tab-stats .si-bar').length, 1);
        assert.strictEqual($$('#stats-filters .si-bar .dd').length, 2, 'période et cadence ; un seul site relié');
        assert(!$('#stats-games .sg-site'));
        assert(!$('#stats-filters').hidden);
    });

    await t('filtres : cachés sur Maîtrise, présents sur Ouvertures', () => {
        w.eval(`UI_ACTIONS.statsPane('overview')`);
        assert($('#stats-filters').hidden && !$('#stats-filters .si-bar'));
        w.eval(`UI_ACTIONS.statsPane('openings')`);
        assert(!$('#stats-filters').hidden && $('#stats-filters .si-bar'));
        w.eval(`UI_ACTIONS.statsPane('games')`);
    });

    await t('Bilan : chiffres, records et cartes attendues', () => {
        assert.strictEqual($$('#stats-games .so-kpi').length, 4);
        assert.strictEqual($('#stats-games .so-kpi b').textContent, '50 %');
        assert.strictEqual($$('#stats-games .si-rec > div').length, 3);
        const list = titles();
        ['Votre niveau mois par mois', 'Contre qui perdez-vous des points ?', 'Quand jouez-vous le mieux ?', 'Savez-vous vous arrêter ?', 'Comment finissent vos parties ?', 'Jouer plus vous fait-il monter ?'].forEach(x => assert(list.includes(x), x));
        assert.strictEqual($$('#stats-games .si-heat i').length, 42);
        assert(/Le temps décide 100 % de vos défaites/.test($('#stats-games').textContent), 'défaites toutes au temps');
    });

    await t('cadence : filtre les chiffres et règle la courbe d\'Elo', () => {
        pick('statsInSpeed', 'blitz');
        assert.strictEqual(w.eval('appSettings.eloSpeed'), 'blitz');
        assert(/18 parties/.test($('#stats-games .so-kpi small').textContent), $('#stats-games .so-kpi small').textContent);
        pick('statsInSpeed', 'all');
        assert(/24 parties/.test($('#stats-games .so-kpi small').textContent));
    });

    await t('période, site et cadence : retrouvés au prochain lancement, sans enfermer sur une page vide', async () => {
        pick('statsInPeriod', '6'); pick('statsInSpeed', 'rapid');
        const saved = w.eval(`dataStore.getJSON('chessTrainer_gameFilters')`);
        assert.strictEqual(saved.period, 6); assert.strictEqual(saved.speed, 'rapid'); assert.strictEqual(saved.site, 'all');
        pick('statsInPeriod', '12'); pick('statsInSpeed', 'all');
        const again = await bootApp({ storage: { chessTrainer_gameFilters: JSON.stringify({ period: 3, site: 'lichess', speed: 'blitz' }) }, before(x) { x.scrollTo = () => {}; } });
        const x = again.dom.window, game = (ago, speed) => `StatsInsights.keep({ at: Date.now() - ${ago} * 864e5, site: 'chesscom', speed: '${speed}', color: 'w' })`;
        x.eval(`statsColor = 'all'; StatsInsights.filtersHTML([{ site: 'chesscom', speed: 'blitz' }, { site: 'chesscom', speed: 'rapid' }])`);
        assert(x.eval(game(1, 'blitz')), 'site sans partie : retour à tous les sites');
        assert(!x.eval(game(1, 'rapid')), 'cadence retrouvée');
        assert(!x.eval(game(150, 'blitz')), 'période retrouvée');
        x.close();
    });

    await t('courbe d\'Elo : l\'année figure sur l\'axe', () => {
        const axis = $$('#stats-games .sg-chart text.ax').slice(-2).map(e => e.textContent);
        axis.forEach(l => assert(/\b20\d\d\b/.test(l), l));
    });

    await t('couleur de l\'onglet : aucune partie aux Noirs, message clair', () => {
        w.eval(`statsColor = 'b'; StatsGames.repaint()`);
        assert(/Trop peu de parties avec ces filtres/.test($('#stats-games').textContent));
        w.eval(`statsColor = 'all'; StatsGames.repaint()`);
    });

    await t('Temps : horloges, sortie du répertoire, zeitnot et coup 20', () => {
        view('temps');
        const list = titles();
        ['Où dépensez-vous votre temps ?', 'Votre préparation vous fait-elle gagner du temps ?', 'Tombez-vous en zeitnot ?', 'Le temps au coup 20 compte-t-il ?'].forEach(x => assert(list.includes(x), x));
        assert($('#stats-games .si-line.me') && $('#stats-games .si-line.opp'));
        assert(!$('#stats-games .so-kpi'), 'pas de chiffres du Bilan ici');
    });

    await t('Qualité : progression de l\'analyse, Chess.com à évaluer, résultats à partir de 5 parties analysées', () => {
        view('qualite');
        assert(/Analyse Stockfish/.test($('#stats-games #si-eval').textContent));
        assert(/0 \/ 24/.test($('#stats-games #si-eval').textContent));
        assert(/dès 5 parties analysées/.test($('#stats-games').textContent));
        w.eval(`StatsGames.games().forEach((g, i) => { g.ev = g.sans.map((_, k) => 20 + (k % 2 ? 0 : -300 * (i % 2))); g.div = [0, 0]; }); StatsGames.repaint()`);
        assert(/Toutes vos parties sont analysées/.test($('#stats-games #si-eval').textContent));
        const list = titles();
        ['Votre précision progresse-t-elle ?', 'Où perdez-vous en qualité ?', 'Transformez-vous vos avantages ?', 'Voyez-vous les fautes adverses ?'].forEach(x => assert(list.includes(x), x));
        assert.strictEqual($$('#stats-games .so-kpi').length, 4);
    });

    await t('Répertoire : l\'ancienne vue, soumise aux mêmes filtres', () => {
        view('repertoire');
        assert(/Répertoire suivi/.test($('#stats-games').textContent));
        assert(/Par famille d'ouverture/.test($('#stats-games').textContent));
        assert(/24 parties/.test($('#stats-games .sg-tiles').textContent));
        view('bilan');
    });

    await t('fiche d\'ouverture : avance à l\'horloge à la sortie du répertoire', () => {
        assert(/Avance à l'horloge/.test($('#stats-lines').textContent));
        const fact = $$('#stats-lines .so-fact').find(f => /Avance/.test(f.textContent));
        assert(/^Avance à l'horloge\+\d+ %$/.test(fact.textContent.trim().replace(/\s+/g, ' ').replace(/horloge /, 'horloge')), fact.textContent);
    });

    assert.deepStrictEqual(errors, []);
    w.close();
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
