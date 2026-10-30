// Lancer : node tests/statusReceipt.test.js   — écran de jeu (lot 7) : barre d'état à action facultative, reçu d'un
// coup enregistré en Jouer (« Annuler » sans confirmation, corbeille), Indice indisponible, suites adverses sans
// comptage. Charge index.html entier dans jsdom, comme boot.test.js.
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const ROOT = path.join(__dirname, '..');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

class DiskLoader extends ResourceLoader {
    fetch(url) {
        const u = new URL(url);
        if (u.hostname !== 'localhost') return Promise.resolve(Buffer.from(''));
        return fs.promises.readFile(path.join(ROOT, decodeURIComponent(u.pathname)));
    }
}

async function boot(storage = {}) {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
        url: 'http://localhost/index.html', runScripts: 'dangerously', resources: new DiskLoader(), pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(w) {
            Object.entries(Object.assign({ chessTrainer_onboarded: '1' }, storage)).forEach(([k, v]) => w.localStorage.setItem(k, v));
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
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s) };
}

// Joue un coup par ses cases (« e2 », « e4 ») pour le camp au trait, comme sur l'échiquier.
const play = (w, from, to) => w.eval(`executePlayerMove(squareToIdx('${from}'), squareToIdx('${to}'))`);
const opp  = (w, from, to) => w.eval(`executeOpponentMove(squareToIdx('${from}'), squareToIdx('${to}'))`);
const confirmOpen = $ => !$('#confirm-overlay').classList.contains('hidden');

