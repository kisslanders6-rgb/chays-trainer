/**
 * core/sound.js
 * ──────────────────────────────────────────────────────────────────────────
 * Effets sonores synthétisés avec la Web Audio API (aucun fichier externe) :
 *   'move'    clic feutré       'capture' impact plus marqué       'error'  buzz grave discret
 * Respecte appSettings.sound / appSettings.volume (cf. settings.js).
 */

'use strict';

let _audioCtx = null;
let _noiseBuf = null;

function _ctx() {
    if (!_audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        _audioCtx = new AC();
    }
    if (_audioCtx.state === 'suspended') _audioCtx.resume();   // exigé par les navigateurs après un geste utilisateur
    return _audioCtx;
}

function _noise(ctx) {
    if (!_noiseBuf) {
        _noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
        const d = _noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return _noiseBuf;
}

// Enveloppe : attaque quasi instantanée puis décroissance exponentielle.
function _env(ctx, out, t0, peak, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(out);
    return g;
}

function _burst(ctx, out, t0, { freq, q, peak, dur, type = 'bandpass' }) {
    const src = ctx.createBufferSource();
    src.buffer = _noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    src.connect(f); f.connect(_env(ctx, out, t0, peak, dur));
    src.start(t0, Math.random() * 0.05); src.stop(t0 + dur + 0.02);
}

function _tone(ctx, out, t0, { wave = 'sine', from, to, peak, dur, lowpass }) {
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    let node = o;
    if (lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; o.connect(f); node = f; }
    node.connect(_env(ctx, out, t0, peak, dur));
    o.start(t0); o.stop(t0 + dur + 0.02);
}

const _SOUNDS = {
    move(ctx, out, t) {
        _burst(ctx, out, t, { freq: 1300, q: 0.9, peak: 0.30, dur: 0.045 });
        _tone(ctx, out, t,  { from: 190, to: 110, peak: 0.45, dur: 0.075 });
    },
    capture(ctx, out, t) {
        _burst(ctx, out, t,         { freq: 1700, q: 0.7, peak: 0.55, dur: 0.09 });
        _burst(ctx, out, t + 0.022, { freq: 900,  q: 0.8, peak: 0.35, dur: 0.07 });
        _tone(ctx, out, t,          { from: 150, to: 75, peak: 0.80, dur: 0.12 });
    },
    success(ctx, out, t) {                       // deux notes claires, montantes
        _tone(ctx, out, t,        { from: 660, to: 660, peak: 0.16, dur: 0.11 });
        _tone(ctx, out, t + 0.09, { from: 990, to: 990, peak: 0.14, dur: 0.18 });
    },
    error(ctx, out, t) {
        _tone(ctx, out, t,        { wave: 'sawtooth', from: 125, to: 95, peak: 0.22, dur: 0.075, lowpass: 420 });
        _tone(ctx, out, t + 0.1,  { wave: 'sawtooth', from: 110, to: 80, peak: 0.22, dur: 0.11,  lowpass: 380 });
    }
};

// Chaque son peut être coupé séparément (Paramètres › Sons et vibrations).
const _SOUND_PREF = { move: 'sMove', capture: 'sCapture', error: 'sError', success: 'sSuccess' };

// Vibration (téléphones compatibles) : coup refusé, exercice réussi. Indépendante du son.
function buzz(kind) {
    if (!appSettings.haptic || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try { navigator.vibrate(kind === 'error' ? [28, 50, 28] : 18); } catch (e) { /* vibration non prise en charge */ }
}

function playSound(kind) {
    if (kind === 'error' || kind === 'success') buzz(kind);
    if (!appSettings.sound || appSettings.volume <= 0 || !_SOUNDS[kind]) return;
    if (_SOUND_PREF[kind] && appSettings[_SOUND_PREF[kind]] === false) return;
    try {
        const ctx = _ctx();
        if (!ctx) return;
        const master = ctx.createGain();
        master.gain.value = Math.pow(appSettings.volume, 1.6) * 0.9;   // courbe douce : les faibles volumes restent discrets
        master.connect(ctx.destination);
        _SOUNDS[kind](ctx, master, ctx.currentTime + 0.005);
    } catch (e) { /* audio indisponible : on ignore */ }
}

// À appeler AVANT d'appliquer le coup (détecte la capture, prise en passant comprise).
function playMoveSound(from, to) {
    const p = board[from];
    const capture = !!board[to] || (!!p && p.toUpperCase() === 'P' && (from % 8) !== (to % 8));
    playSound(capture ? 'capture' : 'move');
    announceMove(from, to, capture);
}

// Annonce des coups aux lecteurs d'écran (Paramètres › Accessibilité) : « Cavalier f3 », « pion prend d5 ».
const _SPOKEN = { K: 'Roi', Q: 'Dame', R: 'Tour', B: 'Fou', N: 'Cavalier', P: 'Pion' };
function announceMove(from, to, capture) {
    if (!appSettings.announce) return;
    let live = document.getElementById('sr-moves');
    if (!live) {
        live = document.createElement('div');
        live.id = 'sr-moves'; live.className = 'sr-only'; live.setAttribute('aria-live', 'polite');
        document.body.appendChild(live);
    }
    const p = board[from] || '', t = p.toUpperCase();
    const castle = t === 'K' && Math.abs((to % 8) - (from % 8)) === 2;
    const who = p ? (p === t ? 'Blancs' : 'Noirs') : '';
    live.textContent = castle ? `${who} : ${(to % 8) > 4 ? 'petit' : 'grand'} roque`
        : `${who} : ${_SPOKEN[t] || ''} ${capture ? 'prend ' : ''}${squareToName(to)}`;
}
