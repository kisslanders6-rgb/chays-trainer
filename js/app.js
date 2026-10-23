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
    const saved = dataStore.get(THEME_STORAGE_KEY);
    const theme = (saved === 'light' || saved === 'dark') ? saved : 'light';      // par défaut : sombre (« Nocturne »)
    document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    dataStore.set(THEME_STORAGE_KEY, next);
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

// ─── SAISIE DE TEXTE (remplace prompt()) ──────────────────────────────────────
// askText({ title, value?, placeholder?, ok?, validate?(texte) → message d'erreur | '' }, onOk(texte))

function askText(opts, onOk) {
    const overlay = document.getElementById('text-overlay');
    const form    = document.getElementById('text-form');
    const input   = document.getElementById('text-input');
    const err     = document.getElementById('text-error');
    document.getElementById('text-title').textContent = opts.title;
    document.getElementById('text-ok-btn').textContent = opts.ok || 'OK';
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';
    err.textContent = '';
    overlay.classList.remove('hidden');
    input.focus();
    input.select();

    const close = () => {
        overlay.classList.add('hidden');
        form.onsubmit = null; input.oninput = null; overlay.onmousedown = null; overlay.onkeydown = null;
        document.getElementById('text-cancel-btn').onclick = null;
    };
    form.onsubmit = e => {
        e.preventDefault();
        const v = input.value.trim();
        const msg = !v ? 'Le nom ne peut pas être vide.' : (opts.validate ? opts.validate(v) : '');
        if (msg) { err.textContent = msg; input.focus(); return; }
        close();
        onOk(v);
    };
    input.oninput = () => { err.textContent = ''; };
    document.getElementById('text-cancel-btn').onclick = close;
    overlay.onmousedown = e => { if (e.target === overlay) close(); };
    overlay.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
}

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
    document.querySelectorAll('.arrow-opt').forEach(b =>
        b.classList.toggle('active', b.dataset.arrow === appSettings.arrowStyle));
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
        return `<button class="theme-opt piece-opt" data-piece="${id}" data-action="setPieceStyle" data-arg="${id}">` +
               `<span class="piece-preview"><span>${s.svg.K}</span><span>${s.svg.n}</span></span>${s.label}</button>`;
    }).join('');
}

// Cartes de sélection du style des flèches (aperçu dessiné par annotations.js).
function renderArrowOptions() {
    const box = document.getElementById('arrow-options');
    if (!box || typeof arrowStylePreview !== 'function') return;
    box.innerHTML = ARROW_STYLE_IDS.map(id =>
        `<button class="theme-opt arrow-opt" data-arrow="${id}" data-action="setArrowStyle" data-arg="${id}">${arrowStylePreview(id)}${ARROW_STYLE_LABELS[id]}</button>`).join('');
}

function setArrowStyle(id) {
    if (!ARROW_STYLE_IDS.includes(id)) return;
    appSettings.arrowStyle = id;
    saveSettings();
    syncSettingsUI();
    if (typeof renderAnnotations === 'function') renderAnnotations();
}

// Préférences reçues d'un autre appareil (synchro) : appSettings est déjà à jour (reloadSyncedPrefs),
// on redessine tout ce qui en dépend.
function applySyncedPrefs() {
    applyBoardTheme();
    applyPieceSet();
    syncSettingsUI();
    refreshPieces();
    initTraining();
    initEndgame();
    if (typeof renderAnnotations === 'function') renderAnnotations();
}

function setPieceStyle(id) {
    if (!PIECE_SET_IDS.includes(id)) return;
    appSettings.pieceSet = id;
    saveSettings();
    applyPieceSet();
    syncSettingsUI();
    refreshPieces();                       // bascule instantanée sur le plateau
    initTraining();                        // cartes Blancs / Noirs de l'onglet Entraînement
    initEndgame();                         // mini-échiquiers du catalogue des finales
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
    closeRepMenu();
    ['play', 'stats', 'training', 'endgame'].forEach(t => {
        const tabEl = document.getElementById('home-tab-' + t);
        const navEl = document.getElementById('nav-tab-' + t);
        if (tabEl) tabEl.classList.toggle('hidden', t !== tab);
        if (navEl) navEl.classList.toggle('active', t === tab);
    });
    if (tab === 'stats')    initStats();
    if (tab === 'training') initTraining();
    if (tab === 'endgame')  initEndgame();
}

// ─── RÉPERTOIRES : AFFICHAGE ET SÉLECTION ────────────────────────────────────

