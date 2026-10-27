// Lancer : node tests/layout.test.js   — règles de mise en page lues dans style.css (jsdom ne calcule pas les tailles).
const fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const css = fs.readFileSync('style.css', 'utf8');

// ─── Échiquier à la taille de l'écran (920px+) ───────────────────────────────
const start = css.indexOf("ÉCHIQUIER À LA TAILLE DE L'ÉCRAN");
const block = css.slice(start, css.indexOf('/* ─── MENU', start));

t("échiquier 920px+ : bloc présent, après la règle .sq de base (même spécificité, l'ordre décide)", () => {
    assert(start > 0, 'bloc « ÉCHIQUIER À LA TAILLE DE L\'ÉCRAN » introuvable');
    const base = css.search(/^\.sq \{ width: 64px/m);
    assert(base > 0 && base < start, 'le bloc doit suivre « .sq { width: 64px … } », sinon les cases restent à 64 px');
    assert(/\.sq \{ width: auto; height: auto; aspect-ratio: 1 \/ 1;/.test(block));
});

t('échiquier 920px+ : jamais plus petit que les 512 px d\'avant, plafonné, arrondi à des cases entières', () => {
    const bws = [...block.matchAll(/--bw: (.+);/g)].map(m => m[1]);
    assert.strictEqual(bws.length, 2, 'une valeur de --bw sans round(), une avec');
    bws.forEach(v => assert(/clamp\(512px, min\(100cqw - \d+px, 100dvh - var\(--topnav-h\) - var\(--board-chrome-h\)\), 960px\)/.test(v), v));
    assert(/^round\(down, .+, 8px\)$/.test(bws[1]), 'multiple de 8 : 8 cases de largeur entière');
    assert(/@supports \(width: round\(down, 100px, 8px\)\)/.test(block), 'round() derrière @supports, repli sans arrondi');
});

t('échiquier 920px+ : le liseré (2 × 2 px) et les coordonnées extérieures (18 px) s\'ajoutent à --bw', () => {
    assert(/\.board-wrap \{ width: calc\(var\(--bw\) \+ 4px\); \}/.test(block));
    assert(/html\[data-coords="out"\] \.board-wrap \{ width: calc\(var\(--bw\) \+ 22px\); \}/.test(block));
    assert(/data-coords="out".*\.board-wrap \{ padding: 0 0 18px 18px; \}/.test(fs.readFileSync('css/panels.css', 'utf8')), 'marge des coordonnées extérieures changée : revoir les 22 px');
});

// ─── Grilles de choix des Paramètres (PanelKit.balancedCols) ─────────────────
const vm = require('vm');
const ctx = { escapeHtml: s => s, document: { addEventListener() {} }, matchMedia: () => ({ matches: false }) };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/core/panelKit.js', 'utf8').replace(/^const PanelKit =/m, 'var PanelKit ='), ctx);
const cols = ctx.PanelKit.balancedCols;
const rows = (n, c) => Array.from({ length: Math.ceil(n / c) }, (_, i) => Math.min(c, n - i * c)).join('+');

t('grilles : pas de tuile seule en dernière ligne quand une autre répartition tient', () => {
    assert.strictEqual(rows(13, cols(13, 571)), '5+5+3');    // 13 échiquiers, Paramètres sur ordinateur
    assert.strictEqual(rows(12, cols(12, 571)), '4+4+4');    // 12 jeux de pièces
    assert.strictEqual(rows(6, cols(6, 571)), '3+3');        // 6 styles de flèches
    assert.strictEqual(rows(12, cols(12, 321)), '3+3+3+3');  // téléphone
});

t('grilles : jamais de tuiles plus étroites que 85 % du minimum, jamais moins de 3 colonnes si 3 tiennent', () => {
    for (let w = 240; w <= 900; w += 7) for (const n of [6, 12, 13]) {
        const c = cols(n, w), tile = (w - (c - 1) * 8) / c;
        assert(c === 1 || tile >= 112 * .85 - 1e-9, `${n} tuiles, ${w} px : ${c} colonnes de ${tile.toFixed(1)} px`);
        if ((w + 8) / 120 >= 3) assert(c >= 3, `${n} tuiles, ${w} px : ${c} colonnes`);
    }
});

t('grilles : colonnes posées par PanelKit (--cols), dernière ligne centrée, plus de règles #…-options mortes', () => {
    const panels = fs.readFileSync('css/panels.css', 'utf8');
    assert(/\.pn \.theme-options \{[^}]*justify-content: center/.test(panels));
    assert(/\.pn \.theme-opt \{[^}]*flex: 0 0 calc\(\(100% - \(var\(--cols\) - 1\) \* 8px\) \/ var\(--cols\)\)/.test(panels));
    assert(/const GRID_GAP = 8;/.test(fs.readFileSync('js/core/panelKit.js', 'utf8')), 'GRID_GAP doit rester égal au gap CSS');
    assert(!/#(piece|board|arrow)-options/.test(css));
});

t('« Invisibles » : interrupteur à part, absent de la grille des pièces', () => {
    const ui = fs.readFileSync('js/core/settingsUI.js', 'utf8');
    assert(/PIECE_SET_IDS\.filter\(id => id !== 'blindfold'\)/.test(ui), 'la grille des pièces exclut blindfold');
    assert(/kind: 'toggle', key: 'blindfold'/.test(ui), 'rangée « Pièces invisibles »');
    assert(/key === 'blindfold'[\s\S]{0,400}setPref\('pieceSet', 'blindfold'\)/.test(ui), 'l\'interrupteur écrit pieceSet');
});

console.log(`\n${n} tests réussis.`);
