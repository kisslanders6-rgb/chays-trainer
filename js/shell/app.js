/**
 * shell/app.js
 * ──────────────────────────────────────────────────────────────────────────
 * Point d'entrée de l'application :
 *   - Initialisation au chargement
 *   - Navigation (accueil ↔ jeu, onglets)
 *   - Gestion du thème (dark / light)
 *   - Rendu de la liste des répertoires
 *   - Démarrage et retour à l'accueil
 */

'use strict';

// ─── THÈME ────────────────────────────────────────────────────────────────────

function loadTheme() { applyThemeMode(); }

// Bascule rapide (pilule de la barre du haut) : clair ↔ sombre, quitte le mode « Système ».
function toggleTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    setThemeMode(dark ? 'light' : 'dark');
}

// ─── SAISIE DE TEXTE (remplace prompt()) ──────────────────────────────────────
// askText({ title, value?, placeholder?, ok?, validate?(texte) → message d'erreur | '' }, onOk(texte))

// ─── RAPPEL DE SAUVEGARDE (toast) ─────────────────────────────────────────────

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
    // Déconnexion demandée depuis un autre appareil (Compte › Synchronisation).
    if (isThisDeviceRevoked() && typeof Auth !== 'undefined' && Auth.isSignedIn()) {
        Auth.signOut();
        touchDevice(true);                 // demande levée localement : une reconnexion ne redéclenchera pas la déconnexion
        if (typeof AccountUI !== 'undefined') AccountUI.notify('Cet appareil a été déconnecté depuis un autre appareil. Vos données restent ici.');
    }
}

// ─── NAVIGATION : ONGLETS D'ACCUEIL ──────────────────────────────────────────

// Onglets de l'accueil (refonte « Chays sans détour », lot 3 : Ouvertures ; Entraînement hors de la barre).
const HOME_TABS = ['play', 'openings', 'endgame', 'stats', 'training'];

function switchHomeTab(tab) {
    // En partie (onglets compacts de la barre du haut, menu « Plus » sur téléphone) : retour à l'accueil sur cet onglet.
    const gs = document.getElementById('game-screen');
    if (gs && !gs.classList.contains('hidden')) { goHome(tab); return; }
    closeRepMenu();
    if (tab !== 'stats') closeStatsWeak();
    const shown = document.querySelector('.home-tab:not(.hidden)');
    HOME_TABS.forEach(t => {
        const tabEl = document.getElementById('home-tab-' + t);
        const navEl = document.getElementById('nav-tab-' + t);
        if (tabEl) tabEl.classList.toggle('hidden', t !== tab);
        if (navEl) navEl.classList.toggle('active', t === tab);
    });
    _enterHomeTab(document.getElementById('home-tab-' + tab), shown);
    if (tab === 'stats')    initStats();
    if (tab === 'openings') OpeningsTab.init();
    if (tab === 'training') initTraining();
    if (tab === 'endgame')  initEndgame();
    if (typeof Dock !== 'undefined') Dock.refresh();     // centre du dock : l'action de la page (téléphone)
}

// Changement d'onglet (identité « Noyer gravé ») : seul le contenu arrive, fondu et montée de 8 px en --dur-2 ;
// les barres ne bougent pas. Rien au premier affichage, sur le même onglet ou en animations réduites.
function _enterHomeTab(el, previous) {
    if (!el || !previous || previous === el || typeof el.animate !== 'function' || prefersReducedMotion()) return;
    el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
               { duration: 220, easing: 'cubic-bezier(.16, 1, .3, 1)' });
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
// « Aujourd'hui » n'a qu'une action : « Commencer » lance la première étape du plan du jour (_homeSteps) ; tout est
// fait → une nouvelle ligne dans la couleur la moins fournie ; répertoire vide → choisir une couleur. L'objectif du
// jour (anneau) et la série accompagnent l'action qui les fait avancer.

