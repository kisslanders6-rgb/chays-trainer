/**
 * core/settings.js
 * ──────────────────────────────────────────────────────────────────────────
 * Préférences de l'application (sons, volume, thème de l'échiquier, style des
 * pièces), persistées dans localStorage. L'interface est dans app.js.
 */

'use strict';

const SETTINGS_KEY    = 'chessTrainer_settings';
const BOARD_THEMES    = ['classic', 'leather', 'wood', 'ice', 'night', 'violet', 'walnut', 'stone', 'hache'];
const PIECE_SET_IDS   = ['merida', 'maestro', 'staunty', 'chrome', 'chessnut', 'minimal-warmth', 'fantasy', 'kiwen-suwi', 'blindfold'];   // doit correspondre aux clés de PIECE_SETS (pieces.js)
const DEFAULT_PIECE_SET = 'merida';

function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { s = {}; }
    const vol = Number(s.volume);
    return {
        sound:      s.sound !== false,                                   // activé par défaut
        volume:     Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.6,
        boardTheme: BOARD_THEMES.includes(s.boardTheme) ? s.boardTheme : 'classic',
        pieceSet:   PIECE_SET_IDS.includes(s.pieceSet) ? s.pieceSet : DEFAULT_PIECE_SET
    };
}

let appSettings = loadSettings();

function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings)); } catch (e) {}
}

function applyBoardTheme() {
    document.documentElement.setAttribute('data-board', appSettings.boardTheme);
}

applyBoardTheme();
