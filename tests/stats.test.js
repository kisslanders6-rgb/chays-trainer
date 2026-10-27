// Lancer : node tests/stats.test.js   — niveaux de maîtrise et noms d'ouvertures (onglet Statistiques), sans DOM
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ctx = { console, registerActions() {}, escapeHtml: s => String(s), ico: () => '', formatSan: s => s, formatSanText: s => s,
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

t('« À confirmer » : un état à part, absent des barres de niveaux', () => {
    assert(!ctx.STATS_MASTERY_LEVELS.includes('unsure'));
    assert.strictEqual(ctx.STATS_MASTERY_LEVELS.length, 5);
    const html = ctx.levelBarHTML({ weak: 1, fragile: 0, progress: 0, solid: 2, unsure: 7, mastered: 3 });
    assert(!html.includes('lv-unsure') && html.includes('lv-solid') && html.includes('lv-mastered'), html);
});

t('Statistiques → Entraînement : couleur, ouverture et exercice transmis, aucune séance lancée', () => {
    const calls = [];
    ctx.openTrainingFrom = o => calls.push(o);
    ctx.statsColor = 'all';
    ctx.statsGoTraining('due');
    ctx.statsGoTraining('weak');
    ctx.statsGoTraining('due:b|Sicilienne Najdorf');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(calls)), [
        { color: 'all', focus: 'due' }, { color: 'all', focus: 'weak' },
        { color: 'b', opening: { key: 'b|Sicilienne Najdorf', name: 'Sicilienne Najdorf' }, focus: 'due' }]);
});

t('Entraînement filtré sur une ouverture : seules ses positions sont proposées', () => {
    const P = 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6';
    const dbs = { w: {}, b: {
        k1: { move: 'a7a6', attempts: 3, failures: 1, path: path(P) },
        k2: { move: 'e7e5', attempts: 2, failures: 0, path: path('e2e4 e7e5') },
        k3: { move: 'g8f6', attempts: 0, failures: 0, path: path(P).slice(0, 8) } } };
    Object.assign(ctx, { readDBFor: (r, c) => dbs[c], currentRepertoire: 'Général', switchHomeTab: tab => { ctx._tab = tab; },
        dataStore: { get: () => null, getJSON: (k, d) => d, set() {}, setJSON() {}, remove() {} }, appSettings: {}, SYNCED_PREFS: {} });
    ctx.document.querySelector = () => null;
    for (const f of ['js/modules/training/training.js', 'js/modules/training/trainingUI.js'])
        vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: f });
    const tag = [{ side: 'b', k: 'k1', e: dbs.b.k1, path: dbs.b.k1.path }];
    _assignOpenings(tag);
    ctx.openTrainingFrom({ color: 'b', opening: { key: tag[0].gKey, name: tag[0].gName }, focus: 'due' });
    assert.strictEqual(ctx._tab, 'training');
    assert.strictEqual(ctx._trRows().map(r => r.key).sort().join(), 'k1,k3');
    ctx.openTrainingFrom({ color: 'all' });
    assert.strictEqual(ctx._trRows().map(r => r.key).sort().join(), 'k1,k2,k3');
});

t('aperçu : la barre du haut montre la catégorie de la position et la liste quittée, le retour rouvre la page au même endroit', () => {
    const btn = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }, cat = {};
    const getById = ctx.document.getElementById;
    ctx.document.getElementById = id => id === 'stats-back' ? btn : id === 'stats-cat' ? cat : null;
    ctx._renderStatsBack('fragile', 'weak');
    assert(cat.innerHTML.includes('lv-chip lv-fragile') && cat.innerHTML.includes('lv-mark lv-fragile') && cat.innerHTML.includes('Fragile</span>'), cat.innerHTML);
    assert(cat.innerHTML.includes('· Points faibles'));
    assert.strictEqual(btn.attrs['aria-label'], 'Retour aux Statistiques · Points faibles');
    ctx._renderStatsBack('mastered', 'Partie espagnole');
    assert(cat.innerHTML.includes('lv-chip lv-mastered') && cat.innerHTML.includes('· Partie espagnole'));
    ctx._renderStatsBack('weak', undefined);
    assert(!cat.innerHTML.includes('tp-origin') && btn.attrs['aria-label'] === 'Retour aux Statistiques', 'sans origine : la puce seule');
    ctx.document.getElementById = getById;
    const html = fs.readFileSync('index.html', 'utf8');
    assert(/class="topnav-meta" data-modes-not="preview"/.test(html) && /class="topnav-meta topnav-preview" data-modes="preview"/.test(html), 'barre du haut : répertoire et couleur remplacés pendant l\'aperçu');
    assert(!/stats-back[^>]*data-modes="preview"[^>]*class="btn/.test(html) && !/class="btn[^"]*stats-back/.test(html), 'plus de bouton de retour dans la barre de contrôle');

    const calls = [];
    Object.assign(ctx, { goHome: tab => calls.push('goHome:' + tab), requestAnimationFrame: f => f(), window: { scrollTo: o => calls.push('scroll:' + o.top) } });
    vm.runInContext('statsPreviewTarget = { color: "w", key: "k", origin: "weak", scrollY: 444 }', ctx);
    ctx.statsBack();
    assert.strictEqual(calls.join(' '), 'goHome:stats scroll:444');
});

console.log(`\n${n} tests réussis.`);
