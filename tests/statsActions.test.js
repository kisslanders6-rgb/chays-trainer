// Lancer : node tests/statsActions.test.js   — Statistiques « Pupitre » (lot 7) : une seule action pleine, barre de
// maîtrise qui filtre comme la légende, boutons qui ouvrent l'Entraînement sans lancer de séance, ▶ qui révise une
// seule position, états vides, faits de l'aperçu. Charge index.html entier dans jsdom, comme boot.test.js.
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
            w.scrollTo = () => {};
            w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
            w.addEventListener('error', e => errors.push(e.message));
        }
    });
    await new Promise(r => dom.window.addEventListener('load', r));
    await new Promise(r => setTimeout(r, 5000));
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s), $$: s => [...dom.window.document.querySelectorAll(s)] };
}

// Répertoire de démonstration : Blancs, une Italienne ; due = décalage en jours de chaque échéance.
const LINE = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3';
const seed = (w, dues, tries = [[4, 3], [5, 2], [6, 0], [2, 0]]) => w.eval(`(() => {
    const p = '${LINE}'.split(' '), db = {}, now = Date.now(), dues = ${JSON.stringify(dues)}, tries = ${JSON.stringify(tries)};
    for (let k = 0, i = 0; k < p.length; k += 2, i++) {
        const path = p.slice(0, k + 1), pos = Chess.replay(path.slice(0, -1));
        const [a, f] = tries[i % tries.length];
        db[Chess.key(pos)] = { move: path[k], san: Chess.san(pos, path[k]), attempts: a, failures: f, path, ply: path.length,
                               due: now + dues[i % dues.length] * 864e5, interval: 3, created: now };
    }
    dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
    dataStore.set(dbKeyFor(currentRepertoire, 'b'), JSON.stringify({}));
    statsColor = 'all'; statsFilter = 'all'; statsOpen = null;
    switchHomeTab('stats');
    initStats();
})()`);

