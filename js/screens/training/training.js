/**
 * screens/training/training.js
 * ──────────────────────────────────────────────────────────────────────────
 * Moteur de l'Entraînement (l'onglet lui-même est rendu par trainingUI.js).
 *
 * Deux façons de poser les positions :
 *   1. Séance guidée (startSession) : une liste connue d'avance, avec barre de progression et bilan.
 *        due     Révision du jour : positions dont la révision est due
 *        weak    Points faibles : positions à retravailler ou fragiles
 *        unsure  À confirmer : positions jouées moins de STATS_CONFIRM_TRIES fois sans erreur
 *        review  Liste donnée par l'onglet Statistiques (startReviewQueue)
 *        retry   Erreurs d'une séance précédente
 *        line    Ligne complète : une ouverture jouée du premier coup jusqu'au bout de la variante
 *        timed   Contre-la-montre : TRAIN_TIMED_MS pour enchaîner un maximum de bons coups
 *      Une position ratée au premier essai revient une fois en fin de séance (sauf ligne et chrono) ;
 *      seul le premier essai compte pour le bilan. Les essais comptent dans les statistiques comme partout.
 *   2. Mode libre (startTraining) : tirage aléatoire pondéré sans fin (cf. _trainingWeight).
 *      Ses options (Paramètres › Jeu et entraînement) : profondeur max, départ, nombre de coups à enchaîner.
 *
 * Pour chaque position : l'échiquier se place 3 demi-coups avant, rejoue automatiquement ces trois coups
 * (contexte, touchez l'échiquier pour passer), puis me rend la main.
 *   Une seule note par passage, donnée par le premier coup ; le deuxième passage d'une séance n'en donne pas :
 *   - succès : attempts + 1, score de maîtrise et planning de révision mis à jour (recordReview, storage.js)
 *   - erreur : coup refusé, attempts + 1 et failures + 1, la position entre dans la file « À revoir » ; on réessaie,
 *     sans rien compter de plus (erreurs suivantes comme réussite finale).
 *   - solution : 2e appui sur Indice (cf. showHint) ; compte comme une erreur, aucune réussite comptée.
 */

'use strict';

const TRAIN_STEP_MS = 750;
const TRAIN_CONTEXT_PLIES = 4;   // demi-coups rejoués avant que la main soit rendue (refonte « Chays sans détour », lot 4 : la position arrive par sa ligne)

// Afficher la solution compte comme un échec sur la position (attempts + 1, failures + 1), une seule fois.
// Mettre à false pour que la solution ne modifie aucune statistique.
const TRAIN_SOLUTION_PENALTY = true;

const TRAIN_RECORD_KEY   = 'chessTrainer_timedRecord';      // record du contre-la-montre (synchronisé : le plus grand l'emporte)
const TRAIN_SEQ_END      = 999;
const TRAIN_TIMED_MS     = 3 * 60000;
const TRAIN_TIMED_PENALTY_MS = 10000;                       // une erreur au contre-la-montre coûte 10 s

const trainingState = {
    busy: false, timers: [], lastKey: null, current: null, ok: 0, reason: '', mixed: false,
    seq: { len: 1, done: 0, assisted: false },
    solutionFor: null,
    session: null,          // séance guidée en cours (cf. startSession)
    lastSummary: null,      // bilan de la dernière séance, affiché par l'onglet Entraînement
    keyErred: false,        // erreur (ou solution) sur la position posée
    keyLv: null,            // niveau de la position posée avant le coup (bilan : avant → après)
    combo: 0,               // série en cours de positions réussies du premier coup (séance guidée)
    ctxSkip: null,          // passe la mise en situation en cours
    tick: null,             // minuteur du contre-la-montre
    drill: { erred: false, keys: [], answered: null },   // exercice en cours : erreur ou solution, positions posées, dernière réponse
    pause: null,            // fin d'exercice en attente : { key } de la position répondue (Suivant, Analyser, Modifier le coup)
    editing: null           // « Modifier le coup » : position dont on attend le nouveau coup
};

// ─── OPTIONS DU MODE LIBRE (préférences synchronisées, settings.js) ───────────

const _FREE_PREFS = { maxPlies: 'freeMaxPlies', seqLen: 'freeSeqLen', fromStart: 'freeFromStart' };
const trainingSettings = {
    get maxPlies()  { return appSettings.freeMaxPlies; },
    get seqLen()    { return appSettings.freeSeqLen; },
    get fromStart() { return appSettings.freeFromStart; }
};

function setTrainingOption(name, value) {
    const key = _FREE_PREFS[name], v = Number(value);
    if (!key || !SYNCED_PREFS[key].ok(v)) return;
    appSettings[key] = v;
    saveSettings();
    initTraining();
}

// Ancien nom du record du contre-la-montre (chessTrainer.timedRecord) : repris une fois.
(function migrateTimedRecord() {
    const OLD = 'chessTrainer.timedRecord', old = dataStore.get(OLD);
    if (old === null) return;
    if (dataStore.get(TRAIN_RECORD_KEY) === null) dataStore.set(TRAIN_RECORD_KEY, old);
    dataStore.remove(OLD);
})();

function _entryDepth(e) { return e.ply || (e.path && e.path.length) || null; }

// Profondeur max : ne filtre que le mode libre (une séance guidée pose exactement sa liste).
function _isEligible(e) {
    if (trainingState.session || !trainingSettings.maxPlies) return true;
    const d = _entryDepth(e);
    return d !== null && d <= trainingSettings.maxPlies;
}

function _later(fn, ms) { trainingState.timers.push(setTimeout(fn, ms)); }

function stopTraining() {
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    trainingState.busy   = false;
    trainingState.ctxSkip = null;
    trainingState.pause  = null;
    trainingState.editing = null;
    _syncAfterTools();
}

