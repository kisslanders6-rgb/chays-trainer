/**
 * core/chessEngine.js
 * ──────────────────────────────────────────────────────────────────────────
 * Moteur mathématique pur : règles des échecs, coups légaux, FEN,
 * détection d'échec, roque, en passant, promotion.
 * Ce module est totalement indépendant de l'affichage.
 */

'use strict';

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const PIECES = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
};

const INIT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ─── ÉTAT GLOBAL DU JEU ───────────────────────────────────────────────────────

let board           = [];
let turn            = 'w';
let selected        = null;
let legalMoves      = [];
let lastFrom        = -1;
let lastTo          = -1;
let moveHistory     = [];
let castlingRights  = { K: true, Q: true, k: true, q: true };
let enPassant       = -1;
let hintPiece       = null;
let awaitingPromotion = null;

// ─── UTILITAIRES DE BASE ──────────────────────────────────────────────────────

function isWhite(p)          { return p && p === p.toUpperCase() && p !== ''; }
function isBlack(p)          { return p && p === p.toLowerCase() && p !== ''; }
function sameColor(a, b)     { if (!a || !b) return false; return isWhite(a) === isWhite(b); }
function inBounds(r, c)      { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function squareToName(sq)    { return 'abcdefgh'[sq % 8] + (Math.floor(sq / 8) + 1); }
function squareToIdx(name)   { const c = name.charCodeAt(0) - 97, r = parseInt(name[1]) - 1; return r * 8 + c; }
function moveToStr(from, to, promo) { return squareToName(from) + squareToName(to) + (promo || '').toLowerCase(); }

// ─── CLEF DE POSITION (base d'ouvertures) ─────────────────────────────────────
// « pièces trait roques passant », comme les quatre premiers champs d'un FEN. La case de prise en
// passant n'est notée que si une prise y est réellement jouable : sinon deux positions identiques
// auraient des clés différentes. Ancien format (avant 2026-10) : « pièces trait » (cf. upgradeKey).

function castlingField() {
    const cr = (castlingRights.K && board[4] === 'K' && board[7] === 'R' ? 'K' : '') +
               (castlingRights.Q && board[4] === 'K' && board[0] === 'R' ? 'Q' : '') +
               (castlingRights.k && board[60] === 'k' && board[63] === 'r' ? 'k' : '') +
               (castlingRights.q && board[60] === 'k' && board[56] === 'r' ? 'q' : '');
    return cr || '-';
}

function enPassantField() {
    if (enPassant < 0) return '-';
    const pawn = turn === 'w' ? 'P' : 'p', r = Math.floor(enPassant / 8) + (turn === 'w' ? -1 : 1);
    for (const dc of [-1, 1]) {
        const c = enPassant % 8 + dc;
        if (inBounds(r, c) && board[r * 8 + c] === pawn && getLegalMoves(r * 8 + c).includes(enPassant)) return squareToName(enPassant);
    }
    return '-';
}

function positionKey() {
    let rows = [];
    for (let r = 7; r >= 0; r--) {
        let row = '', empty = 0;
        for (let c = 0; c < 8; c++) {
            const p = board[r * 8 + c];
            if (!p) { empty++; }
            else { if (empty) { row += empty; empty = 0; } row += p; }
        }
        if (empty) row += empty;
        rows.push(row);
    }
    return rows.join('/') + ' ' + turn + ' ' + castlingField() + ' ' + enPassantField();
}

const isLegacyKey = k => typeof k === 'string' && k.trim().split(/\s+/).length === 2;

// Clé au format actuel pour une clé de l'ancien format : roques déduits des pièces sur leurs
// cases d'origine, sans prise en passant (meilleure estimation sans l'historique des coups).
function upgradeKey(k) {
    if (!isLegacyKey(k)) return k;
    const s = { board: board.slice(), turn, castlingRights: { ...castlingRights }, enPassant };
    try { parseFEN(k); return positionKey(); }
    finally { board = s.board; turn = s.turn; castlingRights = s.castlingRights; enPassant = s.enPassant; }
}

// ─── ANALYSE FEN ──────────────────────────────────────────────────────────────

function parseFEN(fen) {
    const parts = fen.trim().split(/\s+/);
    const rows  = parts[0].split('/');
    board = new Array(64).fill('');
    for (let r = 0; r < 8; r++) {
        let col = 0;
        for (const ch of rows[r]) {
            if (ch >= '1' && ch <= '8') { col += parseInt(ch); }
            else { board[(7 - r) * 8 + col] = ch; col++; }
        }
    }
    turn = parts[1] || 'w';

    // Clé à 2 champs (ou champ roque absent/invalide) : droits déduits des pièces sur leurs cases d'origine.
    const hasCastlingField = parts.length >= 3 && /^(-|[KQkq]+)$/.test(parts[2]);
    const cr = hasCastlingField ? parts[2] : 'KQkq';
    castlingRights = { K: cr.includes('K'), Q: cr.includes('Q'), k: cr.includes('k'), q: cr.includes('q') };

    // Cohérence avec la position réelle (roi et tours sur leurs cases d'origine)
    castlingRights.K = castlingRights.K && board[4]  === 'K' && board[7]  === 'R';
    castlingRights.Q = castlingRights.Q && board[4]  === 'K' && board[0]  === 'R';
    castlingRights.k = castlingRights.k && board[60] === 'k' && board[63] === 'r';
    castlingRights.q = castlingRights.q && board[60] === 'k' && board[56] === 'r';

    const ep = parts[3] || '-';
    if (ep !== '-' && /^[a-h][1-8]$/.test(ep)) { enPassant = (parseInt(ep[1]) - 1) * 8 + (ep.charCodeAt(0) - 97); }
    else enPassant = -1;
}

// ─── GÉNÉRATION DES COUPS BRUTS (sans vérification de mise en échec) ──────────

function getRawMoves(idx) {
    const p = board[idx]; if (!p) return [];
    const r = Math.floor(idx / 8), c = idx % 8;
    const moves = [];
    const type  = p.toUpperCase();

    const add = (nr, nc) => {
        if (!inBounds(nr, nc)) return false;
        const t = board[nr * 8 + nc];
        if (sameColor(p, t)) return false;
        moves.push(nr * 8 + nc);
        return !t;
    };
    const slide = (dr, dc) => {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
            const t = board[nr * 8 + nc];
            if (sameColor(p, t)) break;
            moves.push(nr * 8 + nc);
            if (t) break;
            nr += dr; nc += dc;
        }
    };

    if (type === 'P') {
        const dir   = isWhite(p) ? 1 : -1;
        const start = isWhite(p) ? 1 : 6;
        if (inBounds(r + dir, c) && !board[(r + dir) * 8 + c]) {
            moves.push((r + dir) * 8 + c);
            if (r === start && !board[(r + 2 * dir) * 8 + c]) moves.push((r + 2 * dir) * 8 + c);
        }
        [-1, 1].forEach(dc => {
            if (!inBounds(r + dir, c + dc)) return;
            const t = board[(r + dir) * 8 + (c + dc)];
            if (t && !sameColor(p, t)) moves.push((r + dir) * 8 + (c + dc));
            if ((r + dir) * 8 + (c + dc) === enPassant) moves.push(enPassant);
        });

    } else if (type === 'N') {
        [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => add(r+dr, c+dc));

    } else if (type === 'K') {
      [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc]) => add(r+dr, c+dc));
      addCastling(idx, p, moves);

    } else if (type === 'R') { slide(1,0); slide(-1,0); slide(0,1); slide(0,-1); }
    else if (type === 'B')   { slide(1,1); slide(1,-1); slide(-1,1); slide(-1,-1); }
    else if (type === 'Q')   { slide(1,0); slide(-1,0); slide(0,1); slide(0,-1); slide(1,1); slide(1,-1); slide(-1,1); slide(-1,-1); }

    return moves;
}

