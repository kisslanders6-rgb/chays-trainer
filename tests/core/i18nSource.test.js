// Lancer : node tests/core/i18nSource.test.js   — affiche ce qui manque aux traductions (lecture seule, ne fait pas échouer la suite).
const { spawnSync } = require('child_process');
const assert = require('assert');
const before = require('fs').readFileSync('lang/source.txt', 'utf8');
const r = spawnSync(process.execPath, ['scripts/i18n-extract.mjs', '--check'], { encoding: 'utf8' });
assert.strictEqual(r.status, 0, r.stderr);
console.log(r.stdout.trim());
assert.strictEqual(require('fs').readFileSync('lang/source.txt', 'utf8'), before, '--check ne doit rien écrire');
console.log('\n1 tests réussis.');