// ─── VU EN PARTIE ─────────────────────────────────────────────────────────────
// Préférence trainSeen : exercices limités aux positions atteintes dans mes parties (SeenPositions). Ici, le tirage
// du mode libre et du contre-la-montre ; le menu (trainingUI.js) filtre les listes. Jamais la Révision du jour.
// Suspendu sous SeenPositions.MIN positions vues dans la portée (archive vide, appareil neuf).
function trainingSeenOnly(colors) {
    if (!appSettings.trainSeen || typeof SeenPositions === 'undefined' || !SeenPositions.ready()) return false;
    return SeenPositions.countIn(currentRepertoire, colors || ['w', 'b']) >= SeenPositions.MIN;
}
const _seenPick = only => (color, key) => !only || SeenPositions.has(color, key);

// ─── MODE LIBRE ───────────────────────────────────────────────────────────────

// Univers de révision : positions du répertoire respectant la profondeur maximale choisie (et vues en partie).
function _trainingPool() {
    const ok = _seenPick(trainingSeenOnly());
    return Object.keys(openingDB).filter(k => _isEligible(openingDB[k]) && ok(playerColor, k));
}

const _hasPool = (c, ok) => Object.entries(readDBFor(currentRepertoire, c)).some(([k, e]) => _isEligible(e) && ok(c, k));

// Couleur tirée à pile ou face pour l'exercice suivant (mode mélangé) ; null si aucune position.
function _pickTrainingColor(colors) {
    const ok = _seenPick(trainingSeenOnly(colors));
    colors = (colors || ['w', 'b']).filter(c => _hasPool(c, ok));
    return colors.length ? colors[Math.floor(Math.random() * colors.length)] : null;
}

// Changement de couleur depuis le badge de la barre du haut (quitte le mode mélangé).
function switchTrainingColor(color) {
    if (!_hasPool(color, _seenPick(trainingSeenOnly()))) {
        setStatus(`Aucune position ${color === 'w' ? 'Blancs' : 'Noirs'} à réviser dans ce répertoire.`, 'info');
        return;
    }
    startTraining(color);
}

// Mode libre ; color : 'w' | 'b' | 'mix' (Blancs et Noirs mélangés).
function startTraining(color) {
    _clearSession();
    trainingState.mixed = color === 'mix';
    if (trainingState.mixed) color = _pickTrainingColor();
    if (!color) { trainingState.mixed = false; initTraining(); return; }
    playerColor = color;
    gameMode    = 'training';
    loadDB();
    if (!_trainingPool().length) { gameMode = 'play'; initTraining(); return; }
    trainingState.ok = 0;
    trainingState.lastKey = null;
    showGameScreen(color);
    _renderSessionBar();
    nextDrill();
}

// ─── SÉANCE GUIDÉE ────────────────────────────────────────────────────────────

// opts : { kind, label, items: [{ color, key }], returnTab, colors (chrono), line: { color, path, name } }
function startSession(opts) {
    _clearSession();
    const items = (opts.items || []).filter(it => readDBFor(currentRepertoire, it.color)[it.key]);
    if (opts.kind !== 'timed' && opts.kind !== 'line' && !items.length) return false;
    const S = trainingState.session = {
        kind: opts.kind, label: opts.label, returnTab: opts.returnTab || 'training',
        items: items.map(it => ({ color: it.color, key: it.key, res: null, second: false })),
        i: 0, cur: -1, results: new Map(), line: opts.line || null, colors: opts.colors || ['w', 'b'],
        started: Date.now(), end: opts.kind === 'timed' ? Date.now() + TRAIN_TIMED_MS : 0, score: 0
    };
    trainingState.mixed   = false;
    trainingState.ok      = 0;
    trainingState.lastKey = null;
    trainingState.combo   = 0;
    gameMode = 'training';
    playerColor = S.kind === 'line' ? S.line.color : S.kind === 'timed' ? (_pickTrainingColor(S.colors) || 'w') : S.items[0].color;
    loadDB();
    showGameScreen(playerColor);
    if (S.kind === 'timed') trainingState.tick = setInterval(_timedTick, 250);
    _renderSessionBar();
    nextDrill();
    return true;
}

// Liste donnée par l'onglet Statistiques ; returnTab = onglet rouvert à la fin.
function startReviewQueue(items, returnTab) {
    return startSession({ kind: 'review', label: 'Révision', items, returnTab });
}

function _clearSession() {
    if (trainingState.tick) clearInterval(trainingState.tick);
    trainingState.tick = null;
    trainingState.session = null;
}

// Position suivante de la séance (l'élément en cours est clos : réussi, raté ou passé).
function _nextSessionDrill() {
    const S = trainingState.session;
    if (S.cur >= 0) {
        const it = S.items[S.cur];
        if (!it.res) it.res = 'skip';
        S.i = S.cur + 1;
        S.cur = -1;
    }
    if (S.kind === 'timed') {
        if (Date.now() >= S.end) { _endSession(); return; }
        const c = _pickTrainingColor(S.colors);
        if (!c) { _endSession(); return; }
        if (c !== playerColor) { playerColor = c; loadDB(); showGameScreen(c); }
        const key = _pickDrill();
        S.items.push({ color: c, key, res: null, second: false });
        S.cur = S.items.length - 1;
        _startDrill(key, 1, { noContext: true });
        return;
    }
    if (S.kind === 'line') {
        if (S.i > 0) { _endSession(); return; }       // une seule partie de la ligne
        S.cur = 0;
        S.items = [];
        if (!_startFullLine()) { setStatus('Aucune ligne enregistrée pour cette ouverture.', 'info'); _later(() => _endSession(), 1200); }
        return;
    }
    while (S.i < S.items.length) {
        const it = S.items[S.i];
        if (it.color !== playerColor) { playerColor = it.color; loadDB(); showGameScreen(it.color); }
        if (openingDB[it.key]) { S.cur = S.i; _startDrill(it.key, 1); return; }
        it.res = 'skip';
        S.i++;
    }
    _endSession();
}

