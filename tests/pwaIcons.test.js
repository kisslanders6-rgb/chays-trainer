// Lancer : node tests/pwaIcons.test.js   — icônes de la PWA : favicon .ico et SVG adaptatif, manifeste, mise en cache.
const fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const html = fs.readFileSync('index.html', 'utf8'), manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

t('favicon.ico : trois images PNG de 16, 32 et 48 px', () => {
    const d = fs.readFileSync('assets/icons/favicon.ico');
    assert.strictEqual(d.readUInt16LE(2), 1, 'type icône');
    const count = d.readUInt16LE(4), sizes = [];
    for (let i = 0; i < count; i++) {
        const e = 6 + 16 * i, size = d.readUInt32LE(e + 8), off = d.readUInt32LE(e + 12);
        sizes.push(d[e]);
        assert.strictEqual(d.slice(off, off + 4).toString('hex'), '89504e47', `image ${d[e]} px en PNG`);
        assert(off + size <= d.length);
    }
    assert.deepStrictEqual(sizes, [16, 32, 48]);
});

t('icon.svg : roi plein cadre, sans fond, couleurs suivant le thème clair / sombre', () => {
    const svg = fs.readFileSync('assets/icons/icon.svg', 'utf8');
    assert(/viewBox="69 69 374 374"/.test(svg), 'recadré sur le roi (5 % de marge)');
    assert(/@media \(prefers-color-scheme: dark\)/.test(svg));
    assert(!/<rect/.test(svg), 'pas de fond : il prend la couleur de l\'onglet');
});

t('index.html : .ico puis SVG ; plus de favicons PNG', () => {
    const ico = html.indexOf('href="assets/icons/favicon.ico"'), svg = html.indexOf('href="assets/icons/icon.svg" type="image/svg+xml"');
    assert(ico > 0 && svg > ico, 'le SVG après le .ico (les navigateurs qui le lisent le préfèrent)');
    assert(!/favicon-(32|64)\.png/.test(html));
    assert(/rel="apple-touch-icon" href="assets\/icons\/apple-touch-icon.png"/.test(html));
});

t('manifeste : icônes any, maskable et monochrome, toutes présentes et mises en cache', () => {
    const purposes = manifest.icons.map(i => i.purpose).sort();
    assert.deepStrictEqual(purposes, ['any', 'any', 'maskable', 'monochrome']);
    const sw = fs.readFileSync('sw.js', 'utf8');
    manifest.icons.forEach(i => {
        assert(fs.existsSync(i.src), i.src);
        assert(sw.includes(`'${i.src}'`), 'sw.js EXTRA : ' + i.src);
    });
});

console.log(`\n${n} tests réussis.`);
