// Lancer : node tests/settings.test.js   — préférences locales / synchronisées (js/core/settings.js)
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

function boot(store = {}) {
    const mem = new Map(Object.entries(store));
    const ctx = {
        localStorage: { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
                        get length() { return mem.size; }, key: i => [...mem.keys()][i] },
        document: { documentElement: { setAttribute() {} } }, Date, JSON
    };
    vm.createContext(ctx);
    ['js/core/storageAdapter.js', 'js/core/settings.js'].forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
    ctx.run = s => vm.runInContext(s, ctx);
    ctx.prefs = () => JSON.parse(mem.get('chessTrainer_prefs') || 'null');
    ctx.local = () => JSON.parse(mem.get('chessTrainer_settings') || 'null');
    return ctx;
}

t('appareil neuf : valeurs par défaut, rien n\'est écrit', () => {
    const c = boot();
    assert.strictEqual(c.run('appSettings.pieceSet'), 'merida');
    assert.strictEqual(c.prefs(), null);
});

t('migration : les choix existants deviennent des préférences datées de 0', () => {
    const c = boot({ chessTrainer_settings: JSON.stringify({ sound: false, pieceSet: 'chrome', boardTheme: 'walnut' }) });
    assert.deepStrictEqual(c.prefs(), { boardTheme: { v: 'walnut', at: 0 }, pieceSet: { v: 'chrome', at: 0 } });
    assert.strictEqual(c.run('appSettings.pieceSet'), 'chrome');
    assert.strictEqual(c.run('appSettings.sound'), false);
});

t('enregistrement : sons en local, seule la préférence modifiée est datée', () => {
    const c = boot({ chessTrainer_prefs: JSON.stringify({ boardTheme: { v: 'stone', at: 7 } }) });
    c.run(`appSettings.pieceSet = 'fantasy'; appSettings.volume = 0.3; saveSettings()`);
    const p = c.prefs();
    assert.deepStrictEqual(p.boardTheme, { v: 'stone', at: 7 });           // inchangée : date d'origine conservée
    assert.strictEqual(p.pieceSet.v, 'fantasy'); assert(p.pieceSet.at > 7);
    assert.strictEqual(c.local().volume, 0.3); assert.strictEqual(c.local().sound, true);
    assert.strictEqual(c.local().pieceSet, undefined);                    // rien de synchronisé dans le stockage local
});

t('valeur reçue d\'un autre appareil : jamais écrasée par une copie ancienne en mémoire', () => {
    const c = boot({ chessTrainer_prefs: JSON.stringify({ pieceSet: { v: 'merida', at: 1 } }) });
    c.run(`localStorage.setItem('chessTrainer_prefs', JSON.stringify({ pieceSet: { v: 'chrome', at: 9 } }))`);   // écrit par la synchro
    c.run(`appSettings.sound = false; saveSettings()`);                    // la mémoire contient encore « merida »
    assert.deepStrictEqual(c.prefs().pieceSet, { v: 'chrome', at: 9 });
    assert.strictEqual(c.run('reloadSyncedPrefs()'), true);
    assert.strictEqual(c.run('appSettings.pieceSet'), 'chrome');
    assert.strictEqual(c.run('reloadSyncedPrefs()'), false);
});

t('valeur inconnue (version plus récente sur un autre appareil) : repli sur la valeur par défaut', () => {
    const c = boot({ chessTrainer_prefs: JSON.stringify({ arrowStyle: { v: 'futur', at: 3 } }) });
    assert.strictEqual(c.run('appSettings.arrowStyle'), 'plume');
});

t('nouvelles préférences : valeurs par défaut et validation', () => {
    const c = boot({ chessTrainer_prefs: JSON.stringify({ dailyGoal: { v: 99, at: 1 }, notation: { v: 'fig', at: 1 }, pseudo: { v: 'Mathilde', at: 1 } }) });
    assert.strictEqual(c.run('appSettings.dailyGoal'), 10);                // hors bornes : défaut
    assert.strictEqual(c.run('appSettings.notation'), 'fig');
    assert.strictEqual(c.run('appSettings.pseudo'), 'Mathilde');
    assert.strictEqual(c.run('appSettings.textSize'), 'm');
});

t('mode : valeurs historiques du thème et mode système', () => {
    const c = boot({ chessTrainer_theme: 'light' });
    assert.strictEqual(c.run('themeMode()'), 'dark');                     // 'light' historique = thème sombre
    c.run(`setThemeMode('system')`);
    assert.strictEqual(c.run('themeMode()'), 'system');
    c.run(`setThemeMode('light')`);
    assert.strictEqual(c.run(`dataStore.get('chessTrainer_theme')`), 'dark');
});

t('appareils : déconnexion demandée par un autre appareil, levée à la reconnexion', () => {
    const c = boot();
    c.navigator = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605', maxTouchPoints: 0 };
    c.run(`touchDevice(true)`);
    const id = c.run('deviceId()');
    assert.strictEqual(c.run('listDevices().length'), 1);
    assert.strictEqual(c.run('listDevices()[0].name'), 'Mac · Safari');
    const p = c.prefs(); p['dev:' + id].v.revoked = true; p['dev:' + id].at += 1;
    c.run(`localStorage.setItem('chessTrainer_prefs', ${JSON.stringify(JSON.stringify(p))})`);
    assert.strictEqual(c.run('isThisDeviceRevoked()'), true);
    c.run(`touchDevice(true)`);
    assert.strictEqual(c.run('isThisDeviceRevoked()'), false);
});

console.log(`\n${n} tests réussis.`);
