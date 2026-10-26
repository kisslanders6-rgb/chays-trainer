// Lancer : node tests/notation.test.js   — écriture des coups (formatSan HTML, formatSanText), figurines du jeu actif
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const props = {};
const ctx = { console, appSettings: { notation: 'fr', pieceSet: 'maestro' },
              document: { addEventListener() {}, getElementById: () => null,
                          documentElement: { setAttribute() {}, style: { setProperty: (k, v) => { props[k] = v; } } } },
              Image: function () {} };
vm.createContext(ctx);
for (const f of ['js/core/utils.js', 'js/core/pieces.js'])
    vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: f });

t('lettres françaises et anglaises : même texte en HTML et en texte simple', () => {
    assert.strictEqual(ctx.formatSan('Nxe5+', 'w'), 'Cxe5+');
    assert.strictEqual(ctx.formatSanText('O-O', 'b'), 'O-O');
    ctx.appSettings.notation = 'en';
    assert.strictEqual(ctx.formatSan('Qd8#', 'b'), 'Qd8#');
});

t('figurines : dessin du jeu actif à la couleur du camp, texte simple en Unicode', () => {
    ctx.appSettings.notation = 'fig';
    const html = ctx.formatSan('Nf3', 'w');
    assert(/^<span class="fig fig-w" style="--f:var\(--fig-wN\)" role="img" aria-label="Cavalier"><\/span>f3$/.test(html), html);
    assert(ctx.formatSan('exd8=Q+', 'b').includes('fig-b') && ctx.formatSan('e4', 'w') === 'e4');
    assert.strictEqual(ctx.formatSanText('Nf3', 'b'), '♞f3');
    ctx.applyPieceSet();
    assert.strictEqual(props['--fig-bQ'], 'url("assets/pieces/maestro/bQ.svg")');
});

t('jeu « Invisibles » : les figurines repassent aux lettres', () => {
    ctx.appSettings.pieceSet = 'blindfold';
    assert.strictEqual(ctx.formatSan('Bb5', 'w'), 'Fb5');
    assert.strictEqual(ctx.formatSanText('Bb5', 'w'), 'Fb5');
});

console.log(`\n${n} tests réussis.`);
