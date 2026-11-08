// Lancer : node tests/forecast.test.js   — programme des révisions (reviewPlan, js/storage.js), sans DOM
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const src = fs.readFileSync('js/storage.js', 'utf8');
const pick = re => { const m = src.match(re); assert(m, String(re)); return m[0]; };
const ctx = { console };
vm.createContext(ctx);
// Seules les fonctions de la planification sont nécessaires : DAY_MS, impliedInterval, dueOf, isDue, reviewPlan.
vm.runInContext([
    pick(/const DAY_MS[^\n]*\n/),
    pick(/function impliedInterval[\s\S]*?\n}\n/),
    pick(/const dueOf[^\n]*\n/),
    pick(/const isDue[^\n]*\n/),
    pick(/function newPerDay[\s\S]*?\n}\n/),
    pick(/function reviewPlan[\s\S]*?\n}\n/),
    pick(/const RELEARN_DAYS[^\n]*\n/),
    pick(/const REVIEW_GROWTH[^\n]*\n/),
    pick(/const REVIEW_MAX_DAYS[^\n]*\n/),
    pick(/const REVIEW_RETRY_MS[^\n]*\n/),
    pick(/const MASTERY_START[\s\S]*?const MASTERY_GAIN_SOON[^\n]*\n/),
    pick(/const _masteryFrom[^\n]*\n/),
    pick(/const masteryOf[^\n]*\n/),
    pick(/function _nextMastery[\s\S]*?\n}\n/),
    pick(/function recordReview[\s\S]*?\n}\n/),
    'function reviewGrowth() { return 2.5; } function logActivity() {} function _noop() {}\n'
].join('').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: 'js/storage.js' });
// Programme des révisions : base simulée par répertoire et couleur (readDBFor), objectif quotidien réglable.
ctx.__dbs = {}; ctx.appSettings = { dailyGoal: 10 }; ctx.currentRepertoire = 'R';
vm.runInContext('var readDBFor = (rep, c) => (__dbs[rep] && __dbs[rep][c]) || {};', ctx);
const plan = (w, b, goal = 10, at = now) => { ctx.__dbs = { R: { w, b } }; ctx.appSettings.dailyGoal = goal; return ctx.reviewPlan('R', at); };

const now = new Date(2026, 9, 29, 15, 30).getTime();             // 29 octobre 2026, 15 h 30
const day = (i, h = 9) => new Date(2026, 9, 29 + i, h).getTime(); // jour i, 9 h

t('programme : 30 nouvelles positions s\'étalent au rythme de l\'objectif quotidien (10, 10, 10), plus de pic du jour', () => {
    const w = {};
    for (let i = 0; i < 30; i++) w['p' + i] = { attempts: 0, failures: 0, due: day(0, 8), created: day(0, 8) + i, ply: i };
    const p = plan(w, {});
    assert.deepStrictEqual([...p.forecast(null, 5)], [10, 10, 10, 0, 0]);
    assert(p.today('w', 'p0') && p.today('w', 'p9') && !p.today('w', 'p10'), 'les plus anciennes d\'abord');
    assert.strictEqual(p.dayOf('w', 'p29'), 2);
    assert.strictEqual(plan(w, {}, 15).forecast(null, 3).join(), '15,15,0', 'suit l\'objectif quotidien');
});

t('programme : révisions à leur échéance, retards aujourd\'hui, réponses « Traitée depuis » en tête des nouvelles', () => {
    const w = { late: { attempts: 3, failures: 0, due: day(-3) }, d2: { attempts: 2, failures: 0, due: day(2) } };
    const b = { a: { attempts: 0, due: 1, created: 1, ply: 1 }, b: { attempts: 0, due: 2, created: 2, ply: 1 }, c: { attempts: 0, due: 3, created: 3, ply: 1, prio: 1 } };
    const p = plan(w, b, 1);
    assert.deepStrictEqual([...p.forecast(null, 4)], [2, 1, 2, 0], 'retard + 1 nouvelle ; 1 nouvelle ; 1 révision + 1 nouvelle');
    assert(p.today('w', 'late') && p.today('b', 'c') && !p.today('b', 'a'), '« Traitée depuis » passe avant les autres nouvelles');
    assert.strictEqual(p.dayOf('w', 'd2'), 2);
    assert.deepStrictEqual([...p.forecast(c => c === 'b', 4)], [1, 1, 1, 0], 'portée : une couleur');
    assert.strictEqual(p.next(c => c === 'w'), day(2), 'prochaine révision des Blancs');
    assert.strictEqual(p.dayOf('w', 'inconnue'), Infinity);
});

// ─── File « À revoir » et score de maîtrise (recordReview) ───────────────────
const note = (e, ok) => { e.attempts++; if (!ok) e.failures++; ctx.recordReview(e, ok); return e; };
const ready = e => { e.due = Date.now() - 1000; return e; };

t('file À revoir : une erreur y fait entrer, trois réussites à l\'échéance en sortent (1, 3, 7 jours)', () => {
    const e = note({ attempts: 5, failures: 0, due: Date.now() - 1000, interval: 30 }, false);
    assert.strictEqual(e.relearn, 0); assert.strictEqual(e.interval, 0);
    assert(e.due - Date.now() <= 10 * 60000 && e.due > Date.now(), 'retour dans 10 min');
    note(ready(e), true); assert.strictEqual(e.relearn, 1); assert.strictEqual(e.interval, 1);
    note(ready(e), true); assert.strictEqual(e.relearn, 2); assert.strictEqual(e.interval, 3);
    note(ready(e), true); assert.strictEqual(e.relearn, undefined, 'sortie de la file'); assert.strictEqual(e.interval, 7);
    note(ready(e), true); assert.strictEqual(e.interval, 17.5, 'ensuite, intervalle normal');
});

t('file À revoir : une réussite avant l\'échéance n\'avance pas, une erreur ramène à zéro', () => {
    const e = note({ attempts: 1, failures: 0, due: Date.now() - 1000 }, false);
    note(e, true); note(e, true); note(e, true);
    assert.strictEqual(e.relearn, 0, 'trois réussites de suite tout de suite après : toujours à 0');
    note(ready(e), true); note(ready(e), true);
    assert.strictEqual(e.relearn, 2);
    note(ready(e), false);
    assert.strictEqual(e.relearn, 0);
});

t('score : une erreur ancienne s\'efface, gain réduit hors échéance, positions anciennes déduites des compteurs', () => {
    const old = { attempts: 10, failures: 8, due: Date.now() - 1000 };
    assert.strictEqual(Math.round(ctx.masteryOf(old)), 20);
    note(old, true);
    assert.strictEqual(old.mastery, 48, 'calculé depuis 8 erreurs sur 10, sans compter ce passage : 20 + 35 % de 80');
    const e = { attempts: 0, failures: 0, due: Date.now() - 1000 };
    note(e, false); assert.strictEqual(e.mastery, 24, 'erreur : il reste 40 %');
    for (let i = 0; i < 6; i++) note(ready(e), true);
    assert(e.mastery >= 85, 'six réussites à l\'échéance : solide, quels que soient les compteurs');
    const s = { attempts: 1, failures: 0, mastery: 50, due: Date.now() + 864e5 };
    note(s, true); assert.strictEqual(s.mastery, 55, 'pas encore due : + 10 % de ce qui manque');
});

console.log(`\n${n} tests réussis.`);
