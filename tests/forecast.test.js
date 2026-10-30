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
    pick(/function dueForecast[\s\S]*?\n}\n/)
].join('').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: 'js/storage.js' });
const { dueForecast } = ctx;

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

console.log(`\n${n} tests réussis.`);
