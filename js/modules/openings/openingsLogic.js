/**
 * modules/openings/openingsLogic.js
 * ──────────────────────────────────────────────────────────────────────────
 * Logique du mode « Jouer » (récitation + construction manuelle) :
 *   - Clics sur l'échiquier, coups de l'adversaire (libres) et du joueur
 *   - Validation contre la base : UNE SEULE réponse par position de mon camp
 *   - Indice textuel (type de pièce), annulation, réinitialisation
 *   - Panneau d'administration de la base
 *
 * Modèle : openingDB[clé] = { move, san, attempts, failures, path?, ply? }
 *   - position inconnue          → le coup devient la référence (attempts 1, failures 0)
 *   - bon coup                   → attempts + 1
 *   - mauvais coup (refusé)      → attempts + 1 et failures + 1, réponse non dévoilée
 * Aucune profondeur maximale : l'arbre se prolonge tant que des coups sont joués.
 */

'use strict';

// ─── OUTILS MOTEUR (sans effet sur l'affichage) ───────────────────────────────

function _parseUci(u) {
    return { from: squareToIdx(u.slice(0, 2)), to: squareToIdx(u.slice(2, 4)), promo: u[4] || null };
}

function _withEngineSnapshot(fn) {
    const s = { board: board.slice(), turn, castlingRights: { ...castlingRights }, enPassant };
    try { return fn(); }
    finally { board = s.board; turn = s.turn; castlingRights = s.castlingRights; enPassant = s.enPassant; }
}

// Joue un coup UCI sur l'état brut du moteur (sans historique) et renvoie son SAN.
function _applyUciRaw(uci) {
    const { from, to, promo } = _parseUci(uci);
    const san = toAlgebraic(from, to, promo);
    const t   = turn;
    applyMoveRaw(from, to);
    if (promo) board[to] = t === 'w' ? promo.toUpperCase() : promo.toLowerCase();
    else if (board[to] && board[to].toUpperCase() === 'P') {
        const r2 = Math.floor(to / 8);
        if (r2 === 7) board[to] = 'Q';
        if (r2 === 0) board[to] = 'q';
    }
    turn = t === 'w' ? 'b' : 'w';
    return san;
}

function _pathToSans(path) {
    const sans = [];
    _withEngineSnapshot(() => { parseFEN(INIT_FEN); path.forEach(u => sans.push(_applyUciRaw(u))); });
    return sans;
}

// SAN d'un coup UCI depuis une clé de position ; null si le coup est impossible.
function _sanForKeyMove(key, uci) {
    return _withEngineSnapshot(() => {
        parseFEN(key);
        const { from, to, promo } = _parseUci(uci);
        const p = board[from];
        if (!p || isWhite(p) !== (turn === 'w')) return null;
        const castle = p.toUpperCase() === 'K' && Math.abs((to % 8) - (from % 8)) === 2 && Math.floor(to / 8) === Math.floor(from / 8);
        if (!castle && !getRawMoves(from).includes(to)) return null;
        return toAlgebraic(from, to, promo);
    });
}

// Replace l'échiquier (avec historique navigable) après la suite de coups UCI donnée.
function loadPositionFromPath(moves) {
    clearErrorFx();                                    // ← ajout
    parseFEN(INIT_FEN);
    moveHistory = []; lastFrom = -1; lastTo = -1;
    selected = null; legalMoves = []; hintPiece = null; awaitingPromotion = null;
    resetNavCursor();
    moves.forEach(u => { const m = _parseUci(u); applyMove(m.from, m.to, m.promo); });
    renderMoves();
    renderBoard();
}

// Migration : retrouve le chemin des anciennes entrées (sans `path`) en parcourant
// les lignes connues. Borné à 16 demi-coups comme l'ancien panneau ; les entrées
// non retrouvées se complètent d'elles-mêmes dès qu'on rejoue la ligne dans « Jouer ».
function migrateLegacyPaths() {
    const missing = new Set(Object.keys(openingDB).filter(k => !openingDB[k].path));
    if (!missing.size) return;
    const seen = new Set();

    function step(path, uci) {
        const sb = board.slice(), st = turn, sc = { ...castlingRights }, se = enPassant;
        _applyUciRaw(uci);
        explore(path.concat(uci));
        board = sb; turn = st; castlingRights = sc; enPassant = se;
    }
    function explore(path) {
        if (!missing.size || path.length > 16) return;
        const key = positionKey();
        if (turn === playerColor) {
            const e = openingDB[key];
            if (!e) return;
            if (missing.has(key)) { e.path = path.concat(e.move); e.ply = e.path.length; missing.delete(key); }
            if (squareToIdx(e.move.slice(0, 2)) >= 0 && board[squareToIdx(e.move.slice(0, 2))]) step(path, e.move);
        } else {
            if (seen.has(key)) return;
            seen.add(key);
            for (let from = 0; from < 64; from++) {
                const p = board[from];
                if (!p || isWhite(p) !== (turn === 'w')) continue;
                for (const to of getLegalMoves(from)) {
                    const promos = isPromotion(from, to) ? ['q', 'r', 'b', 'n'] : [''];
                    for (const pr of promos) {
                        if (!missing.size) return;
                        step(path, moveToStr(from, to, pr));
                    }
                }
            }
        }
    }
    _withEngineSnapshot(() => { parseFEN(INIT_FEN); explore([]); });
}

// ─── LOGIQUE DE CLIC ──────────────────────────────────────────────────────────