// Positions du répertoire actif groupées par ouverture nommée (même regroupement que les Statistiques).
function _homePlan(list) {
    const rows = list.map(x => ({ side: x.color, k: x.key, e: x.e, path: x.e.path && x.e.path.length ? x.e.path : null }));
    return groupByOpening(rows).sort((a, b) => b.n - a.n);
}

// Anneau de l'objectif du jour (positions jouées aujourd'hui, tous répertoires) : anneau commun (Ring, rings.js).
function _homeGoalHTML(done, goal) {
    const n = Math.min(done, goal);
    return Ring.html({ value: done, max: goal, size: 64, label: `${n}/${goal}`, sub: done >= goal ? 'atteint' : 'auj.',
        ariaLabel: `Objectif du jour : ${n} sur ${goal} positions`, cls: 'hp-goal' });
}

// Prévision des 7 prochains jours (programme du répertoire, reviewPlan) : une barre fine par jour avec son total.
function _homeForecastHTML(fc, now) {
    const max = Math.max(1, ...fc), d0 = new Date(now);
    const day = i => i === 0 ? 'auj.' : new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).toLocaleDateString(I18n.locale(), { weekday: 'short' });
    return `<div class="hp-plan hp-fc-wrap"><div class="hp-h"><h3>7 prochains jours</h3><span class="hp-n">${fc.reduce((a, b) => a + b, 0)}</span></div>
        <ol class="hp-fc" aria-label="Révisions prévues sur les 7 prochains jours">${fc.map((v, i) =>
            `<li aria-label="${escapeHtml(day(i))} : ${v} ${v > 1 ? 'positions' : 'position'}"><b class="hp-fc-n">${v}</b>`
            + `<i style="height:${v ? Math.max(3, Math.round(36 * v / max)) : 2}px"></i><span aria-hidden="true">${escapeHtml(day(i))}</span></li>`).join('')}</ol></div>`;
}

// Fin de ligne menant à une position (sans mon dernier coup : la position telle qu'elle sera posée).
const _homeLineBefore = path => _lineTail(path.slice(0, -1));