function renderRepertoireList() {
    const list = loadRepertoireList();
    const html = list.map(name =>       // nom échappé : il vient de l'utilisateur (ou d'un autre appareil via la synchro)
        `<div class="repertoire-chip ${name === currentRepertoire ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${name === currentRepertoire}" data-action="selectRepertoire" data-arg="${escapeHtml(name)}">${escapeHtml(name)}</div>`
    ).join('') + `<div class="repertoire-chip repertoire-chip-new" role="button" tabindex="0" data-action="createRepertoire">+ Nouveau</div>`;
    document.querySelectorAll('.repertoire-list').forEach(c => { c.innerHTML = html; });
    renderResumeCard();
    renderHomeSummary();
}

// ─── ACCUEIL : SALUTATION, POSITIONS PAR COULEUR, CHIFFRES DU RÉPERTOIRE ──────

function renderHomeSummary() {
    const greet = document.getElementById('home-greet');
    if (!greet) return;
    const h = new Date().getHours();
    greet.textContent = h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour';
    const w = Object.values(readDBFor(currentRepertoire, 'w')), b = Object.values(readDBFor(currentRepertoire, 'b'));
    const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
    document.getElementById('home-meta-w').textContent = w.length ? pl(w.length, 'position', 'positions') : 'Aucune position';
    document.getElementById('home-meta-b').textContent = b.length ? pl(b.length, 'position', 'positions') : 'Aucune position';
    const now = Date.now(), all = w.concat(b);
    const due = all.filter(e => isDue(e, now)).length;
    const streak = typeof _streak === 'function' ? _streak(readActivity()) : 0;
    document.getElementById('home-stats').innerHTML = !all.length ? '' :
        `<span><b>${due}</b>à réviser</span><span><b>${streak} j</b>d'affilée</span><span><b>${all.length}</b>${all.length > 1 ? 'positions' : 'position'}</span>`;
}

// iOS n'applique :active au toucher qu'en présence d'un écouteur touchstart (retour d'appui, css/feedback.css).
document.addEventListener('touchstart', () => {}, { passive: true });

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

// ─── MENU « ⋮ » DES RÉPERTOIRES (accueil, onglet Jouer) ──────────────────────
// Regroupe : nouveau répertoire, suppression du répertoire actif, accès à la Corbeille.

function renderRepMenu() {
    const isDefault = currentRepertoire === DEFAULT_REPERTOIRE;
    document.getElementById('rep-menu-del-label').textContent =
        isDefault ? 'Supprimer (« Général » est protégé)' : `Supprimer « ${currentRepertoire} »`;
    document.getElementById('rep-menu-del').disabled = isDefault;
    document.getElementById('rep-menu-rename-label').textContent =
        isDefault ? 'Renommer (« Général » est protégé)' : `Renommer « ${currentRepertoire} »`;
    document.getElementById('rep-menu-rename').disabled = isDefault;
    updateTrashBadges();                                  // compteur de la Corbeille
}

function closeRepMenu() {
    const m = document.getElementById('rep-menu'), b = document.getElementById('rep-menu-btn');
    if (m) m.classList.add('hidden');
    if (b) b.setAttribute('aria-expanded', 'false');
}

function toggleRepMenu() {
    const m = document.getElementById('rep-menu'), b = document.getElementById('rep-menu-btn');
    if (!m.classList.contains('hidden')) { closeRepMenu(); return; }
    renderRepMenu();
    m.classList.remove('hidden');
    b.setAttribute('aria-expanded', 'true');
}

function repMenuAction(action) {
    closeRepMenu();
    if (action === 'new')         createRepertoirePrompt();
    else if (action === 'rename') renameRepertoirePrompt(currentRepertoire);
    else if (action === 'delete') deleteRepertoirePrompt(currentRepertoire);   // confirmation + protection de « Général »
    else if (action === 'trash')  showTrash();
    else if (action === 'data')   showData();
}

(function initRepMenuDismiss() {
    document.addEventListener('pointerdown', e => { if (!e.target.closest('.menu-wrap')) closeRepMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeRepMenu(); });
})();

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

    // Badge de couleur : bouton de changement de couleur en « Jouer » et en Entraînement.
    const badge  = document.getElementById('color-badge');
    const mixed  = gameMode === 'training' && typeof trainingState !== 'undefined' && trainingState.mixed;
    badge.disabled = gameMode !== 'play' && gameMode !== 'training';
    badge.title    = badge.disabled ? '' : mixed ? 'Blancs et Noirs mélangés — cliquer pour réviser seulement les ' + (color === 'w' ? 'Noirs' : 'Blancs')
                                              : `Passer aux ${color === 'w' ? 'Noirs' : 'Blancs'}`;
    badge.innerHTML = `<span class="glyph" data-glyph="${color === 'w' ? 'K' : 'k'}"></span> ${color === 'w' ? 'BLANCS' : 'NOIRS'}`
                    + (mixed ? ` ${ico('shuffle')}` : badge.disabled ? '' : ` ${ico('arrow-left-right')}`);
    if (typeof refreshGlyphs === 'function') refreshGlyphs();
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

