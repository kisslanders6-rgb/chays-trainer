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
        document.querySelectorAll('.theme-opt[data-board]').forEach(b =>
        b.classList.toggle('active', b.dataset.board === appSettings.boardTheme));
    document.querySelectorAll('.piece-opt').forEach(b =>
        b.classList.toggle('active', b.dataset.piece === appSettings.pieceSet));
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

// Cartes de sélection du style de pièces (générées depuis le registre PIECE_SETS).
function renderPieceOptions() {
    const box = document.getElementById('piece-options');
    if (!box) return;
    box.innerHTML = PIECE_SET_IDS.map(id => {
        const s = PIECE_SETS[id];
        return `<button class="theme-opt piece-opt" data-piece="${id}" onclick="setPieceStyle('${id}')">` +
               `<span class="piece-preview"><span>${s.svg.K}</span><span>${s.svg.n}</span></span>${s.label}</button>`;
    }).join('');
}

function setPieceStyle(id) {
    if (!PIECE_SET_IDS.includes(id)) return;
    appSettings.pieceSet = id;
    saveSettings();
    applyPieceSet();
    syncSettingsUI();
    refreshPieces();                       // bascule instantanée sur le plateau
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
    const build = manage => list.map(name => {
        const esc = name.replace(/'/g, "\\'");
        const del = (manage && name !== DEFAULT_REPERTOIRE)
            ? `<button class="chip-del" title="Supprimer ce répertoire (corbeille 30 jours)" aria-label="Supprimer" onclick="event.stopPropagation(); deleteRepertoirePrompt('${esc}')">🗑</button>` : '';
        return `<div class="repertoire-chip ${name === currentRepertoire ? 'active' : ''}" onclick="selectRepertoire('${esc}')">${name}${del}</div>`;
    }).join('') + `<div class="repertoire-chip repertoire-chip-new" onclick="createRepertoirePrompt()">+ Nouveau</div>`;
    const plain = build(false), managed = build(true);        // la corbeille n'apparaît que dans l'onglet « Jouer »
    document.querySelectorAll('.repertoire-list').forEach(c => { c.innerHTML = c.dataset.manage ? managed : plain; });
}

// Suppression protégée : « Général » est intouchable, confirmation, puis corbeille (30 jours).
function deleteRepertoirePrompt(name) {
    if (name === DEFAULT_REPERTOIRE) { alert('Le répertoire par défaut ne peut pas être supprimé.'); return; }
    const nW = Object.keys(readDBFor(name, 'w')).length;
    const nB = Object.keys(readDBFor(name, 'b')).length;
    askConfirm(`Supprimer le répertoire « ${name} » (${nW} coup(s) Blancs, ${nB} coup(s) Noirs) ? Il sera placé dans la corbeille et restera restaurable pendant 30 jours.`, () => {
        if (!deleteRepertoire(name)) return;
        if (currentRepertoire === name) selectRepertoire(DEFAULT_REPERTOIRE);
        else { renderRepertoireList(); initStats(); initTraining(); }
    });
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
    purgeExpiredTrash();                    // corbeille : purge des éléments de plus de 30 jours
    renderRepertoireList();
    updateTrashBadges();
    loadTheme();
    renderPieceOptions();
})();
