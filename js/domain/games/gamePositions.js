/**
 * domain/games/gamePositions.js
 * ──────────────────────────────────────────────────────────────────────────
 * Types de positions d'une partie, lus en rejouant ses coups : aucun moteur, donc les mêmes pour Chess.com et Lichess.
 *   features(partie)  → { v, qt, me, opp, st, eg, imb } gardé sur la partie (champ pf) ; illisible : { v, bad: 1 }.
 *     qt : les deux dames ont quitté l'échiquier (1 ou 0) · me, opp : roque ('k', 'q', '') · st : structure de pions au coup 15 ·
 *     eg : finale atteinte ('pawn', 'rook', 'queen', 'minor', 'rookMinor') · imb : déséquilibre matériel durable, 'even' sinon.
 *   report(parties)   score, attendu et écart de chaque type, à partir de pf.
 *   run(parties, onDone)   calcule ce qui manque par petits lots et l'enregistre dans l'archive.
 */

'use strict';

const GamePositions = (function () {
    const VERSION = 1, MIN_PLIES = 20, STRUCT_PLY = 30, IMB_PLIES = 30, EG_PIECES = 4, EG_MIN_PLY = 20, EG_MIN_LEFT = 6, IMB_FROM = 12, IMB_HOLD = 6, CHUNK = 20;
    let running = false;

    // ─── LECTURE DES COUPS ───────────────────────────────────────────────────
    const clean = san => String(san).replace(/[+#!?]/g, '');
    function uciOf(pos, san) {
        const want = clean(san), to = /([a-h][1-8])(?:=?[QRBN])?$/.exec(want);
        const legal = Chess.legalMoves(pos), near = to ? legal.filter(u => u.slice(2, 4) === to[1]) : legal;
        return near.find(u => clean(Chess.san(pos, u)) === want) || null;
    }
    function counts(board) {
        const c = { P: 0, N: 0, B: 0, R: 0, Q: 0, p: 0, n: 0, b: 0, r: 0, q: 0 };
        for (let i = 0; i < 64; i++) if (board[i] && board[i] in c) c[board[i]]++;
        return c;
    }
    const pieces = c => c.N + c.B + c.R + c.Q + c.n + c.b + c.r + c.q;

    // ─── STRUCTURES ──────────────────────────────────────────────────────────
    const FILES = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 };
    function structureOf(board, color) {
        const at = (p, sq) => board[(+sq[1] - 1) * 8 + FILES[sq[0]]] === p;
        const onFile = (p, f) => { for (let r = 0; r < 8; r++) if (board[r * 8 + FILES[f]] === p) return true; return false; };
        const none = (p, ...fs) => fs.every(f => !onFile(p, f));
        const iso = (p, sq1, sq2) => (at(p, sq1) || at(p, sq2)) && none(p, 'c', 'e');
        const iqpW = iso('P', 'd4', 'd5'), iqpB = iso('p', 'd5', 'd4');
        const hangW = at('P', 'c4') && at('P', 'd4') && none('P', 'b', 'e'), hangB = at('p', 'c5') && at('p', 'd5') && none('p', 'b', 'e');
        const side = (w, b) => (color === 'w' ? w : b);
        if (side(iqpW, iqpB)) return 'iqp+';
        if (side(iqpB, iqpW)) return 'iqp-';
        if (side(hangW, hangB)) return 'hang+';
        if (side(hangB, hangW)) return 'hang-';
        if (at('P', 'd4') && at('p', 'd5') && ((none('P', 'c') && none('p', 'e')) || (none('P', 'e') && none('p', 'c')))) return 'carlsbad';
        if ((at('P', 'c4') && at('P', 'e4') && none('P', 'd') && none('p', 'c')) || (at('p', 'c5') && at('p', 'e5') && none('p', 'd') && none('P', 'c'))) return 'maroczy';
        if (at('P', 'e5') && at('P', 'd4') && at('p', 'e6') && at('p', 'd5')) return 'french';
        if (at('P', 'd5') && at('P', 'e4') && at('p', 'd6') && at('p', 'e5')) return 'kid';
        if (none('P', 'd', 'e') && none('p', 'd', 'e')) return 'open';
        return '';
    }

    // ─── FINALES ET DÉSÉQUILIBRES ────────────────────────────────────────────
    // Type de la finale : à la première position avec au plus 4 pièces, deux demi-coups plus tard pour laisser les reprises se faire.
    function endgameOf(list) {
        const i = list.findIndex((c, k) => k + 1 >= EG_MIN_PLY && pieces(c) <= EG_PIECES);
        if (i < 0 || list.length - i <= EG_MIN_LEFT) return '';
        const c = list[Math.min(i + 2, list.length - 1)], q = c.Q + c.q, r = c.R + c.r, m = c.N + c.B + c.n + c.b;
        return q ? 'queen' : r && m ? 'rookMinor' : r ? 'rook' : m ? 'minor' : 'pawn';
    }
    function classOf(d) {
        if (d.q) return '';
        if (d.r === 1 && d.m === -1) return 'exch+';
        if (d.r === -1 && d.m === 1) return 'exch-';
        if (d.r === -1 && d.m === 2) return 'minors+';
        if (d.r === 1 && d.m === -2) return 'minors-';
        if (!d.r && d.m === 1) return 'piece+';
        if (!d.r && d.m === -1) return 'piece-';
        if (!d.r && !d.m && d.p > 0) return 'pawn+';
        if (!d.r && !d.m && d.p < 0) return 'pawn-';
        return '';
    }
    const diff = (c, color) => { const s = color === 'w' ? 1 : -1; return { q: s * (c.Q - c.q), r: s * (c.R - c.r), m: s * (c.N + c.B - c.n - c.b), p: s * (c.P - c.p) }; };

    // Premier déséquilibre de pièces tenu 6 demi-coups ; à défaut un pion d'écart tenu autant ; sinon 'even'.
    function imbalanceOf(list, color) {
        let run = '', hold = 0, pawn = '';
        for (let i = IMB_FROM; i < list.length; i++) {
            const k = classOf(diff(list[i], color));
            hold = k === run ? hold + 1 : 1;
            run = k;
            if (!k || hold < IMB_HOLD) continue;
            if (k[0] === 'p' && k.startsWith('pawn')) { if (!pawn) pawn = k; continue; }
            return k;
        }
        return pawn || 'even';
    }

    function features(g) {
        const out = { v: VERSION };
        let pos = Chess.start(), structure = '';
        const list = [];
        for (let i = 0; i < g.sans.length; i++) {
            const uci = uciOf(pos, g.sans[i]);
            if (!uci) return { v: VERSION, bad: 1 };
            pos = Chess.play(pos, uci);
            list.push(counts(pos.board));
            if (i === STRUCT_PLY - 1) structure = structureOf(pos.board, g.color);
        }
        const castle = side => { const s = g.sans.find((x, i) => (i % 2 === 0) === (side === 'w') && /^O-O/.test(x)); return s ? (clean(s) === 'O-O-O' ? 'q' : 'k') : ''; };
        out.me = castle(g.color);
        out.opp = castle(g.color === 'w' ? 'b' : 'w');
        if (list.length >= MIN_PLIES) out.qt = list.some(c => !c.Q && !c.q) ? 1 : 0;
        if (structure) out.st = structure;
        const eg = endgameOf(list);
        if (eg) out.eg = eg;
        if (list.length >= IMB_PLIES) out.imb = imbalanceOf(list, g.color);
        return out;
    }

    // ─── BILAN ───────────────────────────────────────────────────────────────
    function report(list) {
        const sum = OpeningReport.summarize, games = list.filter(g => g.pf && !g.pf.bad), by = (field) => {
            const m = new Map();
            games.forEach(g => { const k = g.pf[field]; if (k) { if (!m.has(k)) m.set(k, []); m.get(k).push(g); } });
            return [...m.entries()].map(([key, l]) => ({ key, t: sum(l) })).sort((a, b) => b.t.n - a.t.n);
        };
        const castled = g => g.pf.me && g.pf.opp;
        return {
            games: games.length,
            queens: { off: sum(games.filter(g => g.pf.qt === 1)), on: sum(games.filter(g => g.pf.qt === 0)) },
            castling: {
                same: sum(games.filter(g => castled(g) && g.pf.me === g.pf.opp)),
                opposite: sum(games.filter(g => castled(g) && g.pf.me !== g.pf.opp)),
                meNone: sum(games.filter(g => !g.pf.me && g.sans.length >= MIN_PLIES)),
                oppNone: sum(games.filter(g => !g.pf.opp && g.sans.length >= MIN_PLIES))
            },
            structures: by('st'), endgames: by('eg'), imbalances: by('imb')
        };
    }

    // ─── CALCUL EN TÂCHE DE FOND ─────────────────────────────────────────────
    const missing = g => !g.pf || g.pf.v !== VERSION;
    async function run(games, onDone = () => {}) {
        if (running) return;
        const todo = games.filter(missing);
        if (!todo.length) return;
        running = true;
        try {
            for (let i = 0; i < todo.length; i += CHUNK) {
                const part = todo.slice(i, i + CHUNK);
                part.forEach(g => { g.pf = features(g); });
                await GameArchive.saveDerived(part);
                await new Promise(r => setTimeout(r));
            }
        } finally { running = false; }
        onDone();
    }

    return { VERSION, structureOf, endgameOf, imbalanceOf, features, report, run, running: () => running };
})();
