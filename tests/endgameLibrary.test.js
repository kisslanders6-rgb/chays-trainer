// Lancer : node tests/endgameLibrary.test.js   — Finales « Bibliothèque » (lot 7) : « À suivre », puces de catégorie,
// aperçu sans lancement, jauge de séance, verdict « avant → après », origine du jugement, théorie repliée.
// Charge index.html entier dans jsdom, comme boot.test.js ; aucun réseau (juge commun simulé).
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

// Progression simulée (chessTrainer_endgames) : deux mats réussis (dont un sans faute), un en cours, deux finales de pions réussies.
const PROGRESS = {
    kqk: { tries: 1, wins: 1, perfect: true, best: 9, last: 1 },
    krk: { tries: 2, wins: 1, perfect: false, best: 14, last: 1 },
    kbnk: { tries: 3, wins: 0, perfect: false, best: 0, last: 1 },
    'kpk-carre': { tries: 1, wins: 1, perfect: true, best: 5, last: 1 },
    'rook-lucena': { tries: 1, wins: 1, perfect: false, best: 8, last: 1 }
};

let wide = false;                                   // largeur simulée : ≥ 920 px (colonne d'aperçu) ou non (panneau du bas)
async function boot() {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
        url: 'http://localhost/index.html', runScripts: 'dangerously', resources: new DiskLoader(), pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(w) {
            w.localStorage.setItem('chessTrainer_onboarded', '1');
            w.localStorage.setItem('chessTrainer_endgames', JSON.stringify(PROGRESS));
            w.matchMedia = q => ({ matches: wide && /min-width: 920px/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
            w.Element.prototype.getAnimations = () => [];
            w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
            w.Element.prototype.scrollIntoView = function () { w.__scrolled = this.id; };
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
    // Juge commun simulé : verdict « nulle » exact, sans réseau ni moteur.
    w.eval(`EndgameJudge.probe = () => Promise.resolve({ wdl: 0, source: 'syzygy', exact: true, moves: [] });
            EndgameJudge.judgeMove = () => Promise.resolve({ before: 0, after: 0, source: 'syzygy', exact: true });`);
    w.eval(`switchHomeTab('endgame')`);

    await t('« À suivre » est le premier exercice non réussi du catalogue ; l\'accueil a exactement un .btn-primary', () => {
        const expected = w.eval(`ENDGAME_CATEGORIES.flatMap(c => ENDGAME_EXERCISES.filter(e => e.cat === c.id)).find(e => !(${JSON.stringify(PROGRESS)}[e.id] || {}).wins).id`);
        assert.strictEqual(expected, 'krrk');
        const go = $('#eg-preview .eg-go');
        assert.strictEqual(go.dataset.action, 'startEndgame');
        assert.strictEqual(go.dataset.arg, expected);
        assert(/À suivre/.test($('#eg-preview .st-eyebrow').textContent));
        assert($('#eg-preview .st-mini'), 'mini-position de « À suivre »');
        assert.strictEqual($$('#home-tab-endgame .btn-primary').length, 1);
    });

    await t('puces Ring.chip : réussis / total exacts par catégorie, et saut vers la section', () => {
        const chips = $$('#endgame-panel .eg-chips .ring-chip');
        const cats = w.eval('ENDGAME_CATEGORIES.map(c => [c.id, c.label, ENDGAME_EXERCISES.filter(e => e.cat === c.id).length])');
        assert.strictEqual(chips.length, cats.length);
        const won = { mats: 2, pions: 1, tours: 1 };
        cats.forEach(([id, label, total], i) => {
            assert.strictEqual(chips[i].dataset.action, 'egJump');
            assert.strictEqual(chips[i].dataset.arg, id);
            assert.strictEqual(chips[i].getAttribute('aria-label'), `${label} : ${won[id] || 0} sur ${total}`);
            assert.strictEqual(chips[i].querySelector('.ring-chip-max').textContent, `/ ${total}`);
        });
        assert.strictEqual(chips[0].getAttribute('aria-current'), 'true', 'catégorie de « À suivre »');
        chips[2].click();
        assert.strictEqual(w.__scrolled, 'eg-sec-tours');
        assert.strictEqual(chips[2].getAttribute('aria-current'), 'true');
    });

    await t('état à droite des lignes : sans faute, réussi, essais, difficulté', () => {
        const end = id => $(`.eg-card[data-arg="${id}"] .eg-card-end`);
        assert(end('kqk').querySelector('.eg-st.is-perfect .ico'));
        assert(end('krk').querySelector('.eg-st.is-done .ico'));
        assert.strictEqual(end('kbnk').querySelector('.eg-st.is-tried').textContent, '3 essais');
        assert.strictEqual(end('krrk').querySelector('.eg-dots').getAttribute('aria-label'), 'Difficulté 1 sur 5');
        // Objectif à icône du sprite, camp par le roi du jeu actif (jamais un glyphe Unicode).
        const row = $('.eg-card[data-arg="kpk-carre-def"]');
        assert(row.querySelector('.eg-goal-tag use').getAttribute('href') === '#i-shield-check');
        assert(row.querySelector('.eg-king[data-glyph="k"]'));
        assert(!/[♔♕♖♗♘♙♚♛♜♝♞♟]/.test($('#endgame-panel').textContent));
        assert.deepStrictEqual(['kqk', 'kpk-carre', 'tours-tarrasch'].map(id => $(`.eg-card[data-arg="${id}"] .eg-goal-tag use`).getAttribute('href')),
            ['#i-flag', '#i-target', '#i-target']);
    });

    await t('un clic sur une ligne ouvre l\'aperçu sans appeler startEndgame (panneau du bas, puis colonne de droite)', () => {
        w.eval('window.__starts = []; window.__start = startEndgame; startEndgame = id => window.__starts.push(id);');
        $('.eg-card[data-arg="rook-philidor"]').click();
        assert.deepStrictEqual(w.eval('window.__starts.length'), 0);
        const sheet = $('#eg-sheet .eg-sheet[role="dialog"]');
        assert(sheet, 'panneau du bas');
        assert.strictEqual(sheet.querySelector('.eg-go').dataset.arg, 'rook-philidor');
        assert.strictEqual(w.document.activeElement, sheet.querySelector('.eg-go'));
        sheet.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert(!$('#eg-sheet'), 'Échap ferme le panneau');

        wide = true;
        $('.eg-card[data-arg="tours-tarrasch"]').click();
        assert(!$('#eg-sheet'));
        assert.strictEqual(w.eval('window.__starts.length'), 0);
        assert.strictEqual($('#eg-preview .eg-go').dataset.arg, 'tours-tarrasch');
        assert(/Choisi/.test($('#eg-preview .st-eyebrow').textContent));
        assert($('.eg-card[data-arg="tours-tarrasch"]').classList.contains('is-sel'));
        assert.strictEqual($$('#home-tab-endgame .btn-primary').length, 1);
        $('#eg-preview .eg-go').click();
        assert.strictEqual(w.eval('JSON.stringify(window.__starts)'), '["tours-tarrasch"]', 'seul « Commencer » lance');
        w.eval('startEndgame = window.__start;');
        wide = false;
    });

    const ticks = () => $$('#endgame-card .eg-ticks i');
    await t('jauge : autant de graduations que hold, keep ou maxMoves', () => {
        for (const id of ['kpk-carre-def', 'tours-tarrasch', 'kqk', 'pions-eloigne', 'rook-philidor']) {
            w.eval(`startEndgame('${id}')`);
            const ex = w.eval(`ENDGAME_BY_ID['${id}']`);
            const want = ex.goal === 'draw' ? ex.hold : ex.keep || ex.maxMoves;
            assert.strictEqual(ticks().length, want, id);
            assert.strictEqual($('#endgame-card .eg-ticks').getAttribute('aria-valuemax'), String(want));
        }
    });

    await t('erreur jugée : verdict « Nulle → Perte », coup fautif en rouge, « Annuler ce coup » seule action pleine', () => {
        w.eval(`startEndgame('kpk-carre-def')`);
        w.eval(`executePlayerMove(squareToIdx('h3'), squareToIdx('h2'))`);       // hors du carré : le pion passe
        const card = $('#endgame-card');
        assert(card.classList.contains('is-err'));
        assert.strictEqual(card.querySelector('.eg-verdict .eg-vpill.is-from').textContent, 'Nulle');
        assert.strictEqual(card.querySelector('.eg-verdict .eg-vpill.is-to').textContent, 'Perte');
        assert.deepStrictEqual(ticks().map(i => i.className), ['bad', '', '', '', '', '']);
        const primaries = card.querySelectorAll('.btn-primary');
        assert.strictEqual(primaries.length, 1);
        assert.strictEqual(primaries[0].dataset.action, 'undoEndgameMove');
        assert(/Calcul exact/.test(card.querySelector('.vbadge').textContent));
        primaries[0].click();
        assert(!$('#endgame-card .eg-verdict'), 'coup annulé : plus de verdict');
        assert.deepStrictEqual(ticks().map(i => i.className), ['', '', '', '', '', '']);
    });

    await t('origine du jugement : Syzygy, réponse gardée hors ligne, moteur estimé (tireté)', () => {
        w.eval(`startEndgame('rook-philidor')`);
        const badge = () => $('#endgame-card .eg-src');
        w.eval(`endgameState.source = 'syzygy'; endgameState.exact = true; renderEndgameCard()`);
        assert.strictEqual(badge().textContent, 'Tables Syzygy · exact');
        Object.defineProperty(w.navigator, 'onLine', { get: () => false, configurable: true });
        w.eval('renderEndgameCard()');
        assert.strictEqual(badge().textContent, 'Réponse gardée · exact');
        Object.defineProperty(w.navigator, 'onLine', { get: () => true, configurable: true });
        w.eval(`endgameState.source = 'engine'; endgameState.exact = false; renderEndgameCard()`);
        assert.strictEqual(badge().textContent, 'Moteur · verdict estimé');
        assert(badge().classList.contains('is-dashed'));
    });

    await t('théorie repliée pendant la séance, dépliée par « Théorie », ouverte d\'office à la fin', () => {
        w.eval(`startEndgame('rook-philidor')`);
        const btn = $('#endgame-card .eg-theory-btn');
        assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
        assert($('#endgame-card .eg-theory').hidden);
        btn.click();
        assert.strictEqual($('#endgame-card .eg-theory-btn').getAttribute('aria-expanded'), 'true');
        assert(!$('#endgame-card .eg-theory').hidden);
        w.eval(`startEndgame('rook-philidor'); _egFinish('Nulle assurée.')`);
        assert(!$('#endgame-card .eg-theory-btn'));
        assert(!$('#endgame-card .eg-theory').hidden);
        const primaries = $$('#endgame-card .btn-primary');
        assert.deepStrictEqual(primaries.map(b => b.dataset.action), ['nextEndgame']);
        assert(ticks().length === 0 || ticks().every(i => i.className !== 'bad'));
    });

    await t('endgameSelfTest reste vert (aucune FEN modifiée)', () => {
        const bad = w.eval('endgameSelfTest().filter(r => !r.ok).map(r => r.id)');
        assert.strictEqual(JSON.stringify(bad), '[]');
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
