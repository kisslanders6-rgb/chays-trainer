// Lancer : node tests/arrows.test.js   — dessin des flèches et cercles (drawArrows, fonction pure d'annotations.js)
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ctx = { console, ARROW_STYLE_IDS: ['plume', 'contour', 'pointille', 'lichess', 'pinceau', 'fine'],
              dataStore: { get: () => null, set() {} }, document: { getElementById: () => null } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/modules/openings/annotations.js', 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx);
const { drawArrows } = ctx;
const corners = svg => (svg.match(/points="([^"]+)"/) || [, ''])[1].trim().split(' ').length;

t('chaque style dessine une flèche et un cercle', () => {
    ctx.ARROW_STYLE_IDS.forEach(style => {
        const svg = drawArrows({ style, arrows: [{ from: 12, to: 28, color: 'green' }], circles: [{ sq: 36, color: 'red' }] });
        assert(svg.includes('<circle') && /<(polygon|polyline)/.test(svg), style);
        assert(svg.includes('var(--annot-green)') && svg.includes('var(--annot-red)'), style);
    });
});

t('saut de cavalier : coudé en « L » avec knight, droit sinon (même nombre de sommets que Td1-d4)', () => {
    const knight = { style: 'lichess', arrows: [{ from: 6, to: 21, color: 'accent' }] };       // Cg1-f3
    const rook = { style: 'lichess', arrows: [{ from: 3, to: 27, color: 'accent' }] };         // Td1-d4
    assert(corners(drawArrows(Object.assign({ knight: true }, knight))) > corners(drawArrows(rook)));
    assert.strictEqual(corners(drawArrows(Object.assign({ knight: false }, knight))), corners(drawArrows(rook)));
});

t('échiquier retourné : la flèche part de l\'autre coin ; aperçu translucide', () => {
    const a = drawArrows({ style: 'fine', arrows: [{ from: 0, to: 9, color: 'accent' }] });
    const b = drawArrows({ style: 'fine', flipped: true, arrows: [{ from: 0, to: 9, color: 'accent' }] });
    assert.notStrictEqual(a, b);
    assert(/opacity="0?\.55"/.test(drawArrows({ style: 'fine', arrows: [{ from: 0, to: 9, color: 'accent', preview: true }] })));
});

console.log(`\n${n} tests réussis.`);
