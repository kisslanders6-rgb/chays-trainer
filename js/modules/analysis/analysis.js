/**
 * modules/analysis/analysis.js
 * ──────────────────────────────────────────────────────────────────────────
 * Mode « Analyse » (gameMode 'analysis') : l'échiquier de l'écran de jeu, les deux camps jouables,
 * le moteur Stockfish (engine.js) et un BROUILLON en arbre. Rien n'est écrit dans le répertoire
 * pendant l'exploration ; « Ajouter au répertoire » montre d'abord ce qui sera fusionné.
 *
 *   openAnalysis(path?, displayPly?) : ouvre l'analyse sur une ligne (coups UCI depuis le début) ;
 *       par défaut, la ligne de l'écran Jouer et la position affichée.
 *   Brouillon : arbre { uci, san, kids } depuis la position initiale ; la ligne affichée est
 *       moveHistory (navigation ◀ ▶ habituelle). Gardé pour la session (sessionStorage) et proposé à
 *       la prochaine ouverture sur le même répertoire et la même couleur.
 *   Lignes du moteur : un clic joue le coup, « Utiliser » recopie la variante dans le brouillon.
 *   Évaluation Lichess (cloud-eval) : affichée tout de suite pour une position connue, jusqu'à ce que
 *       le moteur local la dépasse en profondeur.
 *   Fusion (analysisMergePlan, fonction pure) : mêmes règles que l'import PGN — mon coup créé s'il
 *       n'existe pas, identique ignoré, différent = conflit (gardé, sauf « Remplacer » coché : l'ancien
 *       part à la corbeille) ; les coups adverses sont notés comme réponses connues.
 */

'use strict';

const ANALYSIS_DRAFT_KEY = 'chessTrainer_analysisDraft';
const CLOUD_EVAL_URL     = 'https://lichess.org/api/cloud-eval';

const analysis = {
    rep: '', color: 'w', tree: { kids: [] }, dirty: false,
    running: false, job: null, wait: null, lines: [], fen: '', cloud: null, cloudFen: '',
    retries: 0,           // nouveaux essais d'un calcul annulé par le moteur (Worker mort, erreur), sur la même position
    bar: null,            // dernière ligne montrée par la barre d'évaluation, gardée le temps du calcul suivant
    merge: null,          // aperçu ouvert : { all, replace: Set(clés) }
    lastMerge: null       // dernière fusion annulable : { added: [clés], opp: [[clé, uci]] }
};

// ─── BROUILLON ────────────────────────────────────────────────────────────────

function _anInsert(path) {
    let node = analysis.tree, pos = Chess.start();
    path.forEach(uci => {
        let kid = node.kids.find(k => k.uci === uci);
        if (!kid) { kid = { uci, san: Chess.san(pos, uci), kids: [] }; node.kids.push(kid); }
        pos = Chess.play(pos, uci);
        node = kid;
    });
}

// Toutes les lignes complètes du brouillon (de la racine à chaque feuille).
function _anLeaves(node = analysis.tree, path = [], out = []) {
    if (!node.kids.length) { if (path.length) out.push(path); return out; }
    node.kids.forEach(k => _anLeaves(k, path.concat(k.uci), out));
    return out;
}

const _anCount = () => { let n = 0; const walk = nd => nd.kids.forEach(k => { n++; walk(k); }); walk(analysis.tree); return n; };

function _anSaveDraft() {
    try { sessionStorage.setItem(ANALYSIS_DRAFT_KEY, JSON.stringify({ rep: analysis.rep, color: analysis.color, tree: analysis.tree, line: _anLine() })); }
    catch (e) { /* stockage de session indisponible : le brouillon vit seulement en mémoire */ }
}
function _anReadDraft() {
    try { return JSON.parse(sessionStorage.getItem(ANALYSIS_DRAFT_KEY) || 'null'); } catch (e) { return null; }
}
function _anClearDraft() { try { sessionStorage.removeItem(ANALYSIS_DRAFT_KEY); } catch (e) { /* rien à effacer */ } }

const _anLine = () => moveHistory.map(m => moveToStr(m.from, m.to, m.promo));

// ─── OUVERTURE / FERMETURE ────────────────────────────────────────────────────

