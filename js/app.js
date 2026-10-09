/**
 * app.js
 * ──────────────────────────────────────────────────────────────────────────
 * Point d'entrée de l'application :
 *   - Initialisation au chargement
 *   - Navigation (accueil ↔ jeu, onglets)
 *   - Gestion du thème (dark / light)
 *   - Rendu de la liste des répertoires
 *   - Démarrage et retour à l'accueil
 */

'use strict';

// ─── ÉTAT GLOBAL DE LA SESSION ────────────────────────────────────────────────

let playerColor = 'w';
let gameMode    = 'play';   // 'play' | 'preview' | 'training'

// ─── THÈME ────────────────────────────────────────────────────────────────────

function loadTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_STORAGE_KEY); } catch (e) {}
    const theme = (saved === 'light' || saved === 'dark') ? saved : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch (e) {}
}

// ─── AIDE (« Comment ça marche ? ») ───────────────────────────────────────────

function showHelp()  { document.getElementById('help-overlay').classList.remove('hidden'); }
function closeHelp() { document.getElementById('help-overlay').classList.add('hidden'); }

(function initHelpDismiss() {
    const overlay = document.getElementById('help-overlay');
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeHelp(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeHelp();
    });
})();

// ─── RAPPEL DE SAUVEGARDE (toast) ─────────────────────────────────────────────

let _toastTimer = null;

function showBackupToast() {
    document.getElementById('backup-toast').classList.remove('hidden');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideBackupToast, 20000);
}

function hideBackupToast() {
    clearTimeout(_toastTimer);
    document.getElementById('backup-toast').classList.add('hidden');
}

function exportFromToast() { exportDB(); }          // exportDB() remet le compteur à zéro et ferme le toast

// ─── PARAMÈTRES (sons, volume, thème de l'échiquier) ──────────────────────────

function syncSettingsUI() {
    document.getElementById('set-sound').checked = appSettings.sound;
    const slider = document.getElementById('set-volume');
    slider.value    = Math.round(appSettings.volume * 100);
    slider.disabled = !appSettings.sound;
    document.getElementById('set-volume-val').textContent = slider.value + ' %';
    document.querySelectorAll('.theme-opt').forEach(b =>
        b.classList.toggle('active', b.dataset.board === appSettings.boardTheme));
}

function showSettings()  { syncSettingsUI(); document.getElementById('settings-overlay').classList.remove('hidden'); }
function closeSettings() { document.getElementById('settings-overlay').classList.add('hidden'); }

function onSoundToggle(on) {
    appSettings.sound = on;
    saveSettings();
    syncSettingsUI();
    if (on) playSound('move');                       // aperçu
}

function onVolumeInput(v) {
    appSettings.volume = Number(v) / 100;
    document.getElementById('set-volume-val').textContent = v + ' %';
    saveSettings();
}

function onVolumeCommit() { playSound('move'); }     // aperçu au relâchement du curseur

function setBoardTheme(theme) {
    if (!BOARD_THEMES.includes(theme)) return;
    appSettings.boardTheme = theme;
    saveSettings();
    applyBoardTheme();
    syncSettingsUI();
}

(function initSettingsDismiss() {
    const overlay = document.getElementById('settings-overlay');
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeSettings(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeSettings();
    });
})();

// ─── NAVIGATION : ONGLETS D'ACCUEIL ──────────────────────────────────────────

function switchHomeTab(tab) {
    ['play', 'stats', 'training', 'endgame'].forEach(t => {
        const tabEl = document.getElementById('home-tab-' + t);
        const navEl = document.getElementById('nav-tab-' + t);
        if (tabEl) tabEl.classList.toggle('hidden', t !== tab);
        if (navEl) navEl.classList.toggle('active', t === tab);
    });
    if (tab === 'stats')    initStats();
    if (tab === 'training') initTraining();
}

// ─── RÉPERTOIRES : AFFICHAGE ET SÉLECTION ────────────────────────────────────

function renderRepertoireList() {
    const list = loadRepertoireList();
    const html = list.map(name => `
    <div class="repertoire-chip ${name === currentRepertoire ? 'active' : ''}"
         onclick="selectRepertoire('${name.replace(/'/g, "\\'")}')">
      ${name}
    </div>
  `).join('') + `<div class="repertoire-chip repertoire-chip-new" onclick="createRepertoirePrompt()">+ Nouveau</div>`;
    document.querySelectorAll('.repertoire-list').forEach(c => { c.innerHTML = html; });
}

function selectRepertoire(name) {
    currentRepertoire = name;
    renderRepertoireList();
    const pill = document.getElementById('repertoire-pill');
    if (pill) pill.textContent = currentRepertoire;
    initStats();
    initTraining();
}

// ─── DÉMARRAGE D'UNE PARTIE ───────────────────────────────────────────────────

function applyModeUI() {
    document.querySelectorAll('[data-modes]').forEach(el => {
        el.style.display = el.dataset.modes.split(',').includes(gameMode) ? '' : 'none';
    });
    if (typeof _applySideTab === 'function') _applySideTab();     // l'arbre n'est disponible qu'en mode Jouer
}

// Affiche l'écran de jeu (commun aux modes jouer / aperçu / entraînement).
function showGameScreen(color) {
    boardFlipped = color === 'b';

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('topnav-tabs-setup').style.display = 'none';
    document.getElementById('topnav-tabs-game').style.display  = '';

    const gs = document.getElementById('game-screen');
    gs.style.display = 'flex';
    gs.classList.remove('hidden');

    const badge = document.getElementById('color-badge');
    badge.textContent = color === 'w' ? '♔ BLANCS' : '♚ NOIRS';
    badge.className   = 'color-badge ' + (color === 'w' ? 'badge-white' : 'badge-black');

    const pill = document.getElementById('repertoire-pill');
    if (pill) pill.textContent = currentRepertoire;

    applyModeUI();
}

function startGame(color) {
    playerColor = color;
    gameMode    = 'play';
    loadDB();
    showGameScreen(color);
    resetGame();
}

// ─── RETOUR À L'ACCUEIL ───────────────────────────────────────────────────────

function goHome(tab) {
    if (typeof stopTraining === 'function') stopTraining();
    gameMode = 'play';
    applyModeUI();
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('admin-overlay').classList.add('hidden');
    document.getElementById('promo-overlay').classList.add('hidden');
    document.getElementById('confirm-overlay').classList.add('hidden');
    document.getElementById('setup-screen').style.display = '';
    document.getElementById('setup-screen').classList.remove('hidden');
    document.getElementById('topnav-tabs-setup').style.display = '';
    document.getElementById('topnav-tabs-game').style.display  = 'none';
    switchHomeTab(typeof tab === 'string' ? tab : 'play');
    renderRepertoireList();
}

// ─── INITIALISATION ───────────────────────────────────────────────────────────

(function init() {
    document.getElementById('game-screen').style.display = 'none';
    loadTheme();
    renderRepertoireList();
})();
