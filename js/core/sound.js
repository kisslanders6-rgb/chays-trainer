/**
 * core/sound.js
 * ──────────────────────────────────────────────────────────────────────────
 * Effets sonores synthétisés avec la Web Audio API (aucun fichier externe) :
 *   'move'    toc de bois feutré   'capture' toc plus plein (pas plus fort)   'success' deux notes rondes
 *   'error'   deux notes sourdes descendantes (plus de buzz en dent de scie)
 * Douceur : attaque de 8 ms (plus de clic), aigus coupés au-dessus de 3,2 kHz, limiteur en sortie (jamais d'écrêtage).
 * Respecte appSettings.sound / appSettings.volume (cf. settings.js).
 * Annonce des coups (spokenMove, announceMove, Voice) : lecteurs d'écran ou synthèse vocale, réglage announce.
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

// Enveloppe : attaque courte mais adoucie (8 ms par défaut : pas de clic) puis décroissance exponentielle.
function _env(ctx, out, t0, peak, dur, attack = 0.008) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(out);
    return g;
}

function _burst(ctx, out, t0, { freq, q, peak, dur, type = 'bandpass', attack = 0.006 }) {
    const src = ctx.createBufferSource();
    src.buffer = _noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    src.connect(f); f.connect(_env(ctx, out, t0, peak, dur, attack));
    src.start(t0, Math.random() * 0.05); src.stop(t0 + dur + 0.02);
}

function _tone(ctx, out, t0, { wave = 'sine', from, to, peak, dur, lowpass, attack }) {
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    let node = o;
    if (lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; o.connect(f); node = f; }
    node.connect(_env(ctx, out, t0, peak, dur, attack));
    o.start(t0); o.stop(t0 + dur + 0.02);
}

// Niveaux choisis pour qu'aucun son ne dépasse ~0,5 en crête avant le limiteur (tests/sound.test.js).
const _SOUNDS = {
    move(ctx, out, t) {                          // toc de bois feutré
        _burst(ctx, out, t, { freq: 1000, q: 1.3, peak: 0.14, dur: 0.04 });
        _tone(ctx, out, t,  { from: 200, to: 140, peak: 0.26, dur: 0.09 });
    },
    capture(ctx, out, t) {                       // même bois, plus plein et plus grave, pas plus fort
        _burst(ctx, out, t,         { freq: 800, q: 1.1, peak: 0.18, dur: 0.06 });
        _burst(ctx, out, t + 0.018, { freq: 520, q: 1.2, peak: 0.10, dur: 0.06 });
        _tone(ctx, out, t,          { from: 165, to: 110, peak: 0.30, dur: 0.13 });
    },
    success(ctx, out, t) {                       // deux notes rondes, montantes (ré, la)
        _tone(ctx, out, t,        { from: 587, to: 587, peak: 0.10, dur: 0.20, attack: 0.012 });
        _tone(ctx, out, t + 0.10, { from: 880, to: 880, peak: 0.08, dur: 0.28, attack: 0.012 });
    },
    error(ctx, out, t) {                         // deux notes sourdes, descendantes
        _tone(ctx, out, t,        { wave: 'triangle', from: 210, to: 180, peak: 0.09, dur: 0.12, lowpass: 700 });
        _tone(ctx, out, t + 0.13, { wave: 'triangle', from: 175, to: 150, peak: 0.085, dur: 0.16, lowpass: 600 });
    }
};

// Sortie commune : volume (courbe douce), aigus coupés, limiteur. Renvoie le nœud où brancher un son.
function _soundOut(ctx, volume) {
    const master = ctx.createGain(), soft = ctx.createBiquadFilter(), lim = ctx.createDynamicsCompressor();
    master.gain.value = Math.pow(volume, 1.6) * 1.7;
    soft.type = 'lowpass'; soft.frequency.value = 3200; soft.Q.value = 0.5;
    lim.threshold.value = -12; lim.knee.value = 10; lim.ratio.value = 8; lim.attack.value = 0.002; lim.release.value = 0.12;
    master.connect(soft); soft.connect(lim); lim.connect(ctx.destination);
    return master;
}

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
        _SOUNDS[kind](ctx, _soundOut(ctx, appSettings.volume), ctx.currentTime + 0.005);
    } catch (e) { /* audio indisponible : on ignore */ }
}