// Résultat du coup joué sur la position posée (première fois seulement : c'est elle que le bilan retient).
function _sessionRecord(key, ok) {
    const S = trainingState.session;
    if (!S) return;
    if (!S.results.has(key)) {
        const e = openingDB[key];
        S.results.set(key, { key, color: playerColor, ok, lvBefore: trainingState.keyLv || (e ? _level(e) : 'unsure') });
        trainingState.combo = ok ? trainingState.combo + 1 : 0;
        if (ok && S.kind === 'timed') S.score++;
    }
    const it = S.items[S.cur];
    if (it && it.key === key && !it.res) it.res = ok ? 'ok' : 'ko';
    if (S.kind === 'line' && !S.items.some(x => x.key === key)) S.items.push({ color: playerColor, key, res: ok ? 'ok' : 'ko' });
}

// Première erreur sur une position de la liste : elle revient une fois en fin de séance.
function _sessionMistake(key) {
    const S = trainingState.session;
    if (!S) return;
    if (S.kind === 'timed') { S.end -= TRAIN_TIMED_PENALTY_MS; _renderSessionBar(); return; }
    if (S.kind === 'line') return;
    const it = S.items[S.cur];
    if (it && it.key === key && !it.second && !S.items.some(x => x.second && x.key === key)) {
        S.items.push({ color: it.color, key, res: null, second: true });
        _renderSessionBar();
    }
}

function _timedTick() {
    const S = trainingState.session;
    if (!S || S.kind !== 'timed' || gameMode !== 'training') { _clearSession(); return; }
    if (Date.now() >= S.end) { stopTraining(); _endSession(); return; }
    _renderSessionBar();
}

// Fin de séance (ou « Quitter » en cours de séance) : bilan, puis retour à l'onglet d'origine.
// stay : l'écran de jeu est quitté par ailleurs (logo, barre du haut) : bilan gardé, aucune navigation.
function _endSession(early, stay) {
    const S = trainingState.session;
    if (!S) return;
    const first = [...S.results.values()];
    const dbs = { w: readDBFor(currentRepertoire, 'w'), b: readDBFor(currentRepertoire, 'b') };
    const rows = first.map(r => {
        const e = dbs[r.color][r.key];
        return { ...r, e, lvAfter: e ? _level(e) : r.lvBefore };
    }).filter(r => r.e);
    let record = 0, newRecord = false;
    if (S.kind === 'timed') {
        record = Number(dataStore.getJSON(TRAIN_RECORD_KEY, 0)) || 0;
        if (S.score > record) { newRecord = record > 0 || S.score > 0; record = S.score; dataStore.setJSON(TRAIN_RECORD_KEY, record); }
    }
    const summary = {
        kind: S.kind, label: S.label, line: S.line, early: !!early, minutes: Math.max(1, Math.round((Date.now() - S.started) / 60000)),
        total: rows.length, ok: rows.filter(r => r.ok).length, rows, score: S.score, record, newRecord,
        colors: S.colors, returnTab: S.returnTab
    };
    _clearSession();
    stopTraining();
    _renderSessionBar();
    const back = summary.returnTab;
    if (back === 'training' && (rows.length || !stay)) trainingState.lastSummary = summary;
    if (typeof Suite !== 'undefined') Suite.refresh();
    if (stay) return;
    if (early || !rows.length) { goHome(back); return; }
    playSound('end');
    const msg = summary.kind === 'timed' ? `Temps écoulé · ${summary.score} bon${summary.score > 1 ? 's' : ''} coup${summary.score > 1 ? 's' : ''}`
        : `Séance terminée · ${summary.ok}/${summary.total} du premier coup`;
    setStatus(msg, 'ok', back === 'stats' ? 'Retour aux statistiques…' : 'Bilan de la séance…');
    _later(() => goHome(back), 1600);
}

// Bouton « Quitter » : bilan de ce qui a été joué (séance guidée), puis retour à l'onglet d'origine.
// Écran de jeu quitté sans « Quitter » (logo, pilule du répertoire, Données…) : la séance en cours
// est close, son bilan gardé, pour que le mode libre et le badge de couleur ne la voient plus.
function abandonSession() {
    const S = trainingState.session;
    if (!S) return;
    if (S.results.size) _endSession(true, true);
    else _clearSession();
}

function quitTraining() {
    const S = trainingState.session;
    if (S && S.results.size) { _endSession(true); return; }
    const back = S ? S.returnTab : 'training';
    _clearSession();
    goHome(back);
}

// Barre au-dessus de l'échiquier : progression de la séance, ou chrono. Barre fine, compteur « 7 / 18 »
// en Plex Mono ; sur ordinateur, elle tient dans la marge du haut (aucune hauteur ajoutée à l'échiquier).
function _renderSessionBar() {
    if (typeof Suite !== 'undefined') Suite.refresh();
    const el = document.getElementById('tr-progress');
    if (!el) return;
    const S = trainingState.session;
    el.hidden = !(S && gameMode === 'training');
    if (el.hidden) { el.innerHTML = ''; return; }
    const okFirst = [...S.results.values()].filter(r => r.ok).length;
    if (S.kind === 'timed') {
        const left = Math.max(0, S.end - Date.now()), s = Math.ceil(left / 1000);
        el.innerHTML = `<div class="tr-prog-bar tr-prog-time" role="img" aria-label="Temps restant"><i style="width:${(100 * left / TRAIN_TIMED_MS).toFixed(1)}%"></i></div>
            <div class="tr-prog-l"><span><b class="tr-prog-n">${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b> restantes</span><span><b class="tr-prog-n">${S.score}</b> bon${S.score > 1 ? 's' : ''} coup${S.score > 1 ? 's' : ''}</span></div>`;
        return;
    }
    if (S.kind === 'line') {
        el.innerHTML = `<div class="tr-prog-l"><span>Ligne complète · <b>${escapeHtml(S.line.name)}</b></span><span><b class="tr-prog-n">${S.results.size}</b> ${S.results.size > 1 ? 'coups' : 'coup'} · ${okFirst} du premier coup</span></div>`;
        return;
    }
    const n = S.items.length, pos = Math.min(n, (S.cur >= 0 ? S.cur : S.i) + 1);
    const again = S.items.filter(x => x.second && !x.res).length, combo = trainingState.combo;
    el.innerHTML = `<div class="tr-prog-bar${n > 40 ? ' dense' : ''}" role="progressbar" aria-label="${escapeHtml(S.label)}" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${pos}" aria-valuetext="Position ${pos} sur ${n}">${S.items.map((x, i) =>
        `<i class="${i === S.cur ? 'cur' : x.res === 'ok' ? 'ok' : x.res === 'ko' ? 'ko' : x.res === 'skip' ? 'skip' : x.second ? 'again' : ''}"></i>`).join('')}</div>
        <div class="tr-prog-l"><span><b class="tr-prog-n">${pos} / ${n}</b> ${escapeHtml(S.label.toLowerCase())}</span><span>${combo >= 3 ? `<b class="tr-combo">×${combo} sans faute</b> · ` : ''}${okFirst} du premier coup${again ? ` · ${again} à revoir à la fin` : ''}</span></div>`;
}

