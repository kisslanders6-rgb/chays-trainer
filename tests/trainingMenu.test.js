// Lancer : node tests/trainingMenu.test.js   — menu de l'Entraînement « Rampe » (lot 7) : une seule action pleine
// (_trPrimary), plus de phrases .trx-txt, anneau du bilan, pastille « Toucher pour passer » pendant la mise en
// situation. Charge index.html entier dans jsdom, comme boot.test.js.
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
    await new Promise(r => setTimeout(r, 5000));
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s), $$: s => [...dom.window.document.querySelectorAll(s)] };
}

(async () => {
    const { w, errors, $, $$ } = await boot();

    // Répertoire des Blancs : 1. e4 (e5) 2. Cf3 (Cc6) 3. Fc4. dueIn : échéance en jours (négatif = en retard).
    const seed = (opts = {}) => w.eval(`(() => {
        const o = ${JSON.stringify(opts)};
        const line = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'], db = {};
        [0, 2, 4].forEach((i, j) => {
            const pos = Chess.replay(line.slice(0, i)), path = line.slice(0, i + 1);
            const e = newEntry(line[i], Chess.san(pos, line[i]), path);
            e.attempts = 4; e.failures = (o.weak && j === 0) ? 3 : 0; e.lastReviewed = Date.now() - 864e5;
            e.due = Date.now() + (o.dueIn != null && (!o.lastOnly || j === 2) ? o.dueIn : 3) * 864e5; e.interval = 3;
            db[Chess.key(pos)] = e;
        });
        dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(o.empty ? {} : db));
        dataStore.set(dbKeyFor(currentRepertoire, 'b'), '{}');
        return Object.keys(db);
    })()`);
    const summary = (missed) => w.eval(`(() => {
        const db = readDBFor(currentRepertoire, 'w'), keys = Object.keys(db);
        const rows = keys.map((k, i) => ({ key: k, color: 'w', ok: i >= ${missed}, lvBefore: 'progress', lvAfter: _level(db[k]), e: db[k] }));
        trainingState.lastSummary = { kind: 'due', label: 'Révision du jour', minutes: 4, total: rows.length, ok: rows.filter(r => r.ok).length, rows, returnTab: 'training' };
    })()`);
    const render = () => { w.eval(`_trFocus = null; initTraining()`); return $('#training-panel'); };
    const primaries = () => $$('#training-panel .btn-primary, #training-panel .trr-next-row.is-primary');   // « Ensuite » : la première suite pleine

    await t('_trPrimary : erreurs de la dernière séance, sinon dues, sinon l\'exercice mis en avant, sinon Points faibles', () => {
        const P = s => w.eval(`_trPrimary(${JSON.stringify(s)})`);
        const all = { weak: true, unsure: true, timed: true, free: true };
        assert.strictEqual(P({ due: 4, retry: 2, focus: 'unsure', avail: all }), 'retry', 'erreurs fraîches d\'abord, comme la capsule Suite');
        assert.strictEqual(P({ due: 4, retry: 0, focus: 'unsure', avail: all }), 'due');
        assert.strictEqual(P({ due: 0, retry: 2, focus: 'unsure', avail: all }), 'retry');
        assert.strictEqual(P({ due: 0, retry: 0, focus: 'unsure', avail: all }), 'unsure');
        assert.strictEqual(P({ due: 0, retry: 0, focus: null, avail: all }), 'weak');
        assert.strictEqual(P({ due: 0, retry: 0, focus: 'due', avail: all }), 'weak', 'focus « due » sans position due : Points faibles');
        assert.strictEqual(P({ due: 0, retry: 0, focus: 'unsure', avail: { weak: true, timed: true } }), 'weak', 'exercice mis en avant indisponible');
        assert.strictEqual(P({ due: 0, retry: 0, focus: null, avail: { timed: true, free: true } }), 'timed', 'sans point faible : un exercice disponible');
        assert.strictEqual(P({}), null);
    });

    await t('menu : exactement un .btn-primary, quel que soit l\'état ; plus aucun .trx-txt', () => {
        w.eval(`switchHomeTab('training')`);
        seed({ dueIn: -1 });
        w.eval(`trainingState.lastSummary = null`);
        render();
        assert.strictEqual(primaries().length, 1);
        assert.strictEqual(primaries()[0].dataset.arg, 'due', 'positions dues : « Commencer » de la Révision du jour');
        assert.strictEqual($$('#training-panel .trx-txt').length, 0);
        assert(!/btn-primary/.test($('[data-action="trainingEx"][data-arg="free"]') ? $('[data-action="trainingEx"][data-arg="free"]').className : ''), 'Mode libre sans bouton plein');

        summary(2);
        render();
        assert.strictEqual(primaries().length, 1, 'dues + erreurs : un seul bouton plein');
        assert.strictEqual(primaries()[0].dataset.action, 'trainingRetry', 'erreurs fraîches d\'abord : première suite de « Ensuite »');
        assert($('#training-panel .trr-day [data-arg="due"]').classList.contains('btn-soft'), '« Commencer » de la Révision du jour tonal');
        const next = $$('.trr-next .trr-next-row').map(b => b.dataset.arg || b.dataset.action);
        assert.deepStrictEqual(next, ['trainingRetry', 'due'], 'Ensuite : revoir les erreurs, puis la révision du jour');

        seed({ dueIn: 3 });
        summary(2);
        render();
        assert.strictEqual(primaries().length, 1);
        assert.strictEqual(primaries()[0].dataset.action, 'trainingRetry', 'rien de dû : « Revoir les erreurs »');

        w.eval(`trainingState.lastSummary = null`);
        seed({ dueIn: 3, weak: true });
        render();
        assert.strictEqual(primaries().length, 1);
        assert.strictEqual(primaries()[0].dataset.arg, 'weak', 'ni dû ni erreur : Points faibles');
        w.eval(`_trFocus = 'unsure'; initTraining()`);
        assert.strictEqual(primaries().length, 1);

        seed({ empty: true });
        render();
        assert.strictEqual(primaries().length, 1, 'répertoire vide');
        assert.strictEqual(primaries()[0].dataset.action, 'trainingAddLine', '« Ajouter une ligne » vers Jouer');
        assert.strictEqual($$('#training-panel .trx-txt').length, 0);
    });

    await t('« Ensuite » sans erreur ni position due : aucune suite inutile ; capsule Suite cachée ou objectif', () => {
        seed({ dueIn: 3 });
        summary(0);
        render();
        assert(!$('[data-action="trainingRetry"]'), 'rien à revoir : pas de bouton « Revoir »');
        assert.strictEqual($$('.trr-next').length, 0);
    });

    await t('bilan : l\'anneau reflète réussites du premier coup / total, puces d\'erreurs et de niveaux', () => {
        seed({ dueIn: 3 });
        summary(1);
        render();
        const ring = $('.trr-bilan .ring');
        assert.strictEqual(ring.getAttribute('aria-label'), '2 sur 3 du premier coup');
        assert.strictEqual(ring.querySelector('.ring-txt b').textContent, '2/3');
        const c = ring.querySelector('circle.v'), dash = Number(c.getAttribute('stroke-dasharray')), off = Number(c.getAttribute('stroke-dashoffset'));
        assert(Math.abs(off - dash / 3) < .2, 'un tiers de l\'anneau vide');
        assert.strictEqual($('.trr-bilan .vbadge.is-err').textContent, '1 à revoir');
        assert($('.trr-bilan details.trr-detail'), 'liste « avant → après » repliable');
        assert(!$('.trr-bilan details.trr-detail').open, 'repliée sur téléphone (matchMedia faux)');
    });

    await t('filtre d\'ouverture : puce retirable dans la barre de contexte', () => {
        w.eval(`trainingState.lastSummary = null; _trOpening = { key: 'x', name: 'Partie <italienne>' }; initTraining()`);
        const chip = $('#home-tab-training .st-scope #training-filter');
        assert(chip && chip.textContent.includes('Partie <italienne>'), 'nom échappé, dans la barre de contexte');
        chip.querySelector('[data-action="trainingAllOpenings"]').click();
        assert(!$('#training-filter'), 'retirée au clic');
    });

    await t('mode libre : réglages dans sa carte (stepper et interrupteur), écrits dans les préférences', () => {
        seed({ dueIn: 3 });
        w.eval(`_trFreeOpen = true; initTraining()`);
        const plus = $('.trr-free [data-arg^="maxPlies:"][aria-label="Plus"]');
        assert(plus && !plus.disabled);
        plus.click();
        assert.strictEqual(w.eval('appSettings.freeMaxPlies'), 5);
        $('.trr-free [role="switch"]').click();
        assert.strictEqual(w.eval('appSettings.freeFromStart'), 1);
        assert.strictEqual($('.trr-free [role="switch"]').getAttribute('aria-checked'), 'true');
        $('.trr-free [data-arg^="maxPlies:"][aria-label="Moins"]').click();
        $('.trr-free [role="switch"]').click();
        assert.strictEqual(w.eval('appSettings.freeMaxPlies'), 0);
        assert($('.trr-free [data-arg^="maxPlies:"][aria-label="Moins"]').disabled, 'borne basse');
    });

    await t('séance : pastille « Toucher pour passer » pendant la mise en situation, retirée quand la main revient', async () => {
        seed({ dueIn: -1, lastOnly: true });                           // 3. Fc4 : trois demi-coups de mise en situation
        w.eval(`trainingState.lastSummary = null; _trOpening = null; window.__pill = []; const _s = showBoardPill, _h = hideBoardPill;
            showBoardPill = (txt, fn) => { __pill.push(['show', txt, typeof fn]); _s(txt, fn); };
            hideBoardPill = () => { __pill.push(['hide']); _h(); }; initTraining()`);
        w.eval(`startTrainingExercise('due')`);
        assert.strictEqual(w.eval('gameMode'), 'training');
        const pill = $('#board-pill');
        assert(!pill.hidden && pill.textContent === 'Toucher pour passer', 'pastille montrée pendant la mise en situation');
        assert.strictEqual(w.eval('JSON.stringify(__pill.find(x => x[0] === "show"))'), '["show","Toucher pour passer","function"]');
        assert.strictEqual($('#status-text').textContent, 'Mise en situation…', 'sans sous-texte redondant');
        assert(/^1 \/ 1$/.test($('#tr-progress .tr-prog-n').textContent), 'compteur « 1 / N »');
        pill.click();                                                   // passer
        assert(pill.hidden, 'pastille retirée quand la main revient');
        assert.strictEqual(w.eval('__pill[__pill.length - 1][0]'), 'hide');
        assert(/^À vous de jouer/.test($('#status-text .status-title').textContent));
        assert(/ne compte pas comme une erreur/.test($('.tb-hint').title), 'infobulle de l\'Indice en séance');
        w.eval('quitTraining()');
        assert(pill.hidden);
    });

    await t('séance : ◀ ▶ revoient les coups joués ; toucher l\'échiquier ou l\'Indice ramène au présent sans rien rejouer', async () => {
        seed({ dueIn: -1, lastOnly: true });                           // 3. Fc4 : mise en situation 1. e4 e5 2. Cf3 Cc6
        w.eval(`trainingState.lastSummary = null; _trOpening = null; initTraining(); startTrainingExercise('due')`);
        $('#board-pill').click();                                       // passer la mise en situation
        assert.strictEqual(w.eval('trainingState.busy'), false);
        const len = w.eval('moveHistory.length');
        assert(len >= 4, 'coups de contexte dans l\'historique');
        assert(!$('#btn-prev').closest('[style*="display: none"]'), '◀ visible en séance');
        w.eval('navPrev()');
        assert.notStrictEqual(w.eval('navCursor'), -1, 'navigation en arrière');
        assert(/^Navigation/.test($('#status-text .status-title').textContent));
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        assert.strictEqual(w.eval('navCursor'), len - 3, 'flèche gauche active en séance');
        w.eval(`handleClick(squareToIdx('a2'))`);                       // toucher l'échiquier
        assert.strictEqual(w.eval('navCursor'), -1, 'retour au présent');
        assert.strictEqual(w.eval('moveHistory.length'), len, 'historique intact (pas de nouvelle variante)');
        assert.strictEqual(w.eval('selected'), null, 'le toucher ne sélectionne rien');
        assert(/^À vous de jouer/.test($('#status-text .status-title').textContent), 'consigne revenue');
        w.eval('navPrev(); showHint()');
        assert.strictEqual(w.eval('navCursor'), -1, 'l\'Indice ramène au présent');
        assert.strictEqual(w.eval('moveHistory.length'), len);
        assert(/^Indice/.test($('#status-text .status-title').textContent), 'indice de la position en cours');
        w.eval('quitTraining()');
    });

    await t('lancement : bouton occupé (aria-busy) le temps de préparer la séance', async () => {
        w.eval(`switchHomeTab('training')`);
        seed({ dueIn: -1 });
        render();
        const b = $('#training-panel .btn-primary');
        b.click();
        assert.strictEqual(b.getAttribute('aria-busy'), 'true');
        assert(b.disabled);
        await new Promise(r => setTimeout(r, 80));
        assert.strictEqual(w.eval('gameMode'), 'training', 'séance lancée');
        w.eval('quitTraining()');
    });

    await t('Révision du jour : nouvelles positions plafonnées à l\'objectif quotidien, le reste étalé ; libellé « à réviser aujourd’hui »', () => {
        w.eval(`(() => {
            const db = {}, now = Date.now();
            Chess.replay([]);
            const moves = ['e2e4', 'd2d4', 'c2c4', 'g1f3', 'b1c3', 'f2f4', 'g2g3', 'b2b3', 'e2e3', 'd2d3', 'c2c3', 'h2h3', 'a2a3', 'g1h3', 'b1a3'];
            moves.forEach((m, i) => { const e = newEntry(m, m, [m]); e.created = now - 1000 + i; db['k' + i] = e; });
            dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
            dataStore.set(dbKeyFor(currentRepertoire, 'b'), '{}');
            appSettings.dailyGoal = 10; trainingState.lastSummary = null; _trOpening = null; _trColor = 'mix';
        })()`);
        render();
        assert.strictEqual($('.trr-big b').textContent, '10', '10 aujourd\'hui, pas 15');
        assert(/à réviser aujourd’hui/.test($('.trr-big span').textContent));
        assert.strictEqual($('.trr-split').textContent.trim(), '10 nouvelles');
        assert(!/positions dues/.test($('#training-panel').textContent), 'plus de « positions dues »');
        const fc = $$('.trr-fc > div b').map(b => Number(b.textContent || 0));
        assert.deepStrictEqual(fc.slice(0, 3), [10, 5, 0], 'le reste demain');
        w.eval(`startTrainingExercise('due')`);
        assert.strictEqual(w.eval('trainingState.session && trainingState.session.items.length'), 10, 'la séance reprend le programme');
        w.eval('quitTraining()');
    });

    await t('Plateau : l\'aperçu montre l\'exercice de l\'action principale, puis celui qu\'on survole', () => {
        w.eval(`switchHomeTab('training')`);
        seed({ dueIn: -1 });
        w.eval(`trainingState.lastSummary = null`);
        render();
        const stage = $('#trr-stage');
        assert(stage && stage.querySelector('.st-mini'), 'échiquier d\'aperçu');
        assert(/^La plus en retard/.test(stage.querySelector('.trr-stage-pill span').textContent), 'positions dues : la plus en retard');
        assert($('.trr-day').classList.contains('is-preview'));
        const row = $('.trr-row[data-focus="timed"]');
        row.dispatchEvent(new w.Event('pointerover', { bubbles: true }));
        assert(/^Contre-la-montre/.test($('#trr-stage .trr-stage-pill span').textContent), 'survol : l\'aperçu suit');
        assert(row.classList.contains('is-preview') && !$('.trr-day').classList.contains('is-preview'));
        assert.strictEqual(w.eval('gameMode') === 'training', false, 'survoler ne lance rien');

        seed({ empty: true });
        render();
        assert($('.trr.is-empty #trr-stage.is-empty .st-mini'), 'répertoire vide : position de départ en retrait');
        assert($('.trr-empty [data-action="homeImportPgn"].btn-soft'), 'Importer un PGN en action tonale');
    });

    await t('capsule Suite : erreurs du bilan, sinon révisions, sinon nouveautés ou objectif ; cachée sans rien à proposer', () => {
        const chip = () => $('#suite-slot .suite-chip'), slot = $('#suite-slot');
        w.eval(`goHome('training')`);
        seed({ dueIn: -1 });
        summary(2);
        w.eval('Suite.refresh()');
        assert(!slot.hidden && chip().classList.contains('is-retry'), 'bilan avec erreurs');
        assert.strictEqual(chip().dataset.action, 'suiteRetry');
        assert(/Revoir 2 erreurs/.test(chip().textContent));
        w.eval(`trainingState.lastSummary = null; Suite.refresh()`);
        assert(chip().classList.contains('is-due') && /3 à réviser/.test(chip().textContent), 'positions dues : ' + chip().textContent);
        assert.strictEqual(chip().dataset.action, 'suiteDue');
        seed({ dueIn: 3 });
        w.eval(`dataStore.setJSON(ACTIVITY_KEY, {}); Suite.refresh()`);
        assert(slot.hidden && !chip(), 'rien à proposer : cachée');
        w.eval(`dataStore.setJSON(ACTIVITY_KEY, { [dayStamp(Date.now())]: { a: appSettings.dailyGoal, f: 0 } }); Suite.refresh()`);
        assert(chip().classList.contains('is-done'), 'objectif atteint');
        w.eval(`dataStore.setJSON(ACTIVITY_KEY, {})`);
    });

    await t('capsule Suite en séance : position et série sans faute ; objectif du jour annoncé une seule fois', () => {
        seed({ dueIn: -1 });
        w.eval(`startDailyReview()`);
        const chip = () => $('#suite-slot .suite-chip');
        assert(chip().classList.contains('is-live') && /1 \/ 3/.test(chip().textContent), 'séance : ' + chip().textContent);
        assert.strictEqual(chip().tagName, 'SPAN', 'en séance, rien à cliquer');
        w.eval(`trainingState.combo = 4; _renderSessionBar()`);
        assert(/×4/.test(chip().textContent), 'série dans la capsule');
        assert(/×4 sans faute/.test($('#tr-progress').textContent), 'série dans la barre de séance');
        w.eval(`window.__toasts = []; AccountUI.notify = m => window.__toasts.push(m);
                dataStore.setJSON(ACTIVITY_KEY, { [dayStamp(Date.now())]: { a: appSettings.dailyGoal, f: 0 } });
                Suite.afterAnswer(); Suite.afterAnswer();`);
        const toasts = w.eval('window.__toasts');
        assert.strictEqual(toasts.length, 1, 'une seule annonce');
        assert(/Objectif du jour atteint/.test(toasts[0]));
        w.eval(`stopTraining(); trainingState.session = null; dataStore.setJSON(ACTIVITY_KEY, {}); goHome('training')`);
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
