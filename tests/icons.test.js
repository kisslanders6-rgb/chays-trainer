// Lancer : node tests/icons.test.js   — chaque icône demandée existe dans le sprite (js/core/icons.js) :
// <use href="#i-…"> d'index.html et appels ico('…') / icon('…') à nom fixe dans js/. Une icône renommée
// (ex. « arrow-left » devenue « w-left ») s'afficherait vide sans erreur.
const fs = require('fs'), path = require('path'), assert = require('assert');

const src = fs.readFileSync('js/core/icons.js', 'utf8');
const body = src.slice(src.indexOf('const _ICONS = {'), src.indexOf('};', src.indexOf('const _ICONS = {')));
const known = new Set([...body.matchAll(/^\s*'([a-z0-9-]+)':/gm)].map(m => m[1]));

const files = ['index.html'];
(function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
    });
})('js');

const missing = [];
files.forEach(f => {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/#i-([a-z0-9-]+)/g)) if (!known.has(m[1])) missing.push(`${f} : #i-${m[1]}`);
    for (const m of text.matchAll(/\b(?:ico|icon)\('([a-z0-9-]+)'/g)) if (!known.has(m[1])) missing.push(`${f} : ${m[1]}`);
});

assert(known.size > 40, `sprite lu : ${known.size} icônes`);
assert.strictEqual(missing.join(' ; '), '', 'icônes demandées absentes du sprite');
console.log(`ok   ${known.size} icônes, toutes celles demandées existent`);
console.log('\n1 tests réussis.');
