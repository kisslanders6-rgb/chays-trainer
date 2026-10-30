// Lancer : node tests/homeSummary.test.js   — accueil Jouer « Pupitre » (lot 7) : les trois états d'« Aujourd'hui »
// (dues, à jour, vide) ont chacun une seule action pleine, la prévision sur 7 jours reprend reviewPlan, les lignes
// d'« À traiter » portent un badge .vbadge et un bouton « Répondre » qui ouvre Jouer sur la position, l'anneau de
// l'objectif passe par Ring.html. Charge index.html entier dans jsdom, comme boot.test.js.
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
            w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
            w.Element.prototype.getAnimations = () => [];
            w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
            w.Element.prototype.scrollIntoView = () => {};
            w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
            w.addEventListener('error', e => errors.push(e.message));
        }
    });
    await new Promise(r => dom.window.addEventListener('load', r));
    await new Promise(r => setTimeout(r, 3000));
    const d = dom.window.document;
    return { w: dom.window, errors, $: s => d.querySelector(s), $$: s => [...d.querySelectorAll(s)] };
}

// Base du répertoire actif : une réponse des Blancs (1. e4) et une des Noirs (1. e4 c5), échéances en jours.
const seed = (w, dueW, dueB) => w.eval(`(() => {
    const day = 86400000, now = Date.now(), put = (c, path, move, san, due) => {
        const db = {}, e = newEntry(move, san, path); e.due = now + due * day; e.attempts = 1;
        db[Chess.key(Chess.replay(path.slice(0, -1)))] = e;
        dataStore.set(dbKeyFor(currentRepertoire, c), JSON.stringify(db));
    };
    put('w', ['e2e4'], 'e2e4', 'e4', ${dueW});
    put('b', ['e2e4', 'c7c5'], 'c7c5', 'c5', ${dueB});
    loadDB(); renderHomeSummary();
})()`);

