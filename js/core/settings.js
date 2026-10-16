/**
 * core/settings.js
 * ──────────────────────────────────────────────────────────────────────────
 * Préférences de l'application, persistées via dataStore. L'interface est dans app.js.
 *
 *   chessTrainer_settings  LOCAL à l'appareil : sons, volume
 *   chessTrainer_prefs     SYNCHRONISÉ avec le compte : thème de l'échiquier, style des pièces,
 *                          style des flèches. Chaque champ est daté : { boardTheme: { v, at }, … } ;
 *                          entre deux appareils, le choix le plus récent l'emporte (syncModel.js).
 * Le mode clair / sombre reste propre à chaque appareil (chessTrainer_theme).
 */

'use strict';

const SETTINGS_KEY    = 'chessTrainer_settings';
const PREFS_KEY       = 'chessTrainer_prefs';
const BOARD_THEMES    = ['classic', 'leather', 'wood', 'ice', 'night', 'violet', 'walnut', 'stone', 'hache'];
const PIECE_SET_IDS   = ['merida', 'maestro', 'staunty', 'chrome', 'chessnut', 'minimal-warmth', 'fantasy', 'kiwen-suwi', 'blindfold'];   // doit correspondre aux clés de PIECE_SETS (pieces.js)
const DEFAULT_PIECE_SET = 'merida';
const ARROW_STYLE_IDS = ['plume', 'contour', 'pointille'];          // cf. annotations.js
const ARROW_STYLE_LABELS = { plume: 'Plume', contour: 'Contour', pointille: 'Pointillé' };

// Préférences synchronisées : valeurs admises et valeur par défaut.
const SYNCED_PREFS = {
    boardTheme: { ok: v => BOARD_THEMES.includes(v),    def: 'classic' },
    pieceSet:   { ok: v => PIECE_SET_IDS.includes(v),   def: DEFAULT_PIECE_SET },
    arrowStyle: { ok: v => ARROW_STYLE_IDS.includes(v), def: ARROW_STYLE_IDS[0] }
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
    const s = dataStore.getJSON(SETTINGS_KEY, null) || {};
    const vol = Number(s.volume);
    return Object.assign({
        sound:  s.sound !== false,                                       // activé par défaut
        volume: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.6
    }, _syncedValues(s));
}

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
    dataStore.setJSON(SETTINGS_KEY, { sound: appSettings.sound, volume: appSettings.volume });
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
    return changed;
}

function applyBoardTheme() {
    document.documentElement.setAttribute('data-board', appSettings.boardTheme);
}

applyBoardTheme();
