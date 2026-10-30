// Lancer : node tests/onlineInbox.test.js   — « Analyser mes parties », boîte de réception (lot 7) : badges de verdict,
// compteurs filtrants, « comptée » / « déjà », URL d'export Lichess, segment du nombre de parties, ligne de source
// repliée, clic sur une partie (téléphone : Jouer ; bureau : détail), erreur comptée une seule fois par partie.
// Charge index.html entier dans jsdom, comme boot.test.js.
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const ROOT = path.join(__dirname, '..');

class DiskLoader extends ResourceLoader {
    fetch(url) {
        const u = new URL(url);
        if (u.hostname !== 'localhost') return Promise.resolve(Buffer.from(''));
        return fs.promises.readFile(path.join(ROOT, decodeURIComponent(u.pathname)));
    }
}

async function boot() {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
        url: 'http://localhost/index.html', runScripts: 'dangerously', resources: new DiskLoader(), pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(w) {
            w.localStorage.setItem('chessTrainer_onboarded', '1');
            w.__wide = false;                                         // largeur simulée : téléphone par défaut
            w.matchMedia = q => ({ matches: /min-width: 920px/.test(q) && w.__wide, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
            w.Element.prototype.getAnimations = () => [];
            w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
            w.Element.prototype.scrollIntoView = () => {};
            w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
            w.addEventListener('error', e => errors.push(e.message));
        }
    });
    await new Promise(r => dom.window.addEventListener('load', r));
    await new Promise(r => setTimeout(r, 5000));
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s), $$: s => [...dom.window.document.querySelectorAll(s)] };
}

const ITA = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3';
const game = (id, white, black, moves) => `[Site "https://lichess.org/${id}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "1-0"]\n[UTCDate "2026.10.27"]\n[Opening "Italian Game"]\n\n${moves} 1-0\n\n`;