(async () => {
    const { w, errors, $, $$ } = await boot();
    // Espions : aucune séance ne doit partir des Statistiques, sauf ▶ / S'entraîner sur une position.
    w.eval(`window.__calls = { train: [], session: [], queue: [] };
        const _otf = openTrainingFrom; openTrainingFrom = o => { __calls.train.push(JSON.parse(JSON.stringify(o))); };
        const _ss = startSession; startSession = o => { __calls.session.push(o.kind); return false; };
        const _rq = startReviewQueue; startReviewQueue = (items, tab) => { __calls.queue.push({ items: JSON.parse(JSON.stringify(items)), tab }); return false; };`);
    const calls = () => JSON.parse(w.eval('JSON.stringify(__calls)'));     // objets du realm de Node
    const reset = () => w.eval('__calls = { train: [], session: [], queue: [] }');
    const primaries = () => $$('#home-tab-stats .btn-primary');

    await t('positions dues : un seul .btn-primary, « Révision du jour »', () => {
        seed(w, [-1, 2, 0, 5]);
        assert.strictEqual(primaries().length, 1);
        const b = primaries()[0];
        assert.strictEqual(b.dataset.action, 'statsGoTraining');
        assert.strictEqual(b.dataset.arg, 'due');
        assert(/Révision du jour/.test(b.textContent));
        assert.strictEqual($$('#home-tab-stats .st-cta').length, 0, 'plus de .st-cta dans les Statistiques');
    });

    await t('tout à jour : un seul .btn-primary, « Points faibles » ; la prévision compte 7 jours', () => {
        seed(w, [2, 3, 1, 9]);
        assert.strictEqual(primaries().length, 1);
        assert.strictEqual(primaries()[0].dataset.arg, 'weak');
        assert(/Points faibles/.test(primaries()[0].textContent));
        const bars = $$('.st-fc > div');
        assert.strictEqual(bars.length, 7);
        assert(/3 positions/.test($('.st-fc-h b').textContent), 'trois échéances dans les 7 jours, la quatrième au-delà');
    });

    await t('« Points faibles » et « Réviser cette ouverture » : .btn-soft, openTrainingFrom, aucune séance', () => {
        seed(w, [-1, 2, 0, 5]);
        reset();
        const weak = $('.st-weak .st-golink');
        assert(weak.classList.contains('btn-soft') && !weak.classList.contains('btn-primary'));
        weak.click();
        const rev = $('#stats-lines .st-golink');
        assert(rev && rev.classList.contains('btn-soft'), 'ouverture dépliée avec des positions dues');
        rev.click();
        const c = calls();
        assert.strictEqual(c.train.length, 2);
        assert.deepStrictEqual(c.train[0], { color: 'all', focus: 'weak' });
        assert.strictEqual(c.train[1].focus, 'due');
        assert(c.train[1].opening && c.train[1].color === 'w');
        assert.deepStrictEqual(c.session, [], 'aucune séance lancée');
        assert.deepStrictEqual(c.queue, []);
    });

    await t('clic sur un segment de la barre de maîtrise = même filtre que la puce de légende', () => {
        seed(w, [-1, 2, 0, 5]);
        $('.st-legend .st-lg[data-arg="weak"]').click();
        const byLegend = { filter: w.eval('statsFilter'), lines: $('#stats-lines .st-lines').innerHTML };
        seed(w, [-1, 2, 0, 5]);
        const seg = $('.st-mbar button[data-arg="weak"]');
        assert.strictEqual(seg.dataset.action, 'statsLegend');
        seg.click();
        assert.strictEqual(w.eval('statsFilter'), 'weak');
        assert.deepStrictEqual({ filter: w.eval('statsFilter'), lines: $('#stats-lines .st-lines').innerHTML }, byLegend);
        assert.strictEqual($('.st-mbar button[data-arg="weak"]').getAttribute('aria-pressed'), 'true');
        assert($('.st-mbar').classList.contains('has-on'));
        assert.strictEqual($('.st-legend .st-lg[data-arg="weak"]').getAttribute('aria-pressed'), 'true');
        assert(!$('.st-mbar [data-arg="unsure"]'), '« À confirmer » reste hors de la barre');
        $('.st-mbar button[data-arg="weak"]').click();
        assert.strictEqual(w.eval('statsFilter'), 'all', 'second clic : filtre retiré');
    });

    await t('▶ sur une position : startReviewQueue avec cette position seulement', () => {
        seed(w, [-1, 2, 0, 5]);
        reset();
        const btn = $('#stats-lines .st-ibtn.pri');
        assert(!btn.classList.contains('btn-primary'));
        const [color, key] = [btn.dataset.arg.slice(0, 1), btn.dataset.arg.slice(2)];
        btn.click();
        const c = calls();
        assert.deepStrictEqual(c.queue, [{ items: [{ color, key }], tab: 'stats' }]);
        assert.deepStrictEqual(c.train, []);
    });

    await t('points faibles : mini-échiquier, la ligne entière ouvre l\'aperçu (data-origin="weak")', () => {
        seed(w, [-1, 2, 0, 5]);
        const row = $('.st-wrow');
        assert.strictEqual(row.tagName, 'BUTTON');
        assert(row.querySelector('.st-mini'));
        assert.strictEqual(row.dataset.action, 'statsPreview');
        assert.strictEqual(row.dataset.origin, 'weak');
    });

    await t('légende : la règle du niveau en title ; plus de bulle ⓘ ni de mention de Jouer', () => {
        seed(w, [-1, 2, 0, 5]);
        assert(/plus d'une erreur sur deux/.test($('.st-lg[data-arg="weak"]').title));
        assert(/moins de 3 essais/.test($('.st-lg[data-arg="unsure"]').title));
        assert(!$('#stats-info-btn') && !$('#stats-info'));
        assert(!/Jouer/.test($('#stats-body').textContent));
    });

    await t('aperçu : plus de « Appuyez sur S\'entraîner », trois faits dans le panneau latéral, cachés hors aperçu', () => {
        seed(w, [-1, 2, 0, 5]);
        $('.st-wrow').click();
        assert.strictEqual(w.eval('gameMode'), 'preview');
        assert(!/Appuyez/.test($('#status-text').textContent));
        const facts = $('#side-panel #stats-facts');
        assert(facts && facts.previousElementSibling.id === 'status-bar');
        assert.strictEqual(facts.children.length, 3);
        assert(/Niveau/.test(facts.textContent) && /Erreurs/.test(facts.textContent) && /Révision/.test(facts.textContent));
        assert.strictEqual(facts.style.display, '');
        w.eval(`goHome('stats'); startGame('w')`);
        assert.strictEqual(facts.style.display, 'none');
        w.eval(`goHome('stats')`);
    });

    await t('états vides : aucun essai → « Ouvrir l\'Entraînement » ; répertoire vide → « Ajouter une ligne »', () => {
        seed(w, [0], [[0, 0]]);
        assert(/Aucun essai pour « /.test($('.st-empty').textContent));
        assert.strictEqual(primaries().length, 1);
        reset();
        primaries()[0].click();
        assert.deepStrictEqual(calls().train, [{ color: 'all', focus: 'due' }]);
        assert.deepStrictEqual(calls().session, []);
        w.eval(`dataStore.set(dbKeyFor(currentRepertoire, 'w'), '{}'); initStats()`);
        assert(/Répertoire vide/.test($('.st-empty').textContent));
        assert.strictEqual(primaries()[0].dataset.action, 'statsAddLine');
    });

    await t('levelBarHTML sans le paramètre buttons : sortie inchangée (non-régression)', () => {
        const out = w.eval(`levelBarHTML({ weak: 1, fragile: 0, progress: 2, solid: 0, unsure: 4, mastered: 3 }, 'hp-bar')`);
        assert.strictEqual(out, '<span class="lv-bar hp-bar" aria-hidden="true">'
            + '<i class="lv-weak" style="flex:1" title="À retravailler : 1"></i>'
            + '<i class="lv-progress" style="flex:2" title="En progrès : 2"></i>'
            + '<i class="lv-mastered" style="flex:3" title="Maîtrisées : 3"></i></span>');
        assert.strictEqual(w.eval(`levelBarHTML({ solid: 2 })`), '<span class="lv-bar " aria-hidden="true"><i class="lv-solid" style="flex:2" title="Solides : 2"></i></span>');
    });

    await t('calendrier : 12 semaines, les 7 plus anciennes marquées pour être masquées sur téléphone', () => {
        w.eval(`dataStore.setJSON('chessTrainer_activity', { [dayStamp(Date.now())]: { a: 3, f: 1 } })`);
        seed(w, [-1, 2, 0, 5]);
        assert.strictEqual($$('.st-heat i').length, 12 * 7);
        assert.strictEqual($$('.st-heat i.old').length, 7 * 7);
        const css = fs.readFileSync(path.join(ROOT, 'css/screens.css'), 'utf8');
        assert(/@container stats \(max-width: 599px\)[\s\S]*\.st-heat i\.old \{ display: none; \}/.test(css));
    });

    assert.deepStrictEqual(errors, []);
    w.close();
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