function openAnalysis(path, displayPly) {
    if (gameMode === 'analysis') return;
    if (!path) { path = _anLine(); displayPly = navCursor === -1 ? path.length - 1 : navCursor === NAV_START ? -1 : navCursor; }
    if (typeof closeToolbarMore === 'function') closeToolbarMore();
    const draft = _anReadDraft();
    analysis.rep = currentRepertoire;
    analysis.color = playerColor;
    analysis.tree = { kids: [] };
    analysis.merge = null;
    analysis.lastMerge = null;
    // Brouillon de la session sur ce répertoire et cette couleur : repris s'il contient la ligne demandée (ou si elle est vide).
    const resume = draft && draft.rep === analysis.rep && draft.color === analysis.color && draft.tree && draft.tree.kids.length;
    if (resume) {
        analysis.tree = draft.tree;
        if (!path.length && Array.isArray(draft.line)) { path = draft.line; displayPly = path.length - 1; }
    }
    analysis.dirty = !!resume;
    _anInsert(path);
    gameMode = 'analysis';
    loadDB();
    showGameScreen(playerColor);
    loadPositionFromPath(path);
    if (displayPly !== undefined && displayPly < path.length - 1) navGo(displayPly);
    analysis.running = appSettings.engineAuto;
    if (typeof setSheetOpen === 'function') setSheetOpen(true);
    setStatus('Analyse', 'info', resume ? 'Brouillon de cette session repris. Rien n’est enregistré tant que vous n’ajoutez pas au répertoire.'
                                        : 'Jouez librement les deux camps : rien n’est enregistré tant que vous n’ajoutez pas au répertoire.');
    analysisPositionChanged();
}

// Arrêt du calcul (sortie par le logo ou un onglet : le brouillon reste dans la session).
function stopAnalysis() {
    clearTimeout(analysis.wait);
    if (analysis.job) analysis.job.stop();
    analysis.job = null;
    analysis.lines = [];
    analysis.bar = null;
    analysis.merge = null;
}

function quitAnalysis() {
    stopAnalysis();
    gameMode = 'play';
    startGame(analysis.color);
    loadPositionFromPath(_anLine());
}

function discardAnalysis() {
    const n = _anCount();
    const go = () => { _anClearDraft(); analysis.tree = { kids: [] }; analysis.dirty = false; quitAnalysis(); };
    if (!analysis.dirty || !n) { go(); return; }
    askConfirm(`Abandonner l’analyse ? Le brouillon (${n} coup${n > 1 ? 's' : ''}) sera effacé ; rien n’a été ajouté au répertoire.`, go);
}

// ─── COUPS ────────────────────────────────────────────────────────────────────

// Appelé par executePlayerMove (openingsLogic.js) : les deux camps sont libres, rien n'est vérifié.
function analysisMove(from, to, promo) {
    const san = toAlgebraic(from, to, promo);
    _commitMove(from, to, promo, null, `Analyse : ${formatSanText(san, turn)}`, 'info', '');
    _anInsert(_anLine());
    analysis.dirty = true;
    analysis.lastMerge = null;
    _anSaveDraft();
    analysisPositionChanged();
}

function analysisGo(arg) {
    const path = arg ? arg.split(',') : [];
    loadPositionFromPath(path);
    analysisPositionChanged();
}

// Recopie une ligne du moteur dans le brouillon (sans jouer ses coups sur l'échiquier).
function analysisUseLine(i) {
    const l = analysis.lines[Number(i)];
    if (!l) return;
    const base = _displayedPath();
    _anInsert(base.concat(l.pv.slice(0, 12)));
    analysis.dirty = true;
    _anSaveDraft();
    renderAnalysisPanel();
    setStatus('Ligne ajoutée au brouillon', 'info', 'Elle apparaît dans l’arbre de l’analyse ; rien n’est encore au répertoire.');
}

function analysisPlayLine(i) {
    const l = analysis.lines[Number(i)];
    if (!l) return;
    const m = _parseUci(l.pv[0]);
    if (navCursor !== -1) _syncEngineToNavCursor();
    analysisMove(m.from, m.to, m.promo ? m.promo.toUpperCase() : null);
}

// ─── MOTEUR ───────────────────────────────────────────────────────────────────

