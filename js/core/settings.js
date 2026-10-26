/**
 * core/settings.js
 * ──────────────────────────────────────────────────────────────────────────
 * Préférences de l'application, persistées via dataStore. L'interface est dans settingsUI.js.
 *
 *   chessTrainer_settings  LOCAL à l'appareil : sons (et chaque son), volume, vibrations, accessibilité
 *   chessTrainer_prefs     SYNCHRONISÉ avec le compte : échiquier, pièces, flèches, jeu, révisions, notation,
 *                          profil… Chaque champ est daté : { boardTheme: { v, at }, … } ; entre deux appareils,
 *                          le choix le plus récent l'emporte (syncModel.js). Les clés « dev:<id> » décrivent
 *                          les appareils du compte (nom, dernière activité, déconnexion demandée).
 *   chessTrainer_mode      LOCAL : mode 'dark' | 'light' | 'system' (remplace chessTrainer_theme, aux valeurs inversées)
 * Option « syncLooks » : le mode et les sons sont aussi recopiés dans les préférences synchronisées.
 */

'use strict';

const SETTINGS_KEY    = 'chessTrainer_settings';
const PREFS_KEY       = 'chessTrainer_prefs';
const BOARD_THEMES    = ['classic', 'leather', 'wood', 'ice', 'night', 'violet', 'walnut', 'stone', 'hache'];
const PIECE_SET_IDS   = ['merida', 'maestro', 'staunty', 'chrome', 'chessnut', 'minimal-warmth', 'fantasy', 'kiwen-suwi', 'blindfold'];   // doit correspondre aux clés de PIECE_SETS (pieces.js)
const DEFAULT_PIECE_SET = 'maestro';
const ARROW_STYLE_IDS = ['plume', 'contour', 'pointille'];          // cf. annotations.js
const ARROW_STYLE_LABELS = { plume: 'Plume', contour: 'Contour', pointille: 'Pointillé' };
const AVATAR_GLYPHS   = ['initial', 'k', 'q', 'r', 'b', 'n'];
const AVATAR_COLORS   = ['sapin', 'noyer', 'nuit', 'ardoise', 'prune', 'ivoire'];

const _oneOf = list => v => list.includes(v);
const _bool  = v => typeof v === 'boolean';
const _text  = max => v => typeof v === 'string' && v.length <= max;