// ─── POIDS DE TIRAGE (répétition espacée, sélection probabiliste continue) ──
//   poids = ( facteur d'échec × facteur d'oubli ) ^ TRAIN_SHARPNESS
//
//   facteur d'échec = PLANCHER_ÉCHEC + erreur relative × volume
//     erreur relative = (échecs + 0,6) / (essais + 2)  → lissée : 3/3 pèse plus que 1/1,
//                                                         100 % de réussite sur beaucoup d'essais → proche de 0
//     volume          = 1 + 0,25 × ln(1 + échecs)        → davantage d'échecs = davantage de poids
//   facteur d'oubli = PLANCHER_ÂGE + (1 − e^(−jours / 3))
//     ≈ 0 juste après un passage, ≈ 0,63 à 3 jours, ≈ 0,9 à 7 jours ; sans lastReviewed : 30 jours.
//   Les deux planchers garantissent un poids toujours strictement positif.

const TRAIN_FAIL_FLOOR  = 0.04;
const TRAIN_AGE_FLOOR   = 0.03;
const TRAIN_TAU_DAYS    = 3;
const TRAIN_UNSEEN_DAYS = 30;
const TRAIN_SHARPNESS   = 1.5;      // > 1 : accentue l'écart entre positions prioritaires et acquises
const TRAIN_NOT_DUE     = 0.25;     // facteur appliqué aux positions dont la révision n'est pas encore due

function _ageDays(e, now) {
    return e.lastReviewed ? Math.max(0, (now - e.lastReviewed) / DAY_MS) : TRAIN_UNSEEN_DAYS;
}

function _failureFactor(e) {
    const err    = 1 - masteryOf(e) / 100;
    const volume = 1 + 0.25 * Math.log(1 + e.failures);
    return TRAIN_FAIL_FLOOR + err * volume;
}

function _forgetFactor(e, now) {
    return TRAIN_AGE_FLOOR + (1 - Math.exp(-_ageDays(e, now) / TRAIN_TAU_DAYS));
}

// freqFactor (moveStats.js) : une position où l'adversaire arrive souvent sort plus souvent (option Paramètres).
function _trainingWeight(e, now) {
    const freq = typeof freqFactor === 'function' ? freqFactor(e, playerColor) : 1;
    return Math.pow(_failureFactor(e) * _forgetFactor(e, now), TRAIN_SHARPNESS) * (isDue(e, now) ? 1 : TRAIN_NOT_DUE) * freq;
}

// Probabilités de sortie : poids normalisés sur l'univers. Si le répertoire compte plusieurs
// positions, celle qui vient de sortir est exclue AVANT normalisation (jamais deux fois de suite).
function _trainingDistribution(excludeKey) {
    const now   = Date.now();
    let items   = _trainingPool().map(k => ({ key: k, w: _trainingWeight(openingDB[k], now) }));
    if (items.length > 1) items = items.filter(x => x.key !== excludeKey);
    const total = items.reduce((sum, x) => sum + x.w, 0);
    items.forEach(x => { x.p = x.w / total; });
    return items;
}

function _pickDrill() {
    const dist = _trainingDistribution(trainingState.lastKey);
    let r = Math.random();
    for (const x of dist) { r -= x.p; if (r <= 0) return x.key; }
    return dist[dist.length - 1].key;
}

// Raison affichée au début de l'exercice.
function _ageLabel(e, now) {
    if (!e.lastReviewed) return 'non revu depuis longtemps';
    const min = (now - e.lastReviewed) / 60000;
    if (min < 60)   return `revu il y a ${Math.max(1, Math.round(min))} min`;
    if (min < 1440) return `revu il y a ${Math.round(min / 60)} h`;
    const d = Math.floor(min / 1440);
    if (d < 14)     return `non revu depuis ${d} jour${d > 1 ? 's' : ''}`;
    const w = Math.floor(d / 7);
    return `non revu depuis ${w} semaine${w > 1 ? 's' : ''}`;
}

// Nom de l'ouverture d'une entrée, dit pendant la mise en situation et sous « À vous de jouer » (lot 4).
function _drillOpening(e) {
    const op = e && e.path && e.path.length && typeof openingNameOf === 'function' ? openingNameOf(e.path) : null;
    return op ? op.name : '';
}

