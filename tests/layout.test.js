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

console.log(`\n${n} tests réussis.`);
