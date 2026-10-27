// Lancer : node tests/colorScope.test.js   — sélecteur de couleur commun (ColorScope) et capsule de la barre du haut.
const fs = require('fs'), assert = require('assert');
const { JSDOM } = require('jsdom');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const dom = new JSDOM('<div id="h"></div>', { runScripts: 'outside-only' });
const win = dom.window;
win.escapeHtml = s => String(s);
win.eval(fs.readFileSync('js/core/colorScope.js', 'utf8') + '\nwindow.ColorScope = ColorScope;');   // 'use strict' : eval garde ses noms pour lui
const host = win.document.getElementById('h');
const opt = v => host.querySelector(`.cs-opt[data-v="${v}"]`);
const checked = () => [...host.querySelectorAll('.cs-opt')].filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.dataset.v).join();

t('libre : un clic change la couleur et prévient onChange', () => {
    const seen = [];
    win.ColorScope.render(host, { options: ['w', 'b'], value: 'w', onChange: v => seen.push(v) });
    opt('b').click();
    assert.strictEqual(checked(), 'b');
    assert.strictEqual(seen.join(), 'b');
});

t('verrouillé : le choix reste affiché, ni clic ni clavier ne le changent, l\'infobulle explique pourquoi', () => {
    const seen = [];
    win.ColorScope.render(host, { options: ['w', 'b'], value: 'w', onChange: v => seen.push(v), locked: true, lockedHint: 'Couleur fixée par l\'exercice' });
    const root = host.firstElementChild;
    opt('b').click();
    root.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.strictEqual(checked(), 'w');
    assert.strictEqual(seen.length, 0);
    assert(root.classList.contains('cs-locked') && root.getAttribute('aria-disabled') === 'true' && root.title === 'Couleur fixée par l\'exercice');
    win.ColorScope.render(host, { options: ['w', 'b'], value: 'w', onChange: v => seen.push(v) });   // déverrouillé sur place
    assert(!root.classList.contains('cs-locked') && !root.hasAttribute('aria-disabled') && host.firstElementChild === root);
});

t('size « sm » : classe de la barre du haut, libellés gardés pour l\'infobulle et les lecteurs d\'écran', () => {
    win.ColorScope.render(host, { options: ['w', 'b', 'mix'], value: 'mix', size: 'sm' });
    const root = host.firstElementChild;
    assert(root.classList.contains('cs-sm'));
    assert.strictEqual([...root.querySelectorAll('.cs-l')].map(s => s.textContent).join(), 'Blancs,Noirs,Les deux');
    assert.strictEqual(opt('b').title, 'Noirs');
    const css = fs.readFileSync('style.css', 'utf8');
    assert(/\.cs-sm \.cs-l \{ position: absolute; width: 1px;/.test(css), 'sur téléphone, le libellé est masqué visuellement, pas supprimé');
});

t('barre du haut : la capsule remplace le badge de couleur ; Entraînement libre propose « Les deux », couleur imposée verrouillée', () => {
    const html = fs.readFileSync('index.html', 'utf8'), app = fs.readFileSync('js/app.js', 'utf8');
    assert(/<div class="game-side" id="game-side"><\/div>/.test(html) && !/color-badge/.test(html));
    assert(/options: training && !locked \? \['w', 'b', 'mix'\] : \['w', 'b'\]/.test(app));
    assert(/const locked = !\(gameMode === 'play' \|\| \(training && !trainingState\.session\)\)/.test(app), 'seuls Jouer et l\'Entraînement libre changent de couleur');
    assert(/renderGameSide\(\);\s+\/\/ couleur refusée/.test(app), 'une couleur refusée remet la capsule sur la couleur jouée');
});

// ─── Puce du répertoire de la barre du haut (RepPicker « sm ») ───────────────
Object.assign(win, { escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), ico: name => `<svg data-i="${name}"></svg>`, readDBFor: () => ({}), isDue: () => false, loadRepertoireList: () => ['Général'], UI_ACTIONS: {} });
win.eval('var currentRepertoire = "Général <test>";\n' + fs.readFileSync('js/core/repPicker.js', 'utf8') + '\nwindow.RepPicker = RepPicker;');

t('barre du haut : puce du répertoire ronde, initiale + nom + chevron, sans indicateurs ; verrouillée en séance guidée', () => {
    host.innerHTML = win.RepPicker.html('gameRepertoire', { size: 'sm' });
    const chip = host.firstElementChild;
    assert(chip.classList.contains('rp-sm') && !chip.disabled);
    assert.strictEqual(chip.querySelector('.rp-ini').textContent, 'G');
    assert.strictEqual(chip.querySelector('.rp-txt b').textContent, 'Général <test>', 'nom échappé');
    assert(!chip.querySelector('small') && chip.querySelector('[data-i="chevron-down"]'));
    assert.strictEqual(chip.getAttribute('aria-label'), 'Répertoire « Général <test> » : changer');
    host.innerHTML = win.RepPicker.html('gameRepertoire', { size: 'sm', locked: true });
    assert(host.firstElementChild.disabled && !host.querySelector('[data-i="chevron-down"]'));
    host.innerHTML = win.RepPicker.html('selectRepertoire');
    assert(host.querySelector('small'), 'la puce normale garde ses indicateurs');
});

t('barre du haut : changer de répertoire relance le mode en cours ; Finales : titre de l\'exercice ; même hauteur que la capsule', () => {
    const app = fs.readFileSync('js/app.js', 'utf8'), css = fs.readFileSync('style.css', 'utf8');
    assert(/<span class="game-rep" id="game-rep"><\/span>/.test(fs.readFileSync('index.html', 'utf8')));
    assert(/if \(mode === 'play'\) startGame\(color\);/.test(app) && /startTraining\(mixed \? 'mix' : color\);\s+if \(gameMode !== 'training'\) goHome\('training'\);/.test(app));
    assert(/gameMode === 'endgame'[\s\S]{0,120}game-rep-title/.test(app));
    assert(/\.rp-chip\.rp-sm \{ min-height: 35px;/.test(css), 'la puce s\'aligne sur la capsule (35 px)');
    assert(!/repertoire-pill/.test(app + css + fs.readFileSync('js/modules/endgame/endgame.js', 'utf8')));
});

console.log(`\n${n} tests réussis.`);
