/**
 * modules/openings/openingsLogic.js
 * ──────────────────────────────────────────────────────────────────────────
 * Logique du mode « Jouer » (récitation + construction manuelle) :
 *   - Clics sur l'échiquier, coups de l'adversaire (libres) et du joueur
 *   - Validation contre la base : UNE SEULE réponse par position de mon camp
 *   - Indice textuel (type de pièce), annulation, réinitialisation
 * Panneau de la base : adminPanel.js · Import / export PGN : pgn.js
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
        openingDB[key] = { move: movStr, san, attempts: 1, failures: 0, path, ply: path.length };
        recordReview(openingDB[key], true);
        saveDB();
        noteChange(1);
        _commitMove(from, to, promo, key, `Nouveau coup enregistré : ${san}`, 'new');

    } else if (movStr === entry.move) {
        // Bon coup (sur une transposition : la progression continue, le path d'origine est conservé).
        const transp = _isTransposition(entry);
        entry.attempts++;
        recordReview(entry, true);
        if (!entry.path) { entry.path = pathNow.concat(movStr); entry.ply = entry.path.length; }
        saveDB();
        _commitMove(from, to, promo, null, transp ? '✓ Correct ! (transposition)' : '✓ Correct !', 'ok');

    } else {
        // Mauvais coup : refusé, la bonne réponse n'est pas dévoilée.
        entry.attempts++;
        entry.failures++;
        recordReview(entry, false);
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