function addCastling(idx, p, moves) {
    const white = isWhite(p);
    const home  = white ? 4 : 60;
    if (idx !== home) return;

    const enemy = white ? 'b' : 'w';
    if (isSquareAttacked(home, enemy)) return;               // roi en échec

    const base  = white ? 0 : 56;
    const rook  = white ? 'R' : 'r';
    const canK  = white ? castlingRights.K : castlingRights.k;
    const canQ  = white ? castlingRights.Q : castlingRights.q;

    if (canK && board[base + 7] === rook
        && !board[base + 5] && !board[base + 6]
        && !isSquareAttacked(base + 5, enemy) && !isSquareAttacked(base + 6, enemy)) {
        moves.push(base + 6);
    }
    if (canQ && board[base] === rook
        && !board[base + 1] && !board[base + 2] && !board[base + 3]
        && !isSquareAttacked(base + 3, enemy) && !isSquareAttacked(base + 2, enemy)) {
        moves.push(base + 2);
    }
}

// ─── POSITION DU ROI ──────────────────────────────────────────────────────────

function findKing(color) {
    const k = color === 'w' ? 'K' : 'k';
    return board.indexOf(k);
}

// ─── DÉTECTION D'ATTAQUE ──────────────────────────────────────────────────────

function isSquareAttacked(sq, byColor) {
    const white = byColor === 'w';
    const r = Math.floor(sq / 8), c = sq % 8;
    const at = (rr, cc) => inBounds(rr, cc) ? board[rr * 8 + cc] : null;

    // Pions
    const pr = white ? r - 1 : r + 1;
    const pawn = white ? 'P' : 'p';
    if (at(pr, c - 1) === pawn || at(pr, c + 1) === pawn) return true;

    // Cavaliers
    const knight = white ? 'N' : 'n';
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        if (at(r + dr, c + dc) === knight) return true;
    }

    // Roi
    const king = white ? 'K' : 'k';
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if ((dr || dc) && at(r + dr, c + dc) === king) return true;
    }

    // Pièces à longue portée
    const rook = white ? 'R' : 'r', bishop = white ? 'B' : 'b', queen = white ? 'Q' : 'q';
    const ray = (dr, dc, a, b) => {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
            const t = board[nr * 8 + nc];
            if (t) return t === a || t === b;
            nr += dr; nc += dc;
        }
        return false;
    };
    for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) if (ray(dr, dc, rook, queen))   return true;
    for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) if (ray(dr, dc, bishop, queen)) return true;

    return false;
}

