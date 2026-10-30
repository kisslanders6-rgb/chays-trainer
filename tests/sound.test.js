// Lancer : node tests/sound.test.js   — sons de l'application (js/core/sound.js), lus sans audio : douceur garantie.
// Mesures faites dans un navigateur (OfflineAudioContext, volume 100 %) lors du réglage d'octobre 2026 :
// crête du coup 0,22 (0,44 avant), de la prise 0,23 (0,92 avant, au bord de l'écrêtage).
const fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const src = fs.readFileSync('js/core/sound.js', 'utf8');
const block = src.slice(src.indexOf('const _SOUNDS = {'), src.indexOf('\n};', src.indexOf('const _SOUNDS = {')));

t('aucun timbre agressif : plus de dent de scie ni de carré', () => {
    assert(!/wave: '(sawtooth|square)'/.test(block), 'dent de scie ou carré dans _SOUNDS');
});

t('attaque adoucie : 8 ms par défaut, jamais moins de 5 ms', () => {
    assert(/function _env\(ctx, out, t0, peak, dur, attack = 0\.008\)/.test(src));
    for (const m of block.matchAll(/attack: ([\d.]+)/g)) assert(Number(m[1]) >= 0.005, m[0]);
});

t('niveaux : la somme des crêtes de chaque son reste sous 0,6 (la prise n\'est plus plus forte que le coup)', () => {
    const sums = {};
    for (const m of block.matchAll(/^    (\w+)\(ctx, out, t\) \{([\s\S]*?)^    \}/gm))
        sums[m[1]] = [...m[2].matchAll(/peak: ([\d.]+)/g)].reduce((a, p) => a + Number(p[1]), 0);
    assert.deepStrictEqual(Object.keys(sums).sort(), ['capture', 'error', 'move', 'success']);
    for (const [k, v] of Object.entries(sums)) assert(v <= 0.6, `${k} : ${v}`);
    assert(sums.capture <= sums.move * 1.6, 'prise à peine plus pleine que le coup');
});

t('sortie : aigus coupés et limiteur avant les haut-parleurs (jamais d\'écrêtage)', () => {
    assert(/function _soundOut/.test(src) && /createDynamicsCompressor\(\)/.test(src) && /soft\.type = 'lowpass'/.test(src));
    assert(/_SOUNDS\[kind\]\(ctx, _soundOut\(ctx, appSettings\.volume\)/.test(src), 'playSound passe par _soundOut');
});

console.log(`\n${n} tests réussis.`);