function handleClick(idx) {
    if (gameMode === 'preview') return;                                   // aperçu : lecture seule
    if (gameMode === 'endgame' && endgameState.busy) return;
    if (gameMode === 'training' && trainingState.busy) return;            // cinématique en cours

    // Si on visualise une position passée (navigation Précédent/Suivant),
    // jouer ici doit relancer la partie réelle à partir de cette position :
    // elle devient le nouveau point de départ effectif (nouvelle variante).
    // Les coups de l'ancienne ligne qui suivaient ce point sont retirés de
    // l'historique de session (mais restent en base s'ils y avaient été
    // enregistrés) ; on les remplace par la nouvelle ligne qui va être jouée.
    if (navCursor !== -1) {
        _syncEngineToNavCursor();
    }

    const p = board[idx];

    // Sélection initiale : seules les pièces du camp dont c'est le tour
    if (selected === null) {
        if (!p) return;
        if ((turn === 'w') !== isWhite(p)) return;
        selected   = idx;
        legalMoves = getLegalMoves(idx);
        hintPiece  = null;
        renderBoard();
        return;
    }

    // Désélection
    if (selected === idx) { selected = null; legalMoves = []; renderBoard(); return; }

    if (legalMoves.includes(idx)) {
        if (turn !== playerColor) {
            executeOpponentMove(selected, idx);
        } else {
            executePlayerMove(selected, idx);
        }
    } else if (p && ((turn === 'w') === isWhite(p))) {
        // Changement de pièce sélectionnée (même camp)
        selected   = idx;
        legalMoves = getLegalMoves(idx);
        renderBoard();
    } else {
        selected = null; legalMoves = [];
        renderBoard();
    }
}

// ─── SYNCHRONISATION ENGIN ↔ POSITION AFFICHÉE EN NAVIGATION ─────────────────
// Reconstruit l'état réel du moteur (board/turn/castling/enPassant) pour
// qu'il corresponde exactement à la position actuellement affichée par
// renderNavBoard(), tronque l'historique de session à ce point, puis sort
// du mode navigation. Après cet appel, la position affichée == la position
// réelle du moteur : on peut jouer normalement (sélection + coup).

function _syncEngineToNavCursor() {
    if (navCursor === -1) return;

    // Position initiale : on repart de zéro (toute l'ancienne ligne est écartée).
    if (navCursor === NAV_START) {
        const first    = moveHistory[0];
        board          = first.boardBefore.slice();
        castlingRights = { ...first.castlingBefore };
        enPassant      = first.epBefore;
        turn           = first.turnBefore;
        lastFrom = -1; lastTo = -1;
        moveHistory = [];
        selected = null; legalMoves = []; hintPiece = null;
        resetNavCursor();
        renderMoves();
        return;
    }
    const snap = moveHistory[navCursor];

    board          = snap.boardBefore.slice();
    castlingRights = { ...snap.castlingBefore };
    enPassant      = snap.epBefore;

    applyMoveRaw(snap.from, snap.to);
    if (snap.promo) {
        board[snap.to] = snap.turnBefore === 'w' ? snap.promo.toUpperCase() : snap.promo.toLowerCase();
    } else if (board[snap.to] && board[snap.to].toUpperCase() === 'P') {
        const r2 = Math.floor(snap.to / 8);
        if (r2 === 7) board[snap.to] = 'Q';
        if (r2 === 0) board[snap.to] = 'q';
    }

    turn     = snap.turnBefore === 'w' ? 'b' : 'w';
    lastFrom = snap.from;
    lastTo   = snap.to;

    // Tout ce qui suivait ce coup dans la session devient l'ancienne ligne ;
    // la nouvelle variante qui va être jouée à partir d'ici prend sa place.
    moveHistory = moveHistory.slice(0, navCursor + 1);

    selected   = null;
    legalMoves = [];
    hintPiece  = null;

    resetNavCursor();   // navCursor = -1 + updateNavButtons()
    renderMoves();
}

// ─── APPLICATION CENTRALISÉE D'UN COUP (état + rendu) ────────────────────────

function _commitMove(from, to, promo, newDbKey, statusMsg, statusType) {
    playMoveSound(from, to);                // avant applyMove : détecte la capture
    animateNextMove(from, to);
    applyMove(from, to, promo, newDbKey);   // met à jour board/turn/moveHistory + renderMoves()
    if (typeof refreshTree === 'function') refreshTree();
    selected = null; legalMoves = []; hintPiece = null;
    resetNavCursor();
    if (statusMsg) setStatus(statusMsg, statusType || 'info');
    renderBoard();
}

// ─── COUP DE L'ADVERSAIRE ─────────────────────────────────────────────────────

// Transposition : la position (clé FEN) est déjà connue, mais atteinte par un autre ordre de coups.
function _isTransposition(entry) {
    if (!entry || !entry.path) return false;
    const now = moveHistory.map(m => moveToStr(m.from, m.to, m.promo));
    return entry.path.slice(0, -1).join(' ') !== now.join(' ');
}

function executeOpponentMove(from, to, promo) {
    if (promo === undefined) {
        if (isPromotion(from, to)) {
            awaitingPromotion = { from, to, isOpponent: true };
            showPromotion();
            return;
        }
        promo = null;
    }
    const san = toAlgebraic(from, to, promo);
    if (recordOppReply(positionKey(), moveToStr(from, to, promo))) saveOpp();   // réponse adverse connue
    _commitMove(from, to, promo, null, `Adversaire : ${san} — à vous de répondre.`, 'info');
    // Position déjà au répertoire mais atteinte par un autre ordre de coups : la réponse mémorisée s'applique.
    if (turn === playerColor && _isTransposition(openingDB[positionKey()])) {
        setStatus(`Adversaire : ${san} · Transposition détectée — position connue.`, 'info');
    }
}

// ─── COUP DU JOUEUR ───────────────────────────────────────────────────────────