// Préférences synchronisées : valeurs admises et valeur par défaut.
const SYNCED_PREFS = {
    boardTheme: { ok: _oneOf(BOARD_THEMES),    def: 'walnut' },
    pieceSet:   { ok: _oneOf(PIECE_SET_IDS),   def: DEFAULT_PIECE_SET },
    arrowStyle: { ok: _oneOf(ARROW_STYLE_IDS), def: ARROW_STYLE_IDS[0] },
    // Échiquier
    coords:     { ok: _bool, def: true },
    coordPos:   { ok: _oneOf(['in', 'out']), def: 'in' },
    lastMove:   { ok: _bool, def: true },
    legalDots:  { ok: _bool, def: true },
    anim:       { ok: _oneOf(['off', 'fast', 'normal']), def: 'normal' },
    // Jeu
    moveInput:  { ok: _oneOf(['both', 'drag', 'click']), def: 'both' },
    autoQueen:  { ok: _bool, def: false },
    oppDelay:   { ok: _oneOf(['instant', 'normal', 'calm']), def: 'normal' },
    autoFlip:   { ok: _bool, def: true },
    hintAfter:  { ok: _oneOf([0, 1, 2, 3]), def: 0 },
    // Révisions et notation
    dailyGoal:  { ok: v => Number.isInteger(v) && v >= 5 && v <= 50, def: 10 },
    rhythm:     { ok: _oneOf(['soft', 'std', 'intense']), def: 'std' },
    freqWeight: { ok: _bool, def: true },
    notation:   { ok: _oneOf(['fr', 'en', 'fig']), def: 'fr' },
    backupReminder: { ok: _oneOf(['never', 'weekly', 'monthly']), def: 'weekly' },
    // Mode libre de l'Entraînement (training.js)
    freeMaxPlies:  { ok: v => Number.isInteger(v) && v >= 0 && v <= 60, def: 0 },       // 0 : toute profondeur
    freeSeqLen:    { ok: v => Number.isInteger(v) && v >= 1 && v <= 999, def: 1 },      // 999 : toute la variante
    freeFromStart: { ok: _oneOf([0, 1]), def: 0 },
    // Moteur d'analyse (engine.js, mode Analyse)
    engineLines:   { ok: v => Number.isInteger(v) && v >= 1 && v <= 5, def: 3 },        // MultiPV
    engineDepth:   { ok: _oneOf([0, 20, 25, 30, 40]), def: 30 },                         // 0 : sans limite
    engineTime:    { ok: _oneOf([0, 5, 10, 30]), def: 0 },                               // secondes par position ; 0 : sans limite
    engineEval:    { ok: _oneOf(['cp', 'wdl']), def: 'cp' },                             // pions ou chances de gain
    engineArrows:  { ok: _oneOf([0, 1, 5]), def: 1 },                                    // flèches des meilleurs coups (5 : toutes les lignes)
    engineAuto:    { ok: _bool, def: true },                                             // calcul lancé à l'ouverture de l'Analyse
    cloudEval:     { ok: _bool, def: true },                                             // évaluation déjà calculée par Lichess
    // Profil
    pseudo:      { ok: _text(24), def: '' },
    avatarGlyph: { ok: _oneOf(AVATAR_GLYPHS), def: 'initial' },
    avatarColor: { ok: _oneOf(AVATAR_COLORS), def: 'sapin' },
    elo:         { ok: v => v === '' || (/^\d{3,4}$/.test(v)), def: '' },
    lichessUser: { ok: _text(40), def: '' },
    chesscomUser:{ ok: _text(40), def: '' },
    // Synchroniser aussi le mode clair / sombre et les sons
    syncLooks:   { ok: _bool, def: false },
    looksTheme:  { ok: _oneOf(['light', 'dark', 'system']), def: 'system' },
    looksSound:  { ok: _bool, def: true },
    looksVolume: { ok: v => typeof v === 'number' && v >= 0 && v <= 1, def: 0.6 }
};

// Préférences propres à l'appareil (chessTrainer_settings) : valeurs admises et valeur par défaut.
const LOCAL_PREFS = {
    sound:    { ok: _bool, def: true },
    volume:   { ok: v => typeof v === 'number' && v >= 0 && v <= 1, def: 0.6 },
    sMove:    { ok: _bool, def: true },
    sCapture: { ok: _bool, def: true },
    sError:   { ok: _bool, def: true },
    sSuccess: { ok: _bool, def: true },
    haptic:   { ok: _bool, def: true },
    motion:   { ok: _oneOf(['system', 'reduced', 'full']), def: 'system' },
    textSize: { ok: _oneOf(['s', 'm', 'l']), def: 'm' },
    contrast: { ok: _bool, def: false },
    announce: { ok: _bool, def: false },
    engineThreads: { ok: v => Number.isInteger(v) && v >= 0 && v <= 64, def: 0 },       // 0 : automatique (moitié des cœurs)
    engineHash:    { ok: _oneOf([16, 32, 64, 128, 256, 512]), def: 64 }                 // Mo
};

