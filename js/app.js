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

const HP_QUICK_MAX = 6;          // pastilles d'autres répertoires dans la barre de Jouer ; les suivants restent dans la liste de la puce

function renderRepertoireList() {
    const html = RepPicker.html('selectRepertoire');      // puce et liste avec recherche (repPicker.js)
    document.querySelectorAll('.repertoire-list').forEach(c => { c.innerHTML = html; });
    // Barre de Jouer : les autres répertoires en pastilles d'initiales (un clic le choisit), puis « + ».
    const quick = document.getElementById('hp-quick');
    if (quick) quick.innerHTML = loadRepertoireList().filter(n => n !== currentRepertoire).slice(0, HP_QUICK_MAX).map(n =>
        `<button type="button" class="hp-q" data-action="selectRepertoire" data-arg="${escapeHtml(n)}" title="${escapeHtml(n)}" aria-label="Répertoire ${escapeHtml(n)}">${escapeHtml((n.trim()[0] || '?').toUpperCase())}</button>`).join('')
        + `<button type="button" class="hp-q is-new" data-action="createRepertoire" title="Nouveau répertoire" aria-label="Nouveau répertoire">${ico('plus')}</button>`;
    renderResumeCard();
    renderHomeSummary();
}

// Position illustrant une couleur : la première réponse du répertoire (la plus courte, puis la plus travaillée),
// après mon coup. Sans position : la position de départ, de mon côté.
function _homeArtHTML(entries, color) {
    const e = entries.filter(x => Array.isArray(x.path) && x.path.length).sort((a, b) => a.path.length - b.path.length || b.attempts - a.attempts)[0];
    return _miniBoardHTML({ side: color, path: e ? e.path : [], k: INIT_FEN }, true);
}

// ─── ACCUEIL : AUJOURD'HUI, JOUER ─────────────────────────────────────────────
// « Aujourd'hui » n'a qu'une action, selon l'état : révisions dues → Révision du jour (séance d'Entraînement,
// startDailyReview) ; tout est à jour → une nouvelle ligne dans la couleur la moins fournie ; répertoire vide →
// choisir une couleur. L'objectif du jour (anneau) et la série accompagnent l'action qui les fait avancer.

const HOME_PLAN_MAX = 4;          // ouvertures listées sous « Au programme » ; les autres sont résumées

// Positions du répertoire actif groupées par ouverture nommée (même regroupement que les Statistiques).
function _homePlan(list) {
    const rows = list.map(x => ({ side: x.color, k: x.key, e: x.e, path: x.e.path && x.e.path.length ? x.e.path : null }));
    _assignOpenings(rows);
    const groups = new Map();
    rows.forEach(r => { const g = groups.get(r.gKey) || { side: r.side, html: r.gHtml, n: 0 }; g.n++; groups.set(r.gKey, g); });
    return [...groups.values()].sort((a, b) => b.n - a.n);
}

function _homePlanHTML(title, list, muted) {
    if (!list.length) return '';
    const groups = _homePlan(list), shown = groups.slice(0, HOME_PLAN_MAX), max = Math.max(...shown.map(g => g.n));
    const rest = groups.slice(HOME_PLAN_MAX).reduce((n, g) => n + g.n, 0);
    return `<div class="hp-plan${muted ? ' is-muted' : ''}"><div class="hp-h"><h3>${title}</h3><span class="hp-n">${list.length}</span></div>
        ${shown.map(g => `<div class="hp-plan-row"><i class="hp-k is-${g.side}" title="${g.side === 'w' ? 'Blancs' : 'Noirs'}"></i>
            <span class="hp-plan-name">${g.html}</span><span class="hp-plan-bar"><i style="width:${Math.round(100 * g.n / max)}%"></i></span><b>${g.n}</b></div>`).join('')}
        ${rest ? `<p class="hp-plan-more">et ${rest} dans ${groups.length - HOME_PLAN_MAX} autre${groups.length - HOME_PLAN_MAX > 1 ? 's' : ''} ouverture${groups.length - HOME_PLAN_MAX > 1 ? 's' : ''}</p>` : ''}</div>`;
}

// Anneau de l'objectif du jour (positions jouées aujourd'hui, tous répertoires).
function _homeGoalHTML(done, goal) {
    const C = 2 * Math.PI * 26, p = Math.min(1, done / goal);
    return `<div class="hp-goal${done >= goal ? ' is-done' : ''}" role="img" aria-label="Objectif du jour : ${Math.min(done, goal)} sur ${goal} positions">
        <svg viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="26"/><circle class="v" cx="30" cy="30" r="26" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - p)).toFixed(1)}"/></svg>
        <span><b>${Math.min(done, goal)}/${goal}</b><small>aujourd'hui</small></span></div>`;
}