function analysisToggleEngine() {
    analysis.running = !analysis.running;
    if (!analysis.running) { clearTimeout(analysis.wait); analysis.bar = null; }
    if (!analysis.running && analysis.job) { analysis.job.stop(); analysis.job = null; }
    analysis.retries = 0;
    analysisPositionChanged();
}

function analysisSettingsChanged() {
    if (gameMode === 'analysis') { analysis.fen = ''; analysisPositionChanged(); }
}

const AN_SETTLE_MS = 120, AN_RETRIES = 4;

function _anLaunch(fen) {
    if (gameMode !== 'analysis' || !analysis.running || analysis.fen !== fen || analysis.job) return;
    const job = analysis.job = Engine.analyse(fen,
        { multipv: appSettings.engineLines, depth: appSettings.engineDepth, movetime: appSettings.engineTime * 1000 },
        lines => { if (analysis.job === job) { analysis.lines = lines; analysis.retries = 0; _anPaintEngine(); } });
    job.done.then(r => {
        if (analysis.job !== job) return;
        analysis.job = null;
        // Annulé par le moteur lui-même (Worker mort, erreur, rechargement) alors que la position n'a pas changé :
        // le calcul est relancé, de plus en plus tard ; l'évaluation déjà affichée reste en place.
        if (r && r.cancelled && analysis.running && analysis.retries < AN_RETRIES && !document.hidden) {
            const wait = 500 * 2 ** analysis.retries++;
            clearTimeout(analysis.wait);
            analysis.wait = setTimeout(() => _anLaunch(fen), wait);
        }
        _anPaintEngine();
    });
}

// Position affichée changée (coup, navigation, clic dans l'arbre) : calcul relancé, panneau redessiné.
function analysisPositionChanged() {
    if (gameMode !== 'analysis') return;
    const fen = displayedFen();
    if (fen !== analysis.fen) {
        analysis.fen = fen;
        analysis.lines = [];
        analysis.retries = 0;
        if (analysis.job) { analysis.job.stop(); analysis.job = null; }
        // L'ancien calcul s'arrête tout de suite ; le nouveau attend que la navigation se pose (touche maintenue).
        clearTimeout(analysis.wait);
        if (analysis.running) analysis.wait = setTimeout(() => _anLaunch(fen), AN_SETTLE_MS);
        _anCloud(fen);
    }
    renderAnalysisPanel();
}

// Lichess écrit le roque « roi prend sa tour » (e1h1) : converti en coup du roi (e1g1), comme le moteur local.
function _anCastleFix(fen, moves) {
    let pos = Chess.fromFen(fen);
    const out = [];
    for (const u of moves) {
        let m = u;
        const from = squareToIdx(u.slice(0, 2)), to = squareToIdx(u.slice(2, 4));
        const p = pos.board[from], q = pos.board[to];
        if (p && q && p.toUpperCase() === 'K' && q.toUpperCase() === 'R' && (p === 'K') === (q === 'R'))
            m = u.slice(0, 2) + (to % 8 > from % 8 ? 'g' : 'c') + u[1];
        try { pos = Chess.play(pos, m); } catch (e) { break; }
        out.push(m);
    }
    return out;
}

