/**
 * domain/games/gameEval.js
 * ──────────────────────────────────────────────────────────────────────────
 * Évalue les parties sans évaluations (toutes celles de Chess.com, les parties Lichess non analysées) avec Stockfish, coup par coup.
 *   GameEval.pending(parties)   parties à évaluer : Chess.com d'abord, les plus récentes en tête.
 *   GameEval.run(parties, { shouldRun, onGame, onSaved })   une seule exécution à la fois ; s'arrête dès que shouldRun() est faux ou que le moteur est repris.
 *   GameEval.divide(pièces)     limites [milieu, finale] d'une partie d'après le nombre de pièces (hors rois et pions) après chaque demi-coup.
 * Résultat écrit sur la partie : ev (centipions du point de vue des Blancs, mat : ±(MATE − n), comme Lichess), div, evBy ; illisible : evFail.
 * Les résultats sont gardés par lots dans l'archive ; une position déjà vue (début de partie) n'est pas recalculée.
 */

'use strict';

const GameEval = (function () {
    const DEPTH = 12, MAX_MS = 200, MIN_PLIES = 8, SAVE_EVERY = 5, MIDDLE_PIECES = 10, END_PIECES = 6, MIDDLE_PLY = 24, CACHE_MAX = 20000;
    const cache = new Map();
    let running = false;

    const pending = games => games.filter(g => !g.ev && !g.evFail && g.sans.length >= MIN_PLIES)
        .sort((a, b) => (a.site === 'chesscom' ? 0 : 1) - (b.site === 'chesscom' ? 0 : 1) || b.at - a.at);

    function divide(pieces) {
        let middle = 0, end = 0;
        pieces.forEach((n, i) => {
            const ply = i + 1;
            if (!middle && (n <= MIDDLE_PIECES || ply >= MIDDLE_PLY)) middle = ply;
            if (!end && n <= END_PIECES) end = ply;
        });
        return [middle, end];
    }
    const piecesOf = fen => (fen.split(' ')[0].match(/[nbrqNBRQ]/g) || []).length;
    const clean = san => String(san).replace(/[+#!?]/g, '');

    // Coups UCI d'une partie, ou null si un coup est illisible.
    function positions(sans) {
        const out = [];
        let pos = Chess.start();
        for (const san of sans) {
            const want = clean(san), uci = Chess.legalMoves(pos).find(u => clean(Chess.san(pos, u)) === want);
            if (!uci) return null;
            pos = Chess.play(pos, uci);
            out.push(pos);
        }
        return out;
    }

    const toCp = line => { const s = line && line.score; if (!s) return null; return Number.isFinite(s.mate) ? (s.mate > 0 ? GameArchive.MATE - s.mate : -GameArchive.MATE - s.mate) : s.cp; };

    // Évaluation d'une position ; null si le calcul a été annulé.
    async function evalFen(fen) {
        if (cache.has(fen)) return cache.get(fen);
        const r = await Engine.analyse(fen, { multipv: 1, depth: DEPTH, movetime: MAX_MS }).done;
        if (r.cancelled) return null;
        const cp = toCp(r.lines && r.lines[0]);
        if (cp === null || cp === undefined) return null;
        if (cache.size >= CACHE_MAX) cache.clear();
        cache.set(fen, cp);
        return cp;
    }

    // Valeur de la position finale, sans moteur : mat pour celui qui vient de jouer, pat nul.
    function finalValue(pos, ply, end) {
        if (Chess.legalMoves(pos).length) return null;
        if (end === 'stalemate') return 0;
        return ply % 2 === 0 ? GameArchive.MATE : -GameArchive.MATE;
    }

    // 'stop' : arrêt demandé ; 'fail' : partie illisible ; true : partie évaluée.
    async function evalGame(g, shouldRun) {
        const list = positions(g.sans);
        if (!list) return 'fail';
        const ev = [], pieces = [];
        for (let i = 0; i < list.length; i++) {
            if (!shouldRun()) return 'stop';
            const fen = Chess.fen(list[i]);
            pieces.push(piecesOf(fen));
            const end = i === list.length - 1 ? finalValue(list[i], i, g.end) : null, cp = end !== null ? end : await evalFen(fen);
            if (cp === null) return 'stop';
            ev.push(cp);
        }
        g.ev = ev;
        g.evBy = 'sf' + DEPTH;
        if (!g.div) g.div = divide(pieces);
        return true;
    }

    async function run(games, { shouldRun, onGame = () => {}, onSaved = () => {} }) {
        if (running) return;
        running = true;
        const queue = pending(games);
        let batch = [], done = 0;
        const flush = async () => { if (!batch.length) return; const out = batch; batch = []; await GameArchive.saveDerived(out); onSaved(done); };
        try {
            for (const g of queue) {
                if (!shouldRun()) break;
                const res = await evalGame(g, shouldRun);
                if (res === 'stop') break;
                if (res === 'fail') g.evFail = true;
                batch.push(g);
                done++;
                onGame(done, queue.length);
                if (batch.length >= SAVE_EVERY) await flush();
            }
            await flush();
        } finally { running = false; }
    }

    return { DEPTH, pending, divide, run, running: () => running };
})();
