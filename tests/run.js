// Lance tous les fichiers *.test.js de tests/ et de ses sous-dossiers, l'un après l'autre (npm test). Code de sortie ≠ 0 si l'un échoue.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(__dirname).filter(f => f.endsWith('.test.js')).map(f => path.relative(ROOT, f)).sort();
let failed = 0;
for (const f of files) {
    console.log(`\n━━ ${f}`);
    const r = spawnSync(process.execPath, [f], { stdio: 'inherit', cwd: ROOT });
    if (r.status !== 0) { failed++; console.log(`✗ ${f} a échoué (code ${r.status})`); }
}
console.log(failed ? `\n✗ ${failed} fichier(s) en échec sur ${files.length}.` : `\n✓ ${files.length} fichiers de tests réussis.`);
process.exit(failed ? 1 : 0);