function _rejectMove(toIdx, msg) {
    selected = null; legalMoves = []; hintPiece = null;
    renderBoard();
    flashWrong(toIdx);
    playSound('error');
    setStatus(msg, 'err');
}

function executePlayerMove(from, to, promo) {
    if (promo === undefined) {
        if (isPromotion(from, to)) {
            awaitingPromotion = { from, to, isOpponent: false };
            showPromotion();
            return;
        }
        promo = null;
    }

    const key    = positionKey();
    const entry  = openingDB[key];
    const movStr = moveToStr(from, to, promo);
    const san    = toAlgebraic(from, to, promo);

    if (gameMode === 'endgame') { answerEndgameMove(from, to, promo); return; }
    if (gameMode === 'training') { answerTrainingMove(entry, from, to, promo, movStr); return; }

    const pathNow = moveHistory.map(m => moveToStr(m.from, m.to, m.promo));

    if (!entry) {
        // Position inconnue → ce coup devient l'unique réponse de référence.
        const path = pathNow.concat(movStr);
        openingDB[key] = { move: movStr, san, attempts: 1, failures: 0, path, ply: path.length, lastReviewed: Date.now() };
        saveDB();
        noteChange(1);
        _commitMove(from, to, promo, key, `Nouveau coup enregistré : ${san}`, 'new');

    } else if (movStr === entry.move) {
        // Bon coup (sur une transposition : la progression continue, le path d'origine est conservé).
        const transp = _isTransposition(entry);
        entry.attempts++;
        entry.lastReviewed = Date.now();
        if (!entry.path) { entry.path = pathNow.concat(movStr); entry.ply = entry.path.length; }
        saveDB();
        _commitMove(from, to, promo, null, transp ? '✓ Correct ! (transposition)' : '✓ Correct !', 'ok');

    } else {
        // Mauvais coup : refusé, la bonne réponse n'est pas dévoilée.
        entry.attempts++;
        entry.failures++;
        entry.lastReviewed = Date.now();
        saveDB();
        _rejectMove(to, "✗ Ce n'est pas le bon coup — réessayez.");
    }
}

// ─── INDICE (texte : type de pièce à jouer) ───────────────────────────────────

const PIECE_HINT = { P: 'un Pion', N: 'un Cavalier', B: 'un Fou', R: 'une Tour', Q: 'une Dame', K: 'le Roi' };

function showHint() {
    if (gameMode === 'endgame') { endgameHint(); return; }
    if (gameMode === 'preview' || (gameMode === 'training' && trainingState.busy)) return;
    if (turn !== playerColor) {
        setStatus("L'indice n'est disponible que pour vos propres coups.", 'info');
        return;
    }
    const entry = openingDB[positionKey()];
    if (!entry) { setStatus("Aucun indice — cette position n'est pas encore dans la base.", 'info'); return; }
    const piece = (board[squareToIdx(entry.move.slice(0, 2))] || '').toUpperCase();
    selected = null; legalMoves = []; hintPiece = null;
    renderBoard();
    setStatus(`Indice : déplacez ${PIECE_HINT[piece] || 'une pièce'}.`, 'hint');
}

// ─── CONFIRMATION MODALE ──────────────────────────────────────────────────────

function askConfirm(message, onConfirm) {
    const overlay    = document.getElementById('confirm-overlay');
    document.getElementById('confirm-text').textContent = message;
    overlay.classList.remove('hidden');
    const okBtn     = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');
    const cleanup   = () => {
        overlay.classList.add('hidden');
        okBtn.onclick     = null;
        cancelBtn.onclick = null;
    };
    okBtn.onclick     = () => { cleanup(); onConfirm(); };
    cancelBtn.onclick = () => { cleanup(); };
}

// ─── ANALYSE DE L'ARBRE : COUPS ORPHELINS ─────────────────────────────────────
// Graphe des positions de MON camp : de l'entrée K, on joue sa réponse, puis
// TOUTES les réponses légales de l'adversaire ; chaque position (à mon trait)
// déjà en base est un enfant. Un coup est « orphelin » s'il n'est plus atteignable
// depuis la position initiale une fois K supprimé (ou modifié) — les transpositions
// vers d'autres lignes encore valides l'empêchent donc d'être orphelin.

function _loadEngineAt(key) {
    const e = openingDB[key];
    if (e && e.path) {                                   // état exact (roque, en passant) via la ligne
        parseFEN(INIT_FEN);
        e.path.slice(0, -1).forEach(_applyUciRaw);
        if (positionKey() === key) return;
    }
    parseFEN(key);                                       // repli : droits de roque déduits des pièces
    castlingRights = {
        K: board[4] === 'K' && board[7] === 'R',  Q: board[4] === 'K' && board[0] === 'R',
        k: board[60] === 'k' && board[63] === 'r', q: board[60] === 'k' && board[56] === 'r'
    };
    enPassant = -1;
}

// Appelle cb() après chaque coup légal du camp au trait (état restauré entre deux appels).
function _forEachChild(cb) {
    const sb = board.slice(), st = turn, sc = { ...castlingRights }, se = enPassant;
    const moves = [];
    for (let from = 0; from < 64; from++) {
        const p = board[from];
        if (!p || isWhite(p) !== (turn === 'w')) continue;
        for (const to of getLegalMoves(from)) {
            const promos = isPromotion(from, to) ? ['q', 'r', 'b', 'n'] : [''];
            promos.forEach(pr => moves.push(moveToStr(from, to, pr)));
        }
    }
    moves.forEach(u => {
        const san = _applyUciRaw(u);
        cb(u, san);
        board = sb.slice(); turn = st; castlingRights = { ...sc }; enPassant = se;
    });
}

