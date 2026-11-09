// Lancer : node tests/screens/statsOpenings.test.js   — Statistiques › Par ouverture : une seule fiche, sélecteur (recherche, clavier, carte),
// parties rattachées par position, filtre de niveau. Charge index.html entier dans jsdom.
const { bootApp } = require('../_app.js');
const assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const tick = (ms = 120) => new Promise(r => setTimeout(r, ms));

// Répertoire : Italienne et Sicilienne ouverte aux Blancs (une seule réponse par position), chaque position travaillée. Archive : parties jouées dans chacune.
const ITA = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3', SIC = 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4';
const seedRep = w => w.eval(`(() => {
    const db = {}, now = Date.now();
    ['${ITA}', '${SIC}'].forEach((l, j) => { const p = l.split(' ');
        for (let k = 0; k < p.length; k += 2) {
            const path = p.slice(0, k + 1), pos = Chess.replay(path.slice(0, -1));
            db[Chess.key(pos)] = { move: path[k], san: Chess.san(pos, path[k]), attempts: 6, failures: j ? 0 : 4, path, ply: path.length, due: now - 864e5, interval: 3, created: 1 };
        } });
    dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
    dataStore.set(dbKeyFor(currentRepertoire, 'b'), '{}');
    statsColor = 'all'; statsFilter = 'all'; statsPane = 'overview';
})()`);
const PGN = {
    ita: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6',
    sic: '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6',
    left: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6'
};
const seedGames = async (w, games) => {
    w.eval(`(() => {
        const list = ${JSON.stringify(games)}, end = Math.floor(Date.now() / 1000);
        const g = (x, i) => ({ rules: 'chess', uuid: (x.id || 'u') + i, end_time: end - i * 3600, time_class: 'blitz', rated: true, url: 'x', pgn: '[White "Moi"]\\n\\n' + x.pgn + ' *',
            white: { username: 'Moi', rating: 1500, result: x.r === 'w' ? 'win' : x.r === 'd' ? 'agreed' : 'resigned' }, black: { username: 'Lui', rating: 1500, result: x.r === 'w' ? 'resigned' : x.r === 'd' ? 'agreed' : 'win' } });
        window.fetch = async url => /archives$/.test(url)
            ? { status: 200, ok: true, json: async () => ({ archives: ['https://api.chess.com/pub/player/moi/games/2026/11'] }) }
            : { status: 200, ok: true, json: async () => ({ games: list.map(g) }) };
        appSettings.chesscomUser = 'Moi';
        switchHomeTab('stats'); initStats();
        document.querySelector('#stats-games [data-action="statsGamesSync"]').click();
    })()`);
    await tick(500);
};