function renderHomeSummary() {
    if (typeof Suite !== 'undefined') Suite.refresh();
    const host = document.getElementById('hp-today');
    if (!host) return;
    const now = Date.now(), pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
    repairPaths(currentRepertoire);                             // chemins manquants retrouvés (storage.js), une fois
    const rows = repertoireRows();
    const rp = reviewPlan(currentRepertoire, now);              // programme des révisions (storage.js)
    const side = c => rows.filter(r => r.color === c), due = rows.filter(r => rp.today(r.color, r.key));
    document.getElementById('hp-grid').classList.toggle('is-empty', !rows.length);
    ['hp-play', 'hp-news'].forEach(id => document.getElementById(id).classList.add('edge-card'));   // bord à bord sur téléphone

    // Jouer : position, chiffres et maîtrise par couleur.
    document.getElementById('hp-play-n').textContent = pl(rows.length, 'position', 'positions');
    const note = repertoireNote(currentRepertoire), desc = document.getElementById('hp-play-desc');
    desc.hidden = !note;
    desc.textContent = note;
    ['w', 'b'].forEach(c => {
        const list = side(c), d = list.filter(r => rp.today(r.color, r.key)).length, counts = {};
        document.getElementById('home-meta-' + c).textContent = !list.length ? 'Aucune position'
            : pl(list.length, 'position', 'positions') + ' · ' + (d ? `${d} à réviser` : 'à jour');
        document.getElementById('home-art-' + c).innerHTML = _homeArtHTML(list.map(r => r.e), c);
        STATS_LEVEL_ORDER.forEach(l => { counts[l] = 0; });
        list.filter(r => r.e.attempts > 0).forEach(r => { counts[_level(r.e)]++; });
        document.getElementById('home-bar-' + c).innerHTML = STATS_MASTERY_LEVELS.some(l => counts[l]) ? levelBarHTML(counts, 'hp-bar') : '';
    });

    // Surtitre : salutation · série.
    const h = new Date().getHours(), name = appSettings.pseudo.trim();
    const act = readActivity(), streak = _streak(act), today = (act[dayStamp(now)] || { a: 0 }).a, goal = appSettings.dailyGoal;
    const evening = h >= 18 || h < 5, hello = name ? (evening ? `Bonsoir, ${name}` : `Bonjour, ${name}`) : (evening ? 'Bonsoir' : 'Bonjour');
    const head = `<p class="hp-over">${escapeHtml(hello)}`
        + `${streak ? ` · <span class="hp-streak">${pl(streak, 'jour', 'jours')} d'affilée</span>` : ''}</p>`;

    // Répertoire vide : par quelle couleur commencer (une carte choisie, une seule action pleine).
    if (!rows.length) {
        const pick = c => `<button type="button" class="hp-pick is-${c}" data-action="homePick" data-arg="${c}" aria-pressed="${c === 'w'}">
            ${_miniBoardHTML({ side: c, path: [], k: INIT_FEN }, true, { label: c === 'w' ? 'Blancs' : 'Noirs' })}
            <span><b>${c === 'w' ? 'Blancs' : 'Noirs'}</b><small>${c === 'w' ? '1. ?' : 'contre 1. e4, 1. d4…'}</small></span></button>`;
        host.innerHTML = `<div class="hp-start edge-card">${head}<h2 class="hp-title">Par quelle couleur commencer&nbsp;?</h2>
            <div class="hp-picks">${pick('w')}${pick('b')}</div>
            <div class="hp-ctas"><button type="button" class="btn btn-primary hp-cta" id="hp-start-cta" data-action="homeAddLine" data-arg="w">${ico('play')}<span>Commencer avec les Blancs</span></button></div>
            <div class="hp-alts"><button type="button" class="hp-link" data-action="homeImportPgn">${ico('upload')}Importer un PGN</button>
            <button type="button" class="hp-link" data-action="homeGames">${ico('flame')}Partir de mes parties</button></div></div>`;
        HomePanels.render();
        return;
    }

    const link = `<button type="button" class="hp-link" data-action="homeExercises">Autres exercices ${ico('chevron-right')}</button>`;
    let title, sub, focus = '', cta, plan = '';
    const steps = _homeSteps(due, rp, now), next = steps.find(x => !x.done);
    _homeStepsNow = steps;
    if (due.length) {
        // La position la plus en retard, telle qu'elle sera posée (avant mon coup).
        const nx = due.slice().sort((a, b) => dueOf(a.e) - dueOf(b.e))[0];
        const path = nx.e.path && nx.e.path.length ? nx.e.path : null, op = path ? openingNameOf(path) : null;
        const d0 = dueOf(nx.e), late = d0 ? Math.floor((now - d0) / DAY_MS) : 0, colors = new Set(due.map(r => r.color));
        const minutes = Math.max(1, Math.round(due.length * TRAIN_SECONDS_PER_POSITION / 60));
        title = `<em>${due.length}</em> ${due.length > 1 ? 'positions' : 'position'}<br>à réviser`;
        const fresh = due.filter(r => !r.e.attempts).length;
        sub = `<b>Environ ${minutes} min</b> · ${colors.size > 1 ? 'Blancs et Noirs' : colors.has('w') ? 'Blancs' : 'Noirs'}`
            + (fresh ? ` · dont ${pl(fresh, 'nouvelle', 'nouvelles')}` : '')
            + (today < goal ? ` · encore ${goal - today} pour l'objectif` : '');
        focus = `<div class="hp-focus">${_miniBoardHTML({ side: nx.color, path, k: nx.key }, false, { cls: 'hp-focus-board', label: 'Position la plus en retard, avant votre coup' })}
            <span class="hp-focus-txt"><span class="hp-focus-over">La plus en retard${late >= 1 ? ` · ${late} j` : ''}</span>
            <b>${op ? escapeHtml(op.name) : 'Position de départ'}</b><span class="hp-focus-line">${path ? _homeLineBefore(path) : ''}</span>
            <small>${nx.color === 'w' ? 'Blancs' : 'Noirs'}</small></span></div>`;
    } else {
        const nextAt = rp.next();
        title = `Révisions <em>à jour</em>.`;
        sub = (Number.isFinite(nextAt) ? `Prochaine révision <b>${dueInLabel(nextAt, true)}</b>` : 'Aucune révision prévue') + (today >= goal ? ' · objectif atteint' : '');
        plan = _homeForecastHTML(rp.forecast(null, 7), now);
    }
    if (next) {
        // Une seule action : la première étape qui reste ; chaque ligne lance aussi la sienne.
        cta = `<button type="button" class="btn btn-primary hp-cta" data-action="homeGo" data-arg="${next.id}">${ico('play')}<span>Commencer</span></button>${link}`;
    } else {
        // Tout est fait : une nouvelle ligne dans la couleur la moins fournie.
        const c = side('w').length <= side('b').length ? 'w' : 'b';
        cta = `<button type="button" class="btn btn-primary hp-cta" data-action="homeAddLine" data-arg="${c}">${ico('plus')}Ajouter une ligne aux ${c === 'w' ? 'Blancs' : 'Noirs'}</button>${link}`;
    }
    host.innerHTML = `<div class="hp-day edge-card${next ? '' : ' is-done'}">${head}
        <div class="hp-head"><div><h2 class="hp-title">${title}</h2><p class="hp-sub">${sub}</p></div>${_homeGoalHTML(today, goal)}</div>
        ${focus}${_homeStepsHTML(steps)}<div class="hp-ctas">${cta}</div>${plan}</div>`;
    HomePanels.render();                         // À traiter : nouveautés des parties, dernières parties
    if (typeof Dock !== 'undefined') Dock.refresh();   // le centre du dock reprend « Commencer », maintenant dessiné
}

