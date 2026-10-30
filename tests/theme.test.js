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

// Fonds du mode sombre (préférence darkBg) : le bloc [data-theme="dark"] (gris neutre) et ses variantes data-dark.
const varsOf = sel => {
    const i = css.indexOf(sel + ' {'); assert(i >= 0, sel);
    const body = css.slice(i, css.indexOf('}', i)), out = {};
    for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)) out[m[1]] = m[2];
    return out;
};
const base = varsOf('[data-theme="dark"]');
const DARK_BGS = { neutral: base };
for (const id of ['night', 'oled', 'green']) DARK_BGS[id] = Object.assign({}, base, varsOf(`html[data-theme="dark"][data-dark="${id}"]`));

t('fonds sombres : les quatre palettes lues, gris neutre par défaut (plus de vert hors « Nocturne »)', () => {
    assert.strictEqual(base.bg, '#121314');
    assert.strictEqual(DARK_BGS.green.bg, '#0f1711');
    const settings = fs.readFileSync('js/core/settings.js', 'utf8');
    assert(/const DARK_BGS\s*=\s*\['neutral', 'night', 'oled', 'green'\]/.test(settings), 'liste des fonds dans settings.js');
    assert(/darkBg:\s*\{ ok: _oneOf\(DARK_BGS\),\s*def: 'neutral' \}/.test(settings));
});

t('barre système au lancement (index.html) : mêmes fonds sombres que style.css', () => {
    const html = fs.readFileSync('index.html', 'utf8'), m = html.match(/var bars = (\{[^}]*\})/);
    assert(m, 'table des barres dans le script de tête');
    const bars = JSON.parse(m[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
    for (const [id, v] of Object.entries(DARK_BGS)) assert.strictEqual(bars[id], v.bg, id);
});

t('fonds sombres : textes secondaires lisibles sur les cartes et les fenêtres', () => {
    const bad = [];
    for (const [id, v] of Object.entries(DARK_BGS)) {
        const s = hex(v.surface), e = hex(v['bg-elevated']);
        if (Math.min(contrast(hex(v['text-muted']), s), contrast(hex(v['text-muted']), e)) < 4.5) bad.push(`${id} texte atténué`);
        if (Math.min(contrast(hex(v['text-dim']), s), contrast(hex(v['text-dim']), e)) < 4.5) bad.push(`${id} texte discret`);
        if (contrast(hex(v.text), e) < 7) bad.push(`${id} texte`);
    }
    assert.strictEqual(bad.join(' ; '), '');
});

t('texte discret (--text-dim) : valeurs relevées du lot 7, lisibles en clair comme en sombre', () => {
    const want = { neutral: '#8e9195', night: '#8592a4', oled: '#8a8a8a', green: '#8b9682' };
    for (const [id, v] of Object.entries(want)) assert.strictEqual(DARK_BGS[id]['text-dim'], v, id);
    const light = varsOf(':root, [data-theme="light"]');
    assert.strictEqual(light['text-dim'], '#62675a');
    for (const bg of ['surface', 'bg-elevated', 'bg']) {
        const c = contrast(hex(light['text-dim']), hex(light[bg]));
        assert(c >= 4.5, `clair : texte discret sur --${bg} ${c.toFixed(2)}`);
    }
});

t('jetons dérivés de l\'accent et bouton principal (lot 7)', () => {
    assert(/--accent-soft:\s+color-mix\(in oklab, var\(--accent\) 14%, var\(--surface\)\)/.test(css));
    assert(/--accent-line:\s+color-mix\(in oklab, var\(--accent\) 40%, var\(--border\)\)/.test(css));
    assert(/\.btn-primary \{[^}]*font-weight: 700/.test(css), '.btn-primary en graisse 700');
    assert(/--tap: 44px/.test(css));
});

t('badges de verdict (.vbadge) : texte tiré vers --text, 4,5:1 sur la teinte du badge, en clair et sur les quatre fonds', () => {
    assert(/\.vbadge \{[^}]*color: color-mix\(in oklab, var\(--c\) 72%, var\(--text\)\)/.test(css), 'sombre : 72 %');
    assert(/:where\(:root:not\(\[data-theme="dark"\]\)\) \.vbadge \{ color: color-mix\(in oklab, var\(--c\) 45%, var\(--text\)\); \}/.test(css), 'clair : 45 %');
    const light = varsOf(':root, [data-theme="light"]'), bad = [];
    const srgb = (x, y, p) => x.map((v, i) => v * p + y[i] * (1 - p));
    const check = (id, v, p, tints) => {
        for (const [k, c] of Object.entries(tints)) for (const s of ['surface', 'bg-elevated', 'bg']) {
            const bg = srgb(hex(c), hex(v[s]), .14), fg = mixLab(hex(c), hex(v.text), p), x = contrast(fg, bg);
            if (x < 4.5) bad.push(`${id} ${k} sur --${s} ${x.toFixed(2)}`);
        }
    };
    check('clair', light, .45, { ok: light.ok, err: light.err, warn: light['lv-progress'], new: light.new, muted: light['text-muted'] });
    for (const [id, v] of Object.entries(DARK_BGS))
        check(id, v, .72, { ok: base.ok, err: base.err, warn: base['lv-progress'], new: base.new, muted: v['text-muted'] });
    assert.strictEqual(bad.join(' ; '), '');
});

const CASES = [['light', MODES.light]].concat(Object.entries(DARK_BGS).map(([id, v]) =>
    [`sombre ${id}`, Object.assign({}, MODES.dark, { surface: hex(v.surface), bg: hex(v.bg) })]));
for (const [mode, M] of CASES) {
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