(async () => {
    const { w, errors, $, $$ } = await boot();
    const rep = w.eval('currentRepertoire');

    // Répertoire Blancs : la ligne italienne ; 1... c5 déjà repérée (oppSeen) sans réponse.
    w.eval(`(function () {
        const db = {};
        _withEngineSnapshot(() => {
            parseFEN(INIT_FEN);
            const path = [];
            '${ITA}'.split(' ').forEach(u => {
                if (turn === 'w') db[positionKey()] = Object.assign(newEntry(u, Chess.san(Chess.snapshot(), u), path.slice()), { attempts: 1, created: 1 });
                path.push(u); _applyUciRaw(u);
            });
            parseFEN(INIT_FEN); _applyUciRaw('e2e4');
            dataStore.setJSON(oppKeyFor('${rep}', 'w'), { [positionKey()]: ['c7c5'] });
        });
        dataStore.set(dbKeyFor('${rep}', 'w'), JSON.stringify(db));
    })()`);
    const attemptsAfterE5 = () => w.eval(`(function () { let k; _withEngineSnapshot(() => { parseFEN(INIT_FEN); 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5'.split(' ').forEach(_applyUciRaw); k = positionKey(); }); return readDBFor('${rep}', 'w')[k].failures; })()`);

    await t('six verdicts → classe .vbadge (Erreur is-err, Hors répertoire is-muted, Nouveauté is-warn, Sans réponse is-new, Traitée is-ok, Théorique is-muted)', () => {
        const rows = {
            mistake:  { kind: 'mistake', r: { deviation: { by: 'me' } } },
            out:      { kind: 'out', r: { deviation: { by: 'me' } } },
            novelty:  { kind: 'novelty', r: { deviation: { by: 'opp', known: false } } },
            noanswer: { kind: 'novelty', r: { deviation: { by: 'opp', known: true } } },
            treated:  { kind: 'treated', r: { deviation: { by: 'opp' } } },
            theory:   { kind: 'theory', r: { deviation: null } }
        };
        const want = { mistake: ['is-err', "Erreur d'ouverture"], out: ['is-muted', 'Hors répertoire'], novelty: ['is-warn', 'Nouveauté adverse'],
                       noanswer: ['is-new', 'Sans réponse'], treated: ['is-ok', 'Traitée depuis'], theory: ['is-muted', 'Théorique'] };
        w.__rows = rows;
        Object.keys(want).forEach(k => {
            assert.strictEqual(w.eval(`onlineVerdictKey(__rows.${k})`), k);
            const box = w.document.createElement('div');
            box.innerHTML = w.eval(`_onlineBadge(__rows.${k})`);
            const b = box.firstElementChild;
            assert(b.classList.contains('vbadge') && b.classList.contains(want[k][0]), `${k} : ${b.className}`);
            assert.strictEqual(b.textContent, want[k][1]);
        });
    });

    await t('l\'URL d\'export Lichess demande les ouvertures (opening=true)', async () => {
        assert(/[?&]opening=true(&|$)/.test(w.eval(`lichessExportUrl('moi', 20)`)));
        let asked = '';
        const old = w.fetch;
        w.fetch = url => { asked = url; return Promise.resolve({ ok: true, status: 200, text: async () => game('z1', 'moi', 'x', '1. e4 e5') }); };
        const games = await w.eval(`fetchLichessGames('moi', 5)`);
        w.fetch = old;
        assert(/opening=true/.test(asked) && !/opening=false/.test(asked), asked);
        assert.strictEqual(w.eval(`onlineOpening`)(games[0].headers), 'Italian Game');
        assert.strictEqual(w.eval(`onlineOpening`)({ ECOUrl: 'https://www.chess.com/openings/Italian-Game-Two-Knights-Defense-4.d3', ECO: 'C55' }), 'Italian Game Two Knights Defense');
        assert.strictEqual(w.eval(`onlineOpening`)({ ECO: 'C55' }), 'C55');
    });

    await t('segments : site (pseudo Chess.com / Lichess), nombre de parties écrit dans chessTrainer_onlineAccount, PGN collé', () => {
        w.eval('showGameReview()');
        $('#online-site-lichess').click();
        assert.strictEqual($('#online-user').placeholder, 'pseudo Lichess');
        assert.strictEqual($('#online-site-lichess').getAttribute('aria-checked'), 'true');
        $('#online-count [data-arg="50"]').click();
        assert.strictEqual(JSON.parse(w.localStorage.getItem('chessTrainer_onlineAccount')).count, 50);
        assert.strictEqual($('#online-count [data-arg="50"]').getAttribute('aria-checked'), 'true');
        assert(/Analyser 50 parties/.test($('#online-fetch-btn').textContent));
        $('#online-count [data-arg="10"]').click();
        assert.strictEqual(JSON.parse(w.localStorage.getItem('chessTrainer_onlineAccount')).count, 10);
        $('#online-site-chesscom').click();
        assert.strictEqual($('#online-user').placeholder, 'pseudo Chess.com');
        assert.strictEqual(JSON.parse(w.localStorage.getItem('chessTrainer_onlineAccount')).site, 'chesscom');
        $('#online-site-pgn').click();
        assert(!$('#review-pane-paste').classList.contains('hidden') && $('#review-pane-online').classList.contains('hidden'));
        assert.strictEqual(JSON.parse(w.localStorage.getItem('chessTrainer_onlineAccount')).site, 'chesscom', 'le PGN collé n\'est pas un site mémorisé');
        $('#online-site-lichess').click();
        assert($('#review-pane-paste').classList.contains('hidden'));
        assert.strictEqual($$('#review-panel .btn-primary').filter(b => !b.closest('.hidden') && !b.closest('[hidden]')).length, 1, 'un seul bouton plein');
    });

    await t('pseudo introuvable : erreur en ligne sous le champ, formulaire ouvert', async () => {
        $('#online-user').value = 'personne';
        w.fetch = () => Promise.resolve({ ok: false, status: 404 });
        await w.eval('runOnlineFetch()');
        assert(!$('#online-user-err').hidden && /Pseudo introuvable sur Lichess/.test($('#online-user-err').textContent));
        assert.strictEqual($('#online-user').getAttribute('aria-invalid'), 'true');
        assert(!$('#online-form').hidden);
        w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
    });

    await t('récupération : ligne de source repliée, compteurs, une erreur comptée une seule fois par partie', async () => {
        const pgn = game('a1', 'moi', 'Kasparov_fan', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3')
                  + game('a2', 'moi', 'sicilien', '1. e4 c5 2. Nf3')
                  + game('a3', 'moi', 'italien', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3')
                  + game('a4', 'moi', 'scandi', '1. e4 d5 2. exd5');
        w.fetch = () => Promise.resolve({ ok: true, status: 200, text: async () => pgn });
        $('#online-user').value = 'moi';
        const before = attemptsAfterE5();
        await w.eval('runOnlineFetch()');
        assert.strictEqual(attemptsAfterE5(), before + 1, 'erreur comptée');
        assert($('#online-form').hidden && !$('#online-done').hidden, 'formulaire replié');
        assert(/moi · Lichess · 4 parties · 4 nouvelles/.test($('#online-done').textContent.replace(/\s+/g, ' ')), $('#online-done').textContent);
        const labels = $$('#online-results .online-row .vbadge').map(b => b.textContent);
        assert.deepStrictEqual(labels, ["Erreur d'ouverture", 'Sans réponse', 'Nouveauté adverse', 'Théorique'], 'erreurs en tête, théoriques en dernier');
        assert.strictEqual($$('#online-results .online-row .online-tag.is-counted').length, 1);
        assert.strictEqual($$('#online-results .online-row .st-mini').length, 4, 'vignette de la position déviante');
        assert($('#online-results .online-row .fig, #online-results .online-row .online-mv'), 'coup déviant');

        // Seconde passe : rien n'est recompté ; parties déjà analysées masquées, « Afficher les 4 ».
        await w.eval('runOnlineFetch()');
        assert.strictEqual(attemptsAfterE5(), before + 1, 'erreur recomptée');
        assert.strictEqual($$('#online-results .online-row').length, 0);
        assert(/Rien de nouveau/.test($('#online-results').textContent));
        const show = $('#online-results [data-action="toggleOnlineSeen"]');
        assert(/Afficher les 4/.test(show.textContent));
        show.click();
        assert.strictEqual($$('#online-results .online-row').length, 4);
        assert.strictEqual($$('#online-results .online-row .online-tag.is-counted').length, 0, '« comptée » seulement pour counted');
        const dej = $$('#online-results .online-row .online-tag').filter(e => e.textContent === 'déjà');
        assert.strictEqual(dej.length, 1, '« déjà » pour l\'erreur déjà comptée');
        w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
    });

    await t('le compteur Erreurs filtre la liste, un second toucher la rétablit', () => {
        const err = $('#online-results .online-chip[data-arg="err"]');
        assert(/Erreurs\s*1/.test(err.textContent));
        err.click();
        const rows = $$('#online-results .online-row');
        assert.strictEqual(rows.length, 1);
        assert(rows[0].querySelector('.vbadge.is-err'));
        assert.strictEqual($('#online-results .online-chip[data-arg="err"]').getAttribute('aria-pressed'), 'true');
        $('#online-results .online-chip[data-arg="err"]').click();
        assert.strictEqual($$('#online-results .online-row').length, 4);
    });

    await t('« comptée » n\'apparaît que pour row.counted === "counted"', () => {
        w.eval(`_online.rows[0] = Object.assign({}, _online.rows[0], { counted: 'counted' })`);
        w.eval('_renderOnlineResults()');
        assert.strictEqual($$('#online-results .online-row .online-tag.is-counted').length, 1);
        assert.strictEqual($$('#online-results .online-row .online-tag').filter(e => e.textContent === 'déjà').length, 0);
        w.eval(`_online.rows.forEach((r, i) => { _online.rows[i] = Object.assign({}, r, { counted: null }); }); _renderOnlineResults()`);
        assert.strictEqual($$('#online-results .online-row .online-tag').length, 0);
    });

    await t('« Changer de source » rouvre le formulaire avec la dernière analyse ; un compteur y ramène à la liste', () => {
        $('#online-done [data-action="onlineEditSource"]').click();
        assert(!$('#online-form').hidden && $('#online-done').hidden);
        assert(!$('#online-last').hidden && $('#online-results').innerHTML === '');
        $('#online-last [data-arg="err"]').click();
        assert($('#online-form').hidden);
        assert.strictEqual($$('#online-results .online-row').length, 1);
        $('#online-results .online-chip[data-arg="err"]').click();
    });

    await t('bureau : un clic choisit la partie (détail à droite) ; « Ouvrir dans Jouer » est la seule action pleine', () => {
        w.__wide = true;
        const rows = $$('#online-results .online-row');
        rows[1].click();
        assert(!$('#review-overlay').classList.contains('hidden'), 'la fenêtre reste ouverte');
        const sel = $('#online-results .online-row.is-sel');
        assert.strictEqual(sel.dataset.arg, rows[1].dataset.arg);
        const detail = $('#online-results .online-detail');
        assert(detail.querySelector('.st-mini') && detail.querySelector('.online-line'));
        assert(/Sortie/.test(detail.textContent) && /Italian Game/.test(detail.textContent));
        const primaries = $$('#review-panel .btn-primary').filter(b => !b.closest('.hidden') && !b.closest('[hidden]'));
        assert.strictEqual(primaries.length, 1);
        assert(/Ouvrir dans Jouer/.test(primaries[0].textContent));
        assert(detail.querySelector('[data-action="onlineTree"]'));
        w.__wide = false;
    });

    await t('téléphone : toucher une ligne ouvre Jouer sur la position déviante (rien n\'est compté)', () => {
        const before = attemptsAfterE5();
        const row = $$('#online-results .online-row').find(r => r.querySelector('.vbadge.is-err'));
        row.click();
        assert($('#review-overlay').classList.contains('hidden'));
        assert.strictEqual(w.eval('gameMode'), 'play');
        assert(/Erreur d'ouverture/.test($('#status-text').textContent));
        assert.strictEqual(attemptsAfterE5(), before);
    });

    await t('« Voir dans l\'Arbre » : Jouer sur la position, onglet Arbre', () => {
        w.eval('showGameReview()');
        w.eval(`onlineTree(0)`);
        assert.strictEqual(w.eval('sideTab'), 'tree');
        assert.strictEqual(w.eval('gameMode'), 'play');
    });

    await t('aucune partie comparable : « N ignorées · Chess960 ou position de départ »', async () => {
        w.fetch = () => Promise.resolve({ ok: true, status: 200, text: async () => game('c1', 'autre', 'x', '1. e4 e5') + game('c2', 'autre', 'y', '1. d4') });
        w.eval('showGameReview(); onlineEditSource()');
        $('#online-user').value = 'moi';
        await w.eval('runOnlineFetch()');
        assert(/Aucune partie à comparer/.test($('#online-results').textContent));
        assert(/2 ignorées · Chess960 ou position de départ/.test($('#online-results').textContent));
        w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
        await w.eval('onlineRefetch()');
        assert(/Lichess ne répond pas/.test($('#online-results').textContent));
        assert($('#online-results [data-action="setOnlineSite"][data-arg="pgn"]'));
    });

    assert.deepStrictEqual(errors, [], 'erreurs JS : ' + errors.join(' | '));
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
