// Lancer : node tests/settingsLocalMark.test.js   — Paramètres « Établi » (lot 7) : repère local calculé depuis
// LOCAL_PREFS, résultats de recherche réglables sur place, aperçu d'Apparence en direct, grilles sans tuile seule,
// ouverture directe de la rubrique Moteur. Charge index.html entier dans jsdom, comme boot.test.js.
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
            w.Element.prototype.scrollIntoView = function () { w.__scrolledTo = this; };
            w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
            w.addEventListener('error', e => errors.push(e.message));
        }
    });
    await new Promise(r => dom.window.addEventListener('load', r));
    await new Promise(r => setTimeout(r, 5000));
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s), $$: s => [...dom.window.document.querySelectorAll(s)] };
}

const search = (w, q) => {
    const el = w.document.querySelector('#settings-overlay [data-pn="search"]');
    el.value = q;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
};

(async () => {
    const { w, errors, $, $$ } = await boot();
    const local = Object.keys(w.eval('LOCAL_PREFS')), synced = Object.keys(w.eval('SYNCED_PREFS'));
    const sections = w.eval('SETTINGS_SECTIONS.map(s => s.id)');

    await t('repère local : toute clé de LOCAL_PREFS rendue le porte, aucune clé de SYNCED_PREFS', () => {
        const seen = {};
        sections.forEach(id => {
            w.showSettings(id);
            $$('#settings-overlay .pn-content [data-pref]').forEach(row => {
                const key = row.dataset.pref, mark = row.querySelector('.pn-text .pn-local');
                seen[key] = true;
                if (local.includes(key)) {
                    assert(mark, `${id} : « ${key} » est propre à l'appareil, sans repère`);
                    assert.strictEqual(mark.getAttribute('title'), 'Propre à cet appareil');
                    assert(mark.querySelector('use[href="#i-devices"]'), 'icône devices du sprite');
                }
                if (synced.includes(key)) assert(!mark, `${id} : « ${key} » est synchronisée, repère en trop`);
            });
        });
        const missing = local.filter(k => !seen[k]);
        assert.strictEqual(missing.join(', '), '', 'préférences locales absentes de la fenêtre');
        assert(synced.filter(k => seen[k]).length > 20, 'les préférences synchronisées sont bien rendues');
        w.closeSettings();
    });

    await t('repère local : en marge des rubriques entièrement locales seulement', () => {
        w.showSettings();
        const marked = $$('#settings-overlay .pn-nav button').filter(b => b.querySelector('.pn-local')).map(b => b.dataset.key);
        const expected = w.eval(`SETTINGS_SECTIONS.filter(s => { const rows = _settingRows()[s.id].filter(r => r.pref || r.key);
            return rows.length && rows.every(r => Object.prototype.hasOwnProperty.call(LOCAL_PREFS, r.pref || r.key)); }).map(s => s.id)`);
        assert.deepStrictEqual(marked, [...expected]);
        assert(marked.includes('sons') && marked.includes('access'), 'Sons et Accessibilité sont entièrement locales');
        assert(!marked.includes('moteur'), 'Moteur mêle réglages locaux et synchronisés');
        w.closeSettings();
    });

    await t('pas de phrase d\'aide à l\'écran : les explications passent en infobulle', () => {
        sections.forEach(id => {
            w.showSettings(id);
            const hints = $$('#settings-overlay .pn-content .pn-text small').filter(s => !s.querySelector('#install-hint') && s.id !== 'install-hint');
            assert.strictEqual(hints.length, 0, `${id} : ${hints.map(h => h.textContent).join(' | ')}`);
        });
        w.showSettings('jeu');
        assert(/Alt/.test($('#settings-overlay [data-pref="autoQueen"] .pn-lbl [title]').getAttribute('title')));
        w.closeSettings();
    });

    await t('recherche : le résultat porte le contrôle, le modifier appelle setPref, terme surligné', () => {
        const calls = [], real = w.setPref;
        w.setPref = (k, v) => { calls.push([k, v]); return real(k, v); };
        w.showSettings();
        search(w, 'vibration');
        const sw = $('#settings-overlay .pn-content .pn-switch[data-key="haptic"]');
        assert(sw, 'interrupteur dans le résultat');
        assert($('#settings-overlay .pn-content mark'), 'terme surligné');
        assert($('#settings-overlay .pn-content [data-pref="haptic"] .pn-local'), 'repère local aussi dans les résultats');
        const before = w.eval('appSettings').haptic;
        sw.click();
        assert.deepStrictEqual(calls[0], ['haptic', !before]);
        assert.strictEqual(w.eval('appSettings').haptic, !before);
        assert.strictEqual(JSON.parse(w.localStorage.getItem('chessTrainer_settings')).haptic, !before);
        assert($('#settings-overlay .pn-content .pn-switch[data-key="haptic"]'), 'la recherche reste affichée après le réglage');
        assert.strictEqual($('#settings-overlay .pn-switch[data-key="haptic"]').getAttribute('aria-checked'), String(!before));

        search(w, 'rythme');                                                     // segment, réglable sur place
        $('#settings-overlay .pn-content [data-key="rhythm"][data-v="intense"]').click();
        assert.deepStrictEqual(calls[calls.length - 1], ['rhythm', 'intense']);
        assert.strictEqual(w.eval('appSettings').rhythm, 'intense');

        search(w, 'volume');                                                     // curseur
        const range = $('#settings-overlay .pn-content input[data-key="volume"]');
        range.value = '30'; range.dispatchEvent(new w.Event('input', { bubbles: true }));
        assert.deepStrictEqual(calls[calls.length - 1], ['volume', 0.3]);
        w.setPref = real;
        w.closeSettings();
    });

    await t('recherche vide : suggestions qui relancent la recherche', () => {
        w.showSettings();
        search(w, 'xyzw');
        assert(/Rien sur « xyzw »/.test($('#settings-overlay .pn-content').textContent));
        $('#settings-overlay .pn-chip[data-key="son"]').click();
        assert.strictEqual($('#settings-overlay [data-pn="search"]').value, 'son');
        assert($('#settings-overlay .pn-switch[data-key="sound"]'), 'résultats de « son »');
        w.closeSettings();
    });

    await t('aperçu d\'Apparence : position après 3. Fb5, flèches, cercle, et il suit les réglages', () => {
        w.showSettings('apparence');
        const board = () => $('#settings-overlay .pn-etabli-aside .pn-board');
        assert(board(), 'aperçu à part, hors des cartes de réglages');
        assert(!$('#settings-overlay .pn-group .pn-board'), 'pas de carte dans une carte');
        const sq = name => board().children[(8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0])];
        assert(sq('b5').innerHTML.length > 0 && sq('f1').classList.contains('lm') && sq('b5').classList.contains('lm'), 'dernier coup Ff1-b5');
        assert(sq('c6').innerHTML.length > 0 && sq('f3').innerHTML.length > 0, 'Cc6 et Cf3');
        const svg = board().querySelector('svg.pn-arrows');
        assert(svg && svg.innerHTML.includes('circle'), 'flèches et cercle (drawArrows)');
        assert(/3\.\s*F/.test($('#settings-overlay .pn-preview .pn-sample').textContent), 'exemple 3. Fb5 en notation française');

        $('#settings-overlay [data-key="coordPos"][data-v="out"]').click();
        assert(board().classList.contains('is-out'), 'coordonnées autour');
        $('#settings-overlay [data-key="lastMove"]').click();
        assert(!sq('f1').classList.contains('lm'), 'dernier coup masqué');
        $('#settings-overlay [data-key="legalDots"]').click();
        assert(!board().querySelector('.lg'), 'coups possibles masqués');
        const before = svg.innerHTML;
        $('#settings-overlay [data-key="arrowStyle"][data-v="pinceau"]').click();
        assert.notStrictEqual(board().querySelector('svg.pn-arrows').innerHTML, before, 'style de flèches suivi');
        $('#settings-overlay [data-key="blindfold"]').click();
        assert(!board().querySelector('svg:not(.pn-arrows), img'), 'Invisibles : plus de pièces');
        assert(/Invisibles/.test($('#settings-overlay .pn-preview-notes b').textContent));
        $('#settings-overlay [data-key="blindfold"]').click();
        w.showSettings('jeu');
        $('#settings-overlay [data-key="notation"][data-v="en"]').click();
        w.showSettings('apparence');
        assert(/3\.\s*B/.test($('#settings-overlay .pn-preview .pn-sample').textContent), 'notation anglaise suivie');
        w.closeSettings();
    });

    await t('grilles d\'Apparence : aucune tuile seule en dernière ligne à 390 et 1280 px (simulés)', () => {
        w.showSettings('apparence');
        const grids = $$('#settings-overlay .theme-options').map(g => ({ id: g.dataset.grid, n: g.children.length, min: Number(g.dataset.min), max: Number(g.dataset.max) }));
        assert.deepStrictEqual(grids.map(g => g.id).sort(), ['arrowStyle', 'boardTheme', 'darkBg', 'pieceSet']);
        // Largeur d'une grille (css/panels.css, « PARAMÈTRES ÉTABLI ») : téléphone, rangées bord à bord de 16 px de marge ;
        // ordinateur, fenêtre de 1080 px − 220 (rubriques) − 52 (marges) − 272 − 24 (aperçu) − 2 (bordure) − 32 (rangée).
        const widths = { 390: 390 - 32, 1280: 1080 - 220 - 52 - 272 - 24 - 2 - 32 };
        const cols = (g, wd) => w.eval('PanelKit').balancedCols(g.n, wd, g.min, g.max);
        Object.entries(widths).forEach(([vw, wd]) => grids.forEach(g => {
            const c = cols(g, wd);
            assert(g.n % c !== 1 || c === 1, `${g.id} à ${vw} px : ${c} colonnes, une tuile seule`);
        }));
        // Toute la plage des téléphones (320 à 640 px).
        for (let vw = 320; vw <= 640; vw += 2) grids.forEach(g => assert(g.n % cols(g, vw - 32) !== 1, `${g.id} à ${vw} px`));
        // Répartitions de la maquette.
        const by = id => grids.find(g => g.id === id);
        assert.strictEqual(cols(by('boardTheme'), widths[390]), 5);
        assert.strictEqual(cols(by('boardTheme'), widths[1280]), 7);
        assert.strictEqual(cols(by('pieceSet'), widths[390]), 4);
        assert.strictEqual(cols(by('pieceSet'), widths[1280]), 6);
        assert.strictEqual(cols(by('arrowStyle'), widths[390]), 3);
        assert.strictEqual(cols(by('darkBg'), widths[390]), 4);
        w.closeSettings();
    });

    await t('une seule action pleine par rubrique : Données (sauvegarde), Moteur (téléchargement)', () => {
        sections.forEach(id => {
            w.showSettings(id);
            const n = $$('#settings-overlay .pn-content .btn-primary').filter(b => b.style.display !== 'none').length;
            assert(n <= 1, `${id} : ${n} actions pleines`);
        });
        w.showSettings('donnees');
        assert($('#settings-overlay [data-action="backupExport"]').classList.contains('btn-primary'), 'Télécharger la sauvegarde');
        w.closeSettings();
    });

    await t('ouverture directe de la rubrique Moteur (Analyse)', () => {
        w.closeSettings();
        w.showSettings('moteur', 'engineNet');
        assert(!$('#settings-overlay').classList.contains('hidden'));
        assert.strictEqual($('#settings-overlay .pn').dataset.drill, '1');
        assert($('#settings-overlay .pn-nav button[data-key="moteur"]').classList.contains('is-on'));
        assert.strictEqual(w.__scrolledTo && w.__scrolledTo.dataset.pref, 'engineNet');
        w.closeSettings();
    });

    await t('aucune erreur de script', () => assert.deepStrictEqual(errors, []));
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