(async () => {
    const { w, errors, $ } = await boot();

    await t('setStatus sans action : même DOM qu\'avant (titre, détail), aucun bouton', () => {
        w.eval(`setStatus('Titre', 'info', 'Détail')`);
        const text = $('#status-text');
        assert.deepStrictEqual([...text.children].map(c => c.className), ['status-title', 'status-detail']);
        assert.strictEqual(text.textContent, 'TitreDétail');
        assert(!$('#status-bar .status-act'));
        assert(!$('#status-bar').classList.contains('has-act'));
    });

    await t('setStatus avec action : bouton .status-act au texte échappé, le clic appelle run, le message suivant le retire', () => {
        w.eval(`window.__runs = 0; setStatus('Titre', 'new', '', { action: '<b>Annuler</b>', run: () => window.__runs++ })`);
        const btn = $('#status-bar .status-act');
        assert(btn, 'bouton absent');
        assert.strictEqual(btn.textContent, '<b>Annuler</b>');
        assert(!btn.querySelector('b'), 'libellé interprété comme du HTML');
        assert(btn.classList.contains('btn-soft'));
        btn.click();
        assert.strictEqual(w.__runs, 1);
        w.eval(`setStatus('Autre chose')`);
        assert(!$('#status-bar .status-act'));
    });

    await t('reçu : mon coup enregistré dans une position inconnue, « Annuler » le retire sans confirmation, vers la corbeille', () => {
        w.eval(`startGame('w')`);
        play(w, 'e2', 'e4');
        assert(w.eval(`!!openingDB['${START}']`), 'entrée non créée');
        assert(/Réponse enregistrée : 1\. e4/.test($('#status-text').textContent));
        const btn = $('#status-bar .status-act');
        assert(btn && /Annuler/.test(btn.textContent), 'reçu sans bouton Annuler');
        const trashBefore = w.eval('loadTrash().length');
        btn.click();
        assert(!confirmOpen($), 'aucune fenêtre de confirmation attendue');
        assert(!w.eval(`openingDB['${START}']`), 'entrée toujours au répertoire');
        assert.strictEqual(w.eval('moveHistory.length'), 0, 'coup non défait');
        assert.strictEqual(w.eval('loadTrash().length'), trashBefore + 1, 'entrée absente de la corbeille');
        assert(/Rétablir/.test($('#status-bar .status-act').textContent), 'après Annuler : seul « Rétablir » reste proposé');
    });

    await t('reçu : retiré dès que la position affichée change ; Annuler se rabat alors sur « Corriger » (confirmation)', () => {
        w.eval(`startGame('w')`);
        play(w, 'e2', 'e4');
        assert($('#status-bar .status-act'));
        w.eval('navPrev()');
        assert(!$('#status-bar .status-act'), 'navigation : reçu toujours affiché');
        w.eval('navNext()');
        assert(!$('#status-bar .status-act'), 'retour : le reçu ne revient pas');
        w.eval('undoRecordedMove()');
        assert(confirmOpen($), 'repli sur undoMove : confirmation attendue');
        assert(w.eval(`!!openingDB['${START}']`), 'rien ne doit être effacé avant la confirmation');
        $('#confirm-cancel-btn').click();
        // Coup suivant : le reçu disparaît aussi
        opp(w, 'e7', 'e5');
        assert(!$('#status-bar .status-act'));
    });

    await t('Indice : indisponible au trait de l\'adversaire et dans une position inconnue, la raison en infobulle', () => {
        w.eval(`openingDB = {}; saveDB(); startGame('w')`);
        const hint = () => $('.tb-hint');
        assert(hint().disabled, 'position inconnue : Indice actif');
        assert(/Position inconnue/.test(hint().title));
        play(w, 'e2', 'e4');
        assert(hint().disabled, 'trait adverse : Indice actif');
        assert(/tour de l'adversaire/i.test(hint().title));
        w.eval(`startGame('w')`);                                   // e4 est désormais enregistré
        assert(!hint().disabled, 'position connue à mon trait : Indice disponible');
        assert(/Jouer ne compte rien/.test(hint().title));
    });

    await t('suites adverses : trois puces au trait adverse ; en jouer une ne compte rien (ni essai, ni erreur, ni révision)', () => {
        w.eval(`startGame('w')`);
        play(w, 'e2', 'e4');
        const before = w.eval(`JSON.stringify(openingDB)`);
        w.eval(`_freqRows = () => [
            { uci: 'e7e5', san: 'e5', own: 3, ownPct: .6, lichPct: null, covered: false },
            { uci: 'c7c5', san: 'c5', own: 2, ownPct: .3, lichPct: null, covered: false },
            { uci: 'e7e6', san: 'e6', own: 1, ownPct: .1, lichPct: null, covered: true },
            { uci: 'd7d5', san: 'd5', own: 1, ownPct: .05, lichPct: null, covered: false }]; renderOppSuites();`);
        const chips = [...w.document.querySelectorAll('#opp-suites .opp-suite')];
        assert(!$('#opp-suites').hidden);
        assert.strictEqual(chips.length, 3, 'trois suites au plus');
        assert.strictEqual(chips.filter(c => c.querySelector('.opp-dot.is-ok')).length, 1);
        chips[0].click();
        assert.strictEqual(w.eval('moveHistory.length'), 2, 'coup adverse non joué');
        assert.strictEqual(w.eval(`JSON.stringify(openingDB)`), before, 'Jouer ne compte rien');
        assert($('#opp-suites').hidden, 'à mon trait : suites masquées');
    });

    await t('états : tuile d\'icône et teinte par type (data-type), type inconnu ramené à info', () => {
        w.eval(`setStatus('Pas le bon coup', 'err', 'Réessayez')`);
        assert.strictEqual($('#status-bar').dataset.type, 'err');
        assert($('#status-dot.dot-err use[href="#i-x"]'), 'icône x');
        w.eval(`setStatus('Coup', 'trash')`);
        assert($('#status-dot use[href="#i-trash"]'));
        w.eval(`setStatus('Autre', 'bizarre')`);
        assert.strictEqual($('#status-bar').dataset.type, 'info');
    });

    await t('reçu : badge ✓ sur la case jouée, Annuler → état corbeille, « Rétablir » remet le coup et son reçu', () => {
        w.eval(`openingDB = {}; saveDB(); startGame('w')`);
        play(w, 'e2', 'e4');
        assert.strictEqual($('#status-bar').dataset.type, 'ok', 'reçu en vert');
        assert($('#board .sq[data-idx="' + w.eval(`squareToIdx('e4')`) + '"] .sq-badge.is-ok'), 'badge sur e4');
        $('#status-bar .status-act').click();
        assert.strictEqual($('#status-bar').dataset.type, 'trash');
        assert(/^1\. e4 mis à la corbeille$/.test($('#status-text .status-title').textContent));
        assert(!$('#board .sq-badge'), 'plus de badge après Annuler');
        const btn = $('#status-bar .status-act');
        assert(btn && /Rétablir/.test(btn.textContent));
        const trash = w.eval('loadTrash().length');
        btn.click();
        assert(w.eval(`!!openingDB['${START}']`), 'entrée rétablie');
        assert.strictEqual(w.eval('moveHistory.length'), 1, 'coup rejoué');
        assert.strictEqual(w.eval('loadTrash().length'), trash - 1, 'sortie de la corbeille');
        assert(/Réponse enregistrée : 1\. e4/.test($('#status-text').textContent), 'nouveau reçu');
        assert($('#status-bar .status-act') && /Annuler/.test($('#status-bar .status-act').textContent));
    });

    await t('Indice : libellé « Indice indisponible » ; mis en avant après un coup refusé, jusqu\'au coup suivant', () => {
        w.eval(`openingDB = {}; saveDB(); startGame('w')`);
        assert.strictEqual($('.tb-hint .btn-label').textContent, 'Indice indisponible');
        play(w, 'e2', 'e4');
        opp(w, 'e7', 'e5');
        play(w, 'g1', 'f3');                                    // enregistré
        w.eval(`startGame('w')`);
        play(w, 'e2', 'e4');                                    // bon coup
        opp(w, 'e7', 'e5');
        assert.strictEqual($('.tb-hint .btn-label').textContent, 'Indice');
        play(w, 'b1', 'c3');                                    // refusé
        assert.strictEqual($('#status-bar').dataset.type, 'err');
        assert($('.tb-hint').classList.contains('is-suggest'), 'Indice mis en avant');
        play(w, 'g1', 'f3');
        assert(!$('.tb-hint').classList.contains('is-suggest'), 'retiré au coup suivant');
    });

    assert.deepStrictEqual(errors, []);
    w.close();
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