// ─── COUPS LÉGAUX (filtrés : pas de mise en échec de son propre roi) ──────────

function getLegalMoves(idx) {
    const raw   = getRawMoves(idx);
    const p     = board[idx];
    const color = isWhite(p) ? 'w' : 'b';
    return raw.filter(to => {
        const save   = board.slice();
        const saveEP = enPassant;
        const saveCR = { ...castlingRights };
        applyMoveRaw(idx, to);
        const king = findKing(color);
        const safe = !isSquareAttacked(king, color === 'w' ? 'b' : 'w');
        board          = save.slice();
        enPassant      = saveEP;
        castlingRights = saveCR;
        return safe;
    });
}

// ─── APPLICATION D'UN COUP (état interne, sans historique) ────────────────────

function applyMoveRaw(from, to) {
    const p        = board[from];
    const captured = board[to];
    board[to]   = p;
    board[from] = '';
    const type = p.toUpperCase();
    const r    = Math.floor(from / 8), c2 = to % 8;

    // En passant
    if (type === 'P' && to === enPassant) { board[r * 8 + c2] = ''; }
    enPassant = -1;
    if (type === 'P' && Math.abs(to - from) === 16) { enPassant = (from + to) >> 1; }

    // Roque (déplacement de la tour)
    if (type === 'K') {
        if (isWhite(p)) { castlingRights.K = false; castlingRights.Q = false; }
        else            { castlingRights.k = false; castlingRights.q = false; }
        const dc = (to % 8) - (from % 8);
        if (Math.abs(dc) === 2) {
            const rr = Math.floor(from / 8);
            if (dc > 0) { board[rr*8+5] = board[rr*8+7]; board[rr*8+7] = ''; }
            else        { board[rr*8+3] = board[rr*8];   board[rr*8]   = ''; }
        }
    }

    // Droits perdus si une tour part de son coin OU est capturée dans son coin
    const corners = { 0: 'Q', 7: 'K', 56: 'q', 63: 'k' };
    if (type === 'R' && corners[from]) castlingRights[corners[from]] = false;
    if (captured && corners[to])       castlingRights[corners[to]]   = false;
}