function _childKeys(ctx, key, move) {
    const ck = key + '|' + move;
    if (ctx.cache.has(ck)) return ctx.cache.get(ck);
    const out = [];
    _withEngineSnapshot(() => {
        _loadEngineAt(key);
        if (!board[_parseUci(move).from]) return;
        _applyUciRaw(move);
        _forEachChild(() => out.push(positionKey()));
    });
    ctx.cache.set(ck, out);
    return out;
}

function _reachableKeys(ctx, db) {
    if (!ctx.roots) {
        ctx.roots = [];
        _withEngineSnapshot(() => {
            parseFEN(INIT_FEN);
            if (playerColor === 'w') ctx.roots.push(positionKey());
            else _forEachChild(() => ctx.roots.push(positionKey()));
        });
    }
    const seen  = new Set();
    const stack = ctx.roots.filter(k => db[k]);
    while (stack.length) {
        const k = stack.pop();
        if (seen.has(k)) continue;
        seen.add(k);
        _childKeys(ctx, k, db[k].move).forEach(c => { if (db[c] && !seen.has(c)) stack.push(c); });
    }
    return seen;
}

// Clés des coups en aval qui deviendraient inaccessibles si `key` est supprimé
// (newMove = null) ou si sa réponse est remplacée par `newMove`.
function findOrphans(key, newMove) {
    const ctx    = { cache: new Map(), roots: null };
    const before = _reachableKeys(ctx, openingDB);
    if (!before.has(key)) return [];
    const hypo = Object.assign({}, openingDB);
    if (newMove) hypo[key] = Object.assign({}, openingDB[key], { move: newMove });
    else         delete hypo[key];
    const after = _reachableKeys(ctx, hypo);
    return [...before].filter(k => k !== key && !after.has(k));
}

function _orphanMessage(verb, n) {
    return `Attention : la ${verb} de ce coup rendra ${n} coup(s) en aval inaccessible(s). Voulez-vous également nettoyer ces branches orphelines ? (Tout est conservé 30 jours dans la corbeille.)`;
}

// Supprime des coups de la base active après les avoir placés dans la corbeille (30 jours).
// Renvoie false (rien n'est supprimé) si la corbeille n'a pas pu les accueillir.
function _deleteEntries(keys) {
    if (!trashEntries(keys)) return false;
    keys.forEach(k => { delete openingDB[k]; });
    saveDB();
    noteChange(keys.length);
    return true;
}

// Confirmation à trois issues : cascade / ce coup seulement / annuler.
function askConfirmChoice(message, labels, onCascade, onSolo) {
    const overlay = document.getElementById('confirm-overlay');
    const actions = overlay.querySelector('.confirm-actions');
    const okBtn   = document.getElementById('confirm-ok-btn');
    const cancel  = document.getElementById('confirm-cancel-btn');
    let alt = document.getElementById('confirm-alt-btn');
    if (!alt) {
        alt = document.createElement('button');
        alt.id = 'confirm-alt-btn';
        alt.className = 'btn';
        actions.insertBefore(alt, okBtn);
    }
    document.getElementById('confirm-text').textContent = message;
    actions.style.flexDirection = 'column';
    okBtn.textContent = labels.cascade;  okBtn.style.order  = 0;
    alt.textContent   = labels.solo;     alt.style.order    = 1;  alt.style.display = '';
    cancel.style.order = 2;
    overlay.classList.remove('hidden');

    const cleanup = () => {
        overlay.classList.add('hidden');
        actions.style.flexDirection = '';
        okBtn.textContent = 'Confirmer';
        okBtn.style.order = cancel.style.order = '';
        alt.style.display = 'none';
        okBtn.onclick = alt.onclick = cancel.onclick = null;
    };
    okBtn.onclick  = () => { cleanup(); onCascade(); };
    alt.onclick    = () => { cleanup(); onSolo(); };
    cancel.onclick = cleanup;
}

// ─── ANNULATION / MODIFICATION D'UN COUP ENREGISTRÉ ──────────────────────────
// - Dernier coup = coup adverse : simple retour arrière, la base n'est pas touchée.
// - Dernier coup = mon coup     : après confirmation, l'entrée de la position
//   d'origine est effacée, on revient à cette position et le prochain coup joué
//   devient la nouvelle réponse de référence (attempts 1, failures 0).

function undoMove() {
    if (moveHistory.length === 0) { setStatus('Aucun coup à annuler.', 'info'); return; }

    const last = moveHistory[moveHistory.length - 1];

    if (last.turnBefore !== playerColor) {
        // Réponse adverse annulée : on l'oublie si elle ne mène à rien dans le répertoire.
        const childKey = positionKey();
        const posKey   = _withEngineSnapshot(() => { board = last.boardBefore.slice(); turn = last.turnBefore; return positionKey(); });
        if (!openingDB[childKey] && forgetOppReply(posKey, moveToStr(last.from, last.to, last.promo))) saveOpp();
        performUndo();
        if (typeof refreshTree === 'function') refreshTree();
        setStatus('Coup adverse annulé — choisissez une autre branche.', 'info');
        return;
    }

    // Clé de la position AVANT mon coup (celle de l'entrée à effacer).
    const key = _withEngineSnapshot(() => {
        board = last.boardBefore.slice();
        turn  = last.turnBefore;
        return positionKey();
    });

    if (!openingDB[key]) {                       // rien d'enregistré (déjà supprimé via « Base »)
        performUndo();
        setStatus('Coup annulé.', 'info');
        return;
    }

    const orphans = findOrphans(key, null);
    const finish  = extra => {
        if (!_deleteEntries([key].concat(extra))) return;
        performUndo();
        if (typeof refreshTree === 'function') refreshTree();
        setStatus('Coup précédent effacé. Jouez le nouveau coup de référence sur l\'échiquier.'
            + (extra.length ? ` (${extra.length} branche(s) orpheline(s) nettoyée(s).)` : ''), 'new');
    };

    if (!orphans.length) {
        askConfirm('Voulez-vous effacer ce coup de votre répertoire pour en enregistrer un nouveau ? (Il est conservé 30 jours dans la corbeille.)', () => finish([]));
    } else {
        askConfirmChoice(_orphanMessage('suppression', orphans.length),
            { cascade: `Supprimer aussi les ${orphans.length} coup(s) orphelin(s)`, solo: 'Supprimer ce coup seulement' },
            () => finish(orphans), () => finish([]));
    }
}

