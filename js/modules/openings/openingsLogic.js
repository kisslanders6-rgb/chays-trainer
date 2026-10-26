/**
 * modules/openings/openingsLogic.js
 * ──────────────────────────────────────────────────────────────────────────
 * Logique du mode « Jouer » (récitation + construction manuelle) :
 *   - Clics sur l'échiquier, coups de l'adversaire (libres) et du joueur
 *   - Validation contre la base : UNE SEULE réponse par position de mon camp
 *   - Indice textuel (type de pièce), annulation, réinitialisation
 * Import / export : dataPanel.js, pgn.js · Édition des coups : treeView.js (onglet Arbre)
 *
 * Modèle : openingDB[clé] = { move, san, attempts, failures, path?, ply?, due? }
 *   - position inconnue          → le coup devient la référence (attempts 0, due = maintenant : il sera
 *                                  proposé dès la prochaine séance d'Entraînement)
 *   - bon coup / mauvais coup    → verdict affiché, mais RIEN n'est compté : seul l'Entraînement fait
 *                                  évoluer les statistiques et le planning de révision (newEntry, storage.js)
 * Aucune profondeur maximale : l'arbre se prolonge tant que des coups sont joués.
 */

'use strict';

// ─── OUTILS MOTEUR (sans effet sur l'affichage) ───────────────────────────────

const _parseUci = u => Chess.parseUci(u);
const _withEngineSnapshot = fn => Chess.isolated(fn);       // calcul sur une autre position que celle affichée

// Joue un coup UCI sur l'état brut du moteur (sans historique) et renvoie son SAN.
function _applyUciRaw(uci) {
    const { from, to, promo } = _parseUci(uci);
    const san = toAlgebraic(from, to, promo);
    Chess.playRaw(uci);
    return san;
}

function formatLinePrefix(sans) {
    if (!sans.length) return '(position de départ)';
    let out = '';
    sans.forEach((san, i) => {
        if (i % 2 === 0) out += (Math.floor(i / 2) + 1) + '. ';
        out += formatSan(san, i % 2 ? 'b' : 'w') + ' ';
    });
    return out.trim();
}