// ─── NOTATION ALGÉBRIQUE ──────────────────────────────────────────────────────
// SAN standard : lettre de la pièce, colonne et / ou rangée de départ si une autre pièce du même
// type peut aller sur la même case (Nce4, R1a2, Qh4e1), « + » pour un échec et « # » pour un mat.
// À appeler AVANT d'appliquer le coup ; la position est laissée intacte.

function _sanDisambiguation(from, to) {
    const p = board[from];
    const rivals = [];
    for (let i = 0; i < 64; i++) if (i !== from && board[i] === p && getLegalMoves(i).includes(to)) rivals.push(i);
    if (!rivals.length) return '';
    const file = 'abcdefgh'[from % 8], rank = String(Math.floor(from / 8) + 1);
    if (rivals.every(i => i % 8 !== from % 8)) return file;
    if (rivals.every(i => Math.floor(i / 8) !== Math.floor(from / 8))) return rank;
    return file + rank;
}

function _sanCheckSuffix(from, to, promo) {
    const s = { board: board.slice(), castlingRights: { ...castlingRights }, enPassant };
    const color = isWhite(board[from]) ? 'w' : 'b', enemy = color === 'w' ? 'b' : 'w';
    try {
        applyMoveRaw(from, to);
        if (promo) board[to] = color === 'w' ? promo.toUpperCase() : promo.toLowerCase();
        else if (board[to].toUpperCase() === 'P' && (Math.floor(to / 8) === 7 || Math.floor(to / 8) === 0)) board[to] = color === 'w' ? 'Q' : 'q';
        const king = findKing(enemy);
        if (king < 0 || !isSquareAttacked(king, color)) return '';
        for (let i = 0; i < 64; i++) {
            if (board[i] && isWhite(board[i]) === (enemy === 'w') && getLegalMoves(i).length) return '+';
        }
        return '#';
    } finally { board = s.board; castlingRights = s.castlingRights; enPassant = s.enPassant; }
}

function toAlgebraic(from, to, promo) {
    const files = 'abcdefgh';
    const p    = board[from];
    const type = p ? p.toUpperCase() : '';
    if (!p) return squareToName(from) + squareToName(to);
    let s = '';
    const capture = (board[to] && !sameColor(p, board[to])) || (type === 'P' && to === enPassant);
    if (type === 'K' && Math.abs((to % 8) - (from % 8)) === 2) {
        s = (to % 8) > 4 ? 'O-O' : 'O-O-O';
    } else {
        if (type !== 'P') s += type + (type === 'K' ? '' : _sanDisambiguation(from, to));
        else if (capture) s += files[from % 8];
        if (capture) s += 'x';
        s += files[to % 8] + (Math.floor(to / 8) + 1);
        if (promo) s += '=' + promo.toUpperCase();
    }
    return s + _sanCheckSuffix(from, to, promo);
}

// ─── DÉTECTION PROMOTION ──────────────────────────────────────────────────────

function isPromotion(from, to) {
    const p = board[from];
    if (!p || p.toUpperCase() !== 'P') return false;
    return (isWhite(p) && Math.floor(to / 8) === 7) || (isBlack(p) && Math.floor(to / 8) === 0);
}

// ─── APPLICATION COMPLÈTE (avec historique et promotion) ──────────────────────