// Badge de couleur de la barre du haut : même répertoire, autre couleur.
function switchColor() {
    const other = playerColor === 'w' ? 'b' : 'w';
    if (gameMode === 'play') startGame(other);
    else if (gameMode === 'training') switchTrainingColor(other);
}

// ─── REPRENDRE (dernière partie du mode « Jouer ») ─────────────────────────────
// Répertoire, couleur et ligne jouée sont mémorisés à chaque coup (renderMoves) ; l'accueil propose
// de les retrouver d'un clic. Propre à cet appareil (non synchronisé).

const LAST_PLAY_KEY = 'chessTrainer_lastPlay';

function saveLastPlay() {
    if (gameMode !== 'play' || !moveHistory || !moveHistory.length) return;      // une partie vide n'efface pas la précédente
    dataStore.setJSON(LAST_PLAY_KEY, { rep: currentRepertoire, color: playerColor, path: moveHistory.map(m => moveToStr(m.from, m.to, m.promo)), at: Date.now() });
}

function _readLastPlay() {
    const s = dataStore.getJSON(LAST_PLAY_KEY, null);
    if (!s || !['w', 'b'].includes(s.color) || !Array.isArray(s.path) || !loadRepertoireList().includes(s.rep)) return null;
    return s;
}

// Fin de ligne lisible : « … 4. c3 Nf6 5. d4 » (les 5 derniers demi-coups).
function _lineTail(path) {
    let sans;
    try { sans = _pathToSans(path); } catch (e) { return ''; }
    if (!sans.length) return 'Position de départ';
    const from = Math.max(0, sans.length - 5);
    return (from ? '… ' : '') + sans.slice(from).map((s, k) => {
        const i = from + k;
        return i % 2 === 0 ? `${i / 2 + 1}. ${s}` : (k === 0 ? `${(i + 1) / 2}... ${s}` : s);
    }).join(' ');
}

function renderResumeCard() {
    const slot = document.getElementById('resume-slot');
    if (!slot) return;
    const s = _readLastPlay();
    slot.innerHTML = !s ? '' : `
        <button class="resume-card" data-action="resumeLastPlay">
          <span class="resume-ico">${ico('rotate-ccw')}</span>
          <span class="resume-txt"><b>Reprendre</b>
            <small>${escapeHtml(s.rep)} · ${s.color === 'w' ? 'Blancs' : 'Noirs'} · ${escapeHtml(_lineTail(s.path))}</small></span>
          <span class="tr-arrow">${ico('chevron-right')}</span>
        </button>`;
}

function resumeLastPlay() {
    const s = _readLastPlay();
    if (!s) { renderResumeCard(); return; }
    if (s.rep !== currentRepertoire) selectRepertoire(s.rep);
    startGame(s.color);
    loadPositionFromPath(s.path);
    setStatus('Partie reprise', 'info', s.path.length ? 'Vous êtes revenu à la position où vous vous étiez arrêté.' : '');
}

// ─── RETOUR À L'ACCUEIL ───────────────────────────────────────────────────────

function goHome(tab) {
    closeRepMenu();
    if (typeof stopTraining === 'function') stopTraining();
    if (typeof stopEndgame === 'function') stopEndgame();
    if (typeof setSheetOpen === 'function') setSheetOpen(false);
    if (typeof closeToolbarMore === 'function') closeToolbarMore();
    gameMode = 'play';
    applyModeUI();
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('data-overlay').classList.add('hidden');
    document.getElementById('promo-overlay').classList.add('hidden');
    document.getElementById('confirm-overlay').classList.add('hidden');
    document.getElementById('setup-screen').style.display = '';
    document.getElementById('setup-screen').classList.remove('hidden');
    document.getElementById('topnav-tabs-setup').style.display = '';
    document.getElementById('topnav-tabs-game').style.display  = 'none';
    switchHomeTab(typeof tab === 'string' ? tab : 'play');
    renderRepertoireList();
}

registerActions({ setPieceStyle, setArrowStyle, selectRepertoire, resumeLastPlay, createRepertoire: () => createRepertoirePrompt() });

// ─── INITIALISATION ───────────────────────────────────────────────────────────

(function init() {
    document.getElementById('game-screen').style.display = 'none';
    loadTheme();
    purgeExpiredTrash();                    // corbeille : purge des éléments de plus de 30 jours
    renderRepertoireList();
    updateTrashBadges();
    renderPieceOptions();
    renderArrowOptions();
})();