function _pathToSans(path) {
    let pos = Chess.start();
    return path.map(u => { const san = Chess.san(pos, u); pos = Chess.play(pos, u); return san; });
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
    clearErrorFx();
    _resetHint();
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
        if (turn !== playerColor && gameMode !== 'analysis') {      // Analyse : les deux camps passent par executePlayerMove
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

function _commitMove(from, to, promo, newDbKey, statusMsg, statusType, statusDetail) {
    _resetHint();
    playMoveSound(from, to);                // avant applyMove : détecte la capture
    animateNextMove(from, to);
    applyMove(from, to, promo, newDbKey);   // met à jour board/turn/moveHistory + renderMoves()
    if (typeof refreshTree === 'function') refreshTree();
    selected = null; legalMoves = []; hintPiece = null;
    resetNavCursor();
    if (statusMsg) setStatus(statusMsg, statusType || 'info', statusDetail);
    renderBoard();
}

// ─── COUP DE L'ADVERSAIRE ─────────────────────────────────────────────────────

// Transposition : la position (clé FEN) est déjà connue, mais atteinte par un autre ordre de coups.
function _isTransposition(entry) {
    if (!entry || !entry.path) return false;
    const now = moveHistory.map(m => moveToStr(m.from, m.to, m.promo));
    return entry.path.slice(0, -1).join(' ') !== now.join(' ');
}

// Promotion automatique en dame (Paramètres › Jeu), sauf si Alt est maintenu pendant le coup.
const _autoPromo = () => appSettings.autoQueen && !(typeof altHeld !== 'undefined' && altHeld) ? 'Q' : undefined;

function executeOpponentMove(from, to, promo) {
    if (promo === undefined && isPromotion(from, to)) promo = _autoPromo();
    if (promo === undefined) {
        if (isPromotion(from, to)) {
            awaitingPromotion = { from, to, isOpponent: true };
            showPromotion();
            return;
        }
        promo = null;
    }
    const san = formatSan(toAlgebraic(from, to, promo), turn);
    if (recordOppReply(positionKey(), moveToStr(from, to, promo))) saveOpp();   // réponse adverse connue
    _commitMove(from, to, promo, null, `Adversaire : ${san}`, 'info', 'À vous de répondre.');
    // Position déjà au répertoire mais atteinte par un autre ordre de coups : la réponse mémorisée s'applique.
    if (turn === playerColor && _isTransposition(openingDB[positionKey()])) {
        setStatus(`Adversaire : ${san}`, 'info', 'Transposition : position déjà connue par un autre ordre de coups.');
    }
}

// ─── COUP DU JOUEUR ───────────────────────────────────────────────────────────

function _rejectMove(toIdx, msg, detail) {
    selected = null; legalMoves = []; hintPiece = null;
    renderBoard();
    flashWrong(toIdx);
    playSound('error');
    setStatus(msg, 'err', detail);
}

function executePlayerMove(from, to, promo) {
    if (promo === undefined && isPromotion(from, to)) promo = _autoPromo();
    if (promo === undefined) {
        if (isPromotion(from, to)) {
            awaitingPromotion = { from, to, isOpponent: false };
            showPromotion();
            return;
        }
        promo = null;
    }

    if (gameMode === 'analysis') { analysisMove(from, to, promo); return; }      // brouillon : rien n'est vérifié ni enregistré

    const key    = positionKey();
    const entry  = openingDB[key];
    const movStr = moveToStr(from, to, promo);
    const san    = toAlgebraic(from, to, promo);

    if (gameMode === 'endgame') { answerEndgameMove(from, to, promo); return; }
    if (gameMode === 'training') { answerTrainingMove(entry, from, to, promo, movStr); return; }

    const pathNow = moveHistory.map(m => moveToStr(m.from, m.to, m.promo));

    if (!entry) {
        // Position inconnue → ce coup devient l'unique réponse de référence.
        openingDB[key] = newEntry(movStr, san, pathNow.concat(movStr));
        saveDB();
        noteChange(1);
        _commitMove(from, to, promo, key, `Nouveau coup enregistré : ${formatSan(san, turn)}`, 'new');

    } else if (_solutionKey === key) {
        if (movStr === entry.move) _commitMove(from, to, promo, null, '✓ Solution jouée', 'info');
        else _rejectMove(to, "✗ Ce n'est pas le coup de la solution.");

    } else if (movStr === entry.move) {
        // Bon coup (sur une transposition : la progression continue, le path d'origine est conservé).
        const transp = _isTransposition(entry);
        if (!entry.path) { entry.path = pathNow.concat(movStr); entry.ply = entry.path.length; saveDB(); }
        _commitMove(from, to, promo, null, transp ? '✓ Correct ! (transposition)' : '✓ Correct !', 'ok');

    } else {
        // Mauvais coup : refusé, la bonne réponse n'est pas dévoilée.
        _rejectMove(to, '✗ Pas le bon coup', 'Réessayez, ou appuyez sur Indice.');
        noteMistake(key);
    }
}

// Indice automatique (Paramètres › Jeu) : après N erreurs d'affilée sur la même position.
let _mistakeRun = { key: null, n: 0 };
function noteMistake(key) {
    if (_mistakeRun.key !== key) _mistakeRun = { key, n: 0 };
    _mistakeRun.n++;
    const after = appSettings.hintAfter;
    if (after && _mistakeRun.n >= after && _hintKey !== key) showHint();
}

// ─── INDICE PUIS SOLUTION ─────────────────────────────────────────────────────
// Un même bouton (et la touche Espace) : 1er appui = indice (type de pièce à jouer), le bouton devient
// alors « Solution » ; 2e appui = le coup attendu est surligné (halo doré). Dévoiler la solution compte
// une erreur sur la position, une seule fois ; le coup joué ensuite ne compte pas comme une réussite.
// Jouer et Entraînement (showTrainingSolution) ; les finales ont leurs propres indices (endgameHint).

const PIECE_HINT = { P: 'un Pion', N: 'un Cavalier', B: 'un Fou', R: 'une Tour', Q: 'une Dame', K: 'le Roi' };

let _hintKey      = null;     // position pour laquelle l'indice a été donné (le bouton affiche alors « Solution »)
let _solutionKey  = null;     // position dont la solution a été dévoilée en mode Jouer
let _solutionMove = null;     // { key, from, to } : coup surligné par le halo

function showHint() {
    if (gameMode === 'endgame') { endgameHint(); return; }
    if (gameMode === 'preview' || (gameMode === 'training' && trainingState.busy)) return;
    if (navCursor !== -1) _syncEngineToNavCursor();
    if (turn !== playerColor) {
        setStatus("L'indice n'est disponible que pour vos propres coups.", 'info');
        return;
    }
    const key   = positionKey();
    const entry = openingDB[key];
    if (!entry) { setStatus("Aucun indice — cette position n'est pas encore dans la base.", 'info'); return; }
    if (_hintKey === key) { showSolution(); return; }
    _hintKey = key;
    const piece = (board[squareToIdx(entry.move.slice(0, 2))] || '').toUpperCase();
    selected = null; legalMoves = []; hintPiece = null;
    renderBoard();
    setStatus(`Indice : déplacez ${PIECE_HINT[piece] || 'une pièce'}.`, 'hint', 'Appuyez encore pour voir la solution.');
}

function showSolution() {
    if (gameMode === 'training') { showTrainingSolution(); return; }
    const key   = positionKey();
    const entry = openingDB[key];
    if (!entry || turn !== playerColor) return;
    _solutionKey = key;
    revealSolution(entry);
    setStatus(`Solution : ${formatSan(entry.san, turn)}`, 'hint', 'Jouez-le pour continuer.');
}

// Surligne le coup de `entry` (pièce + case d'arrivée) avec le halo doré.
function revealSolution(entry) {
    selected   = squareToIdx(entry.move.slice(0, 2));
    legalMoves = [squareToIdx(entry.move.slice(2, 4))];
    hintPiece  = null;
    _solutionMove = { key: positionKey(), from: selected, to: legalMoves[0] };
    renderBoard();
}

// Appelé à chaque rendu de l'échiquier : libellé Indice / Solution et halo, d'après la position réelle.
function _syncHintBtn() {
    const key = positionKey(), m = _solutionMove;
    const fx  = !!m && m.key === key && navCursor === -1 && selected === m.from && legalMoves.length === 1 && legalMoves[0] === m.to;
    const el  = document.getElementById('board');
    if (el) el.classList.toggle('show-solution', fx);
    const sol = (gameMode === 'play' || gameMode === 'training') && _hintKey === key && turn === playerColor && navCursor === -1;
    document.querySelectorAll('.tb-hint').forEach(b => {
        if (b.dataset.sol === String(sol)) return;
        b.dataset.sol = String(sol);
        b.innerHTML   = sol ? `${ico('target')}<span class="btn-label">Solution</span>` : `${ico('lightbulb')}<span class="btn-label">Indice</span>`;
        b.title       = sol ? `Voir la solution (Espace)${gameMode === 'training' ? ' — compte une erreur' : ''}` : 'Indice (Espace)';
    });
}

function _resetHint() { _hintKey = null; _solutionKey = null; _solutionMove = null; }

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

// Supprime l'entrée `key` après confirmation ; propose aussi les branches devenues inaccessibles.
// onDone(nombre de coups orphelins supprimés en plus) n'est appelé que si la suppression a eu lieu.
function confirmDeleteEntry(key, message, onDone) {
    const orphans = findOrphans(key, null);
    const finish  = extra => { if (_deleteEntries([key].concat(extra))) onDone(extra.length); };
    if (!orphans.length) {
        askConfirm(message, () => finish([]));
    } else {
        askConfirmChoice(_orphanMessage('suppression', orphans.length),
            { cascade: `Supprimer aussi les ${orphans.length} coup(s) orphelin(s)`, solo: 'Supprimer ce coup seulement' },
            () => finish(orphans), () => finish([]));
    }
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

// Clé de la position d'avant un coup de l'historique (roques et prise en passant compris).
function _keyBeforeMove(m) {
    return _withEngineSnapshot(() => {
        board = m.boardBefore.slice(); turn = m.turnBefore;
        castlingRights = { ...m.castlingBefore }; enPassant = m.epBefore;
        return positionKey();
    });
}

function undoMove() {
    if (moveHistory.length === 0) { setStatus('Aucun coup à annuler.', 'info'); return; }

    const last = moveHistory[moveHistory.length - 1];

    if (last.turnBefore !== playerColor) {
        // Réponse adverse annulée : on l'oublie si elle ne mène à rien dans le répertoire.
        const childKey = positionKey();
        const posKey   = _keyBeforeMove(last);
        if (!openingDB[childKey] && forgetOppReply(posKey, moveToStr(last.from, last.to, last.promo))) saveOpp();
        performUndo();
        if (typeof refreshTree === 'function') refreshTree();
        setStatus('Coup adverse annulé', 'info', 'Choisissez une autre branche.');
        return;
    }

    // Clé de la position AVANT mon coup (celle de l'entrée à effacer).
    const key = _keyBeforeMove(last);

    if (!openingDB[key]) {                       // rien d'enregistré (déjà supprimé depuis l'Arbre)
        performUndo();
        setStatus('Coup annulé.', 'info');
        return;
    }

    confirmDeleteEntry(key, 'Voulez-vous effacer ce coup de votre répertoire pour en enregistrer un nouveau ? (Il est conservé 30 jours dans la corbeille.)', extra => {
        performUndo();
        if (typeof refreshTree === 'function') refreshTree();
        setStatus('Coup effacé', 'new', 'Jouez le nouveau coup de référence.'
            + (extra ? ` ${extra} coup(s) orphelin(s) nettoyé(s).` : ''));
    });
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
    _resetHint();
    parseFEN(INIT_FEN);
    moveHistory      = [];
    selected         = null; legalMoves = [];
    lastFrom         = -1; lastTo = -1;
    hintPiece        = null;
    awaitingPromotion = null;
    resetNavCursor();
    renderMoves();
    if (playerColor === 'w') {
        setStatus('Nouvelle partie', 'info', 'Jouez votre premier coup (Blancs).');
    } else {
        setStatus('Nouvelle partie', 'info', 'Jouez le premier coup des Blancs (adversaire).');
    }
    renderBoard();
}
