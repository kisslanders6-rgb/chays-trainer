/**
 * modules/endgame/egJudge.js
 * ──────────────────────────────────────────────────────────────────────────
 * Juge commun des finales et adversaire calculé.
 *
 *   EndgameJudge.probe(fen)          → Promise<{ wdl, dtz?, source, exact, moves } | null>
 *       wdl : résultat théorique pour le camp au trait, à la manière des tables Syzygy
 *             (2 gain, 1 gain annulé par la règle des 50 coups, 0 nulle, −1, −2 perte).
 *       source : 'kpk' (base exacte de egCore.js, hors ligne), 'syzygy' (API de Lichess, ≤ 7 pièces)
 *                ou 'engine' (Stockfish, verdict estimé : exact = false).
 *       moves : [{ uci, san?, wdl, dtz? }], wdl du point de vue du camp qui joue le coup, meilleur d'abord.
 *   EndgameJudge.judgeMove(fen, uci) → Promise<{ before, after, source, exact } | null>
 *   EndgameJudge.result(wdl)         → 1 gain, 0 nulle, −1 perte (résultat sportif, règle des 50 coups comprise)
 *   Adversaire calculé : EndgameOpponent (egOpponent.js).
 *
 * Les réponses de l'API Syzygy sont gardées dans IndexedDB (base « chays-tablebase ») : une position déjà
 * vue se juge hors ligne. Seuils du moteur : gain = éval ≥ +2,5 ou mat ; nulle = |éval| ≤ 0,6.
 */

'use strict';

