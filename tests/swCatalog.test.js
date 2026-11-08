// Lancer : node tests/swCatalog.test.js   — les listes recopiées à la main (sw.js, script de tête d'index.html) suivent leur source.
const { scriptPath } = require('./_app.js');
const fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const read = f => fs.readFileSync(f, 'utf8');
const sw = read('sw.js'), settings = read(scriptPath('settings.js')), i18n = read(scriptPath('i18n.js')), html = read('index.html');
const strings = s => [...s.matchAll(/'([^']+)'/g)].map(m => m[1]);
const list = (src, re, what) => { const m = src.match(re); assert(m, what); return strings(m[1]); };
const extra = list(sw, /const EXTRA = \[([\s\S]*?)\];/, 'EXTRA');

t('sw.js : chaque texture d\'échiquier est mise en cache', () => {
    const disk = fs.readdirSync('assets/boards').filter(f => f.endsWith('.webp')).map(f => 'assets/boards/' + f).sort();
    assert.deepStrictEqual(extra.filter(u => u.startsWith('assets/boards/')).sort(), disk);
});
t('sw.js : mêmes jeux de pièces que settings.js (hors Invisibles)', () => {
    const ids = list(settings, /const PIECE_SET_IDS\s*=\s*\[([^\]]*)\]/, 'PIECE_SET_IDS').filter(x => x !== 'blindfold');
    assert.deepStrictEqual(list(sw, /const SETS = \[([^\]]*)\]/, 'SETS'), ids);
});
t('sw.js : mêmes langues embarquées qu\'i18n.js, dans EXTRA et dans le filtre', () => {
    const langs = list(i18n, /const EMBEDDED = \[([^\]]*)\]/, 'EMBEDDED').filter(x => x !== 'fr').sort();
    assert.deepStrictEqual(extra.filter(u => u.startsWith('lang/')).map(u => u.slice(5, -5)).sort(), langs);
    const filter = sw.match(/\\\/lang\\\/\(\?!([^)]*)\)/);
    assert(filter, 'filtre des paquets');
    assert.deepStrictEqual(filter[1].split('|').map(x => x.replace('\\.json', '')).sort(), langs);
});
t('index.html : mêmes échiquiers retirés que RETIRED_LOOKS', () => {
    const head = html.match(/b = (\{[^}]*\})\[b\] \|\| b;/), src = settings.match(/RETIRED_LOOKS = \{\s*boardTheme:\s*(\{[^}]*\})/);
    assert(head && src, 'tables introuvables');
    const parse = x => JSON.parse(x.replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
    assert.deepStrictEqual(parse(head[1]), parse(src[1]));
});
console.log(`\n${n} tests réussis.`);
