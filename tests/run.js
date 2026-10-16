// Lance tous les fichiers tests/*.test.js l'un après l'autre (npm test). Code de sortie ≠ 0 au premier échec.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
    console.log(`\n━━ ${f}`);
    const r = spawnSync(process.execPath, [path.join('tests', f)], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    if (r.status !== 0) { failed++; console.log(`✗ ${f} a échoué (code ${r.status})`); }
}
console.log(failed ? `\n✗ ${failed} fichier(s) en échec sur ${files.length}.` : `\n✓ ${files.length} fichiers de tests réussis.`);
process.exit(failed ? 1 : 0);