function _readPrefs() {
    const p = dataStore.getJSON(PREFS_KEY, null);
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

// Valeurs des préférences synchronisées. Repli sur l'ancien emplacement (chessTrainer_settings)
// tant qu'une préférence n'a jamais été synchronisée.
function _syncedValues(legacy) {
    const p = _readPrefs(), out = {};
    Object.entries(SYNCED_PREFS).forEach(([name, d]) => {
        const v = p[name] && p[name].v;
        out[name] = d.ok(v) ? v : d.ok(legacy[name]) ? legacy[name] : d.def;
    });
    return out;
}

function loadSettings() {
    const s = dataStore.getJSON(SETTINGS_KEY, null) || {}, out = {};
    if (typeof s.volume !== 'number' && Number.isFinite(Number(s.volume))) s.volume = Number(s.volume);
    if (typeof s.volume === 'number') s.volume = Math.min(1, Math.max(0, s.volume));
    Object.entries(LOCAL_PREFS).forEach(([name, d]) => { out[name] = d.ok(s[name]) ? s[name] : d.def; });
    return Object.assign(out, _syncedValues(s));
}

// Défauts Noyer + Maestro (octobre 2026) réservés aux nouvelles installations : une installation qui a déjà
// des données et n'a jamais choisi d'échiquier ou de pièces garde les anciens défauts (Vert classique + Merida),
// écrits explicitement et datés de 0 pour qu'un choix déjà présent sur le compte l'emporte. Une seule fois.
const LOOKS_DEFAULTS_KEY = 'chessTrainer_looksDefaults';
(function keepOldLookDefaults() {
    if (dataStore.get(LOOKS_DEFAULTS_KEY) !== null) return;
    dataStore.set(LOOKS_DEFAULTS_KEY, '2026-10');
    const existing = ['chessTrainer_repertoires', SETTINGS_KEY, PREFS_KEY].some(k => dataStore.get(k) !== null);
    if (!existing) return;
    const s = dataStore.getJSON(SETTINGS_KEY, null) || {}, p = _readPrefs();
    const old = { boardTheme: 'classic', pieceSet: 'merida' };
    let changed = false;
    Object.keys(old).forEach(name => {
        if (SYNCED_PREFS[name].ok(p[name] && p[name].v) || SYNCED_PREFS[name].ok(s[name])) return;   // déjà choisi
        p[name] = { v: old[name], at: 0 };
        changed = true;
    });
    if (changed) dataStore.setJSON(PREFS_KEY, p);
})();

// Options du mode libre : autrefois dans chessTrainer.trainingSettings (propre à l'appareil). Elles deviennent
// des préférences synchronisées, datées de 0 pour qu'un choix déjà présent sur le compte l'emporte. Une seule fois.
(function migrateFreeTraining() {
    const OLD = 'chessTrainer.trainingSettings', old = dataStore.getJSON(OLD, null);
    if (dataStore.get(OLD) === null) return;
    const p = _readPrefs(), map = { maxPlies: 'freeMaxPlies', seqLen: 'freeSeqLen', fromStart: 'freeFromStart' };
    let changed = false;
    Object.keys(map).forEach(k => {
        const name = map[k], v = old && old[k];
        if (p[name] || !SYNCED_PREFS[name].ok(v) || v === SYNCED_PREFS[name].def) return;
        p[name] = { v, at: 0 };
        changed = true;
    });
    if (changed) dataStore.setJSON(PREFS_KEY, p);
    dataStore.remove(OLD);
})();

let appSettings = loadSettings();
let _prefsSeen  = _syncedValues(dataStore.getJSON(SETTINGS_KEY, null) || {});   // dernières valeurs lues ou écrites

// Première fois avec ce système : les choix déjà faits sur cet appareil deviennent des préférences
// synchronisées, datées de 0 pour qu'un choix déjà présent sur le compte l'emporte.
(function migratePrefs() {
    if (dataStore.get(PREFS_KEY) !== null) return;
    const s = dataStore.getJSON(SETTINGS_KEY, null) || {}, p = {};
    Object.keys(SYNCED_PREFS).forEach(name => { if (SYNCED_PREFS[name].ok(s[name])) p[name] = { v: s[name], at: 0 }; });
    if (Object.keys(p).length) dataStore.setJSON(PREFS_KEY, p);
})();

function saveSettings() {
    const local = {};
    Object.keys(LOCAL_PREFS).forEach(name => { local[name] = appSettings[name]; });
    dataStore.setJSON(SETTINGS_KEY, local);
    // Seules les préférences réellement modifiées ici sont datées et écrites : une valeur reçue d'un
    // autre appareil entre-temps n'est jamais écrasée par une copie ancienne.
    const p = _readPrefs();
    let changed = false;
    Object.keys(SYNCED_PREFS).forEach(name => {
        if (appSettings[name] === _prefsSeen[name]) return;
        p[name] = { v: appSettings[name], at: Date.now() };
        _prefsSeen[name] = appSettings[name];
        changed = true;
    });
    if (changed) dataStore.setJSON(PREFS_KEY, p);
}

// Appelé par le moteur de synchro juste après avoir écrit des préférences reçues d'un autre appareil.
// Renvoie true si une préférence a changé (l'affichage doit alors être mis à jour).
function reloadSyncedPrefs() {
    const fresh = _syncedValues(dataStore.getJSON(SETTINGS_KEY, null) || {});
    let changed = false;
    Object.keys(SYNCED_PREFS).forEach(name => {
        if (appSettings[name] !== fresh[name]) { appSettings[name] = fresh[name]; changed = true; }
    });
    _prefsSeen = fresh;
    if (_applyLooksFromPrefs()) changed = true;
    return changed;
}

// ─── Mode clair / sombre / système ──────────────────────────────────────────
// chessTrainer_mode : 'dark' (Nocturne, par défaut), 'light' (Papier) ou 'system' (suit l'appareil).
// data-theme sur <html> vaut 'dark' ou 'light'. L'ancienne clé chessTrainer_theme stockait les valeurs
// inversées ('light' = sombre) : elle est convertie une fois puis supprimée (aussi lue par index.html
// avant le premier rendu tant que la conversion n'a pas eu lieu).
const THEME_MODES = ['dark', 'light', 'system'];
const _THEME_KEY  = typeof THEME_STORAGE_KEY !== 'undefined' ? THEME_STORAGE_KEY : 'chessTrainer_mode';
const LEGACY_THEME_KEY = 'chessTrainer_theme';

(function migrateThemeKey() {
    const old = dataStore.get(LEGACY_THEME_KEY);
    if (old === null) return;
    if (dataStore.get(_THEME_KEY) === null) dataStore.set(_THEME_KEY, { light: 'dark', dark: 'light', system: 'system' }[old] || 'dark');
    dataStore.remove(LEGACY_THEME_KEY);
})();

function themeMode() {
    const v = dataStore.get(_THEME_KEY);
    return THEME_MODES.includes(v) ? v : 'dark';
}

function applyThemeMode() {
    const m = themeMode();
    const dark = m === 'dark' || (m === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

function setThemeMode(mode) {
    if (!THEME_MODES.includes(mode)) return;
    dataStore.set(_THEME_KEY, mode);
    applyThemeMode();
    _copyLooksToPrefs();
}

if (typeof matchMedia === 'function') {
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeMode() === 'system') applyThemeMode(); }); } catch (e) { /* navigateur ancien : thème système lu au chargement seulement */ }
}