// Évaluation déjà calculée par Lichess (scores du point de vue des Blancs, comme le moteur local).
function _anCloud(fen) {
    analysis.cloud = null;
    if (!appSettings.cloudEval || (typeof Net !== 'undefined' && !Net.online())) return;
    analysis.cloudFen = fen;
    fetch(`${CLOUD_EVAL_URL}?fen=${encodeURIComponent(fen)}&multiPv=${appSettings.engineLines}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
            if (!d || analysis.cloudFen !== fen || gameMode !== 'analysis') return;
            analysis.cloud = (d.pvs || []).map((p, i) => ({
                multipv: i + 1, depth: d.depth, wdl: null, pv: _anCastleFix(fen, (p.moves || '').split(' ').filter(Boolean)),
                score: p.mate !== undefined ? { mate: p.mate } : { cp: p.cp }
            })).filter(l => l.pv.length);
            _anPaintEngine();
        })
        .catch(() => { /* hors ligne ou position inconnue : le moteur local suffit */ });
}

// Lignes affichées : celles de Lichess tant que le moteur local calcule sans avoir atteint leur profondeur
// (ou sa propre limite) ; ensuite, ou dès qu'il a fini, celles du moteur local.
function _anShownLines() {
    const local = analysis.lines, cloud = analysis.cloud;
    if (!cloud || !cloud.length) return { lines: local, cloud: false };
    if (!local.length) return { lines: cloud, cloud: true };
    const target = Math.min(cloud[0].depth, appSettings.engineDepth || Infinity);
    return analysis.job && (local[0].depth || 0) < target ? { lines: cloud, cloud: true } : { lines: local, cloud: false };
}

// Score → texte : « +0,42 », « #3 », ou chances de gain des Blancs.
function _anScore(l) {
    if (!l || !l.score) return '';
    if (l.score.mate !== undefined) return (l.score.mate > 0 ? '#' : '#−') + Math.abs(l.score.mate);
    if (appSettings.engineEval === 'wdl') return `${Math.round(_anWin(l) * 100)} %`;
    const v = l.score.cp / 100;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace('.', ',');
}

// Chances de gain des Blancs (0 à 1) : WDL du moteur si disponible, sinon formule de Lichess sur les centipions.
function _anWin(l) {
    if (!l || !l.score) return 0.5;
    if (l.score.mate !== undefined) return l.score.mate > 0 ? 1 : 0;
    if (l.wdl) return (l.wdl[0] + l.wdl[1] / 2) / 1000;
    return 1 / (1 + Math.exp(-0.00368208 * l.score.cp));
}

// Variante en notation (numéros de coup compris) depuis la position affichée.
function _anPvText(pv, max = 10, html = false) {
    let pos = Chess.fromFen(analysis.fen), ply = _displayedPath().length, out = '';
    pv.slice(0, max).forEach((u, i) => {
        const w = pos.turn === 'w';
        if (w) out += `${Math.floor(ply / 2) + 1}. `; else if (i === 0) out += `${Math.floor(ply / 2) + 1}… `;
        try { out += (html ? formatSan : formatSanText)(Chess.san(pos, u), pos.turn) + ' '; pos = Chess.play(pos, u); } catch (e) { return; }
        ply++;
    });
    return out.trim();
}

// Flèches des meilleurs coups (annotations.js), sur la position affichée.
function analysisArrowList() {
    if (gameMode !== 'analysis' || !appSettings.engineArrows) return [];
    const { lines } = _anShownLines();
    return lines.slice(0, appSettings.engineArrows).filter(l => l.pv && l.pv[0])
        .map((l, i) => ({ from: squareToIdx(l.pv[0].slice(0, 2)), to: squareToIdx(l.pv[0].slice(2, 4)), color: i ? 'blue' : 'accent' }));
}

// ─── PANNEAU ──────────────────────────────────────────────────────────────────

function renderAnalysisPanel() {
    const box = document.getElementById('analysis-panel');
    if (!box || gameMode !== 'analysis') return;
    box.innerHTML = `<section class="an-engine" id="an-engine"></section>
        <section class="an-tree"><div class="an-h"><b>Brouillon</b><small>${_anCount()} coup${_anCount() > 1 ? 's' : ''} · rien n’est encore au répertoire</small></div>
            <div class="an-moves" id="an-moves">${_anTreeHTML()}</div></section>
        <section class="an-merge" id="an-merge">${_anMergeHTML()}</section>`;
    _anPaintEngine();
    const cur = box.querySelector('.an-mv.is-cur');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function _anPaintEngine() {
    const box = document.getElementById('an-engine');
    if (!box) return;
    const st = Engine.status(), info = Engine.info();
    const { lines, cloud } = _anShownLines();
    const depth = lines[0] ? lines[0].depth : 0;
    const name = info ? `Stockfish ${info.version.split('.')[0]} ${info.net === 'full' ? 'complet' : 'léger'}` : 'Stockfish';
    const state = !analysis.running ? 'arrêté'
                : st === 'loading' ? 'chargement…'
                : !analysis.job && analysis.retries ? 'reprise…'
                : st === 'error' ? 'indisponible'
                : !lines.length && analysis.fen && !Chess.legalMoves(Chess.fromFen(analysis.fen)).length ? 'position finale'
                : cloud ? `Lichess · prof. ${depth}` : depth ? `prof. ${depth}${analysis.job ? '' : ' · terminé'}` : 'calcul…';
    const rows = lines.map((l, i) => `<div class="an-line">
            <button type="button" class="an-play" data-action="analysisPlayLine" data-arg="${i}" title="Jouer ${escapeHtml(_anPvText(l.pv, 1))}">
                <b class="an-score${l.score && (l.score.mate !== undefined ? l.score.mate < 0 : l.score.cp < 0) ? ' is-black' : ''}">${escapeHtml(_anScore(l))}</b>
                <span>${_anPvText(l.pv, 10, true)}</span></button>
            ${cloud ? '' : `<button type="button" class="an-use" data-action="analysisUseLine" data-arg="${i}" title="Recopier cette variante dans le brouillon">${ico('plus')}</button>`}
        </div>`).join('');
    const empty = !analysis.running ? '<p class="an-empty">Moteur arrêté. Lancez-le pour voir les meilleurs coups.</p>'
                : st === 'error' ? `<p class="an-empty">Le moteur n’a pas pu démarrer (${escapeHtml(Engine.error())}).</p>`
                : st === 'loading' ? `<p class="an-empty">${appSettings.engineNet === 'full' ? 'Chargement du moteur complet…' : 'Chargement du moteur (environ 1,8 Mo la première fois)…'}</p>`
                : analysis.fen && !Chess.legalMoves(Chess.fromFen(analysis.fen)).length ? '<p class="an-empty">Partie terminée : aucun coup à calculer.</p>'
                : '<p class="an-empty">Calcul…</p>';
    box.innerHTML = `<div class="an-h"><b>${ico('cpu')} ${name}</b><small>${state}</small>
            <button type="button" class="an-toggle${analysis.running ? ' is-on' : ''}" data-action="analysisToggleEngine" aria-pressed="${analysis.running}">${analysis.running ? 'Arrêter' : 'Lancer'}</button></div>
        <div class="an-lines">${rows || empty}</div>`;
    _anPaintEvalBar(lines[0]);
    if (typeof renderAnnotations === 'function') renderAnnotations();
}

function _anPaintEvalBar(l) {
    const bar = document.getElementById('eval-bar');
    if (!bar) return;
    // Entre deux positions, la barre garde la dernière évaluation au lieu de se vider à chaque coup.
    if (l && analysis.running) analysis.bar = l;
    else if (analysis.running && Engine.status() !== 'error') l = analysis.bar;
    const has = !!(l && analysis.running) || !!(analysis.cloud && analysis.cloud.length);
    bar.classList.toggle('is-empty', !has);
    const w = has ? _anWin(l) : 0.5;
    bar.style.setProperty('--white', `${(w * 100).toFixed(1)}%`);
    bar.title = has ? `Évaluation : ${_anScore(l)}` : '';
    bar.setAttribute('aria-label', bar.title || 'Évaluation indisponible');
}

// Arbre du brouillon en notation : ligne principale, variantes entre parenthèses ; position affichée surlignée.
function _anTreeHTML() {
    const cur = _displayedPath().join(','), out = [];
    function line(node, path, ply, forceNum) {
        let kids = node.kids, first = true;
        while (kids.length) {
            const [main, ...alts] = kids;
            out.push(_anMoveHTML(main, path.concat(main.uci), ply, first || forceNum, cur));
            alts.forEach(a => {
                out.push('<span class="an-var">(');
                out.push(_anMoveHTML(a, path.concat(a.uci), ply, true, cur));
                line(a, path.concat(a.uci), ply + 1, false);
                out.push(')</span>');
            });
            path = path.concat(main.uci);
            node = main; kids = node.kids; ply++;
            first = false; forceNum = alts.length > 0;
        }
    }
    line(analysis.tree, [], 0, true);
    return out.join(' ').replace(/\( </g, '(<').replace(/ \)<\/span>/g, ')</span>') || '<span class="an-empty">Aucun coup</span>';
}

function _anMoveHTML(node, path, ply, num, cur) {
    const w = ply % 2 === 0, n = Math.floor(ply / 2) + 1;
    const label = (w ? `${n}. ` : num ? `${n}… ` : '') + formatSan(node.san, w ? 'w' : 'b');      // HTML
    const p = path.join(',');
    return `<button type="button" class="an-mv${p === cur ? ' is-cur' : ''}" data-action="analysisGo" data-arg="${p}">${label}</button>`;
}

// ─── FUSION DANS LE RÉPERTOIRE ────────────────────────────────────────────────

// Plan de fusion (fonction pure) : lignes = chemins UCI depuis le début ; color = mon camp ; db = base visée.
// replace : Set des positions où un conflit doit remplacer l'ancien coup.
// Renvoie { items: [{ key, uci, san, path, status: 'new' | 'same' | 'conflict' | 'replace', keptSan }], opp: [[clé, uci]] }.
function analysisMergePlan(lines, color, db, replace = new Set()) {
    const items = new Map(), opp = new Map();
    lines.forEach(path => {
        let pos = Chess.start();
        for (let i = 0; i < path.length; i++) {
            const uci = path[i], key = Chess.key(pos);
            if (pos.turn === color) {
                const e = db[key], san = Chess.san(pos, uci);
                const status = !e ? 'new' : e.move === uci ? 'same' : replace.has(key) ? 'replace' : 'conflict';
                if (!items.has(key)) items.set(key, { key, uci, san, path: path.slice(0, i + 1), status, keptSan: e ? e.san : null });
                const planned = items.get(key);
                if (planned.uci !== uci || status === 'conflict') break;     // la suite dépend d'un autre coup que celui retenu
            } else if (!opp.has(key + uci)) opp.set(key + uci, [key, uci]);
            pos = Chess.play(pos, uci);
        }
    });
    return { items: [...items.values()], opp: [...opp.values()] };
}

const _anPlan = () => analysisMergePlan(analysis.merge && analysis.merge.all ? _anLeaves() : [_anLine()], analysis.color, openingDB,
                                        analysis.merge ? analysis.merge.replace : new Set());

function _anMergeHTML() {
    if (analysis.lastMerge) {
        const n = analysis.lastMerge.added.length;
        return `<div class="an-done">${ico('check')} ${n} coup${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} au répertoire « ${escapeHtml(analysis.rep)} ».
            <button type="button" class="an-link" data-action="analysisUndoMerge">Annuler</button></div>`;
    }
    if (!analysis.merge) {
        const plan = _anPlan(), n = plan.items.filter(i => i.status === 'new').length;
        return `<div class="an-actions">
            <button type="button" class="btn btn-primary" data-action="analysisOpenMerge"${n || plan.items.some(i => i.status === 'conflict') ? '' : ' disabled'}>${ico('git-merge')} Ajouter au répertoire${n ? ` (${n} coup${n > 1 ? 's' : ''})` : ''}</button>
            <button type="button" class="btn" data-action="discardAnalysis">Abandonner</button></div>`;
    }
    const plan = _anPlan(), pl = (n, a, b) => `${n} ${n > 1 ? b : a}`;
    const side = analysis.color === 'w' ? 'Blancs' : 'Noirs';
    const row = it => {
        const sans = formatLinePrefix(_pathToSans(it.path), true);
        const tag = { new: '<span class="an-tag is-new">nouveau</span>', same: '<span class="an-tag">déjà connu</span>',
                      conflict: `<span class="an-tag is-conflict">votre coup : ${formatSan(it.keptSan, analysis.color)}</span>`,
                      replace: `<span class="an-tag is-replace">remplace ${formatSan(it.keptSan, analysis.color)}</span>` }[it.status];
        const box = it.status === 'conflict' || it.status === 'replace'
            ? `<label class="an-replace"><input type="checkbox" data-action="analysisToggleReplace" data-arg="${escapeHtml(it.key)}"${it.status === 'replace' ? ' checked' : ''}> Remplacer</label>` : '';
        return `<li class="is-${it.status}"><span>${sans}</span>${tag}${box}</li>`;
    };
    const added = plan.items.filter(i => i.status === 'new' || i.status === 'replace').length;
    return `<div class="an-preview">
        <div class="an-h"><b>Ajouter au répertoire « ${escapeHtml(analysis.rep)} » · ${side}</b></div>
        <label class="an-all"><input type="checkbox" data-action="analysisToggleAll"${analysis.merge.all ? ' checked' : ''}> Toutes les branches du brouillon (sinon la ligne affichée)</label>
        <ul class="an-plan">${plan.items.filter(i => i.status !== 'same').map(row).join('') || '<li>Rien de nouveau : vos coups de cette ligne sont déjà au répertoire.</li>'}</ul>
        <p class="an-note">${pl(plan.items.filter(i => i.status === 'same').length, 'coup déjà connu', 'coups déjà connus')}. Un conflit garde votre coup actuel et arrête la ligne, sauf si vous cochez « Remplacer » (l’ancien coup part à la corbeille).</p>
        <div class="an-actions">
            <button type="button" class="btn btn-primary" data-action="analysisConfirmMerge"${added ? '' : ' disabled'}>${ico('check')} Ajouter ${pl(added, 'coup', 'coups')}</button>
            <button type="button" class="btn" data-action="analysisCloseMerge">Retour</button></div></div>`;
}

function analysisConfirmMerge() {
    const plan = _anPlan(), added = [];
    const todo = plan.items.filter(i => i.status === 'new' || i.status === 'replace');
    if (!todo.length) return;
    const replaced = todo.filter(i => i.status === 'replace').map(i => i.key);
    if (replaced.length && !trashEntries(replaced, 'remplacé depuis l’Analyse')) {
        setStatus('Fusion impossible', 'err', 'La corbeille n’a pas pu accueillir les coups remplacés : rien n’a été modifié.');
        return;
    }
    todo.forEach(i => { openingDB[i.key] = newEntry(i.uci, i.san, i.path); added.push(i.key); });
    const oppAdded = plan.opp.filter(([k, u]) => recordOppReply(k, u));
    saveDB();
    if (oppAdded.length) saveOpp();
    noteChange(added.length);
    analysis.lastMerge = { added, opp: oppAdded, noUndo: replaced.length > 0 };     // un remplacement s'annule depuis la corbeille
    analysis.merge = null;
    analysis.dirty = false;
    _anClearDraft();
    setStatus(`${added.length} coup${added.length > 1 ? 's' : ''} ajouté${added.length > 1 ? 's' : ''} au répertoire`, 'new',
        'À réviser dès la prochaine séance d’Entraînement.' + (replaced.length ? ' Les coups remplacés sont dans la corbeille.' : ''));
    renderAnalysisPanel();
}

function analysisUndoMerge() {
    const m = analysis.lastMerge;
    if (!m) return;
    if (m.noUndo) { setStatus('Annulation impossible ici', 'info', 'Un coup a été remplacé : restaurez-le depuis la corbeille.'); return; }
    m.added.forEach(k => { delete openingDB[k]; });
    m.opp.forEach(([k, u]) => { if (oppSeen[k]) { oppSeen[k] = oppSeen[k].filter(x => x !== u); if (!oppSeen[k].length) delete oppSeen[k]; } });
    saveDB();
    if (m.opp.length) saveOpp();
    analysis.lastMerge = null;
    analysis.dirty = true;
    _anSaveDraft();
    setStatus('Ajout annulé', 'info', 'Le répertoire est revenu à son état précédent ; le brouillon est conservé.');
    renderAnalysisPanel();
}

registerActions({
    analysisGo, analysisUseLine, analysisPlayLine, analysisToggleEngine, discardAnalysis, analysisConfirmMerge, analysisUndoMerge,
    analysisOpenMerge: () => { analysis.merge = { all: false, replace: new Set() }; renderAnalysisPanel(); },
    analysisCloseMerge: () => { analysis.merge = null; renderAnalysisPanel(); },
    analysisToggleAll: () => { if (analysis.merge) { analysis.merge.all = !analysis.merge.all; renderAnalysisPanel(); } },
    analysisToggleReplace: key => {
        if (!analysis.merge) return;
        const r = analysis.merge.replace;
        if (r.has(key)) r.delete(key); else r.add(key);
        renderAnalysisPanel();
    }
});

if (typeof Engine !== 'undefined') Engine.onStatus(() => { if (gameMode === 'analysis') _anPaintEngine(); });

// Retour au premier plan : le calcul arrêté par la mise en arrière-plan reprend s'il n'avait pas atteint sa limite,
// sans effacer les lignes affichées (elles sont remplacées dès que le moteur parle).
document.addEventListener('visibilitychange', () => {
    if (document.hidden || gameMode !== 'analysis' || !analysis.running || analysis.job) return;
    const l = analysis.lines[0], limit = appSettings.engineDepth || Infinity;
    if (l && l.depth >= limit) return;
    analysis.retries = 0;
    clearTimeout(analysis.wait);
    _anLaunch(analysis.fen);
});
