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

function loadTheme() { applyThemeMode(); }

// Bascule rapide (pilule de la barre du haut) : clair ↔ sombre, quitte le mode « Système ».
function toggleTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    setThemeMode(dark ? 'light' : 'dark');
}

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

// Préférences reçues d'un autre appareil (synchro) : appSettings est déjà à jour (reloadSyncedPrefs),
// on redessine tout ce qui en dépend.
function applySyncedPrefs() {
    applyBoardTheme();
    applyDisplayPrefs();
    applyPieceSet();
    refreshPieces();
    initTraining();
    initEndgame();
    renderHomeSummary();
    if (typeof refreshNotation === 'function') refreshNotation();
    if (typeof renderAnnotations === 'function') renderAnnotations();
    if (typeof SettingsPanel !== 'undefined' && SettingsPanel.isOpen()) SettingsPanel.refresh();
    if (typeof AccountUI !== 'undefined' && AccountUI.refresh) AccountUI.refresh();
    // Déconnexion demandée depuis un autre appareil (Compte › Appareils et synchro).
    if (isThisDeviceRevoked() && typeof Auth !== 'undefined' && Auth.isSignedIn()) {
        Auth.signOut();
        touchDevice(true);                 // demande levée localement : une reconnexion ne redéclenchera pas la déconnexion
        if (typeof AccountUI !== 'undefined') AccountUI.notify('Cet appareil a été déconnecté depuis un autre appareil. Vos données restent ici.');
    }
}

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
    const html = RepPicker.html('selectRepertoire');      // puce et liste avec recherche (repPicker.js)
    document.querySelectorAll('.repertoire-list').forEach(c => { c.innerHTML = html; });
    renderResumeCard();
    renderHomeSummary();
}

// ─── ACCUEIL : SALUTATION, POSITIONS PAR COULEUR, CHIFFRES DU RÉPERTOIRE ──────

function renderHomeSummary() {
    const greet = document.getElementById('home-greet');
    if (!greet) return;
    const h = new Date().getHours(), name = appSettings.pseudo.trim();
    greet.textContent = (h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour') + (name ? `, ${name}` : '');
    const w = Object.values(readDBFor(currentRepertoire, 'w')), b = Object.values(readDBFor(currentRepertoire, 'b'));
    const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
    document.getElementById('home-meta-w').textContent = w.length ? pl(w.length, 'position', 'positions') : 'Aucune position';
    document.getElementById('home-meta-b').textContent = b.length ? pl(b.length, 'position', 'positions') : 'Aucune position';
    const now = Date.now(), all = w.concat(b);
    const due = all.filter(e => isDue(e, now)).length;
    const streak = typeof _streak === 'function' ? _streak(readActivity()) : 0;
    // Répertoire vide : à la place des chiffres, par où commencer.
    document.getElementById('home-stats').innerHTML = !all.length ? `<p class="home-empty">${ico('lightbulb')}<span><b>Par où commencer ?</b> Choisissez une couleur et jouez une première ligne, en jouant aussi les coups de l’adversaire. Vous avez déjà vos lignes ? <button type="button" class="toast-link" data-action="homeImportPgn">Importez un PGN</button>.</span></p>` :
        `<span><b>${due}</b>à réviser</span><span><b>${streak} j</b>d'affilée</span><span><b>${all.length}</b>${all.length > 1 ? 'positions' : 'position'}</span>`;
    // Objectif quotidien (Paramètres › Jeu et entraînement) : positions jouées aujourd'hui, tous répertoires.
    const today = (readActivity()[dayStamp(now)] || { a: 0 }).a, goal = appSettings.dailyGoal;
    const box = document.getElementById('home-goal');
    if (box) {
        box.hidden = !all.length;
        box.style.setProperty('--p', Math.min(100, Math.round(100 * today / goal)) + '%');
        box.classList.toggle('is-done', today >= goal);
        box.innerHTML = `<i aria-hidden="true"></i><span>Objectif du jour : <b>${Math.min(today, goal)} / ${goal}</b> positions${today >= goal ? ' · atteint' : ''}</span>`;
    }
    HomePanels.render();                         // Mes répertoires, Nouveautés à traiter, Dernières parties
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
    document.addEventListener('pointerdown', e => {
        if (!e.target.closest('#rep-menu, #rep-menu-btn')) closeRepMenu();
    });
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

// data-modes : visible seulement dans ces modes ; data-modes-not : caché dans ces modes.
function applyModeUI() {
    document.querySelectorAll('[data-modes]').forEach(el => {
        el.style.display = el.dataset.modes.split(',').includes(gameMode) ? '' : 'none';
    });
    document.querySelectorAll('[data-modes-not]').forEach(el => {
        el.style.display = el.dataset.modesNot.split(',').includes(gameMode) ? 'none' : '';
    });
    if (typeof _applySideTab === 'function') _applySideTab();     // l'arbre n'est disponible qu'en mode Jouer
}

// Affiche l'écran de jeu (commun aux modes jouer / aperçu / entraînement).
function showGameScreen(color) {
    boardFlipped = appSettings.autoFlip && color === 'b';      // Paramètres › Jeu : orienter selon ma couleur

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
    if (typeof _renderSessionBar === 'function') _renderSessionBar();
    badge.disabled = (gameMode !== 'play' && gameMode !== 'training') || (gameMode === 'training' && !!trainingState.session);   // séance guidée : couleur imposée
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

// Fin de ligne lisible : « … 4. c3 Cf6 5. d4 » (les 5 derniers demi-coups), en HTML (figurines du jeu actif).
function _lineTail(path) {
    let sans;
    try { sans = _pathToSans(path); } catch (e) { return ''; }
    if (!sans.length) return 'Position de départ';
    const from = Math.max(0, sans.length - 5);
    return (from ? '… ' : '') + sans.slice(from).map((s, k) => {
        const i = from + k, f = formatSan(s, i % 2 ? 'b' : 'w');
        return i % 2 === 0 ? `${i / 2 + 1}. ${f}` : (k === 0 ? `${(i + 1) / 2}... ${f}` : f);
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
            <small>${escapeHtml(s.rep)} · ${s.color === 'w' ? 'Blancs' : 'Noirs'} · ${_lineTail(s.path)}</small></span>
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
    if (typeof abandonSession === 'function') abandonSession();
    if (typeof stopEndgame === 'function') stopEndgame();
    if (gameMode === 'analysis' && typeof stopAnalysis === 'function') stopAnalysis();     // le brouillon reste dans la session
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

registerActions({ selectRepertoire, resumeLastPlay, createRepertoire: () => createRepertoirePrompt(), homeImportPgn: () => showPgnImport() });

// ─── INITIALISATION ───────────────────────────────────────────────────────────

(function init() {
    document.getElementById('game-screen').style.display = 'none';
    loadTheme();
    migrateStoredData();                    // clés de position et notations au format actuel (une fois par appareil)
    purgeExpiredTrash();                    // corbeille : purge des éléments de plus de 30 jours
    renderRepertoireList();
    updateTrashBadges();
})();
