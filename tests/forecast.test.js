// Lancer : node tests/forecast.test.js   — prévision des révisions jour par jour (dueForecast, js/storage.js), sans DOM
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const src = fs.readFileSync('js/storage.js', 'utf8');
const pick = re => { const m = src.match(re); assert(m, String(re)); return m[0]; };
const ctx = { console };
vm.createContext(ctx);
// Seules les fonctions de la planification sont nécessaires : DAY_MS, impliedInterval, dueOf, isDue, dueForecast.
vm.runInContext([
    pick(/const DAY_MS[^\n]*\n/),
    pick(/function impliedInterval[\s\S]*?\n}\n/),
    pick(/const dueOf[^\n]*\n/),
    pick(/const isDue[^\n]*\n/),
    pick(/function dueForecast[\s\S]*?\n}\n/),
    pick(/function newPerDay[\s\S]*?\n}\n/),
    pick(/function reviewPlan[\s\S]*?\n}\n/)
].join('').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: 'js/storage.js' });
const { dueForecast } = ctx;
// Programme des révisions : base simulée par répertoire et couleur (readDBFor), objectif quotidien réglable.
ctx.__dbs = {}; ctx.appSettings = { dailyGoal: 10 }; ctx.currentRepertoire = 'R';
vm.runInContext('var readDBFor = (rep, c) => (__dbs[rep] && __dbs[rep][c]) || {};', ctx);
const plan = (w, b, goal = 10, at = now) => { ctx.__dbs = { R: { w, b } }; ctx.appSettings.dailyGoal = goal; return ctx.reviewPlan('R', at); };

const now = new Date(2026, 9, 29, 15, 30).getTime();             // 29 octobre 2026, 15 h 30
const day = (i, h = 9) => new Date(2026, 9, 29 + i, h).getTime(); // jour i, 9 h

t('sept cases par défaut, toutes à zéro sans entrée', () => {
    assert.deepStrictEqual([...dueForecast([], 7, now)], [0, 0, 0, 0, 0, 0, 0]);
    assert.strictEqual(dueForecast(null, 3, now).length, 3);
});

t('une position en retard compte le premier jour', () => {
    const f = dueForecast([{ due: day(-4) }, { due: now - 1 }], 7, now);
    assert.strictEqual(f[0], 2);
});

t('plus tard aujourd\'hui : premier jour aussi', () => {
    assert.strictEqual(dueForecast([{ due: day(0, 22) }], 7, now)[0], 1);
});

t('une position due dans 3 jours compte à l\'indice 3', () => {
    const f = dueForecast([{ due: day(3) }, { due: day(3, 23) }, { due: day(1, 0) }], 7, now);
    assert.deepStrictEqual([...f], [0, 1, 0, 2, 0, 0, 0]);
});

t('au-delà de l\'horizon : rien n\'est compté', () => {
    assert.deepStrictEqual([...dueForecast([{ due: day(7, 0) }, { due: day(30) }], 7, now)], [0, 0, 0, 0, 0, 0, 0]);
    assert.strictEqual(dueForecast([{ due: day(6, 23) }], 7, now)[6], 1);
});

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

console.log(`\n${n} tests réussis.`);