function _drillReason(e) {
    const now = Date.now();
    if (trainingState.session && trainingState.session.items[trainingState.session.cur] && trainingState.session.items[trainingState.session.cur].second)
        return 'Deuxième passage : erreur plus tôt dans la séance';
    if (Number.isInteger(e.relearn)) return `À revoir · ${e.relearn} / ${RELEARN_DAYS.length}`;
    if (e.failures === 0 || !e.attempts) return `Entretien · 100% de réussite · ${_ageLabel(e, now)}`;
    const m = Math.round(masteryOf(e));
    if (m <= 50)                  return `Position critique · maîtrise ${m} / 100`;
    if (_ageDays(e, now) >= 2)    return `À réviser · ${_ageLabel(e, now)}`;
    return `À consolider · maîtrise ${m} / 100 · ${_ageLabel(e, now)}`;
}

// Retrouve la ligne menant à une clé de position en rejouant les chemins des autres entrées
// (la position d'une entrée sans `path` est un ancêtre des entrées plus profondes).
// Renvoie un tableau UCI (peut être vide = position initiale) ou null si introuvable.
function _findPathToKey(key) {
    return _withEngineSnapshot(() => {
        parseFEN(INIT_FEN);
        if (positionKey() === key) return [];
        for (const k of Object.keys(openingDB)) {
            const p = openingDB[k].path;
            if (!p || !p.length) continue;
            parseFEN(INIT_FEN);
            try {
                for (let i = 0; i < p.length; i++) {
                    _applyUciRaw(p[i]);
                    if (positionKey() === key) return p.slice(0, i + 1);
                }
            } catch (_) { /* chemin corrompu : on passe au suivant */ }
        }
        return null;
    });
}

// ─── BOUCLE D'ENTRAÎNEMENT ────────────────────────────────────────────────────

function nextDrill() {
    stopTraining();
    if (trainingState.session) { _nextSessionDrill(); return; }
    if (trainingState.mixed) {
        const c = _pickTrainingColor();
        if (c && c !== playerColor) { playerColor = c; loadDB(); showGameScreen(c); }
    }
    if (!_trainingPool().length) { setStatus('Aucune position dans ce répertoire.', 'info'); return; }
    if (trainingSettings.fromStart === 1 && _startFullLine()) return;     // sinon : repli sur une position ciblée

    _startDrill(_pickDrill(), trainingSettings.seqLen);
}

// Pose la position `key` (mise en situation puis main rendue) ; seqLen = coups à enchaîner ;
// opts.noContext : position posée directement (contre-la-montre).
function _startDrill(key, seqLen, opts) {
    const entry = openingDB[key];
    resetNavCursor();                                   // une navigation dans la position précédente ne déborde pas
    trainingState.current     = key;
    trainingState.reason      = _drillReason(entry);
    trainingState.lastKey     = key;
    trainingState.busy        = true;
    trainingState.solutionFor = null;
    trainingState.seq         = { len: seqLen, done: 0, assisted: false };
    trainingState.drill       = { erred: false, keys: [], answered: null };
    _renderSessionBar();

    // Chemin absent ou vide : reconstitution via les autres entrées, puis auto-réparation de l'entrée.
    let fullPath = (entry.path && entry.path.length) ? entry.path : null;
    if (!fullPath) {
        const pre = _findPathToKey(key);
        if (pre) {
            fullPath = pre.concat(entry.move);
            entry.path = fullPath;
            entry.ply  = fullPath.length;
            saveDB();
        }
    }

    if (fullPath && opts && opts.noContext) {
        loadPositionFromPath(fullPath.slice(0, -1), { animateLast: true });   // contre-la-montre : le coup adverse est animé
        _drillReady();
    } else if (fullPath) {
        const n     = fullPath.length - 1;               // coups avant ma réponse
        const start = Math.max(0, n - TRAIN_CONTEXT_PLIES);
        const ctx   = fullPath.slice(start, n);
        loadPositionFromPath(fullPath.slice(0, start));
        setStatus('Mise en situation…', 'info', ctx.length ? _drillOpening(entry) : trainingState.reason, ctx.length ? {
            action: 'Sauter', title: 'Passer la mise en situation', run: () => { if (trainingState.ctxSkip) trainingState.ctxSkip(); }
        } : null);
        ctx.forEach((u, i) => _later(() => {
            const m = _parseUci(u);
            playBoardMoveSound(m.from, m.to, m.promo);
            animateNextMove(m.from, m.to);
            applyMove(m.from, m.to, m.promo);            // applyMove appelle renderMoves()
            renderBoard();
        }, TRAIN_STEP_MS * (i + 1)));
        _later(_drillReady, TRAIN_STEP_MS * ctx.length + 300);
        trainingState.ctxSkip = () => {                  // touche sur l'échiquier : position posée tout de suite
            stopTraining();
            trainingState.busy = true;
            loadPositionFromPath(fullPath.slice(0, -1));
            _drillReady();
        };
    } else {
        // Dernier recours : aucune ligne connue → position posée directement (historique vide inévitable).
        loadPositionFromPath([]);
        parseFEN(key);
        renderMoves();
        renderBoard();
        _drillReady();
    }
}

// Passer la mise en situation : un appui sur l'échiquier pendant qu'elle se joue.
(function initContextSkip() {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;
    boardEl.addEventListener('pointerdown', e => {
        if (gameMode !== 'training' || !trainingState.ctxSkip) return;
        e.stopPropagation();
        e.preventDefault();
        trainingState.ctxSkip();
    }, true);
})();

function _seqLabel() {
    const s = trainingState.seq;
    if (s.len <= 1) return '';
    return ` · coup ${s.done + 1}${s.len < TRAIN_SEQ_END ? '/' + s.len : ''}`;
}

// La main est rendue au joueur sur une nouvelle position.
function _positionPosed() {
    const e = openingDB[positionKey()];
    trainingState.drill.keys.push(positionKey());
    trainingState.keyErred = false;
    trainingState.keyLv = e ? _level(e) : null;
}