// ─── PLAN DU JOUR (refonte « Chays sans détour », lot 2) ──────────────────────
// Les étapes du jour, dans l'ordre où « Commencer » les prend : erreurs de la dernière séance, révisions dues
// (Révision du jour : « À revoir » et « Traitée depuis » en tête), réponses à donner après vos parties, une finale.
// Une étape faite reste affichée, cochée (révisions à jour, finale réussie aujourd'hui) ; une étape sans objet disparaît.
let _homeStepsNow = [];

function _homeSteps(due, rp, now) {
    const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`, out = [];
    const s = trainingState.lastSummary, miss = s && s.kind !== 'timed' ? s.rows.filter(r => !r.ok).length : 0;
    if (miss) out.push({ id: 'retry', icon: 'rotate-ccw', tone: 'err', title: 'Erreurs de la séance', sub: 'À revoir tant qu’elles sont fraîches', n: miss });
    if (due.length) {
        const names = _homePlan(due).slice(0, 3).map(g => `<span>${g.html}</span>`).join(', ');
        const back = due.filter(r => Number.isInteger(r.e.relearn) || r.e.prio).length;
        out.push({ id: 'due', icon: 'book', title: 'Révisions', sub: names + (back ? ` · <span>dont ${back} à revoir</span>` : ''), n: due.length, html: true });
    } else {
        const at = rp.next();
        out.push({ id: 'due', icon: 'book', title: 'Révisions', sub: Number.isFinite(at) ? `À jour · <span>Prochaine révision ${dueInLabel(at, true)}</span>` : 'À jour', html: true, done: true });
    }
    const news = HomePanels.novelties().length;
    if (news) out.push({ id: 'news', icon: 'swords', tone: 'new', title: 'Après vos parties', sub: news > 1 ? 'Des réponses à trouver' : 'Une réponse à trouver', n: news });
    if (typeof readEndgameProgress === 'function' && typeof _egNext === 'function') {
        const prog = readEndgameProgress(), start = new Date(now).setHours(0, 0, 0, 0);
        const won = ENDGAME_EXERCISES.find(e => prog[e.id] && prog[e.id].wins > 0 && prog[e.id].last >= start);
        const ex = _egNext(prog);
        if (won) out.push({ id: 'endgame', icon: 'finish-flag', tone: 'brass', title: 'Une finale', sub: `<span>${escapeHtml(won.title)}</span> · <span>faite aujourd’hui</span>`, html: true, done: true });
        else if (ex) out.push({ id: 'endgame', icon: 'finish-flag', tone: 'brass', title: 'Une finale', sub: ex.title, n: 1, arg: ex.id });
    }
    return out;
}

function _homeStepsHTML(steps) {
    return `<ol class="hp-steps" aria-label="Plan du jour">${steps.map(x => `<li><button type="button" class="hp-step${x.done ? ' is-done' : ''}" data-action="homeStep" data-arg="${x.id}"${x.done ? ' aria-disabled="true"' : ''}>
        <span class="hp-step-ico${x.tone ? ' is-' + x.tone : ''}">${ico(x.done ? 'check' : x.icon)}</span>
        <span class="hp-step-txt"><b>${x.title}</b><small>${x.html ? x.sub : escapeHtml(x.sub)}</small></span>
        ${x.done ? '' : `<span class="hp-step-n">${x.n}</span>`}</button></li>`).join('')}</ol>`;
}

// Lance une étape du plan : ce que faisaient la capsule Suite, l'onglet Entraînement et les Finales.
function homeRunStep(id) {
    const x = _homeStepsNow.find(s => s.id === id);
    if (!x || x.done) return;
    if (id === 'retry') UI_ACTIONS.trainingRetry(null, null);
    else if (id === 'due') startDailyReview();
    else if (id === 'news') {
        const answer = document.querySelector('#hp-news .hp-answer');
        if (answer) answer.click();
        else { const box = document.getElementById('hp-news'); if (box) box.scrollIntoView({ block: 'start' }); }
    } else if (id === 'endgame') startEndgame(x.arg);
}

// Répertoire vide : la carte choisie donne sa couleur à l'unique action.
function _homePick(c) {
    document.querySelectorAll('#hp-today .hp-pick').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.arg === c)));
    const cta = document.getElementById('hp-start-cta');
    if (!cta) return;
    cta.dataset.arg = c;
    cta.querySelector('span').textContent = 'Commencer avec les ' + (c === 'w' ? 'Blancs' : 'Noirs');
    if (typeof Dock !== 'undefined') Dock.refresh();
}
registerActions({ homePick: _homePick });

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

// Description du répertoire actif (menu ⋮, ou toucher la description sous « Jouer ») ; vide = effacée.
function editRepertoireNote() {
    const name = currentRepertoire;
    askText({ title: `Description de « ${name} »`, value: repertoireNote(name), placeholder: 'ex : Najdorf avec les Noirs, Italienne avec les Blancs',
              ok: 'Enregistrer', allowEmpty: true, max: REP_NOTE_MAX }, v => {
        setRepertoireNote(name, v);
        renderRepertoireList();
    });
}
registerActions({ editRepNote: editRepertoireNote });

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
    document.getElementById('rep-menu-note-label').textContent =
        repertoireNote(currentRepertoire) ? 'Modifier la description' : 'Ajouter une description';
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
    else if (action === 'note')   editRepertoireNote();
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
    const gs = document.getElementById('game-screen');
    if (gs) gs.dataset.mode = gameMode;                            // la mise en page sur téléphone en dépend (style.css)
    if (typeof _applySideTab === 'function') _applySideTab();     // l'arbre n'est disponible qu'en mode Jouer
    if (document.getElementById('topnav-tabs-setup').classList.contains('in-game')) _gameTabs(true);     // onglet du mode
    if (typeof Suite !== 'undefined') Suite.refresh();
}

// Affiche l'écran de jeu (commun aux modes jouer / aperçu / entraînement).
function showGameScreen(color) {
    boardFlipped = appSettings.autoFlip && color === 'b';      // Paramètres › Jeu : orienter selon ma couleur

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('setup-screen').classList.add('hidden');
    _gameTabs(true);
    document.getElementById('topnav-tabs-game').style.display  = '';

    const gs = document.getElementById('game-screen');
    gs.style.display = 'flex';
    gs.classList.remove('hidden');
    window.scrollTo({ top: 0 });                         // l'échiquier en haut, quel que soit le défilement de l'écran quitté

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

// Onglets de l'accueil pendant une partie : compacts dans la barre du haut (920 px et plus, css/home.css), cachés
// en dessous (la barre du bas laisserait moins de place à l'échiquier ; le menu « Plus » les reprend). L'onglet
// marqué est celui d'où vient le mode en cours ; un clic revient à l'accueil sur l'onglet choisi (switchHomeTab).
const GAME_MODE_TAB = { training: 'play', endgame: 'endgame', preview: 'stats' };
function _gameTabs(inGame) {
    const bar = document.getElementById('topnav-tabs-setup');
    bar.classList.toggle('in-game', inGame);
    if (!inGame) return;
    const cur = gameMode === 'preview' && statsPreviewTarget && statsPreviewTarget.from === 'openings' ? 'openings' : GAME_MODE_TAB[gameMode] || 'play';
    HOME_TABS.forEach(t => { const el = document.getElementById('nav-tab-' + t); if (el) el.classList.toggle('active', t === cur); });
}

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
    _gameTabs(false);
    document.getElementById('topnav-tabs-game').style.display  = 'none';
    switchHomeTab(typeof tab === 'string' ? tab : 'play');
    renderRepertoireList();
}

registerActions({ selectRepertoire, resumeLastPlay, createRepertoire: () => createRepertoirePrompt(), homeImportPgn: () => showPgnImport(),
    homeReview: () => startDailyReview(), homeGo: () => { const x = _homeStepsNow.find(s => !s.done); if (x) homeRunStep(x.id); },
    homeStep: id => homeRunStep(id), homeAddLine: c => startGame(c), homeExercises: () => switchHomeTab('training') });

// ─── INITIALISATION ───────────────────────────────────────────────────────────

(function init() {
    document.getElementById('game-screen').style.display = 'none';
    loadTheme();
    migrateStoredData();                    // clés de position et notations au format actuel (une fois par appareil)
    purgeExpiredTrash();                    // corbeille : purge des éléments de plus de 30 jours
    renderRepertoireList();
    updateTrashBadges();
    if (typeof SeenPositions !== 'undefined') setTimeout(() => SeenPositions.refresh(), 800);   // filtre « Vu en partie », après le premier rendu
})();

function createRepertoirePrompt() {
    askText({ title: 'Nouveau répertoire', placeholder: 'ex : Défense Sicilienne', ok: 'Créer',
              validate: n => loadRepertoireList().includes(n) ? 'Ce répertoire existe déjà.' : '' }, name => {
        const clean = addRepertoire(name);
        if (clean) selectRepertoire(clean);
    });
}

function renameRepertoirePrompt(name) {
    if (name === DEFAULT_REPERTOIRE) { alert('Le répertoire par défaut ne peut pas être renommé.'); return; }
    askText({ title: 'Renommer le répertoire', value: name, ok: 'Renommer',
              validate: n => n === name ? 'Choisissez un nom différent.' : loadRepertoireList().includes(n) ? 'Ce nom est déjà utilisé.' : '' }, n => {
        const clean = renameRepertoire(name, n);
        if (clean) selectRepertoire(clean);
    });
}