const EndgameJudge = (function () {
    const API = 'https://tablebase.lichess.ovh/standard?fen=';
    const MAX_PIECES = 7;
    const ENGINE_OPTS = { multipv: 3, depth: 18 };
    const ENGINE_WIN = 250, ENGINE_DRAW = 60;                   // centipions
    const CATEGORY = { win: 2, 'cursed-win': 1, 'maybe-win': 1, draw: 0, unknown: 0, 'blessed-loss': -1, 'maybe-loss': -1, loss: -2 };

    const mem = new Map();                                       // fen → verdict (toutes sources)
    const keyOf = fen => fen.split(' ').slice(0, 4).join(' ');
    const pieceCount = fen => (fen.split(' ')[0].match(/[a-z]/gi) || []).length;
    const result = wdl => (wdl > 1 ? 1 : wdl < -1 ? -1 : 0);

    // ─── IndexedDB ────────────────────────────────────────────────────────────
    let dbp = null;
    function db() {
        if (dbp) return dbp;
        dbp = new Promise(resolve => {
            try {
                if (typeof indexedDB === 'undefined') { resolve(null); return; }
                const rq = indexedDB.open('chays-tablebase', 1);
                rq.onupgradeneeded = () => rq.result.createObjectStore('probe');
                rq.onsuccess = () => resolve(rq.result);
                rq.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
        return dbp;
    }
    async function idb(mode, key, value) {
        const d = await db();
        if (!d) return null;
        return new Promise(resolve => {
            try {
                const tx = d.transaction('probe', mode), st = tx.objectStore('probe');
                const rq = mode === 'readonly' ? st.get(key) : st.put(value, key);
                rq.onsuccess = () => resolve(mode === 'readonly' ? rq.result || null : true);
                rq.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }

    // ─── Base exacte roi + pion contre roi (egCore.js) ────────────────────────
    const uciOf = m => {
        const n = s => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
        return n(EG.mFrom(m)) + n(EG.mTo(m)) + (EG.mPromo(m) ? EG.LETTER[EG.mPromo(m)].toLowerCase() : '');
    };
    function kpk(fen) {
        const men = fen.split(' ')[0].replace(/[\d/]/g, '').split('').sort().join('');
        if (typeof EG === 'undefined' || !['Kkp', 'KPk'].includes(men)) return null;
        const st = EG.fromFen(fen), pr = EG.kpkProbe(st);
        if (pr.invalid) return null;
        const pawnSide = EG.kpkPawnSide(st), mine = pawnSide === st.stm;
        const wdl = pr.win ? (mine ? 2 : -2) : 0;
        const moves = EG.kpkMoves(st).map(x => ({ uci: uciOf(x.m), wdl: x.info.win ? (mine ? 2 : -2) : 0, dtz: x.info.dtw || 0 }));
        // Meilleur d'abord : gain le plus court, perte la plus longue.
        moves.sort((a, b) => b.wdl - a.wdl || (a.wdl > 0 ? a.dtz - b.dtz : b.dtz - a.dtz));
        return { wdl, dtz: pr.dtw, source: 'kpk', exact: true, moves };
    }

    // ─── Tables Syzygy (API de Lichess) ───────────────────────────────────────
    let chain = Promise.resolve(), pausedUntil = 0;              // une requête à la fois ; pause après un 429
    function syzygy(fen) {
        if (pieceCount(fen) > MAX_PIECES) return Promise.resolve(null);
        const key = keyOf(fen);
        const job = chain.then(async () => {
            const kept = await idb('readonly', key);
            if (kept) return kept;
            if (typeof fetch === 'undefined' || (typeof navigator !== 'undefined' && navigator.onLine === false) || Date.now() < pausedUntil) return null;
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = setTimeout(() => ctrl && ctrl.abort(), 6000);
            try {
                const r = await fetch(API + encodeURIComponent(key + ' 0 1'), ctrl ? { signal: ctrl.signal } : undefined);
                if (r.status === 429) { pausedUntil = Date.now() + 60000; return null; }
                if (!r.ok) return null;
                const j = await r.json();
                if (!(j.category in CATEGORY) || j.category === 'unknown') return null;
                const v = {
                    wdl: CATEGORY[j.category], dtz: j.dtz, dtm: j.dtm, source: 'syzygy', exact: true,
                    moves: (j.moves || []).map(m => ({ uci: m.uci, san: m.san, wdl: -CATEGORY[m.category], dtz: m.dtz,
                                                       zeroing: !!m.zeroing, checkmate: !!m.checkmate, stalemate: !!m.stalemate }))
                };
                idb('readwrite', key, v);
                return v;
            } catch (e) { return null; } finally { clearTimeout(timer); }
        });
        chain = job.catch(() => null);
        return job;
    }

    // ─── Moteur (repli : plus de 7 pièces, ou hors ligne) ─────────────────────
    function classify(score) {                                   // score du point de vue du camp au trait
        if (!score) return 0;
        if (score.mate !== undefined) return score.mate > 0 ? 2 : -2;
        return score.cp >= ENGINE_WIN ? 2 : score.cp <= -ENGINE_WIN ? -2 : Math.abs(score.cp) <= ENGINE_DRAW ? 0 : score.cp > 0 ? 1 : -1;
    }
    async function engine(fen) {
        if (typeof Engine === 'undefined') return null;
        const white = fen.split(' ')[1] !== 'b';
        const flip = s => (!s ? null : white ? s : s.mate !== undefined ? { mate: -s.mate } : { cp: -s.cp });
        try {
            const job = Engine.analyse(fen, ENGINE_OPTS);
            const timeout = new Promise(resolve => setTimeout(() => { job.stop(); resolve(null); }, 45000));
            const r = await Promise.race([job.done, timeout]);
            if (!r || r.cancelled || !r.lines.length) return null;
            const moves = r.lines.map(l => ({ uci: l.pv[0], wdl: classify(flip(l.score)), score: flip(l.score) }));
            return { wdl: moves[0].wdl, source: 'engine', exact: false, score: moves[0].score, moves };
        } catch (e) { return null; }
    }

    // ─── Verdict d'une position ───────────────────────────────────────────────
    async function probe(fen) {
        const key = keyOf(fen);
        if (mem.has(key)) return mem.get(key);
        const v = kpk(fen) || await syzygy(fen) || await engine(fen);
        if (v) mem.set(key, v);
        return v;
    }

    const fenAfter = (fen, uci) => Chess.fen(Chess.play(Chess.fromFen(fen), uci));

    // Verdict avant et après le coup, du point de vue du joueur. Tables et KPK : un seul appel (coups classés).
    async function judgeMove(fen, uci) {
        const before = await probe(fen);
        if (!before) return null;
        const m = before.exact && before.moves.find(x => x.uci === uci);
        if (m) return { before: before.wdl, after: m.wdl, source: before.source, exact: true };
        const next = await probe(fenAfter(fen, uci));
        if (!next) return null;
        return { before: before.wdl, after: -next.wdl, source: next.source, exact: before.exact && next.exact };
    }

    // Pour les tests : vider le cache mémoire.
    const reset = () => { mem.clear(); pausedUntil = 0; };

    return { probe, judgeMove, result, fenAfter, classify, reset, MAX_PIECES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { EndgameJudge };