(async () => {
    const { dom, errors } = await bootApp({ before(w) { w.scrollTo = () => {}; } });
    const w = dom.window, $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
    const names = () => $$('#so-picker .so-opt b').map(b => b.textContent);
    const key = (el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    const typed = (v) => { const i = $('#so-picker .so-p-search'); i.value = v; i.dispatchEvent(new w.Event('input', { bubbles: true })); };

    seedRep(w);
    await seedGames(w, [...Array(6).fill({ pgn: PGN.ita, r: 'l' }), { pgn: PGN.left, r: 'd' }, ...Array(4).fill({ pgn: PGN.sic, r: 'w' })]);

    await t('une seule fiche et aucune liste entière, quel que soit le nombre d\'ouvertures', () => {
        assert.strictEqual($$('#stats-lines .so-fiche').length, 1);
        assert.strictEqual($$('#stats-lines .so-head').length, 1);
        assert(!$('#stats-lines .st-line'));
        assert(!$('#so-picker'), 'sélecteur fermé par défaut');
    });

    await t('s\'ouvre d\'abord sur l\'ouverture qui coûte le plus, avec son diagnostic', () => {
        assert(/italienne/i.test($('#so-trigger b').textContent), $('#so-trigger b').textContent);
        assert.strictEqual($$('#stats-lines .so-kpi').length, 4);
        assert.strictEqual($('#stats-lines .so-kpi b').textContent, '7 %', 'une nulle sur sept parties');
        assert($('#stats-lines .so-diag'));
        assert($('#stats-lines .so-delta.down'));
    });

    await t('« Réviser cette ouverture » reste .btn-soft : la page garde une seule action pleine', () => {
        assert($('#stats-lines .so-head .btn-soft'));
        assert.strictEqual($$('#home-tab-stats .btn-primary').length, 1);
    });

    await t('parties rattachées par position, coup joué à la place, positions de la fiche', () => {
        assert(/O-O/.test($('#stats-lines .so-swap').textContent));
        assert($('#stats-lines .st-ibtn.pri'));
        assert($$('#stats-lines .so-games').some(el => /parties/.test(el.textContent)));
    });

    await t('sélecteur : recherche sans accents, par nom ou par coups ; Échap referme et rend le focus', () => {
        $('#so-trigger').click();
        assert($('#so-picker') && $('#so-backdrop'));
        assert.strictEqual($('#so-trigger').getAttribute('aria-expanded'), 'true');
        const all = names().length;
        typed('SÍCIL');
        assert(names().length >= 1 && names().length < all, names().join(','));
        assert(names().every(x => /sicilienne/i.test(x)), names().join(','));
        typed('zzzz');
        assert(/Aucune ouverture/.test($('#so-picker .so-p-body').textContent));
        typed('');
        key($('#so-picker .so-p-search'), 'Escape');
        assert(!$('#so-picker') && !$('#so-backdrop'));
        assert.strictEqual(w.document.activeElement.id, 'so-trigger');
    });

    await t('choisir au clavier change la fiche sans redessiner la page', () => {
        const today = $('.st-today');
        $('#so-trigger').click();
        typed('SÍCIL');
        key($('#so-picker .so-p-search'), 'ArrowDown');
        key($('#so-picker .so-p-search'), 'Enter');
        assert(!$('#so-picker'));
        assert(/sicilienne/i.test($('#so-trigger b').textContent));
        assert.strictEqual($('.st-today'), today, 'le reste de la page n\'est pas reconstruit');
    });

    await t('flèches : passe à l\'ouverture suivante à travailler, et revient', () => {
        const a = $('#so-trigger b').textContent;
        $('#stats-lines [data-action="statsOpStep"][data-arg="1"]').click();
        assert.notStrictEqual($('#so-trigger b').textContent, a);
        $('#stats-lines [data-action="statsOpStep"][data-arg="-1"]').click();
        assert.strictEqual($('#so-trigger b').textContent, a);
    });

    await t('carte : un point par ouverture travaillée jouée, toucher ouvre sa fiche', () => {
        $('#so-trigger').click();
        $('#so-picker [data-action="statsOpMode"][data-arg="map"]').click();
        const pts = $$('#so-picker .so-point');
        assert.strictEqual(pts.length, 2);
        const other = pts.find(p => !p.classList.contains('sel'));
        other.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        assert(!$('#so-picker'));
        assert(/italienne/i.test($('#so-trigger b').textContent));
        $('#so-trigger').click();
        $('#so-picker [data-action="statsOpMode"][data-arg="list"]').click();
        key($('#so-picker .so-p-search'), 'Escape');
    });

    await t('période : le filtre recalcule sans changer d\'ouverture', () => {
        const a = $('#so-trigger b').textContent;
        $('#stats-lines [data-action="statsOpPeriod"][data-arg="3"]').click();
        assert.strictEqual($('#stats-lines [data-action="statsOpPeriod"][data-arg="3"]').getAttribute('aria-pressed'), 'true');
        assert.strictEqual($('#so-trigger b').textContent, a);
        $('#stats-lines [data-action="statsOpPeriod"][data-arg="12"]').click();
    });

    await t('filtre de niveau : seules les ouvertures qui en ont restent, ouverture concernée ouverte', () => {
        w.eval(`statsFilter = 'all'; initStats()`);
        $('.st-legend .st-lg[data-arg="mastered"]').click();
        assert.strictEqual(w.eval('statsFilter'), 'mastered');
        assert(/sicilienne/i.test($('#so-trigger b').textContent), $('#so-trigger b').textContent);
        w.eval(`statsFilter = 'all'; initStats()`);
    });

    await t('partie hors répertoire : fiche sans maîtrise, classée à part', async () => {
        seedRep(w);
        await seedGames(w, Array(3).fill({ id: 'hors', pgn: '1. d4 d5 2. c4', r: 'w' }));
        $('#so-trigger').click();
        assert(/Hors répertoire/.test($('#so-picker .so-p-body').textContent));
        key($('#so-picker .so-p-search'), 'Escape');
    });

    assert.deepStrictEqual(errors, []);
    w.close();
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
