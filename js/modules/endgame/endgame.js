/**
 * modules/endgame/endgame.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Finales : exercices de finales théoriques avec réponse automatique de l'adversaire.
 *
 *   1. EG                noyau pur (règles, recherche, base KPK exacte) — aucune dépendance au DOM
 *   2. ENDGAME_EXERCISES catalogue : FEN + objectif + théorie
 *   3. progression       localStorage « chessTrainer_endgames »
 *   4. initEndgame()     écran d'accueil (appelé par switchHomeTab('endgame'))
 *   5. startEndgame(id)  séance : jugement du coup, réponse de l'adversaire, indices, retenter
 *
 * S'appuie sur l'écran de jeu existant (gameMode = 'endgame') ; voir endgame-integration.md
 * pour les quelques lignes à ajouter dans index.html, app.js, openingsLogic.js, openingsUI.js, style.css.
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

    // Recherche bornée (preuve) : le camp blanc, au trait, peut-il forcer une promotion en dame
    // non prenable en `plies` demi-coups ? Sert à vérifier qu'une défense tient (finales de tours).
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
                    const rep = legalMoves(make(s, x));
                    if (rep.length && !rep.some(r => ((r >> 6) & 63) === to)) { res = true; break; }
                    continue;
                }
                if (black(make(s, x), d - 1)) { res = true; break; }
            }
            memo.set(k, res);
            return res;
        };
        const black = (s, d) => {
            const mv = legalMoves(s);
            if (!mv.length || d <= 0) return false;
            const k = key(s, -d);
            if (memo.has(k)) return memo.get(k);
            let all = true;
            for (const x of mv) if (!white(make(s, x), d - 1)) { all = false; break; }
            memo.set(k, all);
            return all;
        };
        return white(st, plies);
    }

    return {
        P, N, B, R, Q, K, LETTER, MATE, forcesPromotion,
        fromFen, fromGlobals, mFrom, mTo, mPromo, mk, promoLetter,
        attacked, inCheck, legalMoves, make, kingSq, piecesOf, dist,
        searchBest, judgeMate,
        buildKpk, kpkProbe, kpkAfter, kpkMoves, kpkPawnSide, kpkBestAttack, kpkDefense, kpkTrapAttack
    };
})();

// ═══════════════════════════════════════════════════════════════════════════
//  2. CATALOGUE
// ═══════════════════════════════════════════════════════════════════════════
// kind  'mate' : mat élémentaire — défense du roi seul par mini-moteur (négamax),
//                coup du joueur jugé : pat ? pièce abandonnée ? trop lent ?
//       'kpk'  : roi + pion contre roi — verdict EXACT (base calculée au besoin), défense parfaite.
// goal  'mate' | 'win' (promotion inévitable) | 'draw' (nulle : prise du pion, pat, ou `hold` coups tenus)
// player 'w' | 'b' : le joueur a toujours le trait au départ.
const ENDGAME_CATEGORIES = [
    { id: 'mats',  label: 'Mats élémentaires', desc: 'Technique pure : confiner le roi et le mater sans pat.' },
    { id: 'pions', label: 'Finales de pions',  desc: 'Roi + pion contre roi : carré, opposition, cases clés. Verdict exact à chaque coup.' },
    { id: 'tours', label: 'Finales de tours',  desc: 'Les deux positions fondamentales : Lucena (gagner) et Philidor (annuler).' }
];

const ENDGAME_EXERCISES = [
    {
        id: 'kqk', cat: 'mats', kind: 'mate', goal: 'mate', player: 'w', level: 1,
        title: 'Roi + Dame contre Roi',
        fen: '8/8/8/4k3/8/8/8/1Q2K3 w - - 0 1',
        maxMoves: 20, defDepth: 4,
        tips: ['Gardez la Dame à un saut de cavalier du roi adverse : elle lui coupe un maximum de cases sans qu\'il puisse l\'approcher.',
               'Rétrécissez la zone pas à pas, puis amenez votre roi en renfort (opposition à deux cases).',
               'Avant chaque coup : le roi adverse garde-t-il au moins une case libre ? Sinon, c\'est pat.'],
        theory: 'Dame + Roi contre Roi se gagne toujours en dix coups environ. Confinez le roi sur un bord avec la Dame (à un saut de cavalier), avancez votre roi jusqu\'à l\'opposition, puis donnez mat. Le seul piège : le pat.'
    },
    {
        id: 'krk', cat: 'mats', kind: 'mate', goal: 'mate', player: 'w', level: 2,
        title: 'Roi + Tour contre Roi',
        fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
        maxMoves: 30, defDepth: 4,
        tips: ['Coupez le roi adverse avec la Tour sur une rangée ou une colonne, loin de lui (il ne doit jamais pouvoir la prendre).',
               'Méthode de la boîte : à chaque coup de Tour qui rétrécit la zone, avancez votre roi pour la soutenir.',
               'Quand les rois sont en opposition (une case entre eux), un échec de Tour repousse le roi vers le bord.'],
        theory: 'La technique de la « boîte » : la Tour délimite la zone de fuite, le roi s\'approche, et chaque opposition permet un échec qui rétrécit la boîte jusqu\'au bord. Maximum théorique : 16 coups.'
    },
    {
        id: 'kpk-carre', cat: 'pions', kind: 'kpk', goal: 'win', player: 'w', level: 1,
        title: 'Règle du carré',
        fen: '8/8/8/8/3P4/7k/8/K7 w - - 0 1',
        tips: ['Le roi noir est hors du carré du pion d4 : comptez les coups qu\'il lui faut pour rattraper le pion.'],
        theory: 'Règle du carré : le côté du carré est le nombre de pas qui séparent le pion de sa case de promotion. Si le roi défenseur (au trait) ne peut pas entrer dans ce carré, le pion court à la promotion sans aide.'
    },
    {
        id: 'kpk-carre-def', cat: 'pions', kind: 'kpk', goal: 'draw', player: 'b', level: 1, hold: 6,
        title: 'Entrer dans le carré',
        fen: '8/8/8/8/3P4/7k/8/K7 b - - 0 1',
        tips: ['Le roi noir est un rang trop bas : un seul coup l\'amène dans le carré du pion.'],
        theory: '…Kg4 ! entre dans le carré : après d5 Kf5 d6 Ke6 d7 Kxd7, le roi rattrape le pion. Tout autre coup le laisse hors du carré : le pion se promeut.'
    },
    {
        id: 'kpk-opposition', cat: 'pions', kind: 'kpk', goal: 'win', player: 'w', level: 2,
        title: 'Prendre l\'opposition',
        fen: '8/3k4/8/2K5/3P4/8/8/8 w - - 0 1',
        tips: ['Deux rois face à face, une case entre eux : celui qui n\'a PAS le trait détient l\'opposition.',
               'Placez votre roi devant le pion, à deux cases du roi adverse, pour que ce soit à lui de jouer.'],
        theory: 'Un seul coup gagne : Kd5! prend l\'opposition (Kd5 face à Kd7, les Noirs au trait). Le roi noir doit céder du terrain, et le roi blanc gagne les cases clés devant le pion.'
    },
    {
        id: 'kpk-opposition-def', cat: 'pions', kind: 'kpk', goal: 'draw', player: 'b', level: 2, hold: 8,
        title: 'Tenir l\'opposition',
        fen: '8/4k3/8/3K4/2P5/8/8/8 b - - 0 1',
        tips: ['Le roi blanc menace d\'avancer : placez votre roi pour que ce soit à lui de jouer, face à face.',
               'Restez devant le pion, jamais sur le côté.'],
        theory: '…Kd7! reprend l\'opposition : le roi blanc ne peut plus avancer sans que le roi noir ne garde le contrôle des cases clés. La nulle se tient en gardant l\'opposition à chaque coup.'
    },
    {
        id: 'kpk-sixieme', cat: 'pions', kind: 'kpk', goal: 'win', player: 'w', level: 2,
        title: 'Cases clés : roi sur la 6e',
        fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
        tips: ['Le roi est déjà sur une case clé : ne vous précipitez pas, contournez le roi adverse sans lui laisser le pat.'],
        theory: 'Quand le roi fort occupe une case clé (ici la 6e rangée, devant ou à côté d\'un pion sur la 5e), la position est gagnée quel que soit le trait. Attention au pat avec un pion en 7e !'
    },
    {
        id: 'kpk-noir', cat: 'pions', kind: 'kpk', goal: 'win', player: 'b', level: 3,
        title: 'Pion noir : le pas de côté',
        fen: '8/8/8/8/3p4/3k4/8/3K4 b - - 0 1',
        tips: ['Les règles sont les mêmes, à l\'envers : les Noirs avancent vers la 1re rangée.',
               'Face au roi blanc, un pas de côté permet de contourner l\'opposition.'],
        theory: 'Les règles sont symétriques. Le roi noir précède son pion, le roi blanc lui fait face sur la 1re rangée. Au trait, les Noirs gagnent par un pas de côté (…Kc3 ou …Ke3) qui contourne l\'opposition.'
    },
    {
        id: 'kpk-tour', cat: 'pions', kind: 'kpk', goal: 'draw', player: 'b', level: 3, hold: 8,
        title: 'Pion de tour : le coin',
        fen: '2k5/8/2K5/P7/8/8/8/8 b - - 0 1',
        tips: ['Avec un pion de colonne a, le roi défenseur nulle s\'il atteint le coin de promotion.'],
        theory: 'Un pion de colonne a ou h ne gagne pas si le roi défenseur atteint le coin de promotion : le roi attaquant manque de place d\'un côté, et les pats tombent dès que le roi noir touche a8 ou b8.'
    },
    {
        id: 'rook-lucena', cat: 'tours', kind: 'script', goal: 'win', player: 'w', level: 3,
        title: 'Position de Lucena',
        fen: '3K4/3P2k1/8/8/8/8/r7/5R2 w - - 0 1',
        line: ['f1f4', 'a2a1', 'd8e7', 'a1e1', 'e7d6', 'e1d1', 'd6e6', 'd1e1', 'e6d5', 'e1d1', 'f4d4', 'd1d4', 'd5d4', 'g7f7', 'd7d8q'],
        tips: ['Le roi est enfermé devant son pion : il faut construire un « pont » avec la Tour sur la 4e rangée.',
               'Gardez le roi noir coupé sur la colonne f, et préparez l\'interposition de la Tour sur la 4e rangée.'],
        theory: 'Lucena : 1.Rf4! (le pont) Ra1 2.Ke7 Re1+ 3.Kd6 Rd1+ 4.Ke6 Re1+ 5.Kd5 Rd1+ 6.Rd4! Rxd4+ 7.Kxd4 : le pion se promeut (d8=Q). Le roi sort de devant son pion, et la Tour, protégée par le roi, s\'interpose sur la 4e rangée pour casser les échecs.'
    },
    {
        id: 'rook-philidor', cat: 'tours', kind: 'rules', goal: 'draw', player: 'b', level: 3, hold: 12,
        title: 'Position de Philidor',
        fen: '4k3/8/r7/3KP3/8/7R/8/8 b - - 0 1', beta: true,
        tips: ['Tant que le pion n\'a pas atteint la 6e rangée, gardez la Tour noire sur la 6e rangée et le roi sur sa dernière rangée.',
               'Dès que le pion avance en e6, passez avec la Tour sur la 1re rangée pour donner des échecs par derrière.'],
        theory: 'Défense de Philidor : la Tour reste sur la 6e rangée (elle interdit au roi blanc d\'avancer) tant que le pion n\'est pas en 6e ; dès qu\'il avance, la Tour passe derrière et donne échec sur échec, le roi noir restant sur sa dernière rangée.'
    }
];

const ENDGAME_BY_ID = {};
ENDGAME_EXERCISES.forEach(e => { ENDGAME_BY_ID[e.id] = e; });

const EG_SIDE = { w: 'Blancs', b: 'Noirs' };
function egObjective(ex) {
    const who = EG_SIDE[ex.player];
    return ex.goal === 'mate' ? `Les ${who} jouent et font mat`
         : ex.goal === 'win'  ? `Les ${who} jouent et gagnent`
         :                      `Les ${who} jouent et annulent`;
}

// Contrôle de cohérence du catalogue (console : endgameSelfTest()). Chaque exercice doit
// démarrer au trait du joueur, légalement, avec le verdict théorique annoncé.
function endgameSelfTest() {
    return ENDGAME_EXERCISES.map(ex => {
        const st = EG.fromFen(ex.fen), problems = [];
        if (st.stm !== (ex.player === 'w' ? 1 : -1)) problems.push('le joueur n\'a pas le trait');
        if (EG.attacked(st.b, EG.kingSq(st.b, -st.stm), st.stm)) problems.push('position illégale (roi adverse en échec)');
        if (!EG.legalMoves(st).length) problems.push('aucun coup légal');
        if (ex.kind === 'script') {
            let cur = st;
            ex.line.forEach((u, i) => {
                const m = _egParseUci(u);
                if (!EG.legalMoves(cur).includes(m)) { problems.push(`coup illégal dans la ligne : ${u} (n°${i + 1})`); return; }
                cur = EG.make(cur, m);
            });
        }
        if (ex.kind === 'rules') {
            const ok = EG.legalMoves(st).filter(m => !_egPhilidorCheck(st, m));
            if (!ok.length) problems.push('aucun coup de défense conforme');
        }
        if (ex.kind === 'kpk') {
            const pr = EG.kpkProbe(st), expectWin = ex.goal === 'win';
            if (pr.invalid) problems.push('position invalide pour la base KPK');
            else if (pr.win !== expectWin) problems.push(`verdict théorique « ${pr.win ? 'gain' : 'nulle'} » ≠ objectif « ${ex.goal} »`);
            if (EG.kpkMoves(st).filter(x => x.info.win === (ex.goal === 'win')).length === 0) problems.push('aucun coup correct');
        }
        return { id: ex.id, ok: !problems.length, problems };
    });
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. PROGRESSION (localStorage)
// ═══════════════════════════════════════════════════════════════════════════
const ENDGAME_PROGRESS_KEY = 'chessTrainer_endgames';

function readEndgameProgress() {
    try { const o = JSON.parse(localStorage.getItem(ENDGAME_PROGRESS_KEY)); return o && typeof o === 'object' ? o : {}; }
    catch (e) { return {}; }
}
function _egSaveProgress(p) { try { localStorage.setItem(ENDGAME_PROGRESS_KEY, JSON.stringify(p)); } catch (e) {} }

function _egBump(id, fn) {
    const p = readEndgameProgress();
    const cur = p[id] || { tries: 0, wins: 0, perfect: false, best: 0, last: 0 };
    fn(cur);
    cur.last = Date.now();
    p[id] = cur;
    _egSaveProgress(p);
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. ÉCRAN D'ACCUEIL « FINALES »
// ═══════════════════════════════════════════════════════════════════════════
function egMiniBoard(ex) {
    const rows  = ex.fen.split(' ')[0].split('/');
    const cells = new Array(64).fill('');
    for (let r = 0; r < 8; r++) {
        let c = 0;
        for (const ch of rows[r]) { if (ch >= '1' && ch <= '8') c += Number(ch); else cells[(7 - r) * 8 + c++] = ch; }
    }
    const flip  = ex.player === 'b';
    const ranks = flip ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    const files = flip ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    let html = '';
    ranks.forEach(r => files.forEach(c => {
        const p = cells[r * 8 + c];
        html += `<i class="eg-sq ${(r + c) % 2 === 1 ? 'l' : 'd'}">${p ? pieceHTML(p) : ''}</i>`;
    }));
    return `<div class="eg-mini" aria-hidden="true">${html}</div>`;
}

const _egDots = n => '●'.repeat(n) + '○'.repeat(3 - n);

function initEndgame() {
    const panel = document.getElementById('endgame-panel');
    if (!panel) return;
    const prog = readEndgameProgress();
    const done    = ENDGAME_EXERCISES.filter(e => prog[e.id] && prog[e.id].wins > 0).length;
    const perfect = ENDGAME_EXERCISES.filter(e => prog[e.id] && prog[e.id].perfect).length;
    const tries   = ENDGAME_EXERCISES.reduce((s, e) => s + ((prog[e.id] && prog[e.id].tries) || 0), 0);

    let html = `<div class="stats-kpis">
        <div class="stats-kpi"><span class="stats-kpi-n">${done}/${ENDGAME_EXERCISES.length}</span><span class="stats-kpi-l">réussis</span></div>
        <div class="stats-kpi"><span class="stats-kpi-n">${perfect}</span><span class="stats-kpi-l">sans faute ni indice</span></div>
        <div class="stats-kpi"><span class="stats-kpi-n">${tries}</span><span class="stats-kpi-l">tentative${tries > 1 ? 's' : ''}</span></div>
    </div>`;

    ENDGAME_CATEGORIES.forEach(cat => {
        const list = ENDGAME_EXERCISES.filter(e => e.cat === cat.id);
        if (!list.length) return;
        html += `<section class="eg-section"><div class="eg-section-head"><div class="eg-section-title">${_esc(cat.label)}</div><div class="eg-section-desc">${_esc(cat.desc)}</div></div><div class="eg-grid">`;
        list.forEach(ex => {
            const p = prog[ex.id];
            const badge = p && p.perfect ? `<span class="eg-badge ok">${ico('check')} Sans faute</span>`
                        : p && p.wins     ? `<span class="eg-badge ok">${ico('check')} Réussi</span>`
                        : p && p.tries    ? '<span class="eg-badge">En cours</span>' : '';
            html += `<button class="eg-card" onclick="startEndgame('${ex.id}')">
                ${egMiniBoard(ex)}
                <div class="eg-card-body">
                    <div class="eg-card-title">${_esc(ex.title)}${ex.beta ? ' <span class="eg-badge beta">Bêta</span>' : ''}</div>
                    <div class="eg-card-goal">${egObjective(ex)}</div>
                    <div class="eg-card-meta"><span class="eg-lvl" title="Niveau ${ex.level}/3">${_egDots(ex.level)}</span>${badge}</div>
                </div></button>`;
        });
        html += '</div></section>';
    });
    panel.innerHTML = html;

    // Précalcule la base KPK pendant que l'utilisateur choisit (≈ 0,25 s).
    const warm = () => { try { EG.buildKpk(); } catch (e) {} };
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 1500 }); else setTimeout(warm, 400);
}


// ─── Outils des finales de tours ──────────────────────────────────────────────
const _egSqName = s => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
const _egUci = m => _egSqName(EG.mFrom(m)) + _egSqName(EG.mTo(m)) + (EG.mPromo(m) ? EG.LETTER[EG.mPromo(m)].toLowerCase() : '');
function _egParseUci(u) {
    const sq = n => 'abcdefgh'.indexOf(n[0]) + 8 * (Number(n[1]) - 1);
    return EG.mk(sq(u.slice(0, 2)), sq(u.slice(2, 4)), u[4] ? { q: 5, r: 4, b: 3, n: 2 }[u[4]] : 0);
}

// Défense de Philidor (Noirs) : règles canoniques + garde-fou par recherche (les Blancs ne doivent pas
// pouvoir forcer la promotion en 9 demi-coups). Renvoie null si le coup est correct, sinon le message.
function _egPhilBasic(ns) {                                 // règles + Tour non abandonnée (aucune recherche)
    let pawn = -1, rook = -1;
    for (let i = 0; i < 64; i++) { if (ns.b[i] === 1) pawn = i; if (ns.b[i] === -4) rook = i; }
    if (pawn < 0 || rook < 0) return null;
    if (EG.attacked(ns.b, rook, 1) && !EG.attacked(ns.b, rook, -1)) return 'Votre Tour est en prise : elle serait perdue.';
    const bk = EG.kingSq(ns.b, -1), pr = pawn >> 3;
    if (pr <= 4) {
        if ((rook >> 3) !== 5) return 'Philidor : tant que le pion n\'est pas en 6e, la Tour reste sur la 6e rangée.';
        if ((bk >> 3) < 6) return 'Philidor : gardez le roi noir sur sa dernière rangée (ou la 7e), devant le pion.';
    } else if (pr === 5 && (rook >> 3) !== 0) {
        return 'Le pion est en 6e : la Tour doit passer derrière, sur la 1re rangée, pour donner des échecs par derrière.';
    }
    return null;
}

// Défense de Philidor (Noirs) : règles canoniques, anticipation de la poussée e5-e6, et garde-fou par
// recherche (les Blancs ne doivent pas forcer la promotion en 9 demi-coups). null = coup correct.
function _egPhilidorCheck(st, m) {
    const ns = EG.make(st, m);
    const pawn = ns.b.indexOf(1);
    if (pawn < 0) {                                           // prise du pion : valable seulement si la Tour n'est pas reprise
        const back = EG.legalMoves(ns).some(r => ns.b[EG.mTo(r)] < 0 && Math.abs(ns.b[EG.mTo(r)]) !== 6);
        return back ? { msg: 'La Tour serait reprise par le roi : le pion est protégé.' } : { capture: true };
    }
    const basic = _egPhilBasic(ns);
    if (basic) return { msg: basic };
    if ((pawn >> 3) <= 4 && !EG.inCheck(st) && ns.b.indexOf(-6) !== 60)
        return { msg: 'Philidor : sans échec à parer, le roi reste sur e8 devant le pion ; jouez avec la Tour sur la 6e rangée.' };
    if ((pawn >> 3) === 4) {                                  // les Blancs peuvent-ils pousser, et aurez-vous alors une défense ?
        const push = EG.legalMoves(ns).find(x => EG.mFrom(x) === pawn && EG.mTo(x) === pawn + 8);
        if (push) {
            const n2 = EG.make(ns, push);
            const ok = EG.legalMoves(n2).some(r => {
                const n3 = EG.make(n2, r);
                if (n3.b.indexOf(1) < 0) return !EG.legalMoves(n3).some(x => n3.b[EG.mTo(x)] < 0 && Math.abs(n3.b[EG.mTo(x)]) !== 6);   // prise du pion non reprise
                return !_egPhilBasic(n3) && !EG.forcesPromotion(n3, 5);
            });
            if (!ok) return { msg: 'Après e6, vous n\'auriez plus de défense : placez la Tour et le roi autrement.' };
        }
    }
    if (EG.forcesPromotion(ns, 7)) return { msg: 'Ce coup perd : les Blancs peuvent forcer la promotion du pion.' };
    return null;
}

// Les Blancs poussent, doublent sur la 7e, donnent échec : un adversaire qui « essaie » vraiment.
function _egPhilidorWhite(st) {
    let best = null, bs = -1e9;
    for (const m of EG.legalMoves(st)) {
        const ns = EG.make(st, m), from = EG.mFrom(m), to = EG.mTo(m), t = Math.abs(st.b[from]);
        let sc = 0;
        if (st.b[to] < 0) sc += 500;
        if (t === 1) { sc += 60; if (EG.attacked(ns.b, to, -1) && !EG.attacked(ns.b, to, 1)) sc -= 300; }
        if (t === 4) { const rk = to >> 3; if (rk === 6) sc += 30; if (rk === 7) sc += 25; if (EG.attacked(ns.b, to, -1) && !EG.attacked(ns.b, to, 1)) sc -= 400; }
        if (t === 6) sc += 6 * (to >> 3);
        if (EG.inCheck(ns)) sc += 15;
        const ps = ns.b.indexOf(1);
        if (ps >= 0 && EG.attacked(ns.b, ps, -1) && !EG.attacked(ns.b, ps, 1)) sc -= 500;      // ne jamais laisser le pion en prise
        if (ps >= 0 && !EG.attacked(ns.b, ps, 1)) sc -= 150;                                   // garder le pion protégé
        if (ps >= 0) {                                                                         // prise du pion non reprise ?
            for (const r of EG.legalMoves(ns)) {
                if (EG.mTo(r) !== ps) continue;
                const n2 = EG.make(ns, r);
                if (!EG.legalMoves(n2).some(x => EG.mTo(x) === ps)) { sc -= 600; break; }
            }
        }
        if (sc > bs) { bs = sc; best = m; }
    }
    return best;
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. SÉANCE D'EXERCICE
// ═══════════════════════════════════════════════════════════════════════════
const endgameState = {
    ex: null, busy: false, over: false, failed: null, timers: [],
    moves: 0, errors: 0, hints: 0, hintLevel: 0, budget: 0, seen: {}, tried: false
};

function _egLater(fn, ms) { endgameState.timers.push(setTimeout(fn, ms)); }

function stopEndgame() {
    endgameState.timers.forEach(clearTimeout);
    endgameState.timers = [];
    endgameState.busy = false;
    endgameState.ex   = null;
}

const _egCur  = () => EG.fromGlobals(board, turn);
const _egPromoCode = l => ({ Q: 5, R: 4, B: 3, N: 2 }[String(l).toUpperCase()] || 0);

function startEndgame(id) {
    const ex = ENDGAME_BY_ID[id];
    if (!ex) return;
    stopEndgame();
    endgameState.ex = ex;
    playerColor = ex.player;
    gameMode    = 'endgame';
    endgameState.errors = 0; endgameState.hints = 0; endgameState.tried = false;
    showGameScreen(ex.player);
    const pill = document.getElementById('repertoire-pill');
    if (pill) pill.textContent = ex.title;
    _egLoadPosition();
}

function _egLoadPosition() {
    const s = endgameState, ex = s.ex;
    s.timers.forEach(clearTimeout); s.timers = [];
    parseFEN(ex.fen);
    moveHistory = []; lastFrom = -1; lastTo = -1;
    selected = null; legalMoves = []; hintPiece = null; awaitingPromotion = null;
    boardFlipped = ex.player === 'b';
    resetNavCursor();
    clearErrorFx();
    s.busy = false; s.over = false; s.failed = null;
    s.moves = 0; s.hintLevel = 0; s.seen = {};
    if (ex.kind === 'kpk') {
        const pr = EG.kpkProbe(_egCur());
        s.budget = ex.goal === 'win' ? Math.ceil(pr.dtw / 2) + 3 : ex.hold;
    } else if (ex.kind === 'script') s.budget = Math.ceil(ex.line.length / 2);
    else if (ex.kind === 'rules')    s.budget = ex.hold;
    else s.budget = ex.maxMoves;
    renderMoves();
    renderBoard();
    renderEndgameCard();
    setStatus(`${egObjective(ex)} — à vous de jouer.`, 'info');
}

function retryEndgame() {
    if (!endgameState.ex) return;
    endgameState.errors = 0; endgameState.hints = 0; endgameState.tried = false;
    _egLoadPosition();
}

function nextEndgame() {
    const ex = endgameState.ex;
    if (!ex) return;
    const i = ENDGAME_EXERCISES.indexOf(ex);
    startEndgame(ENDGAME_EXERCISES[(i + 1) % ENDGAME_EXERCISES.length].id);
}

// ─── CARTE D'OBJECTIF (panneau de jeu) ────────────────────────────────────────
function renderEndgameCard() {
    const el = document.getElementById('endgame-card');
    const s = endgameState, ex = s.ex;
    if (!el || !ex) return;
    const cat = ENDGAME_CATEGORIES.find(c => c.id === ex.cat);
    const unit = ex.kind === 'script' ? 'au total' : ex.goal === 'draw' ? 'à tenir' : 'max';
    const meter = `<div class="eg-meter"><span>Coup <b>${s.moves}</b> / ${s.budget} ${unit}</span><span>${s.errors} erreur${s.errors > 1 ? 's' : ''}</span><span>${s.hints} indice${s.hints > 1 ? 's' : ''}</span></div>`;

    let result = '';
    if (s.over) {
        result = `<div class="eg-result ok">${ico('check')} <span>${_esc(s.over)}</span></div>
            <div class="eg-theory">${_esc(ex.theory)}</div>
            <div class="eg-actions"><button class="btn btn-primary" onclick="nextEndgame()">${ico('skip-forward')} Suivant</button><button class="btn" onclick="retryEndgame()">${ico('rotate-ccw')} Rejouer</button></div>`;
    } else if (s.failed) {
        result = `<div class="eg-result err">${ico('alert-triangle')} <span>${_esc(s.failed.msg)}</span></div>
            <div class="eg-actions">${s.failed.undoable ? `<button class="btn btn-primary" onclick="undoEndgameMove()">${ico('pencil')} Annuler ce coup</button>` : ''}<button class="btn" onclick="retryEndgame()">${ico('rotate-ccw')} Recommencer</button></div>`;
    }
    el.className = 'endgame-card' + (s.over ? ' is-ok' : s.failed ? ' is-err' : '');
    el.innerHTML = `<div class="eg-card-top"><span class="eg-cat">${_esc(cat ? cat.label : '')}</span><span class="eg-lvl">${_egDots(ex.level)}</span></div>
        <div class="eg-title">${_esc(ex.title)}${ex.beta ? ' <span class="eg-badge beta">Bêta</span>' : ''}</div>
        <div class="eg-goal">${egObjective(ex)}</div>
        ${meter}${result}`;
}

// ─── COUP DU JOUEUR (appelé par executePlayerMove) ────────────────────────────
function _egJudge(ex, st, m) {
    const s = endgameState, n = s.moves + 1;                 // numéro de ce coup
    if (ex.kind === 'mate') {
        const j = EG.judgeMate(st, m);
        if (j.mate)      return { state: 'success', msg: 'Échec et mat ! Bien joué.' };
        if (j.stalemate) return { state: 'fail', undoable: true,  msg: 'Pat ! La partie est nulle : laissez toujours une case libre au roi adverse (hors échec).' };
        if (j.hanging)   return { state: 'fail', undoable: true,  msg: 'Votre pièce est abandonnée : le roi adverse la prend et le gain disparaît.' };
        if (n > ex.maxMoves) return { state: 'fail', undoable: false, msg: `Trop lent : le mat doit tomber en ${ex.maxMoves} coups maximum.` };
        return { state: 'continue' };
    }
    if (ex.kind === 'script') {
        const i = 2 * (n - 1);
        if (_egUci(m) !== ex.line[i]) return { state: 'fail', undoable: true, msg: 'Ce coup sort de la méthode théorique : cherchez le plan de la leçon (utilisez l\'indice).' };
        if (i === ex.line.length - 1) return { state: 'success', msg: 'Pion promu : position gagnée !' };
        return { state: 'continue' };
    }
    if (ex.kind === 'rules') {
        const r = _egPhilidorCheck(st, m);
        if (r && r.capture) return { state: 'success', msg: 'Pion capturé : nulle !' };
        if (r) return { state: 'fail', undoable: true, msg: r.msg };
        if (n >= ex.hold) return { state: 'success', msg: `Nulle assurée : vous avez tenu ${ex.hold} coups avec la défense de Philidor.` };
        return { state: 'continue' };
    }
    const info = EG.kpkAfter(st, m);
    if (ex.goal === 'win') {
        if (!info.win) {
            const why = { capture: 'Le pion est perdu : c\'est nulle.', stalemate: 'Pat ! C\'est nulle (en cas de pat, promouvez plutôt en Tour).',
                          underpromo: 'Promotion en pièce mineure : roi + cavalier ou fou ne peut pas mater, c\'est nulle.',
                          hanging: 'La pièce promue est prise ou le roi adverse est pat : le gain disparaît.' }[info.why]
                      || 'Ce coup laisse échapper le gain : la position est maintenant nulle.';
            return { state: 'fail', undoable: true, msg: why };
        }
        if (info.promoted || info.mate) return { state: 'success', msg: 'Promotion réussie : la position est gagnée.' };
        if (n > s.budget) return { state: 'fail', undoable: false, msg: 'Le gain théorique est conservé, mais vous perdez trop de temps : cherchez la ligne la plus directe.' };
        return { state: 'continue' };
    }
    if (info.win) return { state: 'fail', undoable: true, msg: 'Ce coup perd : le pion va se promouvoir. Il fallait garder la nulle.' };
    if (info.why === 'capture')   return { state: 'success', msg: 'Pion capturé : nulle !' };
    if (info.why === 'stalemate') return { state: 'success', msg: 'Pat : nulle !' };
    if (n >= s.budget) return { state: 'success', msg: `Nulle assurée : vous avez tenu ${s.budget} coups sans céder.` };
    return { state: 'continue' };
}

function answerEndgameMove(from, to, promo) {
    const s = endgameState, ex = s.ex;
    if (!ex || s.busy || s.over) return;
    const st  = _egCur();
    const m   = EG.mk(from, to, promo ? _egPromoCode(promo) : 0);
    const san = toAlgebraic(from, to, promo);                 // avant application : board est encore la position d'origine
    const res = _egJudge(ex, st, m);

    if (!s.tried) { s.tried = true; _egBump(ex.id, p => { p.tries++; }); }
    s.moves++; s.hintLevel = 0;

    if (res.state === 'fail') {
        s.errors++; s.failed = res; s.busy = true;
        _commitMove(from, to, promo, null, `✗ ${san} — ${res.msg}`, 'err');
        playSound('error');
        renderEndgameCard();
        return;
    }
    if (res.state === 'success') {
        _commitMove(from, to, promo, null, `✓ ${san} — ${res.msg}`, 'ok');
        _egFinish(res.msg);
        return;
    }
    s.busy = true;
    _commitMove(from, to, promo, null, `✓ ${san}`, 'ok');
    renderEndgameCard();
    _egLater(_egAiReply, 550);
}

// ─── RÉPONSE AUTOMATIQUE DE L'ADVERSAIRE ──────────────────────────────────────
function _egAiReply() {
    const s = endgameState, ex = s.ex;
    if (!ex || s.over || s.failed) return;
    const st = _egCur();
    const me = ex.player === 'w' ? 1 : -1;
    let m;
    if (ex.kind === 'script')     m = _egParseUci(ex.line[2 * s.moves - 1]);        // réponse de la ligne théorique
    else if (ex.kind === 'rules') m = _egPhilidorWhite(st);                         // Blancs qui cherchent à gagner
    else if (ex.kind === 'mate')  m = EG.searchBest(st, ex.defDepth || 4, me);      // défense du roi seul
    else if (ex.goal === 'win')   m = EG.kpkDefense(st);                            // défense parfaite (base exacte)
    else                          m = EG.kpkTrapAttack(st);                         // attaque qui tend des pièges
    if (m == null) { _egFinish('Partie terminée.'); return; }

    const from = EG.mFrom(m), to = EG.mTo(m), pr = EG.promoLetter(m);
    const san  = toAlgebraic(from, to, pr);
    _commitMove(from, to, pr, null, `Adversaire : ${san} — à vous.`, 'info');

    // Le joueur est-il maté / pat ? Répétition ?
    const st2 = _egCur(), replies = EG.legalMoves(st2);
    if (!replies.length) {
        if (EG.inCheck(st2)) { s.failed = { msg: 'Vous êtes mat.', undoable: false }; s.busy = true; s.errors++; renderEndgameCard(); setStatus('✗ Vous êtes mat.', 'err'); return; }
        if (ex.goal === 'draw') { _egFinish('Pat : nulle !'); return; }
        s.failed = { msg: 'Pat : la partie est nulle.', undoable: false }; s.busy = true; s.errors++; renderEndgameCard(); setStatus('✗ Pat.', 'err'); return;
    }
    const key = positionKey();
    s.seen[key] = (s.seen[key] || 0) + 1;
    if (ex.goal === 'draw' && s.seen[key] >= 3) { _egFinish('Nulle par répétition de position.'); return; }

    s.busy = false;
    renderEndgameCard();
}

// ─── FIN D'EXERCICE ───────────────────────────────────────────────────────────
function _egFinish(msg) {
    const s = endgameState, ex = s.ex;
    s.over = msg; s.busy = true;
    const perfect = s.errors === 0 && s.hints === 0;
    _egBump(ex.id, p => {
        p.wins++;
        if (perfect) p.perfect = true;
        if (!p.best || s.moves < p.best) p.best = s.moves;
    });
    renderEndgameCard();
    setStatus(`✓ ${msg}`, 'ok');
}

// ─── ANNULER UN COUP FAUTIF ───────────────────────────────────────────────────
function undoEndgameMove() {
    const s = endgameState;
    if (!s.failed || !s.failed.undoable || !moveHistory.length) return;
    performUndo();                                           // openingsLogic.js : restaure position, trait, surbrillance
    s.moves = Math.max(0, s.moves - 1);
    s.failed = null; s.busy = false; s.hintLevel = 0;
    renderEndgameCard();
    setStatus('Coup annulé — cherchez un autre coup.', 'info');
}

// ─── INDICE (appelé par showHint) ─────────────────────────────────────────────
//   kpk  : 1) type de pièce  2) idée  3) coup exact
//   mate : conseils successifs de la fiche
function endgameHint() {
    const s = endgameState, ex = s.ex;
    if (!ex || s.busy || s.over) return;
    const st = _egCur();
    s.hints++;

    if (ex.kind === 'script') {
        const want = _egParseUci(ex.line[2 * s.moves]), from = EG.mFrom(want);
        if (s.hintLevel === 0) setStatus(`Indice : déplacez ${PIECE_HINT[(board[from] || '').toUpperCase()] || 'une pièce'}.`, 'hint');
        else if (s.hintLevel === 1 && ex.tips.length) setStatus(`Indice : ${ex.tips[Math.min(s.moves ? 1 : 0, ex.tips.length - 1)]}`, 'hint');
        else setStatus(`Solution : ${toAlgebraic(from, EG.mTo(want), EG.promoLetter(want))}`, 'hint');
        s.hintLevel = Math.min(s.hintLevel + 1, 2);
        renderEndgameCard();
        return;
    }
    if (ex.kind === 'mate' || ex.kind === 'rules') {
        const tip = ex.tips[Math.min(s.hintLevel, ex.tips.length - 1)];
        s.hintLevel++;
        setStatus(`Indice : ${tip}`, 'hint');
        renderEndgameCard();
        return;
    }
    let best;
    if (ex.goal === 'win') best = EG.kpkBestAttack(st);
    else {
        const ok = EG.kpkMoves(st).filter(x => !x.info.win);
        best = ok.find(x => x.info.why === 'capture') || ok[0];
    }
    if (!best) { s.hints--; return; }
    const from = EG.mFrom(best.m);
    const tips = ex.tips || [];
    let level = s.hintLevel;
    if (level === 1 && !tips.length) level = 2;
    if (level === 0) {
        setStatus(`Indice : déplacez ${PIECE_HINT[(board[from] || '').toUpperCase()] || 'une pièce'}.`, 'hint');
    } else if (level === 1) {
        setStatus(`Indice : ${tips[0]}`, 'hint');
    } else {
        setStatus(`Solution : ${toAlgebraic(from, EG.mTo(best.m), EG.promoLetter(best.m))}`, 'hint');
    }
    s.hintLevel = Math.min(s.hintLevel + 1, 2);
    renderEndgameCard();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EG, ENDGAME_EXERCISES, endgameSelfTest, _egPhilidorCheck, _egPhilidorWhite };
}
