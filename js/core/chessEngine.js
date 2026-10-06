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

// ─── CLEF DE POSITION (FEN simplifié pour la base d'ouvertures) ───────────────

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
    return rows.join('/') + ' ' + turn;
}

// ─── ANALYSE FEN ──────────────────────────────────────────────────────────────

function parseFEN(fen) {
    const parts = fen.split(' ');
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
    const cr = parts[2] || '-';
    castlingRights = { K: cr.includes('K'), Q: cr.includes('Q'), k: cr.includes('k'), q: cr.includes('q') };
    const ep = parts[3] || '-';
    if (ep !== '-') { const f = ep.charCodeAt(0) - 97, rk = parseInt(ep[1]) - 1; enPassant = rk * 8 + f; }
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
        if (isWhite(p)) {
            if (castlingRights.K && !board[r*8+5] && !board[r*8+6] && board[r*8+7]==='R') moves.push(r*8+6);
            if (castlingRights.Q && !board[r*8+3] && !board[r*8+2] && !board[r*8+1] && board[r*8]==='R') moves.push(r*8+2);
        } else {
            if (castlingRights.k && !board[r*8+5] && !board[r*8+6] && board[r*8+7]==='r') moves.push(r*8+6);
            if (castlingRights.q && !board[r*8+3] && !board[r*8+2] && !board[r*8+1] && board[r*8]==='r') moves.push(r*8+2);
        }

    } else if (type === 'R') { slide(1,0); slide(-1,0); slide(0,1); slide(0,-1); }
    else if (type === 'B')   { slide(1,1); slide(1,-1); slide(-1,1); slide(-1,-1); }
    else if (type === 'Q')   { slide(1,0); slide(-1,0); slide(0,1); slide(0,-1); slide(1,1); slide(1,-1); slide(-1,1); slide(-1,-1); }

    return moves;
}

// ─── POSITION DU ROI ──────────────────────────────────────────────────────────

function findKing(color) {
    const k = color === 'w' ? 'K' : 'k';
    return board.indexOf(k);
}

// ─── DÉTECTION D'ATTAQUE ──────────────────────────────────────────────────────

function isSquareAttacked(sq, byColor) {
    for (let i = 0; i < 64; i++) {
        const p = board[i];
        if (!p) continue;
        if ((byColor === 'w') !== isWhite(p)) continue;
        if (getRawMoves(i).includes(sq)) return true;
    }
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
    const p    = board[from];
    board[to]  = p;
    board[from] = '';
    const type = p.toUpperCase();
    const r    = Math.floor(from / 8), c2 = to % 8;

    // En passant : capture du pion adverse
    if (type === 'P' && to === enPassant) { board[r * 8 + c2] = ''; }
    enPassant = -1;
    if (type === 'P' && Math.abs(to - from) === 16) { enPassant = (from + to) >> 1; }

    // Roque
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

    // Mise à jour des droits de roque pour les tours
    if (type === 'R') {
        if (from ===  0) castlingRights.Q = false;
        if (from ===  7) castlingRights.K = false;
        if (from === 56) castlingRights.q = false;
        if (from === 63) castlingRights.k = false;
    }
}

// ─── NOTATION ALGÉBRIQUE ──────────────────────────────────────────────────────

function toAlgebraic(from, to, promo) {
    const files = 'abcdefgh';
    const p    = board[from];
    const type = p ? p.toUpperCase() : '';
    let s = '';
    if (type === 'K' && Math.abs((to % 8) - (from % 8)) === 2) {
        return (to % 8) > 4 ? 'O-O' : 'O-O-O';
    }
    if (type !== 'P') s += type;
    else if ((board[to] && !sameColor(p, board[to])) || to === enPassant) s += files[from % 8];
    if ((board[to] && !sameColor(p, board[to])) || to === enPassant) s += 'x';
    s += files[to % 8] + (Math.floor(to / 8) + 1);
    if (promo) s += '=' + promo.toUpperCase();
    return s;
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