function performUndo() {
    const last       = moveHistory.pop();
    board            = last.boardBefore.slice();
    turn             = last.turnBefore;
    castlingRights   = { ...last.castlingBefore };
    enPassant        = last.epBefore;
    lastFrom         = moveHistory.length ? moveHistory[moveHistory.length - 1].from : -1;
    lastTo           = moveHistory.length ? moveHistory[moveHistory.length - 1].to   : -1;
    selected         = null; legalMoves = []; hintPiece = null;
    resetNavCursor();
    renderMoves();
    renderBoard();
}

// ─── RÉINITIALISATION ─────────────────────────────────────────────────────────

function resetGame() {
    clearErrorFx();
    parseFEN(INIT_FEN);
    moveHistory      = [];
    selected         = null; legalMoves = [];
    lastFrom         = -1; lastTo = -1;
    hintPiece        = null;
    awaitingPromotion = null;
    resetNavCursor();
    renderMoves();
    if (playerColor === 'w') {
        setStatus('Nouvelle partie — jouez votre premier coup (Blancs).', 'info');
    } else {
        setStatus('Nouvelle partie — jouez le premier coup des Blancs (adversaire).', 'info');
    }
    renderBoard();
}

// ─── PANNEAU ADMIN ────────────────────────────────────────────────────────────

function formatLinePrefix(sans) {
    if (!sans.length) return '(position de départ)';
    let out = '';
    sans.forEach((san, i) => {
        if (i % 2 === 0) out += (Math.floor(i / 2) + 1) + '. ';
        out += san + ' ';
    });
    return out.trim();
}

function showAdmin() {
    renderAdminTabs();
    renderAdminEntries();
    document.getElementById('admin-overlay').classList.remove('hidden');
}

function renderAdminTabs() {
    const tabsEl = document.getElementById('admin-tabs');
    const list   = loadRepertoireList();
    tabsEl.innerHTML = list.map(name => `
    <div class="admin-tab ${name === currentRepertoire ? 'active' : ''}"
         onclick="switchAdminRepertoire('${name.replace(/'/g, "\\'")}')">
      ${name}
    </div>
  `).join('');
}

function switchAdminRepertoire(name) {
    if (name === currentRepertoire) return;
    currentRepertoire = name;
    loadDB();
    renderAdminTabs();
    renderAdminEntries();
}

function _adminRow(key, e, inputId, prefix) {
    const keyEsc = key.replace(/'/g, "\\'");
    const pct    = e.attempts ? Math.round(100 * e.failures / e.attempts) : 0;
    return `
        <div class="line-group">
          <div class="line-group-header"><span class="line-group-prefix">${prefix}</span></div>
          <div class="line-row">
            <span class="line-row-arrow">→ Réponse mémorisée :</span>
            <span class="line-row-move">${e.san}</span>
            <span title="erreurs / essais" style="font-size:11px;color:var(--text-dim);">${e.failures}/${e.attempts} · ${pct}%</span>
            <input id="${inputId}" value="${e.move}" title="Coup en notation UCI">
            <button class="mini-btn mini-btn-ok" onclick="saveEntry('${keyEsc}', document.getElementById('${inputId}').value)">✓</button>
            <button class="mini-btn mini-btn-del" onclick="deleteEntry('${keyEsc}')">✕</button>
          </div>
        </div>`;
}

function renderAdminEntries() {
    const el   = document.getElementById('admin-entries');
    const keys = Object.keys(openingDB);
    const info = `<div class="panel-sub">Répertoire actif : <strong style="color:var(--accent)">${_esc(currentRepertoire)}</strong> · couleur <strong>${playerColor === 'w' ? 'Blancs' : 'Noirs'}</strong>. La base est sauvegardée dans ce navigateur (localStorage) et persiste après fermeture, tant que le cache n'est pas vidé.</div>`;

    if (!keys.length) {
        el.innerHTML = info + "<div class=\"empty-note\">Base vide pour ce répertoire — jouez des parties pour l'enrichir.</div>";
        return;
    }

    const known   = keys.filter(k => openingDB[k].path).sort((a, b) => openingDB[a].path.length - openingDB[b].path.length);
    const orphans = keys.filter(k => !openingDB[k].path);

    let html = info;
    html += known.map((k, i) => {
        const sans = _pathToSans(openingDB[k].path);
        return _adminRow(k, openingDB[k], `edit-${i}`, formatLinePrefix(sans.slice(0, -1)));
    }).join('');

    if (orphans.length) {
        html += `<div class="panel-sub" style="margin-top:10px;">Entrées sans ligne connue (elles se rattachent automatiquement quand vous rejouez la ligne dans « Jouer ») :</div>`;
        html += orphans.map((k, i) => _adminRow(k, openingDB[k], `edit-orphan-${i}`,
            `<span style="font-size:10px;word-break:break-all;">${k}</span>`)).join('');
    }
    el.innerHTML = html;
}

function saveEntry(key, newMoveStr) {
    newMoveStr = (newMoveStr || '').trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(newMoveStr)) {
        alert('Format invalide. Utilisez la notation UCI, ex: e2e4 ou e7e8q (promotion).');
        return;
    }
    const old = openingDB[key];
    if (!old) return;
    if (newMoveStr !== old.move) {
        const san = _sanForKeyMove(key, newMoveStr);
        if (!san) { alert('Ce coup est impossible depuis cette position.'); return; }
        const apply = extra => {
            if (!trashEntries([key].concat(extra), 'coup remplacé')) return;      // ancien coup + branches orphelines conservés 30 jours
            extra.forEach(k => { delete openingDB[k]; });
            // Nouvelle réponse = nouvelles statistiques.
            const upd = { move: newMoveStr, san, attempts: 1, failures: 0, lastReviewed: Date.now() };
            if (old.path) { upd.path = old.path.slice(0, -1).concat(newMoveStr); upd.ply = upd.path.length; }
            openingDB[key] = upd;
            saveDB();
            noteChange(1 + extra.length);
            renderAdminEntries();
        };
        const orphans = findOrphans(key, newMoveStr);
        if (!orphans.length) { apply([]); return; }
        askConfirmChoice(_orphanMessage('modification', orphans.length),
            { cascade: `Modifier et nettoyer les ${orphans.length} coup(s) orphelin(s)`, solo: 'Modifier ce coup seulement' },
            () => apply(orphans), () => apply([]));
        return;
    }
    renderAdminEntries();
}