function _drillReady() {
    trainingState.ctxSkip = null;
    const key = trainingState.current;
    if (positionKey() !== key) {
        const entry = openingDB[key];
        if (entry && entry.path && entry.path.length) {
            // Resynchronisation complète ET historique reconstruit (jamais vidé).
            loadPositionFromPath(entry.path.slice(0, -1));
        }
        if (positionKey() !== key) {
            // Sans toucher à moveHistory : on ne force que l'état du moteur.
            const prevHistory = moveHistory;
            parseFEN(key);
            moveHistory = prevHistory;
            selected = null; legalMoves = []; hintPiece = null; awaitingPromotion = null;
        }
        renderMoves();
        renderBoard();
    }
    trainingState.busy = false;
    _positionPosed();
    _renderSessionBar();
    setStatus(`À vous de jouer${_seqLabel()}`, 'info', _readyDetail());
}

// ─── NAVIGATION EN SÉANCE ─────────────────────────────────────────────────────
// ◀ ▶ et les flèches revoient les coups déjà joués (jamais pendant la mise en situation ni un coup adverse :
// trainingState.busy). Toucher l'échiquier, l'Indice ou la Solution ramène d'abord à la position en cours :
// on ne rejoue jamais depuis le passé (en Jouer, cela ouvrirait une nouvelle variante), la séance reste intacte.
// La position cherchée n'est jamais dans l'historique : naviguer ne dévoile pas la réponse.
function trainingBackToLive() {
    if (gameMode !== 'training' || navCursor === -1) return false;
    navGo(moveHistory.length - 1);
    return true;
}
// Retour à la position en cours : la consigne de la séance revient (navGo).
function trainingLiveStatus() {
    if (gameMode !== 'training' || trainingState.busy || turn !== playerColor) return false;
    setStatus(`À vous de jouer${_seqLabel()}`, 'info', _readyDetail());
    return true;
}

// Sous-texte de « À vous de jouer ». En séance, la barre de progression dit déjà où l'on en est :
// seulement l'ouverture (ou le deuxième passage). En mode libre : la raison du tirage et les réussites.
function _readyDetail() {
    const S = trainingState.session;
    if (!S) return [_drillOpening(openingDB[trainingState.current]), trainingState.reason].filter(Boolean).join(' · ')
        + (trainingState.ok ? ` · ${trainingState.ok} réussi${trainingState.ok > 1 ? 's' : ''}` : '');
    const it = S.items[S.cur];
    if (it && it.second) return 'Deuxième passage';
    if (S.kind === 'line') return '';
    return _drillOpening(openingDB[trainingState.current]);
}

// ─── LIGNE COMPLÈTE (depuis la position initiale) ─────────────────────────────
// Blancs : la main est rendue tout de suite. Noirs : l'ordinateur joue d'abord un coup du répertoire.
// Puis la séquence continue jusqu'à la fin de la variante (cf. _continueSequence).
// Renvoie false si aucune ligne ne part de la position initiale (entrées sans chemin connu).
function _startFullLine() {
    const S = trainingState.session;
    trainingState.reason      = S && S.line ? S.line.name : 'Ligne complète';
    trainingState.seq         = { len: TRAIN_SEQ_END, done: 0, assisted: false };
    trainingState.solutionFor = null;
    trainingState.busy        = true;
    resetNavCursor();
    loadPositionFromPath([]);
    trainingState.current = trainingState.lastKey = positionKey();
    if (playerColor === 'w') {
        if (!openingDB[trainingState.current] || !_isEligible(openingDB[trainingState.current])) return false;
        _later(_drillReady, 300);
        return true;
    }
    const opp = _pickOppContinuation([]);
    if (!opp) return false;
    setStatus('Ligne complète · l\'adversaire commence…', 'info');
    _playOpponentReply(opp);
    return true;
}

// ─── SÉQUENCE : RÉPONSE ADVERSE ENREGISTRÉE ───────────────────────────────────

// Coups adverses UCI qui prolongent la ligne jouée et mènent à une position de mon répertoire
// (une entrée dont le `path` vaut ligne + coup adverse + mon coup). Tirage pondéré : chaque branche
// pèse autant que la position la plus prioritaire qu'elle contient (cf. _trainingWeight), pour
// guider vers ce qui est à réviser. Ligne complète d'une ouverture : seules les entrées qui suivent
// ses coups sont retenues. null = fin de la variante (ou limite de profondeur).
function _pickOppContinuation(line) {
    const n = line.length, valid = new Set(), weight = new Map(), now = Date.now();
    const S = trainingState.session, pre = S && S.kind === 'line' ? S.line.path : null;
    for (const k in openingDB) {
        const e = openingDB[k], p = e.path;
        if (!p || p.length < n + 2 || !_isEligible(e)) continue;
        let match = true;
        for (let i = 0; i < n; i++) if (p[i] !== line[i]) { match = false; break; }
        if (match && pre) for (let i = 0; i < pre.length && i < p.length; i++) if (p[i] !== pre[i]) { match = false; break; }
        if (!match) continue;
        if (p.length === n + 2) valid.add(p[n]);
        weight.set(p[n], Math.max(weight.get(p[n]) || 0, _trainingWeight(e, now)));
    }
    const arr = [...valid];
    if (!arr.length) return null;
    let r = Math.random() * arr.reduce((s, u) => s + weight.get(u), 0);
    for (const u of arr) { r -= weight.get(u); if (r <= 0) return u; }
    return arr[arr.length - 1];
}

// Joue le coup adverse puis rend la main, ou termine l'exercice si la position atteinte n'est pas
// au répertoire.
function _playOpponentReply(opp) {
    _later(() => {
        const m   = _parseUci(opp);
        const san = formatSanText(toAlgebraic(m.from, m.to, m.promo), turn);
        playBoardMoveSound(m.from, m.to, m.promo);
        animateNextMove(m.from, m.to);
        applyMove(m.from, m.to, m.promo);
        selected = null; legalMoves = []; hintPiece = null;
        renderBoard();
        if (openingDB[positionKey()]) {
            trainingState.solutionFor = null;
            trainingState.busy = false;
            _positionPosed();
            _renderSessionBar();
            setStatus(`Adversaire : ${san}`, 'info', `À vous de jouer${_seqLabel()}`);
        } else {
            setStatus('Fin de la variante.', 'ok');
            _finishDrill();
        }
    }, opponentDelay(TRAIN_STEP_MS));
}