// Recopie mode et sons dans les préférences synchronisées (option « syncLooks »).
function _copyLooksToPrefs() {
    if (!appSettings.syncLooks) return;
    appSettings.looksTheme  = themeMode();
    appSettings.looksSound  = appSettings.sound;
    appSettings.looksVolume = Math.round(appSettings.volume * 100) / 100;
    saveSettings();
}

// Applique le mode et les sons reçus d'un autre appareil (option « syncLooks »). Renvoie true si changé.
function _applyLooksFromPrefs() {
    if (!appSettings.syncLooks) return false;
    let changed = false;
    if (themeMode() !== appSettings.looksTheme) { dataStore.set(_THEME_KEY, appSettings.looksTheme); applyThemeMode(); changed = true; }
    if (appSettings.sound !== appSettings.looksSound || appSettings.volume !== appSettings.looksVolume) {
        appSettings.sound = appSettings.looksSound;
        appSettings.volume = appSettings.looksVolume;
        const local = dataStore.getJSON(SETTINGS_KEY, null) || {};
        dataStore.setJSON(SETTINGS_KEY, Object.assign(local, { sound: appSettings.sound, volume: appSettings.volume }));
        changed = true;
    }
    return changed;
}

// ─── Affichage : attributs sur <html> lus par le CSS (css/settings.css) ─────
function applyBoardTheme() {
    document.documentElement.setAttribute('data-board', appSettings.boardTheme);
}