function deleteEntry(key) {
    const orphans = findOrphans(key, null);
    const done    = extra => { if (!_deleteEntries([key].concat(extra))) return; renderAdminEntries(); };
    if (!orphans.length) {
        askConfirm('Placer cette entrée dans la corbeille ? Elle restera restaurable pendant 30 jours.', () => done([]));
    } else {
        askConfirmChoice(_orphanMessage('suppression', orphans.length),
            { cascade: `Supprimer aussi les ${orphans.length} coup(s) orphelin(s)`, solo: 'Supprimer ce coup seulement' },
            () => done(orphans), () => done([]));
    }
}

function addManualEntry() {
    const fen  = prompt('Position (clé FEN, ex: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b) :');
    if (!fen) return;
    const key = fen.trim();
    if (key.split(' ')[1] !== playerColor) {
        alert(`Cette base est celle des ${playerColor === 'w' ? 'Blancs' : 'Noirs'} : la position doit être au trait des ${playerColor === 'w' ? 'Blancs (… w)' : 'Noirs (… b)'}.`);
        return;
    }
    if (openingDB[key]) { alert('Cette position existe déjà : une seule réponse est autorisée. Modifiez-la dans la liste.'); return; }
    const move = prompt('Coup en notation UCI (ex: e7e5) :');
    if (!move) return;
    const m = move.trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)) { alert('Format de coup invalide.'); return; }
    const san = _sanForKeyMove(key, m);
    if (!san) { alert('Ce coup est impossible depuis cette position.'); return; }
    openingDB[key] = { move: m, san, attempts: 1, failures: 0, lastReviewed: Date.now() };
    saveDB();
    noteChange(1);
    renderAdminEntries();
}

// Saut instantané en haut / en bas du panneau Base (l'en-tête reste visible).
function adminScroll(where) {
    const panel = document.querySelector('#admin-overlay .panel');
    panel.scrollTop = where === 'top' ? 0 : panel.scrollHeight;
}

function closeAdmin() {
    document.getElementById('admin-overlay').classList.add('hidden');
    if (typeof refreshTree === 'function') refreshTree();
}

// ─── IMPORT PGN ───────────────────────────────────────────────────────────────
// Lecture d'un PGN (ligne principale + variantes imbriquées) et fusion dans la base
// du répertoire/couleur actifs :
//   - coup de MON camp : créé s'il n'existe pas (attempts 1, failures 0, lastReviewed now) ;
//     identique → rien ; différent → CONFLIT : l'entrée existante est conservée et le reste
//     de cette ligne est ignoré (il dépendrait d'un coup que le répertoire n'a pas retenu).
//   - coup ADVERSE : jamais stocké — il ouvre simplement une branche (la position suivante).
//   - une « branche » = une ligne (principale ou variante) ayant apporté au moins un nouveau coup.

function _pgnTokenize(text) {
    const toks = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
        const c = text[i];
        if (c === '{') { const j = text.indexOf('}', i); i = j < 0 ? n : j + 1; continue; }
        if (c === ';' || (c === '%' && (i === 0 || text[i - 1] === '\n'))) {
            const j = text.indexOf('\n', i); i = j < 0 ? n : j + 1; continue;
        }
        if (c === '[') {                                          // tag : [Nom "valeur"]
            let j = i + 1, inQ = false;
            while (j < n && (inQ || text[j] !== ']')) { if (text[j] === '"') inQ = !inQ; j++; }
            toks.push({ type: 'tag', text: text.slice(i + 1, j) });
            i = j + 1; continue;
        }
        if (c === '(') { toks.push({ type: '(' }); i++; continue; }
        if (c === ')') { toks.push({ type: ')' }); i++; continue; }
        if (/\s/.test(c)) { i++; continue; }
        let j = i;
        while (j < n && !/[\s(){};\[]/.test(text[j])) j++;
        let w = text.slice(i, j);
        i = j;
        if (/^\$\d+$/.test(w)) continue;                          // NAG
        if (['1-0', '0-1', '1/2-1/2', '*'].includes(w)) { toks.push({ type: 'result' }); continue; }
        w = w.replace(/^\d+(\.{1,3}|…)/, '').replace(/^\.+/, '').replace(/[!?]+$/, '');
        if (w.length >= 2 && /^[A-Za-z0-9-]/.test(w)) toks.push({ type: 'move', san: w });
    }
    return toks;
}

