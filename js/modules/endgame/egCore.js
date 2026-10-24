/**
 * modules/endgame/egCore.js
 * ──────────────────────────────────────────────────────────────────────────
 * Noyau du module Finales : règles, recherche, base KPK exacte. Aucun DOM.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  1. NOYAU PUR (sans DOM, sans dépendance aux globaux du moteur d'ouvertures)
// ═══════════════════════════════════════════════════════════════════════════
// Représentation compacte et indépendante de chessEngine.js, pour pouvoir
// chercher/simuler sans toucher à l'état d'affichage (board, turn, moveHistory…).
//   état  = { b: Int8Array(64), stm: 1 (Blancs) | -1 (Noirs) }
//   pièce = ±1 P, ±2 N, ±3 B, ±4 R, ±5 Q, ±6 K   (positif = Blancs)
//   case  = rang * 8 + colonne (identique à chessEngine.js : a1 = 0, h8 = 63)
//   coup  = from | to << 6 | promo << 12        (promo : 2..5 ou 0)
// Simplifications assumées (inoffensives en finale sans roque) : ni roque,
// ni prise en passant.
const EG = (function () {
    const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
    const VALUE = [0, 100, 300, 300, 500, 900, 0];
    const LETTER = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];
    const MATE = 100000;

    // ─── Tables ───────────────────────────────────────────────────────────────
    const KNIGHT = [], KING = [], RAYS = [];
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];   // 0-3 droites, 4-7 diagonales
    for (let sq = 0; sq < 64; sq++) {
        const f = sq & 7, r = sq >> 3;
        KNIGHT[sq] = []; KING[sq] = []; RAYS[sq] = [];
        [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]].forEach(([df, dr]) => {
            const nf = f + df, nr = r + dr;
            if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) KNIGHT[sq].push(nr * 8 + nf);
        });
        DIRS.forEach(([df, dr], d) => {
            const ray = [];
            for (let nf = f + df, nr = r + dr; nf >= 0 && nf < 8 && nr >= 0 && nr < 8; nf += df, nr += dr) ray.push(nr * 8 + nf);
            RAYS[sq].push(ray);
            if (ray.length) KING[sq].push(ray[0]);
        });
    }
    const dist = (a, b) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));

    // ─── Conversion ───────────────────────────────────────────────────────────
    const CODE = { P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6 };

    function fromFen(fen) {
        const parts = fen.split(' '), rows = parts[0].split('/');
        const b = new Int8Array(64);
        for (let r = 0; r < 8; r++) {
            let c = 0;
            for (const ch of rows[r]) {
                if (ch >= '1' && ch <= '8') c += +ch;
                else { b[(7 - r) * 8 + c] = (ch === ch.toUpperCase() ? 1 : -1) * CODE[ch.toUpperCase()]; c++; }
            }
        }
        return { b, stm: (parts[1] || 'w') === 'b' ? -1 : 1 };
    }

    // Lit l'état d'affichage de chessEngine.js (board[] de lettres, turn 'w' | 'b').
    function fromGlobals(boardArr, turnCh) {
        const b = new Int8Array(64);
        for (let i = 0; i < 64; i++) {
            const ch = boardArr[i];
            if (ch) b[i] = (ch === ch.toUpperCase() ? 1 : -1) * CODE[ch.toUpperCase()];
        }
        return { b, stm: turnCh === 'b' ? -1 : 1 };
    }

    const mFrom  = m => m & 63;
    const mTo    = m => (m >> 6) & 63;
    const mPromo = m => m >> 12;
    const mk     = (f, t, p) => f | (t << 6) | ((p || 0) << 12);
    const promoLetter = m => (mPromo(m) ? LETTER[mPromo(m)] : null);

    // ─── Attaques ─────────────────────────────────────────────────────────────
    function attacked(b, sq, by) {
        const f = sq & 7, r = sq >> 3;
        if (by === 1) {
            if (r > 0) { if (f > 0 && b[sq - 9] === P) return true; if (f < 7 && b[sq - 7] === P) return true; }
        } else if (r < 7) { if (f > 0 && b[sq + 7] === -P) return true; if (f < 7 && b[sq + 9] === -P) return true; }
        const kn = KNIGHT[sq];
        for (let i = 0; i < kn.length; i++) if (b[kn[i]] === by * N) return true;
        const kg = KING[sq];
        for (let i = 0; i < kg.length; i++) if (b[kg[i]] === by * K) return true;
        for (let d = 0; d < 8; d++) {
            const ray = RAYS[sq][d];
            for (let i = 0; i < ray.length; i++) {
                const v = b[ray[i]];
                if (!v) continue;
                if (v * by > 0) { const t = v * by; if (t === Q || (d < 4 ? t === R : t === B)) return true; }
                break;
            }
        }
        return false;
    }

    function kingSq(b, side) { return b.indexOf(side * K); }
    function inCheck(st) { return attacked(st.b, kingSq(st.b, st.stm), -st.stm); }

    // ─── Génération ───────────────────────────────────────────────────────────
    function pseudo(st) {
        const b = st.b, side = st.stm, out = [];
        const lastRank = side === 1 ? 7 : 0, startRank = side === 1 ? 1 : 6;
        const addPawn = (from, to) => {
            if ((to >> 3) === lastRank) { out.push(mk(from, to, Q), mk(from, to, R), mk(from, to, B), mk(from, to, N)); }
            else out.push(mk(from, to, 0));
        };
        for (let sq = 0; sq < 64; sq++) {
            const v = b[sq];
            if (!v || v * side < 0) continue;
            const t = v * side, f = sq & 7, r = sq >> 3;
            if (t === P) {
                const one = sq + 8 * side;
                if (!b[one]) {
                    addPawn(sq, one);
                    if (r === startRank && !b[one + 8 * side]) out.push(mk(sq, one + 8 * side, 0));
                }
                if (f > 0 && b[one - 1] * side < 0) addPawn(sq, one - 1);
                if (f < 7 && b[one + 1] * side < 0) addPawn(sq, one + 1);
            } else if (t === N || t === K) {
                const tab = t === N ? KNIGHT[sq] : KING[sq];
                for (let i = 0; i < tab.length; i++) if (b[tab[i]] * side <= 0) out.push(mk(sq, tab[i], 0));
            } else {
                const d0 = t === B ? 4 : 0, d1 = t === R ? 4 : 8;
                for (let d = d0; d < d1; d++) {
                    const ray = RAYS[sq][d];
                    for (let i = 0; i < ray.length; i++) {
                        const w = b[ray[i]];
                        if (w * side > 0) break;
                        out.push(mk(sq, ray[i], 0));
                        if (w) break;
                    }
                }
            }
        }
        return out;
    }

    function legalMoves(st) {
        const b = st.b, side = st.stm, moves = pseudo(st), out = [];
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i], from = m & 63, to = (m >> 6) & 63, pr = m >> 12;
            const moved = b[from], cap = b[to];
            b[to] = pr ? side * pr : moved; b[from] = 0;
            const ks = Math.abs(moved) === K ? to : kingSq(b, side);
            const ok = !attacked(b, ks, -side);
            b[from] = moved; b[to] = cap;
            if (ok) out.push(m);
        }
        return out;
    }

    function make(st, m) {
        const b = st.b.slice(), from = m & 63, to = (m >> 6) & 63, pr = m >> 12;
        const v = b[from];
        b[to] = pr ? st.stm * pr : v; b[from] = 0;
        return { b, stm: -st.stm };
    }

    function isCapture(st, m) { return st.b[(m >> 6) & 63] !== 0; }

    // Compte les pièces (hors rois) d'un camp ; renvoie la liste [{sq, t}].
    function piecesOf(b, side) {
        const out = [];
        for (let i = 0; i < 64; i++) if (b[i] * side > 0 && Math.abs(b[i]) !== K) out.push({ sq: i, t: b[i] * side });
        return out;
    }

    // ─── Mini-moteur : négamax alpha-bêta + quiescence sur les prises ─────────
    // Sert à la défense du roi seul (mats élémentaires). L'évaluation est celle,
    // classique, des finales « roi contre roi + matériel » : matériel, roi défenseur
    // loin du centre (bon pour l'attaquant), rois proches (bon pour l'attaquant).
    function evalAttacker(b, atk) {
        let mat = 0;
        for (let i = 0; i < 64; i++) { const v = b[i]; if (v) mat += (v > 0 ? 1 : -1) * VALUE[Math.abs(v)]; }
        const dk = kingSq(b, -atk), ak = kingSq(b, atk);
        const cmd = Math.abs((dk & 7) - 3.5) + Math.abs((dk >> 3) - 3.5);          // 1..7 : 7 = coin
        const kd  = Math.abs((dk & 7) - (ak & 7)) + Math.abs((dk >> 3) - (ak >> 3));
        return atk * mat + 10 * cmd + 4 * (14 - kd);
    }

    function qsearch(st, alpha, beta, ctx) {
        const stand = (st.stm === ctx.atk ? 1 : -1) * evalAttacker(st.b, ctx.atk);
        if (stand >= beta) return stand;
        if (stand > alpha) alpha = stand;
        const caps = legalMoves(st).filter(m => isCapture(st, m));
        for (const m of caps) {
            const s = -qsearch(make(st, m), -beta, -alpha, ctx);
            if (s >= beta) return s;
            if (s > alpha) alpha = s;
        }
        return alpha;
    }

    function search(st, depth, alpha, beta, ply, ctx) {
        const moves = legalMoves(st);
        if (!moves.length) return inCheck(st) ? -(MATE - ply) : 0;
        if (depth === 0) return qsearch(st, alpha, beta, ctx);
        moves.sort((a, c) => (isCapture(st, c) ? 1 : 0) - (isCapture(st, a) ? 1 : 0));
        let best = -Infinity;
        for (const m of moves) {
            const s = -search(make(st, m), depth - 1, -beta, -alpha, ply + 1, ctx);
            if (s > best) best = s;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
        }
        return best;
    }

    // Meilleur coup du camp au trait (défenseur) ; `atk` = couleur de l'attaquant.
    function searchBest(st, depth, atk) {
        const ctx = { atk };
        const moves = legalMoves(st);
        if (!moves.length) return null;
        let bestM = moves[0], alpha = -Infinity;
        moves.sort((a, c) => (isCapture(st, c) ? 1 : 0) - (isCapture(st, a) ? 1 : 0));
        for (const m of moves) {
            const s = -search(make(st, m), depth - 1, -Infinity, -alpha, 1, ctx);
            if (s > alpha) { alpha = s; bestM = m; }
        }
        return bestM;
    }

    // Juge un coup de l'attaquant en finale « mat » : pat ? pièce abandonnée ? mat ?
    function judgeMate(st, m) {
        const side = st.stm, ns = make(st, m), replies = legalMoves(ns);
        if (!replies.length) return inCheck(ns) ? { mate: true } : { stalemate: true };
        const mine = new Set(piecesOf(ns.b, side).map(p => p.sq));
        if (replies.some(r => mine.has((r >> 6) & 63))) return { hanging: true };
        return { ok: true };
    }

    // ─── Base KPK (roi + pion contre roi) : résolution exacte, calculée au besoin ─
    // 2 (trait) × 64 (roi blanc) × 64 (roi noir) × 24 (pion colonnes a-d, rangs 2-7).
    // Les pions des colonnes e-h se ramènent aux colonnes a-d par symétrie ; les pions
    // noirs se ramènent aux blancs par retournement vertical + inversion des couleurs.
    // Résolution par couches (Jacobi) : la couche qui classe une position en donne
    // aussi la distance exacte au gain (demi-coups, promotion comprise).
    const INVALID = 1, UNKNOWN = 2, DRAW = 4, WIN = 8;
    const KPK_SIZE = 2 * 64 * 64 * 24;
    let kpkRes = null, kpkDepth = null;

    const kidx = (stm, wk, bk, p) => ((stm * 64 + wk) * 64 + bk) * 24 + ((p >> 3) - 1) * 4 + (p & 7);

    // Promotion immédiate gagnante : dame ou tour ni prenable, ni pat (cas rares : roi dans le coin).
    function promotionWins(wk, bk, p) {
        const to = p + 8;
        if (bk === to) return false;
        for (const t of [Q, R]) {
            const b = new Int8Array(64);
            b[wk] = K; b[bk] = -K; b[to] = t;
            const ns = { b, stm: -1 }, replies = legalMoves(ns);
            if (!replies.length) { if (inCheck(ns)) return true; continue; }          // mat = gagné ; pat = on essaie l'autre pièce
            if (!replies.some(r => ((r >> 6) & 63) === to)) return true;
        }
        return false;
    }

    function buildKpk() {
        if (kpkRes) return;
        const res = new Uint8Array(KPK_SIZE), depth = new Uint8Array(KPK_SIZE);
        let unknown = [];
        for (let idx = 0; idx < KPK_SIZE; idx++) {
            const pi = idx % 24; let rest = (idx / 24) | 0;
            const bk = rest % 64; rest = (rest / 64) | 0;
            const wk = rest % 64, stm = (rest / 64) | 0;
            const p = ((pi >> 2) + 1) * 8 + (pi & 3);
            const pawnHitsBk = bk === p + 9 || ((p & 7) > 0 && bk === p + 7);           // le pion blanc attaque p+7 / p+9
            if (dist(wk, bk) <= 1 || wk === p || bk === p || (stm === 0 && pawnHitsBk)) { res[idx] = INVALID; continue; }
            if (stm === 0 && (p >> 3) === 6 && wk !== p + 8 && promotionWins(wk, bk, p)) { res[idx] = WIN; depth[idx] = 1; continue; }
            if (stm === 1) {
                // Pat, ou roi qui prend un pion non protégé → nulle immédiate.
                let free = false, takes = false;
                for (const s of KING[bk]) {
                    const covered = dist(s, wk) <= 1 || ((s >> 3) === (p >> 3) + 1 && Math.abs((s & 7) - (p & 7)) === 1);
                    if (!covered) { free = true; if (s === p) takes = true; }
                }
                if (!free || takes) { res[idx] = DRAW; continue; }
            }
            res[idx] = UNKNOWN; unknown.push(idx);
        }

        const classify = idx => {
            const pi = idx % 24; let rest = (idx / 24) | 0;
            const bk = rest % 64; rest = (rest / 64) | 0;
            const wk = rest % 64, stm = (rest / 64) | 0;
            const p = ((pi >> 2) + 1) * 8 + (pi & 3);
            let r = 0, d = stm === 0 ? 255 : 0;
            if (stm === 0) {
                const look = i2 => { const v = res[i2]; r |= v; if (v === WIN && depth[i2] < d) d = depth[i2]; };
                for (const s of KING[wk]) look(kidx(1, s, bk, p));
                if ((p >> 3) < 6) look(kidx(1, wk, bk, p + 8));
                if ((p >> 3) === 1 && p + 8 !== wk && p + 8 !== bk) look(kidx(1, wk, bk, p + 16));
                if (r & WIN) return [WIN, d + 1];
                return [r & UNKNOWN ? UNKNOWN : DRAW, 0];
            }
            for (const s of KING[bk]) { const i2 = kidx(0, wk, s, p), v = res[i2]; r |= v; if (v === WIN && depth[i2] > d) d = depth[i2]; }
            if (r & DRAW) return [DRAW, 0];
            if (r & UNKNOWN) return [UNKNOWN, 0];
            return [WIN, d + 1];
        };

        let changed = true;
        while (changed) {
            changed = false;
            const upd = [], still = [];
            for (const idx of unknown) {
                const [v, d] = classify(idx);
                if (v === UNKNOWN) still.push(idx); else upd.push(idx, v, d);
            }
            for (let i = 0; i < upd.length; i += 3) { res[upd[i]] = upd[i + 1]; depth[upd[i]] = upd[i + 2]; changed = true; }
            unknown = still;
        }
        // Positions jamais classées = nulles (cycles).
        for (const idx of unknown) res[idx] = DRAW;
        kpkRes = res; kpkDepth = depth;
    }

    // Verdict KPK d'un état à deux rois + un pion. win = le camp du pion gagne.
    function kpkProbe(st) {
        buildKpk();
        let wk = -1, bk = -1, pawn = -1, pcol = 0;
        for (let i = 0; i < 64; i++) {
            const v = st.b[i];
            if (v === K) wk = i; else if (v === -K) bk = i; else if (Math.abs(v) === P) { pawn = i; pcol = v > 0 ? 1 : -1; }
        }
        let W, Bk, Pp, s;
        if (pcol === 1) { W = wk; Bk = bk; Pp = pawn; s = st.stm === 1 ? 0 : 1; }
        else            { W = bk ^ 56; Bk = wk ^ 56; Pp = pawn ^ 56; s = st.stm === -1 ? 0 : 1; }
        if ((Pp & 7) >= 4) { W ^= 7; Bk ^= 7; Pp ^= 7; }
        const i = kidx(s, W, Bk, Pp), v = kpkRes[i];
        return { win: v === WIN, invalid: v === INVALID, dtw: kpkDepth[i] };
    }

    // Conséquence d'un coup dans une finale KPK. « win » : le camp du pion gagne encore.
    //   why : 'capture' | 'stalemate' | 'underpromo' | 'hanging' (nulle) ; mate / promoted : fins gagnantes.
    function kpkAfter(st, m) {
        const ns = make(st, m);
        let pawn = -1, other = -1;
        for (let i = 0; i < 64; i++) { const t = Math.abs(ns.b[i]); if (t === P) pawn = i; else if (t !== K && t !== 0) other = i; }
        const replies = legalMoves(ns);
        if (!replies.length) return inCheck(ns) ? { win: true, mate: true, dtw: 0 } : { win: false, why: 'stalemate' };
        if (pawn < 0) {
            if (other < 0) return { win: false, why: 'capture' };
            const t = Math.abs(ns.b[other]);
            if (t === N || t === B) return { win: false, why: 'underpromo', promoted: true };
            if (replies.some(r => ((r >> 6) & 63) === other)) return { win: false, why: 'hanging', promoted: true };
            return { win: true, promoted: true, dtw: 0 };
        }
        const pr = kpkProbe(ns);
        return { win: pr.win, dtw: pr.dtw, why: pr.win ? null : 'draw' };
    }

    // Tous les coups légaux annotés (pour l'indice et l'IA).
    function kpkMoves(st) { return legalMoves(st).map(m => ({ m, info: kpkAfter(st, m) })); }

    // Camp du pion (+1 / -1) d'un état KPK.
    function kpkPawnSide(st) { for (let i = 0; i < 64; i++) if (Math.abs(st.b[i]) === P) return st.b[i] > 0 ? 1 : -1; return 0; }

    // Meilleur coup « de pion » : gain le plus rapide (ou, à défaut, un coup qui tient).
    function kpkBestAttack(st) {
        let best = null;
        for (const x of kpkMoves(st)) {
            if (!x.info.win) continue;
            if (!best || x.info.dtw < best.info.dtw) best = x;
        }
        return best;
    }

    // Coup de défense : nulle si possible (prise du pion, pat, bonne opposition), sinon résistance maximale.
    function kpkDefense(st) {
        const all = kpkMoves(st);
        const draws = all.filter(x => !x.info.win);
        if (draws.length) {
            const cap = draws.find(x => x.info.why === 'capture');
            return (cap || draws[0]).m;
        }
        all.sort((a, c) => c.info.dtw - a.info.dtw);
        return all[0].m;
    }

    // Coup d'attaque dans une position NULLE (le joueur défend) : l'IA pose des pièges —
    // elle choisit le coup qui laisse le plus de réponses perdantes à son adversaire.
    function kpkTrapAttack(st) {
        const side = st.stm;
        const all = kpkMoves(st);
        const win = all.filter(x => x.info.win).sort((a, c) => a.info.dtw - c.info.dtw)[0];
        if (win) return win.m;
        let best = null, bestScore = -Infinity;
        for (const x of all) {
            const ns = make(st, x.m);
            let score = 0;
            if (x.info.why === 'capture' || x.info.why === 'stalemate') score = -1000;
            else {
                const replies = legalMoves(ns);
                let bad = 0;
                for (const r of replies) if (kpkAfter(ns, r).win) bad++;
                score = 100 * bad;
                let pawn = -1; for (let i = 0; i < 64; i++) if (Math.abs(ns.b[i]) === P) pawn = i;
                const adv = side === 1 ? (pawn >> 3) : 7 - (pawn >> 3);
                const myK = kingSq(ns.b, side);
                score += 4 * adv - dist(myK, pawn);                                  // pousser, garder le roi près du pion
                if (Math.abs(ns.b[(x.m >> 6) & 63]) === P) score += 2;
            }
            if (score > bestScore) { bestScore = score; best = x.m; }
        }
        return best;
    }

    // Recherche bornée (preuve) : le camp blanc, au trait, peut-il forcer en `plies` demi-coups une
    // promotion en dame non prenable, ou un mat (y compris par la promotion elle-même) ?
    // Sert à vérifier qu'une défense tient (finales de tours).
    function forcesPromotion(st, plies) {
        const memo = new Map();
        const key = (s, d) => s.stm + ':' + d + ':' + s.b.join(',');
        const white = (s, d) => {
            if (d <= 0) return false;
            const k = key(s, d);
            if (memo.has(k)) return memo.get(k);
            let res = false;
            const mv = legalMoves(s).sort((a, c) => (Math.abs(s.b[c & 63]) === P ? 1 : 0) - (Math.abs(s.b[a & 63]) === P ? 1 : 0));
            for (const x of mv) {
                const pr = x >> 12, to = (x >> 6) & 63;
                if (pr) {
                    if (pr !== Q) continue;
                    const ns = make(s, x), rep = legalMoves(ns);
                    if (rep.length ? !rep.some(r => ((r >> 6) & 63) === to) : inCheck(ns)) { res = true; break; }
                    continue;
                }
                if (black(make(s, x), d - 1)) { res = true; break; }
            }
            memo.set(k, res);
            return res;
        };
        const black = (s, d) => {
            const mv = legalMoves(s);
            if (!mv.length) return inCheck(s);                            // mat : gagné ; pat : nulle
            if (d <= 0) return false;
            const k = key(s, -d);
            if (memo.has(k)) return memo.get(k);
            let all = true;
            for (const x of mv) if (!white(make(s, x), d - 1)) { all = false; break; }
            memo.set(k, all);
            return all;
        };
        return white(st, plies);
    }

    // ─── Finales de pions (rois + pions) : recherche bornée avec table de transpositions ─
    // Valeur pour le camp au trait : 1 gagne, -1 perd, 0 nulle — ou rien de décisif dans l'horizon.
    //   gain = promotion en Dame qui ne peut pas être prise et sans contre-promotion immédiate
    //          (Dame contre Dame : comptée nulle), ou mat ; pat = nulle ;
    //   un seul pion sur l'échiquier : verdict EXACT de la base KPK (sans limite d'horizon).
    // Les valeurs ±1 sont des preuves ; 0 signifie seulement « pas de gain forcé dans l'horizon ».
    // D'où l'usage : un coup est déclaré fautif seulement s'il donne une valeur décisive prouvée
    // à l'adversaire, ou (exercices de gain) s'il perd un gain que l'horizon choisi suffit à voir.
    let pawnTT = new Map();
    const PAWN_TT_MAX = 3e6;
    const pawnKey = st => { let k = st.stm > 0 ? 'w' : 'b'; for (let i = 0; i < 64; i++) if (st.b[i]) k += i.toString(36) + st.b[i]; return k; };

    // pieces : pièces autres que rois et pions (cavalier ou fou des finales de pièces mineures) ; la base KPK
    // ne s'applique qu'en leur absence.
    function pawnCount(b) {
        let n = 0, side = 0, pieces = 0;
        for (let i = 0; i < 64; i++) { const t = Math.abs(b[i]); if (t === P) { n++; side = b[i] > 0 ? 1 : -1; } else if (t && t !== K) pieces++; }
        return { n, side, pieces };
    }

    // Valeur pour le camp qui vient de promouvoir en `to` (ns : adversaire au trait).
    function afterPromotion(ns, to, depth) {
        const rep = legalMoves(ns);
        if (!rep.length) return inCheck(ns) ? 1 : 0;
        const caps = rep.filter(r => ((r >> 6) & 63) === to);
        if (caps.length) {                                         // Dame prise : on continue la partie
            let worst = 1;
            for (const c of caps) { const v = depth >= 2 ? pawnValue(make(ns, c), depth - 2) : 0; if (v < worst) worst = v; if (worst === -1) break; }
            return worst;
        }
        if (rep.some(r => r >> 12)) return 0;                      // contre-promotion immédiate : nulle
        // Fourchette (cavalier, fou) : un échec qui attaque aussi la Dame non protégée lui coûte la vie.
        const side = -ns.stm;
        for (const r of rep) {
            const rs = make(ns, r);
            if (inCheck(rs) && attacked(rs.b, to, ns.stm) && !attacked(rs.b, to, side)) return 0;
        }
        return 1;
    }

    function pawnValue(st, depth) {
        const pc = pawnCount(st.b);
        if (pc.n === 0) return 0;
        if (pc.n === 1 && !pc.pieces) { const pr = kpkProbe(st); return pr.win ? (pc.side === st.stm ? 1 : -1) : 0; }
        const k = pawnKey(st), e = pawnTT.get(k);
        if (e !== undefined && (e.v !== 0 || e.d >= depth)) return e.v;
        const moves = legalMoves(st);
        let best;
        if (!moves.length) best = inCheck(st) ? -1 : 0;
        else if (depth <= 0) return 0;
        else {
            best = -1;
            const prio = m => (m >> 12 ? 4 : 0) + (Math.abs(st.b[m & 63]) === P ? 2 : 0);
            moves.sort((a, c) => prio(c) - prio(a));               // promotions et poussées d'abord
            for (const m of moves) {
                const pr = m >> 12;
                if (pr && pr !== Q) continue;
                const ns = make(st, m);
                const v = pr ? afterPromotion(ns, (m >> 6) & 63, depth - 1) : -pawnValue(ns, depth - 1);
                if (v > best) best = v;
                if (best === 1) break;
            }
        }
        if (pawnTT.size > PAWN_TT_MAX) pawnTT = new Map();
        pawnTT.set(k, { v: best, d: best === 0 ? depth : Infinity });
        return best;
    }

    // Valeur d'un coup pour le camp qui le joue (même convention que pawnValue).
    function pawnMoveValue(st, m, depth) {
        const pr = m >> 12, ns = make(st, m);
        if (pr) return pr === Q ? afterPromotion(ns, (m >> 6) & 63, depth - 1) : -pawnValue(ns, depth - 1);
        return -pawnValue(ns, depth - 1);
    }

    // Plus petit horizon (demi-coups) qui prouve le gain du camp au trait après le coup m ; Infinity sinon.
    function pawnMoveWinDepth(st, m, cap) {
        for (let d = 1; d <= cap; d++) if (pawnMoveValue(st, m, d) === 1) return d;
        return Infinity;
    }

    // Plus petit horizon qui prouve la perte du camp au trait après le coup m (résistance) ; Infinity sinon.
    function pawnMoveLossDepth(st, m, cap) {
        for (let d = 1; d <= cap; d++) if (pawnMoveValue(st, m, d) === -1) return d;
        return Infinity;
    }

    return {
        P, N, B, R, Q, K, LETTER, MATE, forcesPromotion,
        pawnValue, pawnMoveValue, pawnMoveWinDepth, pawnMoveLossDepth, pawnCount,
        fromFen, fromGlobals, mFrom, mTo, mPromo, mk, promoLetter,
        attacked, inCheck, legalMoves, make, kingSq, piecesOf, dist,
        searchBest, judgeMate,
        buildKpk, kpkProbe, kpkAfter, kpkMoves, kpkPawnSide, kpkBestAttack, kpkDefense, kpkTrapAttack
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { EG };
