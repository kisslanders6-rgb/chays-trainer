/**
 * core/settings.js
 * ──────────────────────────────────────────────────────────────────────────
 * Préférences de l'application (sons, volume, thème de l'échiquier),
 * persistées dans localStorage. L'interface est dans app.js.
 */

'use strict';

const SETTINGS_KEY  = 'chessTrainer_settings';
const BOARD_THEMES  = ['classic', 'wood', 'night'];

function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { s = {}; }
    const vol = Number(s.volume);
    return {
        sound:      s.sound !== false,                                   // activé par défaut
        volume:     Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.6,
        boardTheme: BOARD_THEMES.includes(s.boardTheme) ? s.boardTheme : 'classic'
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
