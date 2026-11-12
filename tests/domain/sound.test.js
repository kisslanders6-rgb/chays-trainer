// Lancer : node tests/domain/sound.test.js   — sons de l'application (js/domain/sound.js), joués sur un faux contexte audio : douceur garantie.
// Mesures faites dans un navigateur (OfflineAudioContext, volume 100 %) lors du passage à l'ambiance Noyer, novembre 2026 :
// crête du coup 0,15 (0,20 avant), de la prise 0,15 (0,24 avant), du roque 0,23 (0,44 avant).
const { scriptPath } = require('../_app.js');
const fs = require('fs'), assert = require('assert'), vm = require('vm');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const src = fs.readFileSync(scriptPath('sound.js'), 'utf8');

// Faux contexte : note, pour chaque enveloppe, sa crête et son attaque, et la forme de chaque oscillateur.
function fakeAudio() {
    const log = { envelopes: [], waves: [] };
    const node = extra => Object.assign({ connect() {}, start() {}, stop() {}, frequency: fakeParam(), Q: fakeParam(), gain: fakeParam() }, extra);
    function fakeParam() { return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
    return {
        log,
        ctx: {
            sampleRate: 44100, destination: node(),
            createBuffer: (c, len) => ({ getChannelData: () => new Float32Array(len) }),
            createBufferSource: () => node(),
            createBiquadFilter: () => node(),
            createOscillator: () => { const o = node(); log.waves.push(() => o.type); return o; },
            createGain: () => {
                const ramps = [], start = { t: null };
                const gain = {
                    value: 1,
                    setValueAtTime: (v, at) => { start.t = at; },
                    exponentialRampToValueAtTime: (v, at) => { ramps.push({ v, at }); }
                };
                log.envelopes.push(() => (ramps.length ? { peak: ramps[0].v, attack: ramps[0].at - start.t } : null));
                return node({ gain });
            }
        }
    };
}

function loadSound() {
    const sandbox = { window: {}, addEventListener() {}, Math };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    sandbox.SOUNDS = vm.runInContext('_SOUNDS', sandbox);
    return sandbox;
}

const app = loadSound();
const KINDS = ['capture', 'castle', 'check', 'end', 'error', 'master', 'mate', 'move', 'opp', 'promote', 'success'];

function played(kind) {
    const { ctx, log } = fakeAudio();
    app.SOUNDS[kind](ctx, {}, 0);
    return { envelopes: log.envelopes.map(f => f()).filter(Boolean), waves: log.waves.map(f => f()) };
}
// La variation de force est aléatoire : on garde le pire de plusieurs essais.
const worstSum = kind => Math.max(...Array.from({ length: 40 }, () => played(kind).envelopes.reduce((a, e) => a + e.peak, 0)));

t('les onze sons existent', () => {
    assert.deepStrictEqual(Object.keys(app.SOUNDS).sort(), KINDS);
});

t('aucun timbre agressif : plus de dent de scie ni de carré', () => {
    for (const k of KINDS) for (const w of played(k).waves) assert(w !== 'sawtooth' && w !== 'square', `${k} : ${w}`);
});

t('attaque adoucie : jamais moins de 5 ms', () => {
    for (const k of KINDS) for (const e of played(k).envelopes) assert(e.attack >= 0.005 - 1e-9, `${k} : ${e.attack}`);
});

t('niveaux : la somme des crêtes de chaque son reste sous 0,6 (la prise n\'est pas plus forte que le coup)', () => {
    for (const k of KINDS) assert(worstSum(k) <= 0.6, `${k} : ${worstSum(k)}`);
    assert(worstSum('capture') <= worstSum('move') * 1.6, 'prise à peine plus pleine que le coup');
    assert(worstSum('opp') < worstSum('move'), 'le coup adverse est plus discret que le mien');
});

t('le son d\'un coup : mat, échec, promotion, roque, prise, coup ordinaire, coup adverse', () => {
    const kind = app.moveSoundKind;
    assert.strictEqual(kind('Qh7#', true), 'mate');
    assert.strictEqual(kind('Nf7+', true), 'check');
    assert.strictEqual(kind('e8=Q', false), 'promote');
    assert.strictEqual(kind('O-O-O', false), 'castle');
    assert.strictEqual(kind('Nxe5', true), 'capture');
    assert.strictEqual(kind('Nf3', false), 'move');
    assert.strictEqual(kind('Nf3', false, true), 'opp');
    assert.strictEqual(kind('Nxe5', true, true), 'capture', 'une prise adverse reste une prise');
    assert.strictEqual(kind('Nf7+', false, true), 'check', 'un échec adverse reste un échec');
});

t('le coup adverse suit le réglage du coup joué', () => {
    assert(/opp: 'sMove'/.test(src));
});

t('sortie : aigus coupés, pièce et limiteur avant les haut-parleurs (jamais d\'écrêtage), construite une fois', () => {
    assert(/function _soundOut/.test(src) && /createDynamicsCompressor\(\)/.test(src) && /soft\.type = 'lowpass'/.test(src) && /createConvolver\(\)/.test(src));
    assert(/_SOUNDS\[kind\]\(ctx, _soundOut\(ctx, appSettings\.volume\)/.test(src), 'playSound passe par _soundOut');
});

console.log(`\n${n} tests réussis.`);
