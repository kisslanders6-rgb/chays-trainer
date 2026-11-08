// Lancer : node tests/layers.test.js   — sens des dépendances entre couches (socle ← domaine ← échiquier ← écrans ← coquille), noms inconnus.
// Test à cliquet : tests/layers.baseline.json liste les liens vers le haut encore tolérés. Un nouveau lien échoue ; un lien disparu doit en être retiré.
const { loadGraph } = require('./_deps.js');
const fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM } = require('jsdom');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ORDER = ['core', 'domain', 'board', 'screens', 'shell'];
const short = f => path.basename(f, '.js');
const layerOf = f => ORDER.find(l => f.startsWith(`js/${l}/`));
const rank = f => ORDER.indexOf(layerOf(f));

const BASE = path.join(__dirname, 'layers.baseline.json');
const { files, deps, unknown, earlyUse } = loadGraph();
const upward = [];
for (const f of files) for (const to of Object.keys(deps[f])) if (rank(to) > rank(f)) upward.push(`${short(f)} → ${short(to)}`);
upward.sort();

if (process.argv.includes('--update')) { fs.writeFileSync(BASE, JSON.stringify(upward, null, 1) + '\n'); console.log('baseline écrite :', upward.length); process.exit(0); }

const allowed = JSON.parse(fs.readFileSync(BASE, 'utf8'));

t('aucun nouveau lien vers le haut', () => {
    assert.deepStrictEqual(upward.filter(x => !allowed.includes(x)), [], 'à éviter, ou à justifier dans tests/layers.baseline.json');
});
t('la liste tolérée ne garde aucun lien disparu', () => {
    assert.deepStrictEqual(allowed.filter(x => !upward.includes(x)), [], 'à retirer : node tests/layers.test.js --update');
});
t('aucun script n\'utilise au chargement un nom défini plus loin', () => {
    assert.deepStrictEqual(earlyUse, []);
});
t('tout nom libre existe (script de l\'application ou navigateur)', () => {
    const win = new JSDOM('').window;
    const known = new Set([...Object.getOwnPropertyNames(win), ...Object.getOwnPropertyNames(globalThis),
        'caches', 'crossOriginIsolated', 'requestIdleCallback', 'matchMedia', 'SpeechSynthesisUtterance', 'speechSynthesis', 'indexedDB', 'Worker', 'SharedArrayBuffer',
        'ResizeObserver', 'module', 'addEventListener', 'requestAnimationFrame', 'undefined', 'arguments']);
    assert.deepStrictEqual([...unknown].filter(x => !known.has(x)).sort(), []);
});
console.log(`\n${n} tests réussis (${allowed.length} liens tolérés).`);
process.exit(0);