(async () => {
    const { w, errors, $, $$ } = await boot();
    const primaries = () => $$('#home-tab-play .btn-primary');

    await t('répertoire vide : choix de la couleur, une seule action pleine qui suit la carte choisie', () => {
        w.eval('renderHomeSummary()');
        assert($('#hp-grid').classList.contains('is-empty'));
        assert.strictEqual(primaries().length, 1);
        const cta = primaries()[0];
        assert.strictEqual(cta.dataset.action, 'homeAddLine');
        assert.strictEqual(cta.dataset.arg, 'w');
        assert.strictEqual($$('#hp-today .hp-pick').length, 2);
        $('#hp-today .hp-pick[data-arg="b"]').click();
        assert.strictEqual(cta.dataset.arg, 'b');
        assert.strictEqual(cta.textContent.trim(), 'Commencer avec les Noirs');
        assert.strictEqual($('#hp-today .hp-pick[data-arg="b"]').getAttribute('aria-pressed'), 'true');
        assert.strictEqual($('#hp-today .hp-pick[data-arg="w"]').getAttribute('aria-pressed'), 'false');
        assert($('#hp-today .hp-start').classList.contains('edge-card'));
    });

    await t('révisions dues : chiffre, anneau, position la plus en retard, une seule action « Commencer la révision » → startDailyReview', () => {
        seed(w, -3, -1);
        assert(!$('#hp-grid').classList.contains('is-empty'));
        assert.strictEqual(primaries().length, 1);
        const cta = primaries()[0];
        assert.strictEqual(cta.dataset.action, 'homeReview');
        assert(/Commencer la révision/.test(cta.textContent));
        assert(/^2\s+positions/.test($('#hp-today .hp-title').textContent.trim()));
        assert($('#hp-today .hp-over'), 'surtitre');
        assert($('#hp-today .ring.hp-goal[role="img"]'), 'anneau commun');
        assert($('#hp-today .hp-focus .st-mini'), 'mini-échiquier de la position la plus en retard');
        assert(/3 j/.test($('#hp-today .hp-focus-over').textContent), 'retard affiché');
        assert($('#hp-today .hp-focus-line').innerHTML.includes('Position de départ'), 'fin de ligne avant mon coup');
        assert(!$('#hp-today .hp-fc'), 'pas de prévision quand des positions sont dues');
        assert($('#hp-today .hp-link[data-action="homeExercises"]'), '« Autres exercices » en lien');
        w.__rev = 0; w.eval('startDailyReview = () => { window.__rev++; }');
        cta.click();
        assert.strictEqual(w.__rev, 1);
    });

    await t('« Autres exercices » ouvre l\'onglet Entraînement sans lancer de séance', () => {
        $('#hp-today .hp-link[data-action="homeExercises"]').click();
        assert(!$('#home-tab-training').classList.contains('hidden'));
        assert.strictEqual(w.eval('gameMode'), 'play');
        w.eval("switchHomeTab('play')");
    });

    await t('à jour : une seule action « Ajouter une ligne » dans la couleur la moins fournie, prévision = programme des révisions (reviewPlan)', () => {
        seed(w, 1, 3);
        // Une deuxième position aux Blancs : les Noirs deviennent la couleur la moins fournie.
        w.eval(`(() => { const db = readDBFor(currentRepertoire, 'w'), e = newEntry('g1f3', 'Nf3', ['e2e4', 'e7e5', 'g1f3']);
            e.due = Date.now() + 5 * 86400000; db[Chess.key(Chess.replay(['e2e4', 'e7e5']))] = e;
            dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db)); renderHomeSummary(); })()`);
        assert.strictEqual(primaries().length, 1);
        const cta = primaries()[0];
        assert.strictEqual(cta.dataset.action, 'homeAddLine');
        assert.strictEqual(cta.dataset.arg, 'b');
        assert(/Ajouter une ligne aux Noirs/.test(cta.textContent));
        assert($('#hp-today .hp-day').classList.contains('is-done'));
        const shown = $$('#hp-today .hp-fc .hp-fc-n').map(b => Number(b.textContent));
        const expected = JSON.parse(w.eval(`JSON.stringify(reviewPlan(currentRepertoire).forecast(null, 7))`));
        assert.strictEqual(shown.length, 7);
        assert.deepStrictEqual(shown, expected);
        assert.strictEqual(expected.reduce((a, b) => a + b, 0), 3, 'les trois positions tombent dans les 7 jours');
        assert.strictEqual($$('#hp-today .hp-fc li').length, 7);
    });

    await t('_homeGoalHTML délègue à Ring.html (aria-label conservé, classe hp-goal)', () => {
        w.eval('window.__ringArgs = null; const __orig = Ring.html; Ring.html = o => { window.__ringArgs = o; return __orig(o); }; window.__goal = _homeGoalHTML(3, 10); Ring.html = __orig;');
        const args = w.__ringArgs;
        assert(args, 'Ring.html appelé');
        assert.strictEqual(args.value, 3);
        assert.strictEqual(args.max, 10);
        assert.strictEqual(args.cls, 'hp-goal');
        assert(w.__goal.includes('aria-label="Objectif du jour : 3 sur 10 positions"'));
        assert(/class="ring hp-goal"/.test(w.__goal));
        assert(/class="ring is-done hp-goal"/.test(w.eval('_homeGoalHTML(12, 10)')), 'objectif atteint');
        assert(w.eval('_homeGoalHTML(12, 10)').includes('10 sur 10 positions'));
    });

    await t('À traiter : badge .vbadge et « Répondre » qui ouvre Jouer sur la position, sans rien compter', () => {
        w.eval(`(() => { const l = {}; l['lichess:abc'] = { src: 'lichess', at: Date.now(), first: Date.now(), last: Date.now(), vs: 'ondine_77',
            v: { [currentRepertoire + '|w']: { kind: 'novelty', ply: 1, at: Date.now(), path: ['e2e4', 'c7c6'] } }, counted: {} };
            dataStore.setJSON(GAME_LEDGER_KEY, l); renderHomeSummary(); })()`);
        const row = $('#hp-news .hp-row');
        assert(row, 'une ligne');
        const badge = row.querySelector('.vbadge');
        assert(badge && badge.classList.contains('is-warn') && badge.textContent === 'Nouveauté');
        assert(!row.querySelector('.hp-kind'), 'plus de .hp-kind');
        const btn = row.querySelector('button.btn.btn-soft.hp-answer');
        assert(btn && btn.textContent.trim() === 'Répondre');
        assert.strictEqual(primaries().length, 1, '« Répondre » n\'est pas une action pleine');
        const before = w.eval(`JSON.stringify(readDBFor(currentRepertoire, 'w'))`);
        btn.click();
        assert.strictEqual(w.eval('gameMode'), 'play');
        assert.strictEqual(w.eval('playerColor'), 'w');
        assert.strictEqual(w.eval(`Chess.key(Chess.replay(moveHistory.map(m => moveToStr(m.from, m.to, m.promo))))`),
                           w.eval(`Chess.key(Chess.replay(['e2e4', 'c7c6']))`), 'position de la nouveauté');
        assert.strictEqual(w.eval(`JSON.stringify(readDBFor(currentRepertoire, 'w'))`), before, 'Jouer ne compte rien');
        w.eval('goHome()');
    });

    await t('vue Parties : badge par verdict, « Répondre » seulement pour une partie encore à traiter', () => {
        w.eval(`(() => { const l = dataStore.getJSON(GAME_LEDGER_KEY, {}); l['chesscom:x'] = { src: 'chesscom', at: Date.now() - 1000, first: 1, last: 1, vs: 'Kassim',
            v: { [currentRepertoire + '|b']: { kind: 'theory', ply: 2, at: 1, path: ['e2e4', 'c7c5'] } }, counted: {} };
            dataStore.setJSON(GAME_LEDGER_KEY, l); })()`);
        $('#hp-news [data-action="homePane"][data-arg="games"]').click();
        const rows = $$('#hp-news .hp-row');
        assert.strictEqual(rows.length, 2);
        const byVs = vs => rows.find(r => r.textContent.includes(vs));
        assert(byVs('Kassim').querySelector('.vbadge.is-ok'));
        assert(!byVs('Kassim').querySelector('.hp-answer'), 'partie théorique : rien à répondre');
        assert(byVs('ondine_77').querySelector('.vbadge.is-warn'));
        byVs('ondine_77').querySelector('.hp-answer').click();
        assert.strictEqual(w.eval('gameMode'), 'play');
        assert.strictEqual(w.eval('moveHistory.length'), 2);
        w.eval('goHome()');
    });

    await t('aucune erreur JS', () => { assert.deepStrictEqual(errors, []); });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
