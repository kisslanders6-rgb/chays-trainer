/**
 * domain/sound.js
 * ──────────────────────────────────────────────────────────────────────────
 * Effets sonores synthétisés avec la Web Audio API (aucun fichier externe) :
 * Ambiance « Noyer » : une pièce posée sur un plateau de bois, dans une pièce calme.
 *   'move'    mon coup   'opp' coup adverse (plus grave, plus discret)   'capture' deux contacts, pas plus fort
 *   'check' le coup et une note   'castle' deux frappes   'promote' trois notes montantes   'mate' prise et accord
 *   'success' deux notes rondes   'error' deux frappes sourdes   'end' fin de séance
 *   'master'  position devenue Maîtrisée : la pièce posée doucement, puis une cloche de laiton (identité « Noyer gravé »)
 * Timbre : résonances fixes (pas de note qui glisse), contact bref, hauteur et force qui varient à chaque coup.
 * Douceur : attaque de 5 ms au moins (plus de clic), aigus coupés au-dessus de 2,2 kHz, limiteur en sortie (jamais d'écrêtage).
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

// ─── TIMBRE NOYER ─────────────────────────────────────────────────────────────
const _NOYER = {
    ratios: [1, 2.45, 3.9], amps: [0.27, 0.08, 0.025], decays: [0.12, 0.06, 0.03], base: 280,   // résonances du bois
    contact: { freq: 1300, q: 0.8, peak: 0.08, dur: 0.018, attack: 0.005 },
    noteScale: 0.75, overtone: 4, overtoneAmp: 0.16
};
const _jitter = range => 1 + (Math.random() * 2 - 1) * range;

// Une frappe de pièce. pitch : plus bas, plus grave ; level : force relative.
function _hit(ctx, out, t, { pitch = 1, level = 1 } = {}) {
    const p = _jitter(0.02), g = _jitter(0.07), n = _NOYER;
    n.ratios.forEach((r, i) => {
        const f = n.base * pitch * r * p;
        _tone(ctx, out, t, { from: f, to: f, peak: n.amps[i] * level * g, dur: n.decays[i], attack: 0.006 });
    });
    _burst(ctx, out, t, { ...n.contact, freq: n.contact.freq * pitch, peak: n.contact.peak * level * g });
}

// Une note ronde : le fondamental et un harmonique qui s'éteint vite.
function _note(ctx, out, t, freq, peak, dur) {
    const f = freq * _NOYER.noteScale, over = f * _NOYER.overtone;
    _tone(ctx, out, t, { from: f, to: f, peak, dur, attack: 0.012 });
    _tone(ctx, out, t, { from: over, to: over, peak: peak * _NOYER.overtoneAmp, dur: dur * 0.35, attack: 0.012 });
}

// Somme des crêtes de chaque son sous 0,6 avant le limiteur (tests/domain/sound.test.js).
const _SOUNDS = {
    move(ctx, out, t) { _hit(ctx, out, t); },
    opp(ctx, out, t) { _hit(ctx, out, t, { pitch: 0.89, level: 0.76 }); },
    capture(ctx, out, t) {                       // la pièce prise, puis celle qui se pose : plus plein, pas plus fort
        _hit(ctx, out, t, { pitch: 1.04, level: 0.3 });
        _hit(ctx, out, t + 0.017, { pitch: 0.8, level: 0.56 });
    },
    check(ctx, out, t) {
        _hit(ctx, out, t, { level: 0.72 });
        _note(ctx, out, t + 0.06, 740, 0.062, 0.24);
    },
    castle(ctx, out, t) {                        // le Roi, puis la Tour
        _hit(ctx, out, t, { level: 0.5 });
        _hit(ctx, out, t + 0.115, { pitch: 0.9, level: 0.36 });
    },
    promote(ctx, out, t) {                       // le coup, puis trois notes montantes
        _hit(ctx, out, t, { level: 0.62 });
        [523, 659, 784].forEach((f, i) => _note(ctx, out, t + 0.07 + i * 0.075, f, 0.05, 0.3));
    },
    mate(ctx, out, t) {                          // une frappe grave, puis un accord posé
        _hit(ctx, out, t, { pitch: 0.8, level: 0.66 });
        _note(ctx, out, t + 0.1, 392, 0.075, 0.5);
        _note(ctx, out, t + 0.1, 587, 0.05, 0.56);
    },
    success(ctx, out, t) {
        _note(ctx, out, t, 587, 0.085, 0.26);
        _note(ctx, out, t + 0.11, 880, 0.07, 0.34);
    },
    error(ctx, out, t) {                         // deux frappes sourdes : pas de reproche
        _hit(ctx, out, t, { pitch: 0.64, level: 0.3 });
        _hit(ctx, out, t + 0.125, { pitch: 0.58, level: 0.26 });
    },
    end(ctx, out, t) {
        [587, 740, 880].forEach((f, i) => _note(ctx, out, t + i * 0.12, f, 0.07, 0.4));
    },
    master(ctx, out, t) {                        // la pièce posée, puis une cloche de laiton qui s'éteint lentement
        _hit(ctx, out, t, { level: 0.4 });
        _bell(ctx, out, t + 0.09, 1046, 0.07);
        _bell(ctx, out, t + 0.25, 1568, 0.035);
    }
};

// Cloche : trois partiels inharmoniques (laiton), le plus aigu s'éteint le premier.
function _bell(ctx, out, t, freq, peak) {
    [[1, 1, 1.6], [2.76, 0.32, 0.8], [5.4, 0.12, 0.4]].forEach(([r, a, d]) =>
        _tone(ctx, out, t, { from: freq * r, to: freq * r, peak: peak * a, dur: d, attack: 0.006 }));
}

// Petite pièce autour du son : bruit filtré qui s'éteint en un tiers de seconde.
function _roomImpulse(ctx) {
    const n = Math.floor(ctx.sampleRate * 0.34), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
        last += 0.28 * ((Math.random() * 2 - 1) - last);
        d[i] = last * Math.exp(-i / (ctx.sampleRate * 0.055));
    }
    return buf;
}

// Sortie commune, construite une fois par contexte : volume (courbe douce), aigus coupés, pièce, limiteur.
// Renvoie le nœud où brancher un son.
const _OUT_LEVEL = 0.66, _ROOM_LEVEL = 0.13;
let _bus = null;
function _soundOut(ctx, volume) {
    if (!_bus || _bus.ctx !== ctx) {
        const master = ctx.createGain(), soft = ctx.createBiquadFilter(), lim = ctx.createDynamicsCompressor();
        const room = ctx.createConvolver(), wet = ctx.createGain();
        soft.type = 'lowpass'; soft.frequency.value = 2200; soft.Q.value = 0.5;
        lim.threshold.value = -12; lim.knee.value = 10; lim.ratio.value = 8; lim.attack.value = 0.002; lim.release.value = 0.12;
        room.buffer = _roomImpulse(ctx); wet.gain.value = _ROOM_LEVEL;
        master.connect(soft); soft.connect(lim); lim.connect(ctx.destination);
        soft.connect(room); room.connect(wet); wet.connect(lim);
        _bus = { ctx, master };
    }
    _bus.master.gain.value = Math.pow(volume, 1.6) * 1.7 * _OUT_LEVEL;
    return _bus.master;
}

// Chaque son peut être coupé séparément (Paramètres › Sons et vibrations).
const _SOUND_PREF = { move: 'sMove', opp: 'sMove', capture: 'sCapture', error: 'sError', success: 'sSuccess', master: 'sSuccess', check: 'sMove', castle: 'sMove', promote: 'sMove', mate: 'sMove', end: 'sSuccess' };

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
// opponent : le coup vient du camp adverse (voir playBoardMoveSound).
function playMoveSound(from, to, promo, opponent) {
    const p = board[from];
    const capture = !!board[to] || (!!p && p.toUpperCase() === 'P' && (from % 8) !== (to % 8));
    playSound(moveSoundKind(_moveSan(from, to, promo), capture, opponent));
    announceMove(from, to, capture, promo);
}

// SAN du coup à venir dans la position affichée ('' s'il est impossible à lire).
function _moveSan(from, to, promo) {
    const p = board[from] || '', last = p.toUpperCase() === 'P' && (to < 8 || to >= 56);
    try { return Chess.san(Chess.snapshot(), squareToName(from) + squareToName(to) + (promo || (last ? 'q' : ''))); } catch (e) { return ''; }
}

// Le son d'un coup, du plus marquant au plus ordinaire.
function moveSoundKind(san, capture, opponent) {
    if (/#/.test(san)) return 'mate';
    if (/\+/.test(san)) return 'check';
    if (/=/.test(san)) return 'promote';
    if (/^O-O/.test(san)) return 'castle';
    if (capture) return 'capture';
    return opponent ? 'opp' : 'move';
}

// ─── ANNONCE DES COUPS (Paramètres › Accessibilité) ──────────────────────────
// appSettings.announce : 'off' | 'sr' (région aria-live, lue par VoiceOver / TalkBack) | 'voice' (synthèse
// vocale de l'appareil, Web Speech API). Phrase en toutes lettres : « Blancs : Cavalier prend f3, échec ».
const _SPOKEN = { K: 'Roi', Q: 'Dame', R: 'Tour', B: 'Fou', N: 'Cavalier', P: 'Pion' };

// Phrase d'un coup en notation anglaise (SAN) : roque, prise, promotion, échec et mat compris.
function spokenMove(san, white) {
    const t = x => (typeof I18n !== 'undefined' ? I18n.t(x) : x);          // la voix ne passe pas par la page
    const who = t(white ? 'Blancs' : 'Noirs'), end = t(/#$/.test(san) ? ', échec et mat' : /\+$/.test(san) ? ', échec' : '');
    const s = san.replace(/[+#!?]+$/, '');
    if (/^O-O-O/.test(s)) return t(`${who} : grand roque${end}`);
    if (/^O-O/.test(s)) return t(`${who} : petit roque${end}`);
    const m = s.match(/^([KQRBN])?([a-h]?[1-8]?)(x)?([a-h][1-8])(?:=([QRBN]))?/);
    if (!m) return `${who} : ${san}`;
    const piece = t(_SPOKEN[m[1] || 'P']), promo = m[5] ? t(`, promotion en ${_SPOKEN[m[5]]}`) : '';
    return `${who} : ${piece} ${m[3] ? t('prend') + ' ' : ''}${m[4]}${promo}${end}`;
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
        const code = typeof I18n !== 'undefined' ? I18n.locale() : 'fr-FR', base = code.split('-')[0].toLowerCase();
        voice = all.find(v => v.lang.toLowerCase() === code.toLowerCase() && v.localService) || all.find(v => v.lang.toLowerCase().startsWith(base)) || null;
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
            u.lang = (typeof I18n !== 'undefined' ? I18n.locale() : 'fr-FR'); u.rate = 1.05;
            if (voice) u.voice = voice;
            current = u;
            u.onend = u.onerror = () => { if (current === u) current = null; };
            s.speak(u);
        }
    };
})();
