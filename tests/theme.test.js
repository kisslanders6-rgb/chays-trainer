// Lancer : node tests/theme.test.js   — contraste des couleurs dérivées de l'échiquier, pour chaque échiquier × clair / sombre.
// Les couleurs de cases sont lues dans style.css ; les formules reprennent celles de style.css (« HARMONISATION
// DES COULEURS ») : --ui-accent, --board-accent. Seuils : 4,5:1 pour du texte, 3:1 pour une surface.
const fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const css = fs.readFileSync('style.css', 'utf8');

// ─── Couleurs : sRGB ↔ OKLab / OKLCH ─────────────────────────────────────────
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = c => (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
const gam = c => (c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055);
function toLab(rgb) {
    const [r, g, b] = rgb.map(lin);
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}
function fromLab([L, a, b]) {
    const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s]
        .map(c => Math.min(1, Math.max(0, gam(Math.max(0, c)))));
}
const toLch = rgb => { const [L, a, b] = toLab(rgb); return [L, Math.hypot(a, b), Math.atan2(b, a)]; };
const fromLch = ([L, C, h]) => fromLab([L, C * Math.cos(h), C * Math.sin(h)]);
const mixLab = (x, y, p) => { const A = toLab(x), B = toLab(y); return fromLab(A.map((v, i) => v * p + B[i] * (1 - p))); };
const lum = rgb => { const [r, g, b] = rgb.map(lin); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));

// ─── Formules de style.css ───────────────────────────────────────────────────
const MODES = {
    light: { surface: hex('#fffdf8'), bg: hex('#f4f1ea'), onAccent: hex('#fffdf8'),
             ui: d => { const [L, C, h] = toLch(mixLab(d, hex('#1a1208'), .88)); return fromLch([clamp(.34, L, .45), Math.min(C, .13), h]); },
             mark: d => { const [L, C, h] = toLch(d); return fromLch([Math.min(L, .48), C, h]); } },
    dark:  { surface: hex('#141e16'), bg: hex('#0f1711'), onAccent: hex('#12170f'),
             ui: d => { const [L, C, h] = toLch(mixLab(d, hex('#1a1208'), .88)); return fromLch([clamp(.7, L, .76), Math.min(C, .12), h]); },
             mark: d => { const [L, C, h] = toLch(d); return fromLch([Math.max(L, .74), C, h]); } }
};
const boards = { classic: '#7a9e5a' };
for (const m of css.matchAll(/html\[data-board="([a-z]+)"\]\s*\{[^}]*--board-dark:\s*(#[0-9a-f]{6})/gi)) boards[m[1]] = m[2];

t('style.css : aucun accent écrit à la main par échiquier', () => {
    assert(!/html\[data-board="[a-z]+"\][^{]*\{[^}]*--accent:/.test(css));
    assert(/--ui-accent:\s+oklch\(from color-mix\(in oklab, var\(--board-dark\)/.test(css));
    assert(css.includes('clamp(.34, l, .45) min(c, .13) h)') && css.includes('clamp(.7, l, .76) min(c, .12) h)') && css.includes('--accent-text:   #12170f'), 'formules recopiées dans ce test');
});

t('tous les échiquiers lus (13)', () => assert.strictEqual(Object.keys(boards).length, 13, Object.keys(boards).join()));

for (const [mode, M] of Object.entries(MODES)) {
    t(`${mode} : texte des boutons sur l'accent, accent comme texte sur les cartes et repères ≥ 4,5:1`, () => {
        const bad = [];
        Object.entries(boards).forEach(([id, d]) => {
            const acc = M.ui(hex(d)), mark = M.mark(hex(d));
            const c1 = contrast(acc, M.onAccent), c2 = contrast(acc, M.surface), c3 = Math.min(contrast(mark, M.surface), contrast(mark, M.bg));
            if (c1 < 4.5) bad.push(`${id} texte/accent ${c1.toFixed(2)}`);
            if (c2 < 4.5) bad.push(`${id} accent/carte ${c2.toFixed(2)}`);
            if (c3 < 4.5) bad.push(`${id} repère/fond ${c3.toFixed(2)}`);
        });
        assert.strictEqual(bad.join(' ; '), '');
    });
}

console.log(`\n${n} tests réussis.`);