// ─── FIN D'EXERCICE ───────────────────────────────────────────────────────────
// Préférence trainNext : 'error' (défaut) enchaîne seul après une réussite nette et s'arrête après une erreur,
// un indice ou la solution ; 'wait' s'arrête toujours ; 'auto' n'arrête jamais. Le contre-la-montre enchaîne toujours.
// À l'arrêt : « Suivant » (barre d'état, Entrée, P, centre du dock), Analyser et Modifier le coup (outils du mode).
const TRAIN_NEXT_MS = 1400;

function _drillSlipped() {
    const d = trainingState.drill;
    return d.erred || trainingState.seq.assisted || (typeof _hintKey !== 'undefined' && _hintKey !== null && d.keys.includes(_hintKey));
}

function _finishDrill() {
    if (!trainingState.seq.assisted) { trainingState.ok++; playSound('success'); }
    const S = trainingState.session;
    if (S && S.kind === 'timed') { _later(nextDrill, 500); return; }
    trainingState.pause = { key: trainingState.drill.answered || trainingState.current };
    _syncAfterTools();
    const pref = appSettings.trainNext;
    if (pref === 'auto' || (pref === 'error' && !_drillSlipped())) {
        _later(nextDrill, TRAIN_NEXT_MS);
        setStatusAction({ action: 'Rester ici', title: 'Ne pas enchaîner : rester sur cette position', run: trainingStay });
        return;
    }
    _offerNext();
}

function _offerNext() {
    setStatusAction({ action: 'Suivant', icon: 'skip-forward', title: 'Exercice suivant (Entrée)', run: () => nextDrill() });
}

// « Rester ici » : l'enchaînement prévu est annulé, la fin d'exercice attend.
function trainingStay() {
    if (!trainingState.pause) return;
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    _offerNext();
}

// Outils de fin d'exercice (Analyser, Modifier le coup) : actifs seulement à l'arrêt, hors modification en cours.
function _syncAfterTools() {
    const on = !!trainingState.pause && !trainingState.editing && gameMode === 'training';
    document.querySelectorAll('.tr-after').forEach(b => { b.disabled = !on; });
}

// Analyser : la ligne jouée s'ouvre dans l'Analyse ; Quitter (Q) revient à l'exercice suivant de la même séance.
function trainingAnalyse() {
    if (!trainingState.pause || gameMode !== 'training') return;
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    trainingBackToLive();
    const color = playerColor;
    openAnalysis(undefined, undefined, () => {
        gameMode = 'training';
        playerColor = color;
        loadDB();
        showGameScreen(color);
        _renderSessionBar();
        nextDrill();
    });
}

// Modifier le coup : l'échiquier revient avant ma réponse ; le coup joué ensuite la remplace, après confirmation
// (l'ancien part à la corbeille 30 jours, comme « Remplacer » de l'arbre). Rien n'est compté.
function trainingEditMove() {
    const p = trainingState.pause, entry = p && openingDB[p.key];
    if (!entry || !entry.path || !entry.path.length || gameMode !== 'training') return;
    trainingState.timers.forEach(clearTimeout);
    trainingState.timers = [];
    resetNavCursor();
    loadPositionFromPath(entry.path.slice(0, -1));
    if (positionKey() !== p.key) { _offerNext(); return; }
    trainingState.editing = p.key;
    trainingState.busy = false;
    _syncAfterTools();
    setStatus('Modifier le coup', 'new', `Jouez le coup qui remplacera ${formatSanText(entry.san, turn)}.`, { action: 'Annuler', title: 'Garder le coup actuel', run: trainingEditCancel });
}

function trainingEditCancel() {
    const p = trainingState.pause, entry = p && openingDB[p.key];
    trainingState.editing = null;
    trainingState.busy = true;
    if (entry) loadPositionFromPath(entry.path);
    _syncAfterTools();
    setStatus('Coup gardé', 'info', entry ? `${formatSanText(entry.san, entry.ply % 2 === 1 ? 'w' : 'b')} reste votre réponse.` : '');
    _offerNext();
}

function _editPlayed(from, to, promo) {
    const key = trainingState.editing, entry = openingDB[key], mv = moveToStr(from, to, promo);
    if (!entry) { trainingEditCancel(); return; }
    if (mv === entry.move) { trainingEditCancel(); return; }
    const side = turn, san = toAlgebraic(from, to, promo), path = entry.path.slice(0, -1);
    const label = s => formatSanText(s, side);
    confirmDeleteEntry(key, `Remplacer ${label(entry.san)} par ${label(san)} ? L'ancien coup est conservé 30 jours dans la corbeille.`, extra => {
        openingDB[key] = newEntry(mv, san, path.concat(mv));
        saveDB();
        trainingState.editing = null;
        trainingState.busy = true;
        loadPositionFromPath(path.concat(mv));
        _syncAfterTools();
        setStatus('Coup remplacé', 'ok', `${label(san)} est votre nouvelle réponse ; elle passe en « À confirmer ».${extra ? ` ${extra} coup(s) orphelin(s) mis à la corbeille.` : ''}`);
        _offerNext();
    });
}

function _continueSequence() {
    const s = trainingState.seq;
    if (s.done < s.len) {
        const line = moveHistory.map(m => moveToStr(m.from, m.to, m.promo));
        const opp  = _pickOppContinuation(line);
        if (opp) { _playOpponentReply(opp); return; }
        if (s.len > 1) setStatus('✓ Fin de la variante.', 'ok');
    }
    _finishDrill();
}