function applyDisplayPrefs() {
    const d = document.documentElement, s = appSettings;
    d.setAttribute('data-coords', s.coords ? s.coordPos : 'off');
    d.setAttribute('data-legal', s.legalDots ? 'on' : 'off');
    d.setAttribute('data-text', s.textSize);
    d.setAttribute('data-contrast', s.contrast ? 'on' : 'off');
    d.setAttribute('data-motion', s.motion);
}

// Animations réduites : réglage de l'appli, sinon celui de l'appareil.
function prefersReducedMotion() {
    if (appSettings.motion === 'reduced') return true;
    if (appSettings.motion === 'full') return false;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Délai de réponse de l'adversaire : facteur appliqué aux temporisations (entraînement, finales).
function opponentDelay(ms) {
    return { instant: Math.min(ms, 120), normal: ms, calm: Math.round(ms * 1.8) }[appSettings.oppDelay] || ms;
}

// ─── Appareils du compte (clés « dev:<id> » des préférences synchronisées) ──
const DEVICE_PREFIX   = 'dev:';
const DEVICE_TOUCH_MS = 3600000;          // une écriture par heure au plus

function deviceId() {
    let id = dataStore.get('chessTrainer_deviceId');
    if (!id) { id = 'd' + Math.random().toString(36).slice(2, 10); dataStore.set('chessTrainer_deviceId', id); }
    return id;
}

function deviceName() {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
             : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Appareil';
    const standalone = typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
    const app = standalone ? 'application installée'
              : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navigateur';
    return `${os} · ${app}`;
}

function listDevices() {
    const p = _readPrefs(), me = deviceId();
    return Object.keys(p).filter(k => k.startsWith(DEVICE_PREFIX) && p[k] && p[k].v && typeof p[k].v === 'object')
        .map(k => ({ id: k.slice(DEVICE_PREFIX.length), ...p[k].v, me: k.slice(DEVICE_PREFIX.length) === me }))
        .filter(d => !d.removed)
        .sort((a, b) => (b.me - a.me) || ((b.seen || 0) - (a.seen || 0)));
}

function _writeDevice(id, value) {
    const p = _readPrefs();
    p[DEVICE_PREFIX + id] = { v: value, at: Date.now() };
    dataStore.setJSON(PREFS_KEY, p);
}

// Note l'activité de cet appareil (au plus une fois par heure, sauf `force` : à la connexion).
function touchDevice(force) {
    const id = deviceId(), cur = (_readPrefs()[DEVICE_PREFIX + id] || {}).v || {};
    const name = deviceName();
    if (!force && !cur.revoked && cur.name === name && Date.now() - (cur.seen || 0) < DEVICE_TOUCH_MS) return;
    _writeDevice(id, { name, seen: Date.now(), revoked: false });
}

// Demande à un autre appareil de se déconnecter (il le fera à sa prochaine synchronisation).
function revokeDevice(id) {
    const cur = (_readPrefs()[DEVICE_PREFIX + id] || {}).v;
    if (!cur || id === deviceId()) return;
    _writeDevice(id, Object.assign({}, cur, { revoked: true }));
}

function isThisDeviceRevoked() {
    const cur = (_readPrefs()[DEVICE_PREFIX + deviceId()] || {}).v;
    return !!(cur && cur.revoked);
}

applyThemeMode();
applyBoardTheme();
applyDisplayPrefs();