function applyMove(from, to, promo, newDbKey) {
    const san = toAlgebraic(from, to, promo);
    moveHistory.push({
        from, to, promo, san,
        boardBefore:    board.slice(),
        turnBefore:     turn,
        castlingBefore: { ...castlingRights },
        epBefore:       enPassant,
        newDbKey:       newDbKey || null
    });
    applyMoveRaw(from, to);
    if (promo) {
        board[to] = turn === 'w' ? promo.toUpperCase() : promo.toLowerCase();
    } else if (board[to] && board[to].toUpperCase() === 'P') {
        const r2 = Math.floor(to / 8);
        if (r2 === 7) board[to] = 'Q';
        if (r2 === 0) board[to] = 'q';
    }
    lastFrom = from; lastTo = to;
    turn = turn === 'w' ? 'b' : 'w';
    renderMoves();
}

// ─── API SANS ÉTAT PARTAGÉ (Chess) ────────────────────────────────────────────
// L'état global ci-dessus (board, turn…) est celui de la partie AFFICHÉE. Tout calcul sur une autre position
// passe par Chess : ses fonctions prennent une position { board, turn, castling, ep } et n'en modifient aucune,
// et l'état affiché est rétabli même si le calcul échoue (isolated).
//   Chess.start() · Chess.fromFen(fen) · Chess.replay(chemin UCI[, départ]) → position
//   Chess.play(pos, uci) → nouvelle position · Chess.san(pos, uci) · Chess.key(pos) · Chess.legalMoves(pos) → [uci]
//   Chess.isolated(fn) : fn peut manipuler l'état global, il est restauré ensuite.

const Chess = (function () {
    const snapshot = () => ({ board: board.slice(), turn, castling: { ...castlingRights }, ep: enPassant });
    function load(pos) { board = pos.board.slice(); turn = pos.turn; castlingRights = { ...pos.castling }; enPassant = pos.ep; }
    function isolated(fn) {
        const s = snapshot();
        try { return fn(); } finally { load(s); }
    }
    const at = (pos, fn) => isolated(() => { load(pos); return fn(); });

    const parseUci = u => ({ from: squareToIdx(u.slice(0, 2)), to: squareToIdx(u.slice(2, 4)), promo: u[4] || null });

    // Joue un coup UCI sur l'état global (sans historique) ; promotion en Dame si non précisée.
    function playRaw(uci) {
        const { from, to, promo } = parseUci(uci);
        const t = turn;
        applyMoveRaw(from, to);
        const r = Math.floor(to / 8);
        if (board[to] && board[to].toUpperCase() === 'P' && (r === 7 || r === 0)) {
            const p = promo || 'q';
            board[to] = t === 'w' ? p.toUpperCase() : p.toLowerCase();
        }
        turn = t === 'w' ? 'b' : 'w';
    }

    function legalHere() {
        const out = [];
        for (let from = 0; from < 64; from++) {
            const p = board[from];
            if (!p || isWhite(p) !== (turn === 'w')) continue;
            for (const to of getLegalMoves(from)) {
                (isPromotion(from, to) ? ['q', 'r', 'b', 'n'] : ['']).forEach(pr => out.push(moveToStr(from, to, pr)));
            }
        }
        return out;
    }

    const fromFen = fen => isolated(() => { parseFEN(fen); return snapshot(); });
    const start   = () => fromFen(INIT_FEN);
    const play    = (pos, uci) => at(pos, () => { playRaw(uci); return snapshot(); });
    const san     = (pos, uci) => at(pos, () => { const m = parseUci(uci); return toAlgebraic(m.from, m.to, m.promo); });
    const key     = pos => at(pos, positionKey);
    const legalMoves = pos => at(pos, legalHere);
    const replay  = (path, from) => path.reduce((pos, u) => play(pos, u), from || start());

    return { snapshot, load, isolated, parseUci, playRaw, fromFen, start, play, san, key, legalMoves, replay };
})();