function _pgnSplitGames(toks) {
    const games = [];
    let cur = { headers: {}, toks: [] };
    const flush = () => { if (cur.toks.some(t => t.type === 'move')) games.push(cur); cur = { headers: {}, toks: [] }; };
    toks.forEach(t => {
        if (t.type === 'tag') {
            if (cur.toks.length) flush();                         // un tag après du texte de coups = nouvelle partie
            const m = /^(\w+)\s+"(.*)"$/.exec(t.text.trim());
            if (m) cur.headers[m[1]] = m[2];
        } else {
            cur.toks.push(t);
            if (t.type === 'result') flush();
        }
    });
    flush();
    return games;
}

// Arbre : une ligne = [{ san, vars: [ligne, ...] }] ; vars = alternatives au coup concerné.
function _pgnParseLine(toks, ptr, top) {
    const moves = [];
    while (ptr.i < toks.length) {
        const t = toks[ptr.i++];
        if (t.type === 'move') moves.push({ san: t.san, vars: [] });
        else if (t.type === '(') {
            const sub = _pgnParseLine(toks, ptr, false);
            if (moves.length) moves[moves.length - 1].vars.push(sub);
        } else if (t.type === ')' && !top) return moves;
    }
    return moves;
}

// SAN → UCI dans la position courante du moteur (null si illisible, illégal ou ambigu).
function _resolveSan(raw) {
    const san  = raw.replace(/[+#!?]+$/g, '').trim();
    const side = turn;

    const castle = /^[O0]-[O0](-[O0])?$/.exec(san);
    if (castle) {
        const kingFrom = board.indexOf(side === 'w' ? 'K' : 'k');
        if (kingFrom < 0) return null;
        const to = kingFrom + (castle[1] ? -2 : 2);
        return getLegalMoves(kingFrom).includes(to) ? moveToStr(kingFrom, to, '') : null;
    }

    const m = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=?([QRBN]))?$/.exec(san);
    if (!m) return null;
    const type = m[1] || 'P', dest = squareToIdx(m[5]), capture = !!m[4];
    const cands = [];
    for (let from = 0; from < 64; from++) {
        const p = board[from];
        if (!p || p.toUpperCase() !== type || isWhite(p) !== (side === 'w')) continue;
        if (m[2] && 'abcdefgh'[from % 8] !== m[2]) continue;
        if (m[3] && Math.floor(from / 8) + 1 !== Number(m[3])) continue;
        if (type === 'P' && !m[2] && ((from % 8 === dest % 8) === capture)) continue;
        if (!getRawMoves(from).includes(dest) || !getLegalMoves(from).includes(dest)) continue;
        cands.push(from);
    }
    if (cands.length !== 1) return null;
    const from = cands[0];
    let promo = isPromotion(from, dest) ? (m[6] ? m[6].toLowerCase() : 'q') : '';
    return moveToStr(from, dest, promo);
}

function _engineState()    { return { board: board.slice(), turn, castlingRights: { ...castlingRights }, enPassant }; }
function _restoreEngine(s) { board = s.board.slice(); turn = s.turn; castlingRights = { ...s.castlingRights }; enPassant = s.enPassant; }

// Traite un coup AVANT son application. Renvoie 'new' | 'same' | 'conflict' | 'opp'.
function _importPgnMove(uci, path, ctx) {
    if (turn !== playerColor) {                                  // coup adverse : jamais stocké dans la base,
        if (recordOppReply(positionKey(), uci)) ctx.oppAdded = true;   // mais mémorisé comme réponse connue
        return 'opp';
    }
    const key = positionKey();
    const e   = openingDB[key];
    const { from, to, promo } = _parseUci(uci);
    const san = toAlgebraic(from, to, promo);

    if (!e) {
        const np = path.concat(uci);
        openingDB[key] = { move: uci, san, attempts: 1, failures: 0, path: np, ply: np.length, lastReviewed: Date.now() };
        ctx.added++;
        return 'new';
    }
    if (e.move === uci) {
        if (!e.path) { e.path = path.concat(uci); e.ply = e.path.length; ctx.healed = true; }
        ctx.same++;
        return 'same';
    }
    const ck = key + '|' + uci;
    if (!ctx.conflictKeys.has(ck)) {
        ctx.conflictKeys.add(ck);
        ctx.conflicts.push({ path: path.slice(), pgnSan: san, keptSan: e.san });
    }
    return 'conflict';
}

function _walkPgnLine(line, startPath, ctx) {
    let path = startPath.slice();
    let own  = 0;
    for (const mv of line) {
        const before = _engineState();
        const uci    = _resolveSan(mv.san);
        let stop = false, after = null, nextPath = path;

        if (!uci) {
            ctx.errors.push({ path: path.slice(), san: mv.san });
            stop = true;
        } else {
            const res = _importPgnMove(uci, path, ctx);
            if (res === 'new') own++;
            if (res === 'conflict') stop = true;
            else { _applyUciRaw(uci); nextPath = path.concat(uci); after = _engineState(); }
        }
        // Variantes : alternatives à CE coup, jouées depuis la position d'avant.
        mv.vars.forEach(v => { _restoreEngine(before); _walkPgnLine(v, path, ctx); });
        if (stop) break;
        _restoreEngine(after);
        path = nextPath;
    }
    if (own) ctx.branches++;
}

function importPgnText(text) {
    const ctx = { added: 0, same: 0, branches: 0, conflicts: [], conflictKeys: new Set(), errors: [], skipped: 0, games: 0, healed: false };
    const games = _pgnSplitGames(_pgnTokenize(text));
    _withEngineSnapshot(() => {
        games.forEach(g => {
            const fen = g.headers.FEN;
            if (fen && fen.split(' ')[0] !== INIT_FEN.split(' ')[0]) { ctx.skipped++; return; }   // position de départ personnalisée
            ctx.games++;
            parseFEN(INIT_FEN);
            _walkPgnLine(_pgnParseLine(g.toks, { i: 0 }, true), [], ctx);
        });
    });
    ctx.totalGames = games.length;
    if (ctx.added || ctx.healed) saveDB();
    if (ctx.oppAdded) saveOpp();
    if (ctx.added) noteChange(ctx.added);
    return ctx;
}

// ─── IMPORT PGN : MODALE ──────────────────────────────────────────────────────

function _esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function showPgnImport() {
    document.getElementById('pgn-target').textContent =
        `${currentRepertoire} · ${playerColor === 'w' ? 'Blancs' : 'Noirs'}`;
    document.getElementById('pgn-text').value = '';
    document.getElementById('pgn-file-name').textContent = '';
    document.getElementById('pgn-result').innerHTML = '';
    document.getElementById('pgn-overlay').classList.remove('hidden');
}

function closePgnImport() {
    document.getElementById('pgn-overlay').classList.add('hidden');
}

function onPgnFileChosen(event) {
    const file = event.target.files[0];
    if (!file) return;
    document.getElementById('pgn-file-name').textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => { document.getElementById('pgn-text').value = e.target.result; };
    reader.readAsText(file);
}

function _pgnLineLabel(path, extra) {
    return formatLinePrefix(_pathToSans(path)) + (path.length ? ' ' : '') + extra;
}

function runPgnImport() {
    const out  = document.getElementById('pgn-result');
    const text = document.getElementById('pgn-text').value.trim();
    if (!text) { out.innerHTML = '<div class="pgn-note warn">Collez du PGN ou choisissez un fichier .pgn.</div>'; return; }

    const r = importPgnText(text);
    const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
    let html = '';

    if (!r.totalGames) {
        html = '<div class="pgn-note err">Aucune partie reconnue dans ce texte.</div>';
    } else if (r.added) {
        html = `<div class="pgn-note ok">✓ Import PGN réussi : ${pl(r.added, 'nouveau coup ajouté', 'nouveaux coups ajoutés')}, ${pl(r.branches, 'branche créée', 'branches créées')}.</div>`;
    } else if (r.same || r.conflicts.length) {
        html = `<div class="pgn-note info">${ico('info')} Rien de nouveau : tous les coups de ce PGN sont déjà dans le répertoire (ou en conflit).</div>`;
    } else {
        html = '<div class="pgn-note err">Aucun coup valide trouvé dans ce PGN.</div>';
    }
    if (r.same)    html += `<div class="pgn-line">${pl(r.same, 'coup déjà connu', 'coups déjà connus')} (ignoré${r.same > 1 ? 's' : ''}).</div>`;
    if (r.skipped) html += `<div class="pgn-line">${pl(r.skipped, 'partie ignorée', 'parties ignorées')} (position de départ personnalisée).</div>`;
    if (r.conflicts.length) {
        html += `<div class="pgn-note warn">${ico('alert-triangle')} ${pl(r.conflicts.length, 'conflit', 'conflits')} : votre coup déjà enregistré a été conservé, la suite de la ligne n'a pas été importée.</div><ul class="pgn-list">`;
        r.conflicts.slice(0, 10).forEach(c => {
            html += `<li>${_esc(_pgnLineLabel(c.path, ''))}<br>PGN : <strong>${_esc(c.pgnSan)}</strong> · conservé : <strong>${_esc(c.keptSan)}</strong></li>`;
        });
        if (r.conflicts.length > 10) html += `<li>… et ${r.conflicts.length - 10} autre(s)</li>`;
        html += '</ul>';
    }
    if (r.errors.length) {
        html += `<div class="pgn-note warn">${ico('alert-triangle')} ${pl(r.errors.length, 'coup illisible ou illégal', 'coups illisibles ou illégaux')} (ligne abandonnée à cet endroit) :</div><ul class="pgn-list">`;
        r.errors.slice(0, 8).forEach(e => { html += `<li>${_esc(_pgnLineLabel(e.path, ''))}<strong>${_esc(e.san)}</strong></li>`; });
        if (r.errors.length > 8) html += `<li>… et ${r.errors.length - 8} autre(s)</li>`;
        html += '</ul>';
    }
    out.innerHTML = html;
    renderAdminEntries();
    if (typeof refreshTree === 'function') refreshTree();
}

// ─── OVERLAY BASE : fermeture par clic extérieur et touche Échap ──────────────

(function initOverlayDismiss() {
    ['admin-overlay', 'pgn-overlay', 'trash-overlay'].forEach(id => {
        const overlay = document.getElementById(id);
        overlay.addEventListener('mousedown', e => {
            if (e.target !== overlay) return;
            if (id === 'pgn-overlay') closePgnImport(); else if (id === 'trash-overlay') closeTrash(); else closeAdmin();
        });
    });

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const hidden = id => document.getElementById(id).classList.contains('hidden');
        if (!hidden('help-overlay') || !hidden('settings-overlay')) return;   // aide / paramètres gèrent leur propre Échap
        if (!hidden('confirm-overlay')) { document.getElementById('confirm-cancel-btn').click(); return; }
        if (!hidden('trash-overlay')) { closeTrash(); return; }
        if (!hidden('pgn-overlay')) { closePgnImport(); return; }
        if (!hidden('admin-overlay')) closeAdmin();
    });
})();