// À appeler AVANT d'appliquer le coup (détecte la capture, prise en passant comprise).
function playMoveSound(from, to, promo) {
    const p = board[from];
    const capture = !!board[to] || (!!p && p.toUpperCase() === 'P' && (from % 8) !== (to % 8));
    playSound(capture ? 'capture' : 'move');
    announceMove(from, to, capture, promo);
}

// ─── ANNONCE DES COUPS (Paramètres › Accessibilité) ──────────────────────────
// appSettings.announce : 'off' | 'sr' (région aria-live, lue par VoiceOver / TalkBack) | 'voice' (synthèse
// vocale de l'appareil, Web Speech API). Phrase en toutes lettres : « Blancs : Cavalier prend f3, échec ».
const _SPOKEN = { K: 'Roi', Q: 'Dame', R: 'Tour', B: 'Fou', N: 'Cavalier', P: 'Pion' };

// Phrase d'un coup en notation anglaise (SAN) : roque, prise, promotion, échec et mat compris.
function spokenMove(san, white) {
    const who = white ? 'Blancs' : 'Noirs', end = /#$/.test(san) ? ', échec et mat' : /\+$/.test(san) ? ', échec' : '';
    const s = san.replace(/[+#!?]+$/, '');
    if (/^O-O-O/.test(s)) return `${who} : grand roque${end}`;
    if (/^O-O/.test(s)) return `${who} : petit roque${end}`;
    const m = s.match(/^([KQRBN])?([a-h]?[1-8]?)(x)?([a-h][1-8])(?:=([QRBN]))?/);
    if (!m) return `${who} : ${san}`;
    const piece = _SPOKEN[m[1] || 'P'], promo = m[5] ? `, promotion en ${_SPOKEN[m[5]]}` : '';
    return `${who} : ${piece} ${m[3] ? 'prend ' : ''}${m[4]}${promo}${end}`;
}

function announceMove(from, to, capture, promo) {
    const mode = appSettings.announce;
    if (mode !== 'sr' && mode !== 'voice') return;
    const p = board[from] || '', white = p !== '' && p === p.toUpperCase();
    let san = '';
    try {
        const pos = Chess.snapshot(), last = p.toUpperCase() === 'P' && (to < 8 || to >= 56);
        san = Chess.san(pos, squareToName(from) + squareToName(to) + (promo || (last ? 'q' : '')));
    } catch (e) { san = (capture ? 'x' : '') + squareToName(to); }
    announceText(spokenMove(san, white));
}

// Région live : déclarée dans index.html (une région créée au moment d'écrire est souvent ignorée), vidée puis
// remplie au tour suivant, après le rendu de l'échiquier qui reprend le focus (sinon l'annonce est avalée).
let _srTimer = null;
function announceText(text) {
    const mode = appSettings.announce;
    if (mode === 'voice' && Voice.available()) { Voice.say(text); return; }
    if (mode !== 'sr' && mode !== 'voice') return;
    let live = document.getElementById('sr-moves');
    if (!live) {
        live = document.createElement('div');
        live.id = 'sr-moves'; live.className = 'sr-only';
        live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
        document.body.appendChild(live);
    }
    live.textContent = '';
    clearTimeout(_srTimer);
    _srTimer = setTimeout(() => { live.textContent = text; }, 60);
}

// Synthèse vocale : voix française si l'appareil en a une. Débloquée au premier toucher (iOS n'accepte de
// parler qu'après un geste) ; chaque annonce coupe la précédente. L'énoncé en cours est gardé en mémoire
// (Chrome l'arrête sinon en cours de lecture).
const Voice = (function () {
    const api = () => (typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined' ? speechSynthesis : null);
    let voice = null, current = null;
    const pick = () => {
        const s = api(); if (!s) return;
        const all = s.getVoices();
        voice = all.find(v => /^fr-FR/i.test(v.lang) && v.localService) || all.find(v => /^fr/i.test(v.lang)) || null;
    };
    if (api()) {
        pick();
        try { api().addEventListener('voiceschanged', pick); } catch (e) { api().onvoiceschanged = pick; }
        if (typeof addEventListener === 'function')
            addEventListener('pointerdown', () => { try { api().speak(new SpeechSynthesisUtterance('')); } catch (e) { /* ignoré */ } }, { once: true, capture: true });
    }
    return {
        available: () => !!api(),
        hasFrench: () => !!voice,
        say(text) {
            const s = api(); if (!s) return;
            s.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'fr-FR'; u.rate = 1.05;
            if (voice) u.voice = voice;
            current = u;
            u.onend = u.onerror = () => { if (current === u) current = null; };
            s.speak(u);
        }
    };
})();
