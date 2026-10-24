// Lancer : node tests/globals.test.js   — noms globaux des scripts d'index.html : chaque nom n'est déclaré
// qu'une fois. (Deux « function x » dans deux fichiers ne provoquent aucune erreur : la seconde remplace la
// première en silence. Les doublons const / let, eux, cassent le chargement : cf. boot.test.js.)
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');

const scripts = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const owner = {}, dupes = [];
scripts.forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        const name = m[1];
        if (owner[name] && owner[name] !== f) dupes.push(`${name} : ${owner[name]} et ${f}`);
        else if (owner[name] === f && /^(?:async\s+)?function/.test(m[0])) dupes.push(`${name} : deux fois dans ${f}`);
        owner[name] = owner[name] || f;
    }
});
assert.deepStrictEqual(dupes, [], 'noms globaux déclarés plusieurs fois');
console.log(`ok   ${Object.keys(owner).length} noms globaux, chacun déclaré une seule fois (${scripts.length} scripts)`);
console.log('\n1 tests réussis.');