function renderHomeSummary() {
    const host = document.getElementById('hp-today');
    if (!host) return;
    const now = Date.now(), pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
    const rows = [];
    ['w', 'b'].forEach(color => { const db = readDBFor(currentRepertoire, color); Object.keys(db).forEach(key => rows.push({ color, key, e: db[key] })); });
    const side = c => rows.filter(r => r.color === c), due = rows.filter(r => isDue(r.e, now));
    document.getElementById('hp-grid').classList.toggle('is-empty', !rows.length);

    // Jouer : position, chiffres et maîtrise par couleur.
    document.getElementById('hp-play-n').textContent = pl(rows.length, 'position', 'positions');
    ['w', 'b'].forEach(c => {
        const list = side(c), d = list.filter(r => isDue(r.e, now)).length, counts = {};
        document.getElementById('home-meta-' + c).textContent = !list.length ? 'Aucune position'
            : pl(list.length, 'position', 'positions') + ' · ' + (d ? pl(d, 'due', 'dues') : 'à jour');
        document.getElementById('home-art-' + c).innerHTML = _homeArtHTML(list.map(r => r.e), c);
        STATS_LEVEL_ORDER.forEach(l => { counts[l] = 0; });
        list.filter(r => r.e.attempts > 0).forEach(r => { counts[_level(r.e)]++; });
        document.getElementById('home-bar-' + c).innerHTML = STATS_MASTERY_LEVELS.some(l => counts[l]) ? levelBarHTML(counts, 'hp-bar') : '';
    });

    const h = new Date().getHours(), name = appSettings.pseudo.trim();
    const greet = escapeHtml((h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour') + (name ? `, ${name}` : ''));
    const act = readActivity(), streak = _streak(act), today = (act[dayStamp(now)] || { a: 0 }).a, goal = appSettings.dailyGoal;
    const head = `<span class="hp-greet">${greet}${streak ? `<span class="hp-streak">${pl(streak, 'jour', 'jours')} d'affilée</span>` : ''}</span>`;

    // Répertoire vide : par quelle couleur commencer.
    if (!rows.length) {
        const pick = (c, primary) => `<button type="button" class="hp-pick" onclick="startGame('${c}')">
            ${_miniBoardHTML({ side: c, path: [], k: INIT_FEN }, true)}
            <span><b>${c === 'w' ? 'Blancs' : 'Noirs'}</b><small>${c === 'w' ? '1. ?' : 'contre 1. e4, 1. d4…'}</small>
            <span class="hp-cta${primary ? '' : ' is-quiet'}">${ico('play')}Commencer</span></span></button>`;
        host.innerHTML = `<div class="hp-start">${head}<h2 class="hp-title">Par quelle couleur commencer&nbsp;?</h2>
            <div class="hp-picks">${pick('w', true)}${pick('b', false)}</div>
            <div class="hp-alts"><button type="button" class="hp-alt" data-action="homeImportPgn">${ico('upload')}Importer un PGN</button>
            <button type="button" class="hp-alt" data-action="homeGames">${ico('target')}Partir de mes parties</button></div></div>`;
        HomePanels.render();
        return;
    }

    let board, title, sub, cta, plan;
    if (due.length) {
        // La position la plus en retard, telle qu'elle sera posée (avant mon coup).
        const next = due.slice().sort((a, b) => dueOf(a.e) - dueOf(b.e))[0];
        const op = next.e.path && next.e.path.length ? openingNameOf(next.e.path) : null;
        const minutes = Math.max(1, Math.round(due.length * TRAIN_SECONDS_PER_POSITION / 60));
        board = _miniBoardHTML({ side: next.color, path: next.e.path && next.e.path.length ? next.e.path : null, k: next.key }, false)
              + `<span class="hp-cap">${op ? escapeHtml(op.name) + ' · ' : ''}${next.color === 'w' ? 'Blancs' : 'Noirs'}</span>`;
        title = `<em>${due.length}</em> ${due.length > 1 ? 'positions' : 'position'}<br>à réviser`;
        sub = `Environ <b>${minutes} min</b>` + (today < goal ? ` · encore ${goal - today} pour l'objectif` : ' · objectif atteint');
        cta = `<button type="button" class="hp-cta" data-action="homeReview">${ico('play')}Commencer la révision</button>
               <button type="button" class="hp-link" data-action="homeExercises">Autres exercices ${ico('chevron-right')}</button>`;
        plan = _homePlanHTML('Au programme', due);
    } else {
        // À jour : la prochaine révision, et une ligne à ajouter dans la couleur la moins fournie.
        const soon = rows.slice().sort((a, b) => dueOf(a.e) - dueOf(b.e)), first = soon[0];
        const c = side('w').length <= side('b').length ? 'w' : 'b';
        const horizon = _dayStart(now, 2), upcoming = rows.filter(r => dueOf(r.e) < horizon);
        board = _miniBoardHTML({ side: first.color, path: first.e.path && first.e.path.length ? first.e.path : null, k: first.key }, false)
              + `<span class="hp-check">${ico('check')}</span>`;
        title = `Tout est <em>à jour</em>.`;
        sub = `Prochaine révision <b>${_inLabel(dueOf(first.e))}</b>`;
        cta = `<button type="button" class="hp-cta" data-action="homeAddLine" data-arg="${c}">${ico('plus')}Ajouter une ligne aux ${c === 'w' ? 'Blancs' : 'Noirs'}</button>
               <button type="button" class="hp-link" data-action="homeExercises">Autres exercices ${ico('chevron-right')}</button>`;
        plan = _homePlanHTML('D’ici demain', upcoming, true);
    }
    host.innerHTML = `<div class="hp-day${due.length ? '' : ' is-done'}">${_homeGoalHTML(today, goal)}
        <div class="hp-day-in"><div class="hp-day-board">${board}</div>
        <div class="hp-day-txt">${head}<h2 class="hp-title">${title}</h2><p class="hp-sub">${sub}</p><div class="hp-ctas">${cta}</div></div></div>
        ${plan}</div>`;
    HomePanels.render();                         // À traiter : nouveautés des parties, dernières parties
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
    renderGameRep();
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

    if (typeof _renderSessionBar === 'function') _renderSessionBar();
    renderGameSide();
    renderGameRep();

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
// Puce du répertoire de la barre du haut (RepPicker « sm ») : la liste s'ouvre au clic, et choisir un autre
// répertoire relance le mode en cours avec la même couleur. Séance guidée : puce verrouillée. Finales : titre
// de l'exercice (pas de répertoire).
function renderGameRep() {
    const host = document.getElementById('game-rep');
    if (!host) return;
    if (gameMode === 'endgame' && typeof endgameState !== 'undefined' && endgameState.ex) {
        host.innerHTML = `<span class="game-rep-title">${escapeHtml(endgameState.ex.title)}</span>`;
        return;
    }
    const session = gameMode === 'training' && typeof trainingState !== 'undefined' && !!trainingState.session;
    host.innerHTML = RepPicker.html('gameRepertoire', { size: 'sm', locked: session });
}

function switchGameRepertoire(name) {
    const mode = gameMode, color = playerColor, mixed = mode === 'training' && trainingState.mixed;
    selectRepertoire(name);
    if (mode === 'play') startGame(color);
    else if (mode === 'training') {
        startTraining(mixed ? 'mix' : color);
        if (gameMode !== 'training') goHome('training');        // rien à réviser dans ce répertoire : retour à l'Entraînement
    }
    // Analyse : le brouillon reste, « Ajouter au répertoire » visera le nouveau répertoire.
}
registerActions({ gameRepertoire: switchGameRepertoire });

// Capsule de couleur de la barre du haut (ColorScope compact). Jouer : Blancs / Noirs. Entraînement libre :
// Blancs / Noirs / Les deux (mélangés). Couleur imposée (séance guidée, finale, analyse) : capsule verrouillée.
function renderGameSide() {
    const training = gameMode === 'training' && typeof trainingState !== 'undefined';
    const mixed = training && trainingState.mixed;
    const locked = !(gameMode === 'play' || (training && !trainingState.session));
    const hint = training && trainingState.session ? 'Couleur fixée par la séance guidée' : gameMode === 'endgame' ? 'Couleur fixée par l\'exercice' : 'Couleur fixe dans ce mode';
    ColorScope.render(document.getElementById('game-side'), {
        options: training && !locked ? ['w', 'b', 'mix'] : ['w', 'b'], value: mixed ? 'mix' : playerColor,
        size: 'sm', locked, lockedHint: hint, label: 'Couleur jouée', onChange: switchColor
    });
}

function switchColor(to) {
    if (gameMode === 'play') startGame(to);
    else if (gameMode === 'training') {
        if (to === 'mix') startTraining('mix');
        else switchTrainingColor(to);
    }
    renderGameSide();      // couleur refusée (rien à réviser) : la capsule revient sur la couleur jouée
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

registerActions({ selectRepertoire, resumeLastPlay, createRepertoire: () => createRepertoirePrompt(), homeImportPgn: () => showPgnImport(),
    homeReview: () => startDailyReview(), homeAddLine: c => startGame(c), homeExercises: () => openTrainingFrom({ color: 'all' }) });

// ─── INITIALISATION ───────────────────────────────────────────────────────────

(function init() {
    document.getElementById('game-screen').style.display = 'none';
    loadTheme();
    migrateStoredData();                    // clés de position et notations au format actuel (une fois par appareil)
    purgeExpiredTrash();                    // corbeille : purge des éléments de plus de 30 jours
    renderRepertoireList();
    updateTrashBadges();
})();
