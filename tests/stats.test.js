// Lancer : node tests/stats.test.js   — niveaux de maîtrise et noms d'ouvertures (onglet Statistiques), sans DOM
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ctx = { console, registerActions() {}, escapeHtml: s => String(s), ico: () => '', formatSan: s => s,
              document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] } };
vm.createContext(ctx);
for (const f of ['js/core/chessEngine.js', 'js/modules/openings/openingsLogic.js', 'js/modules/stats/openingNames.js', 'js/modules/stats/stats.js'])
    vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: f });
const { _level, openingNameOf, resolveOpeningNames, _assignOpenings } = ctx;
const path = s => s.split(' ');

t('table des ouvertures : toutes les entrées sont des suites de coups légales', () => {
    assert.strictEqual(resolveOpeningNames().join(' ; '), '');
});

t('table des ouvertures : aucun chemin en double', () => {
    const seen = new Set();
    ctx.OPENING_NAMES_SRC.forEach(l => { const m = l.split('|')[1]; assert(!seen.has(m), 'doublon : ' + l); seen.add(m); });
});

t('nom d\'ouverture : l\'entrée la plus longue qui commence le chemin', () => {
    assert.strictEqual(openingNameOf(path('e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5')).name, 'Sicilienne Najdorf · Attaque anglaise');
    assert.strictEqual(openingNameOf(path('e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5c6')).name, 'Partie espagnole · Variante d\'échange');
    assert.strictEqual(openingNameOf(path('a2a3')), null);
});

t('niveaux : seuils de taux d\'erreur', () => {
    const lv = (a, f, interval) => _level({ attempts: a, failures: f, interval });
    assert.strictEqual(lv(0, 0), 'unsure');
    assert.strictEqual(lv(2, 0), 'unsure');
    assert.strictEqual(lv(3, 0), 'mastered');
    assert.strictEqual(lv(10, 1), 'solid');
    assert.strictEqual(lv(10, 1, 7), 'mastered');          // solide et réussie plusieurs révisions d'affilée
    assert.strictEqual(lv(10, 2), 'progress');
    assert.strictEqual(lv(3, 1), 'fragile');
    assert.strictEqual(lv(2, 1), 'fragile');
    assert.strictEqual(lv(10, 6), 'weak');
});

t('regroupement : une position rejoint l\'unique ouverture plus précise de ses suites', () => {
    const row = p => ({ side: 'w', k: p, e: {}, path: path(p) });
    const trunk = row('e2e4 c7c5 g1f3 d7d6 d2d4');                                   // Sicilienne ouverte
    const deep  = row('e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3');     // Najdorf · Attaque anglaise
    _assignOpenings([trunk, deep]);
    assert.strictEqual(trunk.gName, 'Sicilienne Najdorf · Attaque anglaise');
    const other = row('e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6 c1e3 f8g7 f2f3'); // Dragon · yougoslave
    const t2 = row('e2e4 c7c5 g1f3 d7d6 d2d4');
    _assignOpenings([t2, deep, other]);
    assert.strictEqual(t2.gName, 'Sicilienne ouverte');                               // tronc commun : son propre nom
});

console.log(`\n${n} tests réussis.`);