// ─── SOLUTION ─────────────────────────────────────────────────────────────────

function showTrainingSolution() {
    if (gameMode !== 'training' || trainingState.busy || turn !== playerColor) return;
    trainingBackToLive();

    const key   = positionKey();
    const entry = openingDB[key];
    if (!entry) { setStatus('Aucune solution connue pour cette position.', 'info'); return; }

    if (trainingState.solutionFor !== key) {
        trainingState.solutionFor   = key;
        trainingState.seq.assisted  = true;
        trainingState.drill.erred   = true;
        const first = !trainingState.keyErred;
        if (first) _sessionMistake(key);
        trainingState.keyErred = true;
        if (TRAIN_SOLUTION_PENALTY && first && !_secondPass()) {
            entry.attempts++;
            entry.failures++;
            recordReview(entry, false);
            saveDB();
        }
    }
    revealSolution(entry);
    setStatus(`Solution : ${formatSanText(entry.san, turn)}`, 'hint', 'Jouez-le pour continuer (aucune réussite comptée).');
}

// ─── RÉPONSE DU JOUEUR ────────────────────────────────────────────────────────

// Deuxième passage d'une position ratée plus tôt dans la séance : il sert à retenir, il ne donne pas de note.
function _secondPass() {
    const S = trainingState.session, it = S && S.items[S.cur];
    return !!(it && it.second);
}

// Ce que le passage a changé : file « À revoir », sinon score de maîtrise.
function _answerDetail(entry, inFile, before) {
    if (inFile && !Number.isInteger(entry.relearn)) return 'Acquise : elle sort de la file À revoir.';
    if (Number.isInteger(entry.relearn)) return entry.relearn === inFile.step ? `À revoir : ${entry.relearn} / ${RELEARN_DAYS.length} · trop tôt pour avancer`
        : `À revoir : ${entry.relearn} / ${RELEARN_DAYS.length} · ${dueInLabel(entry.due)}`;
    return `Maîtrise : ${Math.round(before)} → ${entry.mastery}`;
}

// Appelé par executePlayerMove() en mode entraînement (le coup n'est pas encore appliqué).
// Le premier coup du passage décide : ni les essais suivants ni la réussite finale ne comptent.
// « Le trait gravé » : une position passe à Maîtrisée pendant la séance (réponse comptée, sans erreur).
// Le trait de la marque se grave après le titre de la barre d'état, avec la cloche de laiton (son « master », réglage Exercice réussi).
function _engraveMastered() {
    if (typeof Engrave !== 'undefined') Engrave.play(document.querySelector('#status-text .status-title') || document.getElementById('status-bar'));
    playSound('master');
}

function answerTrainingMove(entry, from, to, promo, movStr) {
    const key      = positionKey();
    const revealed = trainingState.solutionFor === key;
    const second   = _secondPass();

    if (entry && movStr === entry.move) {
        let msg = '✓ Bien joué !', detail = 'Deuxième passage : rien de plus n’est compté.', engraved = false;
        if (revealed) { msg = '✓ Solution jouée'; detail = 'Aucune réussite comptée.'; }
        else if (trainingState.keyErred) { msg = '✓ Bon coup'; detail = 'L’erreur est déjà comptée pour ce passage.'; }
        else if (!second) {
            const before = masteryOf(entry), lvBefore = _level(entry), inFile = Number.isInteger(entry.relearn) ? { step: entry.relearn } : null;
            entry.attempts++;
            recordReview(entry, true);
            saveDB();
            if (typeof Suite !== 'undefined') Suite.afterAnswer();
            detail = _answerDetail(entry, inFile, before);
            engraved = lvBefore !== 'mastered' && _level(entry) === 'mastered';
            if (engraved) msg = '✓ Maîtrisée';
        }
        _sessionRecord(key, !trainingState.keyErred && !revealed);
        trainingState.drill.answered = key;
        trainingState.busy = true;
        _commitMove(from, to, promo, null, msg, revealed ? 'info' : 'ok', detail);
        if (engraved) _engraveMastered();
        _renderSessionBar();
        trainingState.seq.done++;
        _continueSequence();
    } else if (entry && !revealed) {
        const first = !trainingState.keyErred;
        if (first && !second) {                        // erreur : comptée une fois, sur la position exacte
            entry.attempts++;
            entry.failures++;
            recordReview(entry, false);
            saveDB();
            if (typeof Suite !== 'undefined') Suite.afterAnswer();
        }
        if (first) { trainingState.combo = 0; _sessionMistake(key); }
        trainingState.keyErred = true;
        trainingState.drill.erred = true;
        const S = trainingState.session;
        const told = !first ? '' : S && S.kind === 'timed' ? '−10 s. ' : second ? '' : 'Elle passe dans la file À revoir. ';
        _rejectMove(to, '✗ Pas le bon coup', `${told}Réessayez, ou appuyez sur Indice.`, from);
        noteMistake(key);
    } else {
        _rejectMove(to, revealed ? "✗ Ce n'est pas le coup de la solution" : '✗ Pas le bon coup', 'Réessayez.', from);
    }
}

GameModes.register('training', {
    inputBlocked: () => trainingState.busy,
    navBlocked: () => trainingState.busy,
    backToLive: () => trainingBackToLive(),
    sessionCursor: true,
    hintToSolution: true,
    hintNote: ' — ne compte pas comme une erreur',
    solutionNote: ' — compte une erreur',
    solutionCost: () => (TRAIN_SOLUTION_PENALTY ? ' Voir la solution compte comme une erreur.' : ''),
    onMove: (from, to, promo) => trainingState.editing === positionKey() ? _editPlayed(from, to, promo)
        : answerTrainingMove(openingDB[positionKey()], from, to, promo, moveToStr(from, to, promo)),
    onSolution: () => showTrainingSolution(),
    liveStatus: () => trainingLiveStatus()
});
